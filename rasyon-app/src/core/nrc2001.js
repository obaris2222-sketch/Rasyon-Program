/**
 * NRC 2001 Enerji ve Protein Hesaplama Modülü
 * Kaynak: NRC (2001) Nutrient Requirements of Dairy Cattle, 7th Ed.
 * Bölüm 2 (Enerji) ve Bölüm 3 (Protein)
 */

import { adjustNELMaintenanceForHeat } from './heatStress.js';
import {
  MCP_INTESTINAL_DIGESTIBILITY,
  RDP_TO_MCP_EFFICIENCY,
  TDN_TO_MCP_G_PER_KG,
} from './constants.js';

// ─── ENERJİ (NEL SİSTEMİ) ──────────────────────────────────────────────────

/**
 * Sütün NEL içeriği hesabı
 * NRC 2001 Eq. 2-2
 * @param {number} fat      - Süt yağı (%)
 * @param {number} protein  - Süt proteini (%)
 * @param {number} lactose  - Süt laktozu (%) - null ise sabit kullanılır
 * @returns {number} NEL (Mcal/kg süt)
 */
export function nelMilkContent(fat, protein, lactose = null) {
  if (lactose !== null) {
    return 0.0929 * fat + 0.0547 * protein + 0.0395 * lactose;
  }
  // Laktoz bilinmiyorsa NRC 2001 sabit katsayı
  return 0.0929 * fat + 0.0547 * protein + 0.192;
}

/**
 * NEL İdame Gereksinimi
 * NRC 2001: 0.08 × BW^0.75
 * @param {number} bw - Canlı ağırlık (kg)
 * @returns {number} NEL_idame (Mcal/gün)
 */
export function nelMaintenance(bw) {
  return 0.08 * Math.pow(bw, 0.75);
}

/**
 * FAZ 24.3: Yem-Spesifik Tüketim İskontosu (NRC 2001 Bölüm 1)
 *
 * Yemin TDN/NEL sindirilebilirliği, tüketim idamenin katı arttıkça DÜŞER.
 * NRC 2001'e göre her yem için % TDN düşüşü = 0.18 * TDN_1X - 10.3 formülüyle bulunur.
 * Yüksek TDN'li konsantrelerde iskonto düşük, yüksek lifli kaba yemlerde yüksektir.
 */

/**
 * Tüketimin idameye oranını (katı) hesaplar.
 * @param {number} dmi_kg - Toplam KMT (kg/gün)
 * @param {number} bw     - Canlı ağırlık (kg)
 * @returns {number} İdame katı (multiple)
 */
export function getIntakeMultiple(dmi_kg, bw) {
  if (!Number.isFinite(dmi_kg) || !Number.isFinite(bw) || bw <= 0 || dmi_kg <= 0) return 1;
  const maintenanceDMI = bw * 0.013;        // ~idame KMT (kg/gün)
  return dmi_kg / maintenanceDMI;
}

/**
 * Spesifik bir yem için enerji iskonto çarpanını hesaplar.
 * @param {object} feed     - Yem nesnesi (tdn alanına sahip olmalı)
 * @param {number} multiple - İdame katı (getIntakeMultiple sonucu)
 * @param {object} [options]
 *   @param {number} [options.maxDiscount=0.15] - iskonto üst sınırı (aşırılık önleme)
 * @returns {number} enerji çarpanı ∈ (0,1] — 1 = iskonto yok, <1 = iskontolu
 */
export function feedIntakeDiscountFactor(feed, multiple, options = {}) {
  if (multiple <= 1 || !feed) return 1;
  
  const tdn1x = Number(feed.tdn);
  if (!Number.isFinite(tdn1x) || tdn1x <= 0) return 1;

  // NRC 2001 Eq 1-2: Decline in TDN (% units) per multiple of maintenance above 1X
  const declineUnits = Math.max(0, 0.18 * tdn1x - 10.3);
  const ratePerMultiple = declineUnits / tdn1x;
  
  const maxDiscount = Number.isFinite(options.maxDiscount) ? options.maxDiscount : 0.15;
  const discount = Math.min(maxDiscount, ratePerMultiple * (multiple - 1));
  
  return 1 - discount;
}

/**
 * NEL Laktasyon Gereksinimi
 * NRC 2001 Eq. 2-1
 * @param {number} milkYield  - Süt verimi (kg/gün)
 * @param {number} nelMilk    - Sütün NEL içeriği (Mcal/kg)
 * @returns {number} NEL_laktasyon (Mcal/gün)
 */
export function nelLactation(milkYield, nelMilk) {
  return milkYield * nelMilk;
}

/**
 * NEL Gebelik Gereksinimi
 * NRC 2001 Eq. 2-5 (Ferrell & Reynolds, 1992 temelli)
 * Yalnızca gestDays ≥ 190 günden itibaren anlamlı
 * @param {number} gestDays   - Gebelik günü
 * @param {number} calfBW     - Beklenen buzağı ağırlığı (kg, varsayılan 45)
 * @returns {number} NEL_gebelik (Mcal/gün)
 */
export function nelPregnancy(gestDays, calfBW = 45) {
  if (gestDays < 190) return 0;
  const cb = calfBW;
  return ((0.00318 * gestDays - 0.0352) * (cb / 45)) / 0.218;
}

/**
 * NEL Aktivite Gereksinimi (serbest ahır)
 * NRC 2001: 0.00045 × BW × km/gün
 * @param {number} bw           - Canlı ağırlık (kg)
 * @param {number} dailyWalkKm  - Günlük yürüyüş (km)
 * @returns {number} NEL_aktivite (Mcal/gün)
 */
export function nelActivity(bw, dailyWalkKm = 0) {
  return 0.00045 * bw * dailyWalkKm;
}

/**
 * BCS mobilizasyonundan NEL katkısı — NRC 2001 modu
 * BCS düşüşü (negatif enerji dengesi) idame ihtiyacını karşılar
 * NRC 2001: Her 1 BCS birimi ≈ 62.56 Mcal NEL değerinde
 *
 * FAZ 13.6: Bu fonksiyon NRC 2001 modunda kullanılır (geri uyumluluk).
 * NASEM 2021 modunda `nasem2021.nelBcsMobilizationNASEM` (84 Mcal/BCS) çağrılır
 * — pipeline default NASEM 2021 olduğundan tipik kullanımda 84 geçerlidir.
 * @param {number} currentBcs - Mevcut BCS
 * @param {number} targetBcs  - Hedef BCS
 * @returns {number} Günlük mobilizasyon katkısı (Mcal/gün) - negatif = kayıp
 */
export function nelBcsMobilization(currentBcs, targetBcs) {
  // BCS verilmemişse mobilizasyon yok varsay
  if (!Number.isFinite(currentBcs) || !Number.isFinite(targetBcs)) return 0;
  const bcsDiff = currentBcs - targetBcs;
  if (Math.abs(bcsDiff) < 0.01) return 0;
  // 305 günlük laktasyonda BCS değişimi varsayımı ile günlük hız
  const dailyRate = bcsDiff / 305;
  // Her 1 BCS birimi = 62.56 Mcal NEL (NRC 2001; NASEM 2021 = 84)
  return dailyRate * 62.56;
}

/**
 * Toplam NEL Gereksinimi
 * @param {object} animal - Hayvan profili
 * @returns {object} NEL gereksinim bileşenleri (Mcal/gün)
 */
export function calcNELRequirements(animal) {
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
  let maintenance = nelMaintenance(bw);

  // Isı stresi düzeltmesi — idame enerjisi %5-20 artar (West et al. 2003)
  const heatAdjusted = Number.isFinite(thi) && thi > 72;
  if (heatAdjusted) {
    maintenance = adjustNELMaintenanceForHeat(maintenance, thi);
  }

  const lactation = nelLactation(milkYield, nelMilk);
  const pregnancy = pregnant ? nelPregnancy(effectiveGestDays) : 0;
  const activity = nelActivity(bw, dailyWalkKm || 0);
  const mobilization = nelBcsMobilization(bcs, targetBcs || bcs);

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
    // C3: targetBcs girilmemişse ve erken laktasyondaysa mobilizasyon modellenemiyor uyarısı.
    // Early laktasyonda inekler daima vücut rezervi mobilize eder (NEB beklenir);
    // targetBcs olmadan bu katkı hesaba katılmaz → enerji gereksinimi olduğundan yüksek görünebilir.
    mobilizationWarning: !Number.isFinite(targetBcs) && ['early', 'mid'].includes(lactationStage),
  };
}

// ─── BÜYÜME (PRİMİPAR / DÜVE) — NRC 2001 Bölüm 11 ─────────────────────────

/**
 * Büyüme için net enerji (retained energy) — NRC 2001 Bölüm 11
 *
 * 1. laktasyon (primipar) ineği henüz olgun ağırlığına ulaşmamıştır
 * (~%82-85'i), bu nedenle idame + laktasyona ek büyüme enerjisi gerekir.
 * Laktasyon rasyonunda NEL ≈ NEg eşdeğeri kabul edilir (k_g ≈ k_l).
 *
 * NRC 2001 denklemleri:
 *   SBW   = 0.96 × BW                    (shrunk body weight)
 *   EQSBW = SBW × (478 / matureBW)       (478 = standart referans ağırlık)
 *   EQEBW = 0.891 × EQSBW                (equivalent empty body weight)
 *   EBG   = 0.956 × ADG                  (empty body gain)
 *   RE    = 0.0635 × EQEBW^0.75 × EBG^1.097   (Mcal/gün)
 *
 * @param {number} bw        - Canlı ağırlık (kg)
 * @param {number} adg_kg    - Hedef günlük canlı ağırlık artışı (kg/gün)
 * @param {number} matureBW  - Olgun ağırlık (kg, varsayılan 680 — Holstein)
 * @returns {number} Büyüme NEL gereksinimi (Mcal/gün); adg ≤ 0 ise 0
 */
export function nelGrowth(bw, adg_kg, matureBW = 680) {
  if (!Number.isFinite(bw) || !Number.isFinite(adg_kg) || adg_kg <= 0) return 0;
  const mw = Number.isFinite(matureBW) && matureBW > 0 ? matureBW : 680;
  const sbw = 0.96 * bw;
  const eqsbw = sbw * (478 / mw);
  const eqebw = 0.891 * eqsbw;
  const ebg = 0.956 * adg_kg;
  const re = 0.0635 * Math.pow(eqebw, 0.75) * Math.pow(ebg, 1.097);
  return Math.round(re * 100) / 100;
}

/**
 * Büyüme için metabolize edilebilir protein — NRC 2001 Bölüm 11
 *
 * Net protein for gain (NPg) ve MP'ye dönüşüm:
 *   NPg (g/gün) = ADG × (268 − 29.4 × (RE / ADG))
 *   MP_growth   = NPg / 0.492   (büyüme MP verimliliği)
 *
 * @param {number} adg_kg - Hedef günlük canlı ağırlık artışı (kg/gün)
 * @param {number} re     - Büyüme net enerjisi (Mcal/gün, nelGrowth çıktısı)
 * @returns {number} Büyüme MP gereksinimi (g/gün); adg ≤ 0 ise 0
 */
export function mpGrowth(adg_kg, re) {
  if (!Number.isFinite(adg_kg) || adg_kg <= 0 || !Number.isFinite(re) || re <= 0) return 0;
  const npg = adg_kg * (268 - 29.4 * (re / adg_kg));
  const mp = npg / 0.492;
  return Math.max(0, Math.round(mp));
}

// ─── PROTEİN (MP SİSTEMİ) ──────────────────────────────────────────────────

/**
 * Metabolize Edilebilir Protein İdame Gereksinimi
 * NRC 2001 Eq. 3-1
 * @param {number} bw - Canlı ağırlık (kg)
 * @returns {number} MP_idame (g/gün)
 */
export function mpMaintenance(bw) {
  return 3.8 * Math.pow(bw, 0.75);
}

/**
 * Metabolize Edilebilir Protein Laktasyon Gereksinimi
 * NRC 2001: MY × Protein% / 0.67
 * @param {number} milkYield    - Süt verimi (kg/gün)
 * @param {number} milkProtein  - Süt proteini (%)
 * @returns {number} MP_laktasyon (g/gün)
 */
export function mpLactation(milkYield, milkProtein) {
  return (milkYield * milkProtein * 10) / 0.67;
}

/**
 * Metabolize Edilebilir Protein Gebelik Gereksinimi
 * NRC 2001 Eq. 3-8
 *
 * Formül: MP_preg = (0.69 × gestDays − 69.2) × (calfBW / 45) / 0.33
 *
 * (0.69 × t − 69.2): konseptustaki günlük ham protein (g CP/gün) birikimi.
 *   Bu değer zaten g CP/gün cinsinden çıkar — g N DEĞİL.
 *   Bu nedenle 6.25 ile BÖLMEK YANLIŞTIR (protein→azot dönüşümü yapar).
 *   /6.25 olsaydı sonuç ~6.25× eksik hesaplanırdı.
 * 0.33: MP'nin gebelik için kullanım verimliliği (NRC 2001 Tablo 3-2).
 *
 * Doğrulama: Day 250, calfBW=45 → (172.5−69.2)/0.33 ≈ 313 g/gün MP
 *   (Kaynak: NRC 2001 Eq. 3-8; web örneği 313 g/gün sonucunu doğrular)
 *
 * @param {number} gestDays - Gebelik günü (190–279 arası anlamlı)
 * @param {number} calfBW   - Beklenen buzağı ağırlığı (kg, varsayılan 45)
 * @returns {number} MP_gebelik (g/gün)
 */
export function mpPregnancy(gestDays, calfBW = 45) {
  if (gestDays < 190) return 0;
  // Düzeltme: /6.25 kaldırıldı — (0.69t−69.2) zaten g CP/gün cinsinden.
  // Eski kod 6.25× eksik tahmin ediyordu (gebe ineklerde ciddi protein açığı).
  const up = (0.69 * gestDays - 69.2) * (calfBW / 45) / 0.33;
  return Math.max(up, 0);
}

/**
 * Mikrobiyal Ham Protein (MCP) sentezi tahmini
 * NRC 2001: MCP sınırlayıcı faktör (enerji veya RDP)
 * @param {number} tdn_kg   - Günlük TDN alımı (kg/gün)
 * @param {number} rdp_g    - Günlük RDP tedariki (g/gün)
 * @returns {object} { mcpEnergy, mcpRdp, mcp, limitingFactor }
 */
export function calcMCP(tdn_kg, rdp_g) {
  const mcpEnergy = tdn_kg * TDN_TO_MCP_G_PER_KG;   // 130 g MCP/kg TDN
  const mcpRdp = rdp_g * RDP_TO_MCP_EFFICIENCY;     // RDP N verimi %85
  const mcp = Math.min(mcpEnergy, mcpRdp);
  return {
    mcpEnergy: Math.round(mcpEnergy),
    mcpRdp: Math.round(mcpRdp),
    mcp: Math.round(mcp),
    limitingFactor: mcpEnergy <= mcpRdp ? 'energy' : 'rdp',
  };
}

/**
 * Toplam MP Tedariki hesabı
 * FAZ 13.2: MCP intestinal sindirilebilirlik 0.80 → 0.64 (CNCPS v6.5 + NASEM 2021)
 * @param {number} mcp      - Mikrobiyal CP sentezi (g/gün)
 * @param {number} rup_g    - Günlük RUP tedariki (g/gün)
 * @param {number} rupIntD  - RUP intestinal sindirilebilirlik (%, varsayılan 80)
 * @returns {object} { mpMicrobial, mpRUP, mpTotal }
 */
export function calcMPSupply(mcp, rup_g, rupIntD = 80) {
  const mpMicrobial = mcp * MCP_INTESTINAL_DIGESTIBILITY;
  const mpRUP = rup_g * (rupIntD / 100);
  return {
    mpMicrobial: Math.round(mpMicrobial),
    mpRUP: Math.round(mpRUP),
    mpTotal: Math.round(mpMicrobial + mpRUP),
  };
}

/**
 * Toplam MP Gereksinimleri
 * @param {object} animal - Hayvan profili
 * @returns {object} MP gereksinim bileşenleri (g/gün)
 */
export function calcMPRequirements(animal) {
  const { bw, milkYield, milkProtein, pregnant, gestDays, pregnancyMonth } = animal;

  // Gebelik günü: UI'da ay olarak girilir, gestDays yoksa aydan türet
  const effectiveGestDays = Number.isFinite(gestDays)
    ? gestDays
    : (Number.isFinite(pregnancyMonth) ? pregnancyMonth * 30 : 0);

  const maintenance = mpMaintenance(bw);
  const lactation = mpLactation(milkYield, milkProtein);
  const pregnancy = pregnant ? mpPregnancy(effectiveGestDays) : 0;
  const total = maintenance + lactation + pregnancy;

  return {
    maintenance: Math.round(maintenance),
    lactation: Math.round(lactation),
    pregnancy: Math.round(pregnancy),
    total: Math.round(total),
  };
}

// ─── ANA HESAPLAMA ──────────────────────────────────────────────────────────

/**
 * NRC 2001 tam hesaplama çıktısı
 * @param {object} animal - Hayvan profili
 * @returns {object} Tüm NRC 2001 gereksinimleri
 */
export function calcNRC2001(animal) {
  return {
    nel: calcNELRequirements(animal),
    mp: calcMPRequirements(animal),
  };
}
