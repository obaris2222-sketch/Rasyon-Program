/**
 * Otomatik Kalibrasyon ve Teşhis Motoru (FAZ 3)
 * 
 * Bu modül saha gözlemlerini ve rasyon tahminlerini (R², RMSE, bias) analiz ederek
 * işletmeye özel veya rasyon/profil bazlı kalibrasyon önerileri üretir.
 */

import { validatePairs, validateDmiForProfile } from './validation.js';

/**
 * Verilen profil, gözlem geçmişi ve aktif rasyon verilerine dayanarak
 * bir kalibrasyon/teşhis raporu üretir.
 * 
 * @param {object} profile - Hayvan profili
 * @param {Array} observations - Sahadan girilmiş gözlem geçmişi (zaman sıralı)
 * @param {object} ration - Optimizasyondan dönen rasyon detayları (süt yağı vs. için)
 * @param {object} options - Ek ayarlar (örn. dmiMethod)
 * @returns {object} { diagnostics: [], overrides: {}, R2: number, RMSE: number }
 */
export function runDiagnostic(profile, observations, ration, options = {}) {
  const diagnostics = [];
  let overrides = { ...profile.calibrationOverrides };
  
  if (!observations || observations.length === 0) {
    return {
      diagnostics: [{ type: 'info', message: 'Teşhis için saha gözlem kaydı bulunamadı.' }],
      overrides,
      R2: null,
      RMSE: null,
      Bias: null
    };
  }

  // Model Validasyon Tablosu (UI) ile %100 uyumlu olması için aynı validasyon fonksiyonunu kullanıyoruz.
  // Rasyonun doluluk (fill) limitinden etkilenmiş geçici DMI'sını değil, teorik modeli (calcDMI) baz alır.
  const dmiValidation = validateDmiForProfile(observations, profile, { dmiMethod: options.dmiMethod });

  const milkPairs = observations.map(o => ({
    predicted: ration.milkYield || profile.milkYield,
    observed: o.milkYield
  })).filter(p => p.observed != null && p.observed > 0);

  const milkValidation = validatePairs(milkPairs);

  const R2 = dmiValidation.r2;
  const RMSE = dmiValidation.rmse;
  const Bias = dmiValidation.bias; // Pozitifse model fazla tahmin ediyor demektir

  // A. Veri Güvenilirliği ve KMT Kalibrasyonu
  if (dmiValidation.n >= 3) {
    // Sabit tahmin durumunda R² negatif çıkabilir, bu yüzden sadece varyansa (gürültüye) bakıyoruz.
    // Toplam Hata (RMSE) = Kök( Rastgele_Hata^2 + Bias^2 )
    // Rastgele Hata (StdDev) = Kök( RMSE^2 - Bias^2 )
    const randomError = Math.sqrt(Math.max(0, (RMSE * RMSE) - (Bias * Bias)));

    if (randomError > 2.0) {
      diagnostics.push({
        type: 'error',
        cause: 'Veri Tutarsızlığı / TMR Homojenliği',
        message: `Kuru Madde Tüketimi tutarsız (Rastgele Dalgalanma: ${randomError.toFixed(2)} kg). Yem karma vagonunuzun homojenliğini veya tartımları kontrol edin. Fizyolojik kalibrasyon yapılamaz.`
      });
      return { diagnostics, overrides, R2, RMSE, Bias }; // Veri çok gürültülüyse fizyolojik teşhise girme
    }

    // Global DMI Kalibrasyonu (Ölçek/Tartım Hatası)
    if (Math.abs(Bias) > 1.5) {
      const suggestedMultiplier = dmiValidation.meanObserved / dmiValidation.meanPredicted;
      diagnostics.push({
        type: 'warning',
        cause: 'Sistematik Tüketim Sapması',
        message: `İnekleriniz istikrarlı olarak tahmin edilenden ${Bias > 0 ? 'daha az' : 'daha çok'} yiyor (Sapma: ${Bias} kg). KMT kalibrasyon katsayısı ${suggestedMultiplier.toFixed(2)} olarak ayarlanmalıdır.`,
        action: 'dmiMultiplier',
        value: suggestedMultiplier
      });
    }
  }

  // Son Gözlem Verilerini Al (Fizyolojik Karar Matrisi için)
  const lastObs = observations[0] || {};
  const actualFat = lastObs.milkFat || profile.milkFat;
  const actualProtein = lastObs.milkProtein || profile.milkProtein;
  const manureScore = lastObs.manureScore;
  const mun = lastObs.mun;
  const bcs = lastObs.bcs || profile.bcs;

  // B. Geçiş Hızı ve Rumen Sağlığı (peNDF & Nişasta Kalibrasyonu)
  // Kural: Süt Yağı < %3.4 VE Dışkı Skoru < 2.5 (Cıvık)
  if (actualFat < 3.4 && manureScore && manureScore < 2.5) {
    diagnostics.push({
      type: 'danger',
      cause: 'Hızlı Rumen Geçişi / SARA Başlangıcı',
      message: `Süt yağınız düşük (%${actualFat}) ve dışkı cıvık (Skor: ${manureScore}). Rasyon çok hızlı sindiriliyor. peNDF (etkin lif) alt sınırı %2 artırılmalı, Nişasta/Şeker (NFC) üst sınırı %3 düşürülmeli.`,
      action: 'peNdfAndNfcOffset',
      peNdfOffset: 2,
      maxNfcOffset: -3
    });
  }

  // C. Rumen Senkronizasyonu (Protein/Karbonhidrat Dengesi)
  // Kural: Süt Proteini < Beklenen VE MUN > 16 mg/dL
  if (actualProtein < 3.0 && mun > 16) {
    diagnostics.push({
      type: 'warning',
      cause: 'Rumen Senkronizasyonu Bozukluğu',
      message: `Süt proteini düşük (%${actualProtein}) ve MUN yüksek (${mun} mg/dL). Rasyondaki protein (RDP) işkembede enerji (NFC) eksikliğinden dolayı yakalanamayıp üreye dönüşüyor. NFC (Karbonhidrat) limitleri gevşetilmeli.`,
      action: 'maxNfcOffset',
      maxNfcOffset: 2
    });
  }
  
  // D. Kaba Yem Sindirilebilirlik / Enerji Eksikliği
  if (milkValidation.n >= 3 && milkValidation.bias > 2.5 && bcs < 2.75) {
    diagnostics.push({
      type: 'warning',
      cause: 'Gizli Enerji Açığı / Düşük Sindirilebilirlik',
      message: `İnekler yemlerini tüketmesine rağmen süt verimi sürekli beklenenin ${milkValidation.bias} kg altında kalıyor ve BCS düşük. Kaba yemlerinizin laboratuvar enerji değerleri gerçeği yansıtmıyor olabilir.`
    });
  }

  // Eğer hiçbir sorun bulunamadıysa
  if (diagnostics.length === 0) {
    diagnostics.push({
      type: 'success',
      cause: 'Optimum Performans',
      message: 'Sahadaki verileriniz ile rasyon tahminleriniz uyumlu. Herhangi bir kalibrasyon değişikliğine gerek yok.'
    });
  }

  return { diagnostics, overrides, R2, RMSE, Bias };
}
