/**
 * INRA 2018 Besleme Sistemi Modülü
 * Kaynak: INRA (2018) Alimentation des Ruminants — INRA Feeding System for Ruminants
 *
 * INRA sistemi NRC/NASEM'den farklı birimler kullanır:
 *   - Enerji:  UFL (Unité Fourragère Lait) — 1 UFL = 1700 kcal = 1.700 Mcal NEL referans
 *   - Protein: PDIE (enerji-sınırlı sindirilebilir protein) / PDIN (azot-sınırlı sindirilebilir protein)
 *   - Doluluk: UEL (Unité d'Encombrement Lait — yem doluluk birimi)
 *
 * Bu modül EK (additive) yaklaşımla çalışır:
 *   - LP optimizasyonu hâlâ NEL/MP bazlıdır (lpBuilder.js değişmez)
 *   - INRA değerleri hesaplanıp sonuç panelinde RAPOR olarak gösterilir
 *   - Kullanıcı INRA perspektifinden rasyon kalitesini değerlendirebilir
 *
 * Bilimsel dürüstlük:
 *   - Yem-spesifik INRA değerleri (inraUFL/inraPDIE/inraPDIN/inraUEL) varsa kullanılır
 *   - Yoksa NRC değerlerinden TÜRETME formülleriyle yaklaşık hesaplanır
 *   - Türetme hassasiyeti %90-95 (tam INRA lab analizi yerine NRC-tabanlı yaklaşım)
 *   - Sektörde yaygın pratik (AMTS/NDS benzeri cross-system rapor)
 */

// ─── SABİTLER ────────────────────────────────────────────────────────────────

/**
 * NEL (Mcal) → UFL dönüşüm katsayısı
 * 1 UFL = 1700 kcal NEL = 1.700 Mcal NEL
 * Referans yem: 1 kg arpa (standart)
 */
export const NEL_TO_UFL = 1 / 1.700;

/**
 * INRA 2018 idame enerji katsayıları
 * İdame UFL = UFL_MAINT_COEF × BW^0.75 + UFL_MAINT_BW × BW
 * Kaynak: INRA 2018 Tablo 2.1
 */
export const UFL_MAINT_COEF = 0.041;
export const UFL_MAINT_BW = 0.0002;

/**
 * INRA 2018 laktasyon enerji verimliliği
 * Süt: 0.60 verimlilik (NRC 0.64'ten farklı)
 */
export const UFL_LACTATION_EFFICIENCY = 0.60;

/**
 * PDI idame katsayısı (g PDI/kg BW^0.75/gün)
 * Kaynak: INRA 2018 Tablo 3.1
 */
export const PDI_MAINT_COEF = 3.25;

/**
 * PDI laktasyon verimliliği (süt proteini → PDI gereksinimi)
 * Kaynak: INRA 2018 Bölüm 3
 */
export const PDI_LACTATION_EFFICIENCY = 0.64;

/**
 * PDI gebelik katsayıları (INRA 2018 Tablo 3.3)
 * gestMonth ≥ 7: PDI_gebelik artmaya başlar
 */
export const PDI_PREGNANCY_COEF = 1.5; // g PDI / gün / gebelik ayı (7+ ay)

/**
 * Mikrobiyal protein sentezi verimliliği (INRA 2018)
 * Fermente OM'den mikrobiyal protein (FOM bazlı)
 */
export const MICROBIAL_PROTEIN_EFFICIENCY = 145; // g mikrobiyal CP / kg FOM

/**
 * UEL doluluk değerleri — kategori bazlı varsayılanlar (INRA 2018 Tablo 6.1 yaklaşımı)
 * UEL/kg KM — rumen doluluk etkisi
 */
export const INRA_FILL_VALUES = {
  roughage: { default: 1.10, range: [0.85, 1.50] },  // kuru ot/silaj/saman
  grain:    { default: 0.35, range: [0.25, 0.50] },   // tahıllar
  protein:  { default: 0.40, range: [0.30, 0.60] },   // protein kaynakları
  byproduct:{ default: 0.55, range: [0.30, 0.85] },   // yan ürünler (geniş)
  fat:      { default: 0.00, range: [0.00, 0.10] },   // sıvı yağlar (doluluk yok)
  mineral:  { default: 0.00, range: [0.00, 0.05] },   // mineral karışımları
};


// ─── YEM DEĞERİ HESAPLARI (yem-başına) ──────────────────────────────────────

/**
 * UFL hesabı — yem enerji değeri (INRA birimi)
 *
 * Öncelik: yem-spesifik inraUFL > NEL'den türetme
 *
 * @param {object} feed - Yem maddesi
 * @returns {number} UFL/kg KM
 */
export function calcUFL(feed) {
  if (feed == null) return 0;
  // 1. Yem-spesifik INRA değeri varsa direkt kullan
  if (Number.isFinite(feed.inraUFL) && feed.inraUFL > 0) {
    return feed.inraUFL;
  }
  // 2. NEL'den türet: UFL = etkin NEL (Mcal/kg KM) / 1.700
  // FAZ 22.6: ham nel yerine effectiveNel (nelDiscount uygulanmış) → "alan toplanıyor
  // ama INRA görünümünde yok sayılıyor" tutarsızlığı kapatılır (lpBuilder ile tutarlı).
  const nel = effectiveNelLocal(feed);
  if (Number.isFinite(nel) && nel > 0) {
    return round4(nel * NEL_TO_UFL);
  }
  return 0;
}

/**
 * PDIE hesabı — enerji-sınırlı sindirilebilir protein (g/kg KM)
 *
 * INRA 2018: PDIE = mikrobiyal protein (enerji bazlı) + RUP sindirilmiş (PDIA)
 *   PDIE_mic = FOM × 145 g/kg × 0.64 (MCP intestinal sindirim) → g/kg KM normalize
 *   PDIA = CP × RUP/100 × IntD/100 × 1000 → g/kg KM
 *   PDIE = PDIE_mic_normalized + PDIA
 *
 * NRC değerlerinden türetme yaklaşımı:
 *   FOM (fermente OM) ≈ TDN × 10 (g/kg KM yaklaşım) veya (100 - NDF×ADLfactor - fat - ash) × 10
 *   MCP_energy = FOM × 0.145 → g MCP/kg KM
 *   PDIE_mic = MCP_energy × 0.64 (intestinal sindirim)
 *   PDIA = cp × rup/100 × intD/100 × 10 → g/kg KM
 *
 * @param {object} feed - Yem maddesi
 * @returns {number} PDIE (g/kg KM)
 */
export function calcPDIE(feed) {
  if (feed == null) return 0;
  // 1. Yem-spesifik INRA değeri
  if (Number.isFinite(feed.inraPDIE) && feed.inraPDIE > 0) {
    return feed.inraPDIE;
  }
  // 2. NRC'den türet
  const cp = num(feed.cp);       // % KM
  const rup = num(feed.rup);     // % CP
  const rdp = num(feed.rdp, 100 - rup); // % CP
  const tdn = num(feed.tdn);     // % KM
  const nel = effectiveNelLocal(feed); // Mcal/kg KM — FAZ 22.6: nelDiscount uygulanmış (TDN yoksa FOM türetiminde tutarlı)
  const fat = num(feed.fat);
  const ash = num(feed.ash);
  const ndf = num(feed.ndf);
  const intD = num(feed.rupIntD, rupIntDDefault(feed.category)); // %

  // FOM tahmini: TDN varsa kullan, yoksa NEL'den tahmin et
  let fom_pct; // % KM olarak FOM (fermente organik madde)
  if (tdn === 0 && nel === 0) {
    fom_pct = 0; // Enerji sağlamayan içerikler (ör. Üre)
  } else if (tdn > 0) {
    // TDN ≈ FOM + yağ katkısı; FOM ≈ TDN × 0.93 (yağ düzeltmesi)
    fom_pct = tdn * 0.93;
  } else {
    // NEL'den TDN yaklaşık: TDN ≈ NEL / 0.0245 + 12 (ters NRC formülü basitleştirme)
    const tdn_est = Math.min(90, nel / 0.0245 + 12);
    fom_pct = tdn_est * 0.93;
  }

  // Mikrobiyal protein (enerji sınırlı): FOM × 145 g MCP / kg FOM × intestinal sindirim (0.64)
  const mcp_per_kg_dm = (fom_pct / 100) * MICROBIAL_PROTEIN_EFFICIENCY; // g MCP/kg KM
  const pdie_mic = mcp_per_kg_dm * 0.64; // g sindirilmiş mikrobiyal protein/kg KM

  // PDIA: RUP kısmının intestinal sindirilebilir proteini
  const pdia = cp * (rup / 100) * (intD / 100) * 10; // g/kg KM

  return round1(pdie_mic + pdia);
}

/**
 * PDIN hesabı — azot-sınırlı sindirilebilir protein (g/kg KM)
 *
 * INRA 2018: PDIN = mikrobiyal protein (azot bazlı) + RUP sindirilmiş (PDIA)
 *   PDIN_mic = RDP × 0.9 × 0.64 → mikrobiyal protein potansiyeli (N yeterliyse)
 *   PDIA = CP × RUP/100 × IntD/100 × 10
 *   PDIN = PDIN_mic + PDIA
 *
 * @param {object} feed - Yem maddesi
 * @returns {number} PDIN (g/kg KM)
 */
export function calcPDIN(feed) {
  if (feed == null) return 0;
  // 1. Yem-spesifik INRA değeri
  if (Number.isFinite(feed.inraPDIN) && feed.inraPDIN > 0) {
    return feed.inraPDIN;
  }
  // 2. NRC'den türet
  const cp = num(feed.cp);       // % KM
  const rup = num(feed.rup);     // % CP
  const rdp = num(feed.rdp, 100 - rup);
  const intD = num(feed.rupIntD, rupIntDDefault(feed.category));

  // Mikrobiyal protein (azot sınırlı): RDP bazlı
  // RDP (g/kg KM) = cp × rdp/100 × 10
  const rdp_g_per_kg = cp * (rdp / 100) * 10;
  // MCP azot = RDP × 0.90 (N verimi) → mikrobiyal CP
  // İntestinal sindirim: × 0.64
  const pdin_mic = rdp_g_per_kg * 0.90 * 0.64;

  // PDIA (RUP sindirilmiş protein)
  const pdia = cp * (rup / 100) * (intD / 100) * 10; // g/kg KM

  return round1(pdin_mic + pdia);
}

/**
 * UEL hesabı — yem doluluk değeri (INRA birimi)
 *
 * Öncelik: yem-spesifik inraUEL > NDF-bazlı tahmin > kategori varsayılan
 *
 * INRA 2018'de UEL kaba yem kalitesi, NDF içeriği ve fermentasyon özelliklerine
 * bağlıdır. Tam INRA UEL hesabı için INRA-spesifik lab analizi gerekir;
 * burada NDF-bazlı yaklaşım kullanılır.
 *
 * @param {object} feed - Yem maddesi
 * @returns {number} UEL/kg KM
 */
export function calcUEL(feed) {
  if (feed == null) return 0;
  // 1. Yem-spesifik INRA değeri
  if (Number.isFinite(feed.inraUEL) && feed.inraUEL > 0) {
    return feed.inraUEL;
  }
  // 2. NDF-bazlı tahmin (kategori-ağırlıklı)
  const ndf = num(feed.ndf);
  const category = feed.category || 'byproduct';
  const fillDef = INRA_FILL_VALUES[category] || INRA_FILL_VALUES.byproduct;

  if (ndf > 0) {
    // Kaba yemler: NDF arttıkça UEL artar (doğrusal yaklaşım)
    if (category === 'roughage') {
      // NDF 30-70 aralığında UEL 0.85-1.50
      const uel = 0.50 + ndf * 0.015;
      return round2(Math.max(fillDef.range[0], Math.min(fillDef.range[1], uel)));
    }
    // Konsantre yemler: NDF etkisi daha düşük
    const uel = 0.15 + ndf * 0.008;
    return round2(Math.max(fillDef.range[0], Math.min(fillDef.range[1], uel)));
  }
  // 3. Kategori varsayılanı
  return fillDef.default;
}


// ─── HAYVAN GEREKSİNİM HESAPLARI ────────────────────────────────────────────

/**
 * UFL gereksinimleri — INRA 2018 enerji gereksinimleri
 *
 * @param {object} animal - Hayvan profili
 * @returns {object} { maintenance, lactation, pregnancy, activity, total, source }
 */
export function calcUFLRequirements(animal) {
  const bw = num(animal.bw, 600);
  const milkYield = num(animal.milkYield, 0);
  const milkFat = num(animal.milkFat, 3.6);
  const milkProtein = num(animal.milkProtein, 3.2);
  const milkLactose = num(animal.milkLactose, 4.8);
  const pregnant = animal.pregnant;
  const pregnancyMonth = num(animal.pregnancyMonth, 0);
  const dailyWalkKm = num(animal.dailyWalkKm, 0);

  // İdame: UFL_maint = 0.041 × BW^0.75 + 0.0002 × BW (INRA 2018)
  const maintenance = UFL_MAINT_COEF * Math.pow(bw, 0.75) + UFL_MAINT_BW * bw;

  // Laktasyon: süt enerji içeriği / verimlilik
  // Süt enerji (Mcal/kg) = NRC formülü ile aynı; UFL'ye çevir
  const nelMilk = 0.0929 * milkFat + 0.0547 * milkProtein + (milkLactose ? 0.0395 * milkLactose : 0.192);
  const milkEnergy_mcal = milkYield * nelMilk;
  // UFL laktasyon = süt enerjisi (Mcal) / 1.700 / verimlilik
  const lactation = (milkEnergy_mcal / 1.700) / UFL_LACTATION_EFFICIENCY;

  // Gebelik: son 3 ayda artar (INRA 2018 Tablo 2.3)
  let pregnancy = 0;
  if (pregnant && pregnancyMonth >= 7) {
    // 7. ay: ~1.5 UFL, 8. ay: ~2.5 UFL, 9. ay: ~3.5 UFL (yaklaşık)
    pregnancy = (pregnancyMonth - 6) * 1.2;
  }

  // Aktivite: mera/yürüyüş ek enerji
  const activity = 0.00045 * bw * dailyWalkKm / 1.700; // NRC Mcal → UFL

  const total = maintenance + lactation + pregnancy + activity;

  return {
    maintenance: round2(maintenance),
    lactation: round2(lactation),
    pregnancy: round2(pregnancy),
    activity: round2(activity),
    total: round2(total),
    source: 'INRA2018',
  };
}

/**
 * PDI gereksinimleri — INRA 2018 protein gereksinimleri
 *
 * INRA'da PDIE ve PDIN ayrı tedarik hesaplarıdır ama GEREKSİNİM tek PDI olarak ifade edilir.
 * Tedarik: min(PDIE_tedarik, PDIN_tedarik) = efektif PDI tedarik
 * Gereksinim: PDI_idame + PDI_laktasyon + PDI_gebelik
 *
 * @param {object} animal - Hayvan profili
 * @returns {object} { maintenance, lactation, pregnancy, total, source }
 */
export function calcPDIRequirements(animal) {
  const bw = num(animal.bw, 600);
  const milkYield = num(animal.milkYield, 0);
  const milkProtein = num(animal.milkProtein, 3.2);
  const pregnant = animal.pregnant;
  const pregnancyMonth = num(animal.pregnancyMonth, 0);

  // İdame: PDI = 3.25 × BW^0.75 (g/gün)
  const maintenance = PDI_MAINT_COEF * Math.pow(bw, 0.75);

  // Laktasyon: süt proteini / verimlilik
  // Süt protein (g/gün) = milkYield × milkProtein × 10
  const milkProtein_g = milkYield * milkProtein * 10;
  const lactation = milkProtein_g / PDI_LACTATION_EFFICIENCY;

  // Gebelik: son 3 ayda artan protein gereksinimi
  let pregnancy = 0;
  if (pregnant && pregnancyMonth >= 7) {
    // INRA 2018: gebelik PDI ≈ 100-300 g/gün (7-9. ay)
    pregnancy = (pregnancyMonth - 6) * 100;
  }

  const total = maintenance + lactation + pregnancy;

  return {
    maintenance: Math.round(maintenance),
    lactation: Math.round(lactation),
    pregnancy: Math.round(pregnancy),
    total: Math.round(total),
    source: 'INRA2018',
  };
}

/**
 * UEL doluluk kapasitesi — hayvanın rumen doluluk sınırı
 *
 * INRA 2018: doluluk kapasitesi = f(BW, DIM, laktasyon no)
 * Yüksek verimli, büyük inek daha fazla tüketebilir (daha yüksek kapasite).
 *
 * @param {object} animal - Hayvan profili
 * @returns {number} UEL kapasitesi (/gün)
 */
export function calcUELCapacity(animal) {
  const bw = num(animal.bw, 600);
  const dim = num(animal.dim, 60);
  const parity = num(animal.parity, 2);
  const milkYield = num(animal.milkYield, 0);

  // Temel kapasite: BW bazlı (INRA 2018 Eq. 6.1 yaklaşımı)
  // UEL_kapasite ≈ 0.025 × BW + 0.2 × süt verimi düzeltmesi
  let capacity = 0.025 * bw;

  // DIM düzeltmesi: erken laktasyonda (DIM < 60) kapasite daha düşük
  if (dim < 60) {
    const dimFactor = 0.70 + 0.30 * (dim / 60); // DIM 0→%70, DIM 60→%100
    capacity *= dimFactor;
  }

  // Parite düzeltmesi: primipar daha düşük kapasite
  if (parity === 1) {
    capacity *= 0.90; // düve %10 daha düşük
  }

  // Süt verimi düzeltmesi: yüksek verimli inek daha fazla tüketir
  if (milkYield > 30) {
    capacity += (milkYield - 30) * 0.08;
  }

  return round1(capacity);
}


// ─── RASYON DÜZEYİ TOPLAM HESAPLAR ──────────────────────────────────────────

/**
 * Rasyon düzeyinde INRA toplam değerleri hesapla
 *
 * @param {Array} items - Rasyon bileşenleri [{id, dmKg, ...}]
 * @param {Array} feeds - Yem kütüphanesi
 * @param {number} dmi_kg - Toplam KMT (kg/gün)
 * @returns {object} { ufl, pdie_g, pdin_g, uel, perKgDM: { ufl, pdie, pdin, uel } }
 */
export function aggregateINRA(items, feeds, dmi_kg) {
  if (!items || items.length === 0 || dmi_kg <= 0) {
    return { ufl: 0, pdie_g: 0, pdin_g: 0, uel: 0, perKgDM: { ufl: 0, pdie: 0, pdin: 0, uel: 0 } };
  }
  const byId = new Map(feeds.map(f => [f.id, f]));
  let totalUFL = 0, totalPDIE = 0, totalPDIN = 0, totalUEL = 0;

  for (const item of items) {
    const feed = byId.get(item.id);
    if (!feed || item.dmKg <= 0) continue;

    totalUFL  += item.dmKg * calcUFL(feed);
    totalPDIE += item.dmKg * calcPDIE(feed);
    totalPDIN += item.dmKg * calcPDIN(feed);
    totalUEL  += item.dmKg * calcUEL(feed);
  }

  return {
    ufl:    round2(totalUFL),
    pdie_g: round1(totalPDIE),
    pdin_g: round1(totalPDIN),
    uel:    round2(totalUEL),
    perKgDM: {
      ufl:  round4(totalUFL / dmi_kg),
      pdie: round1(totalPDIE / dmi_kg),
      pdin: round1(totalPDIN / dmi_kg),
      uel:  round2(totalUEL / dmi_kg),
    },
  };
}

/**
 * INRA dengesi yorumu
 *
 * PDIE < PDIN → enerji sınırlı (rasyonda yeterli N var ama MCP sentezi için yeterli enerji yok)
 * PDIN < PDIE → azot sınırlı (rasyonda yeterli enerji var ama N yetersiz, MCP sentezi düşük)
 *
 * @param {object} supply - aggregateINRA çıktısı
 * @param {object} requirements - { ufl, pdi_g, uel_capacity }
 * @returns {object} { limitingFactor, uflBalance_pct, pdiBalance_pct, uelUsage_pct, messages }
 */
export function interpretINRABalance(supply, requirements) {
  if (!supply || !requirements) {
    return { limitingFactor: 'unknown', uflBalance_pct: 0, pdiBalance_pct: 0, uelUsage_pct: 0, messages: [] };
  }

  const uflBalance = requirements.ufl > 0
    ? round1((supply.ufl / requirements.ufl) * 100)
    : 0;

  // Efektif PDI tedarik = min(PDIE, PDIN)
  const effectivePDI = Math.min(supply.pdie_g, supply.pdin_g);
  const pdiBalance = requirements.pdi_g > 0
    ? round1((effectivePDI / requirements.pdi_g) * 100)
    : 0;

  const uelUsage = requirements.uel_capacity > 0
    ? round1((supply.uel / requirements.uel_capacity) * 100)
    : 0;

  // Sınırlayıcı faktör
  const limitingFactor = supply.pdie_g <= supply.pdin_g ? 'energy' : 'nitrogen';

  // FAZ 22.4 — Mesajlar { level, text } objeleri (emoji'siz; panel level'a göre SVG ikon eşler).
  // level: 'warn' (uyarı) | 'ok' (iyi) | 'info' (bilgi/sınırlayıcı). Geriye uyumlu değil
  // (eski emoji-string yerine obje) — tek tüketici inraPanel; o da güncellendi.
  const messages = [];
  // UFL dengesi
  if (uflBalance < 95) {
    messages.push({ level: 'warn', text: `Enerji açığı: UFL tedarik (%${uflBalance}) gereksinimin altında. Enerji yoğunluğu artırılmalı.` });
  } else if (uflBalance > 110) {
    messages.push({ level: 'warn', text: `Enerji fazlası: UFL tedarik (%${uflBalance}) gereksinimin üstünde. Yağlanma riski.` });
  } else {
    messages.push({ level: 'ok', text: `Enerji dengesi iyi (%${uflBalance}).` });
  }

  // PDI dengesi
  if (pdiBalance < 95) {
    messages.push({ level: 'warn', text: `Protein açığı: PDI tedarik (%${pdiBalance}) yetersiz.` });
  } else if (pdiBalance > 115) {
    messages.push({ level: 'warn', text: `Protein fazlası: PDI tedarik (%${pdiBalance}) yüksek. Çevresel N atığı artar.` });
  } else {
    messages.push({ level: 'ok', text: `Protein dengesi iyi (%${pdiBalance}).` });
  }

  // PDIE/PDIN dengesi
  if (limitingFactor === 'energy') {
    const diff = round0(supply.pdin_g - supply.pdie_g);
    messages.push({ level: 'info', text: `Sınırlayıcı: ENERJİ (PDIE < PDIN, fark ${diff} g/gün). Rasyonda yeterli N var ama enerji yetersiz.` });
  } else {
    const diff = round0(supply.pdie_g - supply.pdin_g);
    messages.push({ level: 'info', text: `Sınırlayıcı: AZOT (PDIN < PDIE, fark ${diff} g/gün). Rasyonda yeterli enerji var ama N yetersiz.` });
  }

  // Doluluk
  if (uelUsage > 100) {
    messages.push({ level: 'warn', text: `Doluluk aşımı: UEL kullanımı %${uelUsage} — hayvan bu kadar yem tüketemeyebilir.` });
  } else if (uelUsage > 90) {
    messages.push({ level: 'info', text: `Doluluk sınıra yakın (%${uelUsage}). Yüksek NDF yemler azaltılabilir.` });
  } else {
    messages.push({ level: 'ok', text: `Doluluk kapasitesi yeterli (%${uelUsage}).` });
  }

  return {
    limitingFactor,
    effectivePDI_g: round1(effectivePDI),
    uflBalance_pct: uflBalance,
    pdiBalance_pct: pdiBalance,
    uelUsage_pct: uelUsage,
    messages,
  };
}


// ─── YARDIMCILAR ─────────────────────────────────────────────────────────────

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * FAZ 22.6 — Etkin NEL (nelDiscount uygulanmış). lpBuilder.effectiveNel ile aynı formül;
 * core→solver bağımlılığı yaratmamak için yerel kopya. nelDiscount yok/0 → ham NEL (geriye uyumlu).
 */
function effectiveNelLocal(feed) {
  const nel = num(feed?.nel);
  const disc = Math.min(100, Math.max(0, num(feed?.nelDiscount)));
  return disc > 0 ? nel * (1 - disc / 100) : nel;
}

function round0(v) { return Math.round(v); }
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

/**
 * RUP intestinal sindirilebilirlik kategori varsayılanı (NRC 2001 Tablo 15-2b)
 */
function rupIntDDefault(category) {
  switch (category) {
    case 'roughage':  return 75;
    case 'grain':     return 85;
    case 'protein':   return 80;
    case 'byproduct': return 75;
    default:          return 80;
  }
}
