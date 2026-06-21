/**
 * DCAD (Diyet Katyon-Anyon Dengesi) Modülü
 * Geçiş dönemi yönetimi ve süt humması önleme
 * Kaynak: NRC 2001 Bölüm 6.3; Block (1994); Goff & Horst (1997)
 */

/**
 * DCAD hesabı — birim: mEq/100g KM
 * Formül: [(Na/23 + K/39) − (Cl/35.5 + S/16)] × 1000
 *
 * Birim türetmesi (FAZ 13.13 netleştirme): mineraller % KM (= g/100g KM) girilir.
 *   (Na% ÷ 23 g/mol) = mol Na / 100g KM  →  × 1000 = mmol/100g = mEq/100g
 *   (Na, K, Cl monovalent → mEq = mmol; S için /16 zaten eşdeğer-ağırlık kullanır).
 * Sonuç DOĞRUDAN mEq/100g KM cinsindedir (mEq/kg DEĞİL). Tipik hedefler:
 *   laktasyon +25..+40, far_off +15..+30, close_up (anyonik) −15..−5.
 * @param {object} minerals - {na_pct, k_pct, cl_pct, s_pct} (% KM)
 * @returns {number} DCAD (mEq/100g KM)
 */
export function calcDCAD(minerals) {
  const { na_pct, k_pct, cl_pct, s_pct } = minerals;
  const cations = (na_pct / 23) + (k_pct / 39);
  const anions = (cl_pct / 35.5) + (s_pct / 16);
  return Math.round((cations - anions) * 1000 * 10) / 10;
}

/**
 * İdrar pH tahmini (asidojenik rasyonlarda)
 * Pratik doğrulama kriteri - saha ölçümü ile karşılaştırılır
 * Kaynak: Goff & Horst (1998), Moore et al. (2000)
 * @param {number} dcad - DCAD değeri (mEq/100g KM)
 * @returns {object} { estimatedPH, targetRange, status }
 */
export function estimateUrinePH(dcad, cowPeriod = 'transition', breed = 'holstein') {
  // Pratik saha yaklaşımı (Goff, 2008): 
  // DCAD 0 mEq/100g civarında idrar pH ~ 7.5
  // DCAD -10 mEq/100g civarında idrar pH ~ 6.5
  // DCAD -15 mEq/100g civarında idrar pH ~ 6.0
  // Buna göre eğim negatif bölgede yaklaşık 0.1 pH/mEq'dir.
  // Pozitif bölgede ise pH daha yavaş artar ve ~8.5'te plato yapar (yaklaşık 0.02 eğim).
  let estimatedPH;
  if (dcad <= 0) {
    estimatedPH = 7.5 + (dcad * 0.1);
  } else {
    estimatedPH = 7.5 + (dcad * 0.02);
  }
  const clampedPH = Math.max(5.5, Math.min(8.5, estimatedPH));

  const targets = {
    transition: breed === 'jersey' ? { min: 5.5, max: 6.0 } : { min: 6.0, max: 6.5 },
    lactation:  { min: 8.0, max: 8.5 },
    dry_faroff: { min: 7.5, max: 8.5 },
  };
  const target = targets[cowPeriod] || targets.transition;

  let status;
  if (clampedPH >= target.min && clampedPH <= target.max) {
    status = 'target_met';
  } else if (clampedPH < target.min) {
    status = 'too_acidic_risk';
  } else {
    status = 'too_alkaline_no_protection';
  }

  return {
    estimatedPH: Math.round(clampedPH * 100) / 100,
    targetRange: `${target.min.toFixed(1)}-${target.max.toFixed(1)}`,
    status,
  };
}

/**
 * Saha ölçümlü idrar pH değerlendirmesi
 * Goff (2008), Goff & Horst (1997): Holstein için ideal asidojenik idrar pH 6.0-6.5
 * Jersey için 5.5-6.0 (daha düşük tampon kapasitesi)
 *
 * Yorumlama:
 *  - pH > 7.5  : asidojenik etki YOK, anyonik tuz dozu yetersiz, süt humması riski
 *  - pH 6.8-7.5: yetersiz asidifikasyon
 *  - pH 6.0-6.5: HEDEF (Holstein) — yeterli asidogenez, Ca emilim artışı
 *  - pH 5.5-6.0: kabul edilebilir, Jersey için ideal
 *  - pH < 5.5  : aşırı asidoz, KMT baskılanması ve metabolik asidoz riski
 *
 * Saha protokolü: doğumdan 2-3 gün önce sabah idrar örneği, taze ölçüm.
 *
 * @param {number} measuredPH - Sahada ölçülmüş idrar pH değeri
 * @param {string} cowPeriod  - 'transition' (close-up) | 'lactation' | 'dry_faroff'
 * @param {string} breed      - 'holstein' (varsayılan) | 'jersey'
 * @returns {object} { measuredPH, status, severity, message, targetRange, caAbsorptionImpact }
 */
export function interpretMeasuredUrinePH(measuredPH, cowPeriod = 'transition', breed = 'holstein') {
  const targets = {
    transition: breed === 'jersey'
      ? { min: 5.5, max: 6.0, label: 'Yakın-Kuru (Jersey)' }
      : { min: 6.0, max: 6.5, label: 'Yakın-Kuru (Holstein)' },
    lactation:  { min: 8.0, max: 8.5, label: 'Laktasyon' },
    dry_faroff: { min: 7.5, max: 8.5, label: 'Kuru Far-off' },
  };
  const target = targets[cowPeriod] || targets.transition;

  let status, severity, message;
  let caAbsorptionImpact = 'normal';

  if (cowPeriod !== 'transition') {
    // Lakte/kuru dönemde idrar pH 7.5-8.5 arası normal (asidogenez gereksiz)
    if (measuredPH >= target.min && measuredPH <= target.max) {
      status = 'normal';
      severity = 'none';
      message = `İdrar pH bu dönem için normal aralıkta (${target.label}: ${target.min}-${target.max}).`;
    } else if (measuredPH < target.min) {
      status = 'unexpected_acidic';
      severity = 'medium';
      message = `Bu dönem için beklenmedik düşük pH. Anyon yükü ya da diyet S aşırı olabilir.`;
    } else {
      status = 'normal_high';
      severity = 'none';
      message = `Yüksek pH bu dönem için normaldir.`;
    }
  } else {
    // Geçiş dönemi — asidogenez hedefi
    if (measuredPH >= target.min && measuredPH <= target.max) {
      status = 'target_met';
      severity = 'none';
      message = `HEDEF: pH ${target.min}-${target.max} aralığında. Asidogenez yeterli, Ca emilimi optimize.`;
      caAbsorptionImpact = 'enhanced';
    } else if (measuredPH > target.max && measuredPH <= 7.5) {
      status = 'insufficient_acidification';
      severity = 'medium';
      message = `Yetersiz asidogenez. Anyonik tuz dozunu %10-20 artırın, DCAD'ı daha negatif yapın.`;
    } else if (measuredPH > 7.5) {
      status = 'no_acidification';
      severity = 'high';
      message = `Asidogenez yok — süt humması riski yüksek. Anyonik tuz protokolü doğrulayın, DCAD ölçümü yapın.`;
    } else if (measuredPH < target.min && measuredPH >= 5.5) {
      status = 'borderline_low';
      severity = 'low';
      message = `Sınır altı. İzlemeye devam, hayvanın iştahını ve davranışını gözlemleyin.`;
      caAbsorptionImpact = 'enhanced';
    } else {
      status = 'over_acidification';
      severity = 'high';
      message = `Aşırı asidoz — DMI baskılanma ve metabolik asidoz riski. Anyonik tuz dozunu %15-25 azaltın.`;
      caAbsorptionImpact = 'reduced';
    }
  }

  return {
    measuredPH: Math.round(measuredPH * 100) / 100,
    status,
    severity,
    message,
    targetRange: `${target.min}-${target.max}`,
    target,
    caAbsorptionImpact,  // 'enhanced' | 'normal' | 'reduced'
    cowPeriod,
    breed,
  };
}

/**
 * DCAD yorumu (dönem bazlı)
 * @param {number} dcad       - DCAD değeri (mEq/100g KM)
 * @param {string} cowPeriod  - 'lactation' | 'transition' | 'dry_faroff'
 * @returns {object} { status, message, target }
 */
export function interpretDCAD(dcad, cowPeriod = 'lactation') {
  const targets = {
    lactation:    { min: 25, max: 40,   label: 'Laktasyon' },
    transition:   { min: -15, max: -10, label: 'Yakın-Kuru (Asidojenik)' },
    dry_faroff:   { min: 15, max: 25,   label: 'Kuru Dönem' },
  };

  const target = targets[cowPeriod] || targets.lactation;
  let status, severity;

  if (dcad >= target.min && dcad <= target.max) {
    status = 'optimal';
    severity = 'none';
  } else if (dcad < target.min) {
    const diff = target.min - dcad;
    status = 'below_target';
    severity = diff > 10 ? 'high' : diff > 5 ? 'medium' : 'low';
  } else {
    const diff = dcad - target.max;
    status = 'above_target';
    severity = diff > 10 ? 'high' : diff > 5 ? 'medium' : 'low';
  }

  const messages = {
    optimal: `DCAD optimal aralıkta (${target.label}: ${target.min} ile ${target.max} mEq/100g KM)`,
    below_target: `DCAD hedefin altında. ${target.label} için ${target.min} mEq/100g KM minimum önerilir.`,
    above_target: `DCAD hedefin üstünde. ${target.label} için ${target.max} mEq/100g KM maksimum önerilir.`,
  };

  return {
    status,
    severity,
    target,
    message: messages[status],
    dcad,
    cowPeriod,
  };
}

/**
 * Geçiş dönemi riski değerlendirmesi
 * Süt humması (hipokalsemi) riski skoru
 * @param {number} dcad       - Yakın-kuru dönem DCAD (mEq/100g KM)
 * @param {number} caPctDM    - Ca içeriği (% KM)
 * @param {number} parity     - Laktasyon numarası
 * @returns {object} { riskScore, riskLevel, recommendations }
 */
export function milkFeverRisk(dcad, caPctDM, parity) {
  let score = 0;

  // DCAD riski
  if (dcad > 0) score += 3;
  else if (dcad > -5) score += 2;
  else if (dcad > -10) score += 1; // Sınırda
  else if (dcad <= -10 && dcad >= -15) score += 0; // Optimal
  else score += 1; // Çok asidik

  // Ca içeriği riski (yüksek Ca geçiş rasyonunda risk)
  if (caPctDM > 0.6) score += 2;
  else if (caPctDM > 0.4) score += 1;

  // Parite riski (yaşlı inekler daha riskli)
  if (parity >= 3) score += 2;
  else if (parity === 2) score += 1;

  let riskLevel;
  if (score <= 1) riskLevel = 'low';
  else if (score <= 3) riskLevel = 'moderate';
  else if (score <= 5) riskLevel = 'high';
  else riskLevel = 'very_high';

  const recommendations = [];
  if (dcad > -10) recommendations.push('DCAD\'i -10 ile -15 arasına düşürün (anyonik tuzlar kullanın)');
  if (caPctDM > 0.6) recommendations.push('Geçiş rasyonunda Ca\'yı %0.4-0.6 KM\'ye indirin');
  if (parity >= 3) recommendations.push('3. laktasyon+ ineklere özellikle dikkat edin');

  return { score, riskLevel, recommendations };
}

/**
 * Anyonik tuz gereksinim tahmini
 * Sadece hedef mevcut değerden düşükse anyonik tuza ihtiyaç vardır (close-up).
 * @param {number} currentDCAD - Mevcut DCAD (mEq/100g KM)
 * @param {number} targetDCAD - Hedef DCAD (mEq/100g KM) (genelde -10)
 * @param {number} dmi - Günlük KM tüketimi (kg)
 * @returns {object|null} - İhtiyaç yoksa null döner
 */
export function recommendAnionicSalts(currentDCAD, targetDCAD, dmi) {
  // Sağlamlık: geçersiz/non-finite girdide NaN üretmek yerine null dön (denetim düzeltmesi)
  if (!Number.isFinite(currentDCAD) || !Number.isFinite(targetDCAD) || !Number.isFinite(dmi) || dmi <= 0) return null;
  if (currentDCAD <= targetDCAD) return null;

  // Düşürülmesi gereken toplam mEq (Günlük KM üzerinden)
  const deltaEqPer100g = currentDCAD - targetDCAD; 
  // formül: mEq/100g KM * 10 * dmi_kg = toplam mEq
  const totalMEqNeeded = deltaEqPer100g * (dmi * 10); 

  // 1g CaCl2 (saf) yaklaşık 18.0 mEq anyon sağlar (Cl).
  // 1g MgSO4 (saf) yaklaşık 16.6 mEq anyon sağlar (S).
  const mEqPerG_CaCl2 = 18.0; 
  const mEqPerG_MgSO4 = 16.6;

  const cacl2_only = Math.round(totalMEqNeeded / mEqPerG_CaCl2);
  const mgso4_only = Math.round(totalMEqNeeded / mEqPerG_MgSO4);
  const mixed_cacl2 = Math.round((totalMEqNeeded * 0.5) / mEqPerG_CaCl2);
  const mixed_mgso4 = Math.round((totalMEqNeeded * 0.5) / mEqPerG_MgSO4);

  return {
    deltaDCAD: deltaEqPer100g,
    totalMEq: Math.round(totalMEqNeeded),
    cacl2Only_g: cacl2_only,
    mgso4Only_g: mgso4_only,
    mixed: {
      cacl2_g: mixed_cacl2,
      mgso4_g: mixed_mgso4
    },
    message: `Hedef DCAD (${targetDCAD} mEq/100g) seviyesine inmek için günde ${Math.round(totalMEqNeeded)} mEq anyon açığı kapatılmalıdır.`
  };
}
