/**
 * fattyAcids.js — yağ asidi profili ve süt yağ tahmini testleri
 */
import { describe, it, expect } from 'vitest';
import {
  estimateRationFA, estimateMilkFA, assessFAProfile, TYPICAL_FA_PROFILES,
} from '../src/core/fattyAcids.js';

const SAMPLE_FEEDS = [
  { id: 'silage', category: 'roughage', fat: 3.3 },
  { id: 'corn',   category: 'grain',    fat: 4.0 },
  { id: 'soy',    category: 'protein',  fat: 1.5 },
];

const SAMPLE_ITEMS = [
  { id: 'silage', dmKg: 10 },
  { id: 'corn',   dmKg: 8 },
  { id: 'soy',    dmKg: 4 },
];

describe('TYPICAL_FA_PROFILES', () => {
  it('Tüm kategoriler tanımlı', () => {
    ['grain', 'oilseed', 'roughage', 'protein', 'byproduct', 'fat', 'mineral']
      .forEach(cat => expect(TYPICAL_FA_PROFILES[cat]).toBeDefined());
  });
  it('Profiller toplam %100\'e yakın (mineral hariç)', () => {
    Object.entries(TYPICAL_FA_PROFILES).forEach(([cat, p]) => {
      if (cat === 'mineral') return;
      const sum = p.c16_0 + p.c18_0 + p.c18_1 + p.c18_2 + p.c18_3;
      expect(sum).toBeGreaterThan(85);  // diğer FA'ları dahil etmediği için 100 değil
      expect(sum).toBeLessThanOrEqual(100);
    });
  });
});

describe('estimateRationFA', () => {
  it('Toplam yağ ve FA dağılımı hesaplanır', () => {
    const fa = estimateRationFA(SAMPLE_ITEMS, SAMPLE_FEEDS);
    expect(fa.totalFat_g).toBeGreaterThan(0);
    expect(fa.c18_2_g).toBeGreaterThan(0);  // ω-6
    expect(fa.c18_3_g).toBeGreaterThan(0);  // ω-3
    expect(fa.sfa_g + fa.mufa_g + fa.pufa_g).toBeCloseTo(
      fa.c16_0_g + fa.c18_0_g + fa.c18_1_g + fa.c18_2_g + fa.c18_3_g, 1);
  });

  it('Roughage ağırlıklı rasyon → düşük n-6/n-3 oranı', () => {
    const fa = estimateRationFA([{ id: 'silage', dmKg: 20 }], [SAMPLE_FEEDS[0]]);
    // roughage profili: c18_2=18, c18_3=57 → ratio ~0.32
    expect(fa.n6n3_ratio).toBeLessThan(2);
  });

  it('Grain ağırlıklı rasyon → yüksek n-6/n-3 oranı', () => {
    const fa = estimateRationFA([{ id: 'corn', dmKg: 20 }], [SAMPLE_FEEDS[1]]);
    // grain: c18_2=53, c18_3=3 → ratio ~17
    expect(fa.n6n3_ratio).toBeGreaterThan(10);
  });

  it('Boş item listesi → sıfır toplam', () => {
    const fa = estimateRationFA([], SAMPLE_FEEDS);
    expect(fa.totalFat_g).toBe(0);
  });

  it('Feed-spesifik faProfile override edilir', () => {
    const feeds = [{ id: 'x', category: 'grain', fat: 5, faProfile: { c16_0: 100, c18_0: 0, c18_1: 0, c18_2: 0, c18_3: 0 } }];
    const items = [{ id: 'x', dmKg: 10 }];
    const fa = estimateRationFA(items, feeds);
    expect(fa.c16_0_g).toBe(fa.totalFat_g);  // %100 C16:0
    expect(fa.c18_2_g).toBe(0);
  });
});

describe('estimateMilkFA (Glasser 2008 Mass-Balance)', () => {
  it('Optimal peNDF → sağlıklı rumen faktörü, yüksek de novo', () => {
    const dietFA = estimateRationFA(SAMPLE_ITEMS, SAMPLE_FEEDS);
    const milk = estimateMilkFA(dietFA, { peNDFPct: 30, nfcPct: 35, milkYield_kg: 30, dmi_kg: 20 });
    // Rumen health factor = 1.0
    // De novo = 30 * 17.5 * 1.0 = 525g
    expect(milk.deNovo_g).toBe(525);
    expect(milk.mfdRisk).toBe('low');
  });

  it('Düşük peNDF + yüksek NFC → MFD riski ve de novo baskılanması', () => {
    const dietFA = estimateRationFA(SAMPLE_ITEMS, SAMPLE_FEEDS);
    const milk = estimateMilkFA(dietFA, { peNDFPct: 14, nfcPct: 48, milkYield_kg: 30, dmi_kg: 20 });
    expect(['moderate', 'high']).toContain(milk.mfdRisk);
    expect(milk.deNovoSuppression).toBeGreaterThan(0);
    expect(milk.deNovo_g).toBeLessThan(525); // Baskılanmış olmalı
  });

  it('Süt yağı tahmini 2.0-6.0 aralığında kalır', () => {
    const dietFA = estimateRationFA(SAMPLE_ITEMS, SAMPLE_FEEDS);
    const milk1 = estimateMilkFA(dietFA, { peNDFPct: 30, nfcPct: 35, milkYield_kg: 30, dmi_kg: 20 });
    const milk2 = estimateMilkFA(dietFA, { peNDFPct: 10, nfcPct: 55, milkYield_kg: 30, dmi_kg: 20 });
    expect(milk1.estimatedMilkFatPct).toBeGreaterThanOrEqual(2.0);
    expect(milk1.estimatedMilkFatPct).toBeLessThanOrEqual(6.0);
    expect(milk2.estimatedMilkFatPct).toBeGreaterThanOrEqual(2.0);
    expect(milk2.estimatedMilkFatPct).toBeLessThanOrEqual(6.0);
  });

  it('Mammary desaturation: C18:0 bir kısmı C18:1 e dönüşür', () => {
    const dietFA = estimateRationFA([{ id: 'corn', dmKg: 10 }], [SAMPLE_FEEDS[1]]);
    const milk = estimateMilkFA(dietFA, { peNDFPct: 25, nfcPct: 40, milkYield_kg: 30, dmi_kg: 10 });
    expect(milk.milk_c18_1_g).toBeGreaterThan(0); // Dönüşüm olmalı
    expect(milk.milk_c18_0_g).toBeGreaterThan(0);
  });

  it('Roughage ağırlıklı → n6n3 optimal', () => {
    const dietFA = estimateRationFA([{ id: 'silage', dmKg: 15 }], [SAMPLE_FEEDS[0]]);
    const milk = estimateMilkFA(dietFA, { peNDFPct: 25, nfcPct: 40 });
    expect(milk.n6n3_status).toBe('optimal');
  });
});

describe('assessFAProfile', () => {
  it('İyi rasyon → A/B notu', () => {
    const dietFA = estimateRationFA(SAMPLE_ITEMS, SAMPLE_FEEDS);
    const milk = estimateMilkFA(dietFA, { peNDFPct: 25, nfcPct: 40 });
    const r = assessFAProfile(dietFA, milk);
    expect(['A', 'B']).toContain(r.grade);
  });

  it('Kötü rasyon → C/D notu + uyarılar', () => {
    const dietFA = estimateRationFA(SAMPLE_ITEMS, SAMPLE_FEEDS);
    const milk = estimateMilkFA(dietFA, { peNDFPct: 12, nfcPct: 50 });
    const r = assessFAProfile(dietFA, milk);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('FAZ 10G — Yem-spesifik FA profilleri (gerçek DB)', () => {
  it('Mısır silajı düşük ω-6/ω-3 oranı verir (yüksek C18:3)', () => {
    const feeds = [{ id: 'mısır_silaj', category: 'roughage', fat: 3.3,
      faProfile: { c16_0: 18, c18_0: 3, c18_1: 22, c18_2: 51, c18_3: 6 } }];
    const items = [{ id: 'mısır_silaj', dmKg: 15 }];
    const fa = estimateRationFA(items, feeds);
    expect(fa.n6n3_ratio).toBeLessThan(15);  // 51/6 = 8.5 — kategori 53/3=17.7'den daha sağlıklı
  });

  it('Yonca otu çok düşük ω-6/ω-3 oranı (yüksek omega-3)', () => {
    const feeds = [{ id: 'yonca', category: 'roughage', fat: 2.0,
      faProfile: { c16_0: 22, c18_0: 3, c18_1: 4, c18_2: 18, c18_3: 53 } }];
    const items = [{ id: 'yonca', dmKg: 10 }];
    const fa = estimateRationFA(items, feeds);
    // 18/53 ≈ 0.34 — son derece sağlıklı omega-3 zenginleştirme
    expect(fa.n6n3_ratio).toBeLessThan(1);
  });

  it('Yem-spesifik faProfile, kategori varsayılanını geçersiz kılar', () => {
    const customFA = { c16_0: 90, c18_0: 5, c18_1: 3, c18_2: 1, c18_3: 1 };
    const feeds = [{ id: 'palmitik', category: 'fat', fat: 99, faProfile: customFA }];
    const items = [{ id: 'palmitik', dmKg: 0.5 }];
    const fa = estimateRationFA(items, feeds);
    // %90 C16:0 → toplam yağın yaklaşık %90'ı C16:0 olmalı
    expect(fa.c16_0_g / fa.totalFat_g).toBeCloseTo(0.9, 1);
  });
});
