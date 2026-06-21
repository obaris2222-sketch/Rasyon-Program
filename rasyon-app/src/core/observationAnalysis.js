/**
 * Saha Gözlem Analizi (FAZ 11B)
 *
 * Tahmin vs gerçek karşılaştırması, trend analizi, korelasyon.
 *
 * Kaynaklar:
 *   - Hutjens (2010): performans takibi için süt verim varyasyonu
 *   - DairyComp/Afimilk standartları: haftalık ölçüm sıklığı
 */

import { calcDMI } from './dmi.js';
import { calcEconomics } from './economics.js';

/**
 * Bir profilin gözlemleri ile rasyon tahminlerini karşılaştır
 *
 * @param {object[]} observations - sahada toplanan kayıtlar (tarih sıralı, en yeniden başlar)
 * @param {object} animalProfile  - hayvan profili (rasyon hedefi)
 * @param {object} [options]
 *   @param {string} [options.dmiMethod] - FAZ 17.3: çözülmüş KMT yöntemi ('NRC2001'|'deSouza2019');
 *     verilmezse calcDMI varsayılanı (NRC2001) — geriye uyumlu. Optimizer ile tutarlı tahmin için
 *     çağıran taraf bilim sistemine göre çözülmüş yöntemi geçer (resolveDmiMethod).
 * @returns {object} { trend, latest, summary }
 */
export function analyzeObservations(observations, animalProfile, options = {}) {
  if (!observations || observations.length === 0) {
    return {
      empty: true,
      trend: null,
      latest: null,
      summary: 'Henüz gözlem yok.',
    };
  }

  // En yeni gözlem (tarih sıralı yeniden eskiye varsayımı)
  const latest = observations[0];

  // Tahmin: hayvan profilinden beklenen DMI ve süt verimi
  // FAZ 17.3: KMT yöntemi (verilmişse) optimizer ile tutarlı olsun diye geçirilir.
  const predictedDMI = animalProfile ? calcDMI(animalProfile, options.dmiMethod).dmi : null;
  const predictedMY = animalProfile?.milkYield || null;

  // Trendler (en az 2 gözlem gerekli)
  let myTrend = null, bcsTrend = null, dmiTrend = null;
  if (observations.length >= 2) {
    const series = [...observations].reverse();  // kronolojik
    myTrend = calcLinearTrend(series.map(o => o.milkYield).filter(v => Number.isFinite(v)));
    bcsTrend = calcLinearTrend(series.map(o => o.bcs).filter(v => Number.isFinite(v)));
    dmiTrend = calcLinearTrend(series.map(o => o.dmiActual).filter(v => Number.isFinite(v)));
  }

  // Tahmin vs gerçek delta
  let myDelta = null, dmiDelta = null;
  if (Number.isFinite(latest.milkYield) && Number.isFinite(predictedMY)) {
    myDelta = {
      actual: latest.milkYield,
      predicted: predictedMY,
      diff: latest.milkYield - predictedMY,
      pct: predictedMY > 0 ? ((latest.milkYield - predictedMY) / predictedMY * 100) : 0,
    };
  }
  if (Number.isFinite(latest.dmiActual) && Number.isFinite(predictedDMI)) {
    dmiDelta = {
      actual: latest.dmiActual,
      predicted: predictedDMI,
      diff: latest.dmiActual - predictedDMI,
      pct: predictedDMI > 0 ? ((latest.dmiActual - predictedDMI) / predictedDMI * 100) : 0,
    };
  }

  // Performans skoru (0-100)
  let perfScore = 100;
  if (myDelta && Math.abs(myDelta.pct) > 15) perfScore -= 25;
  else if (myDelta && Math.abs(myDelta.pct) > 8) perfScore -= 10;
  if (dmiDelta && Math.abs(dmiDelta.pct) > 15) perfScore -= 15;
  if (myTrend && myTrend.slope < -0.5) perfScore -= 15;  // verim düşüyor
  if (bcsTrend && Math.abs(bcsTrend.slope) > 0.05) perfScore -= 10;  // BCS hızlı değişiyor

  return {
    empty: false,
    latest,
    count: observations.length,
    predicted: { dmi: predictedDMI, milkYield: predictedMY },
    myDelta,
    dmiDelta,
    trend: { my: myTrend, bcs: bcsTrend, dmi: dmiTrend },
    performanceScore: Math.max(0, Math.min(100, perfScore)),
    summary: buildSummary(myDelta, dmiDelta, myTrend, bcsTrend),
  };
}

/**
 * Lineer regresyon eğimi (y = a + bx)
 * @param {number[]} values - kronolojik sıralı ölçümler
 * @returns {object} { slope, intercept, mean, n }
 */
export function calcLinearTrend(values) {
  if (!values || values.length < 2) return null;
  const n = values.length;
  const xs = values.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return {
    slope: Math.round(slope * 1000) / 1000,
    intercept: Math.round(intercept * 100) / 100,
    mean: Math.round(yMean * 100) / 100,
    min: Math.min(...values),
    max: Math.max(...values),
    n,
    direction: slope > 0.1 ? 'up' : slope < -0.1 ? 'down' : 'stable',
  };
}

function buildSummary(myDelta, dmiDelta, myTrend, bcsTrend) {
  const msgs = [];
  if (myDelta) {
    if (myDelta.pct > 10) msgs.push(`✓ Süt verimi tahminin %${myDelta.pct.toFixed(0)} üzerinde — mükemmel`);
    else if (myDelta.pct < -10) msgs.push(`⚠ Süt verimi tahminin %${Math.abs(myDelta.pct).toFixed(0)} altında — rasyon revize edilmeli`);
    else msgs.push(`Süt verimi tahmin aralığında (±%${Math.abs(myDelta.pct).toFixed(0)})`);
  }
  if (myTrend?.direction === 'down') msgs.push(`📉 Süt verimi düşüş trendinde (eğim: ${myTrend.slope}/hafta)`);
  if (myTrend?.direction === 'up') msgs.push(`📈 Süt verimi artış trendinde (eğim: +${myTrend.slope}/hafta)`);
  if (bcsTrend?.slope < -0.05) msgs.push(`⚠ BCS düşüş trendinde — negatif enerji dengesi olabilir`);
  if (bcsTrend?.slope > 0.05) msgs.push(`⚠ BCS artış trendinde — enerji fazlası`);
  if (dmiDelta && dmiDelta.pct < -15) msgs.push(`⚠ KMT tahminin altında — palatability/sağlık sorunu olabilir`);
  return msgs.length > 0 ? msgs.join(' • ') : 'Performans tahminlerle uyumlu.';
}

/**
 * Performans skoruna göre renkli etiket
 */
export function performanceGrade(score) {
  if (score >= 85) return { grade: 'A', label: 'Mükemmel', color: 'var(--primary)' };
  if (score >= 70) return { grade: 'B', label: 'İyi',      color: 'var(--primary)' };
  if (score >= 50) return { grade: 'C', label: 'Orta',     color: 'var(--warning)' };
  return                { grade: 'D', label: 'Düşük',    color: 'var(--danger)' };
}
