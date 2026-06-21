/**
 * infeasibilityDiagnosis.js — IIS (çelişen kısıt) tanı testleri (FAZ 14.9 Aşama 1)
 *
 * İki katman:
 *  1. Mock solve ile deletion filtering mantığı izole test (deterministik, glpk'siz)
 *  2. Gerçek solveLP ile bilinen çelişki → doğru IIS + minimallik doğrulaması
 */

import { describe, it, expect } from 'vitest';
import { findIIS, describeIIS, labelFor } from '../src/solver/infeasibilityDiagnosis.js';
import { buildRationLP, GLP } from '../src/solver/lpBuilder.js';
import { solveLP } from '../src/solver/glpkSolver.js';

// ─── Mock LP + solve yardımcıları ────────────────────────────────────────────

/** Verilen kısıt adlarından minimal sahte LP üretir. */
function mockLP(names) {
  return {
    objective: { direction: GLP.MIN, vars: [] },
    bounds: [],
    subjectTo: names.map(n => ({ name: n, vars: [], bnds: { type: GLP.LO, lb: 1 } })),
    _meta: {},
  };
}

/**
 * Kural-bazlı mock solve: rule(Set<isim>) === true → feasible (optimal).
 * Deletion filtering'i gerçek glpk olmadan izole test eder.
 */
function mockSolver(rule) {
  return async (lp) => {
    const names = new Set(lp.subjectTo.map(c => c.name));
    const feasible = rule(names);
    return { optimal: feasible, statusName: feasible ? 'optimal' : 'no_feasible' };
  };
}

// ─── Mock testler: deletion filtering mantığı ────────────────────────────────

describe('FAZ 14.9 — findIIS deletion filtering (mock)', () => {
  it('tek çelişen kısıt (A) → IIS = [A]', async () => {
    // A varsa infeasible (tek başına çelişir)
    const lp = mockLP(['DMI', 'A', 'B', 'C']);
    const solve = mockSolver(names => !names.has('A'));
    const r = await findIIS(lp, solve);
    expect(r.iis).toEqual(['A']);
    expect(r.reducible).toBe(true);
  });

  it('iki kısıt BİRLİKTE çelişir (A+B) → IIS = [A, B], C dahil değil', async () => {
    // A ve B ikisi birden varsa infeasible (tek başlarına değil)
    const lp = mockLP(['DMI', 'A', 'B', 'C']);
    const solve = mockSolver(names => !(names.has('A') && names.has('B')));
    const r = await findIIS(lp, solve);
    expect(r.iis.sort()).toEqual(['A', 'B']);
    expect(r.iis).not.toContain('C');
  });

  it('yapısal kısıt (DMI) IIS adayı değildir — çıkarılmaz', async () => {
    // DMI + A birlikte çelişse bile DMI keep listesinde → sadece A raporlanır
    const lp = mockLP(['DMI', 'A', 'B']);
    const solve = mockSolver(names => !(names.has('DMI') && names.has('A')));
    const r = await findIIS(lp, solve, { keepConstraints: ['DMI'] });
    // DMI her trial'da kalır; A çıkınca feasible → A kritik. IIS = [A]
    expect(r.iis).toContain('A');
    expect(r.iis).not.toContain('DMI');
  });

  it('feasible problem (hiç çelişki yok) → IIS boş', async () => {
    const lp = mockLP(['DMI', 'A', 'B']);
    const solve = mockSolver(() => true);  // her zaman feasible
    const r = await findIIS(lp, solve);
    expect(r.iis).toEqual([]);
  });

  it('adaylar yetersiz (yapısal/bounds çelişkisi) → reducible=false', async () => {
    // Tüm aday kısıtlar çıkarılsa bile infeasible → çelişki keep/bounds kaynaklı
    const lp = mockLP(['DMI', 'A', 'B']);
    const solve = mockSolver(() => false);  // her zaman infeasible
    const r = await findIIS(lp, solve);
    expect(r.reducible).toBe(false);
    expect(r.iis).toEqual([]);
  });

  it('maxConstraints aşılırsa boş döner (performans guard)', async () => {
    const many = ['DMI', ...Array.from({ length: 80 }, (_, i) => `c${i}`)];
    const lp = mockLP(many);
    const solve = mockSolver(() => true);
    const r = await findIIS(lp, solve, { maxConstraints: 60 });
    expect(r.iis).toEqual([]);
    expect(r.reducible).toBe(false);
  });

  it('üçlü çelişki (A+B+C birlikte) → IIS hepsini içerir', async () => {
    const lp = mockLP(['DMI', 'A', 'B', 'C', 'D']);
    // A, B, C üçü birden varsa infeasible; biri eksikse feasible
    const solve = mockSolver(names => !(names.has('A') && names.has('B') && names.has('C')));
    const r = await findIIS(lp, solve);
    expect(r.iis.sort()).toEqual(['A', 'B', 'C']);
    expect(r.iis).not.toContain('D');
  });
});

// ─── Gerçek solveLP entegrasyonu ─────────────────────────────────────────────

describe('FAZ 14.9 — findIIS gerçek glpk entegrasyonu', () => {
  const FEEDS = [
    { id: 'silage', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, rup: 15, rdp: 85, ndf: 44, adf: 27,
      nfc: 36, fat: 3.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
    { id: 'grain', category: 'grain', dm: 88, nel: 2.0, cp: 9, rup: 50, rdp: 50, ndf: 10, adf: 3,
      nfc: 74, fat: 4, ca: 0.02, p: 0.28, mg: 0.10, k: 0.38, na: 0.01, s: 0.10, cl: 0.05, pricePerTon: 9000 },
  ];

  it('imkansız NEL (dmi 10, NEL 100) → IIS = [NEL]', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 10,
      requirements: { nel_mcal: 100, ndf_pct: { min: 30, max: 40 } },
    });
    const hard = await solveLP(lp);
    expect(hard.optimal).toBe(false);

    const r = await findIIS(lp, solveLP, { GLP });
    expect(r.iis).toContain('NEL');
    expect(r.reducible).toBe(true);
  });

  it('minimallik: IIS kısıtı çıkarılınca LP feasible olur', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 10,
      requirements: { nel_mcal: 100 },
    });
    const r = await findIIS(lp, solveLP, { GLP });
    expect(r.iis.length).toBeGreaterThan(0);
    // IIS'ten ilk kısıtı çıkar → feasible olmalı (irreducible özelliği)
    const without = { ...lp, subjectTo: lp.subjectTo.filter(c => c.name !== r.iis[0]) };
    const sol = await solveLP(without);
    expect(sol.optimal).toBe(true);
  });

  it('feasible LP → IIS boş (çelişki yok)', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30 },
    });
    const feas = await solveLP(lp);
    expect(feas.optimal).toBe(true);
    const r = await findIIS(lp, solveLP, { GLP });
    expect(r.iis).toEqual([]);
  });
});

// ─── describeIIS Türkçe açıklama ─────────────────────────────────────────────

describe('FAZ 14.9 — describeIIS + labelFor', () => {
  it('tek kısıt → "tek başına karşılanamayan" mesajı + etiket + sınır', () => {
    const d = describeIIS({
      iis: ['NEL'], reducible: true,
      constraints: [{ name: 'NEL', label: 'NEL (enerji)', bound: 'min 100' }],
    });
    expect(d.summary).toContain('NEL (enerji)');
    expect(d.summary).toContain('min 100');
    expect(d.items).toHaveLength(1);
  });

  it('çoklu kısıt → "birlikte çelişiyor" + tüm kısıtlar listelenir', () => {
    const d = describeIIS({
      iis: ['DCAD', 'Forage'], reducible: true,
      constraints: [
        { name: 'DCAD', label: 'DCAD (katyon-anyon dengesi)', bound: '−15–−5 aralığı' },
        { name: 'Forage', label: 'Kaba yem oranı', bound: 'min 60' },
      ],
    });
    expect(d.summary).toContain('birlikte çelişiyor');
    expect(d.summary).toContain('DCAD');
    expect(d.summary).toContain('Kaba yem');
    expect(d.items).toHaveLength(2);
  });

  it('reducible=false → yapısal çelişki mesajı', () => {
    const d = describeIIS({ iis: [], reducible: false, constraints: [] });
    expect(d.summary).toContain('yapısal');
  });

  it('labelFor prefix kısıtları çevirir (trace_/vit_/group_)', () => {
    expect(labelFor('trace_zn')).toContain('İz mineral');
    expect(labelFor('vit_vitA')).toContain('Vitamin');
    expect(labelFor('group_protein')).toContain('Yem grubu');
    expect(labelFor('NEL')).toBe('NEL (enerji)');
  });
});
