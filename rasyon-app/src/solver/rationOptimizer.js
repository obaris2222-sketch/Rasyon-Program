/**
 * Rasyon Optimizasyon API — Üst Seviye
 *
 * Girdi: animal profili + kullanılabilir yemler + kısıtlar
 * Çıktı: optimize edilmiş rasyon + tam besin profili + uyumluluk raporu
 *
 * Pipeline:
 *   1. calcDMI()                       — KMT tahmini
 *   2. calcNELRequirements()           — NEL gereksinimi
 *   3. calcMPRequirements()            — MP gereksinimi
 *   4. calcMineralRequirements()       — Mineral gereksinimleri
 *   5. buildRationLP()                 — LP problem oluştur
 *   6. solveLP()                       — glpk.js ile çöz
 *   7. compose result                  — yem miktarları + besin özetleri
 */

import { calcAARequirements, calcAASupply, assessAABalance, recommendRPAA, calcAATargets, EAA_LIST, RUP_AA_DEFAULTS } from '../core/aminoAcids.js';
import { simulateRumenPH24h } from '../core/rumenDynamics.js';
import { aggregateCNCPSSubFractions, cncpsFeedSupply, cncpsRationInputs, calcPassageRates } from '../core/cncps.js';  // FAZ 16.3: alt fraksiyonlar; FAZ 19.1: iteratif motor arz API
import { aggregateStarchDigestion, interpretRumenStarch } from '../core/starch.js';  // FAZ 16.4: nişasta rumen/bağırsak sindirimi
import { aggregateMycotoxins, interpretMycotoxinRisk, aggregateSilageQuality } from '../core/feedQuality.js';  // FAZ 16.6: mikotoksin + silaj kalitesi
import { estimateRationFA, estimateMilkFA, assessFAProfile, faCoefPerKgDM } from '../core/fattyAcids.js';
import { calcAllRequirements } from '../core/animalRequirements.js';
import { adjustDMIForFill } from '../core/dmi.js';  // FAZ 18.2: tüketim-duyarlı (NDF doluluk) KMT
import { getIntakeMultiple, feedIntakeDiscountFactor } from '../core/nrc2001.js';  // FAZ 18.4 + 24.3: tüketim-düzeyi enerji iskontosu
import { milkFeverRisk } from '../core/dcad.js';  // FAZ 13.8: süt humması risk skoru
import { methaneMoraes2014, methaneNiu2018, methaneIntensity, methaneCO2eq, interpretMethane, CH4_ENERGY_MCAL_PER_KG } from '../core/methane.js';  // FAZ 16.2: enterik metan emisyonu
import { buildRationLP, mpPerKgDM, mpComponentsPerKgDM, aaPerKgDM, effectiveNel, TRACE_MINERAL_KEYS, VITAMIN_KEYS, BCAROTENE_TO_VITA_IU_PER_MG, GLP } from './lpBuilder.js';
import { solveLP } from './glpkSolver.js';
import { relaxLP, extractViolations, describeViolations } from './softConstraints.js';  // FAZ 14.8
import { findIIS, describeIIS } from './infeasibilityDiagnosis.js';  // FAZ 14.9
import { computeSensitivity } from './sensitivity.js';  // FAZ 20.1: gölge fiyat + azaltılmış maliyet
import { aggregateINRA, interpretINRABalance } from '../core/inra2018.js';  // FAZ 16.1: INRA 2018 rapor

// FAZ 9A: kompozisyon mantığı ve dinamik düzeltmeler artık animalRequirements.js'te.
// Geriye uyumluluk için re-export ediliyor (tests, rationBuilder UI kullanıyor).
export { DEFAULT_COMPOSITION, compositionForStage } from '../core/animalRequirements.js';

// FAZ 18.2: Tüketim-duyarlı KMT yeniden-çöz eşiği. Doluluk (NDF fill) düzeltmesi KMT'yi
// bu orandan FAZLA düşürürse (>%3) düzeltilmiş KMT ile bir kez yeniden çözülür; küçük
// düşüşlerde (ör. tipik orta-NDF rasyon) ilk çözüm korunur (gereksiz re-solve yok).
const FILL_RESOLVE_THRESHOLD = 0.03;


// ─── Ana fonksiyon ───────────────────────────────────────────────────────────

/**
 * Rasyonu optimize et.
 * @param {object} input
 *   @param {object}  input.animal — AnimalProfile şeması
 *   @param {FeedIngredient[]} input.feeds — kullanılabilir yemler
 *   @param {object} [input.composition] — kompozisyon hedefleri (default kullanır)
 *   @param {object} [input.feedLimits]   — yem-özgü min/max katılım
 *   @param {string} [input.objective='cost'] — 'cost' | 'minDM'
 *   @param {string} [input.dmiMethod='auto'] — FAZ 17.3: 'auto' → bilim sistemine göre (NASEM/INRA→deSouza2019, NRC→NRC2001)
 *   @param {string} [input.system='NASEM2021'] — FAZ 13.1: bilim sistemi (NASEM 2021 default)
 * @returns {Promise<RationResult>}
 */
export async function optimizeRation(input) {
  const {
    animal,
    feeds,
    composition = {},
    feedLimits = {},
    groupLimits = {},           // FAZ 14.7: kategori-bazlı kümülatif kg KM limitleri
    objective = 'cost',
    objectives = null,          // FAZ 14.12: çok amaçlı [{type, weight}] (verilirse weighted sum)
    costMax = undefined,        // FAZ 14.13: maliyet üst sınırı (TL/gün, opsiyonel)
    dmiMethod = 'auto',         // FAZ 17.3: bilim sistemiyle tutarlı (calcAllRequirements çözer)
    preset = 'recommended',     // FAZ 12 Madde 8: Sıkı/Önerilen/Geniş
    system,                     // FAZ 13.1: bilim sistemi seçimi (varsayılan NASEM 2021)
    dmiSlack,                   // denetim #7: KMT tolerans bandı (±oran); verilmezse buildRationLP default 0.03
    hardConstraints = [],       // #2: "zorunlu" işaretli kısıtlar (infeasibility'de gevşetilmez)
    relaxPriority,              // FAZ 22.1: kullanıcı gevşetme öncelik sırası (opsiyonel; verilmezse RELAX_PRIORITY default)
    autoEnergyDiscount = false, // FAZ 18.4: tüketim-düzeyi enerji iskontosu (UI'da varsayılan açık; solver'da opt-in → mevcut testler bozulmaz)
    calcMode = 'nrc',           // FAZ 19.1c: 'nrc' (tek-geçiş, varsayılan) | 'cncps' (iteratif mekanistik motor — pasaj-bağımlı MP arzı)
    _returnPrep = false,        // FAZ 20.2 (dahili): true → çözmeden hazırlanan LP+gereksinimleri döndür (sürü-geneli birleşik LP için)
    _dmiOverride,               // FAZ 18.2 (dahili): doluluk-düzeltmeli KMT (2. geçiş); dışarıdan verilmez
  } = input;

  if (!animal) throw new Error('optimizeRation: animal zorunlu');
  if (!Array.isArray(feeds) || feeds.length === 0) {
    throw new Error('optimizeRation: feeds dizisi gerekli');
  }

  // 1-5. FAZ 12 Madde 5: Tek kaynak gereksinim hesabı (+ Madde 8 preset, FAZ 13.1 system)
  // FAZ 18.2: _dmiOverride (2. geçiş doluluk-düzeltmeli KMT) varsa hayvan-bazlı KMT yerine kullanılır.
  const reqs = calcAllRequirements(animal, { dmiMethod, preset, system, dmiOverride: _dmiOverride });
  const { dmi, nel, mp, minerals, traceMinerals, vitamins, water, aaTargets, compTargets: stageDefaults, system: usedSystem } = reqs;
  const dmi_kg = dmi.dmi;

  // FAZ 18.4: Tüketim-düzeyi enerji iskontosu — açıksa KMT/idame oranından çarpan (≤1).
  // Aynı KMT'ye bağlı olduğundan 18.2'nin 2-pass'ında her geçiş güncel dmi_kg ile yeniden
  // hesaplanır (ekstra iterasyon gerekmez; iskonto deterministik f(dmi_kg, bw)).
  const intakeMultiple = autoEnergyDiscount ? getIntakeMultiple(dmi_kg, num(animal.bw)) : 1;

  const comp = { ...stageDefaults, ...composition };
  // FAZ 12 Madde 6: NEL & MP user-override (boşsa hesaplanan değer)
  // FAZ 12 Madde 7: CP default'ta LP kısıtı olarak gönderilmez (MP belirleyici).
  //                 Kullanıcı `composition.cp_pct` ile EXPLICIT override ederse LP'ye geçer.
  const userHasCpOverride = composition && composition.cp_pct !== undefined;

  // FAZ 14.2: İz mineral LP kısıtları (Zn/Cu/Mn/Se/Fe/I/Co).
  // calcTraceMinerals(dmi).{key}.{minMgDay,maxMgDay} → requirements.traceMinerals.{key}.{min,max}
  // composition.traceMinerals user-override önceliklidir; verilmezse calcAllRequirements'tan.
  //
  // Graceful fallback: yemlerin hiçbirinde ilgili mineral için değer yoksa o kısıt
  // LP'ye eklenmez (kaynak veri yetersizliği aşırı infeasibility yaratmasın diye).
  // Bu, gerçek dünyada premix kullanımıyla aktive olur; iz mineral içermeyen
  // yem setiyle test yapılırken regresyon yaratmaz.
  const { requirement: traceReq, missing: traceMissing } = buildTraceRequirement(traceMinerals, composition?.traceMinerals, feeds);

  // FAZ 14.3: Vitamin LP kısıtları (Vit A/D/E, IU/gün).
  // calcVitaminRequirements(animal, period).{vitA,vitD,vitE}.{minIU,maxIU} → LP {min,max}
  // composition.vitamins user-override önceliklidir; aynı graceful fallback paterni
  // (yem + premix toplam katkısı, Vit A için β-karoten dönüşümü dahil).
  const { requirement: vitaminReq, missing: vitaminMissing } = buildVitaminRequirement(vitamins, composition?.vitamins, feeds);

  // ŞEFFAFLIK (denetim bulgusu): yem setinde hiç kaynağı olmayan iz mineral/vitamin
  // kısıtları LP'den çıkarılır (infeasibility kaçınma) — ama sessizce yutulmaz:
  // kullanıcıya "şu besinler için premiks/katkı gerekli" uyarısı olarak raporlanır.
  const TRACE_LABELS = { zn: 'Zn', cu: 'Cu', mn: 'Mn', se: 'Se', fe: 'Fe', i: 'I', co: 'Co' };
  const VIT_LABELS = { vitA: 'Vit A', vitD: 'Vit D', vitE: 'Vit E' };
  const missingSources = [
    ...traceMissing.map(m => ({ ...m, label: TRACE_LABELS[m.key] || m.key })),
    ...vitaminMissing.map(m => ({ ...m, label: VIT_LABELS[m.key] || m.key })),
  ];

  // FAZ 14.4: Amino asit (Lys/Met) LP kısıtları (g/gün).
  // calcAATargets(animal).{lys,met}.pctMP_min × mp.total / 100 → minimum AA gereksinimi.
  // Default'ta marjinal alt sınır (pctMP_min) kullanılır — gerçekten AA-fakir rasyonları
  // yakalar ama tipik dengeli rasyonları infeasible yapmaz. Kullanıcı composition.aminoAcids
  // ile hedef (pctMP) veya daha sıkı değer override edebilir (RP-AA yemleriyle çözülür).
  const aaReq = buildAminoAcidRequirement(aaTargets, mp.total, composition?.aminoAcids);

  // #4: TMR nem hedefi (kullanıcı nem %); LP'ye rasyon DM% bandına çevrilir (DM = 100 − nem).
  //   nem ∈ [m_min, m_max]  ⟹  DM ∈ [100−m_max, 100−m_min]
  //   Nem hedefi konursa yaş yem (silaj) zorunlu olur; üst-nem sınırı aşırı silajı engeller.
  const tmrMoisture = (comp.tmr_moisture_pct && (comp.tmr_moisture_pct.min != null || comp.tmr_moisture_pct.max != null))
    ? comp.tmr_moisture_pct : null;
  const tmrDm = tmrMoisture ? {
    min: tmrMoisture.max != null ? 100 - tmrMoisture.max : undefined,  // DM alt sınırı = 100 − nem üst
    max: tmrMoisture.min != null ? 100 - tmrMoisture.min : undefined,  // DM üst sınırı = 100 − nem alt
  } : null;

  // PROBLEMLER #3: yeni model — hedef TMR nemi (T) + rasyondan min nem (M, opsiyonel).
  //   Rasyon, hedef T'nin en az M payını KENDİ suyuyla verir (LP kısıtı); kalanı dışarıdan SU ile
  //   karşılanır (eklenecek su composeResult'ta hesaplanır). Kuru dönemde düz banddan daha esnek.
  const tmrTarget = num(comp.tmr_target_moisture);         // hedef TMR nemi %
  const tmrMinRation = num(comp.tmr_min_ration_moisture);  // rasyondan min nem %
  const tmrTargetValid = tmrTarget > 0 && tmrTarget < 100;

  // #1: makro mineral override — kullanıcı {min,max} (g/gün) girerse band; yoksa hesaplanan min
  // (sayı = eski davranış: yalnız min). lpBuilder.addMineralConstraint her iki formu da işler.
  const macroReq = (computed, ov) => (ov && (ov.min != null || ov.max != null))
    ? { min: ov.min ?? computed, max: ov.max } : computed;

  const requirements = {
    nel_mcal: comp.nel_mcal?.min ?? nel.total,
    // FAZ 14.13: NEL max default = gereksinim × 1.10 (aşırı enerji/yağlanma önleme).
    // Kullanıcı composition.nel_mcal.max ile override edebilir.
    nel_mcal_max: comp.nel_mcal?.max ?? round((comp.nel_mcal?.min ?? nel.total) * 1.10, 1),
    mp_g: comp.mp_g?.min ?? mp.total,
    mp_g_max: comp.mp_g?.max,
    rup_pct: comp.rup_pct,
    rdp_pct: comp.rdp_pct,   // FAZ 14.5: RDP min/max (default min %9 laktasyon)
    ndf_pct: comp.ndf_pct,
    adf_pct: comp.adf_pct,
    nfc_pct: comp.nfc_pct,
    starch_pct: comp.starch_pct,   // FAZ 14.6: asidoz/SARA üst sınırı (laktasyon max %28)
    sugar_pct: comp.sugar_pct,    // FAZ 14.6: MFD üst sınırı (max %8)
    fat_pct: comp.fat_pct,      // FAZ 14.6: rumen lif sindirimi (max %7)
    pufa_pct: comp.pufa_pct,     // FAZ 14.10: PUFA üst sınırı (laktasyon max %5, MFD)
    ...(comp.n6n3_ratio_max !== undefined ? { n6n3_ratio_max: comp.n6n3_ratio_max } : {}),  // FAZ 14.10: opsiyonel ω6:ω3 oran
    peNDF_pct: comp.peNDF_pct,
    forage_pct: comp.forage_pct,
    dcad_meq: comp.dcad_meq,
    ca_g: macroReq(minerals.ca.dietary, composition.ca),
    p_g: macroReq(minerals.p.total, composition.p),
    mg_g: macroReq(minerals.mg.total, composition.mg),
    k_g: macroReq(minerals.k.total, composition.k),
    na_g: macroReq(minerals.na.total, composition.na),
    s_g: composition.s?.min ?? minerals.s.minG,
    s_g_max: composition.s?.max ?? minerals.s.maxG,
    cl_g: macroReq(minerals.cl.minG, composition.cl),
    traceMinerals: traceReq,
    vitamins: vitaminReq,
    aminoAcids: aaReq,
    ...(costMax !== undefined ? { cost_max: costMax } : {}),  // FAZ 14.13: maliyet tavanı
    ...(tmrDm ? { tmr_dm_pct: tmrDm } : {}),                  // #4: TMR DM% bandı (LP)
    ...(tmrMoisture ? { tmr_moisture_pct: tmrMoisture } : {}),// #4: nem hedefi (teşhis gösterimi)
    ...(tmrTargetValid ? { tmr_target_moisture: tmrTarget } : {}),  // PROBLEMLER #3: hedef TMR nemi (su hesabı)
    ...((tmrTargetValid && tmrMinRation > 0) ? { tmr_min_ration_moisture: { min: tmrMinRation, target: tmrTarget } } : {}),  // PROBLEMLER #3: rasyondan min nem (LP)
    ...(userHasCpOverride ? { cp_pct: composition.cp_pct } : {}),
  };

  // FAZ 19.1c: CNCPS hesap modu — iteratif motor (Sequential LP / sabit-nokta) per-feed
  // pasaj-bağımlı MP havuz katsayılarını (cncpsCoef) belirler: warm-start (NRC) → çözümden
  // pasaj girdileri → calcPassageRates → cncpsFeedSupply → damping → yeniden çöz → yakınsama.
  // calcMode='nrc' (varsayılan) ise atlanır → mevcut tek-geçiş davranışı BİREBİR korunur.
  let cncpsCoef = null, cncpsInfo = null;
  if (calcMode === 'cncps') {
    const loop = await runCncpsLoop({
      feeds, dmi_kg, bw: num(animal.bw), requirements, feedLimits, groupLimits,
      objective, objectives, system: usedSystem, intakeMultiple, dmiSlack,
    });
    cncpsCoef = loop.coef;   // null → warm-start infeasible: NRC katsayılarına düşülür
    cncpsInfo = {
      mode: 'cncps', iterations: loop.iterations, converged: loop.converged,
      passageRates: loop.passageRates,
      ...(loop.reason ? { fallbackReason: loop.reason } : {}),
    };
  }

  // 6. LP problemini oluştur ve çöz (FAZ 14.4: system → AA mikrobiyal içerik kaynağı;
  //    FAZ 14.7: groupLimits → kategori-bazlı kümülatif kg limitleri;
  //    FAZ 19.1c: cncpsCoef varsa MP havuzları CNCPS-türevli pasaj-bağımlı katsayılar)
  const lp = buildRationLP({ feeds, dmi_kg, requirements, feedLimits, groupLimits, objective, objectives, system: usedSystem, intakeMultiple, ...(cncpsCoef ? { cncpsCoef } : {}), ...(dmiSlack !== undefined ? { dmiSlack } : {}) });

  // FAZ 20.2: Sürü-geneli birleşik LP — çözmeden hazırlanan LP + gereksinimleri döndür.
  // (herdOptimizer her grup için bunu çağırır, değişkenleri grup-bazlı yeniden adlandırıp
  // tek birleşik LP'ye birleştirir + ortak yem-stoğu kısıtı ekler.) calcMode='nrc' varsayılan.
  if (_returnPrep) {
    return {
      lp, requirements, dmi_kg, intakeMultiple, system: usedSystem, reqs, missingSources,
      dmi, nel, mp, minerals, traceMinerals, vitamins, water
    };
  }

  // GLP_UNDEF: presolve çözüm belirleyemedi → presol=false ile yeniden dene.
  // Tek kaynaktan (ana solve, relax, IIS) tutarlı undef davranışı (FAZ 14.9 robustluk).
  const solveWithRetry = async (lpArg) => {
    let s = await solveLP(lpArg);
    if (s.statusName === 'undef') s = await solveLP(lpArg, { presol: false });
    return s;
  };

  let solution = await solveWithRetry(lp);

  // 6b. FAZ 14.8: Soft constraint fallback — hard LP infeasible ise gevşetilebilir
  //     kısıtlara slack ekleyip yeniden çöz. Kullanıcıya hangi kısıtların ihlal
  //     edildiğini raporla (DCAD > peNDF > ... > iz mineral öncelik sırasıyla).
  let relaxation = null;
  if (!solution.optimal) {
    try {
      const { relaxedLP, slackMeta } = relaxLP(lp, { hardConstraints, priorityList: relaxPriority });
      const relaxedSol = await solveWithRetry(relaxedLP);
      if (relaxedSol.optimal) {
        const violations = extractViolations(relaxedSol, slackMeta);
        relaxation = {
          applied: true,
          violations,
          messages: describeViolations(violations),
        };
        // Gevşetilmiş çözümü kullan (kullanıcı bir rasyon görür); feasible=false kalır
        solution = relaxedSol;
      }
    } catch (err) {
      // Slack çözümü de başarısız → orijinal infeasible sonucu koru
      relaxation = { applied: false, error: err.message };
    }
  }

  // 6c. FAZ 14.9: IIS tanı — soft constraint bile çözemediyse (tamamen infeasible)
  //     hangi kısıtların BİRBİRİYLE çeliştiğini bul. Bu noktada kullanıcı ne uygun
  //     rasyon ne gevşetilmiş çözüm görüyor → çelişen minimal kısıt kümesi tek tanı.
  //     (Relax başarılıysa zaten violations raporu var; IIS'in O(n) maliyeti gereksiz.)
  let infeasibilityDiagnosis = null;
  const relaxApplied = relaxation?.applied === true;
  if (!solution.optimal && !relaxApplied) {
    try {
      const iisResult = await findIIS(lp, solveWithRetry, { GLP });
      if (iisResult.iis.length > 0 || iisResult.reducible === false) {
        infeasibilityDiagnosis = { ...iisResult, description: describeIIS(iisResult) };
      }
    } catch (err) {
      // IIS başarısız → graceful (tanı yok, mevcut infeasible mesajı kalır)
    }
  }

  // 6d. FAZ 18.2: Tüketim-duyarlı KMT (tek iterasyon). İLK geçişte (_dmiOverride yok) ve
  // bir rasyon elde edildiyse, çözüm rasyonunun NDF konsantrasyonundan doluluk-sınırlı
  // KMT'yi hesapla; KMT eşikten (>%3) fazla düşüyorsa düzeltilmiş KMT ile BİR KEZ yeniden
  // çöz (recursive — 2. geçiş _dmiOverride taşıdığından fill kontrolünü atlar → sonsuz döngü yok).
  if (_dmiOverride === undefined && (solution.optimal || relaxation?.applied === true)) {
    const ndfConc = rationNDFConcentration(solution, lp, feeds);  // % KM
    const fillDmi = adjustDMIForFill(dmi_kg, ndfConc, animal.bw);
    if (Number.isFinite(fillDmi) && fillDmi < dmi_kg * (1 - FILL_RESOLVE_THRESHOLD)) {
      return optimizeRation({ ...input, _dmiOverride: fillDmi });   // 2. geçiş: dmi.fillAdjusted=true taşır
    }
  }

  // 7. Sonucu derle
  return composeResult({
    feeds, solution, dmi, dmi_kg, nel, mp, minerals, traceMinerals, vitamins, water,
    requirements, lp, animal, system: usedSystem, relaxation, infeasibilityDiagnosis,
    missingSources,  // denetim bulgusu: kaynaksız iz mineral/vitamin uyarısı
    inraReqs: reqs.inra, // FAZ 16.1: INRA gereksinimlerini pasla
    intakeMultiple,  // FAZ 18.4 + 24.3: tüketim-düzeyi enerji iskonto çarpanı (ulaşılan NEL + rapor)
    cncpsCoef,       // FAZ 19.1c: CNCPS modu yakınsamış per-feed katsayıları (aggregateComposition LP↔rapor tutarlılığı)
    cncps: cncpsInfo, // FAZ 19.1c: { mode, iterations, converged, passageRates } | null (NRC modunda null)
    objective,       // FAZ 20.1: duyarlılık yalnız 'cost' amacında geçerli
    objectives,      // FAZ 20.1: çok-amaçlıysa duyarlılık kapatılır
  });
}

// ─── FAZ 19.1c: İteratif CNCPS motoru (Sequential LP / sabit-nokta) ──────────
// Tasarım: FAZ_17-20_Son_Kontrol_Uygulama_Plani.md → "📐 19.1 DETAYLI TASARIM".
// LP her iterasyonda LİNEER kalır; yalnız per-feed MP havuz katsayıları pasaj-bağımlı
// güncellenir. Yakınsama yem miktarlarının kararlılığıyla ölçülür; damping salınımı azaltır.
const CNCPS_MAX_ITER = 5;         // iterasyon tavanı (performans + salınım sınırı)
const CNCPS_DAMPING = 0.5;        // α: katsayı = α·yeni + (1−α)·önceki (salınım kontrolü)
const CNCPS_CONVERGE_TOL = 0.01;  // yakınsama: max(|Δ yem kg|) / toplam KM < %1

/**
 * CNCPS hesap modu çekirdeği: warm-start NRC çözümünden başlayıp pasaj-bağımlı arz
 * katsayılarını sabit-noktaya yakınsatır.
 * @returns {Promise<{coef:(object|null), iterations:number, converged:boolean, passageRates:(object|null), reason?:string}>}
 *   coef=null → warm-start infeasible (çağıran NRC katsayılarına düşer; final blok relax/IIS ile ele alır).
 */
async function runCncpsLoop({ feeds, dmi_kg, bw, requirements, feedLimits, groupLimits, objective, objectives, system, energyDiscount, dmiSlack }) {
  const build = (cncpsCoef) => buildRationLP({
    feeds, dmi_kg, requirements, feedLimits, groupLimits, objective, objectives, system, energyDiscount,
    ...(cncpsCoef ? { cncpsCoef } : {}),
    ...(dmiSlack !== undefined ? { dmiSlack } : {}),
  });
  const solveWithRetry = async (lpArg) => {
    let s = await solveLP(lpArg);
    if (s.statusName === 'undef') s = await solveLP(lpArg, { presol: false });
    return s;
  };
  const amountsOf = (sol, lpArg) => {
    const vn = lpArg._meta.varNames;
    return feeds.map((f, i) => num(sol.vars?.[vn[i]], 0));
  };

  // Warm start (NRC katsayıları): pasaj hızı için bir başlangıç rasyonu şart.
  let lp = build(null);
  let solution = await solveWithRetry(lp);
  if (!solution.optimal) {
    return { coef: null, iterations: 0, converged: false, passageRates: null, reason: 'warm_start_infeasible' };
  }
  let prevAmounts = amountsOf(solution, lp);
  let prevCoef = null;
  let passageRates = null;
  let converged = false;
  let done = 0;

  for (let iter = 1; iter <= CNCPS_MAX_ITER; iter++) {
    const totalDm = prevAmounts.reduce((s, v) => s + v, 0);
    if (totalDm <= 0) break;
    const ingredients = feeds
      .map((f, i) => ({ feed: f, dmKg: prevAmounts[i] }))
      .filter(x => x.dmKg > 0);
    const inp = cncpsRationInputs(ingredients, totalDm);
    const kp = calcPassageRates({ dmi: totalDm, bw, ndfPct: inp.ndfPct, meIntake: inp.meIntake, concentrateRatio: inp.concentrateRatio });
    passageRates = kp;

    // Per-feed CNCPS arz katsayıları + damping (ilk iterasyonda referans yok → ham)
    const raw = {};
    for (const f of feeds) { if (f.id != null) raw[f.id] = cncpsFeedSupply(f, kp); }
    const coef = prevCoef ? dampCncpsCoef(raw, prevCoef, CNCPS_DAMPING) : raw;

    lp = build(coef);
    const sol = await solveWithRetry(lp);
    done = iter;
    if (!sol.optimal) {
      // CNCPS katsayılarıyla infeasible → son sağlam coef'e dön (yoksa NRC); relax/IIS final blokta.
      return { coef: prevCoef, iterations: iter - 1, converged, passageRates, reason: 'cncps_infeasible' };
    }
    const amounts = amountsOf(sol, lp);
    const delta = maxRelDelta(amounts, prevAmounts, totalDm);
    prevAmounts = amounts;
    prevCoef = coef;
    if (delta < CNCPS_CONVERGE_TOL) { converged = true; break; }
  }
  return { coef: prevCoef, iterations: done, converged, passageRates };
}

/** İki yem-miktarı vektörü arasındaki en büyük göreli değişim (toplam KM'ye oranla). */
function maxRelDelta(a, b, total) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] || 0) - (b[i] || 0));
    if (d > m) m = d;
  }
  return total > 0 ? m / total : 0;
}

/** CNCPS katsayı damping: out = α·raw + (1−α)·prev (havuz bazında); mpTotal havuzlardan tutarlı. */
function dampCncpsCoef(raw, prev, alpha) {
  const out = {};
  for (const id of Object.keys(raw)) {
    const r = raw[id], p = prev[id];
    if (!p) { out[id] = r; continue; }
    const e = alpha * r.mpEnergyPool + (1 - alpha) * p.mpEnergyPool;
    const rd = alpha * r.mpRdpPool + (1 - alpha) * p.mpRdpPool;
    const ru = alpha * r.mpRUP + (1 - alpha) * p.mpRUP;
    out[id] = { mpEnergyPool: e, mpRdpPool: rd, mpRUP: ru, mpTotal: Math.min(e, rd) + ru, isCncpsEnergy: r.isCncpsEnergy };
  }
  return out;
}

/**
 * FAZ 18.2: Çözüm rasyonunun NDF konsantrasyonu (% KM) — ulaşılan KM ağırlıklı ortalama.
 * Doluluk-düzeltmeli KMT (adjustDMIForFill) için gerçek rasyon NDF'si gerekir.
 */
function rationNDFConcentration(solution, lp, feeds) {
  const varNames = lp._meta.varNames;
  let ndfWeighted = 0, dmSum = 0;
  for (let i = 0; i < feeds.length; i++) {
    const dmKg = solution.vars?.[varNames[i]] ?? 0;
    if (dmKg <= 0) continue;
    ndfWeighted += dmKg * num(feeds[i].ndf);
    dmSum += dmKg;
  }
  return dmSum > 0 ? ndfWeighted / dmSum : 0;  // % KM
}

// ─── Sonuç derleyici ─────────────────────────────────────────────────────────

function composeResult({ feeds, solution, dmi, dmi_kg, nel, mp, minerals, traceMinerals, vitamins, water, requirements, lp, animal, system, relaxation = null, infeasibilityDiagnosis = null, missingSources = [], inraReqs = null, intakeMultiple = 1, cncpsCoef = null, cncps = null, objective = 'cost', objectives = null }) {
  const { vars, optimal, status, statusName, message, z } = solution;
  const feedIds = lp._meta.feedIds;
  const varNames = lp._meta.varNames;

  // FAZ 14.8: relax uygulandıysa çözüm "gerçekten feasible" sayılmaz —
  // gevşetilmiş (soft) çözümdür. items dolu + relaxation raporu gösterilir.
  const relaxApplied = relaxation?.applied === true;
  const trulyFeasible = optimal && !relaxApplied;

  // FAZ 20.1: Duyarlılık analizi (gölge fiyat + azaltılmış maliyet) — yalnız saf LP +
  // 'cost' amacı + optimal + gevşetilmemiş çözümde geçerli (computeSensitivity guard'lar).
  const sensitivity = computeSensitivity({ lp, solution, feeds, objective, objectives, relaxApplied });

  // Yem miktarları
  const items = [];
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const varName = varNames[i];
    const dmKg = round(vars?.[varName] ?? 0, 4);
    if (dmKg === 0) continue;
    const dmFraction = (num(feed.dm) || 90) / 100;
    items.push({
      id: feed.id,
      name: feed.name,
      nameEn: feed.nameEn,   // denetim #20: İngilizce gösterim için
      category: feed.category,
      dmKg,
      asFedKg: round(dmKg / dmFraction, 3),
      pctDm: round(dmKg / dmi_kg * 100, 2),
      costPerDay: round(dmKg * (num(feed.pricePerTon) / 1000) / dmFraction, 2),
    });
  }

  // Rasyon düzeyinde toplam besin profili (FAZ 14.4: system → Lys/Met tedarik hesabı)
  const composition = aggregateComposition(items, feeds, dmi_kg, system, intakeMultiple, cncpsCoef);

  // PROBLEMLER #3: TMR nem hedefi → eklenecek su (kütle dengesi). Hedef T (%) verilmişse:
  //   ΣDM sabit; rasyon kendi suyunu (rationWater) sağlar; hedefe ulaşmak için dışarıdan su eklenir.
  //   targetWater = ΣDM·T/(100−T); eklenecek = max(0, targetWater − rationWater).
  //   Rasyon zaten hedeften ıslaksa eklenecek su = 0 (rasyon nemi T'yi aşar — bilgi olarak gösterilir).
  const tmrT = requirements.tmr_target_moisture;
  if (Number.isFinite(tmrT) && tmrT > 0 && tmrT < 100 && composition.asFed_kg > 0) {
    const sumDM = composition.asFed_kg * composition.dm_pct / 100;
    const rationWater = composition.asFed_kg - sumDM;
    const targetWater = sumDM * tmrT / (100 - tmrT);
    const waterAdd = Math.max(0, targetWater - rationWater);
    const finalMass = composition.asFed_kg + waterAdd;
    composition.tmr_target_moisture = tmrT;
    composition.tmr_water_add_kg = round(waterAdd, 1);                              // dışarıdan eklenecek su (kg/gün)
    composition.tmr_ration_moisture_pct = round(rationWater / finalMass * 100, 1);         // rasyonun final TMR'deki nem payı
    composition.tmr_water_moisture_pct = round(waterAdd / finalMass * 100, 1);            // su ile gelen nem payı (açık)
    composition.tmr_final_moisture_pct = round((rationWater + waterAdd) / finalMass * 100, 1); // su eklendiyse ≈ T; eklenmezse rasyon nemi
    composition.tmr_final_mass_kg = round(finalMass, 1);                             // su sonrası toplam taze kg
  }

  const aminoAcids = computeAminoAcids(items, feeds, mp, composition, animal, system, intakeMultiple, cncpsCoef);
  if (aminoAcids) {
    composition.lys_g = aminoAcids.supply.lys.total_g;
    composition.met_g = aminoAcids.supply.met.total_g;
    composition.his_g = aminoAcids.supply.his.total_g;
  }

  // Uyumluluk raporu (her kısıt için)
  const diagnostics = buildDiagnostics(composition, requirements, dmi_kg);

  // Toplam maliyet
  const totalCost = items.reduce((s, it) => s + it.costPerDay, 0);

  // Süt humması (hipokalsemi) risk skoru — FAZ 13.8 (Goff & Horst)
  // DCAD + Ca%KM + parite bazlı; esas geçiş dönemi (close_up) için anlamlı.
  const caPctDM = dmi_kg > 0 ? composition.ca_g / dmi_kg / 10 : 0;
  const milkFever = milkFeverRisk(composition.dcad_meq ?? 0, caPctDM, animal.parity || 2);

  // Rumen pH 24 saatlik dinamik simülasyon (FAZ 8)
  const rumenDynamics = simulateRumenPH24h({
    nfcPct: composition.nfc_pct,
    peNDFPct: composition.peNDF_pct,
    starchPct: composition.starch_pct,
    sugarPct: composition.sugar_pct,
    forageRatio: composition.forage_pct,
    fatPct: composition.fat_pct,
  });

  // Yağ asidi profili + süt yağ tahmini (FAZ 8)
  const dietFA = estimateRationFA(items, feeds);
  const milkFA = estimateMilkFA(dietFA, {
    peNDFPct: composition.peNDF_pct,
    nfcPct: composition.nfc_pct,
    dmi_kg,
  });
  const faAssessment = assessFAProfile(dietFA, milkFA);
  const fattyAcids = { diet: dietFA, milk: milkFA, assessment: faAssessment };

  // Enterik metan (CH₄) emisyonu — FAZ 16.2 (Moraes 2014 birincil, Niu 2018 alternatif)
  // Gerçek (achieved) KMT birincil sürücü; kompozisyon NDF/CP/yağ/kaba yem düzeltir.
  const achievedDmi = round(items.reduce((s, it) => s + it.dmKg, 0), 3);
  const milkYield = num(animal.milkYield, 0);
  const ch4Moraes = methaneMoraes2014(achievedDmi, composition.ndf_pct, composition.cp_pct);
  const ch4Niu = methaneNiu2018(achievedDmi, composition.fat_pct, composition.forage_pct);
  const ch4_g = ch4Moraes;  // birincil tahmin (Moraes 2014); Niu 2018 karşılaştırma için
  const ch4Intensity = methaneIntensity(ch4_g, milkYield);
  const methane = {
    production_g: ch4_g,                          // birincil CH₄ üretimi (g/gün)
    moraes_g: ch4Moraes,                      // Moraes 2014 (g/gün)
    niu_g: ch4Niu,                         // Niu 2018 alternatif (g/gün)
    yield_g_per_kg_dmi: achievedDmi > 0 ? round(ch4_g / achievedDmi, 1) : 0,
    intensity_g_per_kg_milk: ch4Intensity,                  // g CH₄ / kg süt (kuru → null)
    co2eq_kg_day: methaneCO2eq(ch4_g),            // kg CO₂eq/gün (GWP100=28)
    energyLossMcal: round((ch4_g / 1000) * CH4_ENERGY_MCAL_PER_KG, 2),  // metan enerji kaybı
    interpretation: interpretMethane(ch4Intensity),
  };

  // CNCPS v6.5 tam alt fraksiyonları — FAZ 16.3 (rasyon düzeyi, tanı/gösterim)
  // Mevcut RDP/RUP/MCP pipeline'ını ETKİLEMEZ — yalnızca ayrıntılı profil.
  const cncpsById = new Map(feeds.map(f => [f.id, f]));
  const cncpsIngredients = items
    .map(it => ({ feed: cncpsById.get(it.id), dmKg: it.dmKg }))
    .filter(ing => ing.feed && ing.dmKg > 0);
  const cncpsSubFractions = achievedDmi > 0
    ? aggregateCNCPSSubFractions(cncpsIngredients, achievedDmi)
    : null;

  // Nişasta rumen/bağırsak sindirimi — FAZ 16.4 (işleme-tipi farkındalıklı RSD)
  let starchDigestion = null;
  if (achievedDmi > 0) {
    starchDigestion = aggregateStarchDigestion(cncpsIngredients, achievedDmi);
    starchDigestion.interpretation = interpretRumenStarch(starchDigestion.rumenStarch_pct);
  }

  // Mikotoksin riski + silaj fermentasyon kalitesi — FAZ 16.6 (lab verisi girilince)
  let mycotoxinRisk = null, silageQuality = null;
  if (achievedDmi > 0) {
    const myco = aggregateMycotoxins(cncpsIngredients, achievedDmi);
    mycotoxinRisk = { ...myco, interpretation: interpretMycotoxinRisk(myco) };
    silageQuality = aggregateSilageQuality(cncpsIngredients);
  }

  // INRA 2018 rasyon profili — FAZ 16.1 (system='INRA2018' seçiliyken)
  let inraResult = undefined;
  if (system === 'INRA2018' && achievedDmi > 0 && inraReqs) {
    const inraSupply = aggregateINRA(items, feeds, achievedDmi);
    const inraRequirements = {
      ufl: inraReqs.ufl.total,
      pdi_g: inraReqs.pdi.total,
      uel_capacity: inraReqs.uelCapacity,
    };
    inraResult = {
      supply: inraSupply,
      requirements: {
        ufl: inraReqs.ufl,
        pdi: inraReqs.pdi,
        uelCapacity: inraReqs.uelCapacity,
      },
      balance: interpretINRABalance(inraSupply, inraRequirements),
    };
  }

  return {
    feasible: trulyFeasible,           // FAZ 14.8: relax uygulandıysa false
    relaxation,                        // FAZ 14.8: { applied, violations, messages } | null
    infeasibilityDiagnosis,            // FAZ 14.9: { iis, constraints, reducible, description } | null
    missingSources,                    // denetim bulgusu: [{key,label,type}] kaynaksız iz mineral/vitamin (premiks gerekli)
    status,
    statusName,
    message,
    objectiveValue: z,
    totalCost: round(totalCost, 2),

    dmi: {
      target_kg: dmi_kg,
      achieved_kg: round(items.reduce((s, it) => s + it.dmKg, 0), 3),
      method: dmi.method,
      heatAdjusted: dmi.heatAdjusted,
      // FAZ 18.2: rasyon doluluk (NDF fill) düzeltmesi uygulandıysa hayvan-bazlı KMT'yi de göster
      fillAdjusted: dmi.fillAdjusted === true,
      baseDmi: dmi.fillAdjusted === true ? dmi.baseDmi : undefined,
      // FAZ 18.4: tüketim-düzeyi enerji iskontosu (%). 0 = iskonto yok/kapalı.
      energyDiscountPct: composition.averageDiscountPct || 0,
    },

    requirements: {
      nel,
      mp,
      minerals,
      traceMinerals,
      vitamins,
      water,  // FAZ 13.11: su tüketimi tahmini (Murphy 1992)
      compositionTargets: requirements,
      system,  // FAZ 13.1: hangi bilim sistemi kullanıldı
    },

    items,

    composition,

    diagnostics,

    aminoAcids,

    milkFever,  // FAZ 13.8: { score, riskLevel, recommendations }

    rumenDynamics,

    fattyAcids,

    methane,  // FAZ 16.2: enterik metan emisyonu (CH₄ g/gün, yoğunluk, CO₂eq, enerji kaybı)

    cncpsSubFractions,  // FAZ 16.3: CNCPS v6.5 8 havuz CHO + 6 havuz protein (rasyon düzeyi)

    starchDigestion,    // FAZ 16.4: nişasta rumen/bağırsak/by-pass sindirim profili

    mycotoxinRisk,      // FAZ 16.6: rasyon mikotoksin yükü + limit karşılaştırma (lab verisi)
    silageQuality,      // FAZ 16.6: silaj fermentasyon kalite skorları (lab verisi)

    inra: inraResult,   // FAZ 16.1: INRA 2018 profili (UFL/PDIE/PDIN/UEL tedarik + gereksinim + denge)

    cncps,              // FAZ 19.1c: iteratif motor meta { mode, iterations, converged, passageRates } | null (NRC modunda null)

    sensitivity,        // FAZ 20.1: { applicable, shadowPrices, reducedCosts } | { applicable:false, reason }
  };
}

// ─── Amino Asit Hesabı (rasyon düzeyinde Lys/Met) ────────────────────────────

function computeAminoAcids(items, feeds, mp, composition, animal, system = 'NASEM2021', intakeMultiple = 1, cncpsCoef = null) {
  if (!items || items.length === 0 || !composition.rup_g) {
    return null;
  }

  const byId = new Map(feeds.map(f => [f.id, f]));

  // FAZ 13.2: mpMicrobial_g ve mpRUP_g yem-spesifik mpComponentsPerKgDM toplamından gelir.
  // FAZ 24.4: Mikrobiyal MP, rasyon düzeyinde min(enerji-havuzu, rdp-havuzu) olarak ve 
  // feedIntakeDiscountFactor / cncpsCoef dikkate alınarak hesaplanır.
  const weighted = Object.fromEntries(EAA_LIST.map(a => [a, 0]));
  let totalMpRUP_w = 0;   // ağırlık tabanı (mpRUP, g/gün)
  let mpRUP_g = 0;
  let enPool = 0;
  let rdpPool = 0;

  for (const it of items) {
    const f = byId.get(it.id);
    const feedDiscount = feedIntakeDiscountFactor(f, intakeMultiple);
    const mc = (cncpsCoef && cncpsCoef[f.id]) ? cncpsCoef[f.id] : mpComponentsPerKgDM(f);

    const mpRUP_i = it.dmKg * mc.mpRUP;  // sindirilmiş RUP MP (g/gün)
    mpRUP_g += mpRUP_i;
    enPool += it.dmKg * mc.mpEnergyPool * (mc.isCncpsEnergy ? 1 : feedDiscount);
    rdpPool += it.dmKg * mc.mpRdpPool;

    if (mpRUP_i <= 0) continue;
    totalMpRUP_w += mpRUP_i;
    for (const aa of EAA_LIST) weighted[aa] += mpRUP_i * num(f[aa], RUP_AA_DEFAULTS[aa]);
  }
  const rupPctByAA = Object.fromEntries(EAA_LIST.map(a =>
    [a, totalMpRUP_w > 0 ? round(weighted[a] / totalMpRUP_w, 2) : RUP_AA_DEFAULTS[a]]));

  const mpMicrobial_g = Math.min(enPool, rdpPool);
  const mpTotal = mpMicrobial_g + mpRUP_g;

  const supply = calcAASupply({
    mpMicrobial_g,
    mpRUP_g,
    rupPctByAA,
    intestinalD: 100,  // FAZ 14.4: mpRUP zaten sindirilmiş → çift sayım engellenir
    system,            // FAZ 13.15: mikrobiyal AA içerik kaynağı
  });

  // FAZ 10B: Dinamik AA hedefleri (NASEM 2021 + Schwab 2019) — Lys/Met/His dinamik, 7 EAA statik referans.
  const aaTargets = animal ? calcAATargets(animal) : undefined;
  const extraPctMP = aaTargets
    ? Object.fromEntries(['arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp'].map(a => [a, aaTargets[a]?.pctMP]))
    : null;
  // DÜZELTME: Gereksinim hesabında hayvanın SABİT MP gereksinimi (mp.total) kullanılır.
  // Eskiden rasyonun ürettiği mpTotal kullanılıyordu; bu durum kullanıcı kısıtı
  // değiştirdiğinde (LP daha fazla RUP zorlayınca ration mpTotal artıyordu) aynı
  // hayvan profili için gereksinim değerinin değişmesine neden oluyordu.
  // mp.total → calcAllRequirements'tan gelen sabit hayvan MP ihtiyacı (g/gün).
  const reqMpBase = (mp && mp.total > 0) ? mp.total : mpTotal;
  const requirement = calcAARequirements(
    reqMpBase, aaTargets?.lys.pctMP ?? 7.0, aaTargets?.met.pctMP ?? 2.6, aaTargets?.his?.pctMP ?? 2.2, extraPctMP);
  const assessment = assessAABalance(supply, requirement, aaTargets);
  const recommendations = recommendRPAA(assessment, reqMpBase, aaTargets);

  return {
    supply,
    requirement,
    assessment,
    recommendations,
    rupProfile: { lysPct: rupPctByAA.lys, metPct: rupPctByAA.met, hisPct: rupPctByAA.his },  // panel Lys/Met/His tabanı
    targets: aaTargets,  // FAZ 10B: dinamik hedefleri raporda göster
  };
}

function aggregateComposition(items, feeds, dmi_kg, system = 'NASEM2021', intakeMultiple = 1, cncpsCoef = null) {
  const byId = new Map(feeds.map(f => [f.id, f]));
  const acc = {
    nel: 0, cp_g: 0, rup_g: 0, rdp_g: 0,
    ndf: 0, adf: 0, aNDF: 0, nfc: 0, starch: 0, sugar: 0,
    fat: 0, ash: 0, peNDF: 0,
    ca_g: 0, p_g: 0, mg_g: 0, k_g: 0, na_g: 0, s_g: 0, cl_g: 0,
    // İz mineraller (mg/gün) — feed library mg/kg KM
    fe_mg: 0, zn_mg: 0, cu_mg: 0, mn_mg: 0, se_mg: 0, co_mg: 0, i_mg: 0,
    // Vitaminler — feed library IU/kg KM
    vitA_IU: 0, vitD_IU: 0, vitE_IU: 0,
    // FAZ 9 — Ek fonksiyonel besinler
    bcarotene_mg: 0, niacin_mg: 0, biotin_mg: 0, choline_g: 0,
    // FAZ 14.4 + 18.3: Lys/Met/His tedariki (g/gün) — aaPerKgDM ile LP-tutarlı
    lys_g: 0, met_g: 0, his_g: 0,
    // FAZ 14.10: PUFA/ω6/ω3 (%KM·kg ara toplam) — faCoefPerKgDM ile LP-tutarlı
    pufa: 0, omega6: 0, omega3: 0,
    forageDm: 0,
    asFed: 0, totalDmKg: 0,   // #4: TMR taze (yaş) kg toplamı + nem/DM hesabı
  };
  acc.mp_g = 0;  // FAZ 10A→18.1: rasyon-düzeyi MP (mikrobiyal min(E,R) + RUP) — döngü sonrası hesaplanır
  acc.mpRUP = 0; acc.mpEnergyPool = 0; acc.mpRdpPool = 0;  // FAZ 18.1: MCP havuzları (rasyon toplamı)
  for (const it of items) {
    const f = byId.get(it.id);
    const dm = it.dmKg;
    acc.asFed += dm / ((num(f.dm) || 90) / 100);  // #4: yaş (as-fed) kg = kg KM / (DM fraksiyonu)
    acc.totalDmKg += dm;
    const aa = aaPerKgDM(f, system);  // FAZ 14.4: yem-başına Lys/Met (LP coefficient ile aynı)
    acc.lys_g += dm * aa.lys;
    acc.met_g += dm * aa.met;
    acc.his_g += dm * aa.his;   // FAZ 18.3
    const fa = faCoefPerKgDM(f);      // FAZ 14.10: PUFA/ω6/ω3 (% KM, LP coefficient ile aynı)
    acc.pufa += dm * fa.pufa;
    acc.omega6 += dm * fa.omega6;
    acc.omega3 += dm * fa.omega3;
    // FAZ 24.3: Yem-spesifik tüketim-düzeyi enerji iskontosu (feedIntakeDiscountFactor)
    const feedDiscount = feedIntakeDiscountFactor(f, intakeMultiple);
    acc.totalDiscountWeight = (acc.totalDiscountWeight || 0) + dm * (1 - feedDiscount) * 100;

    acc.nel += dm * effectiveNel(f) * feedDiscount;  // FAZ 17.2 + 18.4 + 24.3: yem-bazlı + tüketim-düzeyi enerji iskontolu (LP kısıtı ile tutarlı)
    acc.cp_g += dm * num(f.cp) * 10;
    acc.rup_g += dm * num(f.cp) * 10 * num(f.rup) / 100;
    acc.rdp_g += dm * num(f.cp) * 10 * num(f.rdp) / 100;
    // FAZ 18.1: per-feed mpPerKgDM toplamı yerine MCP havuzlarını ayrı topla → mp_g döngü sonrası min(E,R) ile
    // FAZ 19.1c + 24.2: CNCPS modunda yakınsamış per-feed havuz katsayıları (cncpsCoef) kullanılır; yoksa
    // NRC sabit mpComponentsPerKgDM. isCncpsEnergy flag'i sayesinde fermente-CHO tabanlı hesaplamalarda
    // feedDiscount atlanarak çifte sayım önlenir (lpBuilder MP kısıtıyla BİREBİR ayna).
    {
      const mc = (cncpsCoef && cncpsCoef[f.id]) ? cncpsCoef[f.id] : mpComponentsPerKgDM(f);
      acc.mpRUP += dm * mc.mpRUP;
      acc.mpEnergyPool += dm * mc.mpEnergyPool * (mc.isCncpsEnergy ? 1 : feedDiscount);
      acc.mpRdpPool += dm * mc.mpRdpPool;
    }
    acc.ndf += dm * num(f.ndf);
    acc.adf += dm * num(f.adf);
    acc.aNDF += dm * num(f.aNDF);
    acc.nfc += dm * num(f.nfc);
    acc.starch += dm * num(f.starch);
    acc.sugar += dm * num(f.sugar);
    acc.fat += dm * num(f.fat);
    acc.ash += dm * num(f.ash);
    acc.peNDF += dm * num(f.ndf) * pefVal(f.category);
    acc.ca_g += dm * num(f.ca) * 10;
    acc.p_g += dm * num(f.p) * 10;
    acc.mg_g += dm * num(f.mg) * 10;
    acc.k_g += dm * num(f.k) * 10;
    acc.na_g += dm * num(f.na) * 10;
    acc.s_g += dm * num(f.s) * 10;
    acc.cl_g += dm * num(f.cl) * 10;
    // İz mineraller: mg/kg KM × kg KM = mg/gün
    acc.fe_mg += dm * num(f.fe);
    acc.zn_mg += dm * num(f.zn);
    acc.cu_mg += dm * num(f.cu);
    acc.mn_mg += dm * num(f.mn);
    acc.se_mg += dm * num(f.se);
    acc.co_mg += dm * num(f.co);
    acc.i_mg += dm * num(f.i);
    // Vitaminler: IU/kg KM × kg KM = IU/gün
    acc.vitA_IU += dm * num(f.vitA);
    acc.vitD_IU += dm * num(f.vitD);
    acc.vitE_IU += dm * num(f.vitE);
    // FAZ 9 — Ek fonksiyonel besinler
    acc.bcarotene_mg += dm * num(f.bcarotene);  // mg/gün
    acc.niacin_mg += dm * num(f.niacin);     // mg/gün
    acc.biotin_mg += dm * num(f.biotin);     // mg/gün
    acc.choline_g += dm * num(f.choline);    // g/gün (rumen-korumalı)
    if (f.category === 'roughage') acc.forageDm += dm;
  }
  // FAZ 18.1: Rasyon-düzeyi MP = RUP-MP + mikrobiyal MP; mikrobiyal MP = min(enerji-havuz,
  // RDP-havuz) RASYON toplamında (per-feed min toplamından ≥ → tamamlayıcı yem sinerjisi).
  // LP'deki iki-havuz MP kısıtı (lpBuilder) ile bire bir tutarlı.
  acc.mp_g = acc.mpRUP + Math.min(acc.mpEnergyPool, acc.mpRdpPool);

  // DCAD (mEq/100g KM)
  const naP = (acc.na_g / dmi_kg) / 10;  // % KM
  const kP = (acc.k_g / dmi_kg) / 10;
  const clP = (acc.cl_g / dmi_kg) / 10;
  const sP = (acc.s_g / dmi_kg) / 10;
  const dcad = ((naP / 23) + (kP / 39) - (clP / 35.5) - (sP / 16)) * 1000;

  return {
    nel_mcal: round(acc.nel, 2),
    cp_g: round(acc.cp_g, 1),
    cp_pct: round(acc.cp_g / dmi_kg / 10, 2),
    rup_g: round(acc.rup_g, 1),
    rdp_g: round(acc.rdp_g, 1),
    rdp_pct: round(acc.rdp_g / dmi_kg / 10, 2),  // FAZ 14.5: RDP % KM (diagnostics)
    mp_g: round(acc.mp_g, 1),  // FAZ 10A: rasyon MP tedariki (g/gün)
    lys_g: round(acc.lys_g, 1), // FAZ 14.4: Lys tedariki (g/gün, aaPerKgDM)
    met_g: round(acc.met_g, 1), // FAZ 14.4: Met tedariki (g/gün, aaPerKgDM)
    his_g: round(acc.his_g, 1), // FAZ 18.3: His tedariki (g/gün, aaPerKgDM)
    pufa_pct: round(acc.pufa / dmi_kg, 2),   // FAZ 14.10: PUFA % KM (LP-tutarlı)
    omega6_pct: round(acc.omega6 / dmi_kg, 3),
    omega3_pct: round(acc.omega3 / dmi_kg, 3),
    n6n3_ratio: acc.omega3 > 0 ? round(acc.omega6 / acc.omega3, 2) : null,
    ndf_pct: round(acc.ndf / dmi_kg, 2),
    adf_pct: round(acc.adf / dmi_kg, 2),
    aNDF_pct: round(acc.aNDF / dmi_kg, 2),
    nfc_pct: round(acc.nfc / dmi_kg, 2),
    starch_pct: round(acc.starch / dmi_kg, 2),
    sugar_pct: round(acc.sugar / dmi_kg, 2),
    fat_pct: round(acc.fat / dmi_kg, 2),
    ash_pct: round(acc.ash / dmi_kg, 2),
    peNDF_pct: round(acc.peNDF / dmi_kg, 2),
    forage_pct: round(acc.forageDm / dmi_kg * 100, 2),
    // #4: TMR taze (yaş) toplam + kuru madde/nem %
    asFed_kg: round(acc.asFed, 2),
    dm_pct: acc.asFed > 0 ? round(acc.totalDmKg / acc.asFed * 100, 1) : 0,
    moisture_pct: acc.asFed > 0 ? round(100 - acc.totalDmKg / acc.asFed * 100, 1) : 0,
    ca_g: round(acc.ca_g, 2),
    p_g: round(acc.p_g, 2),
    mg_g: round(acc.mg_g, 2),
    k_g: round(acc.k_g, 2),
    na_g: round(acc.na_g, 2),
    s_g: round(acc.s_g, 2),
    cl_g: round(acc.cl_g, 2),
    dcad_meq: round(dcad, 1),
    // İz mineraller (mg/gün)
    fe_mg: round(acc.fe_mg, 1),
    zn_mg: round(acc.zn_mg, 1),
    cu_mg: round(acc.cu_mg, 2),
    mn_mg: round(acc.mn_mg, 1),
    se_mg: round(acc.se_mg, 3),
    co_mg: round(acc.co_mg, 3),
    i_mg: round(acc.i_mg, 3),
    // Vitaminler (IU/gün)
    vitA_IU: round(acc.vitA_IU, 0),
    vitD_IU: round(acc.vitD_IU, 0),
    vitE_IU: round(acc.vitE_IU, 0),
    // FAZ 9 — Ek fonksiyonel besinler
    bcarotene_mg: round(acc.bcarotene_mg, 1),
    niacin_mg: round(acc.niacin_mg, 1),
    biotin_mg: round(acc.biotin_mg, 2),
    choline_g: round(acc.choline_g, 2),
    averageDiscountPct: acc.totalDmKg > 0 ? round((acc.totalDiscountWeight || 0) / acc.totalDmKg, 2) : 0,
  };
}

function buildDiagnostics(comp, req, dmi_kg) {
  const diag = [];
  // FAZ 14 denetimi: %0.1 relatif tolerans — items.dmKg round(4) yuvarlaması
  // composition değerlerini kısıt sınırının mikroskobik altına/üstüne taşıyabilir
  // (LP feasible olmasına rağmen). Tolerans bu yuvarlama artefaktını gizler; gerçek
  // ihlaller (>%0.1) yine 'below'/'above' olarak raporlanır.
  const TOL = 0.001;
  const check = (name, value, min, max) => {
    let status = 'ok';
    if (min !== undefined && value < min - Math.abs(min) * TOL - 1e-9) status = 'below';
    else if (max !== undefined && value > max + Math.abs(max) * TOL + 1e-9) status = 'above';
    diag.push({ name, value: round(value, 2), min, max, status });
  };
  if (req.nel_mcal !== undefined) check('NEL (Mcal/gün)', comp.nel_mcal, req.nel_mcal, req.nel_mcal_max);
  if (req.mp_g !== undefined) check('MP (g/gün) ⭐', comp.mp_g, req.mp_g, req.mp_g_max);  // FAZ 10A
  // FAZ 14.4: Amino asit (Lys/Met) — g/gün; aaPerKgDM ile LP-tutarlı
  if (req.aminoAcids?.lys_g) check('Lys (g/gün)', comp.lys_g, req.aminoAcids.lys_g.min, req.aminoAcids.lys_g.max);
  if (req.aminoAcids?.met_g) check('Met (g/gün)', comp.met_g, req.aminoAcids.met_g.min, req.aminoAcids.met_g.max);
  if (req.aminoAcids?.his_g) check('His (g/gün)', comp.his_g, req.aminoAcids.his_g.min, req.aminoAcids.his_g.max);  // FAZ 18.3
  // FAZ 14.5: RDP (% KM) — rumen mikrobiyal protein için yıkılabilir N
  if (req.rdp_pct) check('RDP (%KM)', comp.rdp_pct, req.rdp_pct.min, req.rdp_pct.max);
  if (req.cp_pct) check('CP (%KM)', comp.cp_pct, req.cp_pct.min, req.cp_pct.max);
  if (req.ndf_pct) check('NDF (%KM)', comp.ndf_pct, req.ndf_pct.min, req.ndf_pct.max);
  if (req.adf_pct) check('ADF (%KM)', comp.adf_pct, req.adf_pct.min, undefined);
  if (req.nfc_pct) check('NFC (%KM)', comp.nfc_pct, undefined, req.nfc_pct.max);
  // FAZ 14.6: rumen sağlığı üst sınırları (asidoz/MFD/lif sindirimi)
  if (req.starch_pct?.max !== undefined) check('Nişasta (%KM)', comp.starch_pct, undefined, req.starch_pct.max);
  if (req.sugar_pct?.max !== undefined) check('Şeker (%KM)', comp.sugar_pct, undefined, req.sugar_pct.max);
  if (req.fat_pct?.max !== undefined) check('Yağ (%KM)', comp.fat_pct, undefined, req.fat_pct.max);
  // FAZ 14.10: PUFA üst sınırı (MFD/rumen biyohidrojenasyon) + ω6:ω3 oran (opsiyonel)
  if (req.pufa_pct?.max !== undefined) check('PUFA (%KM)', comp.pufa_pct, undefined, req.pufa_pct.max);
  if (req.n6n3_ratio_max !== undefined && comp.n6n3_ratio != null) check('ω6:ω3 oranı', comp.n6n3_ratio, undefined, req.n6n3_ratio_max);
  if (req.peNDF_pct) check('peNDF (%KM)', comp.peNDF_pct, req.peNDF_pct.min, undefined);
  if (req.forage_pct) check('Kaba yem (%KM)', comp.forage_pct, req.forage_pct.min, req.forage_pct.max);
  // #4: TMR nem hedefi konulduysa teşhiste göster (nem % hedef bandı)
  if (req.tmr_moisture_pct) check('TMR Nem (%)', comp.moisture_pct, req.tmr_moisture_pct.min, req.tmr_moisture_pct.max);
  // #1: makro mineral req sayı (min) veya {min,max} olabilir → ikisini de göster
  const mref = (r) => (r != null && typeof r === 'object') ? [r.min, r.max] : [r, undefined];
  if (req.ca_g !== undefined) { const [mn, mx] = mref(req.ca_g); check('Ca (g/gün)', comp.ca_g, mn, mx); }
  if (req.p_g !== undefined) { const [mn, mx] = mref(req.p_g); check('P (g/gün)', comp.p_g, mn, mx); }
  if (req.mg_g !== undefined) { const [mn, mx] = mref(req.mg_g); check('Mg (g/gün)', comp.mg_g, mn, mx); }
  if (req.k_g !== undefined) { const [mn, mx] = mref(req.k_g); check('K (g/gün)', comp.k_g, mn, mx); }
  if (req.na_g !== undefined) { const [mn, mx] = mref(req.na_g); check('Na (g/gün)', comp.na_g, mn, mx); }
  if (req.s_g !== undefined) check('S (g/gün)', comp.s_g, req.s_g, req.s_g_max);
  if (req.cl_g !== undefined) { const [mn, mx] = mref(req.cl_g); check('Cl (g/gün)', comp.cl_g, mn, mx); }
  if (req.dcad_meq) check('DCAD (mEq/100g KM)', comp.dcad_meq, req.dcad_meq.min, req.dcad_meq.max);

  // FAZ 14.2: İz mineral diagnostics (mg/gün) — Zn/Cu/Mn/Se/Fe/I/Co
  const TRACE_LABELS = { zn: 'Zn', cu: 'Cu', mn: 'Mn', se: 'Se', fe: 'Fe', i: 'I', co: 'Co' };
  if (req.traceMinerals) {
    for (const key of Object.keys(req.traceMinerals)) {
      const r = req.traceMinerals[key];
      const value = comp[`${key}_mg`];
      if (value === undefined || !r) continue;
      check(`${TRACE_LABELS[key] || key} (mg/gün)`, value, r.min, r.max);
    }
  }

  // FAZ 14.3: Vitamin diagnostics (IU/gün) — Vit A/D/E
  //   Vit A göstergesi β-karoten dönüşümü dahil etkin IU (composition.vitA_IU + bcarotene_mg × 200)
  const VITAMIN_LABELS = { vitA: 'Vit A', vitD: 'Vit D', vitE: 'Vit E' };
  if (req.vitamins) {
    for (const key of Object.keys(req.vitamins)) {
      const r = req.vitamins[key];
      if (!r) continue;
      let value = comp[`${key}_IU`];
      if (key === 'vitA') {
        // β-karoten katkısı: composition.bcarotene_mg × 200 IU/mg (Schweigert 2003)
        value = (value || 0) + (comp.bcarotene_mg || 0) * 200;
      }
      if (value === undefined || value === null) continue;
      check(`${VITAMIN_LABELS[key] || key} (IU/gün)`, value, r.min, r.max);
    }
  }
  return diag;
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, d = 2) {
  const m = Math.pow(10, d);
  return Math.round(v * m) / m;
}

function pefVal(cat) {
  switch (cat) {
    case 'roughage': return 1.0;
    case 'byproduct': return 0.5;
    case 'protein': return 0.42;
    case 'grain': return 0.42;
    default: return 0;
  }
}

/**
 * RUP intestinal sindirilebilirlik kategori-bazlı varsayılan (FAZ 10H)
 * NRC 2001 Tablo 15-2b + NASEM 2021 referans değerleri
 *
 * @param {string} category
 * @returns {number} intD (%)
 */
/**
 * FAZ 14.2: İz mineral gereksinim objesini LP formatına çevir.
 * `calcTraceMinerals(dmi)` çıktısı: { zn: { minMgDay, maxMgDay, ... }, cu: { ... }, ... }
 * → LP girdisi: { zn: { min, max }, cu: { min, max }, ... } (mg/gün)
 *
 * Graceful fallback: yemlerin hiçbirinde ilgili mineral için pozitif değer yoksa
 * o anahtar atlanır (LP'ye eklenmez). Bu, iz mineral içermeyen yem setiyle
 * (eski testler, kısıtlı veri tabanı kapsamı) regresyon yaratmaz.
 *
 * @param {object} traceMinerals - calcTraceMinerals() çıktısı
 * @param {object} [userOverride] - kullanıcı override { [key]: { min?, max? } }
 * @param {Array}  [feeds]        - mevcut yem seti (kaynak kontrolü için)
 * @returns {object} LP requirements.traceMinerals
 */
function buildTraceRequirement(traceMinerals, userOverride = {}, feeds = null) {
  const out = {};
  const missing = [];   // hedef var ama yem setinde kaynak yok → kullanıcıya bildir
  if (!traceMinerals) return { requirement: out, missing };
  for (const key of TRACE_MINERAL_KEYS) {
    const base = traceMinerals[key];
    if (!base) continue;
    const override = userOverride?.[key] || {};
    // Yemlerde hiç tedarik yoksa kısıtı atla (infeasibility kaçınma) ama
    // sessizce yutma: gereksinim>0 ise "kaynak yok" olarak işaretle (premiks gerekli).
    if (Array.isArray(feeds) && !feeds.some(f => Number(f?.[key]) > 0)) {
      const reqMin = override.min ?? base.minMgDay;
      if (Number(reqMin) > 0) missing.push({ key, type: 'trace' });
      continue;
    }
    out[key] = {
      min: override.min ?? base.minMgDay,
      max: override.max ?? base.maxMgDay,
    };
  }
  return { requirement: out, missing };
}

/**
 * FAZ 14.3: Vitamin gereksinim objesini LP formatına çevir (Vit A/D/E).
 * `calcVitaminRequirements(animal, period)` çıktısı: { vitA: { minIU, maxIU?, ... }, vitD: { minIU, ... }, vitE: { minIU, ... }, ... }
 * → LP girdisi: { vitA: { min, max }, vitD: { min }, vitE: { min } } (IU/gün)
 *
 * Graceful fallback (FAZ 14.2 pattern): bir vitamin için yemlerin hiçbirinde
 * tedarik yoksa (vitA için β-karoten de dahil) o anahtar atlanır → infeasibility kaçınma.
 *
 * @param {object} vitamins   - calcVitaminRequirements() çıktısı
 * @param {object} [userOverride] - kullanıcı override { [key]: { min?, max? } }
 * @param {Array}  [feeds]    - mevcut yem seti (kaynak kontrolü için)
 * @returns {object} LP requirements.vitamins
 */
function buildVitaminRequirement(vitamins, userOverride = {}, feeds = null) {
  const out = {};
  const missing = [];   // hedef var ama yem setinde kaynak yok → kullanıcıya bildir
  if (!vitamins) return { requirement: out, missing };
  for (const key of VITAMIN_KEYS) {
    const base = vitamins[key];
    if (!base) continue;
    const override = userOverride?.[key] || {};
    // Yem kaynak kontrolü: Vit A için β-karoten de tedarik sayılır
    if (Array.isArray(feeds)) {
      const hasAnySupply = feeds.some(f => {
        const direct = Number(f?.[key]) > 0;
        if (direct) return true;
        return key === 'vitA' && Number(f?.bcarotene) > 0;
      });
      if (!hasAnySupply) {
        const reqMin = override.min ?? base.minIU;
        if (Number(reqMin) > 0) missing.push({ key, type: 'vitamin' });
        continue;
      }
    }
    // denetim #1/#16: Vitamin ÜST sınırı default'ta LP'ye GÖNDERİLMEZ.
    // NASEM'in maxIU'su bir "öneri tavanı"dır, toksisite limiti DEĞİL; taze/kaliteli
    // kaba yemdeki β-karoten Vit A "önerilen max"ı rutin olarak aşar → bu tavanı hard
    // LP kısıtı yapmak SAHTE infeasibility üretiyordu (kullanıcının "tüm yemlerle bile
    // fizibil değil" sorunu). Min korunur (yeterlilik); doğal yem vitamin fazlası zararsız
    // ve min-maliyet LP zaten gereksiz vitamin premiks eklemez. Kullanıcı isterse İleri
    // Kısıtlar'dan açık max girebilir (override.max). base.maxIU yalnız panelde gösterilir.
    out[key] = {
      min: override.min ?? base.minIU,
      max: override.max,   // yalnız kullanıcı açıkça override ederse max uygulanır
    };
  }
  return { requirement: out, missing };
}

/**
 * FAZ 14.4: Amino asit (Lys/Met) gereksinimini LP formatına çevir.
 * `calcAATargets(animal)` → { lys: { pctMP, pctMP_min, ... }, met: { ... } }
 * LP gereksinimi: lys_g.min = mpRequired × pctMP_min / 100 (g/gün).
 *
 * Default'ta marjinal alt sınır (pctMP_min) kullanılır — bilimsel olarak "minimum
 * kabul edilebilir AA seviyesi" (altı RP-AA gerektirir). Bu, dengeli rasyonları
 * infeasible yapmadan gerçekten AA-fakir olanları yakalar. Kullanıcı override ile
 * hedef (pctMP) veya daha sıkı değer verebilir.
 *
 * @param {object} aaTargets        - calcAATargets() çıktısı
 * @param {number} mpRequired       - hayvanın MP gereksinimi (g/gün, mp.total)
 * @param {object} [userOverride]   - { lys_g?: { min }, met_g?: { min } }
 * @returns {object} LP requirements.aminoAcids
 */
function buildAminoAcidRequirement(aaTargets, mpRequired, userOverride = {}) {
  const out = {};
  if (!aaTargets || !mpRequired || mpRequired <= 0) return out;
  const lysMin = userOverride?.lys_g?.min ?? round(mpRequired * aaTargets.lys.pctMP_min / 100, 1);
  const metMin = userOverride?.met_g?.min ?? round(mpRequired * aaTargets.met.pctMP_min / 100, 1);
  out.lys_g = { min: lysMin };
  out.met_g = { min: metMin };
  // FAZ 18.3: His alt sınırı (kritik 3. AA) — marjinal pctMP_min ile (Lys/Met paterni).
  if (aaTargets.his) {
    out.his_g = { min: userOverride?.his_g?.min ?? round(mpRequired * aaTargets.his.pctMP_min / 100, 1) };
  }
  // Tam EAA (Katman B): 7 EAA OPT-IN — yalnız kullanıcı override edince LP kısıtı olur
  // (varsayılan FLOOR YOK; nadiren sınırlayıcı + gösterim odaklı). aaMap loop'u {aa}_g yoksa atlar.
  for (const aa of ['arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp']) {
    const ov = userOverride?.[`${aa}_g`];
    if (ov && ov.min != null) out[`${aa}_g`] = { min: ov.min };
  }
  return out;
}
// FAZ 14.4: rupIntDDefault kaldırıldı — computeAminoAcids artık mpRUP (sindirilmiş MP,
// lpBuilder.mpComponentsPerKgDM intD'yi içeriyor) üzerinden hesaplıyor; yem-başına
// IntD varsayılanı lpBuilder.rupIntDByCategory'de korunuyor (mpComponentsPerKgDM kullanır).
