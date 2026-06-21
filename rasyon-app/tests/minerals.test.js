import { describe, it, expect } from 'vitest';
import {
  calcCalcium, calcPhosphorus, calcMagnesium, calcSodium,
  calcPotassium, calcTraceMinerals, calcDCAD,
} from '../src/core/minerals.js';
import { DCAD_REFERENCE_CASES, MINERAL_REFERENCE } from './referenceAnimals.js';

const TOLERANCE = 0.02;

function withinTolerance(actual, expected, tol = TOLERANCE) {
  if (expected === 0) return actual < 0.01;
  return Math.abs(actual - expected) / expected <= tol;
}

describe('Kalsiyum Gereksinimleri', () => {
  it('Ca absorbed idame: 0.031 × 600^0.75 ≈ 3.758 g/gün ±%2', () => {
    const result = calcCalcium(600, 40);
    expect(withinTolerance(result.maintenance, 3.758)).toBe(true);
  });

  it('Ca laktasyon absorbed: 40 × 1.22 = 48.8 g/gün ±%2', () => {
    const result = calcCalcium(600, 40);
    expect(withinTolerance(result.lactation, 48.8)).toBe(true);
  });

  it('Ca diyet gereksinimi (parity 2+): absorbed / 0.38', () => {
    const result = calcCalcium(600, 40, 1.22, false, 0, 2);
    const expectedDietary = (3.758 + 48.8) / 0.38;
    expect(withinTolerance(result.dietary, expectedDietary)).toBe(true);
  });

  it('Yüksek verimli inek daha fazla Ca gerektirir', () => {
    const high = calcCalcium(600, 45);
    const low = calcCalcium(600, 20);
    expect(high.dietary).toBeGreaterThan(low.dietary);
  });

  it('Total absorbed Ca > idame Ca (laktasyondaki inek)', () => {
    const result = calcCalcium(600, 35);
    expect(result.totalAbsorbed).toBeGreaterThan(result.maintenance);
  });

  it('FAZ 13.7: primipar (parite 1) emilimi 0.45 (eski hatalı 0.50 değil)', () => {
    const primi = calcCalcium(600, 40, 1.22, false, 0, 1);
    expect(primi.absorption).toBe(0.45);
    const expectedDietary = (3.758 + 48.8) / 0.45;
    expect(withinTolerance(primi.dietary, expectedDietary)).toBe(true);
  });

  it('FAZ 13.7: kuru dönem (isDry) emilimi 0.32', () => {
    const dry = calcCalcium(600, 0, 1.22, true, 270, 3, { isDry: true });
    expect(dry.absorption).toBe(0.32);
  });

  it('FAZ 13.7: emilim NRC 2001 ve NASEM 2021 absorbed-basis aynı', () => {
    const nrc = calcCalcium(600, 40, 1.22, false, 0, 2, { system: 'NRC2001' });
    const nasem = calcCalcium(600, 40, 1.22, false, 0, 2, { system: 'NASEM2021' });
    expect(nrc.absorption).toBe(nasem.absorption);
    expect(nrc.absorption).toBe(0.38);
  });
});

describe('Fosfor Gereksinimleri', () => {
  it('FAZ 13.7: P idame DMI-bazlı = 1.0 g/kg KM → 24 kg KMT için 24 g/gün', () => {
    const result = calcPhosphorus(24, 40);
    expect(withinTolerance(result.maintenance, 24.0)).toBe(true);
  });

  it('P laktasyon ≈ milkYield × 0.90', () => {
    const result = calcPhosphorus(24, 30);
    expect(withinTolerance(result.lactation, 27.0)).toBe(true);
  });

  it('FAZ 13.7: NRC 2001 ve NASEM 2021 P idamesi aynı (1.0 g/kg KM)', () => {
    const nrc = calcPhosphorus(24, 40, 0.90, 'NRC2001');
    const nasem = calcPhosphorus(24, 40, 0.90, 'NASEM2021');
    expect(nrc.maintenance).toBe(nasem.maintenance);
    expect(nrc.maintenance).toBe(24.0);
  });
});

describe('Magnezyum Gereksinimleri', () => {
  it('600 kg inek Mg idame ≈ 1.8 g/gün (default NASEM 2021: 0.003)', () => {
    const result = calcMagnesium(600, 35);
    expect(withinTolerance(result.maintenance, 1.8)).toBe(true);
  });

  it('FAZ 13.7: NRC 2001 modu Mg idame = 0.0048 × BW → 2.88 g/gün', () => {
    const nrc = calcMagnesium(600, 35, 0.12, null, 'NRC2001');
    expect(withinTolerance(nrc.maintenance, 2.88)).toBe(true);
    // NASEM (default) NRC'den düşük
    const nasem = calcMagnesium(600, 35, 0.12, null, 'NASEM2021');
    expect(nasem.maintenance).toBeLessThan(nrc.maintenance);
  });
});

describe('Sodyum Gereksinimleri', () => {
  it('600 kg inek Na idame ≈ 7.2 g/gün', () => {
    const result = calcSodium(600, 35);
    expect(withinTolerance(result.maintenance, 7.2)).toBe(true);
  });
});

describe('İz Mineraller', () => {
  it('20 kg KMT için Zn minimumu 800 mg/gün', () => {
    const trace = calcTraceMinerals(20);
    expect(trace.zn.minMgDay).toBe(800);
  });

  it('Tüm iz mineraller için min < max', () => {
    const trace = calcTraceMinerals(22);
    Object.values(trace).forEach(mineral => {
      expect(mineral.minMgDay).toBeLessThan(mineral.maxMgDay);
    });
  });
});

describe('DCAD Hesabı', () => {
  it('Laktasyon rasyonu DCAD referans değer ±1 mEq/100g KM', () => {
    const ref = DCAD_REFERENCE_CASES[0];
    const result = calcDCAD(ref.input.na_pct_dm, ref.input.k_pct_dm, ref.input.cl_pct_dm, ref.input.s_pct_dm);
    expect(Math.abs(result.dcad - ref.expected.dcad)).toBeLessThan(1.5);
  });

  it('Geçiş dönemi DCAD negatif olmalı', () => {
    const ref = DCAD_REFERENCE_CASES[1];
    const result = calcDCAD(ref.input.na_pct_dm, ref.input.k_pct_dm, ref.input.cl_pct_dm, ref.input.s_pct_dm);
    expect(result.dcad).toBeLessThan(0);
  });

  it('Laktasyon optimal yorumu: Na0.22 K1.50 Cl0.25 S0.20 → ~28.5 mEq/100g KM', () => {
    // [(0.22/23 + 1.50/39) - (0.25/35.5 + 0.20/16)] × 1000 = 28.48
    const result = calcDCAD(0.22, 1.50, 0.25, 0.20);
    expect(result.interpretation).toBe('lactation_optimal');
    expect(result.dcad).toBeGreaterThan(25);
    expect(result.dcad).toBeLessThan(40);
  });
});

describe('FAZ 10E — Isı stresinde dinamik mineraller', () => {
  it('calcPotassium THI > 78 → %1.5 KM hedefi', () => {
    const normal = calcPotassium(23, 35, 1.43, 65);
    const hot = calcPotassium(23, 35, 1.43, 82);
    expect(hot.minPctDM).toBe(1.5);
    expect(hot.total).toBeGreaterThan(normal.total);
    expect(hot.heatAdjusted).toBe(true);
    expect(normal.heatAdjusted).toBe(false);
  });

  it('calcPotassium THI 72-78 → %1.2 KM (orta artırım)', () => {
    const r = calcPotassium(23, 35, 1.43, 75);
    expect(r.minPctDM).toBe(1.2);
    expect(r.heatAdjusted).toBe(true);
  });

  it('calcSodium ısı stresinde terleme kaybı eklenir', () => {
    const normal = calcSodium(600, 35, 65);
    const hot = calcSodium(600, 35, 82);
    expect(hot.sweatLoss).toBeGreaterThan(0);
    expect(hot.total).toBeGreaterThan(normal.total);
  });

  it('calcMagnesium ısı stresinde +%20 bonus', () => {
    const normal = calcMagnesium(600, 35, 0.12, 65);
    const hot = calcMagnesium(600, 35, 0.12, 82);
    expect(hot.heatBonus).toBeGreaterThan(0);
    expect(hot.total).toBeGreaterThan(normal.total * 1.15);
  });

  it('Isı stresi yoksa heatAdjusted=false', () => {
    expect(calcPotassium(23, 35).heatAdjusted).toBe(false);
    expect(calcSodium(600, 35).heatAdjusted).toBe(false);
    expect(calcMagnesium(600, 35).heatAdjusted).toBe(false);
  });
});
