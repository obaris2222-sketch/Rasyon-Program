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

  // B. Geçiş Hızı ve Rumen Sağlığı (peNDF & Nişasta Kalibrasyonu - Fuzzy Logic)
  // Süt Yağı ve Dışkı Skoru üzerinden ağırlıklı risk skoru
  const targetFat = 3.5;
  const fatDeficit = Math.max(0, targetFat - actualFat);
  const manureDeficit = manureScore ? Math.max(0, 3.0 - manureScore) : 0;
  
  // Eğer yağda belirgin düşüş (>0.1) ve dışkıda cıvıklaşma (>0.2) varsa risk skoru hesapla
  if (fatDeficit > 0.1 && manureDeficit > 0.2) {
    const riskScore = (fatDeficit * 2) + manureDeficit; // Maksimum ~1.5 - 2.5
    
    let peNdfOff = 0;
    let nfcOff = 0;
    let severity = 'Hafif Hızlı Rumen Geçişi';
    let msgType = 'warning';
    
    if (riskScore > 1.5) {
      peNdfOff = 3; nfcOff = -4; severity = 'Şiddetli Hızlı Rumen Geçişi / SARA Riski'; msgType = 'danger';
    } else if (riskScore > 0.8) {
      peNdfOff = 2; nfcOff = -3; severity = 'Orta Şiddetli Hızlı Rumen Geçişi';
    } else {
      peNdfOff = 1; nfcOff = -2;
    }

    diagnostics.push({
      type: msgType,
      cause: severity,
      message: `Süt yağınız hedefin altında (%${actualFat}) ve dışkı cıvık (Skor: ${manureScore}). Rasyon çok hızlı sindiriliyor. peNDF alt sınırı %${peNdfOff} artırılmalı, Nişasta/Şeker (NFC) üst sınırı %${Math.abs(nfcOff)} düşürülmeli.`,
      action: 'peNdfAndNfcOffset',
      peNdfOffset: peNdfOff,
      maxNfcOffset: nfcOff
    });
  }

  // C. Rumen Senkronizasyonu (Protein/Karbonhidrat Dengesi - Fuzzy Logic)
  const targetProtein = 3.2;
  const proteinDeficit = Math.max(0, targetProtein - actualProtein);
  const munExcess = mun ? Math.max(0, mun - 14) : 0;
  
  if (proteinDeficit > 0.1 && munExcess > 1) {
    const syncRisk = proteinDeficit + (munExcess * 0.1);
    
    let nfcIncrease = 1;
    if (syncRisk > 0.6) nfcIncrease = 3;
    else if (syncRisk > 0.3) nfcIncrease = 2;

    diagnostics.push({
      type: 'warning',
      cause: 'Rumen Senkronizasyonu Bozukluğu',
      message: `Süt proteini düşük (%${actualProtein}) ve MUN yüksek (${mun} mg/dL). İşkembedeki RDP, enerji (NFC) eksikliğinden dolayı yakalanamıyor. NFC limitleri %${nfcIncrease} esnetilmeli.`,
      action: 'maxNfcOffset',
      maxNfcOffset: nfcIncrease
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
