/**
 * rumenHealth.js — Rumen sağlık skoru ve SARA risk testleri
 */
import { describe, it, expect } from 'vitest';
import {
  calcPeNDF, calcNFC, calcForageRatio,
  estimateRumenPH, assessRumenHealth,
} from '../src/core/rumenHealth.js';

describe('calcPeNDF', () => {
  it('NDF × pef hesabı', () => {
    expect(calcPeNDF(40, 1.0)).toBe(40);
    expect(calcPeNDF(40, 0.5)).toBe(20);
    expect(calcPeNDF(40, 0)).toBe(0);
  });
});

describe('calcNFC', () => {
  it('NFC = 100 − (CP + Yağ + Kül + NDF)', () => {
    // CP=16, Fat=4, Ash=7, NDF=33 → NFC = 100-60 = 40
    expect(calcNFC(16, 4, 7, 33)).toBe(40);
  });
});

describe('calcForageRatio', () => {
  it('Tipik karışım %50 kaba yem', () => {
    expect(calcForageRatio(11, 22)).toBe(50);
  });
  it('Sıfır toplam → 0', () => {
    expect(calcForageRatio(5, 0)).toBe(0);
  });
});

describe('estimateRumenPH', () => {
  it('Yüksek NFC + düşük peNDF → düşük pH (SARA riski)', () => {
    const r = estimateRumenPH({ nfcPct: 45, peNDFPct: 15, forageRatio: 30 });
    expect(r.estimatedPH).toBeLessThan(6.2);
    expect(['moderate', 'high']).toContain(r.saraRisk);
  });

  it('Dengeli rasyon → güvenli pH', () => {
    const r = estimateRumenPH({ nfcPct: 35, peNDFPct: 25, forageRatio: 50 });
    expect(r.estimatedPH).toBeGreaterThan(6.2);
    expect(r.saraRisk).toBe('low');
  });

  it('pH 5.5-7.0 aralığında clamp edilir', () => {
    const r1 = estimateRumenPH({ nfcPct: 80, peNDFPct: 0, forageRatio: 0 });
    expect(r1.estimatedPH).toBeGreaterThanOrEqual(5.5);
    const r2 = estimateRumenPH({ nfcPct: 0, peNDFPct: 50, forageRatio: 100 });
    expect(r2.estimatedPH).toBeLessThanOrEqual(7.0);
  });
});

describe('assessRumenHealth', () => {
  it('İyi rasyon → A notu, SARA düşük', () => {
    const r = assessRumenHealth({
      ndfPct: 32, peNDFPct: 25, nfcPct: 38, forageRatio: 55,
      milkFatPct: 3.8, milkProteinPct: 3.1,
    });
    expect(['A', 'B']).toContain(r.grade);
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.saraRisk).toBe('low');
  });

  it('Yüksek konsantre + düşük peNDF → düşük not + uyarılar', () => {
    const r = assessRumenHealth({
      ndfPct: 22, peNDFPct: 14, nfcPct: 48, forageRatio: 25,
      milkFatPct: 2.8, milkProteinPct: 3.2,
    });
    expect(['C', 'D']).toContain(r.grade);
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
    expect(r.score).toBeLessThan(60);
  });

  it('Süt yağı/protein < 1.0 → yağ depresyonu uyarısı', () => {
    const r = assessRumenHealth({
      ndfPct: 30, peNDFPct: 23, nfcPct: 40, forageRatio: 50,
      milkFatPct: 2.9, milkProteinPct: 3.2,  // ratio 0.91 < 1.0
    });
    expect(r.warnings.some(w => w.type === 'MilkFatDepression')).toBe(true);
  });

  it('PROBLEMLER #1: Süt yağı/protein > 1.5 → ketozis / NEB uyarısı (üst taraf)', () => {
    const r = assessRumenHealth({
      ndfPct: 32, peNDFPct: 25, nfcPct: 38, forageRatio: 55,
      milkFatPct: 5.0, milkProteinPct: 3.0,  // ratio 1.67 > 1.5 (ketoHigh)
    });
    expect(r.warnings.some(w => w.type === 'Ketosis' && w.severity === 'high')).toBe(true);
    // Ketozis SARA değildir → MilkFatDepression eklenmez
    expect(r.warnings.some(w => w.type === 'MilkFatDepression')).toBe(false);
  });

  it('PROBLEMLER #1: ırka göre F:P bandı — Jersey üst eşiği daha yüksek', () => {
    const base = { ndfPct: 32, peNDFPct: 25, nfcPct: 38, forageRatio: 55, milkFatPct: 4.4, milkProteinPct: 3.1 }; // ratio ≈ 1.42
    const holstein = assessRumenHealth({ ...base, breed: 'Holstein' });
    const jersey   = assessRumenHealth({ ...base, breed: 'Jersey' });
    expect(holstein.warnings.some(w => w.type === 'Ketosis')).toBe(true);   // 1.42 > 1.40 (Holstein ketoMed)
    expect(jersey.warnings.some(w => w.type === 'Ketosis')).toBe(false);    // 1.42 < 1.45 (Jersey ketoMed)
  });

  it('Skor 0-100 aralığında kalır', () => {
    const r = assessRumenHealth({
      ndfPct: 10, peNDFPct: 5, nfcPct: 60, forageRatio: 10,
      milkFatPct: 2.0, milkProteinPct: 3.5,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('#13: yüksek-şiddet asidoz uyarısı varsa SARA "low" KALMAZ (skor ile tutarlı)', () => {
    // pH-modeli tek başına ≥6.2 ("low") verir; ama NDF<25 yüksek-şiddet uyarısı var →
    // SARA riski en az o şiddete yükseltilir (düşük skor + "SARA yok" çelişkisi olmasın).
    const r = assessRumenHealth({
      ndfPct: 24, peNDFPct: 23, nfcPct: 40, forageRatio: 50,
      milkFatPct: 3.6, milkProteinPct: 3.1,
    });
    expect(r.warnings.some(w => w.severity === 'high')).toBe(true);  // NDF<25
    expect(r.saraRisk).not.toBe('low');                              // tutarlılık sağlandı
    expect(r.saraRiskByPH).toBe('low');                             // pH-modeli referansı ayrı
  });

  it('#13: tamamen dengeli rasyonda SARA "low" kalır (yükseltme yapılmaz)', () => {
    const r = assessRumenHealth({
      ndfPct: 32, peNDFPct: 25, nfcPct: 38, forageRatio: 55,
      milkFatPct: 3.8, milkProteinPct: 3.1,
    });
    expect(r.saraRisk).toBe('low');
  });
});

describe('NEL idame ısı stresi düzeltmesi (entegrasyon)', () => {
  it('THI > 72 olunca calcNELRequirements maintenance artar', async () => {
    const { calcNELRequirements } = await import('../src/core/nrc2001.js');
    const base = {
      bw: 650, milkYield: 30, milkFat: 3.5, milkProtein: 3.1,
      parity: 2, dim: 90, bcs: 3.0,
    };
    const normal = calcNELRequirements({ ...base, thi: 65 });
    const hot    = calcNELRequirements({ ...base, thi: 80 });
    expect(hot.maintenance).toBeGreaterThan(normal.maintenance);
    expect(hot.heatAdjusted).toBe(true);
    expect(normal.heatAdjusted).toBe(false);
  });
});
