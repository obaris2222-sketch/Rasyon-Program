/**
 * NRC 2001 Referans Hayvan Test Senaryoları
 * Kaynak: NRC 2001 Nutrient Requirements of Dairy Cattle, 7th Ed., Appendix
 * Tüm denklem testleri bu değerlerle ±%2 tolerans içinde eşleşmeli
 */

export const NRC2001_REFERENCE_ANIMALS = [
  {
    id: 'nrc_ref_1',
    description: 'NRC 2001 - Holstein, 3. laktasyon, yüksek verimli',
    input: {
      breed: 'Holstein',
      parity: 3,
      dim: 60,
      bw: 600,
      bcs: 3.0,
      milkYield: 40,
      milkFat: 3.6,
      milkProtein: 3.2,
      milkLactose: 4.8,
      pregnant: false,
      gestDays: 0,
      activityLevel: 'low',
      housingType: 'freestall',
      dailyWalkKm: 0,
      thi: 55,
    },
    expected: {
      fcm4pct: 37.60,         // 4% yağ düzeltmeli süt (kg/gün): 0.4×40 + 15×40×0.036
      dmiNRC: 23.27,          // NRC 2001 KMT tahmini (kg/gün) ±%2
      nelMaintenance: 9.698,  // NEL idame (Mcal/gün): 0.08 × 600^0.75 ±%2
      nelLactation: 27.963,   // NEL laktasyon (Mcal/gün) ±%2
      nelTotal: 37.662,       // Toplam NEL ihtiyacı (Mcal/gün) ±%2
      nelMilk: 0.6991,        // Sütün NEL içeriği (Mcal/kg) - laktoz dahil
    },
  },
  {
    id: 'nrc_ref_2',
    description: 'NRC 2001 - Holstein, 1. laktasyon, orta verimli',
    input: {
      breed: 'Holstein',
      parity: 1,
      dim: 90,
      bw: 520,
      bcs: 2.75,
      milkYield: 25,
      milkFat: 3.8,
      milkProtein: 3.3,
      milkLactose: 4.8,
      pregnant: false,
      gestDays: 0,
      activityLevel: 'low',
      housingType: 'freestall',
      dailyWalkKm: 0,
      thi: 55,
    },
    expected: {
      fcm4pct: 24.25,         // 0.4×25 + 15×25×0.038
      dmiNRC: 18.74,
      nelMaintenance: 8.711,  // 0.08 × 520^0.75
      nelLactation: 18.078,
      nelTotal: 26.789,
      nelMilk: 0.7231,
    },
  },
  {
    id: 'nrc_ref_3',
    description: 'NRC 2001 - Holstein, 2. laktasyon, gebelik dönemi (7. ay)',
    input: {
      breed: 'Holstein',
      parity: 2,
      dim: 200,
      bw: 580,
      bcs: 3.5,
      milkYield: 28,
      milkFat: 3.7,
      milkProtein: 3.25,
      milkLactose: 4.8,
      pregnant: true,
      gestDays: 210,
      activityLevel: 'low',
      housingType: 'freestall',
      dailyWalkKm: 0,
      thi: 55,
    },
    expected: {
      fcm4pct: 26.74,         // 0.4×28 + 15×28×0.037
      dmiNRC: 21.34,
      nelMaintenance: 9.455,  // 0.08 × 580^0.75
      nelLactation: 19.910,
      nelPregnancy: 2.902,    // NEL gebelik (Mcal/gün) - 210. gün
      nelTotal: 32.268,
      nelMilk: 0.7111,
    },
  },
];

/**
 * DCAD Referans Değerleri
 * Manuel hesap kontrolü için
 */
export const DCAD_REFERENCE_CASES = [
  {
    description: 'Laktasyon rasyonu - pozitif DCAD',
    input: {
      na_pct_dm: 0.22,   // % KM
      k_pct_dm: 1.50,
      cl_pct_dm: 0.25,
      s_pct_dm: 0.20,
    },
    expected: {
      dcad: 28.5,          // mEq/100g KM ±1 (hesaplanan: 28.48)
      interpretation: 'lactation_optimal',
    },
  },
  {
    description: 'Geçiş dönemi - asidojenik rasyon',
    input: {
      na_pct_dm: 0.10,
      k_pct_dm: 0.80,
      cl_pct_dm: 0.85,
      s_pct_dm: 0.42,
    },
    expected: {
      dcad: -8.2,
      interpretation: 'transition_optimal',
    },
  },
];

/**
 * Mineral Gereksinim Referans Değerleri
 * NRC 2001 Tablo 6-1 bazında
 */
export const MINERAL_REFERENCE = {
  description: 'Holstein, 600 kg, 40 kg/gün süt, 24 kg KMT',
  input: {
    bw: 600,
    dmi: 24,         // FAZ 13.7: P idame DMI-bazlı
    milkYield: 40,
    milkCa: 1.22,    // g Ca/kg süt
    milkP: 0.90,     // g P/kg süt
    milkMg: 0.12,
    milkK: 1.43,
    milkNa: 0.63,
  },
  expected: {
    // Ca absorbed: endogenous fecal = 0.031 × BW^0.75 g/d
    caMaintenance: 3.758,     // g/gün (absorbed): 0.031 × 600^0.75 = 0.031 × 121.15 = 3.756
    caLactation: 30.50,       // g/gün: milkYield × 1.22 × (25/40) yaklaşımı değil - direkt hesap
    caTotal: 34.26,           // maintenance + lactation hesabından
    // FAZ 13.7: P idame DMI-bazlı (1.0 g/kg KM × 24 = 24), eski hatalı BW-bazlı 6.0 değil
    pMaintenance: 24.00,      // g/gün: 1.0 g/kg KM × 24 kg KMT
    pLactation: 36.00,        // g/gün: 40 × 0.90
    pTotal: 60.00,            // 24 + 36
    mgMaintenance: 1.80,      // g/gün (NASEM 2021 default): 0.003 × 600; NRC 2001 = 0.0048 × 600 = 2.88
    mgLactation: 4.80,        // g/gün: 40 × 0.12
    mgTotal: 6.60,
  },
};
