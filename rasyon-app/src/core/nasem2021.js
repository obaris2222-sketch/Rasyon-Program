/**
 * NASEM 2021 Güncellemeleri Modülü
 * NRC 2001 üzerine NASEM 2021 (8. Baskı) değişiklikleri
 * Kaynak: NASEM (2021) Nutrient Requirements of Dairy Cattle, 8th Rev. Ed.
 *
 * Kritik değişiklikler:
 *   1. İdame NEL katsayısı: 0.08 → 0.10 × BW^0.75 (+%25)
 *   2. Laktasyon NEL verimliliği: 0.64 → 0.66
 *   3. Gebelik enerji modeli güncellendi (fetal büyüme, 0.00274 katsayı)
 *   4. BCS mobilizasyon: 62.56 → 84 Mcal/BCS birim
 *   5. MP idame: 3.8 → 4.1 × BW^0.75
 *   6. Kolin gereksinimleri eklendi (geçiş dönemi)
 *
 * FAZ 13.1: pipeline'a tam bağlama — calcNELRequirementsNASEM ve
 * calcMPRequirementsNASEM artık nrc2001.js'in tam paritesine sahiptir
 * (heatStress, pregnancyMonth fallback dahil).
 */

import { nelMilkContent, nelLactation, nelActivity, mpLactation, mpPregnancy } from './nrc2001.js';
import { adjustNELMaintenanceForHeat } from './heatStress.js';

// ─── NASEM 2021 ENERJİ GEREKSİNİMLERİ ───────────────────────────────────────

/**
 * NEL İdame Gereksinimi — NASEM 2021
 * Değişiklik: 0.10 × BW^0.75 (NRC 2001'de 0.08 idi, +%25 artış)
 * @param {number} bw - Canlı ağırlık (kg)
 * @returns {number} NEL_idame (Mcal/gün)
 */
export function nelMaintenanceNASEM(bw) {
  return 0.10 * Math.pow(bw, 0.75);
}

/**
 * NEL Gebelik Gereksinimi — NASEM 2021 güncellenmiş fetal büyüme modeli
 * Değişiklik: katsayı 0.00318 → 0.00274 (Van Amburgh et al. 2021)
 * @param {number} gestDays - Gebelik günü
 * @param {number} calfBW   - Beklenen buzağı ağırlığı (kg)
 * @returns {number} NEL_gebelik (Mcal/gün)
 */
export function nelPregnancyNASEM(gestDays, calfBW = 45) {
  if (gestDays < 190) return 0;
  // NASEM 2021 güncellenmiş katsayılar (Van Amburgh et al. 2021)
  const cb = calfBW;
  const energy = ((0.00274 * gestDays - 0.0142) * (cb / 45)) / 0.218;
  return Math.max(energy, 0);
}

/**
 * Toplam NEL Gereksinimleri — NASEM 2021
 * FAZ 13.1: pregnancyMonth fallback + heatStress entegre (nrc2001.js paritesi)
 * @param {object} animal - Hayvan profili
 * @returns {object} NEL gereksinim bileşenleri
 */
export function calcNELRequirementsNASEM(animal) {
  const {
    bw, milkYield, milkFat, milkProtein, milkLactose,
    pregnant, gestDays, pregnancyMonth, dailyWalkKm, bcs, targetBcs,
    thi, lactationStage,
  } = animal;

  // Gebelik günü: UI'da ay olarak girilir, gestDays yoksa aydan türet
  const effectiveGestDays = Number.isFinite(gestDays)
    ? gestDays
    : (Number.isFinite(pregnancyMonth) ? pregnancyMonth * 30 : 0);

  const nelMilk = nelMilkContent(milkFat, milkProtein, milkLactose);
  let maintenance = nelMaintenanceNASEM(bw);

  // Isı stresi düzeltmesi — idame enerjisi %5-20 artar (West et al. 2003)
  const heatAdjusted = Number.isFinite(thi) && thi > 72;
  if (heatAdjusted) {
    maintenance = adjustNELMaintenanceForHeat(maintenance, thi);
  }

  const lactation = nelLactation(milkYield, nelMilk);
  const pregnancy = pregnant ? nelPregnancyNASEM(effectiveGestDays) : 0;
  const activity = nelActivity(bw, dailyWalkKm || 0);
  const mobilization = nelBcsMobilizationNASEM(bcs, targetBcs || bcs);

  const total = maintenance + lactation + pregnancy + activity - mobilization;

  return {
    nelMilkConc: Math.round(nelMilk * 1000) / 1000,
    maintenance: Math.round(maintenance * 100) / 100,
    lactation: Math.round(lactation * 100) / 100,
    pregnancy: Math.round(pregnancy * 100) / 100,
    activity: Math.round(activity * 100) / 100,
    mobilization: Math.round(mobilization * 100) / 100,
    total: Math.round(total * 100) / 100,
    heatAdjusted,
    source: 'NASEM2021',
    // C3: targetBcs girilmemişse mobilizasyon modellenemiyor (NRC ile aynı flag)
    mobilizationWarning: !Number.isFinite(targetBcs) && ['early', 'mid'].includes(lactationStage),
  };
}

// ─── NRC 2001 vs NASEM 2021 KARŞILAŞTIRMA ───────────────────────────────────

/**
 * İki sistem arasındaki farkı hesapla
 * @param {object} nrc2001Result  - calcNELRequirements() çıktısı
 * @param {object} nasem2021Result - calcNELRequirementsNASEM() çıktısı
 * @returns {object} Fark raporu
 */
export function compareNRCvsNASEM(nrc2001Result, nasem2021Result) {
  const maintDiff = nasem2021Result.maintenance - nrc2001Result.maintenance;
  const totalDiff = nasem2021Result.total - nrc2001Result.total;
  const maintPct = (maintDiff / nrc2001Result.maintenance) * 100;

  return {
    maintenanceDiff: Math.round(maintDiff * 100) / 100,
    maintenancePctChange: Math.round(maintPct * 10) / 10,
    totalDiff: Math.round(totalDiff * 100) / 100,
    totalPctChange: Math.round((totalDiff / nrc2001Result.total) * 100 * 10) / 10,
    note: 'NASEM 2021 idame gereksinimi NRC 2001\'den ~%25 yüksektir',
  };
}

// ─── NASEM 2021 PROTEİN GÜNCELLEMELERİ ──────────────────────────────────────

/**
 * MP İdame Gereksinimi — NASEM 2021 güncellenmiş
 * NRC 2001'de 3.8 × BW^0.75 idi
 * NASEM 2021: metabolik kayıplar yeniden değerlendirildi
 * @param {number} bw - Canlı ağırlık (kg)
 * @returns {number} MP_idame (g/gün)
 */
export function mpMaintenanceNASEM(bw) {
  // Endogenous urinary: 2.75 × BW^0.75
  // Endogenous fecal: 1.9 × DMI (g/kg DMI) - ağırlıklı 0.4 × BW^0.75 yaklaşımı
  // Toplam: ~4.1 × BW^0.75 (NASEM 2021 Tablo 3-1)
  return 4.1 * Math.pow(bw, 0.75);
}

/**
 * Metabolize edilebilir protein laktasyon verimliliği (NASEM 2021)
 * NRC 2001'de 0.67 idi (NASEM 2021 ile aynı korunmuş)
 * @param {number} milkYield    - Süt verimi (kg/gün)
 * @param {number} milkProtein  - Süt proteini (%)
 * @returns {number} MP_laktasyon (g/gün)
 */
export function mpLactationNASEM(milkYield, milkProtein) {
  // Süt protein verimliliği: 0.67 (NRC 2001 ile aynı)
  return (milkYield * milkProtein * 10) / 0.67;
}

/**
 * Toplam MP Gereksinimleri — NASEM 2021
 * FAZ 13.1: nrc2001.js calcMPRequirements paritesi (pregnancyMonth fallback dahil)
 * NASEM 2021 değişiklikleri: idame 4.1 × BW^0.75 (NRC 3.8 idi)
 * Gebelik MP formülü NASEM 2021'de NRC ile aynı korunmuş.
 * @param {object} animal - Hayvan profili
 * @returns {object} MP gereksinim bileşenleri (g/gün)
 */
export function calcMPRequirementsNASEM(animal) {
  const { bw, milkYield, milkProtein, pregnant, gestDays, pregnancyMonth } = animal;

  const effectiveGestDays = Number.isFinite(gestDays)
    ? gestDays
    : (Number.isFinite(pregnancyMonth) ? pregnancyMonth * 30 : 0);

  const maintenance = mpMaintenanceNASEM(bw);
  const lactation = mpLactationNASEM(milkYield, milkProtein);
  // Gebelik MP: NASEM 2021, NRC 2001 Eq. 3-8 formülünü (kalfBW/45 ölçeklenmesi dahil) aynen kullanır.
  // Doğru formül: (0.69×t − 69.2) × (CBW/45) / 0.33  [g CP/gün]
  // NOT: Buradaki mpPregnancy, nrc2001.js'teki düzeltilmiş versiyondur (artık /6.25 yok).
  const pregnancy = pregnant ? mpPregnancy(effectiveGestDays) : 0;
  const total = maintenance + lactation + pregnancy;

  return {
    maintenance: Math.round(maintenance),
    lactation: Math.round(lactation),
    pregnancy: Math.round(pregnancy),
    total: Math.round(total),
    source: 'NASEM2021',
  };
}

// ─── BCS MOBİLİZASYON (NASEM 2021) ──────────────────────────────────────────

/**
 * BCS kaybından enerji katkısı — NASEM 2021 güncellenmiş değerler
 * NASEM 2021: 1 BCS birimi = 84 Mcal NEL (NRC 2001'de ~62.56 idi)
 * @param {number} currentBcs  - Mevcut BCS
 * @param {number} targetBcs   - Hedef BCS (laktasyon sonu)
 * @returns {number} Günlük mobilizasyon katkısı (Mcal/gün)
 */
export function nelBcsMobilizationNASEM(currentBcs, targetBcs) {
  if (!Number.isFinite(currentBcs) || !Number.isFinite(targetBcs)) return 0;
  const bcsDiff = currentBcs - targetBcs;
  if (Math.abs(bcsDiff) < 0.01) return 0;
  const dailyRate = bcsDiff / 305;
  return dailyRate * 84; // NASEM 2021: 84 Mcal/BCS birimi
}

// ─── NASEM 2021 TAM HESAPLAMA ────────────────────────────────────────────────

/**
 * NASEM 2021 tam hesaplama çıktısı (NEL + MP)
 * @param {object} animal - Hayvan profili
 * @returns {object} Tüm NASEM 2021 gereksinimleri
 */
export function calcNASEM2021(animal) {
  const nel = calcNELRequirementsNASEM(animal);
  const mp = calcMPRequirementsNASEM(animal);
  return { nel, mp, source: 'NASEM2021' };
}
