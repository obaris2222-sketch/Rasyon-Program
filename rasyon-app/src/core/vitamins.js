/**
 * Vitamin Gereksinimleri
 * Kaynaklar:
 *   NRC 2001 Bölüm 7 (orijinal)
 *   NASEM 2021 Bölüm 8 (geçiş dönemi için artırılmış öneriler)
 *   FAZ 10C: NASEM 2021 katsayıları kullanılıyor (önceki NRC 2001 yerine)
 */

/**
 * A Vitamini Gereksinimi
 * NASEM 2021 Bölüm 8: laktasyon 110, geçiş 150, kuru 80 IU/kg BW
 * (NRC 2001 sabit 75 IU/kg idi — geçiş için yetersiz bulundu)
 * @param {number} bw     - Canlı ağırlık (kg)
 * @param {string} period - 'lactation' | 'transition' | 'dry'
 * @returns {object} { minIU, maxIU, recommendedIU }
 */
export function vitaminA(bw, period = 'lactation') {
  // NASEM 2021 güncellenmiş katsayıları
  const rates = {
    lactation:  { min: 90,  max: 150, recommended: 110 },
    transition: { min: 130, max: 180, recommended: 150 },  // Geçiş için artırıldı
    dry:        { min: 70,  max: 110, recommended: 80 },
  };
  const rate = rates[period] || rates.lactation;
  return {
    minIU: Math.round(bw * rate.min),
    maxIU: Math.round(bw * rate.max),
    recommendedIU: Math.round(bw * rate.recommended),
    unit: 'IU/gün',
    source: 'NASEM 2021',
    note: period === 'transition' ? 'Geçiş döneminde fertilite & immün desteği' : null,
  };
}

/**
 * D Vitamini Gereksinimi
 * NASEM 2021: laktasyon 30 IU/kg BW, geçiş 50 IU/kg, kuru 35 IU/kg
 * (NRC 2001'de baz 1000 IU/100kg = 10 IU/kg idi — günümüz pratiği daha yüksek)
 * @param {number} bw     - Canlı ağırlık (kg)
 * @param {string} period - 'lactation' | 'transition' | 'dry'
 * @returns {object} { minIU, recommendedIU }
 */
export function vitaminD(bw, period = 'lactation') {
  const rates = {
    lactation:  { min: 22, recommended: 30 },
    transition: { min: 40, recommended: 50 },  // Hipokalsemi önleme — Goff 2014
    dry:        { min: 25, recommended: 35 },
  };
  const rate = rates[period] || rates.lactation;
  return {
    minIU: Math.round(bw * rate.min),
    recommendedIU: Math.round(bw * rate.recommended),
    unit: 'IU/gün',
    source: 'NASEM 2021',
    note: period === 'transition' ? 'Hipokalsemi önleme için artırılmış doz (Goff 2014)' : null,
  };
}

/**
 * E Vitamini Gereksinimi
 * NASEM 2021: laktasyon 0.8 IU/kg BW, geçiş 2.0 IU/kg (önceden 1.6), kuru 1.6 IU/kg
 * Mastitis önleme ve retained placenta için Weiss (1998) çalışması bazlı
 * @param {number} bw     - Canlı ağırlık (kg)
 * @param {string} period - 'lactation' | 'transition' | 'dry'
 * @returns {object} { minIU, recommendedIU }
 */
export function vitaminE(bw, period = 'lactation') {
  const rates = {
    lactation:  { min: 0.6, recommended: 0.8 },
    transition: { min: 1.6, recommended: 2.0 },  // NASEM 2021 — Weiss 1998
    dry:        { min: 1.0, recommended: 1.6 },
  };
  const rate = rates[period] || rates.lactation;
  return {
    minIU: Math.round(bw * rate.min),
    recommendedIU: Math.round(bw * rate.recommended),
    unit: 'IU/gün',
    source: 'NASEM 2021',
    note: period === 'transition' ? 'İmmün + mastitis + retained placenta önleme (Weiss 1998)' : null,
  };
}

/**
 * β-Karoten Gereksinimi (NASEM 2021 — ayrı parametre olarak öne çıkarıldı)
 * Vitamin A öncüsü ama bağımsız fertilite etkisi var (kistik over önleme)
 * Sığır için tipik: 300-700 mg/gün; geçişte 400+ mg/gün
 *
 * @param {string} period - 'lactation' | 'transition' | 'dry'
 * @returns {object} { recommendedMg, note }
 */
export function bcarotene(period = 'lactation') {
  const rates = {
    lactation:  300,
    transition: 500,   // Fertilite ve kolostrum kalitesi için kritik
    dry:        300,
  };
  return {
    recommendedMg: rates[period] || 300,
    unit: 'mg/gün',
    source: 'NASEM 2021 + Calderon 2007',
    note: period === 'transition' ? 'Kistik over önleme, kolostrum kalitesi, kolostrum vit A' : 'Fertilite desteği',
  };
}

/**
 * β-Karoten → Vitamin A eşdeğeri dönüşümü
 * Sığır için biyolojik dönüşüm verimliliği düşüktür (Schweigert 2003):
 *   - 1 mg β-karoten ≈ 200 IU Vit A (etkin, sığır rumen partial degradasyon nedeniyle)
 *   - Tavşan vs sığır: 1 mg = 1600 IU vs 200 IU
 *
 * @param {number} bcarotene_mg - β-karoten miktarı (mg/gün)
 * @returns {number} Eşdeğer Vit A (IU/gün)
 */
export function bcaroteneToVitA(bcarotene_mg) {
  return Math.round((bcarotene_mg || 0) * 200);
}

/**
 * Biyotin (B7) Gereksinimi
 * Ek araştırma bazlı: 20 mg/gün tırnak sağlığı için
 * @returns {object} { recommendedMg }
 */
export function biotin() {
  return {
    recommendedMg: 20,
    unit: 'mg/gün',
    indication: 'Tırnak sağlığı, beyaz çizgi hastalığı önleme',
  };
}

/**
 * Niyasin (B3) Gereksinimi — FAZ 10F: dereceli doz
 * Önceden binary (6 vs 12 g) idi; şimdi verim + DIM bazlı dereceli (6-18 g)
 *
 * Bilimsel temel:
 *   - Bazal: 6 g/gün (Erickson et al. 1992)
 *   - Yüksek verim: +0.3 g per kg üzeri 25 MY (NRC 2001)
 *   - Erken laktasyon (DIM<30): +4 g (ketozis önleme, French 2012)
 *   - Isı stresi (THI>78): +3 g (rumen tampon, Zimbelman 2009)
 *
 * @param {number} milkYield  - Süt verimi (kg/gün)
 * @param {number} dim        - Laktasyondaki gün
 * @param {number} [thi]      - THI değeri (opsiyonel, ısı stresi düzeltmesi)
 * @returns {object} { recommendedG, components, indication }
 */
export function niacin(milkYield, dim, thi = null) {
  const my = Number(milkYield) || 0;
  const d  = Number(dim) || 100;

  let total = 6;  // Bazal
  const components = { base: 6 };

  const yieldBonus = Math.max(0, (my - 25) * 0.3);
  if (yieldBonus > 0) { total += yieldBonus; components.yield = round1(yieldBonus); }

  const earlyBonus = d < 30 ? 4 : 0;
  if (earlyBonus > 0) { total += earlyBonus; components.early = earlyBonus; }

  const heatBonus = (Number.isFinite(thi) && thi > 78) ? 3 : 0;
  if (heatBonus > 0) { total += heatBonus; components.heat = heatBonus; }

  // Üst sınır: 18 g/gün (toksisite ve maliyet)
  total = Math.min(18, total);

  return {
    recommendedG: round1(total),
    components,
    unit: 'g/gün',
    indication: 'Ketozis önleme, enerji dengesi, ısı stresi tampon',
    highRisk: my > 40 || d < 30,
    source: 'NRC 2001 + Erickson 1992 + French 2012 + Zimbelman 2009',
  };
}

/**
 * Kolin Gereksinimi — FAZ 10F: iyon-bazlı (NASEM 2021)
 *
 * Önceden "30 g/gün koruyucu form" (ürün-bağımlı) idi.
 * NASEM 2021 standardı: 12.9 g KOLİN İYON/gün geçiş döneminde
 * Tipik ticari ürün %25 kolin → 12.9 / 0.25 = 51.6 g/gün ürün dozajı
 *
 * Bilimsel temel:
 *   - Pinotti et al. (2003): geçiş dönemi karaciğer lipotropik etki
 *   - Zenobi et al. (2018): süt protein verimi artışı
 *   - NASEM 2021: ≥21 gün önce-doğum 12.9 g iyon
 *
 * @param {string} period - 'lactation' | 'transition' | 'close_up' | 'dry'
 * @returns {object} { recommendedIonG, recommendedProductG_25pct, note }
 */
export function choline(period = 'lactation') {
  // close_up = transition için backward compat
  const isTransition = period === 'transition' || period === 'close_up';
  if (isTransition) {
    const ionG = 12.9;
    return {
      recommendedIonG: ionG,
      recommendedProductG_25pct: Math.round(ionG / 0.25),  // %25'lik RPC üründe gerekli miktar
      maxIonG: 18,
      unit: 'g kolin iyon/gün',
      note: 'NASEM 2021: 12.9 g iyon = ~52 g %25-RPC ürün. Karaciğer yağlanması & süt prot artışı.',
      source: 'NASEM 2021 + Zenobi 2018',
    };
  }
  return {
    recommendedIonG: null,
    recommendedProductG_25pct: null,
    unit: 'g kolin iyon/gün',
    note: 'Geçiş dönemi dışında rutin öneri yok (rumen sentezi yeterli)',
  };
}

// ─── B GRUBU VİTAMİNLER (FAZ 13.14) ─────────────────────────────────────────
//
// ÖNEMLİ (bilimsel dürüstlük): Ruminantlarda B grubu vitaminler RUMEN MİKROBİYAL
// SENTEZİ ile üretilir; NRC 2001 bu vitaminler için kesin diyet gereksinimi
// BELİRLEMEZ (rumen sentezi normalde yeterli kabul edilir). Aşağıdaki fonksiyonlar
// "kesin gereksinim" değil, araştırma-bazlı KOŞULLU TAKVİYE önerileri sunar
// (geçiş dönemi, yüksek verim, eser element eksikliği gibi rumen sentezinin
// yetersiz kalabileceği durumlar). routine=false → rutin katkı gerekmez.

/**
 * B12 (Kobalamin) — koşullu takviye önerisi
 * Rumen mikropları kobalt (Co)'dan B12 sentezler; Co ≥ 0.11 mg/kg KM ise yeterli.
 * Geçiş + yüksek verimde rumen-korumalı folik asit + B12 kombinasyonu süt protein
 * verimini artırır (Girard & Matte 2005).
 * @param {string} period - 'lactation' | 'transition' | 'close_up' | 'dry'
 * @param {number} [milkYield] - Süt verimi (kg/gün)
 * @returns {object} { recommendedMg, routine, unit, note, source }
 */
export function b12Requirement(period = 'lactation', milkYield = 0) {
  const isTransition = period === 'transition' || period === 'close_up';
  const highYield = (Number(milkYield) || 0) >= 40;
  if (isTransition || highYield) {
    return {
      recommendedMg: 0.5,   // RP-B12 takviye önerisi (folik ile kombine)
      routine: false,
      unit: 'mg/gün',
      note: isTransition
        ? 'Geçiş dönemi: RP-folik + B12 kombinasyonu süt protein verimini artırır (Girard & Matte 2005)'
        : 'Yüksek verim: rumen sentezi sınırda kalabilir — RP-B12+folik kombinasyonu değerlendirin',
      source: 'Girard & Matte 2005; NASEM 2021',
    };
  }
  return {
    recommendedMg: null,
    routine: false,
    unit: 'mg/gün',
    note: 'Rumen mikrobiyal sentezi yeterli (Co ≥ 0.11 mg/kg KM koşuluyla) — rutin takviye gereksiz',
    source: 'NRC 2001 (kesin gereksinim belirlemez)',
  };
}

/**
 * B6 (Piridoksin) — rumen sentezi yeterli
 * Rumen mikrobiyal sentezi tüm fizyolojik dönemlerde yeterli; takviye araştırması
 * tutarlı fayda göstermemiştir.
 * @returns {object} { recommendedMg, routine, unit, note, source }
 */
export function b6Requirement() {
  return {
    recommendedMg: null,
    routine: false,
    unit: 'mg/gün',
    note: 'Rumen mikrobiyal sentezi yeterli — rutin takviye gereksiz (NRC 2001 gereksinim belirlemez)',
    source: 'NRC 2001',
  };
}

/**
 * Riboflavin (B2) — rumen sentezi yeterli
 * @returns {object} { recommendedMg, routine, unit, note, source }
 */
export function riboflavinRequirement() {
  return {
    recommendedMg: null,
    routine: false,
    unit: 'mg/gün',
    note: 'Rumen mikrobiyal sentezi yeterli — rutin takviye gereksiz (NRC 2001 gereksinim belirlemez)',
    source: 'NRC 2001',
  };
}

/**
 * Folik asit (B9) — koşullu takviye önerisi
 * Rumen-korumalı folik asit (RP-folik) geçiş ve erken laktasyonda süt + süt protein
 * verimini artırır (Girard & Matte 1998, 2005). Rumen sentezi normal koşulda yeterli
 * ama yüksek metabolik talep döneminde sınırlayıcı olabilir.
 * @param {string} period - 'lactation' | 'transition' | 'close_up' | 'dry'
 * @param {number} [dim]   - Laktasyondaki gün (erken laktasyon önceliği)
 * @returns {object} { recommendedMg, routine, unit, note, source }
 */
export function folicAcidRequirement(period = 'lactation', dim = 100) {
  const isTransition = period === 'transition' || period === 'close_up';
  const isEarlyLactation = period === 'lactation' && (Number(dim) || 100) < 60;
  if (isTransition || isEarlyLactation) {
    return {
      recommendedMg: 50,   // ~%80 korumalı ürün dozu (RP-folik), Girard & Matte
      routine: false,
      unit: 'mg/gün (RP-folik ürün)',
      note: isTransition
        ? 'Geçiş dönemi: RP-folik (B12 ile) süt protein verimi + metabolik destek (Girard & Matte 2005)'
        : 'Erken laktasyon (DIM<60): yüksek metabolik talep — RP-folik değerlendirin',
      source: 'Girard & Matte 1998, 2005',
    };
  }
  return {
    recommendedMg: null,
    routine: false,
    unit: 'mg/gün',
    note: 'Rumen mikrobiyal sentezi yeterli — rutin takviye gereksiz (NRC 2001 gereksinim belirlemez)',
    source: 'NRC 2001',
  };
}

function round1(v) { return Math.round(v * 10) / 10; }

/**
 * Tüm vitamin gereksinimleri
 * @param {object} animal - Hayvan profili
 * @param {string} period - 'lactation' | 'transition' | 'dry'
 * @returns {object} Tüm vitamin gereksinimleri
 */
export function calcVitaminRequirements(animal, period = 'lactation') {
  const { bw, milkYield, dim, thi } = animal;
  return {
    vitA: vitaminA(bw, period),
    vitD: vitaminD(bw, period),
    vitE: vitaminE(bw, period),
    bcarotene: bcarotene(period),                       // FAZ 10C
    biotin: biotin(),
    niacin: niacin(milkYield, dim, thi),                // FAZ 10F: thi ile dereceli
    choline: choline(period),
    // FAZ 13.14: B grubu (rumen sentezi normalde yeterli — koşullu takviye)
    b12: b12Requirement(period, milkYield),
    b6: b6Requirement(),
    riboflavin: riboflavinRequirement(),
    folicAcid: folicAcidRequirement(period, dim),
  };
}
