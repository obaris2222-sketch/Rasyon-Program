/**
 * Ekonomik Analiz Modülü
 *
 * Süt sığırı rasyonunun finansal performansını hesaplar:
 *   - IOFC (Income Over Feed Cost / Yem Üzerinden Gelir)
 *   - Yem maliyeti per litre süt
 *   - Yem verimliliği (FE = ECM/DMI — NASEM 2021 tercihi)
 *     Geriye uyumluluk için ham süt/DMI (rawFE) da hesaplanır
 *   - Yıllık gelir tahmini
 *   - Sürü-ölçekli yansıma
 *
 * Kaynaklar: Hutjens (2010); St-Pierre & Jones (2015), NASEM (2021) — IOFC + ECM tabanlı değerlendirme
 */

import { calcECM } from './dmi.js';

/**
 * Ekonomik analiz yap.
 *
 * @param {object} input
 *   @param {number} input.milkYield_kg     — Süt verimi (kg/gün)
 *   @param {number} input.milkPrice_tl     — Süt fiyatı (₺/litre, ~₺/kg)
 *   @param {number} input.feedCost_tl_day  — Günlük yem maliyeti (₺/gün)
 *   @param {number} input.dmi_kg           — Kuru madde tüketimi (kg/gün)
 *   @param {number} [input.lactationDays=305]  — Yıllık laktasyon günü
 *   @param {number} [input.herdSize=1]     — Sürü hayvan sayısı
 *   @param {number} [input.dryCowCost_tl_day=0]  — Kuru dönem maliyet düzeltmesi
 *
 * @returns {object} Ekonomik analiz sonucu
 */
export function calcEconomics(input) {
  const {
    milkYield_kg,
    milkPrice_tl,
    feedCost_tl_day,
    dmi_kg,
    milkFat_pct,        // FAZ 9: ECM hesabı için opsiyonel
    milkProtein_pct,    // FAZ 9: ECM hesabı için opsiyonel
    lactationDays = 305,
    herdSize = 1,
    dryCowCost_tl_day = 0,
  } = input;

  // Temel günlük metrikler
  const dailyRevenue_tl   = milkYield_kg * milkPrice_tl;
  const dailyIOFC_tl      = dailyRevenue_tl - feedCost_tl_day;

  // ECM (Enerjice Düzeltilmiş Süt) — NASEM 2021 tercihi
  // Yağ ve protein verilmemişse standart değerlerle hesapla (3.5%/3.1%)
  const fatPct  = Number.isFinite(milkFat_pct) ? milkFat_pct : 3.5;
  const protPct = Number.isFinite(milkProtein_pct) ? milkProtein_pct : 3.1;
  const ecm_kg  = calcECM(milkYield_kg, fatPct, protPct);

  // Verimlilik metrikleri
  const feedCostPerLiter_tl = milkYield_kg > 0
    ? feedCost_tl_day / milkYield_kg
    : 0;
  // FAZ 9: Birincil yem verimliliği artık ECM/DMI (NASEM 2021)
  const feedEfficiency      = dmi_kg > 0
    ? ecm_kg / dmi_kg                 // ECM kg / KMT kg — modern standart
    : 0;
  // Geriye uyumluluk için ham süt-bazlı (eski hesap)
  const rawFeedEfficiency   = dmi_kg > 0
    ? milkYield_kg / dmi_kg
    : 0;
  const revenuePerKgFeed_tl = dmi_kg > 0
    ? dailyRevenue_tl / dmi_kg
    : 0;

  // Yıllık projeksiyon (305 gün laktasyon + 60 gün kuru tipik)
  const annualMilkRevenue_tl  = dailyRevenue_tl * lactationDays;
  const annualFeedCost_tl     = feedCost_tl_day * lactationDays + dryCowCost_tl_day * 60;
  const annualIOFC_tl         = annualMilkRevenue_tl - annualFeedCost_tl;

  // Sürü ölçeği
  const herdDailyIOFC_tl  = dailyIOFC_tl * herdSize;
  const herdAnnualIOFC_tl = annualIOFC_tl * herdSize;

  // Yorum
  const status = interpretIOFC(dailyIOFC_tl, milkYield_kg);

  return {
    daily: {
      milkYield_kg:       round(milkYield_kg, 1),
      ecm_kg:             round(ecm_kg, 2),               // FAZ 9
      revenue_tl:         round(dailyRevenue_tl, 2),
      feedCost_tl:        round(feedCost_tl_day, 2),
      iofc_tl:            round(dailyIOFC_tl, 2),
      feedCostPerLiter_tl: round(feedCostPerLiter_tl, 3),
      feedEfficiency:     round(feedEfficiency, 2),        // FAZ 9: artık ECM/DMI
      rawFeedEfficiency:  round(rawFeedEfficiency, 2),     // FAZ 9: geriye uyumluluk
      revenuePerKgFeed_tl: round(revenuePerKgFeed_tl, 2),
      dmi_kg:             round(dmi_kg, 2),
    },
    annual: {
      lactationDays,
      milkRevenue_tl:    round(annualMilkRevenue_tl, 0),
      feedCost_tl:       round(annualFeedCost_tl, 0),
      iofc_tl:           round(annualIOFC_tl, 0),
    },
    herd: {
      size:              herdSize,
      dailyIOFC_tl:      round(herdDailyIOFC_tl, 2),
      annualIOFC_tl:     round(herdAnnualIOFC_tl, 0),
      monthlyIOFC_tl:    round(herdDailyIOFC_tl * 30, 0),
    },
    status,
    inputs: { milkPrice_tl: round(milkPrice_tl, 2) },
  };
}

/**
 * IOFC değerini yorumlar.
 * Türkiye süt sektörü için tipik IOFC eşikleri (Hutjens 2010 + Türkiye uyarlaması):
 *   - Mükemmel: > ₺7/kg süt × milkYield (yani > %70 IOFC oranı)
 *   - İyi:      > %50
 *   - Orta:     %30-50
 *   - Düşük:    < %30
 *   - Zarar:    < 0
 */
function interpretIOFC(iofc_tl, milkYield_kg) {
  if (iofc_tl <= 0) {
    return {
      level: 'loss',
      label: 'Zarar',
      message: 'Rasyon maliyeti süt gelirini aşıyor. Yem fiyatlarını gözden geçirin veya verim artırın.',
    };
  }

  // IOFC per kg milk yield kabaca % olarak hesaplama
  const iofcPercent = milkYield_kg > 0 ? (iofc_tl / (milkYield_kg * 10)) * 100 : 0;

  if (iofcPercent > 70) {
    return { level: 'excellent', label: 'Mükemmel',
      message: 'Yem maliyetiniz çok düşük veya süt fiyatınız çok yüksek.' };
  }
  if (iofcPercent > 50) {
    return { level: 'good',     label: 'İyi',
      message: 'IOFC sektör ortalamasının üzerinde, sürdürülebilir karlılık.' };
  }
  if (iofcPercent > 30) {
    return { level: 'medium',   label: 'Orta',
      message: 'IOFC kabul edilebilir, ancak iyileştirme için yer var.' };
  }
  return { level: 'low',        label: 'Düşük',
    message: 'IOFC düşük, yem giderlerini sıkı denetleyin ve rasyonu optimize edin.' };
}

/**
 * Yem verimliliği yorumu (kg süt / kg KMT)
 * NASEM 2021 referansları:
 *   - 1.7+ : mükemmel (yüksek verimli sürü)
 *   - 1.4-1.7 : iyi
 *   - 1.2-1.4 : orta
 *   - < 1.2 : düşük
 */
export function interpretFeedEfficiency(eff) {
  if (eff >= 1.7) return { level: 'excellent', label: 'Mükemmel', message: 'Üst düzey yem verimliliği' };
  if (eff >= 1.4) return { level: 'good',      label: 'İyi',      message: 'Sektör ortalamasının üzerinde' };
  if (eff >= 1.2) return { level: 'medium',    label: 'Orta',     message: 'Tipik aralık' };
  return            { level: 'low',            label: 'Düşük',    message: 'İyileştirme gerekli — fiber/peNDF yetersizliği olabilir' };
}

/**
 * Yem maliyeti per kg süt yorumu (Türkiye 2026 piyasası)
 * Tipik aralık ₺6-12/kg süt.
 */
export function interpretFeedCostPerLiter(cost_tl) {
  if (cost_tl <= 0) return { level: 'na', label: '—' };
  if (cost_tl < 6)  return { level: 'excellent', label: 'Çok Düşük', message: 'Maliyet avantajı yüksek' };
  if (cost_tl < 9)  return { level: 'good',      label: 'İyi',       message: 'Tipik sektör aralığı altında' };
  if (cost_tl < 12) return { level: 'medium',    label: 'Orta',      message: 'Tipik sektör aralığı' };
  return              { level: 'high',           label: 'Yüksek',    message: 'Yem ekonomisi gözden geçirilmeli' };
}

// ─── Yardımcı ────────────────────────────────────────────────────────────────

function round(v, d = 2) {
  const m = Math.pow(10, d);
  return Math.round(v * m) / m;
}
