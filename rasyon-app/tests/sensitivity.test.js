/**
 * FAZ 20.1 — LP duyarlılık analizi (gölge fiyat + azaltılmış maliyet) testleri.
 * buildRationLP + solveLP (glpk) ile gerçek çözümden dual/reduced-cost çıkarımı.
 */
import { describe, it, expect } from 'vitest';
import { buildRationLP } from '../src/solver/lpBuilder.js';
import { solveLP } from '../src/solver/glpkSolver.js';
import { computeSensitivity } from '../src/solver/sensitivity.js';

const FEEDS = [
  { id: 'corn', category: 'grain',   dm: 88, nel: 2.0,  cp: 9,  ndf: 10, rdp: 50, rup: 50, pricePerTon: 9000 },
  { id: 'sbm',  category: 'protein', dm: 89, nel: 1.99, cp: 48, ndf: 10, rdp: 65, rup: 35, pricePerTon: 18000 },
  { id: 'cs',   category: 'roughage', dm: 33, nel: 1.72, cp: 8,  ndf: 44, rdp: 85, rup: 15, pricePerTon: 2500 },
];

async function solved(requirements, extra = {}) {
  const lp = buildRationLP({ feeds: FEEDS, dmi_kg: 20, requirements, ...extra });
  const solution = await solveLP(lp);
  return { lp, solution };
}

describe('FAZ 20.1 — computeSensitivity', () => {
  it('optimal saf LP / cost amacı → applicable + gölge fiyat + azaltılmış maliyet', async () => {
    const { lp, solution } = await solved({ nel_mcal: 28, mp_g: 1400, ndf_pct: { min: 28, max: 40 } });
    const s = computeSensitivity({ lp, solution, feeds: FEEDS, objective: 'cost' });
    expect(s.applicable).toBe(true);
    expect(s.shadowPrices.length).toBeGreaterThan(0);          // en az bir bağlayıcı kısıt (örn. DMI)
    expect(s.shadowPrices.every(p => Math.abs(p.dual) > 0)).toBe(true);
    s.reducedCosts.forEach(r => {
      expect(r.reducedCost).toBeGreaterThan(0);
      expect(r.priceToEnter).toBeGreaterThan(0);
    });
  });

  it('çözümde olan yem azaltılmış-maliyet listesinde DEĞİL (bazik → rc≈0)', async () => {
    const { lp, solution } = await solved({ nel_mcal: 28, mp_g: 1400 });
    const usedVars = Object.entries(solution.raw.result.vars).filter(([, v]) => v > 0.01).map(([k]) => k);
    const rcVars = computeSensitivity({ lp, solution, feeds: FEEDS, objective: 'cost' }).reducedCosts.map(r => 'x_' + r.feedId);
    usedVars.forEach(u => expect(rcVars).not.toContain(u));
  });

  it('giriş eşiği (TL/ton) = reducedCost × 1000 × DM-fraksiyonu', async () => {
    const { lp, solution } = await solved({ nel_mcal: 28, mp_g: 1400, ndf_pct: { min: 28, max: 40 } });
    const s = computeSensitivity({ lp, solution, feeds: FEEDS, objective: 'cost' });
    expect(s.reducedCosts.length).toBeGreaterThan(0);          // corn kullanılmıyor → listede
    s.reducedCosts.forEach(r => {
      const feed = FEEDS.find(f => f.id === r.feedId);
      expect(r.priceToEnter).toBeCloseTo(r.reducedCost * 1000 * (feed.dm / 100), 3);
    });
  });

  it('guard: çok-amaçlı → applicable false (multi_objective)', async () => {
    const { lp, solution } = await solved({ nel_mcal: 28, mp_g: 1400 });
    const s = computeSensitivity({ lp, solution, feeds: FEEDS, objective: 'cost', objectives: [{ type: 'cost', weight: 1 }, { type: 'mfd_risk', weight: 1 }] });
    expect(s.applicable).toBe(false);
    expect(s.reason).toBe('multi_objective');
  });

  it('guard: gevşetilmiş (soft) çözüm → applicable false (not_optimal)', async () => {
    const { lp, solution } = await solved({ nel_mcal: 28, mp_g: 1400 });
    const s = computeSensitivity({ lp, solution, feeds: FEEDS, objective: 'cost', relaxApplied: true });
    expect(s.applicable).toBe(false);
    expect(s.reason).toBe('not_optimal');
  });

  it('guard: MILP (binaries/generals) → applicable false (milp)', async () => {
    const { lp, solution } = await solved({ nel_mcal: 28, mp_g: 1400 });
    const milpLp = { ...lp, binaries: ['x_corn'] };
    const s = computeSensitivity({ lp: milpLp, solution, feeds: FEEDS, objective: 'cost' });
    expect(s.applicable).toBe(false);
    expect(s.reason).toBe('milp');
  });

  it('guard: optimal değil → applicable false', async () => {
    const s = computeSensitivity({ lp: { subjectTo: [], objective: { vars: [] }, _meta: {} }, solution: { optimal: false }, feeds: FEEDS, objective: 'cost' });
    expect(s.applicable).toBe(false);
  });
});
