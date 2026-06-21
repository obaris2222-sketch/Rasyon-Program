import { describe, it, expect } from 'vitest';
import { calcFCM, calcECM, dmiNRC2001, dmiDeSouza2019, calcDMI, adjustDMIForFill } from '../src/core/dmi.js';
import { NRC2001_REFERENCE_ANIMALS } from './referenceAnimals.js';

const TOLERANCE = 0.02; // ±%2

function withinTolerance(actual, expected, tol = TOLERANCE) {
  if (expected === 0) return actual < 0.01;
  return Math.abs(actual - expected) / expected <= tol;
}

describe('FCM (4% Yağ Düzeltmeli Süt)', () => {
  it('Referans hayvan 1: FCM doğru hesaplanmalı', () => {
    const animal = NRC2001_REFERENCE_ANIMALS[0].input;
    const fcm = calcFCM(animal.milkYield, animal.milkFat);
    expect(withinTolerance(fcm, NRC2001_REFERENCE_ANIMALS[0].expected.fcm4pct)).toBe(true);
  });

  it('FCM formülü: 0.4×MY + 15×MY×fat%', () => {
    // 30 kg süt, %3.6 yağ → 0.4×30 + 15×30×0.036 = 12 + 16.2 = 28.2
    expect(calcFCM(30, 3.6)).toBeCloseTo(28.2, 1);
  });

  it('Düşük yağlı süt FCM < gerçek süt miktarı olmalı', () => {
    expect(calcFCM(30, 2.5)).toBeLessThan(30);
  });

  it('Yüksek yağlı süt FCM > gerçek süt miktarı olmalı', () => {
    expect(calcFCM(30, 5.0)).toBeGreaterThan(30);
  });
});

describe('ECM (Enerjice Düzeltilmiş Süt)', () => {
  it('ECM formülü: MY × (0.327 + 0.1276×fat + 0.0978×prot)', () => {
    // 35 kg süt, %3.5 yağ, %3.1 prot → 35 × (0.327 + 0.1276×3.5 + 0.0978×3.1) = 35 × 1.0758 = 37.65
    const ecm = calcECM(35, 3.5, 3.1);
    expect(ecm).toBeCloseTo(37.65, 0);
  });

  it('Standart süt (3.5% yağ, 3.2% prot) ECM > FCM olmalı', () => {
    const ecm = calcECM(30, 3.5, 3.2);
    const fcm = calcFCM(30, 3.5);
    expect(ecm).toBeGreaterThan(fcm);
  });

  it('Düşük yağ+protein sütü ECM < gerçek süt olmalı', () => {
    expect(calcECM(30, 2.5, 2.5)).toBeLessThan(30);
  });
});

describe('NRC 2001 KMT Denklemi', () => {
  it('Referans hayvan 1 KMT ±%2 tolerans içinde', () => {
    const a = NRC2001_REFERENCE_ANIMALS[0];
    const fcm = calcFCM(a.input.milkYield, a.input.milkFat);
    const wol = a.input.dim / 7;
    const dmi = dmiNRC2001(fcm, a.input.bw, wol);
    expect(withinTolerance(dmi, a.expected.dmiNRC)).toBe(true);
  });

  it('Referans hayvan 2 KMT ±%2 tolerans içinde', () => {
    const a = NRC2001_REFERENCE_ANIMALS[1];
    const fcm = calcFCM(a.input.milkYield, a.input.milkFat);
    const wol = a.input.dim / 7;
    const dmi = dmiNRC2001(fcm, a.input.bw, wol);
    expect(withinTolerance(dmi, a.expected.dmiNRC)).toBe(true);
  });

  it('Erken laktasyonda (DIM=5) KMT baskılanmış olmalı', () => {
    const earlyDmi = dmiNRC2001(28, 600, 5 / 7);
    const midDmi = dmiNRC2001(28, 600, 60 / 7);
    expect(earlyDmi).toBeLessThan(midDmi);
  });

  it('Yüksek verimli inek daha fazla KMT tüketmeli', () => {
    const highYield = dmiNRC2001(calcFCM(45, 3.6), 650, 60 / 7);
    const lowYield = dmiNRC2001(calcFCM(20, 3.6), 550, 60 / 7);
    expect(highYield).toBeGreaterThan(lowYield);
  });
});

describe('de Souza 2019 KMT Denklemi', () => {
  it('Erken laktasyonda (DIM=14) DMI tahmini makul aralıkta (12-20 kg)', () => {
    const dmi = dmiDeSouza2019({
      milkYield: 35, milkFat: 3.6, milkProtein: 3.2,
      bw: 620, bcs: 2.8, dim: 14, parity: 2,
    });
    expect(dmi).toBeGreaterThan(12);
    expect(dmi).toBeLessThan(22);
  });

  it('Parity 2+ DIM < 30 erken laktasyonda DMI baskılanmış olmalı', () => {
    const base = {
      milkYield: 30, milkFat: 3.6, milkProtein: 3.2,
      bw: 580, bcs: 3.0, parity: 2,
    };
    const earlyDmi = dmiDeSouza2019({ ...base, dim: 7 });
    const midDmi = dmiDeSouza2019({ ...base, dim: 90 });
    expect(earlyDmi).toBeLessThan(midDmi);
  });
});

describe('calcDMI - Ana Fonksiyon', () => {
  const testAnimal = {
    milkYield: 35, milkFat: 3.7, milkProtein: 3.2,
    bw: 620, bcs: 3.0, dim: 60, parity: 2,
    thi: 55,
  };

  it('NRC2001 metodu çıktısı doğru yapıda (FCM + ECM dahil)', () => {
    const result = calcDMI(testAnimal, 'NRC2001');
    expect(result).toHaveProperty('dmi');
    expect(result).toHaveProperty('fcm');
    expect(result).toHaveProperty('ecm');
    expect(result).toHaveProperty('method', 'NRC2001');
    expect(result.heatAdjusted).toBe(false);
    expect(result.ecm).toBeGreaterThan(0);
  });

  it('THI > 72 olduğunda KMT azalmalı', () => {
    const normalDmi = calcDMI({ ...testAnimal, thi: 55 }).dmi;
    const hotDmi = calcDMI({ ...testAnimal, thi: 80 }).dmi;
    expect(hotDmi).toBeLessThan(normalDmi);
    expect(hotDmi).toBeGreaterThan(0);
  });
});

describe('FAZ 18.2 — adjustDMIForFill (NDF doluluk sınırı)', () => {
  it('düşük/orta NDF rasyonda KMT değişmez (fill bağlamaz)', () => {
    // 650 kg, kapasite 1.35% = 8.775 kg NDF. NDF %30 → fill-sınırı 29.3 kg > 22 → düzeltme yok
    expect(adjustDMIForFill(22, 30, 650)).toBe(22);
    expect(adjustDMIForFill(22, 38, 650)).toBe(22);   // 8.775/0.38 = 23.1 > 22 (tipik rasyon korunur)
  });

  it('yüksek NDF rasyonda KMT fill-sınırına düşer', () => {
    // NDF %50 → fill-sınırı = 8.775/0.50 = 17.55 < 22 → KMT 17.55'e iner
    expect(adjustDMIForFill(22, 50, 650)).toBeCloseTo(17.55, 2);
    // NDF arttıkça KMT monoton azalır
    expect(adjustDMIForFill(22, 55, 650)).toBeLessThan(adjustDMIForFill(22, 45, 650));
  });

  it('fill-sınırlı KMT = NDF_kapasite / NDF_fraksiyon (Mertens)', () => {
    // kapasite override: 1.1% × 600 = 6.6 kg; NDF %40 → 6.6/0.40 = 16.5
    expect(adjustDMIForFill(25, 40, 600, { ndfCapacityPct: 1.1 })).toBeCloseTo(16.5, 3);
  });

  it('geçersiz/eksik girdide KMT olduğu gibi döner (geriye uyumlu)', () => {
    expect(adjustDMIForFill(22, 0, 650)).toBe(22);     // NDF bilinmiyor
    expect(adjustDMIForFill(22, 35, 0)).toBe(22);      // BW yok
    expect(adjustDMIForFill(22, NaN, 650)).toBe(22);
    expect(adjustDMIForFill(0, 35, 650)).toBe(0);
  });
});
