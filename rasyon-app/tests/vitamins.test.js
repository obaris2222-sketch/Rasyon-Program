/**
 * vitamins.js — vitamin gereksinim testleri
 * FAZ 10C/F: NASEM 2021 katsayıları + dereceli niacin + iyon-bazlı kolin
 */
import { describe, it, expect } from 'vitest';
import {
  vitaminA, vitaminD, vitaminE, biotin, niacin, choline,
  bcarotene, bcaroteneToVitA,
  b12Requirement, b6Requirement, riboflavinRequirement, folicAcidRequirement,
  calcVitaminRequirements,
} from '../src/core/vitamins.js';

describe('vitaminA (NASEM 2021)', () => {
  it('Laktasyon: 110 IU/kg BW önerilir', () => {
    const r = vitaminA(650, 'lactation');
    expect(r.recommendedIU).toBeCloseTo(650 * 110, -1);
  });

  it('Geçiş dönemi: 150 IU/kg BW (NASEM artırımı)', () => {
    const r = vitaminA(650, 'transition');
    expect(r.recommendedIU).toBeCloseTo(650 * 150, -1);
  });

  it('Geçiş > Laktasyon > Kuru', () => {
    const trans = vitaminA(650, 'transition');
    const lact = vitaminA(650, 'lactation');
    const dry = vitaminA(650, 'dry');
    expect(trans.recommendedIU).toBeGreaterThan(lact.recommendedIU);
    expect(lact.recommendedIU).toBeGreaterThan(dry.recommendedIU);
  });
});

describe('vitaminD (NASEM 2021)', () => {
  it('Laktasyon: 30 IU/kg BW', () => {
    const r = vitaminD(650, 'lactation');
    expect(r.recommendedIU).toBeCloseTo(650 * 30, -1);
  });

  it('Geçiş dönemi: ~50 IU/kg BW', () => {
    const r = vitaminD(650, 'transition');
    expect(r.recommendedIU).toBeCloseTo(650 * 50, -1);
  });

  it('Geçiş dönemi laktasyondan yüksek', () => {
    expect(vitaminD(650, 'transition').recommendedIU).toBeGreaterThan(vitaminD(650, 'lactation').recommendedIU);
  });
});

describe('vitaminE (NASEM 2021)', () => {
  it('Laktasyon: 0.8 IU/kg BW', () => {
    expect(vitaminE(650, 'lactation').recommendedIU).toBeCloseTo(650 * 0.8, 0);
  });
  it('Geçiş dönemi: 2.0 IU/kg BW (Weiss 1998)', () => {
    expect(vitaminE(650, 'transition').recommendedIU).toBeCloseTo(650 * 2.0, 0);
  });
});

describe('bcarotene (FAZ 10C)', () => {
  it('Laktasyon: 300 mg/gün', () => {
    expect(bcarotene('lactation').recommendedMg).toBe(300);
  });
  it('Geçiş: 500 mg/gün (artırılmış)', () => {
    expect(bcarotene('transition').recommendedMg).toBe(500);
  });
});

describe('bcaroteneToVitA — sığır dönüşümü', () => {
  it('1 mg β-karoten ≈ 200 IU Vit A', () => {
    expect(bcaroteneToVitA(1)).toBe(200);
    expect(bcaroteneToVitA(500)).toBe(100000);
  });
  it('0 veya null girdi 0 döner', () => {
    expect(bcaroteneToVitA(0)).toBe(0);
    expect(bcaroteneToVitA(null)).toBe(0);
  });
});

describe('niacin (FAZ 10F dereceli)', () => {
  it('Düşük verim + geç laktasyon: bazal 6 g', () => {
    expect(niacin(20, 200).recommendedG).toBe(6);
  });

  it('Yüksek verim 40 kg: +4.5 g = 10.5 g', () => {
    // (40-25) × 0.3 = 4.5
    const r = niacin(40, 100);
    expect(r.recommendedG).toBeCloseTo(10.5, 1);
  });

  it('Erken laktasyon (DIM<30): +4 g bonus', () => {
    const r = niacin(30, 15);
    expect(r.recommendedG).toBeCloseTo(6 + 1.5 + 4, 1); // 25→30 = +1.5, erken +4
    expect(r.components.early).toBe(4);
  });

  it('Isı stresi (THI>78): +3 g bonus', () => {
    const r = niacin(30, 100, 82);
    expect(r.components.heat).toBe(3);
    expect(r.recommendedG).toBeGreaterThan(niacin(30, 100, 70).recommendedG);
  });

  it('Üst sınır 18 g/gün', () => {
    const r = niacin(80, 15, 85);
    expect(r.recommendedG).toBeLessThanOrEqual(18);
  });
});

describe('choline (FAZ 10F iyon-bazlı NASEM 2021)', () => {
  it('Geçiş döneminde 12.9 g iyon/gün', () => {
    const r = choline('transition');
    expect(r.recommendedIonG).toBe(12.9);
    expect(r.recommendedProductG_25pct).toBeGreaterThan(50);  // ~52 g %25 RPC
  });

  it('close_up alias transition gibi davranır', () => {
    expect(choline('close_up').recommendedIonG).toBe(12.9);
  });

  it('Laktasyon dışı dönemde öneri yok', () => {
    expect(choline('lactation').recommendedIonG).toBeNull();
  });
});

describe('calcVitaminRequirements', () => {
  it('Tüm vitaminleri içerir + bcarotene (FAZ 10C)', () => {
    const animal = { bw: 650, milkYield: 35, dim: 90 };
    const r = calcVitaminRequirements(animal, 'lactation');
    expect(r.vitA).toBeDefined();
    expect(r.vitD).toBeDefined();
    expect(r.vitE).toBeDefined();
    expect(r.bcarotene).toBeDefined();
    expect(r.biotin).toBeDefined();
    expect(r.niacin).toBeDefined();
    expect(r.choline).toBeDefined();
  });

  it('Geçiş döneminde tüm yağ-çözünür vitaminler artırılır', () => {
    const animal = { bw: 650, milkYield: 0, dim: 0 };
    const lact = calcVitaminRequirements(animal, 'lactation');
    const trans = calcVitaminRequirements(animal, 'transition');
    expect(trans.vitA.recommendedIU).toBeGreaterThan(lact.vitA.recommendedIU);
    expect(trans.vitD.recommendedIU).toBeGreaterThan(lact.vitD.recommendedIU);
    expect(trans.vitE.recommendedIU).toBeGreaterThan(lact.vitE.recommendedIU);
    expect(trans.bcarotene.recommendedMg).toBeGreaterThan(lact.bcarotene.recommendedMg);
  });

  it('Niacin THI girdisi alır', () => {
    const cool = calcVitaminRequirements({ bw: 650, milkYield: 35, dim: 60, thi: 65 }, 'lactation');
    const hot  = calcVitaminRequirements({ bw: 650, milkYield: 35, dim: 60, thi: 82 }, 'lactation');
    expect(hot.niacin.recommendedG).toBeGreaterThan(cool.niacin.recommendedG);
  });
});

// ─── FAZ 13.14: B grubu vitaminler (B12, B6, Riboflavin, Folik asit) ────────

describe('FAZ 13.14 — B grubu vitaminler (rumen sentezi vurgusu)', () => {
  it('B12: geçiş döneminde takviye önerisi (Girard & Matte)', () => {
    const trans = b12Requirement('transition', 30);
    expect(trans.recommendedMg).toBeGreaterThan(0);
    expect(trans.source).toMatch(/Girard/);
  });

  it('B12: orta laktasyon normal verim → rumen yeterli, öneri yok', () => {
    const lact = b12Requirement('lactation', 30);
    expect(lact.recommendedMg).toBeNull();
    expect(lact.routine).toBe(false);
    expect(lact.note).toMatch(/[Rr]umen/);
  });

  it('B12: çok yüksek verim (≥40 kg) → takviye değerlendirilir', () => {
    expect(b12Requirement('lactation', 45).recommendedMg).toBeGreaterThan(0);
  });

  it('B6 ve Riboflavin: rumen sentezi yeterli, rutin öneri yok', () => {
    expect(b6Requirement().recommendedMg).toBeNull();
    expect(b6Requirement().routine).toBe(false);
    expect(riboflavinRequirement().recommendedMg).toBeNull();
    expect(riboflavinRequirement().routine).toBe(false);
  });

  it('Folik asit: geçiş döneminde RP-folik önerisi', () => {
    const trans = folicAcidRequirement('transition', 0);
    expect(trans.recommendedMg).toBeGreaterThan(0);
    expect(trans.source).toMatch(/Girard/);
  });

  it('Folik asit: erken laktasyon (DIM<60) önerisi, geç laktasyonda yok', () => {
    expect(folicAcidRequirement('lactation', 30).recommendedMg).toBeGreaterThan(0);
    expect(folicAcidRequirement('lactation', 200).recommendedMg).toBeNull();
  });

  it('Hiçbir B vitamini "kesin gereksinim" iddia etmez (routine=false)', () => {
    expect(b12Requirement('transition').routine).toBe(false);
    expect(folicAcidRequirement('transition').routine).toBe(false);
  });

  it('calcVitaminRequirements B grubu vitaminleri içerir', () => {
    const r = calcVitaminRequirements({ bw: 650, milkYield: 35, dim: 60 }, 'transition');
    expect(r.b12).toBeDefined();
    expect(r.b6).toBeDefined();
    expect(r.riboflavin).toBeDefined();
    expect(r.folicAcid).toBeDefined();
    // Geçiş döneminde B12 + folik öneri pozitif
    expect(r.b12.recommendedMg).toBeGreaterThan(0);
    expect(r.folicAcid.recommendedMg).toBeGreaterThan(0);
  });
});
