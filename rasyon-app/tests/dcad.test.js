/**
 * dcad.js — DCAD ve idrar pH testleri
 */
import { describe, it, expect } from 'vitest';
import {
  calcDCAD, estimateUrinePH, interpretMeasuredUrinePH,
  interpretDCAD, milkFeverRisk, recommendAnionicSalts
} from '../src/core/dcad.js';

describe('calcDCAD', () => {
  it('Tipik laktasyon rasyonu: pozitif DCAD', () => {
    // Na=0.3, K=1.5, Cl=0.4, S=0.25 → pozitif
    const dcad = calcDCAD({ na_pct: 0.3, k_pct: 1.5, cl_pct: 0.4, s_pct: 0.25 });
    expect(dcad).toBeGreaterThan(0);
  });

  it('Anyonik rasyon: negatif DCAD', () => {
    // Yüksek Cl ve S → negatif
    const dcad = calcDCAD({ na_pct: 0.1, k_pct: 0.8, cl_pct: 1.2, s_pct: 0.4 });
    expect(dcad).toBeLessThan(0);
  });
});

describe('estimateUrinePH (DCAD tabanlı tahmin)', () => {
  it('DCAD pozitif → pH yüksek (alkalin)', () => {
    const r = estimateUrinePH(30);
    expect(r.estimatedPH).toBeGreaterThan(7);
  });
  it('DCAD negatif → pH düşük (asidik)', () => {
    const r = estimateUrinePH(-10);
    expect(r.estimatedPH).toBeLessThan(7);
  });
  it('Çok düşük DCAD (clamp aralığında) → çok asidik uyarısı', () => {
    // pH = 7.2 + (-60 × 0.025) = 5.7 → < 6.2 → too_acidic_risk
    const r = estimateUrinePH(-60);
    expect(r.status).toBe('too_acidic_risk');
  });
});

describe('interpretMeasuredUrinePH — saha ölçümü değerlendirmesi', () => {
  it('Close-up, pH 6.2 → hedef aralıkta', () => {
    const r = interpretMeasuredUrinePH(6.2, 'transition');
    expect(r.status).toBe('target_met');
    expect(r.severity).toBe('none');
    expect(r.caAbsorptionImpact).toBe('enhanced');
  });

  it('Close-up, pH 7.0 → yetersiz asidifikasyon', () => {
    const r = interpretMeasuredUrinePH(7.0, 'transition');
    expect(r.status).toBe('insufficient_acidification');
    expect(r.severity).toBe('medium');
  });

  it('Close-up, pH 8.0 → asidogenez yok, yüksek risk', () => {
    const r = interpretMeasuredUrinePH(8.0, 'transition');
    expect(r.status).toBe('no_acidification');
    expect(r.severity).toBe('high');
  });

  it('Close-up, pH 5.0 → aşırı asidoz', () => {
    const r = interpretMeasuredUrinePH(5.0, 'transition');
    expect(r.status).toBe('over_acidification');
    expect(r.severity).toBe('high');
    expect(r.caAbsorptionImpact).toBe('reduced');
  });

  it('Jersey ineği, pH 5.7 → Jersey hedef aralığında', () => {
    const r = interpretMeasuredUrinePH(5.7, 'transition', 'jersey');
    expect(r.status).toBe('target_met');
  });

  it('Laktasyon dönemi, pH 8.2 → normal', () => {
    const r = interpretMeasuredUrinePH(8.2, 'lactation');
    expect(r.status).toBe('normal');
    expect(r.severity).toBe('none');
  });
});

describe('milkFeverRisk', () => {
  it('Optimal DCAD + düşük Ca + genç → düşük risk', () => {
    const r = milkFeverRisk(-10, 0.4, 2);
    expect(['low', 'moderate']).toContain(r.riskLevel);
  });

  it('Pozitif DCAD + yüksek Ca + yaşlı → yüksek risk', () => {
    const r = milkFeverRisk(20, 0.8, 4);
    expect(['high', 'very_high']).toContain(r.riskLevel);
  });
});

describe('recommendAnionicSalts', () => {
  it('Mevcut DCAD hedefte veya hedeften düşükse null döner', () => {
    expect(recommendAnionicSalts(-15, -10, 12)).toBeNull();
    expect(recommendAnionicSalts(-10, -10, 12)).toBeNull();
  });

  it('DCAD yüksekse (pozitiften negatife iniş) doğru gramajları hesaplar', () => {
    // current = +10, target = -10, DMI = 12 kg
    // delta = 20 mEq/100g. Toplam mEq = 20 * 12 * 10 = 2400 mEq
    // 2400 / 18.0 (CaCl2) = ~133 g
    // 2400 / 16.6 (MgSO4) = ~145 g
    const rec = recommendAnionicSalts(10, -10, 12);
    expect(rec).not.toBeNull();
    expect(rec.deltaDCAD).toBe(20);
    expect(rec.totalMEq).toBe(2400);
    expect(rec.cacl2Only_g).toBe(133); // 2400 / 18.0 = 133.33 -> 133
    expect(rec.mgso4Only_g).toBe(145); // 2400 / 16.6 = 144.57 -> 145
    expect(rec.mixed.cacl2_g).toBe(67); // 1200 / 18.0 = 66.66 -> 67
    expect(rec.mixed.mgso4_g).toBe(72); // 1200 / 16.6 = 72.28 -> 72
  });
});
