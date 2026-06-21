/**
 * glpkSolver.js — glpk.js entegrasyon testleri
 */

import { describe, it, expect } from 'vitest';
import { buildRationLP, GLP } from '../src/solver/lpBuilder.js';
import { solveLP, getGLPK } from '../src/solver/glpkSolver.js';

const FEEDS = [
  { id: 'silage',  category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, ndf: 44, adf: 27,
    aNDF: 42, nfc: 36, fat: 3.3, ash: 4.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05,
    na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
  { id: 'alfalfa', category: 'roughage', dm: 89, nel: 1.30, cp: 18, ndf: 42, adf: 32,
    aNDF: 39, nfc: 25, fat: 2, ash: 11, ca: 1.45, p: 0.30, mg: 0.32, k: 2.50,
    na: 0.10, s: 0.27, cl: 0.40, pricePerTon: 6000 },
  { id: 'grain',   category: 'grain', dm: 88, nel: 2.0, cp: 9, ndf: 10, adf: 3,
    aNDF: 8, nfc: 74, fat: 4, ash: 1.4, ca: 0.02, p: 0.28, mg: 0.10, k: 0.38,
    na: 0.01, s: 0.10, cl: 0.05, pricePerTon: 9000 },
  { id: 'soy',     category: 'protein', dm: 89, nel: 1.99, cp: 48, ndf: 10, adf: 5,
    aNDF: 8, nfc: 28, fat: 1.5, ash: 7, ca: 0.33, p: 0.70, mg: 0.30, k: 2.20,
    na: 0.02, s: 0.45, cl: 0.04, pricePerTon: 18000 },
];

describe('getGLPK — modül yükleme', () => {
  it('glpk örneğini async döndürür', async () => {
    const glpk = await getGLPK();
    expect(glpk).toBeDefined();
    expect(typeof glpk.solve).toBe('function');
  });

  it('aynı örneği önbelleğe alır (singleton)', async () => {
    const a = await getGLPK();
    const b = await getGLPK();
    expect(a).toBe(b);
  });
});

describe('solveLP — temel LP çözümleri', () => {
  it('basit fizibil LP — optimal çözüm bulur', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, cp_pct: { min: 15, max: 20 } },
      objective: 'minDM',
    });
    const r = await solveLP(lp);
    expect(r.optimal).toBe(true);
    expect(r.statusName).toBe('optimal');
    expect(r.z).toBeGreaterThan(0);
  });

  it('çözümde Σ xi, dmi_kg ±%3 slack bandı içinde kalır (FAZ 13.3)', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, cp_pct: { min: 15 } },
    });
    const r = await solveLP(lp);
    const sum = Object.values(r.vars).reduce((s, v) => s + v, 0);
    // FAZ 13.3: tam eşitlik yerine ±%3 bant — [21.34, 22.66]
    expect(sum).toBeGreaterThanOrEqual(22 * 0.97 - 1e-6);
    expect(sum).toBeLessThanOrEqual(22 * 1.03 + 1e-6);
  });

  it('imkânsız NEL ile no_feasible / undefined döner', async () => {
    // dmi 5 kg ile NEL 100 Mcal imkansız (max NEL feed 2.0 × 5 = 10 Mcal)
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 5,
      requirements: { nel_mcal: 100 },
    });
    const r = await solveLP(lp);
    expect(r.optimal).toBe(false);
    expect(['no_feasible', 'infeasible', 'undef']).toContain(r.statusName);
  });

  it('amaç "cost" → en ucuz kombinasyonu seçer', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, cp_pct: { min: 14 } },
      objective: 'cost',
    });
    const r = await solveLP(lp);
    expect(r.optimal).toBe(true);
    // En pahalı yem olan soya küspesini tercih etmemeli
    expect((r.vars.x_soy ?? 0)).toBeLessThan(r.vars.x_silage ?? 0);
  });

  it('feedLimits sınırlamayı uygular', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, cp_pct: { min: 14 } },
      feedLimits: { alfalfa: { maxPct: 20 } },
    });
    const r = await solveLP(lp);
    expect(r.optimal).toBe(true);
    expect(r.vars.x_alfalfa).toBeLessThanOrEqual(22 * 0.20 + 0.01);
  });

  it('minPct ile yem dahil edilmek zorunda', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30 },
      feedLimits: { silage: { minPct: 25 } },
    });
    const r = await solveLP(lp);
    expect(r.optimal).toBe(true);
    expect(r.vars.x_silage).toBeGreaterThanOrEqual(22 * 0.25 - 0.01);
  });

  it('çözümde hiçbir yem negatif değildir (bounds lb=0, FAZ 13.4)', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, cp_pct: { min: 15 } },
    });
    // bounds dizisi solver'a iletilir
    expect(Array.isArray(lp.bounds)).toBe(true);
    const r = await solveLP(lp);
    expect(r.optimal).toBe(true);
    for (const v of Object.values(r.vars)) {
      expect(v).toBeGreaterThanOrEqual(-1e-9);  // negatif katılım yok
    }
  });
});

describe('solveLP — kısıt etkileşimleri', () => {
  it('CP üst sınırı tutuyor', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, cp_pct: { min: 15, max: 16 } },
    });
    const r = await solveLP(lp);
    if (r.optimal) {
      // Σ(xi × cp_i) ≤ 16 × 22 = 352
      const cpTotal = (r.vars.x_silage ?? 0) * 8.2 + (r.vars.x_alfalfa ?? 0) * 18
                    + (r.vars.x_grain ?? 0) * 9 + (r.vars.x_soy ?? 0) * 48;
      expect(cpTotal).toBeLessThanOrEqual(16 * 22 + 0.5);
    }
  });

  it('NDF aralığı uygulanıyor', async () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, ndf_pct: { min: 30, max: 35 }, cp_pct: { min: 14 } },
    });
    const r = await solveLP(lp);
    if (r.optimal) {
      const ndfTotal = (r.vars.x_silage ?? 0) * 44 + (r.vars.x_alfalfa ?? 0) * 42
                     + (r.vars.x_grain ?? 0) * 10 + (r.vars.x_soy ?? 0) * 10;
      expect(ndfTotal).toBeGreaterThanOrEqual(30 * 22 - 0.5);
      expect(ndfTotal).toBeLessThanOrEqual(35 * 22 + 0.5);
    }
  });
});
