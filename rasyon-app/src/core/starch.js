/**
 * Nişasta Rumen Sindirilebilirliği — FAZ 16.4
 *
 * Kaynaklar:
 *   - NASEM 2021 (8. Baskı, Böl. Karbonhidrat) — nişasta rumen/bağırsak sindirimi
 *   - Ferraretto et al. (2013) J. Dairy Sci. 96:533 — tahıl tipi + mısır işleme/
 *     hasat yöntemlerinin nişasta sindirimine etkisi (meta-analiz)
 *   - Firkins et al. (2001); Owens et al. (1986) — bağırsak nişasta sindirimi
 *
 * Diyet nişastasının rumende fermente olan oranı (RSD — ruminal starch
 * digestibility) işleme derecesine göre büyük değişir:
 *   bütün tane (~%45) < kırılmış < kuru öğütülmüş < ince < yüksek nemli (HMC)
 *   < buharla işlenmiş/flake (~%85). Rumende fermente nişasta SARA/asidoz riskini
 *   sürükler; rumeni geçen (by-pass) nişasta bağırsakta sindirilir (glikoz, enerji).
 *
 * ⚠️ Bilimsel dürüstlük: RSD = kd / (kd + kp) ile hesaplanır; kp (pasaj hızı)
 * tipik bir laktasyon değeri (varsayılan 6 %/saat) varsayılır ki işleme etkisi
 * (kd) izole edilsin. Mutlak değerler Ferraretto 2013 aralıklarına kalibre;
 * işleme tipi belirtilmezse kategori-bazlı tipik değer kullanılır (kuru öğütülmüş
 * varsayımı). Doğru tahmin için yem işleme tipini seçin.
 *
 * Bu modül EK (additive) bir analiz/gösterim katmanıdır — mevcut LP MCP hesabı
 * (lpBuilder, TDN-bazlı NRC 2001) ve CNCPS CHO fraksiyonlaması DEĞİŞMEZ.
 */

// ─── İşleme tipleri ────────────────────────────────────────────────────────
// kd: nişasta parçalanma hızı (%/saat); intestinal: rumeni geçen nişastanın
// bağırsakta sindirilen oranı (Ferraretto 2013 — işlenmiş tahılda daha yüksek).
export const STARCH_PROCESSING = {
  whole:         { label: 'Bütün tane (işlenmemiş)',   kd: 5,  intestinal: 0.50 },
  cracked:       { label: 'Kırılmış / ezilmiş',        kd: 9,  intestinal: 0.60 },
  dryGround:     { label: 'Kuru öğütülmüş',            kd: 14, intestinal: 0.75 },
  dryGroundFine: { label: 'İnce öğütülmüş',            kd: 20, intestinal: 0.82 },
  highMoisture:  { label: 'Yüksek nemli (HMC)',        kd: 28, intestinal: 0.88 },
  steamFlaked:   { label: 'Buharla işlenmiş (flake)',  kd: 34, intestinal: 0.92 },
};

/** Varsayılan katı pasaj hızı (kp, %/saat) — tipik laktasyon (işleme etkisini izole eder) */
export const DEFAULT_STARCH_KP = 6;

// İşleme belirtilmediğinde kategori-bazlı tipik nişasta kd (%/saat).
// Tahıl/konsantre ≈ kuru öğütülmüş; kaba yem nişastası (silaj) ensile → hızlı.
const CATEGORY_STARCH_KD = {
  grain: 14, protein: 16, byproduct: 16, roughage: 22, fat: 0, mineral: 0,
};
const DEFAULT_CATEGORY_KD = 14;

/**
 * İşleme tipine göre nişasta kd (%/saat) döndürür.
 * @param {string} processing - STARCH_PROCESSING anahtarı
 * @returns {number|null} kd veya tanımsız tip için null
 */
export function starchKdByProcessing(processing) {
  const p = STARCH_PROCESSING[processing];
  return p ? p.kd : null;
}

/** Bağırsak sindirim katsayısı (işleme veya kategori bazlı) */
function intestinalCoef(processing, category) {
  const p = STARCH_PROCESSING[processing];
  if (p) return p.intestinal;
  // Belirtilmezse: kaba yem (silaj nişastası) iyi sindirilir, diğerleri orta-yüksek
  return category === 'roughage' ? 0.80 : 0.75;
}

/**
 * Nişasta kd çözümü (öncelik): işleme tipi > açık kdB1 > kategori varsayılanı.
 * İşleme tipi en öncelikli — kullanıcının nişastaya-özel kasıtlı seçimidir;
 * kdB1 (genel CHO-B1 parçalanma hızı, starch+pektin) yalnızca işleme belirtilmemişse
 * geri-dönüş olarak kullanılır. (Yalnızca bu modülde — LP/CNCPS pipeline'ı etkilemez.)
 */
function resolveStarchKd(feed) {
  const byProc = starchKdByProcessing(feed.starchProcessing);
  if (byProc) return byProc;
  if (Number.isFinite(Number(feed.choKdB1)) && Number(feed.choKdB1) > 0) return Number(feed.choKdB1);
  if (Number.isFinite(Number(feed.kdB1)) && Number(feed.kdB1) > 0) return Number(feed.kdB1);
  return CATEGORY_STARCH_KD[feed.category] ?? DEFAULT_CATEGORY_KD;
}

/**
 * Yem-başına nişasta sindirim profili (rumen / bağırsak / by-pass).
 *
 * @param {object} feed - { starch %KM, starchProcessing?, kdB1?, category }
 * @param {object} [options] - { kpSolid: katı pasaj hızı %/saat (default 6) }
 * @returns {object} { processing, kd, rsd, intestinal, bypass, totalTract }
 *   rsd        - rumende sindirilen oran (0-1)
 *   intestinal - bağırsakta sindirilen oran (0-1, diyet nişastasının)
 *   bypass     - rumeni geçen oran (0-1)
 *   totalTract - toplam sindirilen oran (rumen + bağırsak)
 */
export function starchDigestibility(feed, options = {}) {
  const kp = Number.isFinite(options.kpSolid) && options.kpSolid > 0 ? options.kpSolid : DEFAULT_STARCH_KP;
  const processing = feed.starchProcessing && STARCH_PROCESSING[feed.starchProcessing]
    ? feed.starchProcessing : 'default';
  const kd = resolveStarchKd(feed);
  const rsd = kd > 0 ? kd / (kd + kp) : 0;          // rumen sindirilebilirliği
  const bypass = 1 - rsd;                            // rumeni geçen
  const intestinal = bypass * intestinalCoef(feed.starchProcessing, feed.category);
  const totalTract = rsd + intestinal;
  return {
    processing,
    kd: round1(kd),
    rsd: round3(rsd),
    intestinal: round3(intestinal),
    bypass: round3(bypass),
    totalTract: round3(totalTract),
  };
}

/**
 * Rasyon düzeyinde nişasta sindirim profili (rumen / bağırsak / dışkı).
 *
 * @param {Array}  ingredients - [{ feed, dmKg }]
 * @param {number} totalDmKg
 * @param {object} [options] - { kpSolid }
 * @returns {object} {
 *   starch_g, rumenStarch_g, intestinalStarch_g, fecalStarch_g,
 *   starch_pct, rumenStarch_pct, rsd, intestinalDig, totalTract
 * }  (g = g/gün, _pct = % KM, rsd/oranlar 0-1)
 */
export function aggregateStarchDigestion(ingredients, totalDmKg, options = {}) {
  let starch_g = 0, rumen_g = 0, intestinal_g = 0;
  if (Array.isArray(ingredients) && totalDmKg > 0) {
    for (const { feed, dmKg } of ingredients) {
      if (!feed || !dmKg || dmKg <= 0) continue;
      const s = num(feed.starch) / 100 * dmKg * 1000;   // g nişasta
      if (s <= 0) continue;
      const d = starchDigestibility(feed, options);
      starch_g += s;
      rumen_g += s * d.rsd;
      intestinal_g += s * d.intestinal;
    }
  }
  const fecal_g = Math.max(0, starch_g - rumen_g - intestinal_g);
  const rsd = starch_g > 0 ? rumen_g / starch_g : 0;
  const intestinalDig = starch_g > 0 ? intestinal_g / starch_g : 0;
  return {
    starch_g: Math.round(starch_g),
    rumenStarch_g: Math.round(rumen_g),
    intestinalStarch_g: Math.round(intestinal_g),
    fecalStarch_g: Math.round(fecal_g),
    starch_pct: totalDmKg > 0 ? round2(starch_g / totalDmKg / 10) : 0,
    rumenStarch_pct: totalDmKg > 0 ? round2(rumen_g / totalDmKg / 10) : 0,
    rsd: round3(rsd),
    intestinalDig: round3(intestinalDig),
    totalTract: round3(rsd + intestinalDig),
  };
}

/**
 * Rumende fermente nişasta yorumu (SARA/asidoz göstergesi).
 * Rumende fermente nişasta — toplam nişastadan farklı olarak — asidoz riskini
 * doğrudan sürükler. Eşikler % KM bazında (rumen-fermente nişasta).
 *
 * @param {number} rumenStarchPctDM - rumende fermente nişasta (% KM)
 * @returns {object} { level, label, message }
 */
export function interpretRumenStarch(rumenStarchPctDM) {
  const v = Number(rumenStarchPctDM) || 0;
  if (v < 18) {
    return { level: 'low', label: 'Düşük', message: 'Rumende fermente nişasta düşük — asidoz riski sınırlı; enerji için yeterli mi kontrol edin.' };
  }
  if (v < 24) {
    return { level: 'moderate', label: 'Orta', message: 'Rumende fermente nişasta tipik aralıkta — yeterli peNDF ve tamponlama ile dengeli.' };
  }
  return { level: 'high', label: 'Yüksek', message: 'Rumende fermente nişasta yüksek — SARA/asidoz riski; peNDF artırın, daha az işlenmiş tahıl veya by-pass nişasta değerlendirin.' };
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
