/**
 * Azot Dengesi ve Süt Üre Azotu (MUN) Tahmin Modülü
 * FAZ 1 Kalibrasyon Merkezi Altyapısı
 */

/**
 * Rasyon verilerinden tahmini MUN (Süt Üre Azotu) değerini hesaplar.
 * NASEM / Broderick yaklaşımlarına dayalı ampirik tahmin.
 * MUN, diyetteki ham proteinin (özellikle RDP) fazlalığı veya
 * rumendeki fermente olabilir karbonhidrat (NFC) eksikliği durumunda yükselir.
 * 
 * @param {object} ration - Rasyon içeriği (cpPct, nfcPct, rdp_g vs.)
 * @returns {number} Tahmini MUN (mg/dL)
 */
export function calcPredictedMUN(ration) {
  const nfcPct = ration.nfc_pct || ration.nfcPct || 35;
  const dmi = ration.dmi_kg || ration.dmi || 24;
  const cpPct = ration.cp_pct || ration.cpPct || 16;
  
  let predictedMUN = 12.0;

  // Modern NASEM/CNCPS yaklaşımı: MUN asıl olarak RDP (İşkembede Yıkılabilir Protein)
  // ve MP (Metabolik Protein) dengesine bağlıdır. HP (Ham Protein) yanıltıcı olabilir.
  if (ration.rdp_g) {
    // RDP üzerinden hassas hesaplama (MP sistemine tam uyumlu)
    const rdpPct = (ration.rdp_g / (dmi * 1000)) * 100; 
    const rdpExcess = rdpPct - 10.5; // İdeal RDP genelde %10-10.5 bandındadır
    
    // Baz MUN, RDP fazlalığına/eksikliğine göre ayarlanır
    predictedMUN += rdpExcess * 1.5; 
    
    // Enerji (NFC) işkembedeki amonyağı mikroplara (Mikrobiyal MP) çevirir.
    // NFC yüksekse amonyak yakalanır ve MUN düşer.
    predictedMUN -= (nfcPct - 38.0) * 0.25;
  } else {
    // RDP verisi yoksa (eski veya eksik rasyon), mecburen CP üzerinden kaba tahmin
    predictedMUN += (cpPct - 16.0) * 0.85 - (nfcPct - 38.0) * 0.25;
  }

  // Güvenlik sınırları (biyolojik limitler)
  if (predictedMUN < 4) predictedMUN = 4;
  if (predictedMUN > 30) predictedMUN = 30;

  return Math.round(predictedMUN * 10) / 10;
}
