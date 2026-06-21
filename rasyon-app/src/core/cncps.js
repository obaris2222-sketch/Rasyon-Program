/**
 * CNCPS v6.5 Rumen Fermentasyon Modeli
 * Cornell Net Carbohydrate and Protein System
 * Kaynaklar:
 *   Van Amburgh et al. (2015) JDS 98(9):6361–6380
 *   Tylutki et al. (2008) AFST 143:174–202
 *   Sniffen et al. (1992) JAS 70:3562–3577
 *   Seo et al. (2006) - pasaj hızı denklemleri
 */

import {
  MCP_INTESTINAL_DIGESTIBILITY,
  RDP_TO_MCP_EFFICIENCY,
  TDN_TO_MCP_G_PER_KG,
} from './constants.js';

// ─── PASAJ HIZLARI (Seo et al. 2006, CNCPS v6.1+) ────────────────────────

/**
 * Sıvı pasaj hızı
 * @param {number} dmi   - Kuru madde tüketimi (kg/gün)
 * @param {number} bw    - Canlı ağırlık (kg)
 * @returns {number} Kp_liquid (%/saat)
 */
export function kpLiquid(dmi, bw) {
  const mbw = Math.pow(bw, 0.75);
  return 7.7 + 0.10 * (dmi / mbw);
}

/**
 * Konsantre yem (katı) pasaj hızı
 * @param {number} ndfPct       - Rasyon NDF'i (% KM)
 * @param {number} meIntake     - ME alımı (Mcal/gün) = NEL × 1.64 yaklaşımı
 * @param {number} bw           - Canlı ağırlık (kg)
 * @returns {number} Kp_concentrate (%/saat)
 */
export function kpConcentrate(ndfPct, meIntake, bw) {
  return 2.904 - 0.022 * ndfPct + 0.0144 * meIntake + 0.000936 * bw;
}

/**
 * Kaba yem (katı) pasaj hızı
 * @param {number} concentrateRatio - Konsantre oranı (0-1, KM bazında)
 * @param {number} bw               - Canlı ağırlık (kg)
 * @returns {number} Kp_roughage (%/saat)
 */
export function kpRoughage(concentrateRatio, bw) {
  if (concentrateRatio <= 0) concentrateRatio = 0.001;
  return 3.054 + 0.614 * Math.log10(concentrateRatio) + 0.000636 * bw;
}

/**
 * Tüm pasaj hızlarını hesapla
 * @param {object} params
 * @returns {object} { liquid, concentrate, roughage } (%/saat)
 */
export function calcPassageRates(params) {
  const { dmi, bw, ndfPct, meIntake, concentrateRatio } = params;
  return {
    liquid: Math.round(kpLiquid(dmi, bw) * 100) / 100,
    concentrate: Math.round(kpConcentrate(ndfPct, meIntake, bw) * 100) / 100,
    roughage: Math.round(kpRoughage(concentrateRatio, bw) * 100) / 100,
  };
}

// ─── KARBONHİDRAT FRAKSIYONLARI ─────────────────────────────────────────────

/**
 * CHO Fraksiyonlarını hesapla
 * Girdi: yem maddesinin analiz değerleri (% KM bazında)
 * @param {object} feed
 *   @param {number} feed.nfc     - Non-Fiber Carbohydrate (% KM)
 *   @param {number} feed.sugar   - Şeker (% KM)
 *   @param {number} feed.starch  - Nişasta (% KM)
 *   @param {number} feed.ndf     - NDF (% KM)
 *   @param {number} feed.aNDF    - Parçacık boyutu düzeltmeli NDF (% KM)
 *   @param {number} feed.adf     - ADF (% KM)
 *   @param {number} feed.dm      - KM (%)
 * @returns {object} CHO fraksiyonları (% KM) + parçalanma hızları (%/saat)
 */
export function calcCHOFractions(feed) {
  const { nfc, sugar = 0, starch = 0, ndf, aNDF, adf } = feed;

  // Lignin — FAZ 10I: yem-spesifik veya ADF korelasyonu fallback
  // Modern yem analizinde sa-NDF (sulfite-asid NDF) veya direkt lignin verilir.
  // Yem girdisinde feed.lignin (% KM) varsa öncelikli; yoksa Van Soest ADF×0.127 fallback.
  // (Roughage'da gerçek lignin / ADF oranı 0.10-0.18 arası — silajda düşük, olgun otta yüksek)
  const lignin = Number.isFinite(Number(feed.lignin)) && Number(feed.lignin) > 0
    ? Number(feed.lignin)
    : num(adf) * 0.127;

  // CHO-A: Şeker + organik asitler + fermente KM
  // Genellikle NFC'nin şeker fraksiyonu + fermente KM katkısı
  const choA = Math.max(num(sugar), num(nfc) * 0.25);  // En az %25 NFC CHO-A

  // CHO-B1: Nişasta + pektinler
  const choB1 = Math.max(num(starch), num(nfc) - choA);

  // CHO-C: Lignin bağlı indigestible NDF
  const choC = Math.min(lignin * 2.4, num(ndf) * 0.55);  // CNCPS v6.5

  // CHO-B2: Fermente edilebilir NDF = aNDF - indigestible NDF (CNCPS v6.5)
  // aNDF (amylaz+sodyumsülfat ile işlem görmüş) nişasta kontaminasyonunu giderir.
  // FAZ 13.12: aNDF eksik/0 ise NDF×0.95 fallback — aksi halde choB2 = aNDF−choC
  // negatif olup sıfırlanır ve fermente NDF kaybolur (56 yemde aNDF=0 sorunu).
  const effectiveANDF = Number.isFinite(Number(aNDF)) && Number(aNDF) > 0
    ? Number(aNDF)
    : num(ndf) * 0.95;
  const choB2 = Math.max(effectiveANDF - choC, 0);

  // Parçalanma hızları (kd, %/saat) — FAZ 10D: yem-spesifik veya kategori-bazlı
  // Yem girdisinde kdB1/kdB2/kdB3 varsa öncelikli kullan (AMTS.Cattle.Pro yaklaşımı)
  // Yoksa kategori-bazlı CNCPS v6.5 tipik değerler
  const catDefaults = kdCategoryDefaults(feed.category);
  const kd = {
    choA:  300,                                          // Anında (sabit, CNCPS standardı)
    choB1: num(feed.choKdB1) || num(feed.kdB1) || catDefaults.choB1,
    choB2: num(feed.choKdB2) || num(feed.kdB2) || catDefaults.choB2,
    choC:  num(feed.choKdB3) || num(feed.kdB3) || 0,     // choC fermente olmaz, kdB3 sadece referans
  };

  return {
    choA: Math.round(choA * 100) / 100,
    choB1: Math.round(choB1 * 100) / 100,
    choB2: Math.round(choB2 * 100) / 100,
    choC: Math.round(choC * 100) / 100,
    lignin: Math.round(lignin * 100) / 100,
    kd,
  };
}

/**
 * Kategori-bazlı CHO kd varsayılanları (FAZ 10D)
 * Kaynak: CNCPS v6.5 tipik aralıkları (Van Amburgh et al. 2015)
 *
 * choB1 (hızlı KH: nişasta + pektin):
 *   - grain (mısır vb.):    25 %/saat (mısır 4-6, buğday 35-45)
 *   - protein konsantre:    30 %/saat (soya küspesi)
 *   - byproduct:            20 %/saat
 *   - roughage:             10 %/saat (silaj nişastası yavaş)
 *
 * choB2 (yavaş KH: fermente NDF):
 *   - roughage (silaj):     5 %/saat (mısır silajı 4-6)
 *   - kaba ot (kuru):       3 %/saat (yonca kuru ot)
 *   - grain:                7 %/saat (mısır kepeği bypass az)
 *   - protein:              6 %/saat
 */
function kdCategoryDefaults(category) {
  switch (category) {
    case 'grain':     return { choB1: 25, choB2: 7 };
    case 'protein':   return { choB1: 30, choB2: 6 };
    case 'byproduct': return { choB1: 20, choB2: 5 };
    case 'roughage':  return { choB1: 10, choB2: 4 };
    case 'fat':       return { choB1: 0,  choB2: 0 };
    case 'mineral':   return { choB1: 0,  choB2: 0 };
    default:          return { choB1: 25, choB2: 5 };
  }
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Efektif rumen parçalanabilirlik
 * ED = kd / (kd + kp) için her fraksiyon
 * @param {number} kd  - Parçalanma hızı (%/saat)
 * @param {number} kp  - Pasaj hızı (%/saat)
 * @returns {number} Efektif parçalanabilirlik (0-1)
 */
export function effectiveDegradability(kd, kp) {
  if (kd === 0) return 0;
  if (kd >= 300) return 1.0; // Pratikte anında
  return kd / (kd + kp);
}

/**
 * Rasyonun CHO fraksiyonlarını ağırlıklı ortalama ile hesapla
 * @param {Array} ingredients - [{ feed, dmKg }] listesi
 * @param {number} totalDmKg  - Toplam KM (kg/gün)
 * @param {object} kp         - Pasaj hızları { concentrate, roughage, liquid }
 * @returns {object} Rasyon düzeyinde CHO fraksiyonları ve fermente edilebilir CHO
 */
export function calcRationCHO(ingredients, totalDmKg, kp) {
  let choA = 0, choB1 = 0, choB2 = 0, choC = 0;
  let fermentableA = 0, fermentableB1 = 0, fermentableB2 = 0;

  for (const { feed, dmKg } of ingredients) {
    const frac = calcCHOFractions(feed);
    const proportion = dmKg / totalDmKg;

    choA += frac.choA * proportion;
    choB1 += frac.choB1 * proportion;
    choB2 += frac.choB2 * proportion;
    choC += frac.choC * proportion;

    // Fermente edilebilir CHO (ED × miktar)
    const isRoughage = feed.category === 'roughage';
    const kpSolid = isRoughage ? kp.roughage : kp.concentrate;

    fermentableA += frac.choA * proportion * effectiveDegradability(frac.kd.choA, kp.liquid);
    fermentableB1 += frac.choB1 * proportion * effectiveDegradability(frac.kd.choB1, kpSolid);
    fermentableB2 += frac.choB2 * proportion * effectiveDegradability(frac.kd.choB2, kpSolid);
    // choC fermante olmaz
  }

  const totalFermentableCHO = fermentableA + fermentableB1 + fermentableB2;

  return {
    choA: Math.round(choA * 100) / 100,
    choB1: Math.round(choB1 * 100) / 100,
    choB2: Math.round(choB2 * 100) / 100,
    choC: Math.round(choC * 100) / 100,
    fermentableA: Math.round(fermentableA * 100) / 100,
    fermentableB1: Math.round(fermentableB1 * 100) / 100,
    fermentableB2: Math.round(fermentableB2 * 100) / 100,
    totalFermentableCHO: Math.round(totalFermentableCHO * 100) / 100,
  };
}

// ─── PROTEİN FRAKSIYONLARI ───────────────────────────────────────────────────

/**
 * Protein Fraksiyonlarını hesapla (CNCPS v6.5)
 * @param {object} feed
 *   @param {number} feed.cp    - Ham protein (% KM)
 *   @param {number} feed.ndicp - NDF çözünmez ham protein (% CP)
 *   @param {number} feed.adicp - ADF çözünmez ham protein (% CP) - ısı hasarı
 *   @param {number} feed.solCP - Tampon çözünür protein (% CP)
 *   @param {number} feed.pa    - NPN fraksiyonu (% CP) - bilinmiyorsa solCP'den hesaplanır
 * @returns {object} Protein fraksiyonları (% CP) + parçalanma hızları
 */
export function calcProteinFractions(feed) {
  const { cp, ndicp = 15, adicp = 8, solCP = 35, pa: paInput } = feed;

  // PC: Isıyla hasar görmüş bağlı protein (% CP) - ADICP'tan
  const pc = adicp;

  // PA: NPN (% CP) - tampon çözünür proteinin üre vb. kısmı
  const pa = paInput !== undefined ? paInput : Math.min(solCP * 0.4, 15);

  // PB1: Hızlı çözünen gerçek protein = tampon çözünür - PA
  const pb1 = Math.max(solCP - pa, 0);

  // PB3: Yavaş çözünen (NDICP - ADICP, bitki depolama proteini)
  const pb3 = Math.max(ndicp - adicp, 0);

  // PB2: Geriye kalan orta hızlı protein = 100 - PA - PB1 - PB3 - PC
  const pb2 = Math.max(100 - pa - pb1 - pb3 - pc, 0);

  // Parçalanma hızları (kd, %/saat)
  const kd = {
    pa: 300,    // Anında (NPN)
    pb1: 135,   // Çözünür gerçek protein (eski kodda yanlışlıkla protKdB1'e bağlanmıştı)
    pb2: num(feed.protKdB1) || num(feed.protKdB2) || 8, // Çözünmez gerçek protein (orta-hızlı parçalanan ağırlıklı)
    pb3: num(feed.protKdB3) || 0.4,   // Yavaş (<1%/saat)
    pc: 0,      // Sıfır
  };

  return {
    pa: Math.round(pa * 100) / 100,
    pb1: Math.round(pb1 * 100) / 100,
    pb2: Math.round(pb2 * 100) / 100,
    pb3: Math.round(pb3 * 100) / 100,
    pc: Math.round(pc * 100) / 100,
    total: Math.round((pa + pb1 + pb2 + pb3 + pc) * 100) / 100,
    kd,
  };
}

/**
 * RDP ve RUP hesabı - yem düzeyinde
 * @param {object} feed     - Yem analiz değerleri
 * @param {number} kpSolid  - Katı pasaj hızı (%/saat)
 * @returns {object} { rdpPct, rupPct, rdpKg, rupKg } (% CP ve kg/gün)
 */
export function calcRDPandRUP(feed, kpSolid) {
  const fractions = calcProteinFractions(feed);
  const { kd, pa, pb1, pb2, pb3, pc } = fractions;

  // Her fraksiyonun efektif rumen parçalanabilirliği
  const edPA  = 1.0;  // Anında
  const edPB1 = effectiveDegradability(kd.pb1, kpSolid);
  const edPB2 = effectiveDegradability(kd.pb2, kpSolid);
  const edPB3 = effectiveDegradability(kd.pb3, kpSolid);
  const edPC  = 0;    // Sıfır

  // RDP (% CP) = ağırlıklı ortalama ED
  const rdpPct = pa * edPA + pb1 * edPB1 + pb2 * edPB2 + pb3 * edPB3 + pc * edPC;
  const rupPct = 100 - rdpPct;

  return {
    rdpPct: Math.round(rdpPct * 10) / 10,
    rupPct: Math.round(rupPct * 10) / 10,
    edPA, edPB1, edPB2, edPB3,
    fractions,
  };
}

// ─── CNCPS v6.5 TAM ALT FRAKSİYONLAR (FAZ 16.3) ─────────────────────────────
//
// Aşağıdaki fonksiyonlar CNCPS v6.5'in ayrıntılı (8 havuz CHO + 6 havuz protein)
// alt fraksiyonlamasını EK bir tanı/gösterim katmanı olarak sağlar. Mevcut
// calcCHOFractions (4 havuz) ve calcProteinFractions (5 havuz) RDP/RUP/MCP
// pipeline'ını besler ve DEĞİŞMEZ — bu fonksiyonlar onları bozmaz, yalnızca daha
// ince granülaritede analiz sunar (AMTS/NDS per-feed CNCPS profili gibi).
// Kaynak: Van Amburgh et al. (2015) JDS 98:6361; Higgs (2014) PhD tezi, Cornell.

function r2(v) { return Math.round(v * 100) / 100; }

/**
 * CNCPS v6.5 Karbonhidrat ALT Fraksiyonları — 8 havuz (% KM)
 *
 *   CA1 = Organik asitler (uçucu yağ asitleri: asetik/propiyonik/butirik)
 *   CA2 = Laktik asit
 *   CA3 = Diğer organik asitler
 *   CA4 = Şekerler (suda çözünür karbonhidrat, WSC)
 *   CB1 = Nişasta
 *   CB2 = Çözünür lif (pektin, β-glukan — NDF dışı çözünür yapısal CHO)
 *   CB3 = Sindirilebilir (kullanılabilir) NDF = aNDF − CC
 *   CC  = Sindirilemeyen NDF = lignin × 2.4
 *
 * Kütle dengesi: CA1+CA2+CA3+CA4+CB1+CB2 = NFC; CB3+CC = NDF (effektif aNDF).
 *
 * ⚠️ Bilimsel dürüstlük: CA1/CA2/CA3 (fermentasyon asitleri) yalnızca ENSİLE
 * edilmiş (silaj) yemlerde anlamlıdır. Doğrudan silaj fermentasyon analizi
 * (laktik/asetik asit, pH) yoksa kalan non-nişasta NFC'den TAHMİN edilir — iyi
 * fermente silajlarda hafif düşük tahmin edilebilir. Şeker (CA4) ve nişasta (CB1)
 * ölçülen yem alanlarından alınır; çözünür lif (CB2) artıktır.
 *
 * @param {object} feed - yem analiz değerleri (% KM)
 * @returns {object} { cA1..cC, lignin, ensiled, total, kd }
 */
export function calcCHOSubFractions(feed) {
  const cp = num(feed.cp), fat = num(feed.fat), ash = num(feed.ash), ndf = num(feed.ndf);
  const adf = num(feed.adf);
  const dm = num(feed.dm, 90);
  const starch = num(feed.starch);
  const sugar = num(feed.sugar);

  // NFC: verilen alan veya hesapla (100 − CP − yağ − kül − NDF)
  const nfc = Number.isFinite(Number(feed.nfc))
    ? Number(feed.nfc)
    : Math.max(0, 100 - cp - fat - ash - ndf);

  // CC (sindirilemeyen) + CB3 (sindirilebilir) NDF — calcCHOFractions ile aynı mantık
  const lignin = Number.isFinite(Number(feed.lignin)) && Number(feed.lignin) > 0
    ? Number(feed.lignin) : adf * 0.127;
  const cC = Math.min(lignin * 2.4, ndf * 0.55);
  const effectiveANDF = Number.isFinite(Number(feed.aNDF)) && Number(feed.aNDF) > 0
    ? Number(feed.aNDF) : ndf * 0.95;
  const cB3 = Math.max(effectiveANDF - cC, 0);

  // CB1 (nişasta) — NFC'yi aşamaz
  const cB1 = Math.min(starch, nfc);
  let rest = Math.max(0, nfc - cB1);

  // Ensile (silaj) tespiti: ıslak kaba yem (KM<%55) veya ad/id'de "silaj"
  const ensiled = (feed.category === 'roughage' && dm < 55)
    || /sila|silage|silaj/i.test(`${feed.id || ''} ${feed.name || ''}`);

  // CA4 (şeker/WSC) — ölçülen şeker, kalan NFC ile sınırlı
  const cA4 = Math.min(sugar, rest);
  rest = Math.max(0, rest - cA4);

  // Organik asitler (yalnızca ensile) — kalan non-nişasta NFC'den tahmin
  let cA1 = 0, cA2 = 0, cA3 = 0;
  if (ensiled && rest > 0) {
    const oaTotal = rest * 0.70;   // silaj çözünür havuzunun ~%70'i fermentasyon asidi
    cA2 = oaTotal * 0.60;          // laktik asit (baskın)
    cA1 = oaTotal * 0.30;          // VFA (asetik+propiyonik+butirik)
    cA3 = oaTotal * 0.10;          // diğer organik asitler
    rest = Math.max(0, rest - oaTotal);
  }

  // CB2 (çözünür lif / pektin) = kalan NFC
  const cB2 = rest;

  // Parçalanma hızları (kd, %/saat) — CNCPS v6.5 tipik (kategori-bazlı CB1/CB3)
  const cat = kdCategoryDefaults(feed.category);
  const kd = {
    cA1: 0, cA2: 0, cA3: 0,            // fermentasyon ürünü — mikrobiyal CHO substratı değil (absorbe edilir)
    cA4: 300,                          // şeker — anında/çok hızlı
    cB1: num(feed.choKdB1) || num(feed.kdB1) || cat.choB1,  // nişasta
    cB2: 40,                           // çözünür lif (pektin) — hızlı
    cB3: num(feed.choKdB2) || num(feed.kdB2) || cat.choB2,  // sindirilebilir NDF — yavaş
    cC: 0,
  };

  const total = cA1 + cA2 + cA3 + cA4 + cB1 + cB2 + cB3 + cC;
  return {
    cA1: r2(cA1), cA2: r2(cA2), cA3: r2(cA3), cA4: r2(cA4),
    cB1: r2(cB1), cB2: r2(cB2), cB3: r2(cB3), cC: r2(cC),
    lignin: r2(lignin), ensiled, total: r2(total), kd,
  };
}

/**
 * CNCPS v6.5 Protein ALT Fraksiyonları — 6 havuz (% CP)
 *
 *   PA1 = NPN (protein olmayan azot — amonyak, nitrat, serbest AA-N)
 *   PA2 = Çözünür gerçek protein (peptitler + serbest AA) — mikrobiyal büyümeyi uyarır
 *   PB1 = Çözünmez gerçek protein (orta-hızlı parçalanan)
 *   PB2 = Yavaş parçalanan çözünmez protein
 *   PB3 = Lif-bağlı protein (NDICP − ADICP)
 *   PC  = Kullanılamayan / ısı hasarlı protein (ADICP)
 *
 * v6.5 inceltmesi: eski tek çözünür havuz NPN (PA1) + peptit (PA2) olarak ayrılır;
 * eski çözünmez-orta havuz PB1 (hızlı) + PB2 (yavaş) olarak inceltilir.
 * Mevcut pipeline ile tutarlı eşleme: PA1 = eski pa, PA2 = eski pb1,
 * PB3 = eski pb3, PC = eski pc; eski pb2 → PB1 + PB2.
 * Kütle dengesi: PA1+PA2+PB1+PB2+PB3+PC = 100% CP.
 *
 * @param {object} feed - yem analiz değerleri
 * @returns {object} { pA1..pC, total, kd }
 */
export function calcProteinSubFractions(feed) {
  const ndicp = num(feed.ndicp, 15);
  const adicp = num(feed.adicp, 8);
  const solCP = num(feed.solCP, 35);

  const pC = adicp;                          // ısı hasarlı (ADICP)
  const pB3 = Math.max(ndicp - adicp, 0);    // lif-bağlı (NDICP − ADICP)

  // Çözünür CP → PA1 (NPN) + PA2 (peptit / çözünür gerçek protein)
  const npn = feed.pa !== undefined ? num(feed.pa) : Math.min(solCP * 0.4, 15);
  const pA1 = Math.min(npn, solCP);
  const pA2 = Math.max(solCP - pA1, 0);

  // Çözünmez gerçek protein → PB1 (hızlı) + PB2 (yavaş)
  const insolubleTrue = Math.max(100 - solCP - pB3 - pC, 0);
  const b1ratio = proteinB1Ratio(feed.category);
  const pB1 = insolubleTrue * b1ratio;
  const pB2 = insolubleTrue * (1 - b1ratio);

  // Parçalanma hızları (kd, %/saat) — CNCPS v6.5 tipik
  const kd = {
    pA1: 300,   // NPN → amonyak, anında
    pA2: 135,   // peptit / çözünür gerçek protein, hızlı
    pB1: num(feed.protKdB1) || 11,    // çözünmez orta-hızlı
    pB2: num(feed.protKdB2) || 4,     // çözünmez yavaş
    pB3: num(feed.protKdB3) || 0.5,   // lif-bağlı, çok yavaş
    pC: 0,
  };

  const total = pA1 + pA2 + pB1 + pB2 + pB3 + pC;
  return {
    pA1: r2(pA1), pA2: r2(pA2), pB1: r2(pB1), pB2: r2(pB2), pB3: r2(pB3), pC: r2(pC),
    total: r2(total), kd,
  };
}

/** Çözünmez gerçek proteinin PB1 (hızlı) payı — kategori bazlı (kalan PB2'ye gider) */
function proteinB1Ratio(category) {
  switch (category) {
    case 'protein':   return 0.65;   // küspeler — daha hızlı çözünmez protein
    case 'grain':     return 0.60;
    case 'byproduct': return 0.55;
    case 'roughage':  return 0.40;   // kaba yem — daha yavaş
    default:          return 0.55;
  }
}

/**
 * Rasyon düzeyinde CNCPS v6.5 alt fraksiyonları (FAZ 16.3)
 * CHO: KM-ağırlıklı (% KM). Protein: CP-ağırlıklı (% CP).
 *
 * @param {Array} ingredients - [{ feed, dmKg }]
 * @param {number} totalDmKg
 * @returns {object} { cho: {cA1..cC}, protein: {pA1..pC}, totalCP_g }
 */
export function aggregateCNCPSSubFractions(ingredients, totalDmKg) {
  const cho = { cA1: 0, cA2: 0, cA3: 0, cA4: 0, cB1: 0, cB2: 0, cB3: 0, cC: 0 };
  const protG = { pA1: 0, pA2: 0, pB1: 0, pB2: 0, pB3: 0, pC: 0 };
  let totalCPg = 0;
  if (!Array.isArray(ingredients) || !totalDmKg || totalDmKg <= 0) {
    return { cho, protein: { ...protG }, totalCP_g: 0 };
  }
  for (const { feed, dmKg } of ingredients) {
    if (!feed || !dmKg || dmKg <= 0) continue;
    const prop = dmKg / totalDmKg;
    const c = calcCHOSubFractions(feed);
    for (const k of Object.keys(cho)) cho[k] += c[k] * prop;   // % KM ağırlıklı
    const cpG = num(feed.cp) / 100 * dmKg * 1000;              // g CP
    if (cpG > 0) {
      totalCPg += cpG;
      const p = calcProteinSubFractions(feed);
      for (const k of Object.keys(protG)) protG[k] += (p[k] / 100) * cpG;  // g CP havuzu
    }
  }
  for (const k of Object.keys(cho)) cho[k] = r2(cho[k]);
  const protein = {};
  for (const k of Object.keys(protG)) protein[k] = totalCPg > 0 ? r2(protG[k] / totalCPg * 100) : 0;
  return { cho, protein, totalCP_g: Math.round(totalCPg) };
}

// ─── MİKROBİYAL PROTEİN SENTEZİ ─────────────────────────────────────────────

/**
 * Mikrobiyal Ham Protein (MCP) Sentezi - CNCPS tabanlı
 * Kısıtlayıcı faktör: enerji veya RDP
 * @param {object} params
 *   @param {number} params.fermentableCHO_kg   - Fermente edilebilir CHO (kg KM/gün)
 *   @param {number} params.rdp_g               - Günlük RDP tedariki (g/gün)
 *   @param {number} params.dmi                 - KMT (kg/gün) - ek kontrol için
 * @returns {object} MCP sentez sonuçları
 */
export function calcMCPSynthesis(params) {
  const { fermentableCHO_kg, rdp_g, dmi } = params;

  // CNCPS: MCP = 130 g/kg fermentable OM (fermente edilebilir organik madde)
  // Yaklaşım: fermentable CHO × 130 g/kg
  const mcpFromEnergy = fermentableCHO_kg * TDN_TO_MCP_G_PER_KG;   // g/gün

  // RDP kısıtı: MCP = RDP × 0.85 (N verimi)
  const mcpFromRDP = rdp_g * RDP_TO_MCP_EFFICIENCY;

  // Kısıtlayıcı faktör
  const mcp = Math.min(mcpFromEnergy, mcpFromRDP);
  const limitingFactor = mcpFromEnergy <= mcpFromRDP ? 'energy' : 'rdp';

  // FAZ 13.2: MP = MCP × 0.64 (CNCPS v6.5 + NASEM 2021 intestinal sindirilebilirlik)
  const mpMicrobial = mcp * MCP_INTESTINAL_DIGESTIBILITY;

  // Mikrobiyel N verimi skoru (ideal: 1.0)
  const nUseEfficiency = Math.min(mcpFromRDP, mcpFromEnergy) / Math.max(mcpFromRDP, mcpFromEnergy);

  return {
    mcpFromEnergy: Math.round(mcpFromEnergy),
    mcpFromRDP: Math.round(mcpFromRDP),
    mcp: Math.round(mcp),
    mpMicrobial: Math.round(mpMicrobial),
    limitingFactor,
    nUseEfficiency: Math.round(nUseEfficiency * 100) / 100,
  };
}

// ─── RUMEN pH TAHMİNİ (CNCPS tabanlı) ───────────────────────────────────────

/**
 * Rumen pH ve SARA riski - CNCPS modeli
 * Kaynaklar: Beauchemin & Yang (2005); Hall et al. (2010)
 * @param {object} ration
 *   @param {number} ration.totalFermentableCHO_pct  - Fermente edilebilir CHO (% KM)
 *   @param {number} ration.peNDF_pct                - peNDF (% KM)
 *   @param {number} ration.nfc_pct                  - NFC (% KM)
 *   @param {number} ration.forageNDF_pct             - Kaba yem NDF (% KM rasyon)
 * @returns {object} { minPH, meanPH, saraRisk, hoursBelow58 }
 */
export function calcRumenPHProfile(ration) {
  const { totalFermentableCHO_pct, peNDF_pct, nfc_pct, forageNDF_pct } = ration;

  // Ortalama günlük rumen pH tahmini
  let meanPH = 6.80
    - 0.019 * nfc_pct
    + 0.022 * peNDF_pct;

  // Kaba yem NDF düzeltmesi
  if (forageNDF_pct !== undefined) {
    if (forageNDF_pct < 19) meanPH -= 0.20;
    else if (forageNDF_pct < 22) meanPH -= 0.08;
  }

  meanPH = Math.max(5.5, Math.min(7.0, meanPH));

  // Minimum pH (yemlemeden 4-6 saat sonra)
  const minPH = meanPH - 0.35;

  // SARA tanımı: pH < 5.8 günde >3 saat
  let saraRisk, hoursBelow58;
  if (minPH >= 5.8) {
    saraRisk = 'low';
    hoursBelow58 = 0;
  } else if (minPH >= 5.5) {
    saraRisk = 'moderate';
    hoursBelow58 = Math.round((5.8 - minPH) / 0.05 * 1.5);
  } else {
    saraRisk = 'high';
    hoursBelow58 = Math.min(12, Math.round((5.8 - minPH) / 0.05 * 2.5));
  }

  return {
    meanPH: Math.round(meanPH * 100) / 100,
    minPH: Math.round(minPH * 100) / 100,
    saraRisk,
    hoursBelow58,
  };
}

// ─── RASYON DÜZEYİNDE CNCPS ÇIKTISI ─────────────────────────────────────────

/**
 * Tam CNCPS v6.5 rasyon analizi
 * @param {object} rationParams
 *   @param {Array}  rationParams.ingredients   - [{ feed, dmKg, category }]
 *   @param {number} rationParams.totalDmKg     - Toplam KMT
 *   @param {object} rationParams.animal        - Hayvan profili
 *   @param {object} rationParams.passageRates  - { liquid, concentrate, roughage }
 * @returns {object} Tam CNCPS çıktısı
 */
export function calcCNCPS(rationParams) {
  const { ingredients, totalDmKg, animal, passageRates } = rationParams;
  const kp = passageRates;

  // CHO fraksiyonları
  const choPct = calcRationCHO(ingredients, totalDmKg, kp);

  // Fermente edilebilir CHO kg/gün
  const fermentableCHO_kg = choPct.totalFermentableCHO * totalDmKg / 100;

  // RDP/RUP tedariki
  let totalRDP_g = 0;
  let totalRUP_g = 0;
  let totalCP_g = 0;

  for (const { feed, dmKg } of ingredients) {
    const isRoughage = feed.category === 'roughage';
    const kpSolid = isRoughage ? kp.roughage : kp.concentrate;
    const cpG = (feed.cp / 100) * dmKg * 1000;
    const { rdpPct, rupPct } = calcRDPandRUP(feed, kpSolid);
    totalRDP_g += cpG * rdpPct / 100;
    totalRUP_g += cpG * rupPct / 100;
    totalCP_g += cpG;
  }

  // MCP sentezi
  const mcpResult = calcMCPSynthesis({
    fermentableCHO_kg,
    rdp_g: totalRDP_g,
    dmi: totalDmKg,
  });

  // NFC hesabı (rasyon düzeyinde ağırlıklı ortalama)
  let nfcPct = 0, peNDFPct = 0, forageNDFPct = 0, forageKm = 0;
  for (const { feed, dmKg } of ingredients) {
    const prop = dmKg / totalDmKg;
    const nfc = 100 - (feed.cp || 0) - (feed.fat || 0) - (feed.ash || 0) - (feed.ndf || 0);
    nfcPct += nfc * prop;
    const pef = feed.category === 'roughage' ? 1.0 : 0.42;
    peNDFPct += (feed.ndf || 0) * pef * prop;
    if (feed.category === 'roughage') {
      forageNDFPct += (feed.ndf || 0) * prop;
      forageKm += dmKg;
    }
  }

  // Rumen pH profili
  const rumenPH = calcRumenPHProfile({
    totalFermentableCHO_pct: choPct.totalFermentableCHO,
    peNDF_pct: peNDFPct,
    nfc_pct: nfcPct,
    forageNDF_pct: forageNDFPct,
  });

  return {
    cho: choPct,
    fermentableCHO_kg: Math.round(fermentableCHO_kg * 100) / 100,
    rdp: {
      total_g: Math.round(totalRDP_g),
      pctCP: Math.round((totalRDP_g / totalCP_g) * 1000) / 10,
    },
    rup: {
      total_g: Math.round(totalRUP_g),
      pctCP: Math.round((totalRUP_g / totalCP_g) * 1000) / 10,
    },
    mcp: mcpResult,
    rumen: {
      ...rumenPH,
      peNDFPct: Math.round(peNDFPct * 10) / 10,
      nfcPct: Math.round(nfcPct * 10) / 10,
      forageRatioPct: Math.round((forageKm / totalDmKg) * 1000) / 10,
    },
  };
}

// ─── FAZ 19.1 — FORMÜLASYON MOTORU ARZ API'Sİ (İTERATİF CNCPS) ───────────────
//
// Aşağıdaki fonksiyonlar LP'nin per-feed MP havuz KATSAYILARINI pasaj hızına (kp)
// bağlı olarak üretir. Mevcut gösterim yolu (calcCNCPS) DOKUNULMAZ; bu API yalnız
// "CNCPS hesap modu"nda (opt-in) rationOptimizer'ın iteratif döngüsünden çağrılır.
//
// ── v1 KAPSAM KARARI (FAZ 19.1c) ──
// Pasaj-bağımlılığı v1'de yalnız PROTEİN yıkımına (RDP↔RUP) uygulanır; bu, yemin
// KİTAP rdp/rup değerine SABİTLENİR (referans pasaj kp_ref). Enerji havuzu (mikrobiyal
// MP'nin enerji-yolu) NRC TDN temelinde KALIR — lpBuilder.mpComponentsPerKgDM ile aynı
// (enerji/NEL CNCPS-ME kapsam dışı; FAZ 18.4 zaten tüketim-iskontosu uyguluyor).
// Gerekçe: fermente-CHO temelli enerji-MCP, ölçülü kd olmadan kaba yemlerde sistematik
// sapar (kategori-default fiber kd → kitap TDN'le çelişir) → infeasibility/yanlış
// formülasyon. Pasaj-bağımlı protein yıkımı ise textbook ve veri-hafif (kitap rdp yeterli).
// 19.2'de ölçülü fraksiyon eklenince enerji havuzu da fermente-CHO'ya geçirilebilir.
//
// Dönüş şekli lpBuilder.mpComponentsPerKgDM ile UYUMLUDUR (mpEnergyPool / mpRdpPool /
// mpRUP / mpTotal). Tüm MP değerleri g MP / kg KM.

const CNCPS_KP_REF = 5.0;   // referans katı pasaj hızı (%/saat) — kitap rdp bu pasaja sabitlenir

/**
 * RUP intestinal sindirilebilirliği (% — kategori bazlı varsayılan).
 * Yem-spesifik feed.rupIntD verilirse o önceliklidir.
 * ⚠️ lpBuilder.js rupIntDByCategory ile AYNI tutulmalı — core→solver import yön
 * ihlali olmasın diye kasıtlı kopya (FAZ 19.1b'de tek-kaynağa taşınabilir).
 */
function rupIntestinalDig(feed) {
  const explicit = num(feed.rupIntD, 0);
  if (explicit > 0) return explicit;
  switch (feed.category) {
    case 'protein':   return 88;   // Soya 92, kanola 75 — yüksek IntD
    case 'grain':     return 85;
    case 'byproduct': return 70;
    case 'roughage':  return 65;
    case 'fat':
    case 'mineral':   return 0;
    default:          return 80;
  }
}

/** NRC TDN-temelli enerji-yolu mikrobiyal MP (g MP/kg KM) — lpBuilder.mpComponentsPerKgDM
 *  ile BİREBİR aynı türetme (CNCPS modunda enerji havuzu NRC ile tutarlı kalsın diye). */
function tdnEnergyPool(feed) {
  let tdnPct = num(feed.tdn);
  if (tdnPct === 0) {
    const effNel = num(feed.nel) * (1 - Math.max(0, Math.min(100, num(feed.nelDiscount))) / 100);
    tdnPct = effNel > 0 ? Math.min(95, Math.max(40, (effNel + 0.12) * 40.8)) : 65;
  }
  const tdn_g = tdnPct * 10;                                    // % KM → g/kg KM
  const mcpEnergyLimited = tdn_g * TDN_TO_MCP_G_PER_KG / 1000;  // g MCP/kg KM (130 g/kg TDN = ×0.13)
  return mcpEnergyLimited * MCP_INTESTINAL_DIGESTIBILITY;       // g MP/kg KM
}

/**
 * Pasaj-bağımlı RDP fraksiyonu (0-1), yemin KİTAP rdp'sine kp_ref'te sabitlenmiş.
 *   rdp_book = kd_eff/(kd_eff + kp_ref)  ⟹  kd_eff = kp_ref · rdp_book/(1 − rdp_book)
 *   rdp(kp)  = kd_eff/(kd_eff + kp)
 * Yüksek pasaj (yüksek tüketim) → daha çok kaçış → RDP↓ / RUP↑ (CNCPS davranışı),
 * referans pasajda kitap değerine eşit. Ölçülü fraksiyon gerektirmez (kitap rdp yeterli).
 */
function passageRDPFraction(rdpBookPct, kpSolid) {
  const rdpBook = Math.max(1, Math.min(99, num(rdpBookPct, 65))) / 100;  // (0.01–0.99) clamp
  const kp = num(kpSolid);
  if (kp <= 0) return rdpBook;
  const kdEff = CNCPS_KP_REF * rdpBook / (1 - rdpBook);
  return kdEff / (kdEff + kp);
}

/**
 * FAZ 19.2 — Bir yemin CNCPS protein degradasyon verisi kaynağı.
 *  'measured' → yem ölçülü protein alt-fraksiyonlarını içerir (solCP + ndicp + adicp);
 *               RDP/RUP gerçek fraksiyonlardan + pasaj hızından (calcRDPandRUP) hesaplanır.
 *  'derived'  → bu girdiler yok; RDP/RUP yemin KİTAP rdp'sine pasajda sabitlenir (yaklaşık).
 * UI'daki "ölçülü / türetme" göstergesi (FAZ 19.2) bu fonksiyona dayanır — hangi yemlerin
 * gerçek CNCPS protein verisiyle, hangilerinin yaklaşık türetmeyle çözüldüğü şeffaf olsun.
 */
export function cncpsProteinDataSource(feed) {
  if (!feed) return 'derived';
  const has = (k) => feed[k] !== undefined && feed[k] !== null && Number.isFinite(Number(feed[k]));
  return (has('solCP') && has('ndicp') && has('adicp') && (has('protKdB1') || has('protKdB2'))) ? 'measured' : 'derived';
}

/**
 * Ölçülü kd olan yemlerde CNCPS fermentable-CHO tabanlı enerji havuzu (g MP/kg KM)
 * FAZ 24.2: NRC TDN yerine fermente edilebilir CHO üzerinden (pasaj-bağımlı).
 */
function fermentableChoEnergyPool(feed, kp) {
  const isRoughage = feed.category === 'roughage';
  const kpSolid = num(isRoughage ? kp.roughage : kp.concentrate);
  const kpLiquidVal = num(kp.liquid, 10);

  const frac = calcCHOFractions(feed);
  const edA = effectiveDegradability(frac.kd.choA, kpLiquidVal);
  const edB1 = effectiveDegradability(frac.kd.choB1, kpSolid);
  const edB2 = effectiveDegradability(frac.kd.choB2, kpSolid);

  const fermentableChoPct = frac.choA * edA + frac.choB1 * edB1 + frac.choB2 * edB2;
  const fermentableCho_g = fermentableChoPct * 10;

  // CNCPS v6.5: 130 g MCP / kg Fermentable CHO
  const mcpEnergyLimited = fermentableCho_g * (TDN_TO_MCP_G_PER_KG / 1000);
  return mcpEnergyLimited * MCP_INTESTINAL_DIGESTIBILITY;
}

/**
 * Bir yemin CNCPS-türevli MP arz katsayıları (g MP / kg KM)
 *
 *   - mpEnergyPool: Ölçülü kd varsa fermente-CHO tabanlı, yoksa NRC TDN (FAZ 24.2)
 *   - mpRdpPool:    CP_g × rdpFrac(kp)/100·... (pasaj-bağımlı)
 *   - mpRUP:        CP_g × rupFrac(kp) × intD  (pasaj-bağımlı bypass)
 *
 * @param {object} feed - yem analiz değerleri (% KM / % CP)
 * @param {object} kp   - pasaj hızları { liquid, concentrate, roughage } (%/saat)
 * @returns {object} { mpEnergyPool, mpRdpPool, mpRUP, mpMicrobial, mpTotal, dataSource, isCncpsEnergy, ...tanı }
 */
export function cncpsFeedSupply(feed, kp) {
  if (!feed || !kp) {
    return {
      mpEnergyPool: 0, mpRdpPool: 0, mpRUP: 0, mpMicrobial: 0, mpTotal: 0,
      rdpPct: 0, rupPct: 0, kpSolid: 0, dataSource: 'derived', isCncpsEnergy: false,
    };
  }
  const isRoughage = feed.category === 'roughage';
  const kpSolid = num(isRoughage ? kp.roughage : kp.concentrate);

  const dataSource = cncpsProteinDataSource(feed);      // şeffaflık göstergesi + motoru değiştirir
  
  // ── Enerji havuzu: Ölçülü yemde Fermente-CHO, yoksa NRC TDN (FAZ 24.2) ──
  const mpEnergyPool = dataSource === 'measured' ? fermentableChoEnergyPool(feed, kp) : tdnEnergyPool(feed);
  const isCncpsEnergy = dataSource === 'measured';

  // ── RDP havuzu + RUP→MP: pasaj-bağımlı protein yıkımı ──
  const cp_g = num(feed.cp) * 10;                       // % KM → g CP / kg KM
  let rdpFrac;
  let diagnostic = {};

  if (dataSource === 'measured') {
    // Ölçülü kd VARSA gerçek rdp(kp)=kd/(kd+kp) kullan
    const calc = calcRDPandRUP(feed, kpSolid);
    rdpFrac = calc.rdpPct / 100;

    // Kalibrasyon kontrolü
    const bookRdpFrac = passageRDPFraction(feed.rdp, kpSolid); // Referans pasajdaki kitap değeri
    if (Math.abs(rdpFrac - bookRdpFrac) > 0.15) { // %15'ten fazla sapma
      diagnostic.calibrationWarning = `Ölçülü RDP (${(rdpFrac*100).toFixed(1)}%) ile türetilen kitap değeri (${(bookRdpFrac*100).toFixed(1)}%) arasında yüksek sapma`;
    }
  } else {
    // YOKSA mevcut kitap-sabitli (kp_ref=5) fallback
    rdpFrac = passageRDPFraction(feed.rdp, kpSolid);
  }

  const rupFrac = 1 - rdpFrac;
  const rdp_g = cp_g * rdpFrac;
  const mpRdpPool = rdp_g * RDP_TO_MCP_EFFICIENCY * MCP_INTESTINAL_DIGESTIBILITY;

  const rup_g = cp_g * rupFrac;
  const mpRUP = rup_g * (rupIntestinalDig(feed) / 100);

  const mpMicrobial = Math.min(mpEnergyPool, mpRdpPool);
  return {
    mpEnergyPool, mpRdpPool, mpRUP,
    mpMicrobial,
    mpTotal: mpMicrobial + mpRUP,
    // tanı (UI / test)
    rdpPct: r2(rdpFrac * 100),
    rupPct: r2(rupFrac * 100),
    kpSolid: r2(kpSolid),
    dataSource,
    isCncpsEnergy,
    ...diagnostic
  };
}

/**
 * Rasyondan pasaj-hızı girdilerini türet (saf — LP çözümünden bağımsız test edilebilir).
 * calcPassageRates'in beklediği { ndfPct, concentrateRatio, meIntake } üretir.
 *
 * @param {Array} ingredients - [{ feed, dmKg }]
 * @param {number} totalDmKg  - toplam KM (kg/gün)
 * @returns {object} { ndfPct (% KM), concentrateRatio (0-1), meIntake (Mcal/gün) }
 */
export function cncpsRationInputs(ingredients, totalDmKg) {
  if (!Array.isArray(ingredients) || !totalDmKg || totalDmKg <= 0) {
    return { ndfPct: 0, concentrateRatio: 0, meIntake: 0 };
  }
  let ndfWeighted = 0, concentrateKg = 0, meIntake = 0;
  for (const { feed, dmKg } of ingredients) {
    if (!feed || !dmKg || dmKg <= 0) continue;
    ndfWeighted += num(feed.ndf) * dmKg;
    if (feed.category !== 'roughage') concentrateKg += dmKg;
    meIntake += num(feed.nel) * dmKg * 1.64;   // ME ≈ NEL × 1.64 (Mcal/gün)
  }
  return {
    ndfPct: r2(ndfWeighted / totalDmKg),
    concentrateRatio: Math.round((concentrateKg / totalDmKg) * 1000) / 1000,
    meIntake: r2(meIntake),
  };
}
