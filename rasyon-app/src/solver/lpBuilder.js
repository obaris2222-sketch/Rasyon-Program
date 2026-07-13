/**
 * LP Problem Oluşturucu — Süt Sığırı Rasyon Optimizasyonu
 *
 * Karar değişkenleri: xi = yem i'nin rasyondaki KM miktarı (kg/gün)
 * Amaç: maliyet minimizasyonu (varsayılan) veya KM minimizasyonu
 * Kısıtlar: NEL, CP, MP, NDF, ADF, NFC, peNDF, kaba yem oranı,
 *          mineraller (Ca, P, Mg, K, Na, S, Cl), DCAD,
 *          her yem için min/max katılım.
 *
 * Tüm yüzde değerleri % KM bazındadır; mineraller hesap için
 * (% KM × 10) ile g/kg KM'ye çevrilir.
 *
 * Bilimsel referanslar:
 *   NRC 2001 Tablo 14-6 (rasyon kompozisyon hedefleri)
 *   CNCPS v6.5 (CHO/protein dengesi)
 *   Mertens 1997 (peNDF)
 */

import {
  MCP_INTESTINAL_DIGESTIBILITY,
  RDP_TO_MCP_EFFICIENCY,
  TDN_TO_MCP_FRACTION,
} from '../core/constants.js';
import { feedIntakeDiscountFactor } from '../core/nrc2001.js';
import { MICROBIAL_AA, EAA_LIST, RUP_AA_DEFAULTS } from '../core/aminoAcids.js';  // FAZ 14.4 + Tam EAA: mikrobiyal AA + RUP varsayılanları
import { faCoefPerKgDM } from '../core/fattyAcids.js';  // FAZ 14.10: PUFA/ω6/ω3 katsayıları
import { calcUEL } from '../core/inra2018.js';  // C2: INRA 2018 UEL doluluk kısıtı (system='INRA2018')

// glpk.js sabitlerinin kendi kopyası — Worker / Node bağımsız test için
export const GLP = {
  MIN: 1, MAX: 2,
  FR: 1, LO: 2, UP: 3, DB: 4, FX: 5,
};

// FAZ 14.2: İz mineral anahtarları — LP kısıt döngüsü ve dışa aktarım için
// (NRC 2001 Tablo 6-2; yem alan adları feedLibrary.json ile birebir).
export const TRACE_MINERAL_KEYS = ['zn', 'cu', 'mn', 'se', 'fe', 'i', 'co'];

// FAZ 14.3: Vitamin anahtarları (yağda çözünen — Vit A/D/E LP kısıtları için).
// Yem değerleri IU/kg KM (vitA/vitD/vitE) + bcarotene mg/kg KM.
// β-karoten Vit A öncüsü — sığır biyolojik dönüşüm: 1 mg = 200 IU Vit A
// (Schweigert 2003; vitamins.js bcaroteneToVitA fonksiyonuyla tutarlı).
export const VITAMIN_KEYS = ['vitA', 'vitD', 'vitE'];
export const BCAROTENE_TO_VITA_IU_PER_MG = 200;

// ─── Yardımcı: koşullu kısıt ekle ────────────────────────────────────────────

function pushConstraint(subjectTo, { name, vars, lb, ub }) {
  let type, bnds;
  const hasLB = lb !== undefined && lb !== null && !Number.isNaN(lb);
  const hasUB = ub !== undefined && ub !== null && !Number.isNaN(ub);
  if (hasLB && hasUB) {
    type = (lb === ub) ? GLP.FX : GLP.DB;
    bnds = { type, lb, ub };
  } else if (hasLB) {
    type = GLP.LO;
    bnds = { type, lb, ub: 0 };
  } else if (hasUB) {
    type = GLP.UP;
    bnds = { type, lb: 0, ub };
  } else {
    return; // anlamsız kısıt — yok say
  }
  subjectTo.push({ name, vars, bnds });
}

// ─── LP problemi oluştur ─────────────────────────────────────────────────────

/**
 * Rasyon dengeleme LP problemi oluştur.
 *
 * @param {object} input
 * @param {FeedIngredient[]} input.feeds — kullanılabilir yem maddeleri
 * @param {number} input.dmi_kg — Hedef KMT (kg/gün)
 * @param {object} input.requirements — NRC 2001 bazlı gereksinimler
 *   @param {number} requirements.nel_mcal           — toplam NEL (Mcal/gün)
 *   @param {object} requirements.cp_pct             — {min, max} % KM
 *   @param {object} [requirements.rup_pct]          — {min} % KM (CP içinden)
 *   @param {object} [requirements.rdp_pct]          — FAZ 14.5: {min, max} % KM (CP içinden, rumen-yıkılabilir)
 *   @param {object} [requirements.ndf_pct]          — {min, max} % KM
 *   @param {object} [requirements.adf_pct]          — {min} % KM
 *   @param {object} [requirements.nfc_pct]          — {max} % KM
 *   @param {object} [requirements.starch_pct]       — FAZ 14.6: {max} % KM (asidoz/SARA önleme)
 *   @param {object} [requirements.sugar_pct]        — FAZ 14.6: {max} % KM (MFD önleme)
 *   @param {object} [requirements.fat_pct]          — FAZ 14.6: {max} % KM (rumen lif sindirimi)
 *   @param {object} [requirements.pufa_pct]         — FAZ 14.10: {max} % KM (PUFA/MFD önleme)
 *   @param {number} [requirements.n6n3_ratio_max]   — FAZ 14.10: ω6:ω3 oran üst sınırı (lineerleştirilmiş)
 *   @param {object} [requirements.peNDF_pct]        — {min} % KM
 *   @param {object} [requirements.forage_pct]       — {min, max} % KM kaba yem
 *   @param {number} [requirements.ca_g]             — Ca (g/gün) min
 *   @param {number} [requirements.p_g]              — P  (g/gün) min
 *   @param {number} [requirements.mg_g]
 *   @param {number} [requirements.k_g]
 *   @param {number} [requirements.na_g]
 *   @param {number} [requirements.s_g]              — S  (g/gün) min
 *   @param {number} [requirements.s_g_max]
 *   @param {number} [requirements.cl_g]
 *   @param {object} [requirements.dcad_meq]         — {min, max} mEq/100g KM
 *   @param {object} [requirements.traceMinerals]    — FAZ 14.2: iz mineral aralıkları
 *     {[key in 'zn'|'cu'|'mn'|'se'|'fe'|'i'|'co']?: { min?: mg/gün, max?: mg/gün }}
 *     Yem değerleri mg/kg KM (`f.zn`, `f.cu`, ...) → coef doğrudan kullanılır.
 *   @param {object} [requirements.vitamins]         — FAZ 14.3: vitamin aralıkları
 *     {[key in 'vitA'|'vitD'|'vitE']?: { min?: IU/gün, max?: IU/gün }}
 *     Yem değerleri IU/kg KM. Vit A için β-karoten (mg/kg KM) × 200 IU dönüşümü
 *     coefficient'e dahil edilir (Schweigert 2003 sığır biyolojik dönüşüm).
 *   @param {object} [requirements.aminoAcids]       — FAZ 14.4: amino asit gereksinimleri
 *     { lys_g?: { min?: g/gün }, met_g?: { min?: g/gün } }
 *     Coefficient `aaPerKgDM(feed, system)` ile yem-başına Lys/Met tedariki (g/kg KM).
 * @param {string} [input.system='NASEM2021'] — FAZ 14.4: mikrobiyal AA içerik kaynağı (AA kısıtları için)
 * @param {object} [input.feedLimits] — yem-özgü min/max katılım (% KM veya kg)
 *   {[feedId]: { min, max, minPct, maxPct, type? }}
 *   FAZ 14.11 MILP: type='semicontinuous' → yem ya 0 ya [min,max] kg (premiks min-order);
 *   type='integer' → yem miktarı tamsayı kg (lot/çuval). glpk.solve() otomatik MIP çözer.
 * @param {object} [input.groupLimits] — FAZ 14.7: kategori-bazlı kümülatif kg KM limitleri
 *   {[category]: { min?, max? }} — category ∈ roughage|grain|byproduct|protein|fat|mineral
 * @param {string} [input.objective='cost'] — 'cost' | 'minDM' (tek amaç, geriye uyumlu)
 * @param {Array}  [input.objectives] — FAZ 14.12: çok amaçlı [{type, weight}]
 *   type ∈ 'cost'|'minDM'|'mfd_risk'|'aa_balance'. Verilirse normalize edilmiş weighted
 *   sum (ölçek-bağımsız; ağırlık = saf öncelik). objective string'i yok sayılır.
 * @param {number} [input.dmiSlack=0.03] — KMT kısıtı esnekliği (±oran).
 *   FAZ 13.3: 0 → tam eşitlik (eski FX davranışı); 0.03 → ±%3 bant (DB).
 *   Tam eşitlik LP'yi sık infeasible yapıyordu; ±%3 slack ~%30 azaltır.
 * @returns {object} glpk.solve() ile uyumlu LP problem objesi
 */
export function buildRationLP(input) {
  const {
    feeds,
    dmi_kg,
    requirements = {},
    feedLimits = {},
    groupLimits = {},       // FAZ 14.7: kategori-bazlı kümülatif kg KM limitleri
    objective = 'cost',
    objectives = null,      // FAZ 14.12: çok amaçlı [{type, weight}] (verilirse weighted sum)
    dmiSlack = 0.03,
    system = 'NASEM2021',   // FAZ 14.4: AA kısıtları mikrobiyal Lys/Met içerik kaynağı
    intakeMultiple = 1,     // FAZ 24.3: Yem-spesifik iskonto için tüketim katı
    cncpsCoef = null,       // FAZ 19.1b: CNCPS hesap modu — per-feed MP havuz katsayıları (feed.id → {mpEnergyPool,mpRdpPool,mpRUP,mpTotal}); yoksa NRC sabit mpComponentsPerKgDM
  } = input;

  if (!Array.isArray(feeds) || feeds.length === 0) {
    throw new Error('buildRationLP: feeds dizisi boş olamaz');
  }
  if (!dmi_kg || dmi_kg <= 0) {
    throw new Error('buildRationLP: dmi_kg pozitif olmalı');
  }

  // ─── Karar değişkenleri ────────────────────────────────────────────────
  // xi : yem i için KM miktarı (kg/gün)
  // Her yemin değişken adı yem ID'sinden türetilir (glpk için güvenli isim)
  const varNames = feeds.map(f => `x_${sanitizeId(f.id)}`);

  // ─── Amaç fonksiyonu ───────────────────────────────────────────────────
  // FAZ 14.12: çok amaçlı (weighted sum). objectives verilirse normalize edilmiş
  // ağırlıklı toplam; verilmezse eski tek amaç (cost | minDM) — geriye uyumlu.
  let objectiveVars;
  const multiObjective = Array.isArray(objectives) && objectives.length > 0;
  if (multiObjective) {
    // Her amaç tipi için yem-başına ham katsayıları hesapla + normalize faktörü
    // (max|coef|). Normalizasyon ölçek farkını giderir → ağırlık = saf öncelik
    // (cost ~5-20 TL, mfd_risk ~%KM, aa_balance ~g/kg farklı ölçekler).
    const normFactor = {};
    for (const { type } of objectives) {
      if (normFactor[type] !== undefined) continue;
      let maxAbs = 1e-9;
      for (const f of feeds) maxAbs = Math.max(maxAbs, Math.abs(objectiveCoef(f, type, system)));
      normFactor[type] = maxAbs;
    }
    objectiveVars = feeds.map((f, i) => {
      let coef = 0;
      for (const { type, weight } of objectives) {
        coef += (num(weight, 1)) * objectiveCoef(f, type, system) / normFactor[type];
      }
      return { name: varNames[i], coef };
    });
  } else {
    objectiveVars = feeds.map((f, i) => ({
      name: varNames[i],
      coef: objectiveCoef(f, objective, system),
    }));
  }

  // ─── Kısıtlar ──────────────────────────────────────────────────────────
  const subjectTo = [];

  // 1. KMT kısıtı (FAZ 13.3): tam eşitlik yerine ±dmiSlack bant
  //    dmi_kg×(1−slack) ≤ Σ xi ≤ dmi_kg×(1+slack)
  //    Tam eşitlik (FX) çağrıların %20-30'unda infeasibility yapıyordu;
  //    ±%3 slack solver'a fizibilite alanı tanır (~%30 azalma).
  //    dmiSlack=0 verilirse eski FX davranışına döner (lb===ub → FX).
  const slack = Number.isFinite(dmiSlack) && dmiSlack > 0 ? dmiSlack : 0;
  pushConstraint(subjectTo, {
    name: 'DMI',
    vars: varNames.map(n => ({ name: n, coef: 1 })),
    lb: dmi_kg * (1 - slack),
    ub: dmi_kg * (1 + slack),
  });

  // 2. NEL: Σ (xi × nel_i) ≥ nel_required (üst sınır opsiyonel)
  // FAZ 17.2: ham f.nel yerine effectiveNel — yem-bazlı nelDiscount LP'ye uygulanır.
  // FAZ 24.3: Yem-spesifik tüketim-düzeyi enerji iskontosu (feedIntakeDiscountFactor) 
  // yüksek tüketimde her kg yemin ETKİN NEL'i düşer.
  if (requirements.nel_mcal !== undefined) {
    pushConstraint(subjectTo, {
      name: 'NEL',
      vars: feeds.map((f, i) => {
        const feedDiscount = feedIntakeDiscountFactor(f, intakeMultiple);
        return { name: varNames[i], coef: effectiveNel(f) * feedDiscount };
      }),
      lb: requirements.nel_mcal,
      ub: requirements.nel_mcal_max, // opsiyonel — verilmezse min-cost zaten aşırılığa gitmez
    });
  }

  // 3. CP (% KM) — Σ (xi × cp_i) [≥ ≤] cp_pct × dmi
  //
  // TASARIM NOTU (FAZ 12 #7 + Rasyon Kurucu #1): CP artık VARSAYILAN bir hedef
  // DEĞİLDİR — protein yeterliliği MP (metabolize edilebilir protein) kısıtıyla
  // belirlenir (DEFAULT_COMPOSITION'da cp_pct yok). Bu blok kasıtlı korunur:
  // yalnızca kullanıcı "İleri Kısıtlar"dan EXPLICIT bir CP aralığı girerse
  // tetiklenir (rationOptimizer yalnız `userHasCpOverride` olduğunda
  // requirements.cp_pct geçirir). Yani yarım kalmış bir temizlik değil, opt-in
  // bir gelişmiş kısıttır — SİLMEYİN (makro-override özelliğini bozar).
  if (requirements.cp_pct) {
    const { min, max } = requirements.cp_pct;
    pushConstraint(subjectTo, {
      name: 'CP',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.cp) })),
      lb: min !== undefined ? min * dmi_kg : undefined,
      ub: max !== undefined ? max * dmi_kg : undefined,
    });
  }

  // 4. RUP minimum (% KM) — Σ (xi × cp_i × rup_i/100) ≥ rup_min × dmi
  // RUP yem analizinde % CP olarak verilmiştir — KM bazına çevir
  if (requirements.rup_pct?.min !== undefined) {
    pushConstraint(subjectTo, {
      name: 'RUP_min',
      vars: feeds.map((f, i) => ({
        name: varNames[i],
        coef: num(f.cp) * num(f.rup) / 100,
      })),
      lb: requirements.rup_pct.min * dmi_kg,
    });
  }

  // 4c. RDP aralığı (% KM) — FAZ 14.5 — Σ (xi × cp_i × rdp_i/100) [≥ ≤] rdp × dmi
  // RDP (rumen-degradable protein) = CP × RDP%/100; yem rdp alanı % CP olarak verilir.
  // MIN: rumen mikrobiyal protein sentezi için yeterli yıkılabilir N (NRC 2001 Böl. 3);
  // MAX: aşırı RDP → fazla rumen amonyağı → idrar N kaybı/üre yükü (opsiyonel üst sınır).
  if (requirements.rdp_pct) {
    const { min, max } = requirements.rdp_pct;
    pushConstraint(subjectTo, {
      name: 'RDP',
      vars: feeds.map((f, i) => ({
        name: varNames[i],
        coef: num(f.cp) * num(f.rdp) / 100,
      })),
      lb: min !== undefined ? min * dmi_kg : undefined,
      ub: max !== undefined ? max * dmi_kg : undefined,
    });
  }

  // 4b. MP (Metabolize Edilebilir Protein) — FAZ 10A + FAZ 18.1 (rasyon-düzeyi MCP)
  // NRC 2001 Bölüm 3: MP supply = mikrobiyal MP + RUP MP
  //   mikrobiyal MP = 0.64 × MCP,  MCP = min(TDN_g × 0.13, RDP_g × 0.85)  ← RASYON düzeyinde
  //   MP_RUP = CP × 10 × (RUP%/100) × (rupIntD/100)
  //
  // FAZ 18.1: Eskiden `min(enerji,RDP)` HER YEM için ayrı alınıp toplanıyordu
  // (`Σ min ≤ min Σ` → sistematik düşük tahmin, tamamlayıcı yem sinerjisi kaybı:
  // mısır enerjisi + üre RDP). Artık rasyon düzeyinde alınır. Lineerliği korumak için
  // `MP_RUP + 0.64·min(ΣE, ΣR) ≥ req` İKİ lineer kısıta açılır (tam denk):
  //   (1) Σ(mpRUP + mpEnergyPool)·x ≥ req   (enerji-havuz yolu)
  //   (2) Σ(mpRUP + mpRdpPool)·x   ≥ req     (RDP-havuz yolu)
  // İkisi de sağlanırsa min(E,R)-yolu da ≥ req olur (min ≤ her iki havuz). MILP gerekmez.
  if (requirements.mp_g !== undefined) {
    // FAZ 19.1b: CNCPS hesap modunda per-feed havuz katsayıları cncpsCoef'ten (pasaj-bağımlı)
    // gelir; yoksa NRC sabit mpComponentsPerKgDM (varsayılan). Şekil bire bir uyumlu
    // ({mpEnergyPool, mpRdpPool, mpRUP, mpTotal}) → kısıt YAPISI değişmez, yalnız katsayı kaynağı.
    const cncpsFor = (f) => (cncpsCoef && f && f.id != null) ? cncpsCoef[f.id] : null;
    const comps = feeds.map((f) => cncpsFor(f) || mpComponentsPerKgDM(f));
    // FAZ 18.4 (denetim): tüketim-düzeyi iskontosu TDN'i düşürür → TDN-türevli enerji-havuz
    // mikrobiyal MP'si de iskonto edilir (NRC 2001: MCP üretim-düzeyi TDN'den). RDP-havuz
    // (N-türevli) ve mpRUP (bypass) etkilenmez.
    // FAZ 24.2: CNCPS modunda ölçülü yemlerin enerji havuzu fermente-CHO tabanlıdır ve pasaj-bağımlı
    // hesaplandığı için sindirim düşüşünü (intake depression) içerir. Bu nedenle isCncpsEnergy=true
    // olan yemlerde discount 1.0 alınır (çifte sayımı önlemek için).
    // FAZ 24.3: Yem-spesifik discount (feedIntakeDiscountFactor).
    const getDiscount = (f) => feedIntakeDiscountFactor(f, intakeMultiple);

    pushConstraint(subjectTo, {
      name: 'MP',  // enerji-havuz yolu
      vars: feeds.map((f, i) => {
        const fd = comps[i].isCncpsEnergy ? 1 : getDiscount(f);
        return { name: varNames[i], coef: comps[i].mpRUP + comps[i].mpEnergyPool * fd };
      }),
      lb: requirements.mp_g,
    });
    pushConstraint(subjectTo, {
      name: 'MP_RDP',  // RDP-havuz yolu
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: comps[i].mpRUP + comps[i].mpRdpPool })),
      lb: requirements.mp_g,
    });
    // Üst sınır (opsiyonel, kullanıcı override) — SAHA-DENETİM A düzeltmesi.
    // Raporlanan MP = mpRUP + min(ΣE, ΣR) (rasyon-düzeyi, FAZ 18.1 ile min'e geçti).
    // ESKİ tek `MP_max` per-feed Σ mpTotal = Σ[mpRUPᵢ + min(Eᵢ,Rᵢ)] kullanıyordu; bu büyüklük
    // Σmin(Eᵢ,Rᵢ) ≤ min(ΣE,ΣR) olduğundan raporlanandan KÜÇÜK → raporlanan MP "hard" üst sınırı
    // sinerji boşluğu kadar AŞABİLİYORDU (min rasyon-düzeyine çıkarılmış, max per-feed bırakılmıştı).
    // Bir min'i ÜSTTEN bağlamak konveks değildir (disjonksiyon → MILP). Güvenli LP karşılığı:
    // İKİ havuzu da bağla → mpRUP+ΣE ≤ ub AND mpRUP+ΣR ≤ ub ⟹ mpRUP+min(ΣE,ΣR) ≤ ub (min ≤ her havuz).
    // Katsayılar MP / MP_RDP ALT sınır kısıtlarıyla BİREBİR aynı (discount dahil) → raporlanan
    // mp_g garanti ≤ ub; MP arzı [req, max] bandına oturur. MP alt sınırı zaten iki havuzu req'e
    // yakın tuttuğundan aşırı-kısıtlama pratikte ihmal edilebilir (NRC modunda comps[i] = mpComponents,
    // CNCPS modunda yakınsamış cncpsCoef havuzları).
    if (requirements.mp_g_max !== undefined) {
      pushConstraint(subjectTo, {
        name: 'MP_max',  // enerji-havuz yolu üst sınırı (MP min kısıtı ile aynı katsayı)
        vars: feeds.map((f, i) => {
          const fd = comps[i].isCncpsEnergy ? 1 : getDiscount(f);
          return { name: varNames[i], coef: comps[i].mpRUP + comps[i].mpEnergyPool * fd };
        }),
        ub: requirements.mp_g_max,
      });
      pushConstraint(subjectTo, {
        name: 'MP_RDP_max',  // RDP-havuz yolu üst sınırı (MP_RDP min kısıtı ile aynı katsayı)
        vars: feeds.map((f, i) => ({ name: varNames[i], coef: comps[i].mpRUP + comps[i].mpRdpPool })),
        ub: requirements.mp_g_max,
      });
    }
  }

  // 5. NDF aralığı
  if (requirements.ndf_pct) {
    const { min, max } = requirements.ndf_pct;
    pushConstraint(subjectTo, {
      name: 'NDF',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.ndf) })),
      lb: min !== undefined ? min * dmi_kg : undefined,
      ub: max !== undefined ? max * dmi_kg : undefined,
    });
  }

  // 6. ADF (min + opsiyonel max — çift-taraflı band: kullanıcı override)
  if (requirements.adf_pct?.min !== undefined) {
    pushConstraint(subjectTo, {
      name: 'ADF_min',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.adf) })),
      lb: requirements.adf_pct.min * dmi_kg,
    });
  }
  if (requirements.adf_pct?.max !== undefined) {
    pushConstraint(subjectTo, {
      name: 'ADF_max',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.adf) })),
      ub: requirements.adf_pct.max * dmi_kg,
    });
  }

  // 7. NFC (max + opsiyonel min — çift-taraflı band: kullanıcı override)
  if (requirements.nfc_pct?.max !== undefined) {
    pushConstraint(subjectTo, {
      name: 'NFC_max',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.nfc) })),
      ub: requirements.nfc_pct.max * dmi_kg,
    });
  }
  if (requirements.nfc_pct?.min !== undefined) {
    pushConstraint(subjectTo, {
      name: 'NFC_min',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.nfc) })),
      lb: requirements.nfc_pct.min * dmi_kg,
    });
  }

  // 7b. Starch / Sugar / Fat (% KM) — FAZ 14.6 + çift-taraflı band düzeltmesi
  //   Rumen sağlığı ÜST sınırları (NFC alt bileşenleri + yağ):
  //     Starch max ~%28 KM — yüksek nişasta → rumen asidozu (SARA), düşük pH
  //     Sugar max  ~%8 KM   — aşırı şeker → hızlı fermentasyon, süt yağ depresyonu (MFD)
  //     Fat max    ~%7 KM   — aşırı yağ → rumen lif sindirimi baskılanması (NRC 2001)
  //   Σ(xi × nutrient_i) ≤ max × dmi (UP tipi). Yem değerleri % KM.
  //   ALT sınır (min) yalnız kullanıcı override'ı ile gelir (varsayılan tek-taraflı):
  //   arayüz (constraintRow) her kısıtta min+max kutusu sunar → motor da İKİ tarafı onurlandırır.
  //   (Aksi halde kullanıcının girdiği min sessizce yok sayılırdı — saha geri bildirimi.)
  if (requirements.starch_pct?.max !== undefined) {
    pushConstraint(subjectTo, {
      name: 'Starch_max',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.starch) })),
      ub: requirements.starch_pct.max * dmi_kg,
    });
  }
  if (requirements.starch_pct?.min !== undefined) {
    pushConstraint(subjectTo, {
      name: 'Starch_min',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.starch) })),
      lb: requirements.starch_pct.min * dmi_kg,
    });
  }
  if (requirements.sugar_pct?.max !== undefined) {
    pushConstraint(subjectTo, {
      name: 'Sugar_max',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.sugar) })),
      ub: requirements.sugar_pct.max * dmi_kg,
    });
  }
  if (requirements.sugar_pct?.min !== undefined) {
    pushConstraint(subjectTo, {
      name: 'Sugar_min',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.sugar) })),
      lb: requirements.sugar_pct.min * dmi_kg,
    });
  }
  if (requirements.fat_pct?.max !== undefined) {
    pushConstraint(subjectTo, {
      name: 'Fat_max',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.fat) })),
      ub: requirements.fat_pct.max * dmi_kg,
    });
  }
  if (requirements.fat_pct?.min !== undefined) {
    pushConstraint(subjectTo, {
      name: 'Fat_min',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.fat) })),
      lb: requirements.fat_pct.min * dmi_kg,
    });
  }

  // 7c. PUFA max + ω6:ω3 oran kısıtları (FAZ 14.10)
  //   PUFA (çoklu doymamış yağ asitleri = C18:2 + C18:3): aşırı miktar rumen
  //   biyohidrojenasyon kapasitesini aşar → trans-FA artar → süt yağ depresyonu (MFD).
  //   Tipik üst sınır ~%5 KM (rumen unsaturated FA yükü). Coefficient faCoefPerKgDM (% KM).
  if (requirements.pufa_pct?.max !== undefined) {
    pushConstraint(subjectTo, {
      name: 'PUFA_max',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: faCoefPerKgDM(f).pufa })),
      ub: requirements.pufa_pct.max * dmi_kg,
    });
  }
  if (requirements.pufa_pct?.min !== undefined) {  // çift-taraflı band: kullanıcı override
    pushConstraint(subjectTo, {
      name: 'PUFA_min',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: faCoefPerKgDM(f).pufa })),
      lb: requirements.pufa_pct.min * dmi_kg,
    });
  }
  //   ω6:ω3 oranı (linoleik / α-linolenik) ≤ R — süt kalitesi (düşük oran anti-inflamatuvar).
  //   Oran kısıtı LİNEERLEŞTİRİLMİŞ: Σω6/Σω3 ≤ R ⟺ Σ(xi × (ω6_i − R×ω3_i)) ≤ 0.
  //   (ω3 > 0 olduğu sürece geçerli; opsiyonel — kullanıcı süt kalitesi için ekler.)
  if (requirements.n6n3_ratio_max !== undefined) {
    const R = requirements.n6n3_ratio_max;
    pushConstraint(subjectTo, {
      name: 'n6n3_ratio',
      vars: feeds.map((f, i) => {
        const fa = faCoefPerKgDM(f);
        return { name: varNames[i], coef: fa.omega6 - R * fa.omega3 };
      }),
      ub: 0,
    });
  }

  // 7d. Maliyet üst sınırı (FAZ 14.13) — Σ(xi × maliyet_i) ≤ cost_max (TL/gün).
  //   Kullanıcı bütçe tavanı koyabilir; coefficient cost objective ile aynı (objectiveCoef).
  if (requirements.cost_max !== undefined && requirements.cost_max > 0) {
    pushConstraint(subjectTo, {
      name: 'Cost_max',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: objectiveCoef(f, 'cost') })),
      ub: requirements.cost_max,
    });
  }

  // 7e. TMR nem / kuru madde hedefi (#4) — rasyon DM% bandı (LİNEER, MILP gerekmez).
  //   Rasyon DM% = Σxi / Σ(xi×100/dmᵢ) × 100  (xi = kg KM, dmᵢ = yem KM %).
  //   Lineerleştirme (her ikisi de xi cinsinden lineer):
  //     DM ≥ a  ⟺  Σ xi·(1 − a/dmᵢ) ≥ 0   (rasyon yeterince kuru; aşırı yaş yemi sınırlar)
  //     DM ≤ b  ⟺  Σ xi·(1 − b/dmᵢ) ≤ 0   (rasyon yeterince yaş; KURU yem-ağırlıklı LP'yi
  //                                          silaj/yaş yem eklemeye iter → su rasyondan gelir)
  //   requirements.tmr_dm_pct = { min:a, max:b } (KM %). Nem hedefi rationOptimizer'da
  //   moisture→DM çevrilir (DM = 100 − nem). dmᵢ yoksa 90 varsayılır.
  if (requirements.tmr_dm_pct) {
    const { min: dmMin, max: dmMax } = requirements.tmr_dm_pct;
    if (dmMin !== undefined && dmMin > 0) {
      pushConstraint(subjectTo, {
        name: 'TMR_DM_min',
        vars: feeds.map((f, i) => ({ name: varNames[i], coef: 1 - dmMin / (num(f.dm) || 90) })),
        lb: 0,
      });
    }
    if (dmMax !== undefined && dmMax > 0) {
      pushConstraint(subjectTo, {
        name: 'TMR_DM_max',
        vars: feeds.map((f, i) => ({ name: varNames[i], coef: 1 - dmMax / (num(f.dm) || 90) })),
        ub: 0,
      });
    }
  }

  // PROBLEMLER #3: "Rasyondan min nem" — hedef TMR neminin (T) en az M%'i rasyon hammaddelerinden.
  //   Düz nem bandından farklı: rasyon kendi suyuyla M payını verir, kalanı dışarıdan SU ile (su
  //   miktarı rationOptimizer.composeResult'ta hesaplanır). Kuru dönemde (kuru hammaddeler) düz
  //   bandın infeasibility sorununu çözer.
  //   Lineer: ration_su ≥ M/(100−T)·ΣDM  ⟺  Σ xi·[(100−dmᵢ)/dmᵢ − M/(100−T)] ≥ 0  (dmᵢ, M, T = %).
  const tmrRM = requirements.tmr_min_ration_moisture;
  if (tmrRM && Number.isFinite(tmrRM.min) && Number.isFinite(tmrRM.target)
    && tmrRM.min > 0 && tmrRM.target > 0 && tmrRM.target < 100) {
    const thr = tmrRM.min / (100 - tmrRM.target);
    pushConstraint(subjectTo, {
      name: 'TMR_ration_moisture_min',
      vars: feeds.map((f, i) => {
        const dm = num(f.dm) || 90;
        return { name: varNames[i], coef: (100 - dm) / dm - thr };
      }),
      lb: 0,
    });
  }

  // 8. peNDF min (CNCPS — Mertens 1997: ≥%22 KM)
  // peNDF = NDF × pef; pef: roughage=1.0, concentrate=0.42, fat/mineral=0
  if (requirements.peNDF_pct?.min !== undefined) {
    pushConstraint(subjectTo, {
      name: 'peNDF_min',
      vars: feeds.map((f, i) => ({
        name: varNames[i],
        // C1: yem-spesifik pef alanı varsa kullan (Penn State analizi), yoksa kategori fallback
        coef: num(f.ndf) * pef(f),
      })),
      lb: requirements.peNDF_pct.min * dmi_kg,
    });
  }
  if (requirements.peNDF_pct?.max !== undefined) {  // çift-taraflı band: kullanıcı override
    pushConstraint(subjectTo, {
      name: 'peNDF_max',
      vars: feeds.map((f, i) => ({
        name: varNames[i],
        coef: num(f.ndf) * pef(f),
      })),
      ub: requirements.peNDF_pct.max * dmi_kg,
    });
  }

  // 9. Kaba yem oranı
  if (requirements.forage_pct) {
    const { min, max } = requirements.forage_pct;
    pushConstraint(subjectTo, {
      name: 'Forage',
      vars: feeds.map((f, i) => ({
        name: varNames[i],
        coef: f.category === 'roughage' ? 1 : 0,
      })),
      lb: min !== undefined ? (min / 100) * dmi_kg : undefined,
      ub: max !== undefined ? (max / 100) * dmi_kg : undefined,
    });
  }

  // 10. Mineral kısıtları — Σ (xi × mineral_pct_i × 10) ≥ required_g
  //  ekonomi: xi (kg) × pct/100 × 1000 g/kg = xi × pct × 10
  addMineralConstraint(subjectTo, feeds, varNames, 'Ca', 'ca', requirements.ca_g);
  addMineralConstraint(subjectTo, feeds, varNames, 'P', 'p', requirements.p_g);
  addMineralConstraint(subjectTo, feeds, varNames, 'Mg', 'mg', requirements.mg_g);
  addMineralConstraint(subjectTo, feeds, varNames, 'K', 'k', requirements.k_g);
  addMineralConstraint(subjectTo, feeds, varNames, 'Na', 'na', requirements.na_g);
  addMineralConstraint(subjectTo, feeds, varNames, 'Cl', 'cl', requirements.cl_g);

  // S için min + max aralığı
  if (requirements.s_g !== undefined || requirements.s_g_max !== undefined) {
    pushConstraint(subjectTo, {
      name: 'S',
      vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f.s) * 10 })),
      lb: requirements.s_g,
      ub: requirements.s_g_max,
    });
  }

  // 10b. Ca/P Oranı (Kalsiyum/Fosfor)
  // Oran = Ca / P. Lineerleştirilmiş hali:
  // Ca / P >= min  <=>  Ca - min * P >= 0
  // Ca / P <= max  <=>  Ca - max * P <= 0
  if (requirements.ca_p_ratio) {
    if (requirements.ca_p_ratio.min !== undefined) {
      const R_min = requirements.ca_p_ratio.min;
      pushConstraint(subjectTo, {
        name: 'Ca_P_min',
        vars: feeds.map((f, i) => ({
          name: varNames[i],
          coef: (num(f.ca) * 10) - R_min * (num(f.p) * 10),
        })),
        lb: 0,
      });
    }
    if (requirements.ca_p_ratio.max !== undefined) {
      const R_max = requirements.ca_p_ratio.max;
      pushConstraint(subjectTo, {
        name: 'Ca_P_max',
        vars: feeds.map((f, i) => ({
          name: varNames[i],
          coef: (num(f.ca) * 10) - R_max * (num(f.p) * 10),
        })),
        ub: 0,
      });
    }
  }

  // 11. DCAD (mEq/100g KM): [(Na/23 + K/39) − (Cl/35.5 + S/16)] × 1000
  // Net mEq/100g = Σ (xi × dcad_coef_i) / dmi
  // Σ (xi × dcad_coef_i) [≥ ≤] dcad_target × dmi
  if (requirements.dcad_meq) {
    const { min, max } = requirements.dcad_meq;
    pushConstraint(subjectTo, {
      name: 'DCAD',
      vars: feeds.map((f, i) => ({
        name: varNames[i],
        coef: dcadCoefPerKgDM(f),
      })),
      lb: min !== undefined ? min * dmi_kg : undefined,
      ub: max !== undefined ? max * dmi_kg : undefined,
    });
  }

  // 11b. INRA 2018 UEL doluluk kapasitesi kısıtı — C2 (system='INRA2018')
  //
  // INRA sisteminin NRC/NASEM'den temel farkı: rumen doluluk (fill) kısıtı.
  // UEL (Unité d'Encombrement Lait): her yem için Mcal/kg yerine "doluluk birimi".
  // İnek günde en fazla `uel_capacity` UEL tüketebilir (rumen kapasitesi sınırı).
  // Kısıt: Σ(xi[kg KM] × uel_i[UEL/kg KM]) ≤ uel_capacity[UEL/gün]
  //
  // Bu kısıt olmadan "INRA seçili" ama LP yalnız NASEM parametreleriyle çalışır
  // → kullanıcı yanıltılırdı (eski durum). Artık INRA'nın doluluk yönetimi aktif.
  //
  // requirements.uel_capacity: calcAllRequirements → calcUELCapacity(animal) tarafından
  // hesaplanır ve rationOptimizer'da requirements nesnesine eklenir.
  // calcUEL(f): yem-spesifik inraUEL varsa kullan, yoksa NDF/kategori-bazlı yaklaşım.
  if (system === 'INRA2018' && requirements.uel_capacity != null && requirements.uel_capacity > 0) {
    pushConstraint(subjectTo, {
      name: 'UEL_capacity',
      vars: feeds.map((f, i) => ({
        name: varNames[i],
        coef: calcUEL(f),  // UEL/kg KM — yem-spesifik veya NDF-bazlı
      })),
      ub: requirements.uel_capacity,
    });
  }

  // 12. İz mineral kısıtları (FAZ 14.2) — Zn / Cu / Mn / Se / Fe / I / Co
  //   Yem değerleri mg/kg KM (`f.zn`, `f.cu`, ...) → katsayı doğrudan kullanılır.
  //   Birim: Σ(xi[kg] × mineral_i[mg/kg]) = mg/gün ↔ requirements.traceMinerals.{key}.{min,max} [mg/gün]
  //
  //   NRC 2001 Tablo 6-2 değerleri:
  //     Zn ≥40, Cu ≥10, Mn ≥20, Se ≥0.30, Fe ≥50, I ≥0.40, Co ≥0.11 (mg/kg KM)
  //   Üst sınır toksisite koruması: Cu max 40, Se max 2, Fe max 500 (mg/kg KM) tipik.
  //
  //   Not: yem veritabanında I/Co kapsamı zayıf (~%1) — mineral premikslere bağımlı.
  //   Yemlerde değer yoksa kısıt sıkı olur; FAZ 14.8 soft constraint bunu çözecek.
  if (requirements.traceMinerals) {
    for (const key of TRACE_MINERAL_KEYS) {
      const range = requirements.traceMinerals[key];
      if (!range) continue;
      const { min, max } = range;
      if (min === undefined && max === undefined) continue;
      pushConstraint(subjectTo, {
        name: `trace_${key}`,
        vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f[key]) })),
        lb: min,
        ub: max,
      });
    }
  }

  // 13. Vitamin kısıtları (FAZ 14.3) — yağda çözünen Vit A, D, E (IU/gün)
  //   Yem değerleri IU/kg KM (`f.vitA`, `f.vitD`, `f.vitE`); β-karoten mg/kg KM (`f.bcarotene`).
  //   Vit A için β-karoten dönüşümü coefficient'e dahil edilir:
  //     coef_vitA_i = vitA_i + bcarotene_i × 200 IU/mg  (Schweigert 2003 sığır)
  //   Birim: Σ(xi[kg] × coef_i[IU/kg]) = IU/gün ↔ requirements.vitamins.{key}.{min,max} [IU/gün]
  //
  //   NASEM 2021 Bölüm 8 değerleri (laktasyon, 600 kg inek):
  //     Vit A min 54000–90000 IU/gün, Vit D min 13200–18000, Vit E min 360–480
  //   Geçiş döneminde artırılır (vitamins.js calcVitaminRequirements döner).
  //
  //   Veritabanı kapsamı: Vit A/D/β-karoten çoğunlukla premikslere bağımlı (~%1.4).
  //   Vit E yağlı tohumlar/silajda da var (~%27). Graceful fallback (rationOptimizer)
  //   yemde hiç değer yoksa o kısıtı atlayarak regresyonu önler.
  if (requirements.vitamins) {
    for (const key of VITAMIN_KEYS) {
      const range = requirements.vitamins[key];
      if (!range) continue;
      const { min, max } = range;
      if (min === undefined && max === undefined) continue;
      pushConstraint(subjectTo, {
        name: `vit_${key}`,
        vars: feeds.map((f, i) => {
          // Vit A: yem vitA IU/kg + β-karoten mg/kg × 200 IU/mg (β-karoten → Vit A dönüşümü)
          const coef = key === 'vitA'
            ? num(f.vitA) + num(f.bcarotene) * BCAROTENE_TO_VITA_IU_PER_MG
            : num(f[key]);
          return { name: varNames[i], coef };
        }),
        lb: min,
        ub: max,
      });
    }
  }

  // 14. Amino asit kısıtları (FAZ 14.4) — Lizin (Lys) + Metiyonin (Met), g/gün
  //   Yem-başına tedarik katsayısı aaPerKgDM(feed, system) (g AA/kg KM):
  //     mikrobiyal MP × MICROBIAL_AA + RUP MP × yem AA% (intD bir kez — çift sayım yok)
  //   LP kısıtı: Σ(xi[kg] × aa_i[g/kg]) ≥ AA_required[g/gün]
  //
  //   AA gereksinimi calcAATargets(animal) ile dinamik (NASEM 2021 + Schwab 2019):
  //     lys_req = mp_required × lysPctMP/100; met_req = mp_required × metPctMP/100
  //   Yetersiz Lys/Met → infeasible (kullanıcı RPLys/RPMet eklemeye yönlendirilir;
  //   rumen-korumalı AA yemleri yüksek lys/met değerleriyle çözümü mümkün kılar).
  if (requirements.aminoAcids) {
    // FAZ 18.3: Lys/Met/His. Tam EAA Katman B: 7 EAA opt-in (yalnız requirements.aminoAcids'te
    // {aa}_g varsa — buildAminoAcidRequirement onları yalnız kullanıcı override edince ekler).
    // Coefficient aaPerKgDM(...)[field] (g AA/kg KM). Loop guard'ı zaten "range yoksa atla".
    const aaMap = {
      lys_g: { field: 'lys', name: 'Lys' },
      met_g: { field: 'met', name: 'Met' },
      his_g: { field: 'his', name: 'His' },
      arg_g: { field: 'arg', name: 'Arg' },
      thr_g: { field: 'thr', name: 'Thr' },
      ile_g: { field: 'ile', name: 'Ile' },
      leu_g: { field: 'leu', name: 'Leu' },
      val_g: { field: 'val', name: 'Val' },
      phe_g: { field: 'phe', name: 'Phe' },
      trp_g: { field: 'trp', name: 'Trp' },
    };
    for (const reqKey of Object.keys(aaMap)) {
      const range = requirements.aminoAcids[reqKey];
      if (!range) continue;
      const { min, max } = range;
      if (min === undefined && max === undefined) continue;
      const { field, name } = aaMap[reqKey];
      pushConstraint(subjectTo, {
        name,
        vars: feeds.map((f, i) => ({ name: varNames[i], coef: aaPerKgDM(f, system)[field] })),
        lb: min,
        ub: max,
      });
    }
  }

  // ─── Bireysel yem sınırları ──────────────────────────────────────────
  // bounds[] yerine subjectTo'da tek-değişkenli kısıt olarak ekliyoruz.
  // glpk.js bazı versiyonlarda bounds[] ile presolve hatalı sonuç veriyor;
  // tek-değişkenli kısıtlar her durumda doğru çalışıyor.
  //
  // İki format desteklenir:
  //   { min, max }       — kg KM/gün (doğrudan LP değişkeni birimiyle eşleşir)
  //   { minPct, maxPct } — % KMT (eski format, geriye uyumluluk)
  // FAZ 14.11: MILP değişken türleri — semi-continuous & integer.
  // binaries[]/generals[] dizileri glpk.solve()'a iletilir (glpk otomatik branch-and-bound).
  const binaries = [];
  const generals = [];

  // ─── Değişken sınırları (bounds) — FAZ 13.4 ──────────────────────────
  // glpk.js varsayılan olarak değişkenleri GLP_FR (serbest, −∞..+∞) kabul eder.
  // Negatif katılımı imkânsız kılıyoruz.
  const bounds = varNames.map(name => ({
    name,
    type: GLP.LO,   // alt sınır: lb sonlu, ub = +∞ (yok sayılır)
    lb: 0,
    ub: 0,
  }));

  feeds.forEach((f, i) => {
    const lim = feedLimits[f.id];
    if (!lim) return;
    const varName = varNames[i];

    let lb, ub;

    // 1) kg KM bazlı limitler (öncelikli)
    const minKg = num(lim.min, NaN);
    const maxKg = num(lim.max, NaN);
    if (Number.isFinite(minKg) && minKg > 0) lb = minKg;
    if (Number.isFinite(maxKg) && maxKg > 0) ub = maxKg;

    // 2) Yüzde bazlı limitler (geriye uyumluluk — kg yoksa kullan)
    if (lb === undefined) {
      const minPct = num(lim.minPct, NaN);
      if (Number.isFinite(minPct) && minPct > 0) lb = (minPct / 100) * dmi_kg;
    }
    if (ub === undefined) {
      const maxPct = num(lim.maxPct, NaN);
      if (Number.isFinite(maxPct) && maxPct < 100) ub = (maxPct / 100) * dmi_kg;
    }

    // FAZ 14.11: MILP değişken türleri — semi-continuous & integer.
    // Taze (as_fed) bazındaysa, x_af değişkeni yarat ve hedef değişken (targetVar) yap.
    const isAsFed = (lim.basis === 'as_fed' && (lim.type === 'semicontinuous' || lim.type === 'integer'));
    let targetVar = varName;
    if (isAsFed) {
      targetVar = `${varName}_af`;
      const dmRatio = num(f.dm, 100) / 100;
      // x_af >= 0 alt sınırı
      bounds.push({ name: targetVar, type: GLP.LO, lb: 0, ub: 0 });
      // x_dm - x_af * dmRatio = 0
      pushConstraint(subjectTo, {
        name: `link_af_${sanitizeId(f.id)}`,
        vars: [{ name: varName, coef: 1 }, { name: targetVar, coef: -dmRatio }],
        lb: 0, ub: 0
      });
    }

    // glpk semi-continuous tipini exposed etmediği için binary "big-M" formülasyonu:
    //   y ∈ {0,1};  x ≤ ub·y  (y=0 → x=0);  x ≥ lb·y  (y=1 → x≥lb)
    // Standart limit kısıtı eklenmez (yerini bu iki kısıt alır).
    if (lim.type === 'semicontinuous' && lb !== undefined && ub !== undefined && lb > 0) {
      const yName = `y_${sanitizeId(f.id)}`;
      binaries.push(yName);
      pushConstraint(subjectTo, {
        name: `sc_max_${sanitizeId(f.id)}`,
        vars: [{ name: targetVar, coef: 1 }, { name: yName, coef: -ub }],
        ub: 0,  // x − ub·y ≤ 0
      });
      pushConstraint(subjectTo, {
        name: `sc_min_${sanitizeId(f.id)}`,
        vars: [{ name: targetVar, coef: 1 }, { name: yName, coef: -lb }],
        lb: 0,  // x − lb·y ≥ 0
      });
      return;
    }

    // FAZ 14.11: Integer — yem miktarı tamsayı kg (lot/çuval bazlı satın alma)
    if (lim.type === 'integer') {
      generals.push(targetVar);
    }

    if (lb === undefined && ub === undefined) return;
    pushConstraint(subjectTo, {
      name: `limit_${sanitizeId(f.id)}`,
      vars: [{ name: targetVar, coef: 1 }],
      lb,
      ub,
    });
  });

  // ─── Yem grup (kategori) kısıtları — FAZ 14.7 ─────────────────────────
  // Kümülatif kategori limitleri (kg KM/gün): "tüm protein konsantreleri ≤ 8 kg",
  // "kaba yem toplamı ≥ 12 kg" gibi. groupLimits = { [category]: { min, max } }.
  // Coefficient: yem o kategoriye aitse 1, değilse 0 → Σ(kategori yemleri) [≥≤] limit.
  // Birim doğrudan kg KM (LP değişken birimiyle eşleşir; % değil).
  for (const [category, lim] of Object.entries(groupLimits)) {
    if (!lim) continue;
    const min = num(lim.min, NaN);
    const max = num(lim.max, NaN);
    const hasMin = Number.isFinite(min) && min > 0;
    const hasMax = Number.isFinite(max) && max > 0;
    if (!hasMin && !hasMax) continue;
    pushConstraint(subjectTo, {
      name: `group_${sanitizeId(category)}`,
      vars: feeds.map((f, i) => ({
        name: varNames[i],
        coef: f.category === category ? 1 : 0,
      })),
      lb: hasMin ? min : undefined,
      ub: hasMax ? max : undefined,
    });
  }

  const lp = {
    name: 'RationLP',
    objective: {
      direction: GLP.MIN,
      name: multiObjective ? 'multiObjective' : (objective === 'cost' ? 'totalCost' : 'totalDM'),
      vars: objectiveVars,
    },
    subjectTo,
    bounds,  // FAZ 13.4: her yem ≥ 0 (negatif katılım engellenir)
    // İz amaçlı — solver kullanmaz
    _meta: {
      feedIds: feeds.map(f => f.id),
      varNames,
      dmi_kg,
      objective,
      dmiSlack: slack,  // FAZ 13.3: uygulanan KMT slack oranı
    },
  };

  // FAZ 14.11: MILP — binary/integer değişkenler varsa glpk.solve() MIP olarak çözer.
  // Boş diziler eklenmez (saf LP performansı korunur; relaxLP/findIIS de bunları taşır).
  if (binaries.length) lp.binaries = binaries;
  if (generals.length) lp.generals = generals;

  return lp;
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * FAZ 17.2: Etkin NEL — yem-bazlı manuel enerji iskontosu uygulanmış değer.
 *
 * `feed.nelDiscount` (%) yüksek tüketim düzeyinde (NRC 2001 "3× idame") enerji
 * sindirilebilirliğindeki düşüşü temsil eder. Eskiden bu alan toplanıp HİÇ
 * kullanılmıyordu (dekoratif "kayıt"); artık LP'ye uygulanır:
 *   effectiveNel = nel × (1 − clamp(nelDiscount, 0..100) / 100)
 *
 * Tutarlılık için aynı etkin değer (a) LP enerji kısıtında, (b) NEL'den TDN
 * türetiminde (mikrobiyal protein, mpComponentsPerKgDM) ve (c) ulaşılan
 * kompozisyon NEL toplamında (rationOptimizer.aggregateComposition) kullanılır.
 *
 * NOT: Bu MANUEL/yem-bazlı iskontodur. OTOMATIK tüketim-düzeyi iskonto
 * (rasyon DMI/idame oranından türetilen) FAZ 18.4'te eklenecektir.
 *
 * @param {object} feed
 * @returns {number} Mcal/kg KM (iskonto uygulanmış NEL)
 */
export function effectiveNel(feed) {
  const nel = num(feed.nel);
  const disc = Math.min(100, Math.max(0, num(feed.nelDiscount)));
  return disc > 0 ? nel * (1 - disc / 100) : nel;
}

function sanitizeId(id) {
  // glpk değişken adları için: yalnızca alfanumerik + alt çizgi
  return String(id).replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Fiziksel Etkinlik Faktörü (PEF) — Mertens 1997
 *
 * Öncelik sırası:
 *   1. Yem-spesifik `feed.pef` (Penn State Particle Separator ölçümü, 0-100 aralığı).
 *      Gerçek parçacık boyutu analizi olan yemlerde (kaba yem, silaj) yem-spesifik
 *      değer kategori varsayılanından çok daha doğrudur.
 *   2. Kategori varsayılanı (yem-spesifik değer yoksa fallback).
 *
 * @param {object|string} feedOrCategory - Yem nesnesi (f) veya geriye-uyumlu kategori string'i
 * @returns {number} PEF (0-1 arası; 1 = tam etkin)
 */
function pef(feedOrCategory) {
  // Geriye uyumluluk: string geçilirse kategori-bazlı varsayılan kullan
  const category = typeof feedOrCategory === 'string' ? feedOrCategory : feedOrCategory?.category;
  const feed = typeof feedOrCategory === 'object' ? feedOrCategory : null;

  // 1. Yem-spesifik PEF (Penn State Particle Separator; % → 0-1)
  if (feed) {
    const pefVal = Number(feed.pef);
    if (Number.isFinite(pefVal) && pefVal > 0) {
      return Math.min(1.0, pefVal / 100);  // % → 0-1 fraction
    }
  }

  // 2. Kategori fallback — Mertens 1997
  switch (category) {
    case 'roughage': return 1.00;
    case 'byproduct': return 0.50;
    case 'protein': return 0.42;
    case 'grain': return 0.42;
    case 'fat':
    case 'mineral':
    default: return 0.00;
  }
}

/**
 * Amaç fonksiyonu yem-başına katsayısı (FAZ 14.12 çok amaçlı).
 * Her tip MINIMIZE edilir (negatif coef = o özelliği maksimize et).
 *
 *   cost     — maliyet (TL/kg KM): ucuz rasyon
 *   minDM    — toplam KM: az yem
 *   mfd_risk — süt yağ depresyonu riski PROXY (Bauman-Griinari 2003):
 *              PUFA + 0.5×şeker − 0.3×peNDF (yüksek = riskli → minimize)
 *   aa_balance — amino asit yeterliliği: −(Lys + 2×Met) (Met sınırlayıcı, ağırlıklı;
 *              negatif → AA tedariğini maksimize, dengesizliği azaltır)
 *
 * Not: mfd_risk ve aa_balance LİNEER PROXY'lerdir (gerçek MFD/AA-denge formülleri
 * lineer değil); weighted-sum LP için pratik yaklaşımlar.
 *
 * @param {object} feed
 * @param {string} type
 * @param {string} [system='NASEM2021']
 * @returns {number} katsayı
 */
function objectiveCoef(feed, type, system = 'NASEM2021') {
  switch (type) {
    case 'cost': {
      const price = num(feed.pricePerTon);
      const dmFraction = (num(feed.dm) || 90) / 100;
      return (price / 1000) / dmFraction;
    }
    case 'minDM':
      return 1;
    case 'mfd_risk': {
      const fa = faCoefPerKgDM(feed);   // pufa %KM
      const sugar = num(feed.sugar);    // %KM
      const peNDF = num(feed.ndf) * pef(feed.category);  // %KM
      return fa.pufa + 0.5 * sugar - 0.3 * peNDF;
    }
    case 'aa_balance': {
      const aa = aaPerKgDM(feed, system);  // g/kg KM
      return -(aa.lys + 2 * aa.met);       // negatif → AA maksimize (Met ağırlıklı)
    }
    default:
      return 0;
  }
}

/**
 * Kategori-bazlı RUP intestinal sindirilebilirlik varsayılan (FAZ 10H)
 * NRC 2001 Tablo 15-2b: yem-spesifik rupIntD yoksa kullanılır.
 *
 * Değerler konservatif kategori ortalamasını yansıtır:
 *   protein:   75 (soya 88-92, kanola 70-75, pamuk 50-55, DDGS 60-65 → karışık ort.)
 *   grain:     85 (mısır 90, buğday 85, arpa 80 → tipik orta)
 *   byproduct: 70 (şeker pancarı posası 75, mısır gluten unu 85, bira posası 55)
 *   roughage:  60 (CNCPS v6.5 referans; alfalfa 65, çayır otu 55, mısır silajı 60)
 *   fat/mineral: 0 (protein içermez)
 *
 * UYARI: Yüksek varsayılan (eski: protein=88) MP arzını abartır. Yem-spesifik
 * `rupIntD` değeri girilirse bu fonksiyon hiç çağrılmaz (öncelikli).
 */
function rupIntDByCategory(category) {
  switch (category) {
    case 'protein': return 75;   // konservatif kategori ortalaması (eski: 88 — soya-bias)
    case 'grain': return 85;
    case 'byproduct': return 70;
    case 'roughage': return 60;  // CNCPS v6.5 referans (eski: 65)
    case 'fat':
    case 'mineral': return 0;
    default: return 75;          // bilinmeyen kategori → protein varsayılanıyla aynı
  }
}

// #1: req sayı (min) VEYA { min, max } olabilir (kullanıcı makro mineral override'ı).
// Σ(xi × mineral_pct_i × 10) g/gün cinsinden min/max bandı.
function addMineralConstraint(subjectTo, feeds, varNames, label, key, req) {
  if (req === undefined || req === null) return;
  const min = (typeof req === 'object') ? req.min : req;
  const max = (typeof req === 'object') ? req.max : undefined;
  if ((min === undefined || min === null) && (max === undefined || max === null)) return;
  pushConstraint(subjectTo, {
    name: label,
    vars: feeds.map((f, i) => ({ name: varNames[i], coef: num(f[key]) * 10 })),
    lb: min,
    ub: max,
  });
}

/**
 * Bir yemin MP bileşenleri (g/kg KM): { mpMicrobial, mpRUP, mpTotal, mpEnergyPool, mpRdpPool }
 * FAZ 13.2: mpPerKgDM aslında bu fonksiyonun toplamı; bileşenlere ihtiyaç
 * duyan callers (rationOptimizer.computeAminoAcids) buradan ayrı alır.
 *
 * Pipeline boyunca tek sabit MCP_INTESTINAL_DIGESTIBILITY (0.64).
 *
 * FAZ 18.1: `mpEnergyPool` / `mpRdpPool` per-feed havuz katkılarıdır (mikrobiyal MP
 * cinsinden, ×0.64 uygulanmış). Rasyon-düzeyinde mikrobiyal MP = min(Σ mpEnergyPool,
 * Σ mpRdpPool) — per-feed `mpMicrobial` toplamından düşük DEĞİL (tamamlayıcı yem
 * sinerjisi). `mpMicrobial` (per-feed min) geriye uyumluluk + üst sınır için korunur.
 *
 * @param {object} feed
 * @returns {{ mpMicrobial:number, mpRUP:number, mpTotal:number, mpEnergyPool:number, mpRdpPool:number }}
 *   Tüm değerler g MP / kg KM birimindedir.
 */
export function mpComponentsPerKgDM(feed) {
  const cp_g = num(feed.cp) * 10;                  // % KM → g/kg KM
  const rdpPct = num(feed.rdp, 65);                  // % CP (default 65)
  const rupPct = num(feed.rup, 35);                  // % CP (default 35)
  // FAZ 10H: rupIntD yem-spesifik; yoksa kategori-bazlı varsayılan
  let intD = num(feed.rupIntD, 0);
  if (intD === 0) intD = rupIntDByCategory(feed.category);

  // TDN tahmini: yem girdisinde yoksa NEL'den oransal türet
  // NRC 2001: NEL (Mcal/kg KM) ≈ 0.0245 × TDN% − 0.12 → TDN ≈ (NEL+0.12) × 40.8
  // FAZ 17.2: NEL'den türetilen TDN de etkin (iskontolu) NEL kullanır — iskonto
  // enerji düşüklüğünü temsil ettiğinden TDN-bağımlı mikrobiyal protein de tutarlı düşer.
  let tdnPct = num(feed.tdn);
  if (tdnPct === 0) {
    const nel = effectiveNel(feed);
    tdnPct = nel > 0 ? Math.min(95, Math.max(40, (nel + 0.12) * 40.8)) : 65;
  }
  const tdn_g = tdnPct * 10;                          // % KM → g/kg KM

  const rdp_g = cp_g * (rdpPct / 100);                // g RDP / kg KM
  const mcpEnergyLimited = tdn_g * TDN_TO_MCP_FRACTION;  // g MCP (enerji-sınırlı)
  const mcpRdpLimited = rdp_g * RDP_TO_MCP_EFFICIENCY;  // g MCP (RDP-sınırlı)
  const mcp_g = Math.min(mcpEnergyLimited, mcpRdpLimited);
  const mpMicrobial_g = mcp_g * MCP_INTESTINAL_DIGESTIBILITY;  // FAZ 13.2 sabit

  const rup_g = cp_g * (rupPct / 100);                // g RUP / kg KM
  const mpRUP_g = rup_g * (intD / 100);

  return {
    mpMicrobial: mpMicrobial_g,
    mpRUP: mpRUP_g,
    mpTotal: mpMicrobial_g + mpRUP_g,
    // FAZ 18.1: rasyon-düzeyi MCP havuzları (mikrobiyal MP cinsinden, ×0.64)
    mpEnergyPool: mcpEnergyLimited * MCP_INTESTINAL_DIGESTIBILITY,  // enerji-sınırlı mikrobiyal MP
    mpRdpPool: mcpRdpLimited * MCP_INTESTINAL_DIGESTIBILITY,     // RDP-sınırlı mikrobiyal MP
  };
}

/**
 * Bir yemin MP (metabolize edilebilir protein) içeriği (g MP / kg KM)
 * NRC 2001 Bölüm 3 formülü.
 *
 * Sürecin iki bileşeni:
 *   1. Mikrobiyal MP (MCP × intestinal sindirilebilirlik)
 *      MCP_g = min(TDN_g × 0.13, RDP_g × 0.85)
 *      MP_microbial_g = MCP_g × 0.64  (FAZ 13.2 — CNCPS v6.5 + NASEM 2021)
 *   2. RUP'tan gelen MP
 *      MP_RUP_g = CP_g × (RUP/100) × (IntD/100)
 *
 * Birim: g MP per kg KM yem
 *
 * @param {object} feed
 * @returns {number} g MP / kg KM
 */
export function mpPerKgDM(feed) {
  return mpComponentsPerKgDM(feed).mpTotal;
}

/**
 * Bir yemin Lys / Met tedarik katsayısı (g AA / kg KM) — FAZ 14.4
 *
 * LP'nin Lys/Met kısıtları için yem-başına LİNEER katsayı. İki bileşen:
 *   1. Mikrobiyal AA  = mpMicrobial[g/kg] × (MICROBIAL_AA[system].lys veya met)/100
 *   2. RUP AA         = mpRUP[g/kg] × (feed.lys veya feed.met % protein)/100
 *
 * ÖNEMLİ (FAZ 14.4 bilimsel saflık): `mpComponentsPerKgDM` zaten mpRUP'u
 * intestinal sindirilebilirlik (intD) ile çarparak SİNDİRİLMİŞ MP olarak döndürür.
 * Bu nedenle intD burada İKİNCİ KEZ uygulanmaz (eski computeAminoAcids → calcAASupply
 * yolu intD'yi iki kez uyguluyordu → çift sayım; FAZ 14.4'te düzeltildi).
 * Sonuç LP coefficient'i ile rationOptimizer'ın rapor ettiği AA tedariki birebir tutarlı.
 *
 * FAZ 18.3: His eklendi (kritik 3. AA). Yem DB'sinde his yalnız ~%2 yemde ölçülü
 * (çoğu ana protein kaynağı) → eksik yemlerde tipik RUP His (%2.3) varsayılır; His
 * tedarikinin büyük kısmı mikrobiyal proteinden gelir (MICROBIAL_AA[system].his).
 *
 * @param {object} feed
 * @param {string} [system='NASEM2021'] — mikrobiyal AA içerik kaynağı (NRC2001 | NASEM2021)
 * @returns {{ lys: number, met: number, his: number }} g AA / kg KM
 */
export function aaPerKgDM(feed, system = 'NASEM2021') {
  const comp = mpComponentsPerKgDM(feed);             // { mpMicrobial, mpRUP } g/kg (mpRUP sindirilmiş)
  const mcpAA = MICROBIAL_AA[system] || MICROBIAL_AA.NASEM2021;
  // Tam EAA (Katman B): 10 AA katsayısı = mikrobiyal (MCP×profil) + RUP (yem-spesifik veya
  // RUP_AA_DEFAULTS). Lys/Met/His birebir korunur (RUP_AA_DEFAULTS.lys/met/his = 6.5/2.0/2.3 =
  // eski varsayılanlar). 7 EAA yalnız kullanıcı override edince LP kısıtı olur (aaMap opt-in).
  const out = {};
  for (const aa of EAA_LIST) {
    const rupPct = num(feed[aa], RUP_AA_DEFAULTS[aa]);
    out[aa] = comp.mpMicrobial * (mcpAA[aa] ?? RUP_AA_DEFAULTS[aa] ?? 0) / 100 + comp.mpRUP * rupPct / 100;
  }
  return out;
}

/**
 * Bir yemin DCAD katsayısı (mEq/100g KM)
 * [(Na/23 + K/39) − (Cl/35.5 + S/16)] × 1000 mEq/100g KM
 *
 * LP kısıtı: Σ (xi[kg] × Di[mEq/100g]) [≥ ≤] Dtarget × DMI[kg]
 * Bu birimle Σ(xi×Di)/DMI = rasyon DCAD (mEq/100g KM) bazında.
 */
export function dcadCoefPerKgDM(feed) {
  const na = num(feed.na), k = num(feed.k), cl = num(feed.cl), s = num(feed.s);
  return ((na / 23) + (k / 39) - (cl / 35.5) - (s / 16)) * 1000;
}

// FAZ 17.5: `lpSummary` (insan-okunabilir LP debug dökümü) KALDIRILDI — üretimde
// hiçbir yerde kullanılmıyordu (yalnız export + test); Son Kontrol Raporu §6/§8.9
// "ölü export" bulgusu. Gerekirse git geçmişinden geri alınabilir.
