/**
 * Kuru Madde Tüketimi (KMT) Tahmin Modülleri
 * Kaynak: NRC 2001 (Rayburn & Fox 1993 temelli) ve de Souza et al. 2019
 */

/**
 * 4% yağ düzeltmeli süt hesabı (FCM)
 * @param {number} milkYield  - Günlük süt verimi (kg/gün)
 * @param {number} milkFat    - Süt yağı (%)
 * @returns {number} FCM (kg/gün)
 */
export function calcFCM(milkYield, milkFat) {
  return 0.4 * milkYield + 15 * milkYield * (milkFat / 100);
}

/**
 * Enerjice düzeltilmiş süt hesabı (ECM)
 * ECM = süt × (0.327 + 0.1276 × yağ% + 0.0978 × protein%)
 * Kaynak: Tyrrell & Reid (1965), NRC 2001 referansı
 * @param {number} milkYield  - Günlük süt verimi (kg/gün)
 * @param {number} milkFat    - Süt yağı (%)
 * @param {number} milkProtein - Süt proteini (%)
 * @returns {number} ECM (kg/gün)
 */
export function calcECM(milkYield, milkFat, milkProtein) {
  return milkYield * (0.327 + 0.1276 * milkFat + 0.0978 * milkProtein);
}

/**
 * NRC 2001 KMT Denklemi - laktasyondaki inekler
 * NRC 2001 Eq. 1-1 (Rayburn & Fox, 1993)
 * @param {number} fcm  - 4% yağ düzeltmeli süt (kg/gün)
 * @param {number} bw   - Canlı ağırlık (kg)
 * @param {number} wol  - Laktasyon haftası (dim / 7)
 * @returns {number} KMT (kg/gün)
 */
export function dmiNRC2001(fcm, bw, wol) {
  const mbw = Math.pow(bw, 0.75);
  const lactationFactor = 1 - Math.exp(-0.192 * (wol + 3.67));
  return (0.372 * fcm + 0.0968 * mbw) * lactationFactor;
}

/**
 * Büyüyen (laktasyon-öncesi) süt düvesi KMT tahmini — NRC 2001 Tablo 11-4
 *
 * Büyüyen düvenin KMT'si canlı ağırlığın azalan bir yüzdesidir: küçük düve
 * görece daha fazla tüketir, olgunlaştıkça oran düşer. Tablo 11-4 değerleriyle
 * uyumlu yaklaşım (örn. 400 kg düve ≈ 9.2 kg/gün = %2.3 BW).
 *
 * Not: LAKTASYONDAKİ primipar inek için KMT laktasyon denkleminden (calcDMI)
 * gelir; bu fonksiyon henüz buzağılamamış büyüyen düveler içindir.
 *
 * @param {number} bw - Canlı ağırlık (kg)
 * @returns {number} KMT (kg/gün)
 */
export function dmiHeifer(bw) {
  if (!Number.isFinite(bw) || bw <= 0) return 0;
  let pct;
  if (bw < 200)      pct = 0.027;
  else if (bw < 350) pct = 0.025;
  else if (bw < 500) pct = 0.023;
  else               pct = 0.021;
  return Math.round(bw * pct * 100) / 100;
}

/**
 * de Souza et al. 2019 güncellenmiş KMT denklemi (NASEM 2021'de tercih edilen)
 * Kaynak: de Souza et al. (2019) Journal of Dairy Science, 102(9), 7948–7960
 * @param {object} animal
 *   @param {number} animal.milkYield     - Süt verimi (kg/gün)
 *   @param {number} animal.milkFat       - Süt yağı (%)
 *   @param {number} animal.milkProtein   - Süt proteini (%)
 *   @param {number} animal.bw            - Canlı ağırlık (kg)
 *   @param {number} animal.bcs           - Vücut kondisyon skoru (1-5)
 *   @param {number} animal.dim           - Laktasyondaki gün
 *   @param {number} animal.parity        - Laktasyon numarası
 * @returns {number} KMT (kg/gün)
 */
export function dmiDeSouza2019(animal) {
  const { milkYield, milkFat, milkProtein, bw, bcs, dim, parity } = animal;

  // parity flag: 0 = 1. laktasyon, 1 = ≥2. laktasyon
  const p = parity >= 2 ? 1 : 0;

  // Sütün enerji içeriği (Mcal/gün)
  const nelMilkConc = 0.0929 * milkFat + 0.0547 * milkProtein + 0.192;
  const milkE = milkYield * nelMilkConc;

  const base = (3.7 + p * 5.7) + 0.305 * milkE + 0.022 * bw + (-0.689 + p * (-1.87)) * bcs;
  const dimAdj = 1 - (0.212 + p * 0.136) * Math.exp(-0.053 * dim);

  return base * dimAdj;
}

/**
 * Isı stresinde KMT düzeltmesi (NRC 2001 THI bazlı)
 * THI ≤ 72: düzeltme yok; THI > 72: her birim için ~0.4 kg azalma
 * @param {number} dmi  - Hesaplanan KMT (kg/gün)
 * @param {number} thi  - Isı-nem indeksi
 * @returns {number} Düzeltilmiş KMT (kg/gün)
 */
export function dmiHeatStressAdjust(dmi, thi) {
  if (thi <= 72) return dmi;
  const reduction = 0.4 * (thi - 72);
  return Math.max(dmi - reduction, dmi * 0.5); // En fazla %50 azalma
}

/**
 * FAZ 18.2: Rasyon doluluk (NDF fill) sınırına göre KMT düzeltmesi.
 *
 * Hayvan-bazlı KMT (calcDMI) rasyonun NDF içeriğine DUYARSIZDIR; ama yüksek-NDF
 * rasyonlar rumeni fiziksel doldurarak tüketimi sınırlar (Mertens 1987; NRC 2001
 * Böl. 1). İnek günde en fazla ~`ndfCapacityPct`% canlı ağırlık kadar NDF tüketebilir
 * → fill-sınırlı KMT = NDF_kapasitesi / (rasyon NDF fraksiyonu). Gerçek KMT =
 * min(hayvan-bazlı KMT, fill-sınırlı KMT).
 *
 * Düşük/orta-NDF rasyonlarda fill BAĞLAMAZ (hayvan-bazlı KMT döner); yüksek-NDF
 * (kötü kaba yem) rasyonlarda KMT düşer → enerji açığı görünür hale gelir.
 *
 * NOT: Birinci-derece (Mertens) yaklaşım; forage/concentrate NDF doluluk farkı
 * (peNDF / INRA UEL) ve tam iteratif yakınsama FAZ 19.1 hedefidir.
 *
 * @param {number} dmi           - Hayvan-bazlı KMT (kg/gün)
 * @param {number} rationNDF_pct - Rasyon NDF konsantrasyonu (% KM)
 * @param {number} bw            - Canlı ağırlık (kg)
 * @param {object} [options]
 *   @param {number} [options.ndfCapacityPct=1.35] - Maks NDF tüketimi (% CA; laktasyon fill limiti
 *     ~1.25–1.4, Mertens 1987 / NRC 2001 aralığı). 1.35 default: yalnız GENUINE yüksek-NDF
 *     (>~%40) rasyonlarda bağlar; tipik %30-38 rasyonları (formülasyon hedefi) etkilemez.
 * @returns {number} Doluluk-düzeltmeli KMT (kg/gün) — dmi'den büyük olmaz
 */
export function adjustDMIForFill(dmi, rationNDF_pct, bw, options = {}) {
  const ndfCapacityPct = Number.isFinite(options.ndfCapacityPct) ? options.ndfCapacityPct : 1.35;
  if (!Number.isFinite(dmi) || dmi <= 0) return dmi;
  if (!Number.isFinite(rationNDF_pct) || rationNDF_pct <= 0) return dmi;   // NDF bilinmiyor → düzeltme yok
  if (!Number.isFinite(bw) || bw <= 0) return dmi;
  const ndfCapacity_kg = bw * (ndfCapacityPct / 100);            // maks NDF tüketimi (kg/gün)
  const fillLimitedDMI = ndfCapacity_kg / (rationNDF_pct / 100); // kg KM/gün
  return Math.min(dmi, fillLimitedDMI);
}

/**
 * Kuru dönem inek KMT tahmini
 * NRC 2001 Eq. 1-3
 * @param {number} bw         - Canlı ağırlık (kg)
 * @param {number} daysToCalv - Doğuma kalan gün
 * @returns {number} KMT (kg/gün)
 */
export function dmiDryCow(bw, daysToCalv) {
  if (daysToCalv > 21) {
    // Far-off dry
    return 0.0185 * bw;
  } else {
    // Close-up (son 3 hafta) - iştah baskılanması
    return 0.0185 * bw * (1 - 0.05 * (21 - daysToCalv) / 21);
  }
}

/**
 * Ana KMT hesaplama fonksiyonu
 * Hayvan durumuna göre uygun denklemi seçer
 * @param {object} animal - Hayvan profili
 * @param {string} method - 'NRC2001' | 'deSouza2019' (varsayılan: 'NRC2001')
 * @returns {object} { dmi, method, heatAdjusted }
 */
export function calcDMI(animal, method = 'NRC2001') {
  const { milkYield, milkFat, milkProtein, bw, dim, thi } = animal;

  let dmi;
  const wol = dim / 7;
  const fcm = calcFCM(milkYield, milkFat);
  const ecm = calcECM(milkYield, milkFat, milkProtein || 3.1);

  if (method === 'deSouza2019') {
    dmi = dmiDeSouza2019(animal);
  } else {
    dmi = dmiNRC2001(fcm, bw, wol);
  }

  const heatAdjusted = thi > 72;
  if (heatAdjusted) {
    dmi = dmiHeatStressAdjust(dmi, thi);
  }

  return {
    dmi: Math.round(dmi * 100) / 100,
    fcm: Math.round(fcm * 100) / 100,
    ecm: Math.round(ecm * 100) / 100,
    method,
    heatAdjusted,
    thi,
  };
}
