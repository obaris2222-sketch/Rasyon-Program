/**
 * Rumen pH Dinamik Simülasyonu — 24 saatlik profil
 *
 * Yöntem: Allen (1997), Krause & Oetzel (2006), Plaizier et al. (2008)
 * Yem tüketimi sonrası pH düşüş hızı + tampon sistem geri kazanım
 *
 * Modelde varsayılan beslenme şeması: TMR sürekli erişim (PMR),
 * ancak 12 ana öğün etrafında konsantre yüklenmesi:
 *   - Tipik laktasyon ineği günde 9-14 öğün tüketir (Grant & Albright 2000)
 *   - Sabah ve akşam pikleri belirgindir
 *
 * Modelin sınırları:
 *   - Tek hayvan varsayımı; gerçek sürü değişkenliği yok
 *   - Tampon (NaHCO3) katkısı ek değişken olarak alınmaz (rumen sıvısı tamponuna gömülü)
 *   - SARA kritiği için pH < 5.8 ≥ 3 saat/gün (Plaizier 2008)
 */

/**
 * 24 saatlik rumen pH profili simülasyonu
 *
 * @param {object} ration
 *   @param {number} ration.nfcPct      - NFC (% KM) — fermentable carb yükü
 *   @param {number} ration.peNDFPct    - peNDF (% KM) — fiziksel etkin lif (geviş + tükürük)
 *   @param {number} ration.starchPct   - Nişasta (% KM)
 *   @param {number} ration.sugarPct    - Şeker (% KM)
 *   @param {number} ration.forageRatio - Kaba yem (% KM)
 *   @param {number} ration.fatPct      - Yağ (% KM)
 * @param {object} [options]
 *   @param {number} options.feedings        - Günde öğün sayısı (varsayılan 2: sabah/akşam piki TMR)
 *   @param {number} options.basePH          - Maks (öğün öncesi) pH (varsayılan model çıktısı)
 *   @returns {object} { hours, ph, saraHours, minPH, meanPH, riskLevel, riskFlags }
 */
export function simulateRumenPH24h(ration, options = {}) {
  const {
    nfcPct = 0, peNDFPct = 0, starchPct = 0, sugarPct = 0, forageRatio = 0, fatPct = 0,
  } = ration;
  const { feedings = 2 } = options;

  // ─── Statik baseline pH (öğün öncesi denge) ────────────────────────
  // Allen 1997 + estimateRumenPH bench ile uyumlu
  let basePH = 6.8 - 0.012 * nfcPct + 0.018 * peNDFPct;
  if (forageRatio < 40) basePH -= 0.012 * (40 - forageRatio);
  basePH = Math.max(5.6, Math.min(7.0, basePH));

  // ─── Fermentasyon hızı (VFA üretim potansiyeli) ────────────────────
  // Nişasta + şeker → hızlı VFA. peNDF tampon (tükürük HCO3) sağlar.
  // amplitude = öğün sonrası maks pH düşüşü (Δ)
  // Kalibrasyon: orta TMR (NFC 38, peNDF 25) → amplitude ~0.55 (saf safe)
  //              ağır konsantre (NFC 48, peNDF 16) → amplitude ~1.0+ (SARA)
  const fermLoad = (starchPct * 0.018) + (sugarPct * 0.022);
  const buffer   = Math.max(0.10, peNDFPct * 0.035);
  const amplitude = Math.min(1.0, Math.max(0.2, fermLoad / buffer));

  // Yağ rumen fermentasyonunu hafif baskılar (CLA, biohidrojenasyon enerji emer)
  const fatDamp = Math.min(0.15, fatPct * 0.02);

  // ─── Öğün zamanları (24 saat) ─────────────────────────────────────
  // Öğün zaman aralığı eşit dağıtılır: feedings=2 → 06:00, 18:00 (sabah/akşam)
  const intervalH = 24 / feedings;
  const mealTimes = Array.from({ length: feedings }, (_, i) => 6 + i * intervalH);

  // ─── Saatlik pH profili (24 nokta) ────────────────────────────────
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const ph = hours.map(h => {
    // Tüm öğünlerden gelen pH düşüş katkılarının süperpozisyonu
    let drop = 0;
    for (const tm of mealTimes) {
      // En yakın öğüne sirküler mesafe
      let dt = h - tm;
      if (dt < 0) dt += 24;
      if (dt > 24) dt -= 24;
      // pH düşüş profili: lojistik+iyileşme. 0-2h hızlı düşüş, 4-6h pik, 8-10h iyileşme
      // f(dt) = Δ × (dt/2) × exp(−dt/5)  — geleneksel asit yüklenme/clearance modeli
      const x = dt > 0 ? (dt / 2) * Math.exp(-dt / 5) : 0;
      drop += x * amplitude;
    }
    // Yağ damping ve normalizasyon
    const totalDrop = Math.min(1.4, drop * (1 - fatDamp));
    return Math.max(5.0, basePH - totalDrop);
  });

  // ─── Risk metrikleri ──────────────────────────────────────────────
  const minPH = Math.min(...ph);
  const meanPH = ph.reduce((s, x) => s + x, 0) / ph.length;
  const saraHours = ph.filter(p => p < 5.8).length;       // pH<5.8 saat sayısı
  const acidosisHours = ph.filter(p => p < 5.5).length;   // pH<5.5 saat sayısı (akut)

  // Plaizier 2008: pH<5.8 ≥ 3 saat/gün → SARA tanısı
  let riskLevel;
  if (acidosisHours >= 1)      riskLevel = 'acute_acidosis';
  else if (saraHours >= 5)     riskLevel = 'high_sara';
  else if (saraHours >= 3)     riskLevel = 'sara';
  else if (saraHours >= 1)     riskLevel = 'marginal';
  else                         riskLevel = 'safe';

  const riskFlags = [];
  if (minPH < 5.5) riskFlags.push({ type: 'acute_acidosis', message: `Akut asidoz riski — pH ${minPH.toFixed(2)} ölçüldü` });
  if (saraHours >= 3) riskFlags.push({ type: 'sara', message: `SARA göstergesi: ${saraHours} saat boyunca pH<5.8` });
  if (amplitude > 0.9) riskFlags.push({ type: 'high_fermentation', message: 'Aşırı fermente edilebilir KH — tampon yetersiz' });
  if (peNDFPct < 19) riskFlags.push({ type: 'low_peNDF', message: 'peNDF kritik düşük — tükürük tamponu yetersiz' });

  return {
    hours,
    ph: ph.map(p => Math.round(p * 1000) / 1000),
    basePH: Math.round(basePH * 100) / 100,
    minPH: Math.round(minPH * 100) / 100,
    meanPH: Math.round(meanPH * 100) / 100,
    amplitude: Math.round(amplitude * 100) / 100,
    saraHours,
    acidosisHours,
    riskLevel,
    riskFlags,
    mealTimes,
    params: { nfcPct, peNDFPct, starchPct, sugarPct, forageRatio, fatPct },
  };
}

/**
 * Risk seviyesi yorumu — TR
 * @param {string} riskLevel - simulateRumenPH24h çıktısı
 * @returns {object} { label, color, severity }
 */
export function interpretRumenRisk(riskLevel) {
  const map = {
    safe:            { label: '✓ Güvenli', color: 'var(--primary)', severity: 'none' },
    marginal:        { label: '~ Sınırda', color: 'var(--warning)', severity: 'low' },
    sara:            { label: '⚠ SARA göstergesi (pH<5.8, ≥3 saat)', color: 'orange', severity: 'medium' },
    high_sara:       { label: '⛔ Yüksek SARA riski (≥5 saat asidik)', color: 'var(--danger)', severity: 'high' },
    acute_acidosis:  { label: '🚨 Akut asidoz riski (pH<5.5)', color: 'darkred', severity: 'critical' },
  };
  return map[riskLevel] || map.safe;
}
