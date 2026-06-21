/**
 * Isı Stresi Modülü
 * THI hesabı ve enerji/KMT düzeltmeleri
 * Kaynak: NRC 2001 Bölüm 1.4; West et al. (2003); Bernabucci et al. (2010)
 */

/**
 * THI (Temperature-Humidity Index) hesabı
 * Mader et al. (2006) / NRC bazlı standart formül:
 *   THI = (1.8 × T + 32) − [(0.55 − 0.0055 × RH) × (1.8 × T − 26)]
 * T = sıcaklık (°C), RH = bağıl nem (%)
 *
 * Doğrulama örnekleri (referans):
 *   T=30°C, RH=60% → THI ≈ 79.84
 *   T=25°C, RH=50% → THI ≈ 72.0
 *   T=35°C, RH=70% → THI ≈ 87.5
 *
 * @param {number} tempC  - Hava sıcaklığı (°C)
 * @param {number} rh     - Bağıl nem (%)
 * @returns {number} THI değeri (boyutsuz)
 */
export function calcTHI(tempC, rh) {
  const tempF = 1.8 * tempC + 32;        // °C → °F
  const humidityFactor = 0.55 - 0.0055 * rh;
  return tempF - humidityFactor * (tempF - 58);
}

/**
 * THI stres kategorisi
 * @param {number} thi - THI değeri
 * @returns {object} { level, label, color }
 */
export function classifyTHI(thi) {
  if (thi < 72) {
    return { level: 'none', label: 'Stres Yok', color: 'green', dmiReduction: 0 };
  } else if (thi < 75) {
    return { level: 'mild', label: 'Hafif Stres', color: 'yellow', dmiReduction: 0.2 };
  } else if (thi < 79) {
    return { level: 'moderate', label: 'Orta Stres', color: 'orange', dmiReduction: 0.5 };
  } else if (thi < 84) {
    return { level: 'severe', label: 'Şiddetli Stres', color: 'red', dmiReduction: 1.0 };
  } else {
    return { level: 'extreme', label: 'Aşırı Stres', color: 'darkred', dmiReduction: 2.0 };
  }
}

/**
 * Isı stresinde KMT azalması
 * West et al. (2003): Her THI birimi için ~0.4 kg/gün azalma (THI > 72)
 * @param {number} baseDmi  - Normal koşullardaki KMT (kg/gün)
 * @param {number} thi      - THI değeri
 * @returns {number} Düzeltilmiş KMT (kg/gün)
 */
export function adjustDMIForHeat(baseDmi, thi) {
  if (thi <= 72) return baseDmi;
  const reduction = 0.4 * (thi - 72);
  return Math.max(baseDmi - reduction, baseDmi * 0.5);
}

/**
 * Isı stresinde enerji gereksinimi düzeltmesi
 * Isı stresinde idame enerji artışı (solunum, terleme)
 * West et al. (2003): %5-20 artış
 * @param {number} nelMaintenance - Normal idame NEL (Mcal/gün)
 * @param {number} thi            - THI değeri
 * @returns {number} Düzeltilmiş idame NEL (Mcal/gün)
 */
export function adjustNELMaintenanceForHeat(nelMaintenance, thi) {
  if (thi <= 72) return nelMaintenance;
  const extraPct = Math.min(0.20, 0.005 * (thi - 72));
  return nelMaintenance * (1 + extraPct);
}

/**
 * Isı stresi önlem önerileri
 * @param {object} thiClass - classifyTHI() çıktısı
 * @returns {string[]} Öneri listesi
 */
export function heatStressRecommendations(thiClass) {
  const recommendations = {
    none: [],
    mild: [
      'Serinletme ekipmanlarını kontrol edin',
      'Yem tüketimini sabah erken ve akşam geç saatlere yönlendirin',
    ],
    moderate: [
      'Soğutma fanları ve spreyleri çalıştırın',
      'Serinletici yem katkıları değerlendirin (tamponlar, by-pass yağ)',
      'Yem tüketimini serinleme saatlerine yığın',
      'Taze su erişimini artırın (30°C+ su sıcaklığına dikkat)',
    ],
    severe: [
      'Acil serinletme protokolü uygulayın',
      'Enerji yoğunluğunu artırın (by-pass yağ, NFC artışı)',
      'KMT düşeceğinden NEL konsantrasyonu yükseltin',
      'Tampon kullanımını artırın (SARA riski)',
      'Fertilite protokollerini gözden geçirin',
    ],
    extreme: [
      'Üretim kaybı kaçınılmaz, hayvan refahına odaklanın',
      'Veteriner müdahalesi gerekebilir',
      'Yüksek verimlileri serin ortama taşıyın',
    ],
  };
  return recommendations[thiClass.level] || [];
}

/**
 * Türkiye ortalama THI değerleri (tahmini - aylık)
 * Bölgesel düzeltme için referans
 */
export const TURKEY_AVERAGE_THI = {
  Jan: 40, Feb: 42, Mar: 47, Apr: 55,
  May: 63, Jun: 73, Jul: 78, Aug: 77,
  Sep: 70, Oct: 62, Nov: 52, Dec: 43,
};
