/**
 * Yem Kalitesi — Mikotoksin Riski + Silaj Fermentasyon Kalitesi — FAZ 16.6
 *
 * Kaynaklar:
 *   - Mikotoksin limitleri: AB Komisyonu Tavsiyesi 2006/576/EC + FDA action/guidance
 *     levels (süt sığırı tam rasyon, μg/kg); Whitlow & Hagler (2005)
 *   - Silaj fermentasyon: Kung & Shaver (2001) "Interpretation of silage fermentation
 *     profiles"; Flieg puanlama mantığı (pH/laktik/asetik/butirik)
 *
 * İki bağımsız değerlendirme:
 *   1) Mikotoksin yükü — rasyon düzeyinde KM-ağırlıklı μg/kg KM, tolere edilebilir
 *      limitlerle karşılaştırma. Veriler lab analizinden girilir (parti-özel).
 *   2) Silaj fermentasyon kalitesi — ölçülen pH/laktik/asetik/butirik/NH3-N'den
 *      0-100 skor (klostridyal/proteoliz tespiti). Yalnız lab verisi girilen silajlar.
 *
 * ⚠️ Bilimsel dürüstlük: mikotoksin/fermentasyon değerleri parti-özeldir ve lab
 * analizi gerektirir — varsayılan yem kütüphanesinde çoğu yemde YOKTUR (kullanıcı
 * girer). Bu modül yalnız veri girilince değerlendirir; aksi halde "veri yok" döner.
 * Limitler risk-gösterge amaçlıdır (mevzuat birebir değil); rumen bazı toksinleri
 * (DON/OTA/ZEN) kısmen parçalar, aflatoksin parçalanmaz ve süte AFM1 olarak geçer.
 */

// ─── MİKOTOKSİN ──────────────────────────────────────────────────────────────

// Tolere edilebilir limitler (süt sığırı tam rasyon, μg/kg KM ≈ ppb)
export const MYCOTOXIN_LIMITS = {
  aflatoxinB1: { limit: 5,     warnFrac: 0.5, label: 'Aflatoksin B1', note: 'Süte AFM1 olarak geçer (AB süt limiti 0.05 μg/kg); rumen parçalamaz — en kritik' },
  don:         { limit: 5000,  warnFrac: 0.6, label: 'DON (Vomitoksin)', note: 'Yem tüketimini düşürür; rumen kısmen parçalar' },
  zearalenone: { limit: 500,   warnFrac: 0.6, label: 'Zearalenon (ZEN)', note: 'Östrojenik → kısırlık/üreme bozukluğu' },
  fumonisin:   { limit: 50000, warnFrac: 0.6, label: 'Fumonisin (FB1+FB2)', note: 'Ruminantlar nispeten toleranslı' },
  t2toxin:     { limit: 500,   warnFrac: 0.6, label: 'T-2 Toksini', note: 'Sindirim tahrişi, bağışıklık baskılama' },
  ochratoxin:  { limit: 50,    warnFrac: 0.6, label: 'Okratoksin A', note: 'Rumen büyük ölçüde parçalar (düşük risk)' },
};

export const MYCOTOXIN_KEYS = ['aflatoxinB1', 'don', 'zearalenone', 'fumonisin', 't2toxin', 'ochratoxin'];

/**
 * Rasyon düzeyinde mikotoksin yükü (KM-ağırlıklı μg/kg KM) + limit karşılaştırma.
 * @param {Array}  ingredients - [{ feed, dmKg }]
 * @param {number} totalDmKg
 * @returns {object} { anyData, toxins: {key:{value,limit,ratio,status,label,note,contributors}}, overall }
 */
export function aggregateMycotoxins(ingredients, totalDmKg) {
  const acc = {}; for (const k of MYCOTOXIN_KEYS) acc[k] = 0;
  const contrib = {}; for (const k of MYCOTOXIN_KEYS) contrib[k] = [];
  let anyData = false;

  if (Array.isArray(ingredients) && totalDmKg > 0) {
    for (const { feed, dmKg } of ingredients) {
      if (!feed || !dmKg || dmKg <= 0) continue;
      const prop = dmKg / totalDmKg;
      for (const k of MYCOTOXIN_KEYS) {
        const v = Number(feed[k]);
        if (Number.isFinite(v) && v > 0) {
          acc[k] += v * prop;
          anyData = true;
          contrib[k].push(feed.name || feed.id);
        }
      }
    }
  }

  const toxins = {};
  let worst = 'ok';
  for (const k of MYCOTOXIN_KEYS) {
    const lim = MYCOTOXIN_LIMITS[k];
    const value = round2(acc[k]);
    const ratio = lim.limit > 0 ? value / lim.limit : 0;
    let status = 'ok';
    if (ratio >= 1) status = 'danger';
    else if (ratio >= lim.warnFrac) status = 'warning';
    toxins[k] = { value, limit: lim.limit, ratio: round2(ratio), status, label: lim.label, note: lim.note, contributors: contrib[k] };
    if (status === 'danger') worst = 'danger';
    else if (status === 'warning' && worst !== 'danger') worst = 'warning';
  }
  return { anyData, toxins, overall: worst };
}

/**
 * Mikotoksin risk yorumu.
 * @param {object} aggregated - aggregateMycotoxins() çıktısı
 * @returns {object} { level, label, message, recommendations }
 */
export function interpretMycotoxinRisk(aggregated) {
  if (!aggregated || !aggregated.anyData) {
    return {
      level: 'na', label: 'Veri girilmedi',
      message: 'Mikotoksin analizi girilmedi. Silaj, tahıl ve yan ürünlerde periyodik mikotoksin testi önerilir (özellikle nemli hasat/küflenme sonrası).',
      recommendations: [],
    };
  }
  const flagged = MYCOTOXIN_KEYS
    .filter(k => aggregated.toxins[k].status !== 'ok')
    .map(k => aggregated.toxins[k]);

  if (aggregated.overall === 'danger') {
    return {
      level: 'danger', label: 'Yüksek Risk',
      message: 'Bir veya daha fazla mikotoksin tolere edilebilir limiti AŞIYOR. Kontamine yemi seyreltin/çıkarın; aflatoksinde süt kalıntısı (AFM1) riski var.',
      recommendations: [
        'Kontamine partiyi temiz yemle seyreltin veya rasyondan çıkarın',
        'Mikotoksin bağlayıcı (HSCAS/glukomannan/bentonit) ekleyin',
        'Aflatoksin pozitifse sütte AFM1 testi yaptırın',
        'Silaj yüzey küfünü temizleyin, hava sızdırmazlığı sağlayın',
      ],
    };
  }
  if (aggregated.overall === 'warning') {
    return {
      level: 'warning', label: 'Orta Risk',
      message: 'Mikotoksin düzeyi limite yaklaşıyor. İzleme ve önleyici tedbir önerilir.',
      recommendations: [
        'Mikotoksin bağlayıcı kullanımını değerlendirin',
        'Hassas gruplarda (geçiş, yüksek verim) kontamine yem oranını düşürün',
        'Düzenli yeniden test yapın',
      ],
    };
  }
  return {
    level: 'ok', label: 'Düşük Risk',
    message: 'Ölçülen mikotoksin düzeyleri tolere edilebilir limitlerin altında.',
    recommendations: [],
  };
}

// ─── SİLAJ FERMENTASYON KALİTESİ ─────────────────────────────────────────────

/**
 * Silaj fermentasyon kalite skoru (0-100) — ölçülen pH/laktik/asetik/butirik/NH3-N'den.
 * Yalnız `silagePH` girilmiş yemler için hesaplanır; aksi halde null döner.
 *
 * Puanlama (100'den düşülür):
 *   - pH (KM-ayarlı ideal aşımı): max −30
 *   - Butirik asit (klostridyal): max −40 (en kritik)
 *   - NH3-N (proteoliz, %8 üstü): max −20
 *   - Laktik baskınlık <%60: −15
 *
 * @param {object} feed
 * @returns {object|null} { score, grade, level, pH, idealPH, lactic, acetic, butyric, nh3, lacticFraction, notes }
 */
export function silageFermentationScore(feed) {
  const pH = Number(feed.silagePH);
  if (!Number.isFinite(pH) || pH <= 0) return null;  // fermentasyon verisi yok

  // Eksik alanlar null (0 SAYILMAZ — aksi halde girilmeyen butirik/NH3-N "mükemmel"
  // gibi görünüp yanıltıcı yüksek skor üretir). Yalnız girilen alanlar cezalandırılır.
  const lactic = numOrNull(feed.silageLacticAcid);
  const acetic = numOrNull(feed.silageAceticAcid);
  const butyric = numOrNull(feed.silageButyricAcid);
  const nh3 = numOrNull(feed.silageNH3N);
  const dm = num(feed.dm, 35);

  let score = 100;
  const notes = [];
  const missing = [];

  // pH — KM-ayarlı ideal (kuru silaj daha yüksek pH tolere eder)
  const idealPH = dm < 30 ? 4.0 : dm < 40 ? 4.2 : 4.5;
  if (pH > idealPH) {
    const pen = Math.min(30, (pH - idealPH) * 30);
    score -= pen;
    notes.push(`pH ${pH.toFixed(1)} ideal üstü (≤${idealPH}); yetersiz asitlenme / aerobik bozulma riski`);
  } else {
    notes.push(`pH ${pH.toFixed(1)} uygun (≤${idealPH})`);
  }

  // Butirik asit — klostridyal fermentasyon (en kritik); yalnız girilince değerlendir
  if (butyric === null) { missing.push('butirik asit'); }
  else if (butyric > 0.1) {
    const pen = Math.min(40, butyric * 40);
    score -= pen;
    notes.push(`Butirik asit %${butyric.toFixed(2)} (klostridyal; protein yıkımı + lezzet kaybı — kötü)`);
  }

  // NH3-N — aşırı proteoliz
  if (nh3 === null) { missing.push('NH3-N'); }
  else if (nh3 > 8) {
    const pen = Math.min(20, (nh3 - 8) * 2);
    score -= pen;
    notes.push(`NH3-N toplam N'nin %${nh3.toFixed(0)}'i (>%15 aşırı proteoliz)`);
  }

  // Laktik asit baskınlığı (homofermentatif tercih) — laktik + en az bir asit girilirse
  let lacticFraction = null;
  if (lactic !== null && (acetic !== null || butyric !== null)) {
    const totalAcid = lactic + (acetic || 0) + (butyric || 0);
    if (totalAcid > 0) {
      lacticFraction = lactic / totalAcid;
      if (lacticFraction < 0.6) {
        score -= 15;
        notes.push('Laktik asit baskın değil (<%60) — heterofermentatif / aerobik instabilite');
      }
    }
  } else if (lactic === null) {
    missing.push('laktik asit');
  }

  // Eksik kritik veri → skor güvenilirliği uyarısı (sahte güven önleme)
  const partial = missing.length > 0;
  if (partial) notes.push(`⚠ ${missing.join(', ')} girilmedi — skor eksik veriye dayalı (özellikle butirik/NH3-N kritik)`);

  score = Math.max(0, Math.round(score));
  const g = score >= 85 ? { level: 'excellent', label: 'Çok İyi' }
          : score >= 70 ? { level: 'good',      label: 'İyi' }
          : score >= 50 ? { level: 'moderate',  label: 'Orta' }
          :               { level: 'poor',      label: 'Kötü' };

  return {
    score, grade: g.label, level: g.level, partial, missing,
    pH: round2(pH), idealPH,
    lactic: lactic !== null ? round2(lactic) : null,
    acetic: acetic !== null ? round2(acetic) : null,
    butyric: butyric !== null ? round2(butyric) : null,
    nh3: nh3 !== null ? round2(nh3) : null,
    lacticFraction: lacticFraction !== null ? round2(lacticFraction) : null,
    notes,
  };
}

/**
 * Rasyondaki silajların fermentasyon profillerini topla (lab verisi olanlar).
 * @param {Array} ingredients - [{ feed, dmKg }]
 * @returns {object} { items: [{id, name, dmKg, ...score}], anyData }
 */
export function aggregateSilageQuality(ingredients) {
  const items = [];
  if (Array.isArray(ingredients)) {
    for (const { feed, dmKg } of ingredients) {
      if (!feed) continue;
      const s = silageFermentationScore(feed);
      if (s) items.push({ id: feed.id, name: feed.name || feed.id, dmKg: round2(dmKg || 0), ...s });
    }
  }
  return { items, anyData: items.length > 0 };
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
// Girilmemiş (null/undefined/'') → null (0 ile karıştırma; eksik veri tespiti için)
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(v) { return Math.round(v * 100) / 100; }
