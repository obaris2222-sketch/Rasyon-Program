/**
 * Rumen Sağlığı ve SARA Risk Skoru
 * Kaynak: Mertens (1997), NRC 2001 Bölüm 2, Beauchemin et al. (2003)
 */

/**
 * peNDF Hesabı (Fiziksel Etkin NDF)
 * peNDF = NDF% × Parçacık Etkinlik Faktörü (pef)
 * Parçacık boyutu sınıfına göre pef değerleri:
 *   >19 mm = 1.0 (tam etkin)
 *   8-19 mm = 0.42 (orta etkin)
 *   <8 mm = 0 (etkin değil)
 * @param {number} ndfPct     - NDF içeriği (% KM)
 * @param {number} pef        - Parçacık etkinlik faktörü (0-1)
 * @returns {number} peNDF (% KM)
 */
export function calcPeNDF(ndfPct, pef) {
  return ndfPct * pef;
}

/**
 * NFC (Non-Fiber Carbohydrate) hesabı
 * NFC = 100 - (CP + Yağ + Kül + NDF + NDICP%)
 * @param {number} cp    - Ham protein (% KM)
 * @param {number} fat   - Ham yağ (% KM)
 * @param {number} ash   - Kül (% KM)
 * @param {number} ndf   - NDF (% KM)
 * @param {number} ndicp - Asit deterjan çözünmez CP (% KM), varsayılan 0
 * @returns {number} NFC (% KM)
 */
export function calcNFC(cp, fat, ash, ndf, ndicp = 0) {
  return 100 - cp - fat - ash - ndf - ndicp;
}

/**
 * Kaba:Kesif oranı (% KM bazında)
 * @param {number} roughageDmKg  - Kaba yem KM (kg/gün)
 * @param {number} totalDmKg     - Toplam KM (kg/gün)
 * @returns {number} Kaba yem yüzdesi (% KM)
 */
export function calcForageRatio(roughageDmKg, totalDmKg) {
  if (totalDmKg <= 0) return 0;
  return (roughageDmKg / totalDmKg) * 100;
}

/**
 * Rumen pH Tahmini
 * CNCPS tabanlı SARA tahmin modeli
 * Kaynak: Beauchemin & Yang (2005), Hall et al.
 * @param {object} ration
 *   @param {number} ration.nfcPct     - NFC (% KM)
 *   @param {number} ration.peNDFPct   - peNDF (% KM)
 *   @param {number} ration.forageRatio - Kaba yem oranı (% KM)
 * @returns {object} { estimatedPH, saraRisk }
 */
export function estimateRumenPH(ration) {
  const { nfcPct, peNDFPct, forageRatio } = ration;

  // Basit lineer model (yaklaşım)
  // pH = 6.8 - 0.019 × NFC% + 0.022 × peNDF%
  let ph = 6.8 - 0.019 * nfcPct + 0.022 * peNDFPct;

  // Kaba yem düzeltmesi
  if (forageRatio < 40) {
    ph -= 0.015 * (40 - forageRatio);
  }

  ph = Math.max(5.5, Math.min(7.0, ph));

  let saraRisk;
  if (ph >= 6.2) saraRisk = 'low';
  else if (ph >= 5.8) saraRisk = 'moderate';
  else saraRisk = 'high';

  return {
    estimatedPH: Math.round(ph * 100) / 100,
    saraRisk,
  };
}

/**
 * PROBLEMLER #1 — Süt yağ:protein (F:P) değerlendirme bandı, ırka göre.
 * Sağlıklı F:P ~1.1–1.4 (yağ:protein). ALT taraf (<saraHigh/<saraMed) = süt yağı
 * depresyonu / SARA (rumen asidozu); ÜST taraf (>ketoMed/>ketoHigh) = ketozis /
 * negatif enerji dengesi (yağ mobilizasyonu). Jersey daha yüksek yağ → bant ~+0.05 kayar;
 * göreli SARA/ketozis eşiği büyük ölçüde ırk-bağımsızdır (modest düzeltme).
 */
function fprBands(breed) {
  if (breed === 'Jersey') return { saraHigh: 1.05, saraMed: 1.25, ketoMed: 1.45, ketoHigh: 1.55 };
  return { saraHigh: 1.0, saraMed: 1.2, ketoMed: 1.4, ketoHigh: 1.5 };
}

/**
 * Rumen Sağlığı Tam Değerlendirmesi
 * @param {object} ration - Rasyon parametreleri
 * @returns {object} Rumen sağlık skoru ve uyarılar
 */
export function assessRumenHealth(ration) {
  const {
    ndfPct,      // NDF (% KM)
    peNDFPct,    // peNDF (% KM)
    nfcPct,      // NFC (% KM)
    roughageNDFPct, // Kaba yem NDF (% KM rasyon)
    forageRatio, // Kaba yem oranı (% KM)
    milkFatPct,  // Süt yağı (%) - gerçek değer
    milkProteinPct,
    breed,       // PROBLEMLER #1: ırka göre F:P bandı (Jersey daha yüksek yağ)
  } = ration;

  const warnings = [];
  const recommendations = [];
  let score = 100; // 0-100 arası rumen sağlık skoru

  // peNDF kontrolü (Mertens 1997: ≥%22 KM)
  const peNDFStatus = peNDFPct >= 22 ? 'ok' : peNDFPct >= 19 ? 'warning' : 'danger';
  if (peNDFStatus === 'warning') {
    warnings.push({ type: 'peNDF', message: 'peNDF %22 hedefinin altında - SARA riski', severity: 'medium' });
    score -= 15;
  } else if (peNDFStatus === 'danger') {
    warnings.push({ type: 'peNDF', message: 'peNDF kritik düzeyde düşük - yüksek SARA riski!', severity: 'high' });
    score -= 30;
  }

  // NDF kontrolü (≥%28 KM önerilir)
  if (ndfPct < 25) {
    warnings.push({ type: 'NDF', message: 'NDF %25\'in altında - rumen tampon kapasitesi yetersiz', severity: 'high' });
    score -= 20;
  } else if (ndfPct < 28) {
    warnings.push({ type: 'NDF', message: 'NDF %28 hedefinin altında', severity: 'medium' });
    score -= 10;
  }

  // NFC kontrolü (≤%42 KM)
  if (nfcPct > 44) {
    warnings.push({ type: 'NFC', message: 'NFC %44\'ü aşıyor - asidoz riski yüksek', severity: 'high' });
    score -= 25;
  } else if (nfcPct > 42) {
    warnings.push({ type: 'NFC', message: 'NFC %42 sınırını aşıyor', severity: 'medium' });
    score -= 10;
  }

  // Kaba yem oranı (≥%45 KM önerilir)
  if (forageRatio < 35) {
    warnings.push({ type: 'ForageRatio', message: 'Kaba yem oranı kritik düzeyde düşük', severity: 'high' });
    score -= 20;
  } else if (forageRatio < 45) {
    warnings.push({ type: 'ForageRatio', message: 'Kaba yem oranı %45 hedefinin altında', severity: 'low' });
    score -= 5;
  }

  // Süt yağ:protein (F:P) — rumen/metabolik göstergesi (ırk-duyarlı bant; PROBLEMLER #1)
  // ALT: SARA / süt yağı depresyonu (rumen asidozu) · ÜST: ketozis / negatif enerji dengesi
  if (milkFatPct && milkProteinPct) {
    const ratio = milkFatPct / milkProteinPct;
    const b = fprBands(breed);
    if (ratio < b.saraHigh) {
      warnings.push({ type: 'MilkFatDepression', message: `Süt yağı/protein < ${b.saraHigh} - SARA / süt yağı depresyonu göstergesi`, severity: 'high' });
      score -= 15;
    } else if (ratio < b.saraMed) {
      warnings.push({ type: 'MilkFatDepression', message: 'Süt yağı/protein oranı düşük - SARA eğilimi', severity: 'medium' });
      score -= 5;
    } else if (ratio > b.ketoHigh) {
      warnings.push({ type: 'Ketosis', message: `Süt yağı/protein > ${b.ketoHigh} - ketozis / negatif enerji dengesi göstergesi`, severity: 'high' });
      score -= 15;
    } else if (ratio > b.ketoMed) {
      warnings.push({ type: 'Ketosis', message: 'Süt yağı/protein oranı yüksek - ketozis / negatif enerji dengesi eğilimi', severity: 'medium' });
      score -= 5;
    }
  }

  // Rumen pH tahmini
  const phEstimate = estimateRumenPH({ nfcPct, peNDFPct, forageRatio });

  // #13 düzeltmesi: SARA riskini rumen sağlık göstergeleriyle TUTARLI hale getir.
  // estimateRumenPH yalnız lineer pH modelini kullanır; ancak asidoz-ilişkili
  // yüksek/orta şiddetli uyarılar (peNDF/NDF/NFC/kaba yem/MFD) varsa pH modeli
  // "düşük risk" dese bile SARA riski en az o şiddete yükseltilir — böylece
  // "düşük skor + SARA riski yok" gibi çelişkili gösterim oluşmaz.
  const SARA_WARNING_TYPES = new Set(['peNDF', 'NDF', 'NFC', 'ForageRatio', 'MilkFatDepression']);
  let indicatorRisk = 'low';
  for (const w of warnings) {
    if (!SARA_WARNING_TYPES.has(w.type)) continue;
    if (w.severity === 'high') { indicatorRisk = 'high'; break; }
    if (w.severity === 'medium') indicatorRisk = 'moderate';
  }
  const RISK_RANK = { low: 0, moderate: 1, high: 2 };
  const saraRisk = RISK_RANK[indicatorRisk] >= RISK_RANK[phEstimate.saraRisk]
    ? indicatorRisk
    : phEstimate.saraRisk;

  if (recommendations.length === 0 && warnings.length === 0) {
    recommendations.push('Rumen dengesi iyi görünüyor');
  }

  return {
    score: Math.max(0, score),
    grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D',
    warnings,
    recommendations,
    params: {
      ndfPct,
      peNDFPct,
      nfcPct,
      forageRatio,
    },
    estimatedPH: phEstimate.estimatedPH,
    saraRisk,                          // #13: pH modeli + gösterge uyarılarının en kötüsü
    saraRiskByPH: phEstimate.saraRisk, // şeffaflık: yalnız pH-modeli tahmini (referans)
  };
}
