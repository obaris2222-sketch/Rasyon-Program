/**
 * FAZ 19.3 — Model Validasyon Metrikleri (ALTYAPI / İSKELET)
 *
 * Tahmin-vs-gözlem karşılaştırması için standart doğruluk istatistikleri:
 * RMSE (kök ortalama kare hata), ortalama sapma (signed bias), MAE, R².
 *
 * ⚠️ DÜRÜSTLÜK (FAZ 19 — minimal/dürüst kapsam): Bu bir VALİDASYON ALTYAPISIDIR,
 * "model valide edildi" beyanı DEĞİLDİR. Anlamlı model validasyonu yeterli sayıda
 * ve çeşitlilikte (çok çiftlik/hayvan, zaman içinde) gerçek saha verisi gerektirir.
 * Az örnekte (< VALIDATION_MIN_SAMPLES) metrikler yalnız göstergedir. Tek profilde
 * tahmin sabit olduğundan RMSE/bias/MAE anlamlıdır ama R² sınırlıdır (değişken tahmin
 * gerektirir → çok-profil agregasyonu: validateDmiAcrossProfiles).
 *
 * Kaynak: standart tahmin doğruluğu istatistikleri (RMSE, mean bias, coefficient of determination).
 */

import { calcDMI } from './dmi.js';

export const VALIDATION_MIN_SAMPLES = 3;  // bu sayının altında metrikler "yetersiz veri" sayılır

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;  // Number(null)=0 tuzağını engelle
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function round(v, d) { if (v == null || !Number.isFinite(v)) return null; const f = 10 ** d; return Math.round(v * f) / f; }

/** Geçerli {predicted, observed} çiftlerini süz (ikisi de sonlu sayı). */
function cleanPairs(pairs) {
  if (!Array.isArray(pairs)) return [];
  return pairs
    .map(p => ({ predicted: num(p?.predicted), observed: num(p?.observed) }))
    .filter(p => Number.isFinite(p.predicted) && Number.isFinite(p.observed));
}

/** RMSE = √(ortalama((tahmin − gözlem)²)). null → geçerli çift yok. */
export function rmse(pairs) {
  const ps = cleanPairs(pairs);
  if (ps.length === 0) return null;
  const se = ps.reduce((s, p) => s + (p.predicted - p.observed) ** 2, 0);
  return Math.sqrt(se / ps.length);
}

/** Ortalama sapma (signed bias) = ortalama(tahmin − gözlem). + → model fazla tahmin ediyor. */
export function meanBias(pairs) {
  const ps = cleanPairs(pairs);
  if (ps.length === 0) return null;
  return ps.reduce((s, p) => s + (p.predicted - p.observed), 0) / ps.length;
}

/** MAE = ortalama(|tahmin − gözlem|). */
export function mae(pairs) {
  const ps = cleanPairs(pairs);
  if (ps.length === 0) return null;
  return ps.reduce((s, p) => s + Math.abs(p.predicted - p.observed), 0) / ps.length;
}

/**
 * R² (belirleme katsayısı) = 1 − SS_res/SS_tot (gözlem varyansına göre).
 * Gözlem varyansı 0 (tüm gözlemler eşit) veya < 2 çift → null (tanımsız).
 * NOT: sabit tahmin (tek profil) → R² negatif/yanıltıcı olabilir; değişken tahmin gerekir.
 */
export function rSquared(pairs) {
  const ps = cleanPairs(pairs);
  if (ps.length < 2) return null;
  const obsMean = ps.reduce((s, p) => s + p.observed, 0) / ps.length;
  const ssTot = ps.reduce((s, p) => s + (p.observed - obsMean) ** 2, 0);
  if (ssTot === 0) return null;
  const ssRes = ps.reduce((s, p) => s + (p.observed - p.predicted) ** 2, 0);
  return 1 - ssRes / ssTot;
}

/**
 * Tüm metrikleri tek seferde döndür.
 * @returns {{ n, rmse, bias, mae, r2, meanObserved, meanPredicted, cvRmse, sufficient }}
 *   cvRmse = RMSE / ortalama gözlem × 100 (% — ölçek-bağımsız hata).
 *   sufficient = n ≥ VALIDATION_MIN_SAMPLES (altında metrikler güvenilir değil).
 */
export function validatePairs(pairs) {
  const ps = cleanPairs(pairs);
  const n = ps.length;
  if (n === 0) {
    return { n: 0, rmse: null, bias: null, mae: null, r2: null, meanObserved: null, meanPredicted: null, cvRmse: null, sufficient: false };
  }
  const meanObserved = ps.reduce((s, p) => s + p.observed, 0) / n;
  const meanPredicted = ps.reduce((s, p) => s + p.predicted, 0) / n;
  const r = rmse(ps);
  return {
    n,
    rmse: round(r, 3),
    bias: round(meanBias(ps), 3),
    mae: round(mae(ps), 3),
    r2: round(rSquared(ps), 3),
    meanObserved: round(meanObserved, 3),
    meanPredicted: round(meanPredicted, 3),
    cvRmse: meanObserved !== 0 ? round((r / meanObserved) * 100, 1) : null,
    sufficient: n >= VALIDATION_MIN_SAMPLES,
  };
}

/**
 * Bir profilin gözlemlerinden KMT tahmin-vs-gözlem çiftleri kurar.
 * Tahmin: calcDMI(profile, dmiMethod).dmi (profil-bazlı, sabit); gözlem: her kaydın dmiActual'i.
 * @param {object[]} observations
 * @param {object} animalProfile
 * @param {object} [options] - { dmiMethod } (FAZ 17.3: optimizer ile tutarlı çözülmüş yöntem)
 * @returns {Array<{predicted:number, observed:number}>}
 */
export function buildDmiPairs(observations, animalProfile, options = {}) {
  if (!Array.isArray(observations) || !animalProfile) return [];
  const predicted = calcDMI(animalProfile, options.dmiMethod)?.dmi;
  return buildPredictionPairs(observations, predicted, 'dmiActual');
}

/**
 * Tek profil KMT tahmin doğruluğu (RMSE/bias/MAE anlamlı; R² sınırlı — sabit tahmin).
 */
export function validateDmiForProfile(observations, animalProfile, options = {}) {
  return validatePairs(buildDmiPairs(observations, animalProfile, options));
}

/**
 * Genel tahmin-vs-gözlem çiftleri kurucu (FAZ 25.1)
 * @param {object[]} observations 
 * @param {number} predictedValue - Sabit tahmin değeri (örn. çözülmüş rasyondan gelen metan)
 * @param {string} obsField - Gözlem objesindeki karşılık gelen alan adı (örn. 'methane', 'rumenPh')
 * @returns {Array<{predicted:number, observed:number}>}
 */
export function buildPredictionPairs(observations, predictedValue, obsField) {
  if (!Array.isArray(observations) || !Number.isFinite(predictedValue)) return [];
  return observations
    .filter(o => Number.isFinite(num(o?.[obsField])))
    .map(o => ({ predicted: predictedValue, observed: num(o[obsField]) }));
}

/**
 * Belirli bir alan için (süt yağı, metan, pH vb.) tahmin doğruluğu hesaplar (FAZ 25.1)
 */
export function validatePredictionForProfile(observations, predictedValue, obsField) {
  return validatePairs(buildPredictionPairs(observations, predictedValue, obsField));
}

/**
 * Çok-profil KMT validasyonu — DEĞİŞKEN tahminler (her profil farklı) → anlamlı R².
 * Her profil için tahmin = calcDMI; gözlem = o profilin dmiActual ortalaması (gürültü azaltma).
 * @param {Array<{profile:object, observations:object[]}>} entries
 * @param {object} [options] - { dmiMethod }
 * @returns {object} validatePairs sonucu + { profiles } (kullanılan profil sayısı)
 */
export function validateDmiAcrossProfiles(entries, options = {}) {
  const pairs = [];
  for (const e of (entries || [])) {
    if (!e?.profile || !Array.isArray(e.observations)) continue;
    const predicted = calcDMI(e.profile, options.dmiMethod)?.dmi;
    if (!Number.isFinite(predicted)) continue;
    const obs = e.observations.map(o => num(o?.dmiActual)).filter(Number.isFinite);
    if (obs.length === 0) continue;
    const meanObs = obs.reduce((s, v) => s + v, 0) / obs.length;
    pairs.push({ predicted, observed: meanObs });
  }
  return { ...validatePairs(pairs), profiles: pairs.length };
}
