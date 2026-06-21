import { describe, it, expect } from 'vitest';
import {
  calcAllRequirements,
  compositionForStage,
  DEFAULT_COMPOSITION,
  COMPOSITION_PRESETS,
  buildDynamicNotes,
  REQUIREMENT_SYSTEMS,
  DEFAULT_REQUIREMENT_SYSTEM,
  resolveDmiMethod,
} from '../src/core/animalRequirements.js';

const baseAnimal = {
  lactationStage: 'early',
  bw: 650,
  milkYield: 35,
  milkFat: 3.5,
  milkProtein: 3.1,
  parity: 2,
  dim: 90,
  bcs: 3.0,
  pregnant: false,
  pregnancyMonth: 0,
  gestDays: 0,
};

describe('calcAllRequirements — tek kaynak gereksinim hesabı', () => {
  it('tüm beklenen alanları döndürür', () => {
    const r = calcAllRequirements(baseAnimal);
    expect(r.dmi).toBeDefined();
    expect(r.nel).toBeDefined();
    expect(r.mp).toBeDefined();
    expect(r.minerals).toBeDefined();
    expect(r.traceMinerals).toBeDefined();
    expect(r.vitamins).toBeDefined();
    expect(r.aaTargets).toBeDefined();
    expect(r.compTargets).toBeDefined();
    expect(r.dcadTarget).toBeDefined();
    expect(r.vitPeriod).toBe('lactation');
    expect(r.dcadCowPeriod).toBe('lactation');
  });

  it('NEL toplam > 0 ve mantıklı aralıkta (35 kg süt)', () => {
    const r = calcAllRequirements(baseAnimal);
    expect(r.nel.total).toBeGreaterThan(20);
    expect(r.nel.total).toBeLessThan(60);
  });

  it('MP toplam > 0 ve mantıklı aralıkta (35 kg süt)', () => {
    const r = calcAllRequirements(baseAnimal);
    expect(r.mp.total).toBeGreaterThan(1500);
    expect(r.mp.total).toBeLessThan(4000);
  });

  it('close_up dönemi → DCAD hedefi negatif (anyonik)', () => {
    const r = calcAllRequirements({ ...baseAnimal, lactationStage: 'close_up', milkYield: 0, dim: 14 });
    expect(r.dcadCowPeriod).toBe('transition');
    expect(r.vitPeriod).toBe('transition');
    expect(r.dcadTarget.min).toBeLessThan(0);
    expect(r.dcadTarget.max).toBeLessThanOrEqual(0);
  });

  it('far_off dönemi → dry vit period', () => {
    const r = calcAllRequirements({ ...baseAnimal, lactationStage: 'far_off', milkYield: 0, dim: 30 });
    expect(r.vitPeriod).toBe('dry');
    expect(r.dcadCowPeriod).toBe('dry_faroff');
  });

  it('animal yoksa hata atar', () => {
    expect(() => calcAllRequirements(null)).toThrow();
  });

  it('compTargets cp_pct içermez — protein MP ile belirlenir (FAZ 13.5)', () => {
    const r = calcAllRequirements(baseAnimal);
    expect(r.compTargets.cp_pct).toBeUndefined();
    // Protein yeterliliği MP üzerinden raporlanır
    expect(r.mp.total).toBeGreaterThan(0);
  });

  it('iki çağrı aynı çıktıyı verir (deterministik)', () => {
    const r1 = calcAllRequirements(baseAnimal);
    const r2 = calcAllRequirements(baseAnimal);
    expect(r1.nel.total).toBe(r2.nel.total);
    expect(r1.mp.total).toBe(r2.mp.total);
  });
});

describe('FAZ 17.3 — DMI yöntemi ↔ bilim sistemi tutarlılığı', () => {
  it('resolveDmiMethod: açık seçim her zaman öncelikli (override)', () => {
    expect(resolveDmiMethod('NRC2001', 'NASEM2021')).toBe('NRC2001');
    expect(resolveDmiMethod('deSouza2019', 'NRC2001')).toBe('deSouza2019');
  });

  it('resolveDmiMethod: auto/boş → bilim sisteminden türetir', () => {
    expect(resolveDmiMethod('auto', 'NASEM2021')).toBe('deSouza2019');
    expect(resolveDmiMethod(undefined, 'NASEM2021')).toBe('deSouza2019');
    expect(resolveDmiMethod('auto', 'INRA2018')).toBe('deSouza2019');
    expect(resolveDmiMethod('auto', 'NRC2001')).toBe('NRC2001');
    expect(resolveDmiMethod(undefined, 'NRC2001')).toBe('NRC2001');
  });

  it('calcAllRequirements: NASEM 2021 + dmiMethod verilmezse de Souza 2019 KMT', () => {
    const r = calcAllRequirements(baseAnimal, { system: 'NASEM2021' });
    expect(r.dmi.method).toBe('deSouza2019');
  });

  it('calcAllRequirements: NRC 2001 + dmiMethod verilmezse NRC 2001 KMT', () => {
    const r = calcAllRequirements(baseAnimal, { system: 'NRC2001' });
    expect(r.dmi.method).toBe('NRC2001');
  });

  it('calcAllRequirements: açık dmiMethod sistemi geçersiz kılar (NASEM + NRC2001 → NRC2001)', () => {
    const r = calcAllRequirements(baseAnimal, { system: 'NASEM2021', dmiMethod: 'NRC2001' });
    expect(r.dmi.method).toBe('NRC2001');
  });

  it('calcAllRequirements: INRA 2018 + auto → de Souza 2019 KMT', () => {
    const r = calcAllRequirements(baseAnimal, { system: 'INRA2018', dmiMethod: 'auto' });
    expect(r.dmi.method).toBe('deSouza2019');
  });
});

describe('compositionForStage — re-export uyumluluğu', () => {
  it('DEFAULT_COMPOSITION yapı bozulmamış (cp_pct YOK — FAZ 13.5)', () => {
    expect(DEFAULT_COMPOSITION.cp_pct).toBeUndefined();  // MP belirleyici
    expect(DEFAULT_COMPOSITION.ndf_pct).toBeDefined();
    expect(DEFAULT_COMPOSITION.peNDF_pct).toBeDefined();
  });

  it('early stage DEFAULT ile aynı', () => {
    const c = compositionForStage('early');
    expect(c.ndf_pct).toEqual(DEFAULT_COMPOSITION.ndf_pct);
    expect(c.cp_pct).toBeUndefined();  // FAZ 13.5
  });

  it('close_up DCAD negatif', () => {
    const c = compositionForStage('close_up');
    expect(c.dcad_meq.min).toBeLessThan(0);
  });
});

// ─── FAZ 12 Madde 8: Preset'ler & Dynamic Notes ─────────────────────────────

describe('FAZ 12 Madde 8 — Kompozisyon Preset\'leri', () => {
  it('COMPOSITION_PRESETS 3 preset içerir', () => {
    expect(COMPOSITION_PRESETS.strict).toBeDefined();
    expect(COMPOSITION_PRESETS.recommended).toBeDefined();
    expect(COMPOSITION_PRESETS.loose).toBeDefined();
    expect(COMPOSITION_PRESETS.strict.widthFactor).toBeLessThan(1);
    expect(COMPOSITION_PRESETS.loose.widthFactor).toBeGreaterThan(1);
  });

  it('strict preset NDF aralığını daraltır (recommended\'a göre)', () => {
    const rec    = compositionForStage('early', baseAnimal, { preset: 'recommended' });
    const strict = compositionForStage('early', baseAnimal, { preset: 'strict' });
    const recWidth = rec.ndf_pct.max - rec.ndf_pct.min;
    const strictWidth = strict.ndf_pct.max - strict.ndf_pct.min;
    expect(strictWidth).toBeLessThan(recWidth);
  });

  it('loose preset NDF aralığını genişletir', () => {
    const rec   = compositionForStage('early', baseAnimal, { preset: 'recommended' });
    const loose = compositionForStage('early', baseAnimal, { preset: 'loose' });
    const recWidth = rec.ndf_pct.max - rec.ndf_pct.min;
    const looseWidth = loose.ndf_pct.max - loose.ndf_pct.min;
    expect(looseWidth).toBeGreaterThan(recWidth);
  });

  it('preset her aralığın orta noktasını yaklaşık korur', () => {
    const rec    = compositionForStage('early', baseAnimal, { preset: 'recommended' });
    const strict = compositionForStage('early', baseAnimal, { preset: 'strict' });
    const recMid    = (rec.ndf_pct.min + rec.ndf_pct.max) / 2;
    const strictMid = (strict.ndf_pct.min + strict.ndf_pct.max) / 2;
    expect(Math.abs(recMid - strictMid)).toBeLessThan(0.5);
  });

  it('calcAllRequirements preset\'i destekler ve döndürür', () => {
    const r = calcAllRequirements(baseAnimal, { preset: 'strict' });
    expect(r.preset).toBe('strict');
    expect(r.dynamicNotes).toBeDefined();
  });
});

describe('FAZ 12 Madde 8 — Dynamic Notes', () => {
  it('düve (parite 1) → NDF notu özel mesaj içerir', () => {
    const heifer = { ...baseAnimal, parity: 1 };
    const comp = compositionForStage('early', heifer);
    const notes = buildDynamicNotes(comp, heifer, 'early');
    expect(notes.ndf_pct).toMatch(/düve/i);
  });

  it('yüksek THI → NFC notu ısı stresi içerir', () => {
    const hot = { ...baseAnimal, thi: 80 };
    const comp = compositionForStage('early', hot);
    const notes = buildDynamicNotes(comp, hot, 'early');
    expect(notes.nfc_pct).toMatch(/THI|ısı/i);
  });

  it('close_up → DCAD notu anyonik içerir', () => {
    const cu = { ...baseAnimal, lactationStage: 'close_up', milkYield: 0, dim: 14 };
    const comp = compositionForStage('close_up', cu);
    const notes = buildDynamicNotes(comp, cu, 'close_up');
    expect(notes.dcad_meq).toMatch(/[Aa]nyonik/);
  });

  it('düşük BCS → NFC notu kilo aldırma içerir', () => {
    const thin = { ...baseAnimal, bcs: 2.5 };
    const comp = compositionForStage('early', thin);
    const notes = buildDynamicNotes(comp, thin, 'early');
    expect(notes.nfc_pct).toMatch(/BCS|kilo/i);
  });
});

// ─── FAZ 13.1 — NASEM 2021 sistem entegrasyonu ─────────────────────────────

describe('FAZ 13.1 — Bilim sistemi seçimi (NRC 2001 vs NASEM 2021)', () => {
  it('REQUIREMENT_SYSTEMS NASEM2021 ve NRC2001 içerir', () => {
    expect(REQUIREMENT_SYSTEMS.NASEM2021).toBeDefined();
    expect(REQUIREMENT_SYSTEMS.NRC2001).toBeDefined();
    expect(REQUIREMENT_SYSTEMS.NASEM2021.maintenance).toMatch(/0\.10/);
    expect(REQUIREMENT_SYSTEMS.NRC2001.maintenance).toMatch(/0\.08/);
  });

  it('DEFAULT_REQUIREMENT_SYSTEM = NASEM2021 (yeni varsayılan)', () => {
    expect(DEFAULT_REQUIREMENT_SYSTEM).toBe('NASEM2021');
  });

  it('default çağrı NASEM2021 sistemini raporlar', () => {
    const r = calcAllRequirements(baseAnimal);
    expect(r.system).toBe('NASEM2021');
  });

  it('NASEM2021 NEL idame NRC2001\'den ~%25 yüksek (0.10 vs 0.08 × BW^0.75)', () => {
    const nasem = calcAllRequirements(baseAnimal, { system: 'NASEM2021' });
    const nrc   = calcAllRequirements(baseAnimal, { system: 'NRC2001' });
    const ratio = nasem.nel.maintenance / nrc.nel.maintenance;
    // 0.10 / 0.08 = 1.25 → +%25
    expect(ratio).toBeGreaterThan(1.20);
    expect(ratio).toBeLessThan(1.30);
  });

  it('NASEM2021 NEL toplam > NRC2001 (idame farkı toplama yansır)', () => {
    const nasem = calcAllRequirements(baseAnimal, { system: 'NASEM2021' });
    const nrc   = calcAllRequirements(baseAnimal, { system: 'NRC2001' });
    expect(nasem.nel.total).toBeGreaterThan(nrc.nel.total);
    // Toplam fark idame farkı kadar olmalı (~3 Mcal)
    const diff = nasem.nel.total - nrc.nel.total;
    expect(diff).toBeGreaterThan(2);
    expect(diff).toBeLessThan(5);
  });

  it('NASEM2021 MP idame NRC2001\'den ~%8 yüksek (4.1 vs 3.8 × BW^0.75)', () => {
    const nasem = calcAllRequirements(baseAnimal, { system: 'NASEM2021' });
    const nrc   = calcAllRequirements(baseAnimal, { system: 'NRC2001' });
    const ratio = nasem.mp.maintenance / nrc.mp.maintenance;
    // 4.1 / 3.8 = 1.079 → +%7.9
    expect(ratio).toBeGreaterThan(1.06);
    expect(ratio).toBeLessThan(1.10);
  });

  it('NASEM2021 BCS mobilizasyon NRC2001\'den ~%34 yüksek (84 vs 62.56)', () => {
    const bcsLossAnimal = { ...baseAnimal, bcs: 2.5, targetBcs: 3.2 };  // BCS düşüşü 0.7
    const nasem = calcAllRequirements(bcsLossAnimal, { system: 'NASEM2021' });
    const nrc   = calcAllRequirements(bcsLossAnimal, { system: 'NRC2001' });
    const nasemMob = Math.abs(nasem.nel.mobilization);
    const nrcMob   = Math.abs(nrc.nel.mobilization);
    expect(nasemMob).toBeGreaterThan(0);
    expect(nrcMob).toBeGreaterThan(0);
    const ratio = nasemMob / nrcMob;
    // 84 / 62.56 ≈ 1.343 → +%34
    expect(ratio).toBeGreaterThan(1.30);
    expect(ratio).toBeLessThan(1.38);
  });

  it('NRC2001 modu eski NEL davranışını korur (geri uyumluluk)', () => {
    const r = calcAllRequirements(baseAnimal, { system: 'NRC2001' });
    // 650 kg → 0.08 × 650^0.75 ≈ 10.30 Mcal
    expect(r.nel.maintenance).toBeGreaterThan(9.5);
    expect(r.nel.maintenance).toBeLessThan(11.0);
    expect(r.system).toBe('NRC2001');
  });
});
