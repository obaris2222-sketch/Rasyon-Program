/**
 * Tek Kaynak Hayvan Gereksinim Hesabı (FAZ 12 Madde 5)
 *
 * `calcAllRequirements(animal)` — Hayvan profili → tüm gereksinim setleri (tek source of truth)
 *
 * Bu modül animalForm.js (UI önizleme) ve rationOptimizer.js (LP) tarafından
 * aynı şekilde kullanılır → iki yerden farklı NEL/MP/mineral hesabı çıkma riski yok.
 *
 * Ayrıca compositionForStage & DEFAULT_COMPOSITION buraya taşındı (FAZ 9A) —
 * rationOptimizer.js geriye uyumluluk için re-export eder.
 */

import { calcDMI } from './dmi.js';
import { calcNELRequirements, calcMPRequirements, nelGrowth, mpGrowth } from './nrc2001.js';
import { calcNELRequirementsNASEM, calcMPRequirementsNASEM } from './nasem2021.js';
import { calcMineralRequirements, calcTraceMinerals } from './minerals.js';
import { calcVitaminRequirements } from './vitamins.js';
import { calcAATargets } from './aminoAcids.js';
import { interpretDCAD } from './dcad.js';
import { waterIntakeMurphy, interpretWaterAdequacy } from './water.js';  // FAZ 13.11
import { calcUFLRequirements, calcPDIRequirements, calcUELCapacity } from './inra2018.js';  // FAZ 16.1

// ─── FAZ 13.1: Bilim sistemi seçimi ─────────────────────────────────────────
// FAZ 17.1 (dürüst etiket): Çekirdek formülasyon motoru her sistemde NRC 2001
// per-feed MP/TDN'dir. "NASEM 2021" = NRC 2001 çekirdek + seçili katsayı
// güncellemeleri (idame/BCS/AA/mineral); "INRA 2018" = NRC değerlerinin INRA
// birimine çevrimi (rapor katmanı, LP yine NASEM ile). Tam mekanistik motor
// (iteratif CNCPS) FAZ 19 hedefidir. Etiketler bu gerçeği yansıtır.
export const REQUIREMENT_SYSTEMS = {
  NASEM2021: { label: 'NRC 2001 çekirdek + NASEM 2021 güncellemeleri (idame/BCS/AA/mineral)', maintenance: '0.10×BW^0.75', mpMaintenance: '4.1×BW^0.75', bcsMobilization: '84 Mcal/BCS' },
  NRC2001:   { label: 'NRC 2001 (7. baskı, klasik)', maintenance: '0.08×BW^0.75', mpMaintenance: '3.8×BW^0.75', bcsMobilization: '62.56 Mcal/BCS' },
  INRA2018:  { label: 'INRA 2018 (rapor katmanı — formülasyon NASEM ile)', maintenance: '0.041×BW^0.75 UFL', protein: 'PDIE/PDIN', fill: 'UEL' },  // FAZ 16.1
};
export const DEFAULT_REQUIREMENT_SYSTEM = 'NASEM2021';

// ─── FAZ 12 Madde 8: Kompozisyon Preset'leri ────────────────────────────────
// Kullanıcı 3 preset arasında seçim yapabilir — aralıkların genişliği ölçeklenir
export const COMPOSITION_PRESETS = {
  strict:      { label: 'Sıkı (hedef aralık dar)',  widthFactor: 0.6, description: 'Kesin kontrol — yüksek verim sürüsü' },
  recommended: { label: 'Önerilen (default)',       widthFactor: 1.0, description: 'NRC 2001 / NASEM 2021 standart' },
  loose:       { label: 'Geniş (esnek toleranslı)', widthFactor: 1.4, description: 'Yem çeşitliliği kısıtlı sürüler' },
};

// ─── Varsayılan kompozisyon hedefleri (NRC 2001 Tablo 14-6) ─────────────────

// FAZ 13.5: cp_pct kompozisyon hedefi KALDIRILDI — protein yeterliliği artık
// MP (metabolize edilebilir protein) ile belirleniyor (FAZ 10A MP-LP devrimi).
// Rasyonun hesaplanan CP%KM'si bilgi amaçlı raporlanmaya devam eder
// (aggregateComposition), ama bir LP/UI hedefi değildir. Kullanıcı isterse
// composition.cp_pct ile EXPLICIT CP kısıtı ekleyebilir (rationOptimizer).
export const DEFAULT_COMPOSITION = {
  ndf_pct:   { min: 28,  max: 38 },
  adf_pct:   { min: 19 },
  nfc_pct:   { max: 42 },
  peNDF_pct: { min: 22 },
  forage_pct:{ min: 40,  max: 70 },
  dcad_meq:  { min: 25,  max: 40 },
  // FAZ 14.5: RDP min — rumen mikrobiyal protein sentezi için yeterli yıkılabilir N
  // (NRC 2001 Böl. 3). MAX default verilmez (rasyon-spesifik; kullanıcı override
  // ile aşırı amonyak/üre yükü üst sınırı ekleyebilir). Laktasyon min %9 KM.
  rdp_pct:   { min: 9 },
  // FAZ 14.6: Rumen sağlığı üst sınırları (laktasyon, % KM)
  starch_pct:{ max: 28 },  // SARA/asidoz eşiği (Penn State / NRC 2001)
  sugar_pct: { max: 8 },   // MFD önleme (hızlı fermentasyon)
  fat_pct:   { max: 7 },   // rumen lif sindirimi baskılanması (NRC 2001 toplam yağ)
  // FAZ 14.10: PUFA (C18:2+C18:3) max — rumen biyohidrojenasyon kapasitesi/MFD (% KM).
  // n6:n3 oran sınırı default verilmez (kategori-fallback FA profilleri güvenilmez;
  // kullanıcı süt kalitesi için composition.n6n3_ratio_max ile ekleyebilir).
  pufa_pct:  { max: 5 },
};

/**
 * Laktasyon evresine göre kompozisyon hedeflerini döndürür.
 * @param {string} stage - 'early' | 'mid' | 'late' | 'far_off' | 'close_up'
 * @param {object} [animal] - dinamik düzeltme için
 * @param {object} [options]
 *   @param {string} [options.preset='recommended'] - 'strict' | 'recommended' | 'loose'
 * @returns {object}
 */
export function compositionForStage(stage = 'early', animal = null, options = {}) {
  let base;
  switch (stage) {
    case 'early':
      base = { ...DEFAULT_COMPOSITION };
      break;
    case 'mid':
      base = {
        ...DEFAULT_COMPOSITION,
        ndf_pct:   { min: 30,   max: 40 },
        forage_pct:{ min: 45,   max: 70 },
      };
      break;
    case 'late':
      base = {
        ...DEFAULT_COMPOSITION,
        ndf_pct:   { min: 32,   max: 42 },
        nfc_pct:   { max: 38 },
        forage_pct:{ min: 50,   max: 75 },
        dcad_meq:  { min: 25,   max: 40 },
      };
      break;
    case 'far_off':
      base = {
        ndf_pct:   { min: 40,   max: 55 },
        adf_pct:   { min: 27 },
        nfc_pct:   { max: 32 },
        peNDF_pct: { min: 30 },
        forage_pct:{ min: 60,   max: 90 },
        dcad_meq:  { min: 15,   max: 25 },
        rdp_pct:   { min: 8 },   // FAZ 14.5: kuru dönem daha düşük RDP gereksinimi
        starch_pct:{ max: 20 },  // FAZ 14.6: kuru dönem düşük nişasta (asidoz/rumen geçişi)
        sugar_pct: { max: 6 },
        fat_pct:   { max: 5 },
        pufa_pct:  { max: 4 },   // FAZ 14.10: kuru dönem düşük PUFA
      };
      break;
    case 'close_up':
      base = {
        ndf_pct:   { min: 35,   max: 45 },
        adf_pct:   { min: 24 },
        nfc_pct:   { max: 38 },
        peNDF_pct: { min: 27 },
        forage_pct:{ min: 50,   max: 80 },
        dcad_meq:  { min: -15,  max: -10 },
        rdp_pct:   { min: 8 },   // FAZ 14.5: geçiş dönemi
        starch_pct:{ max: 26 },  // FAZ 14.6: close-up — laktasyona adaptasyon için orta nişasta
        sugar_pct: { max: 7 },
        fat_pct:   { max: 6 },
        pufa_pct:  { max: 4.5 }, // FAZ 14.10: close-up
      };
      break;
    default:
      base = { ...DEFAULT_COMPOSITION };
  }

  let adjusted = animal ? applyDynamicAdjustments(base, stage, animal) : base;
  // FAZ 12 Madde 8: Preset uygula (aralık genişliği)
  const preset = options?.preset || 'recommended';
  if (preset !== 'recommended') adjusted = applyPreset(adjusted, preset);
  return adjusted;
}

/**
 * Preset'e göre kompozisyon aralığını orta-noktası etrafında daraltır/genişletir.
 * widthFactor < 1 → daha sıkı, > 1 → daha esnek.
 */
function applyPreset(comp, presetKey) {
  const factor = COMPOSITION_PRESETS[presetKey]?.widthFactor ?? 1.0;
  if (factor === 1.0) return comp;
  const out = JSON.parse(JSON.stringify(comp));
  for (const key of ['ndf_pct', 'nfc_pct', 'peNDF_pct', 'forage_pct', 'dcad_meq']) {
    const c = out[key];
    if (!c) continue;
    if (c.min !== undefined && c.max !== undefined) {
      const mid = (c.min + c.max) / 2;
      const halfWidth = ((c.max - c.min) / 2) * factor;
      c.min = round1(mid - halfWidth);
      c.max = round1(mid + halfWidth);
    } else if (c.min !== undefined && factor > 1) {
      // tek-yönlü min: factor > 1 → min'i hafifçe gevşet, < 1 → sıkılaştır
      c.min = round1(c.min * (2 - factor)); // factor=1.4 → ×0.6
    } else if (c.max !== undefined) {
      c.max = round1(c.max * factor);
    }
  }
  return out;
}

/**
 * FAZ 12 Madde 8: Her aralık için "neden bu değer" açıklama notu üretir.
 * @param {object} comp - compositionForStage çıktısı
 * @param {object} animal - hayvan profili
 * @param {string} stage - laktasyon evresi
 * @returns {object} { ndf_pct: '...', peNDF_pct: '...', ... }
 */
export function buildDynamicNotes(comp, animal = {}, stage = 'early') {
  const notes = {};
  const my = Number(animal.milkYield) || 0;
  const parity = Number(animal.parity) || 2;
  const bcs = Number(animal.bcs) || 3.0;
  const thi = Number(animal.thi);
  const milkFat = Number(animal.milkFat) || 3.5;
  const milkProtein = Number(animal.milkProtein) || 3.1;
  const fpRatio = (milkFat && milkProtein) ? (milkFat / milkProtein) : null;

  const ctx = `${stage}, verim ${my} kg, parite ${parity}, BCS ${bcs}${Number.isFinite(thi) ? `, THI ${thi.toFixed(0)}` : ''}`;

  // FAZ 13.5: cp_pct notu kaldırıldı — protein yeterliliği MP ile belirleniyor
  if (comp.ndf_pct) {
    const partsNDF = [];
    if (parity === 1) partsNDF.push('düve → düşürüldü (-2)');
    else if (parity >= 3) partsNDF.push('multipar → +1');
    notes.ndf_pct = partsNDF.length ? `${ctx}: ${partsNDF.join(', ')}` : `${stage} dönem standart (${ctx})`;
  }
  if (comp.peNDF_pct) {
    const partsPE = [];
    if (my >= 40) partsPE.push('yüksek verim → gevşetildi');
    else if (my < 20) partsPE.push('düşük verim → sıkılaştırıldı');
    if (Number.isFinite(thi) && thi > 72) partsPE.push('ısı stresi → +1');
    if (fpRatio !== null && fpRatio < 1.10) partsPE.push('MFD belirtisi → +2');
    notes.peNDF_pct = partsPE.length ? `${ctx}: ${partsPE.join(', ')}` : `standart peNDF hedefi (${ctx})`;
  }
  if (comp.nfc_pct) {
    const partsNFC = [];
    if (bcs < 2.75) partsNFC.push('düşük BCS → max +2 (kilo aldır)');
    else if (bcs > 3.75) partsNFC.push('yüksek BCS → max -2');
    if (Number.isFinite(thi) && thi > 72) partsNFC.push(thi > 78 ? 'THI>78 → max -4' : 'THI>72 → max -2');
    if (fpRatio !== null && fpRatio < 1.10) partsNFC.push('MFD → max -2');
    notes.nfc_pct = partsNFC.length ? `${ctx}: ${partsNFC.join(', ')}` : `${stage} standart`;
  }
  if (comp.forage_pct) {
    const partsF = [];
    if (Number.isFinite(thi) && thi > 78) partsF.push('THI>78 → min -5 (gevşetildi)');
    notes.forage_pct = partsF.length ? `${ctx}: ${partsF.join(', ')}` : `${stage} dönem standart`;
  }
  if (comp.adf_pct) notes.adf_pct = `${stage} dönem alt sınırı`;
  if (comp.dcad_meq) {
    notes.dcad_meq = stage === 'close_up' ? 'Anyonik rasyon (negatif DCAD — süt humması önleme)'
                  : stage === 'far_off'  ? 'Pozitif (alkali) — kuruda standart'
                  : 'Laktasyon standart';
  }
  return notes;
}

function applyDynamicAdjustments(base, stage, animal) {
  const out = JSON.parse(JSON.stringify(base));
  const isLactating = ['early', 'mid', 'late'].includes(stage);
  if (!isLactating) return out;

  const my = Number(animal.milkYield) || 0;
  const parity = Number(animal.parity) || 2;
  const bcs = Number(animal.bcs) || 3.0;
  const thi = Number(animal.thi);
  const milkFat = Number(animal.milkFat) || 3.5;
  const milkProtein = Number(animal.milkProtein) || 3.1;

  // FAZ 13.5: CP (MP-bazlı/lineer) dinamik ayarlama bloğu KALDIRILDI.
  // Protein yeterliliği MP gereksinimi (calcMPRequirements*) üzerinden LP'de
  // doğrudan kısıtlanıyor; cp_pct artık bir kompozisyon hedefi değil.

  // Parite → NDF
  if (parity === 1 && out.ndf_pct) {
    if (Number.isFinite(out.ndf_pct.min)) out.ndf_pct.min = round1(Math.max(25, out.ndf_pct.min - 2));
    if (Number.isFinite(out.ndf_pct.max)) out.ndf_pct.max = round1(out.ndf_pct.max - 1);
  } else if (parity >= 3 && out.ndf_pct) {
    if (Number.isFinite(out.ndf_pct.min)) out.ndf_pct.min = round1(out.ndf_pct.min + 1);
  }

  // Yüksek verim → peNDF
  if (out.peNDF_pct && Number.isFinite(out.peNDF_pct.min)) {
    if (my >= 40) out.peNDF_pct.min = round1(out.peNDF_pct.min - 2);
    else if (my < 20) out.peNDF_pct.min = round1(out.peNDF_pct.min + 1);
  }

  // BCS → NFC
  if (out.nfc_pct && Number.isFinite(out.nfc_pct.max)) {
    if (bcs < 2.75)      out.nfc_pct.max = round1(out.nfc_pct.max + 2);
    else if (bcs > 3.75) out.nfc_pct.max = round1(out.nfc_pct.max - 2);
  }

  // Isı stresi
  if (Number.isFinite(thi) && thi > 72) {
    if (out.nfc_pct && Number.isFinite(out.nfc_pct.max)) {
      const reduction = thi > 78 ? 4 : 2;
      out.nfc_pct.max = round1(out.nfc_pct.max - reduction);
    }
    if (out.peNDF_pct && Number.isFinite(out.peNDF_pct.min)) {
      out.peNDF_pct.min = round1(out.peNDF_pct.min + 1);
    }
    if (out.forage_pct && Number.isFinite(out.forage_pct.min) && thi > 78) {
      out.forage_pct.min = round1(Math.max(35, out.forage_pct.min - 5));
    }
  }

  // Süt yağ depresyonu
  if (milkFat > 0 && milkProtein > 0 && (milkFat / milkProtein) < 1.10) {
    if (out.peNDF_pct && Number.isFinite(out.peNDF_pct.min)) {
      out.peNDF_pct.min = round1(out.peNDF_pct.min + 2);
    }
    if (out.nfc_pct && Number.isFinite(out.nfc_pct.max)) {
      out.nfc_pct.max = round1(out.nfc_pct.max - 2);
    }
  }

  // Tutarlılık
  for (const key of ['ndf_pct', 'nfc_pct', 'forage_pct']) {
    if (out[key]?.min !== undefined && out[key]?.max !== undefined && out[key].min > out[key].max) {
      out[key].min = out[key].max;
    }
  }
  return out;
}

function round1(v) { return Math.round(v * 10) / 10; }

// ─── Tek Kaynak Hayvan Gereksinim API'si ─────────────────────────────────────

/**
 * FAZ 17.3: KMT (DMI) yöntemini bilim sistemiyle tutarlı çözer.
 *
 * Son Kontrol Raporu §3.2: kullanıcı "NASEM 2021" seçse bile DMI varsayılanı
 * NRC 2001 kalıyordu — oysa NASEM 2021 (ve INRA 2018) tüketim tahmininde
 * de Souza et al. 2019 denklemini tercih eder. Bu çözücü:
 *   - Açık seçim ('NRC2001' | 'deSouza2019') → her zaman öncelikli (override).
 *   - 'auto' / boş → bilim sisteminden türet: NASEM2021/INRA2018 → de Souza 2019,
 *     NRC2001 → NRC 2001.
 *
 * @param {string} [dmiMethod] - 'NRC2001' | 'deSouza2019' | 'auto' | undefined
 * @param {string} system - 'NASEM2021' | 'NRC2001' | 'INRA2018'
 * @returns {'NRC2001'|'deSouza2019'}
 */
export function resolveDmiMethod(dmiMethod, system) {
  if (dmiMethod === 'NRC2001' || dmiMethod === 'deSouza2019') return dmiMethod;  // açık override
  return (system === 'NASEM2021' || system === 'INRA2018') ? 'deSouza2019' : 'NRC2001';
}

/**
 * Hayvan profilinden tüm gereksinimleri tek seferde hesaplar.
 * animalForm.js UI önizlemesi ve rationOptimizer.js LP pipeline aynı çıktıyı kullanır.
 *
 * @param {object} animal — AnimalProfile şeması
 * @param {object} [options]
 *   @param {string} [options.dmiMethod='auto'] — 'NRC2001'|'deSouza2019'|'auto'
 *     ('auto'/boş → bilim sistemine göre, bkz. resolveDmiMethod)
 *   @param {string} [options.system='NASEM2021'] — bilim sistemi: 'NASEM2021' | 'NRC2001'
 *   @param {string} [options.preset='recommended'] — kompozisyon preset
 * @returns {object} {
 *   dmi, nel, mp, minerals, traceMinerals, vitamins, aaTargets,
 *   dcadTarget, compTargets, vitPeriod, dcadCowPeriod, system
 * }
 */
export function calcAllRequirements(animal, options = {}) {
  if (!animal) throw new Error('calcAllRequirements: animal zorunlu');

  const system = options.system || DEFAULT_REQUIREMENT_SYSTEM;
  // FAZ 17.3: KMT yöntemi açıkça seçilmemişse bilim sistemiyle tutarlı türetilir.
  const dmiMethod = resolveDmiMethod(options.dmiMethod, system);

  // FAZ 18.2: doluluk-düzeltmeli KMT enjeksiyonu (rationOptimizer 2-pass). dmiOverride
  // verilirse hayvan-bazlı KMT yerine kullanılır (fcm/ecm/method korunur). DMI-bağımlı
  // mineral/iz mineral gereksinimleri de bu düzeltilmiş KMT'yi kullanır.
  let dmi = calcDMI(animal, dmiMethod);
  if (Number.isFinite(options.dmiOverride) && options.dmiOverride > 0) {
    dmi = { ...dmi, dmi: options.dmiOverride, baseDmi: dmi.dmi, fillAdjusted: true };
  }
  const dmi_kg = dmi.dmi;

  // FAZ 13.1 + FAZ 16.1: Bilim sistemine göre NEL & MP hesaplama
  // INRA2018 seçildiğinde LP pipeline NASEM2021 ile çalışır, INRA değerleri ek rapor olarak hesaplanır.
  const effectiveSystem = system === 'INRA2018' ? 'NASEM2021' : system;
  let nel = effectiveSystem === 'NASEM2021'
    ? calcNELRequirementsNASEM(animal)
    : calcNELRequirements(animal);
  let mp = effectiveSystem === 'NASEM2021'
    ? calcMPRequirementsNASEM(animal)
    : calcMPRequirements(animal);

  // FAZ 13.10: Primipar (1. laktasyon) büyüme bileşeni — NRC 2001 Bölüm 11
  // Laktasyondaki 1. parite inek henüz olgun ağırlığına ulaşmadığından
  // idame + laktasyona ek NEL/MP gerekir. Kullanıcı targetADG girerse uygulanır
  // (girilmezse 0 → mevcut davranış korunur; sistemden bağımsız NRC 2001 denklemi).
  const isLactating = ['early', 'mid', 'late'].includes(animal.lactationStage);
  const adg = Number(animal.targetADG) || 0;
  if (animal.parity === 1 && isLactating && adg > 0) {
    const reGrowth = nelGrowth(animal.bw, adg, animal.matureBW);
    const mpG = mpGrowth(adg, reGrowth);
    nel = { ...nel, growth: reGrowth, total: Math.round((nel.total + reGrowth) * 100) / 100 };
    mp = { ...mp, growth: mpG, total: Math.round(mp.total + mpG) };
  }

  const minerals = calcMineralRequirements(animal, dmi_kg, effectiveSystem);  // FAZ 13.7: system → Mg/P/Ca katsayı (INRA→NASEM)
  const traceMinerals = calcTraceMinerals(dmi_kg);

  // Dönem haritalama
  const vitPeriod = animal.lactationStage === 'close_up' ? 'transition'
                  : animal.lactationStage === 'far_off' ? 'dry'
                  : 'lactation';
  const dcadCowPeriod = animal.lactationStage === 'close_up' ? 'transition'
                      : animal.lactationStage === 'far_off' ? 'dry_faroff'
                      : 'lactation';

  const vitamins = calcVitaminRequirements(animal, vitPeriod);
  const aaTargets = calcAATargets(animal);

  // FAZ 13.11: Su tüketimi tahmini (Murphy 1992) — DMI + süt + Na + sıcaklık
  // Na tüketimi ≈ rasyon Na gereksinimi (g/gün); sıcaklık yoksa 20°C varsayılır
  const tempC = Number.isFinite(animal.ambientTemp) ? animal.ambientTemp : 20;
  const waterL = waterIntakeMurphy(dmi_kg, animal.milkYield || 0, minerals.na?.total || 0, tempC);
  const water = {
    intakeL: waterL,
    tempC,
    ...interpretWaterAdequacy(waterL, { tempC, milkYield: animal.milkYield || 0, dmi_kg }),
  };

  // DCAD hedefi (laktasyon: 25–50 pozitif, close_up: −15 ile −5 anyonik, far_off: 15–30)
  const dcadTarget = compositionForStage(animal.lactationStage, animal).dcad_meq;

  // Kompozisyon hedefleri — MP-bazlı dinamik (FAZ 10A) + preset (FAZ 12 Madde 8)
  const animalWithMetabolics = { ...animal, dmi_kg, mp_required_g: mp.total };
  const preset = options.preset || 'recommended';
  const compTargets = compositionForStage(animal.lactationStage, animalWithMetabolics, { preset });
  const dynamicNotes = buildDynamicNotes(compTargets, animal, animal.lactationStage);

  // FAZ 16.1: INRA 2018 ek gereksinimleri (LP dışı, rapor/karşılaştırma)
  let inra = null;
  if (system === 'INRA2018') {
    inra = {
      ufl: calcUFLRequirements(animal),
      pdi: calcPDIRequirements(animal),
      uelCapacity: calcUELCapacity(animal),
    };
  }

  return {
    dmi, nel, mp, minerals, traceMinerals, vitamins, aaTargets, water,
    dcadTarget, compTargets, dynamicNotes, preset, vitPeriod, dcadCowPeriod,
    system,  // FAZ 13.1: hangi bilim sistemi kullanıldı raporda görünür
    inra,    // FAZ 16.1: INRA 2018 gereksinimleri (system='INRA2018' ise dolu)
  };
}
