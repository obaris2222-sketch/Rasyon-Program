/**
 * Amino Asit Dengesi Modülü
 * Lizin (Lys) ve Metiyonin (Met) — MP içindeki optimum yüzdeler
 * Kaynaklar:
 *   Schwab (1996, 2019); Rulquin (1992); CNCPS v6.5; NRC 2001 Bölüm 3; NASEM 2021
 *
 * FAZ 10B: AA hedefleri artık verim ve döneme göre dinamik (NASEM 2021 yaklaşımı)
 *   - Lys%MP: temel 6.6, +0.024 per kg üzeri 30 MY (ileri verimde daha yüksek)
 *   - Met%MP: temel 2.4, +0.012 per kg üzeri 30 MY
 *   - Geçiş dönemi: Met%MP +0.3 (karaciğer fonksiyonu, Schwab 2019)
 */

// ─── EŞIK AA HEDEFLERİ (NRC 2001 geleneksel — geriye uyumluluk) ──────────────

export const AA_TARGETS = {
  lys: {
    pctMP: 7.00,         // Lizin: %7.0 MP (NRC 2001 — sabit hedef)
    pctMP_min: 6.50,
    pctMP_max: 7.50,
    source: 'Schwab 1996; CNCPS v6.5',
  },
  met: {
    pctMP: 2.60,         // Metiyonin: %2.6 MP
    pctMP_min: 2.30,
    pctMP_max: 2.80,
    source: 'Schwab 1996; CNCPS v6.5',
  },
  // FAZ 18.3: Histidin — süt ineğinde kritik 3. sınırlayıcı AA (özellikle çayır/mısır
  // silajı ağırlıklı, düşük-bypass rasyonlarda). NASEM 2021 / Lapierre 2008 hedef ~%2.2 MP.
  his: {
    pctMP: 2.20,
    pctMP_min: 2.00,
    pctMP_max: 2.50,
    source: 'NASEM 2021; Lapierre 2008',
  },
  // Tam EAA (Katman A — GÖSTERİM): kalan 7 EAA referans %MP profili (NRC 2001 / NASEM 2021
  // ideal EAA profili). Nadiren sınırlayıcı → geniş band; LP kısıtı DEĞİL, yalnız değerlendirme.
  arg: { pctMP: 5.00, pctMP_min: 4.30, pctMP_max: 6.00, source: 'NRC 2001 ideal profil (gösterim)' },
  thr: { pctMP: 4.00, pctMP_min: 3.50, pctMP_max: 4.80, source: 'NRC 2001 ideal profil (gösterim)' },
  ile: { pctMP: 4.20, pctMP_min: 3.70, pctMP_max: 5.00, source: 'NRC 2001 ideal profil (gösterim)' },
  leu: { pctMP: 7.00, pctMP_min: 6.30, pctMP_max: 8.20, source: 'NRC 2001 ideal profil (gösterim)' },
  val: { pctMP: 4.60, pctMP_min: 4.00, pctMP_max: 5.50, source: 'NRC 2001 ideal profil (gösterim)' },
  phe: { pctMP: 5.00, pctMP_min: 4.30, pctMP_max: 6.00, source: 'NRC 2001 ideal profil (gösterim)' },
  trp: { pctMP: 1.30, pctMP_min: 1.00, pctMP_max: 1.70, source: 'NRC 2001 ideal profil (gösterim)' },
  lysMet_ratio: {
    min: 2.6,            // Lys:Met ≥ 2.6:1 (NRC 2001)
    ideal: 2.8,
    source: 'NRC 2001',
  },
};

// FAZ — Tam EAA (Katman A): Lys/Met/His LP'de kısıtlanır (aaMap lpBuilder'da);
// Arg/Thr/Ile/Leu/Val/Phe/Trp GÖSTERİM amaçlıdır (LP kısıtı değil — nadiren sınırlayıcı,
// yem DB ölçülü kapsam ~%2; tedarik büyük oranda mikrobiyal proteinden). Kanonik EAA listesi:
export const EAA_LIST = ['lys', 'met', 'his', 'arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp'];

// ─── MİKROBİYAL PROTEİN AA İÇERİĞİ (FAZ 13.15 + 18.3 + Tam EAA) ─────────────
// Mikrobiyal proteinin AA içeriği (% gerçek protein). Lys/Met/His bilim sistemine göre
// (NRC 2001: Lys 7.90/Met 2.65/His 2.10; NASEM 2021: Lys 7.30/Met 2.40/His 2.00).
// Kalan 7 EAA: NRC 2001 Tablo 15-1 bakteriyel AA bileşimi (sistemler arası ~aynı; literatürde
// Arg/Thr/Ile/Leu/Val/Phe/Trp için NRC↔NASEM farkı ihmal edilebilir). Pipeline default NASEM 2021.
const MICROBIAL_EAA7 = { arg: 5.08, thr: 5.81, ile: 5.74, leu: 7.49, val: 6.24, phe: 5.36, trp: 1.49 };
export const MICROBIAL_AA = {
  NRC2001:   { lys: 7.90, met: 2.65, his: 2.10, ...MICROBIAL_EAA7 },
  NASEM2021: { lys: 7.30, met: 2.40, his: 2.00, ...MICROBIAL_EAA7 },
};

// Tipik RUP (yem protein) AA içeriği (% protein) — yem DB'de ÖLÇÜLÜ değer yoksa varsayılan.
// Lys/Met/His mevcut değerler (6.5/2.0/2.3); 7 EAA tipik yemlik protein ortalaması (NRC 2001).
export const RUP_AA_DEFAULTS = {
  lys: 6.5, met: 2.0, his: 2.3,
  arg: 4.6, thr: 3.7, ile: 4.0, leu: 8.0, val: 4.9, phe: 4.8, trp: 1.1,
};

/**
 * Dinamik AA hedefleri (NASEM 2021 yaklaşımı) — FAZ 10B
 *
 * Verim ve döneme göre Lys/Met %MP hedeflerini hesaplar.
 *
 * Modeller:
 *   - NASEM 2021: yüksek verimde AA gereksinimi daha katı (süt protein doygunluğu için)
 *   - Schwab (2019): geçiş döneminde Met +0.3 (lipotropik etki, karaciğer)
 *   - Rulquin (1992): Lys:Met oranı 2.8 ideal, ≥2.6 minimum
 *
 * @param {object} animal
 *   @param {number} animal.milkYield      - Süt verimi (kg/gün)
 *   @param {string} animal.lactationStage - 'early'|'mid'|'late'|'far_off'|'close_up'
 *   @param {number} [animal.parity]
 * @returns {object} { lys, met, lysMet_ratio } — pctMP hedefleri ve sınırları
 */
export function calcAATargets(animal = {}) {
  const my = Number(animal.milkYield) || 25;
  const stage = animal.lactationStage || 'early';

  // Verim üzerine ekleme (her +1 kg MY 30 üstü için +0.024 Lys%, +0.012 Met%)
  const myDelta = Math.max(0, my - 30);
  let lysPctMP = 6.6 + myDelta * 0.024;
  let metPctMP = 2.4 + myDelta * 0.012;

  // Düşük verim için minimum hedef düşürülür (aşırı RPLys/RPMet önerisinden kaçınma)
  if (my < 25) {
    lysPctMP = Math.max(6.0, 6.6 - (25 - my) * 0.04);
    metPctMP = Math.max(2.2, 2.4 - (25 - my) * 0.02);
  }

  // FAZ 18.3: Histidin hedefi — verimle hafif artar; geçişte hafif yükselir.
  let hisPctMP = 2.2 + myDelta * 0.008;
  if (my < 25) hisPctMP = Math.max(2.0, 2.2 - (25 - my) * 0.015);

  // Geçiş dönemi Met düzeltmesi (Schwab 2019): karaciğer lipotropik etki
  if (stage === 'close_up' || stage === 'far_off') {
    metPctMP += 0.3;
    hisPctMP += 0.1;   // FAZ 18.3
  }

  // Erken laktasyonda (DIM<60) Lys hafif artar (peak verim için)
  if (stage === 'early') {
    lysPctMP += 0.2;
  }

  // Tutarlılık: aralık sınırları
  lysPctMP = Math.max(6.0, Math.min(7.6, lysPctMP));
  metPctMP = Math.max(2.2, Math.min(3.0, metPctMP));
  hisPctMP = Math.max(2.0, Math.min(2.6, hisPctMP));   // FAZ 18.3

  // Lys:Met oranı — geçişte daha yüksek hedef (2.8 ideal)
  const ratioMin = stage === 'close_up' ? 2.4 : 2.6;
  const ratioIdeal = stage === 'close_up' ? 2.6 : 2.8;

  const r1 = v => Math.round(v * 100) / 100;
  return {
    lys: {
      pctMP: r1(lysPctMP),
      pctMP_min: r1(lysPctMP - 0.5),
      pctMP_max: r1(lysPctMP + 0.5),
      source: 'NASEM 2021 + Schwab 2019 dinamik',
    },
    met: {
      pctMP: r1(metPctMP),
      pctMP_min: r1(metPctMP - 0.3),
      pctMP_max: r1(metPctMP + 0.3),
      source: 'NASEM 2021 + Schwab 2019 dinamik',
    },
    his: {   // FAZ 18.3: Histidin (kritik 3. AA)
      pctMP: r1(hisPctMP),
      pctMP_min: r1(hisPctMP - 0.2),
      pctMP_max: r1(hisPctMP + 0.3),
      source: 'NASEM 2021; Lapierre 2008 dinamik',
    },
    // Tam EAA (Katman A — GÖSTERİM): kalan 7 EAA statik referans hedefi (AA_TARGETS).
    // Dinamik düzeltme yok (nadiren sınırlayıcı; verim/döneme duyarsız referans profil).
    arg: { ...AA_TARGETS.arg }, thr: { ...AA_TARGETS.thr }, ile: { ...AA_TARGETS.ile },
    leu: { ...AA_TARGETS.leu }, val: { ...AA_TARGETS.val }, phe: { ...AA_TARGETS.phe }, trp: { ...AA_TARGETS.trp },
    lysMet_ratio: {
      min: ratioMin,
      ideal: ratioIdeal,
      source: 'Rulquin 1992',
    },
  };
}

// ─── AA GEREKSİNİM HESABI ────────────────────────────────────────────────────

/**
 * Süt protein verimi için Lys ve Met gereksinimleri (g/gün)
 * @param {number} mpTotal      - Toplam MP gereksinimi (g/gün)
 * @param {number} lysPctMP     - Hedef Lys (%MP, varsayılan 7.0 — NRC 2001 sabit)
 * @param {number} metPctMP     - Hedef Met (%MP, varsayılan 2.6 — NRC 2001 sabit)
 * @returns {object} { lys_g, met_g, ratio }
 *
 * NOT: FAZ 10B sonrası `calcAATargets(animal)` ile dinamik hesaplama yapıp
 * sonuçları buraya yansıtmak önerilir.
 */
export function calcAARequirements(mpTotal, lysPctMP = 7.0, metPctMP = 2.6, hisPctMP = 2.2, extraPctMP = null) {
  const r1 = v => Math.round(v * 10) / 10;
  const lys_g = (mpTotal * lysPctMP) / 100;
  const met_g = (mpTotal * metPctMP) / 100;
  const out = {
    lys_g: r1(lys_g),
    met_g: r1(met_g),
    his_g: r1((mpTotal * hisPctMP) / 100),     // FAZ 18.3
    ratio: Math.round((lys_g / met_g) * 100) / 100,
  };
  // Tam EAA (Katman A — GÖSTERİM): 7 EAA gereksinimi (extraPctMP = {arg, thr, ...} %MP).
  if (extraPctMP) {
    for (const aa of ['arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp']) {
      if (extraPctMP[aa] != null) out[`${aa}_g`] = r1((mpTotal * extraPctMP[aa]) / 100);
    }
  }
  return out;
}

// ─── AA TEDARİK HESABI ───────────────────────────────────────────────────────

/**
 * Rasyon AA tedariki (Lys + Met)
 * Kaynaklar: yem AA profilleri (% ham protein)
 * @param {object} params
 *   @param {number} params.mpMicrobial_g  - Mikrobiyal MP (g/gün)
 *   @param {number} params.mpRUP_g        - RUP kaynaklı MP (g/gün)
 *   @param {number} params.rupLysPct      - Ağırlıklı ortalama RUP Lys (% protein)
 *   @param {number} params.rupMetPct      - Ağırlıklı ortalama RUP Met (% protein)
 *   @param {number} params.intestinalD    - RUP intestinal sindirilebilirlik (%, varsayılan 80)
 * @returns {object} Lys ve Met tedariki (g/gün ve %MP)
 */
export function calcAASupply(params) {
  const {
    mpMicrobial_g,
    mpRUP_g,
    intestinalD = 80,
    system = 'NASEM2021',  // FAZ 13.15: mikrobiyal AA içerik kaynağı
    rupPctByAA = null,     // Tam EAA: { lys, met, his, arg, ... } ağırlıklı RUP % (öncelikli)
  } = params;

  const mpTotal = mpMicrobial_g + mpRUP_g;
  const mcpAA = MICROBIAL_AA[system] || MICROBIAL_AA.NASEM2021;

  // RUP % seçimi (öncelik): rupPctByAA[aa] > bireysel rupLysPct/rupMetPct/rupHisPct (geriye
  // uyumluluk) > RUP_AA_DEFAULTS[aa]. (Eski çağrılar yalnız Lys/Met/His geçirir — korunur.)
  const indiv = { lys: params.rupLysPct, met: params.rupMetPct, his: params.rupHisPct };
  const rupPctFor = (aa) => (rupPctByAA && rupPctByAA[aa] != null) ? rupPctByAA[aa]
    : (indiv[aa] != null ? indiv[aa] : RUP_AA_DEFAULTS[aa]);

  // Tek AA için tedarik (g/gün) = mikrobiyal (MCP×içerik) + RUP (sindirilmiş)
  const supplyAA = (mcpPct, rupPct) => {
    const fromMCP = mpMicrobial_g * mcpPct / 100;
    const fromRUP = mpRUP_g * rupPct / 100 * (intestinalD / 100);
    return { fromMCP, fromRUP, total: fromMCP + fromRUP };
  };
  const pack = (s) => ({
    total_g: Math.round(s.total * 10) / 10,
    fromMCP_g: Math.round(s.fromMCP * 10) / 10,
    fromRUP_g: Math.round(s.fromRUP * 10) / 10,
    pctMP: mpTotal > 0 ? Math.round((s.total / mpTotal) * 100 * 100) / 100 : 0,
  });

  const out = { mpTotal_g: Math.round(mpTotal) };
  for (const aa of EAA_LIST) {
    out[aa] = pack(supplyAA(mcpAA[aa] ?? RUP_AA_DEFAULTS[aa] ?? 0, rupPctFor(aa)));
  }
  out.lysMet_ratio = out.met.total_g > 0
    ? Math.round((out.lys.total_g / out.met.total_g) * 100) / 100
    : null;
  return out;
}

// ─── AA DENGE DEĞERLENDİRMESİ ────────────────────────────────────────────────

/**
 * AA denge durumu değerlendirmesi
 * @param {object} supply    - calcAASupply() çıktısı
 * @param {object} requirement - calcAARequirements() çıktısı
 * @param {object} [targets] - Dinamik AA hedefleri (calcAATargets çıktısı); yoksa AA_TARGETS sabiti
 * @returns {object} { lys, met, ratio, overallScore }
 */
export function assessAABalance(supply, requirement, targets = AA_TARGETS) {
  // Tam EAA (Katman A): supply + target olan TÜM EAA'lar değerlendirilir (Lys/Met/His + 7 EAA).
  const statuses = {};
  for (const aa of EAA_LIST) {
    if (supply[aa] && targets[aa]) {
      statuses[aa] = assessSingleAA(supply[aa], requirement[`${aa}_g`] ?? 0, supply[aa].pctMP, targets[aa]);
    }
  }

  const ratioMin = targets.lysMet_ratio?.min ?? AA_TARGETS.lysMet_ratio.min;
  const ratioOk = supply.lysMet_ratio >= ratioMin;
  const ratioStatus = ratioOk ? 'ok' : 'below_target';

  // İlk-sınırlayıcı AA — hedefe oranı (pctMP/hedef) en düşük olan EAA (10 AA üzerinden).
  const firstLimiting = computeFirstLimitingAA(statuses, targets);

  return {
    ...statuses,        // lys, met, his (+ arg, thr, ile, leu, val, phe, trp — mevcut olanlar)
    ratio: {
      actual: supply.lysMet_ratio,
      target: ratioMin,
      status: ratioStatus,
    },
    firstLimiting,      // { aa, pctOfTarget } | null
    // Skor pratikte sınırlayıcı Lys/Met/His ile hesaplanır (7 EAA GÖSTERİM → skoru düşürmez).
    overallScore: calcAAScore(statuses.lys, statuses.met, ratioOk, statuses.his),
  };
}

/**
 * FAZ 18.3: İlk-sınırlayıcı AA — tedarik/hedef (pctMP) oranı en düşük olan EAA.
 * Oran < %100 ise o AA hedefin altında; en düşük olan "ilk sınırlayıcı"dır.
 * @returns {{ aa: string, pctOfTarget: number } | null}
 */
function computeFirstLimitingAA(statuses, targets) {
  let limiting = null, minRatio = Infinity;
  for (const [aa, st] of Object.entries(statuses)) {
    if (!st) continue;
    const tgt = targets[aa]?.pctMP;
    if (!tgt || tgt <= 0) continue;
    const ratio = st.pctMP / tgt;
    if (ratio < minRatio) { minRatio = ratio; limiting = aa; }
  }
  return limiting ? { aa: limiting, pctOfTarget: Math.round(minRatio * 100) } : null;
}

function assessSingleAA(supply, requiredG, pctMP, target) {
  const deficitG = requiredG - supply.total_g;
  const pctOfTarget = (pctMP / target.pctMP) * 100;

  let status;
  if (pctMP >= target.pctMP_min && pctMP <= target.pctMP_max) {
    status = 'optimal';
  } else if (pctMP < target.pctMP_min) {
    status = pctOfTarget < 85 ? 'deficient' : 'marginal';
  } else {
    status = 'excess';
  }

  return {
    supplied_g: supply.total_g,
    required_g: Math.round(requiredG * 10) / 10,
    deficit_g: Math.round(deficitG * 10) / 10,
    pctMP,
    targetPctMP: target.pctMP,
    status,
  };
}

function calcAAScore(lysStatus, metStatus, ratioOk, hisStatus = null) {
  let score = 100;
  if (lysStatus.status === 'deficient') score -= 30;
  else if (lysStatus.status === 'marginal') score -= 15;
  if (metStatus.status === 'deficient') score -= 30;
  else if (metStatus.status === 'marginal') score -= 15;
  // FAZ 18.3: His kritik 3. AA — açık/marjinal cezalandırılır (Lys/Met'ten hafif düşük)
  if (hisStatus) {
    if (hisStatus.status === 'deficient') score -= 20;
    else if (hisStatus.status === 'marginal') score -= 10;
  }
  if (!ratioOk) score -= 10;
  return Math.max(0, score);
}

// ─── KORUYUCU AA KAYNAĞI ÖNERİSİ ─────────────────────────────────────────────

/**
 * Rumen korumalı Met/Lys kaynağı tavsiyesi
 * @param {object} assessment - assessAABalance() çıktısı
 * @param {number} mpTotal    - Toplam MP gereksinimi (g/gün)
 * @returns {object} Öneri miktarları
 */
export function recommendRPAA(assessment, mpTotal, targets = AA_TARGETS) {
  const recommendations = [];
  const lysTarget = targets.lys?.pctMP ?? AA_TARGETS.lys.pctMP;
  const metTarget = targets.met?.pctMP ?? AA_TARGETS.met.pctMP;

  if (assessment.met.status === 'deficient' || assessment.met.status === 'marginal') {
    const metDeficit = Math.max(0, mpTotal * metTarget / 100 - assessment.met.supplied_g);
    recommendations.push({
      type: 'RPMet',
      name: 'Rumen korumalı metiyonin',
      deficitG: Math.round(metDeficit * 10) / 10,
      note: 'HMBi veya Smartamine M: ~0.1 g/kg süt hedefi',
    });
  }

  if (assessment.lys.status === 'deficient' || assessment.lys.status === 'marginal') {
    const lysDeficit = Math.max(0, mpTotal * lysTarget / 100 - assessment.lys.supplied_g);
    recommendations.push({
      type: 'RPLys',
      name: 'Rumen korumalı lizin',
      deficitG: Math.round(lysDeficit * 10) / 10,
      note: 'AjiPro-L veya eşdeğeri',
    });
  }

  return recommendations;
}
