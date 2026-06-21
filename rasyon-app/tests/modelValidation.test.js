/**
 * FAZ 19.3 — Model Validasyon Metrikleri (RMSE/bias/MAE/R²) birim testleri.
 * Modül: src/core/validation.js (form validasyonu olan ui/validation.js'ten AYRI).
 * Saf istatistik + KMT tahmin-vs-gözlem çiftleri (calcDMI tabanlı).
 */
import { describe, it, expect } from 'vitest';
import {
  rmse, meanBias, mae, rSquared, validatePairs,
  buildDmiPairs, validateDmiForProfile, validateDmiAcrossProfiles,
  VALIDATION_MIN_SAMPLES,
} from '../src/core/validation.js';

describe('FAZ 19.3 — temel metrikler', () => {
  const pairs = [
    { predicted: 10, observed: 12 },
    { predicted: 14, observed: 11 },
    { predicted: 9,  observed: 10 },
  ];

  it('RMSE = √(ortalama kare hata)', () => {
    // hatalar: -2, 3, -1 → kare 4,9,1 → ort 14/3 → √
    expect(rmse(pairs)).toBeCloseTo(Math.sqrt(14 / 3), 6);
  });

  it('meanBias = ortalama(tahmin − gözlem), işaretli', () => {
    expect(meanBias(pairs)).toBeCloseTo(0, 6);  // (-2+3-1)/3 = 0
    expect(meanBias([{ predicted: 12, observed: 10 }])).toBeCloseTo(2, 6);   // fazla tahmin (+)
    expect(meanBias([{ predicted: 8, observed: 10 }])).toBeCloseTo(-2, 6);   // eksik tahmin (−)
  });

  it('MAE = ortalama mutlak hata', () => {
    expect(mae(pairs)).toBeCloseTo(2, 6);  // (2+3+1)/3
  });

  it('R² = 1 mükemmel tahminde', () => {
    const perfect = [{ predicted: 10, observed: 10 }, { predicted: 12, observed: 12 }, { predicted: 14, observed: 14 }];
    expect(rSquared(perfect)).toBeCloseTo(1, 6);
    expect(rmse(perfect)).toBeCloseTo(0, 6);
  });

  it('R²: kısmi takip → 0-1 arası', () => {
    const p = [{ predicted: 10, observed: 11 }, { predicted: 12, observed: 11 }, { predicted: 14, observed: 15 }];
    const r2 = rSquared(p);
    expect(r2).toBeGreaterThan(0);
    expect(r2).toBeLessThan(1);
  });

  it('Kenar durumlar: boş / tek çift / sabit gözlem', () => {
    expect(rmse([])).toBeNull();
    expect(meanBias(null)).toBeNull();
    expect(rSquared([{ predicted: 1, observed: 1 }])).toBeNull();       // < 2 çift
    expect(rSquared([{ predicted: 1, observed: 5 }, { predicted: 2, observed: 5 }])).toBeNull();  // gözlem sabit → tanımsız
  });

  it('Geçersiz değerler süzülür (NaN/eksik)', () => {
    const mixed = [{ predicted: 10, observed: 12 }, { predicted: NaN, observed: 5 }, { predicted: 8, observed: null }];
    expect(rmse(mixed)).toBeCloseTo(2, 6);  // yalnız ilk çift geçerli → |10−12|=2
  });
});

describe('FAZ 19.3 — validatePairs (özet)', () => {
  it('Tüm alanları döndürür + sufficient bayrağı', () => {
    const v = validatePairs([
      { predicted: 20, observed: 21 }, { predicted: 22, observed: 20 }, { predicted: 19, observed: 19 },
    ]);
    expect(v.n).toBe(3);
    expect(Number.isFinite(v.rmse)).toBe(true);
    expect(Number.isFinite(v.bias)).toBe(true);
    expect(Number.isFinite(v.mae)).toBe(true);
    expect(v.sufficient).toBe(true);            // n ≥ VALIDATION_MIN_SAMPLES (3)
    expect(v.cvRmse).toBeGreaterThan(0);        // RMSE % gözlem ortalaması
    expect(v.meanObserved).toBeCloseTo(20, 6);
  });

  it('Yetersiz örnek → sufficient=false', () => {
    const v = validatePairs([{ predicted: 20, observed: 21 }, { predicted: 22, observed: 20 }]);
    expect(v.n).toBe(2);
    expect(v.sufficient).toBe(false);           // 2 < 3
  });

  it('Boş → n=0, metrikler null', () => {
    const v = validatePairs([]);
    expect(v).toMatchObject({ n: 0, rmse: null, bias: null, r2: null, sufficient: false });
  });
});

describe('FAZ 19.3 — KMT tahmin-vs-gözlem (calcDMI tabanlı)', () => {
  const profile = { bw: 600, milkYield: 30, dim: 100, parity: 2, bcs: 3, milkFat: 3.7, milkProtein: 3.2 };
  const observations = [
    { date: '2026-06-01', dmiActual: 22.5 },
    { date: '2026-06-08', dmiActual: 23.1 },
    { date: '2026-06-15', dmiActual: 21.8 },
    { date: '2026-06-22', dmiActual: 24.0 },
  ];

  it("buildDmiPairs: sabit tahmin + her gözlemin dmiActual'i", () => {
    const pairs = buildDmiPairs(observations, profile);
    expect(pairs).toHaveLength(4);
    expect(new Set(pairs.map(p => p.predicted)).size).toBe(1);  // profil-bazlı sabit tahmin
    expect(pairs[0].predicted).toBeGreaterThan(0);
    expect(pairs.map(p => p.observed)).toEqual([22.5, 23.1, 21.8, 24.0]);
  });

  it('buildDmiPairs: dmiActual eksik gözlemler atlanır', () => {
    const obs = [{ dmiActual: 22 }, { milkYield: 30 }, { dmiActual: 23 }];
    expect(buildDmiPairs(obs, profile)).toHaveLength(2);
  });

  it('validateDmiForProfile: RMSE/bias/MAE anlamlı, sufficient', () => {
    const v = validateDmiForProfile(observations, profile);
    expect(v.n).toBe(4);
    expect(v.sufficient).toBe(true);
    expect(Number.isFinite(v.rmse)).toBe(true);
    expect(Number.isFinite(v.bias)).toBe(true);
  });

  it('validateDmiAcrossProfiles: değişken tahminler → anlamlı R²', () => {
    const entries = [
      { profile: { bw: 550, milkYield: 20, dim: 150, parity: 1, bcs: 3.2, milkFat: 3.8, milkProtein: 3.2 }, observations: [{ dmiActual: 18 }, { dmiActual: 18.5 }] },
      { profile: { bw: 620, milkYield: 35, dim: 80,  parity: 3, bcs: 2.9, milkFat: 3.6, milkProtein: 3.1 }, observations: [{ dmiActual: 24 }] },
      { profile: { bw: 600, milkYield: 45, dim: 60,  parity: 2, bcs: 2.8, milkFat: 3.5, milkProtein: 3.0 }, observations: [{ dmiActual: 27 }, { dmiActual: 26 }] },
    ];
    const v = validateDmiAcrossProfiles(entries);
    expect(v.profiles).toBe(3);
    expect(v.n).toBe(3);
    expect(v.r2).not.toBeNull();   // değişken tahmin → R² tanımlı
    expect(Number.isFinite(v.rmse)).toBe(true);
  });

  it('VALIDATION_MIN_SAMPLES makul (≥3)', () => {
    expect(VALIDATION_MIN_SAMPLES).toBeGreaterThanOrEqual(3);
  });
});

import { buildPredictionPairs, validatePredictionForProfile } from '../src/core/validation.js';

describe('FAZ 25.1 — Genel Tahmin Validasyonu (Metan, pH vb.)', () => {
  const obs = [
    { methane: 450, rumenPh: 6.2 },
    { methane: 460, rumenPh: 6.1 },
    { methane: 440, rumenPh: 6.3 },
    { methane: null, rumenPh: NaN }
  ];

  it('buildPredictionPairs geçerli gözlem-tahmin çiftlerini çıkarır', () => {
    const methanePairs = buildPredictionPairs(obs, 445, 'methane');
    expect(methanePairs).toHaveLength(3);
    expect(methanePairs[0]).toEqual({ predicted: 445, observed: 450 });
  });

  it('Geçersiz tahmin değerinde boş döner', () => {
    expect(buildPredictionPairs(obs, NaN, 'methane')).toHaveLength(0);
    expect(buildPredictionPairs(obs, null, 'methane')).toHaveLength(0);
  });

  it('Gözlemde ilgili alan yoksa atlar', () => {
    const phPairs = buildPredictionPairs([{ methane: 400 }], 6.2, 'rumenPh');
    expect(phPairs).toHaveLength(0);
  });

  it('validatePredictionForProfile doğru metrikleri hesaplar', () => {
    // 3 örnek: 450, 460, 440. Tahmin: 450.
    // Hatalar: 0, -10, +10.
    // RMSE: √((0 + 100 + 100)/3) = √(200/3) ≈ 8.16
    // Bias: (0 - 10 + 10)/3 = 0
    const val = validatePredictionForProfile(obs, 450, 'methane');
    expect(val.n).toBe(3);
    expect(val.sufficient).toBe(true);
    expect(val.bias).toBeCloseTo(0);
    expect(val.rmse).toBeGreaterThan(0);
  });
});

