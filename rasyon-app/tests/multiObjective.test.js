/**
 * multiObjective.test.js — Çok amaçlı optimizasyon (FAZ 14.12)
 *
 * weighted-sum scalarization: objectives=[{type, weight}] → normalize edilmiş
 * ağırlıklı toplam. Lineer proxy'ler: cost / minDM / mfd_risk / aa_balance.
 */

import { describe, it, expect } from 'vitest';
import { buildRationLP } from '../src/solver/lpBuilder.js';
import { solveLP } from '../src/solver/glpkSolver.js';

const FEEDS = [
  { id: 'silage', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, rup: 15, rdp: 85, ndf: 44, adf: 27,
    nfc: 36, starch: 26, sugar: 1.5, fat: 3.3, ca: 0.24, p: 0.22, na: 0.01, s: 0.11, cl: 0.09, lys: 4.5, met: 1.5, pricePerTon: 2500 },
  { id: 'beetpulp', category: 'byproduct', dm: 88, nel: 1.8, cp: 10, rup: 30, rdp: 70, ndf: 40, adf: 23,
    nfc: 45, starch: 1, sugar: 18, fat: 0.8, ca: 0.7, p: 0.1, na: 0.2, s: 0.2, cl: 0.1, lys: 5, met: 1.4, pricePerTon: 6000 },
  { id: 'grain', category: 'grain', dm: 88, nel: 2.0, cp: 9, rup: 50, rdp: 50, ndf: 10, adf: 3,
    nfc: 74, starch: 65, sugar: 2, fat: 4, ca: 0.02, p: 0.28, na: 0.01, s: 0.10, cl: 0.05, lys: 2.8, met: 2.0, pricePerTon: 4000 },
  { id: 'soy', category: 'protein', dm: 89, nel: 1.99, cp: 48, rup: 35, rdp: 65, ndf: 10, adf: 5,
    nfc: 28, starch: 1, sugar: 8, fat: 1.5, ca: 0.33, p: 0.70, na: 0.02, s: 0.45, cl: 0.04, lys: 6.3, met: 1.4, pricePerTon: 18000 },
];

const base = { feeds: FEEDS, dmi_kg: 20, requirements: { nel_mcal: 32 }, feedLimits: { silage: { minPct: 20 } } };

describe('FAZ 14.12 — multi-objective yapı', () => {
  it('objectives verilmezse tek amaç (geriye uyumlu): objective.name=totalCost', () => {
    const lp = buildRationLP({ ...base, objective: 'cost' });
    expect(lp.objective.name).toBe('totalCost');
    // cost coef = (price/1000)/dmFraction → silage 2500/1000/0.33 ≈ 7.58
    expect(lp.objective.vars[0].coef).toBeCloseTo(7.58, 1);
  });

  it('objectives verilince objective.name=multiObjective', () => {
    const lp = buildRationLP({ ...base, objectives: [{ type: 'cost', weight: 1 }] });
    expect(lp.objective.name).toBe('multiObjective');
  });

  it('normalize: tek amaç (cost) weighted sum katsayilari [-1,1] olceginde', () => {
    const lp = buildRationLP({ ...base, objectives: [{ type: 'cost', weight: 1 }] });
    // En pahalı yem (soya) normalize sonrası coef = 1 (max), diğerleri < 1
    const coefs = lp.objective.vars.map(v => v.coef);
    expect(Math.max(...coefs)).toBeCloseTo(1, 6);
    expect(Math.min(...coefs)).toBeGreaterThanOrEqual(0);
  });

  it('mfd_risk: yüksek-şeker yem (beetpulp) pozitif (riskli) coef alır', () => {
    const lp = buildRationLP({ ...base, objectives: [{ type: 'mfd_risk', weight: 1 }] });
    const beetIdx = FEEDS.findIndex(f => f.id === 'beetpulp');
    const silageIdx = FEEDS.findIndex(f => f.id === 'silage');
    // beetpulp (sugar 18, peNDF düşük) silage'dan (peNDF yüksek) daha riskli (yüksek coef)
    expect(lp.objective.vars[beetIdx].coef).toBeGreaterThan(lp.objective.vars[silageIdx].coef);
  });

  it('aa_balance: AA maksimize (negatif coef) — yüksek-AA yem en negatif', () => {
    const lp = buildRationLP({ ...base, objectives: [{ type: 'aa_balance', weight: 1 }] });
    // soy (lys 6.3, met 1.4 + yüksek mp) negatif coef (AA tedariki maksimize edilir)
    const soyIdx = FEEDS.findIndex(f => f.id === 'soy');
    expect(lp.objective.vars[soyIdx].coef).toBeLessThan(0);
  });

  it('ağırlık sıfır olan amaç katkı vermez (cost weight 0)', () => {
    const lpZero = buildRationLP({ ...base, objectives: [{ type: 'cost', weight: 0 }, { type: 'minDM', weight: 1 }] });
    const lpMinDM = buildRationLP({ ...base, objectives: [{ type: 'minDM', weight: 1 }] });
    // cost weight 0 → sadece minDM kalır, coef'ler eşit
    lpZero.objective.vars.forEach((v, i) => {
      expect(v.coef).toBeCloseTo(lpMinDM.objective.vars[i].coef, 6);
    });
  });
});

describe('FAZ 14.12 — multi-objective gerçek çözüm (trade-off)', () => {
  it('cost-only → en ucuz yem (grain) baskın', async () => {
    const r = await solveLP(buildRationLP({ ...base, objectives: [{ type: 'cost', weight: 1 }] }));
    expect(r.optimal).toBe(true);
    // grain (4000 TL/ton, en ucuz enerji) yüksek katılım
    expect(r.vars.x_grain ?? 0).toBeGreaterThan(5);
  });

  it('cost + yüksek MFD ağırlığı → yüksek-şeker/nişasta azalır (MFD koruması)', async () => {
    const rCost = await solveLP(buildRationLP({ ...base, objectives: [{ type: 'cost', weight: 1 }] }));
    const rMfd  = await solveLP(buildRationLP({ ...base, objectives: [{ type: 'cost', weight: 1 }, { type: 'mfd_risk', weight: 5 }] }));
    expect(rMfd.optimal).toBe(true);
    // MFD ağırlığı ile grain (nişasta 65/PUFA) + beetpulp (şeker 18) toplamı azalmalı
    const riskyCost = (rCost.vars.x_grain ?? 0) + (rCost.vars.x_beetpulp ?? 0);
    const riskyMfd  = (rMfd.vars.x_grain ?? 0) + (rMfd.vars.x_beetpulp ?? 0);
    expect(riskyMfd).toBeLessThan(riskyCost + 1e-6);
  });
});
