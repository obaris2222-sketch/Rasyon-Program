/**
 * Soft Constraint / Slack — Infeasibility Fallback (FAZ 14.8)
 *
 * Problem: Sıkı (hard) LP infeasible olunca kullanıcı yalnızca bir hata mesajı
 * görür ("çözüm yok") — hangi kısıtın çakıştığı veya ne kadar gevşetilmesi
 * gerektiği belli değildir ("kör" kalır).
 *
 * Çözüm: Infeasible durumda, gevşetilebilir (soft) kısıtlara SLACK değişkenleri
 * eklenir. Her slack pozitif maliyetle (penalty) amaç fonksiyonuna girer; LP
 * mümkün olduğunca az slack kullanarak feasible bir çözüm bulur. Slack > 0 olan
 * kısıtlar "şu kadar ihlal edildi" olarak raporlanır.
 *
 * Öncelik sırası: kritik kısıtlar (DCAD, peNDF, rumen sağlığı) yüksek penalty →
 * en son gevşetilir; kolay düzeltilebilenler (iz mineral/vitamin — premiks ile)
 * düşük penalty → ilk gevşetilir. Kullanıcı `priorityList` ile değiştirebilir.
 *
 * Slack matematiği:
 *   LO (Σax ≥ lb):  Σax + s ≥ lb,  s ≥ 0   → s = max(0, lb − Σax) eksikliği telafi
 *   UP (Σax ≤ ub):  Σax − s ≤ ub,  s ≥ 0   → s = max(0, Σax − ub) aşımı telafi
 *   DB (lb ≤ Σax ≤ ub): iki kısıta bölünür → (Σax + s_lo ≥ lb) ve (Σax − s_up ≤ ub)
 *   FX: yapısal (DMI) — gevşetilmez
 */

import { GLP } from './lpBuilder.js';

// ─── Gevşetilebilir kısıt öncelik listesi (yüksek → düşük öncelik) ───────────
// Liste başı = en yüksek öncelik = en yüksek penalty = en SON gevşetilir.
// Liste sonu = en düşük öncelik = en ucuz = İLK gevşetilir.
// Tam ad veya prefix (`trace_`, `vit_`, `group_`) eşleşmesi.
// Burada OLMAYAN kısıtlar HARD'dır (DMI, NEL, MP, Ca, P, RUP_min, CP).
export const RELAX_PRIORITY = [
  'DCAD',        // geçiş dönemi süt humması — en kritik (relaxed = milk fever riski)
  // SAHA-DENETİM C: vitamin/iz mineral — DCAD'den hemen sonra YÜKSEK öncelik.
  // Gerekçe: bu kısıtlar yem setinde KAYNAK (premiks/katkı) VARSA LP'ye eklenir; yoksa
  // graceful-fallback ile DÜŞÜRÜLÜR (→ missingSources uyarısı). Yani LP'de olduklarında
  // daima KARŞILANABİLİRLER (premiks ölçeklenir). Eski en-düşük öncelik ("kullanıcı premiks
  // ekler") geçersiz — premiks zaten listede, optimizer onu KULLANMALI. Yüksek öncelik, KMT
  // tavanı + NEL-kilidi altında premiks için gereken küçük dengelemeyi yaptırır; aksi halde
  // ucuz+temel mikro-besinler feda ediliyordu (vitA=0, Zn/Se eksik vb. → körlük/bağışıklık/
  // fertilite riski). Vitamin/iz mineral eksikliği, hafif lif/CHO sapmasından çok daha kritik
  // → yapısal lif dahil diğer soft kısıtların üstünde (yalnız DCAD/milk-fever önde). Gereken
  // premiks daima küçük (~0.1 kg) + optimizer minimum slack → rumen sağlığı sapması sınırlı.
  // (DENEYSEL DOĞRULAMA: alternatif "lif-altı" yerleşim Se/Co/Cu'yu yarım bıraktı, forage'ı da
  //  korumadı → aşırı-kısıtlı senaryoda forage düşüşü içsel; bu yerleşim TÜM mikroları karşılar.)
  'vit_',        // vitamin (kaynak varsa öncelikli karşıla — prefix)
  'trace_',      // iz mineral (kaynak varsa öncelikli karşıla — prefix)
  'Ca_P_min',    // Ca:P Oranı min
  'Ca_P_max',    // Ca:P Oranı max
  'Mg', 'K', 'Na', 'Cl', 'S', // Makro mineraller (Ca ve P hariç) esnetilebilir
  'peNDF_min',   // rumen sağlığı / MFD (fiziksel etkin lif — SARA koruması, yüksek öncelik)
  'peNDF_max',   // çift-taraflı band: kullanıcı opsiyonel üst sınırı (kardeşinin yanında)
  'Forage',      // kaba yem oranı
  'Fat_max',     // rumen lif sindirimi baskılanması
  'Fat_min',     // çift-taraflı band: kullanıcı opsiyonel alt sınırı
  'PUFA_max',    // FAZ 14.10: çoklu doymamış yağ / MFD
  'PUFA_min',    // çift-taraflı band: kullanıcı opsiyonel alt sınırı
  'n6n3_ratio',  // FAZ 14.10: ω6:ω3 oranı (süt kalitesi, opsiyonel)
  'Starch_max',  // asidoz / SARA
  'Starch_min',  // çift-taraflı band: kullanıcı opsiyonel alt sınırı
  'Sugar_max',   // MFD
  'Sugar_min',   // çift-taraflı band: kullanıcı opsiyonel alt sınırı
  'NFC_max',     // toplam fermente CHO
  'NFC_min',     // çift-taraflı band: kullanıcı opsiyonel alt sınırı
  'NDF',         // lif aralığı
  'ADF_min',
  'ADF_max',     // çift-taraflı band: kullanıcı opsiyonel üst sınırı
  'RDP',         // mikrobiyal protein sentezi
  'Lys', 'Met', 'His',  // amino asit (RP-AA ile düzeltilebilir; His FAZ 18.3)
  // Tam EAA Katman B: 7 EAA opt-in kullanıcı kısıtları — relaxable (yoksa "listede yok=hard"
  // ile band'i infeasible yapardı). Lys/Met/His ile aynı (düşük) öncelik bölgesinde.
  'Arg', 'Thr', 'Ile', 'Leu', 'Val', 'Phe', 'Trp',
  'group_',      // kullanıcı kategori limitleri (prefix)
  // (vit_/trace_ yukarı taşındı — SAHA-DENETİM C; kaynak varsa öncelikli karşılanır)
  'TMR_ration_moisture_min',  // PROBLEMLER #3: rasyondan-min-nem (yönetimsel; düşük öncelik)
  'TMR_DM_min',  // #4: TMR nem/DM hedefi — yönetimsel tercih; en düşük öncelik (ilk gevşer,
  'TMR_DM_max',  //      yem seti çok kuru/yaşsa beslenme kısıtlarına yenilir → infeasible yapmaz)
];

/**
 * Kısıt adının öncelik sırasındaki indeksini bulur (tam veya prefix eşleşme).
 * @returns {number} index (0 = en yüksek öncelik) veya -1 (HARD, gevşetilmez)
 */
function priorityIndex(constraintName, priorityList) {
  for (let i = 0; i < priorityList.length; i++) {
    const p = priorityList[i];
    if (p.endsWith('_') ? constraintName.startsWith(p) : constraintName === p) {
      return i;
    }
  }
  return -1;
}

/**
 * Sıkı LP'yi soft (slack'li) LP'ye dönüştürür.
 *
 * @param {object} lp — buildRationLP() çıktısı (hard LP)
 * @param {object} [options]
 *   @param {string[]} [options.priorityList=RELAX_PRIORITY] — gevşetme öncelik sırası
 *   @param {number}   [options.penaltyBase=100] — temel ceza katsayısı (en düşük öncelik)
 *   @param {number}   [options.penaltyFactor=3] — öncelik kademe çarpanı (geometrik)
 * @returns {{ relaxedLP: object, slackMeta: Array<{slack, constraint, side}> }}
 *
 * Numerik not: penalty = penaltyBase × penaltyFactor^(maxRank−1−rank). 15 kademe için
 * en yüksek (DCAD) ≈ 100 × 3^14 ≈ 4.8e8 — float64 için güvenli, yem maliyetinden
 * (~1e3–1e4) yeterince büyük (feasibility önceliği) ama ill-conditioning yaratmaz.
 * (Eski 1e5 × 8^14 ≈ 4.4e17 numerik kararlılık riski taşıyordu.)
 */
export function relaxLP(lp, options = {}) {
  const {
    priorityList = RELAX_PRIORITY,
    penaltyBase = 100,
    penaltyFactor = 3,
    hardConstraints = [],   // #2: kullanıcının "zorunlu" işaretlediği kısıtlar — slack ALMAZ
  } = options;

  const maxRank = priorityList.length;  // index 0 en yüksek

  // Derin kopya (orijinal lp'yi bozma — composeResult _meta kullanır)
  const objective = {
    ...lp.objective,
    vars: lp.objective.vars.map(v => ({ ...v })),
  };
  const subjectTo = [];
  const bounds = (lp.bounds || []).map(b => ({ ...b }));

  const slackMeta = [];
  let slackCounter = 0;

  const addSlack = (constraintName, rankIndex, side) => {
    const penalty = penaltyBase * Math.pow(penaltyFactor, maxRank - 1 - rankIndex);
    const slackName = `slk_${slackCounter++}_${sanitize(constraintName)}_${side}`;
    objective.vars.push({ name: slackName, coef: penalty });
    bounds.push({ name: slackName, type: GLP.LO, lb: 0, ub: 0 });
    slackMeta.push({ slack: slackName, constraint: constraintName, side, penalty });
    return slackName;
  };

  for (const c of lp.subjectTo) {
    // #2: kullanıcı "zorunlu" işaretlediyse (veya prefix eşleşirse) → HARD say (gevşetilmez)
    const userHard = hardConstraints.length > 0 && priorityIndex(c.name, hardConstraints) >= 0;
    const rank = userHard ? -1 : priorityIndex(c.name, priorityList);
    if (rank < 0) {
      // HARD kısıt — değiştirmeden kopyala
      subjectTo.push({ ...c, vars: c.vars.map(v => ({ ...v })) });
      continue;
    }

    const type = c.bnds.type;
    if (type === GLP.LO) {
      // Σax + s ≥ lb
      const s = addSlack(c.name, rank, 'lo');
      subjectTo.push({
        name: c.name,
        vars: [...c.vars.map(v => ({ ...v })), { name: s, coef: 1 }],
        bnds: { ...c.bnds },
      });
    } else if (type === GLP.UP) {
      // Σax − s ≤ ub
      const s = addSlack(c.name, rank, 'up');
      subjectTo.push({
        name: c.name,
        vars: [...c.vars.map(v => ({ ...v })), { name: s, coef: -1 }],
        bnds: { ...c.bnds },
      });
    } else if (type === GLP.DB) {
      // lb ≤ Σax ≤ ub → iki kısıta böl, her birine slack
      const sLo = addSlack(c.name, rank, 'lo');
      const sUp = addSlack(c.name, rank, 'up');
      subjectTo.push({
        name: `${c.name}_lo`,
        vars: [...c.vars.map(v => ({ ...v })), { name: sLo, coef: 1 }],
        bnds: { type: GLP.LO, lb: c.bnds.lb, ub: 0 },
      });
      subjectTo.push({
        name: `${c.name}_up`,
        vars: [...c.vars.map(v => ({ ...v })), { name: sUp, coef: -1 }],
        bnds: { type: GLP.UP, lb: 0, ub: c.bnds.ub },
      });
    } else {
      // FX veya bilinmeyen — gevşetme, hard kopyala
      subjectTo.push({ ...c, vars: c.vars.map(v => ({ ...v })) });
    }
  }

  const relaxedLP = {
    ...lp,
    objective,
    subjectTo,
    bounds,
    _meta: { ...lp._meta, relaxed: true },
  };

  return { relaxedLP, slackMeta };
}

/**
 * Çözümden slack > epsilon olan kısıt ihlallerini çıkarır.
 *
 * @param {object} solution — solveLP() çıktısı (relaxedLP için)
 * @param {Array}  slackMeta — relaxLP() çıktısı
 * @param {number} [epsilon=0.01] — ihmal edilebilir slack eşiği
 * @returns {Array<{constraint, side, amount, penalty}>} ihlaller (azalan miktar)
 */
export function extractViolations(solution, slackMeta, epsilon = 0.01) {
  const vars = solution?.vars || {};
  const violations = [];
  for (const m of slackMeta) {
    const amount = vars[m.slack] ?? 0;
    if (amount > epsilon) {
      violations.push({
        constraint: m.constraint,
        side: m.side,             // 'lo' = alt sınır altında, 'up' = üst sınır üstünde
        amount: Math.round(amount * 1000) / 1000,
        penalty: m.penalty,
      });
    }
  }
  // Önce kritiklik (penalty/öncelik) sonra ihlal büyüklüğü — kullanıcı en kritik
  // gevşetilen kısıtı (örn DCAD) en üstte görür.
  violations.sort((a, b) => (b.penalty - a.penalty) || (b.amount - a.amount));
  return violations;
}

/**
 * İhlal listesini insan-okunabilir Türkçe mesajlara çevirir (UI/rapor için).
 * @param {Array} violations — extractViolations() çıktısı
 * @returns {Array<{constraint, message}>}
 */
export function describeViolations(violations) {
  const LABELS = {
    DCAD: 'DCAD (mEq/100g KM)',
    peNDF_min: 'peNDF (%KM)',
    peNDF_max: 'peNDF (%KM)',
    Forage: 'Kaba yem (%KM)',
    Fat_max: 'Yağ (%KM)',
    Fat_min: 'Yağ (%KM)',
    Starch_max: 'Nişasta (%KM)',
    Starch_min: 'Nişasta (%KM)',
    Sugar_max: 'Şeker (%KM)',
    Sugar_min: 'Şeker (%KM)',
    NFC_max: 'NFC (%KM)',
    NFC_min: 'NFC (%KM)',
    PUFA_max: 'PUFA (%KM)',
    PUFA_min: 'PUFA (%KM)',
    n6n3_ratio: 'ω6:ω3 oranı',
    NDF: 'NDF (%KM)',
    ADF_min: 'ADF (%KM)',
    ADF_max: 'ADF (%KM)',
    RDP: 'RDP (%KM)',
    Lys: 'Lizin (g/gün)',
    Met: 'Metiyonin (g/gün)',
    His: 'Histidin (g/gün)',   // FAZ 18.3
    Arg: 'Arginin (g/gün)', Thr: 'Treonin (g/gün)', Ile: 'İzolösin (g/gün)',  // Tam EAA Katman B
    Leu: 'Lösin (g/gün)', Val: 'Valin (g/gün)', Phe: 'Fenilalanin (g/gün)', Trp: 'Triptofan (g/gün)',
  };
  return violations.map(v => {
    let label = LABELS[v.constraint];
    if (!label) {
      if (v.constraint.startsWith('group_')) label = `Yem grubu: ${v.constraint.slice(6)}`;
      else if (v.constraint.startsWith('vit_')) label = `Vitamin: ${v.constraint.slice(4)}`;
      else if (v.constraint.startsWith('trace_')) label = `İz mineral: ${v.constraint.slice(6)}`;
      else label = v.constraint;
    }
    // side: 'lo' = kısıtın ALT sınırı karşılanamadı (hedefin altında kaldı);
    //       'up' = ÜST sınır aşıldı (hedefin üstüne çıkıldı).
    const dir = v.side === 'lo' ? 'minimum hedefin altında kaldı' : 'maksimum hedefi aştı';
    return {
      constraint: v.constraint,
      side: v.side,
      message: `${label}: ${dir}`,
    };
  });
}

// ─── Yardımcı ────────────────────────────────────────────────────────────────

function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_]/g, '_');
}
