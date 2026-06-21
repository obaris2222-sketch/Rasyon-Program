/**
 * Makromineraller ve İz Mineraller Gereksinimleri
 * Kaynak: NRC 2001 Bölüm 6 + NASEM 2021 Bölüm 7 (Mineraller)
 *
 * FAZ 13.7: Mg/P/Ca emilim & idame katsayıları bilimsel sisteme göre ayrıldı.
 * Önceden modül "NRC 2001" etiketliydi ama Mg için NASEM değeri (0.003) ve
 * P için hatalı BW-bazlı lojik kullanıyordu. Artık `system` parametresiyle
 * doğru kaynak seçilir (default NASEM 2021, pipeline ile tutarlı).
 */

// ─── BİLİMSEL SİSTEM KATSAYILARI (FAZ 13.7) ─────────────────────────────────
//
// Ca emilim (absorbed→dietary): laktasyon primipar / multipar / kuru dönem.
//   NRC 2001 ve NASEM 2021 absorbed-basis için aynı standart katsayıları kullanır
//   (forajlardan ortalama gerçek emilim); fark yem-spesifik modellemededir.
// P idame: fekal endojen kayıp, DMI-bazlı (g P / kg KM) — NRC 2001 & NASEM 2021.
// Mg idame: NRC 2001 = 0.0048 g/kg BW; NASEM 2021 = 0.003 g/kg BW (belirgin fark).
export const MINERAL_COEF_NRC2001 = {
  ca: { absPrimi: 0.45, absMulti: 0.38, absDry: 0.32 },
  p:  { maintPerKgDMI: 1.0 },
  mg: { maintPerKgBW: 0.0048 },
};

export const MINERAL_COEF_NASEM2021 = {
  ca: { absPrimi: 0.45, absMulti: 0.38, absDry: 0.32 },
  p:  { maintPerKgDMI: 1.0 },
  mg: { maintPerKgBW: 0.003 },
};

/** system anahtarına göre katsayı objesini döndürür (default NASEM 2021). */
export function mineralCoef(system = 'NASEM2021') {
  return system === 'NRC2001' ? MINERAL_COEF_NRC2001 : MINERAL_COEF_NASEM2021;
}

// ─── MAKROMİNERALLER ────────────────────────────────────────────────────────

/**
 * Kalsiyum (Ca) Gereksinimi
 * NRC 2001 Tablo 6-1
 * maintenance: endogenous fecal Ca (absorbed basis) = 0.031 × BW^0.75 g/d
 * lactation: süt Ca içeriği = milkYield × milkCa g/d (absorbed basis)
 * Diyet gereksinimi = absorbed / emilim etkinliği
 *   FAZ 13.7: emilim laktasyon primipar = 0.45 (eski hatalı 0.50), multipar = 0.38,
 *   kuru dönem = 0.32 (artık uygulanıyor). Katsayılar MINERAL_COEF_*.ca'dan gelir.
 * @param {number} bw         - Canlı ağırlık (kg)
 * @param {number} milkYield  - Süt verimi (kg/gün)
 * @param {number} milkCa     - Süt Ca konsantrasyonu (g/kg, varsayılan 1.22)
 * @param {boolean} pregnant
 * @param {number} gestDays
 * @param {number} parity     - Laktasyon numarası (emilim etkinliği için)
 * @param {object} [options]
 *   @param {string}  [options.system='NASEM2021'] - bilim sistemi
 *   @param {boolean} [options.isDry=false]         - kuru dönem (far_off/close_up)
 * @returns {object} { maintenance, lactation, pregnancy, total, dietary } (g/gün absorbed + dietary)
 */
export function calcCalcium(bw, milkYield, milkCa = 1.22, pregnant = false, gestDays = 0, parity = 2, options = {}) {
  const { system = 'NASEM2021', isDry = false } = options;
  const coef = mineralCoef(system).ca;

  // Absorbed basis
  const maintenance = 0.031 * Math.pow(bw, 0.75);
  const lactation = milkYield * milkCa;
  const preg = pregnant && gestDays > 190
    ? Math.max((0.02154 * gestDays - 2.9) * 45 / 1000, 0)
    : 0;

  const totalAbsorbed = maintenance + lactation + preg;

  // Diyet Ca gereksinimi (absorbed / absorption efficiency)
  // FAZ 13.7: kuru dönem 0.32, primipar 0.45, multipar 0.38
  const absorption = isDry ? coef.absDry : (parity === 1 ? coef.absPrimi : coef.absMulti);
  const dietary = totalAbsorbed / absorption;

  return {
    maintenance: Math.round(maintenance * 100) / 100,
    lactation: Math.round(lactation * 100) / 100,
    pregnancy: Math.round(preg * 100) / 100,
    totalAbsorbed: Math.round(totalAbsorbed * 100) / 100,
    dietary: Math.round(dietary * 10) / 10,  // g/gün diyet Ca
    absorption,
  };
}

/**
 * Fosfor (P) Gereksinimi
 * NRC 2001 Tablo 6-1 / NASEM 2021
 *
 * FAZ 13.7: İdame artık DMI-bazlı (fekal endojen P kaybı = 1.0 g/kg KM).
 * Eski kod `1.0 × BW/100` (yanlış BW-bazlı lojik) kullanıyordu ve idameyi
 * ~4× düşük tahmin ediyordu. NRC 2001 doğru formülü: 1.0 g P / kg KM tüketimi.
 *
 * @param {number} dmi        - Kuru madde tüketimi (kg/gün)
 * @param {number} milkYield  - Süt verimi (kg/gün)
 * @param {number} milkP      - Süt P konsantrasyonu (g/kg, varsayılan 0.90)
 * @param {string} [system='NASEM2021'] - bilim sistemi
 * @returns {object} { maintenance, lactation, total } (g/gün)
 */
export function calcPhosphorus(dmi, milkYield, milkP = 0.90, system = 'NASEM2021') {
  const coef = mineralCoef(system).p;
  const maintenance = coef.maintPerKgDMI * dmi;   // g/kg KM × kg KM = g/gün
  const lactation = milkYield * milkP;
  const total = maintenance + lactation;
  return {
    maintenance: Math.round(maintenance * 10) / 10,
    lactation: Math.round(lactation * 10) / 10,
    total: Math.round(total * 10) / 10,
  };
}

/**
 * Magnezyum (Mg) Gereksinimi — FAZ 10E: ısı stresi düzeltmesi
 * İdame: NRC 2001 = 0.0048 g/kg BW; NASEM 2021 = 0.003 g/kg BW (FAZ 13.7).
 * NASEM 2021 + Schneider (2008): ısı stresinde Mg ihtiyacı %20 artar (anti-NMDA)
 *
 * @param {number} bw         - Canlı ağırlık (kg)
 * @param {number} milkYield  - Süt verimi (kg/gün)
 * @param {number} milkMg     - Süt Mg konsantrasyonu (g/kg, varsayılan 0.12)
 * @param {number} [thi]      - THI değeri (opsiyonel)
 * @param {string} [system='NASEM2021'] - bilim sistemi (idame katsayısı seçimi)
 * @returns {object} { maintenance, lactation, heatBonus, total, heatAdjusted }
 */
export function calcMagnesium(bw, milkYield, milkMg = 0.12, thi = null, system = 'NASEM2021') {
  const maintenance = mineralCoef(system).mg.maintPerKgBW * bw;
  const lactation = milkYield * milkMg;
  let heatBonus = 0;
  let heatAdjusted = false;
  if (Number.isFinite(thi) && thi > 72) {
    // Toplam Mg %20 artırma (THI>78 için %30)
    heatBonus = (maintenance + lactation) * (thi > 78 ? 0.30 : 0.20);
    heatAdjusted = true;
  }
  const total = maintenance + lactation + heatBonus;
  return {
    maintenance: Math.round(maintenance * 10) / 10,
    lactation: Math.round(lactation * 10) / 10,
    heatBonus: Math.round(heatBonus * 10) / 10,
    total: Math.round(total * 10) / 10,
    heatAdjusted,
  };
}

/**
 * Potasyum (K) Gereksinimi — FAZ 10E: ısı stresinde dinamik
 * NRC 2001 Tablo 14-6: laktasyondaki süt ineği için min %1.0 KM (normal)
 * NASEM 2021 + West (2003): ısı stresinde tükürük K kaybı nedeniyle artır
 *   - THI 72-78: %1.2 KM (orta artırım)
 *   - THI > 78: %1.5 KM (ciddi — hipopotasemi koruması)
 *
 * @param {number} dmi        - Kuru madde tüketimi (kg/gün)
 * @param {number} milkYield  - Süt verimi (kg/gün)
 * @param {number} milkK      - Süt K konsantrasyonu (g/kg, varsayılan 1.43)
 * @param {number} [thi]      - THI değeri (opsiyonel, ısı stresi düzeltmesi)
 * @returns {object} { minPctDM, lactation, total, heatAdjusted } (g/gün)
 */
export function calcPotassium(dmi, milkYield, milkK = 1.43, thi = null) {
  // Isı stresi düzeltmesi
  let minPctDM = 1.0;
  let heatAdjusted = false;
  if (Number.isFinite(thi) && thi > 72) {
    minPctDM = thi > 78 ? 1.5 : 1.2;
    heatAdjusted = true;
  }
  const lactation = milkYield * milkK;   // bilgi amaçlı (süt ile çıkış)
  const total = dmi * 10 * minPctDM;     // %X.X × DMI × 10 = g/gün
  return {
    minPctDM,
    lactation: Math.round(lactation * 10) / 10,
    total: Math.round(total * 10) / 10,
    heatAdjusted,
  };
}

/**
 * Sodyum (Na) Gereksinimi — FAZ 10E: ısı stresi terleme düzeltmesi
 * NRC 2001: 1.2 g/100 kg BW idame + 0.63 g/kg süt (normal)
 * NASEM 2021 + West (2003): ısı stresinde Na kaybı %30 artar (terleme)
 *
 * @param {number} bw         - Canlı ağırlık (kg)
 * @param {number} milkYield  - Süt verimi (kg/gün)
 * @param {number} [thi]      - THI değeri (opsiyonel)
 * @returns {object} { maintenance, lactation, sweatLoss, total, heatAdjusted }
 */
export function calcSodium(bw, milkYield, thi = null) {
  const maintenance = 1.2 * bw / 100;
  const lactation = milkYield * 0.63;
  let sweatLoss = 0;
  let heatAdjusted = false;
  if (Number.isFinite(thi) && thi > 72) {
    // Terleme kaybı: maintenance × %30 (THI 72-78) veya %50 (THI>78)
    sweatLoss = maintenance * (thi > 78 ? 0.50 : 0.30);
    heatAdjusted = true;
  }
  const total = maintenance + lactation + sweatLoss;
  return {
    maintenance: Math.round(maintenance * 10) / 10,
    lactation: Math.round(lactation * 10) / 10,
    sweatLoss: Math.round(sweatLoss * 10) / 10,
    total: Math.round(total * 10) / 10,
    heatAdjusted,
  };
}

/**
 * Kükürt (S) Gereksinimi
 * NRC 2001: minimum %0.20 KM
 * @param {number} dmi - Kuru madde tüketimi (kg/gün)
 * @returns {object} { minPctDM, minG }
 */
export function calcSulfur(dmi) {
  return {
    minPctDM: 0.20,
    maxPctDM: 0.40,
    minG: dmi * 2.0,         // g/gün: 0.20% × dmi (kg) × 1000/100
    maxG: dmi * 4.0,
  };
}

/**
 * Klor (Cl) Gereksinimi
 * NRC 2001: %0.25 KM minimum
 * @param {number} dmi - Kuru madde tüketimi (kg/gün)
 * @returns {object} { minPctDM, minG }
 */
export function calcChlorine(dmi) {
  return {
    minPctDM: 0.25,
    minG: dmi * 2.5,
  };
}

// ─── İZ MİNERALLER ─────────────────────────────────────────────────────────

/**
 * İz Mineral Gereksinimleri (NRC 2001 Tablo 6-2)
 * @param {number} dmi - Kuru madde tüketimi (kg/gün)
 * @returns {object} mg/gün bazında gereksinimler ve sınırlar
 */
export function calcTraceMinerals(dmi) {
  return {
    zn: {
      minMgKgDM: 40,
      maxMgKgDM: 500,
      minMgDay: dmi * 40,
      maxMgDay: dmi * 500,
      function: 'İmmünite, tırnak sağlığı, fertilite',
    },
    cu: {
      minMgKgDM: 10,
      maxMgKgDM: 40,
      minMgDay: dmi * 10,
      maxMgDay: dmi * 40,
      function: 'Oksidatif savunma, pigmentasyon',
    },
    mn: {
      minMgKgDM: 20,
      maxMgKgDM: 1000,
      minMgDay: dmi * 20,
      maxMgDay: dmi * 1000,
      function: 'Reproduktif enzimler',
    },
    se: {
      minMgKgDM: 0.30,
      maxMgKgDM: 2.0,
      minMgDay: dmi * 0.30,
      maxMgDay: dmi * 2.0,
      function: 'E vitamini sinerjisi, miyopati önleme',
    },
    i: {
      minMgKgDM: 0.40,
      maxMgKgDM: 50,
      minMgDay: dmi * 0.40,
      maxMgDay: dmi * 50,
      function: 'Tiroid işlevi',
    },
    co: {
      minMgKgDM: 0.11,
      maxMgKgDM: 25,
      minMgDay: dmi * 0.11,
      maxMgDay: dmi * 25,
      function: 'B12 sentezi',
    },
    fe: {
      minMgKgDM: 50,
      maxMgKgDM: 500,
      minMgDay: dmi * 50,
      maxMgDay: dmi * 500,
      function: 'Hemoglobin',
    },
  };
}

// ─── DCAD ────────────────────────────────────────────────────────────────────

/**
 * DCAD Hesabı (Diyet Katyon-Anyon Dengesi) — birim: mEq/100g KM
 * NRC 2001 formülü
 *
 * Birim türetmesi (FAZ 13.13): girdiler % KM (= g/100g KM). (Na%÷23) = mol/100g;
 * × 1000 → mEq/100g KM (monovalent). Sonuç mEq/100g KM'dir (mEq/kg DEĞİL).
 * @param {number} na_pct - Sodyum (% KM)
 * @param {number} k_pct  - Potasyum (% KM)
 * @param {number} cl_pct - Klor (% KM)
 * @param {number} s_pct  - Kükürt (% KM)
 * @returns {object} { dcad, interpretation, urinePH_target } — dcad mEq/100g KM
 */
export function calcDCAD(na_pct, k_pct, cl_pct, s_pct) {
  // DCAD (mEq/100g KM) = [(Na/23 + K/39) - (Cl/35.5 + S/16)] × 1000
  const cations = (na_pct / 23) + (k_pct / 39);
  const anions = (cl_pct / 35.5) + (s_pct / 16);
  const dcad = (cations - anions) * 1000;

  let interpretation;
  let urinePH_target = null;

  if (dcad >= 25 && dcad <= 40) {
    interpretation = 'lactation_optimal';
  } else if (dcad >= -15 && dcad <= -5) {
    interpretation = 'transition_optimal';
    urinePH_target = '6.2-6.8';
  } else if (dcad >= 15 && dcad <= 25) {
    interpretation = 'dry_optimal';
  } else if (dcad > 40) {
    interpretation = 'too_high';
  } else if (dcad < -15) {
    interpretation = 'too_low_risk';
  } else {
    interpretation = 'suboptimal';
  }

  return {
    dcad: Math.round(dcad * 10) / 10,
    interpretation,
    urinePH_target,
  };
}

// ─── TOPLAM MİNERAL GEREKSİNİMLERİ ─────────────────────────────────────────

/**
 * Tüm makromineralleri tek seferde hesapla
 * @param {object} animal - Hayvan profili
 * @param {number} dmi    - Hesaplanan KMT (kg/gün)
 * @param {string} [system='NASEM2021'] - bilim sistemi (FAZ 13.7: Mg/P/Ca katsayı seçimi)
 * @returns {object} Tüm mineral gereksinimleri
 */
export function calcMineralRequirements(animal, dmi, system = 'NASEM2021') {
  const { bw, milkYield, pregnant, gestDays, pregnancyMonth, thi } = animal;

  // Gebelik günü: UI'da ay olarak girilir, gestDays yoksa aydan türet
  const effectiveGestDays = Number.isFinite(gestDays)
    ? gestDays
    : (Number.isFinite(pregnancyMonth) ? pregnancyMonth * 30 : 0);

  // FAZ 13.7: kuru dönem (far_off/close_up) → Ca emilimi 0.32 kullanılır
  const isDry = animal.lactationStage === 'far_off' || animal.lactationStage === 'close_up';

  // FAZ 10E: thi parametresi K/Na/Mg fonksiyonlarına aktarılır (ısı stresi düzeltmesi)
  return {
    ca: calcCalcium(bw, milkYield, 1.22, pregnant, effectiveGestDays, animal.parity || 2, { system, isDry }),
    p: calcPhosphorus(dmi, milkYield, 0.90, system),      // FAZ 13.7: DMI-bazlı idame
    mg: calcMagnesium(bw, milkYield, 0.12, thi, system),  // ısı düzeltmesi + system
    k: calcPotassium(dmi, milkYield, 1.43, thi),          // ısı düzeltmesi
    na: calcSodium(bw, milkYield, thi),                   // ısı düzeltmesi
    s: calcSulfur(dmi),
    cl: calcChlorine(dmi),
    trace: calcTraceMinerals(dmi),
  };
}
