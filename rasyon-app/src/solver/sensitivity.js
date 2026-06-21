/**
 * FAZ 20.1 — LP Duyarlılık Analizi (gölge fiyat + azaltılmış maliyet)
 *
 * İki karar-destek çıktısı, mevcut LP çözümünden (yeniden çözüm gerekmez):
 *   1. Gölge fiyatlar (kısıt dualleri): her BAĞLAYICI kısıtın marjinal maliyeti
 *      (TL/gün, birim başına) — "hangi kısıt maliyeti belirliyor?"
 *   2. Azaltılmış maliyetler (kullanılmayan yemlerin giriş eşiği): bir yemin
 *      rasyona girmesi için fiyatının ne kadar düşmesi gerektiği (TL/ton).
 *
 * ⚠️ GEÇERLİLİK: Yalnız SAF LP + 'yalnız maliyet' amacı + optimal + gevşetilmemiş
 * çözümde anlamlıdır. MILP'te (tam sayı/min-sipariş) dual tanımsızdır; çok-amaçlı
 * veya minDM amacında dual TL değildir; gevşetilmiş (soft) çözümde slack'li problem
 * dualleri yanıltır. Bu durumlarda { applicable:false, reason } döner (panel gizlenir).
 *
 * Azaltılmış maliyet: glpk.js sütun (yem) duallerini DÖNDÜRMEZ → standart formülle
 * hesaplanır:  rc_j = c_j − Σ_i (y_i · a_ij)   (y = satır dualleri, a = kısıt katsayıları).
 * Doğrulama: çözümdeki (bazik) yemlerde rc≈0; kullanılmayan yemlerde rc>0 (in-browser teyit).
 * Fiyat eşiği (TL/ton düşüşü) = rc[TL/kg KM] × 1000 × DM-fraksiyonu
 *   (çünkü objektif katsayısı = (fiyat/1000)/DM-fraksiyonu).
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const EPS = 1e-6;

/**
 * @param {object} args
 *   @param {object} args.lp          — buildRationLP çıktısı (objective, subjectTo, _meta, binaries/generals)
 *   @param {object} args.solution    — solveLP çıktısı (optimal, raw.result.dual, raw.result.vars)
 *   @param {object[]} args.feeds     — LP'ye giren yemler (lp._meta.varNames ile paralel)
 *   @param {string} [args.objective='cost']
 *   @param {Array}  [args.objectives=null]  — çok-amaçlı (verilirse duyarlılık kapatılır)
 *   @param {boolean}[args.relaxApplied=false]
 * @returns {{ applicable:boolean, reason?:string, shadowPrices?:Array, reducedCosts?:Array }}
 */
export function computeSensitivity({ lp, solution, feeds, objective = 'cost', objectives = null, relaxApplied = false } = {}) {
  if (!lp || !solution || !Array.isArray(feeds)) return { applicable: false, reason: 'no_solution' };
  if (!solution.optimal || relaxApplied) return { applicable: false, reason: 'not_optimal' };
  if ((lp.binaries?.length || 0) > 0 || (lp.generals?.length || 0) > 0) return { applicable: false, reason: 'milp' };
  if (objective !== 'cost' || (Array.isArray(objectives) && objectives.length > 0)) return { applicable: false, reason: 'multi_objective' };

  const dual = solution.raw?.result?.dual;
  const vars = solution.raw?.result?.vars;
  if (!dual || !vars) return { applicable: false, reason: 'no_dual' };

  const varNames = lp._meta?.varNames || [];
  // sanitized var-suffix → yem (limit_<suffix> kısıtlarını yem adına çözmek için)
  const suffixToFeed = new Map();
  for (let i = 0; i < feeds.length; i++) {
    const vn = varNames[i];
    if (vn) suffixToFeed.set(vn.replace(/^x_/, ''), feeds[i]);
  }

  // ── 1. Gölge fiyatlar: |dual| > 0 olan (bağlayıcı) kısıtlar ──
  const shadowPrices = [];
  for (const c of lp.subjectTo) {
    const y = dual[c.name];
    if (!Number.isFinite(y) || Math.abs(y) <= EPS) continue;
    const sp = { constraint: c.name, dual: y };
    const m = /^limit_(.+)$/.exec(c.name);   // per-feed üst/alt limit kısıtı → yem adı
    if (m && suffixToFeed.has(m[1])) {
      const f = suffixToFeed.get(m[1]);
      sp.feedLimit = { name: f.name, nameEn: f.nameEn };
    }
    shadowPrices.push(sp);
  }
  shadowPrices.sort((a, b) => Math.abs(b.dual) - Math.abs(a.dual));

  // ── 2. Azaltılmış maliyetler: kullanılmayan (x≈0) yemler, rc > 0 ──
  const objMap = new Map((lp.objective?.vars || []).map(v => [v.name, v.coef]));
  // Her kısıt için {varName → coef} haritası (O(1) erişim) + dual
  const constMaps = lp.subjectTo.map(c => ({ dual: num(dual[c.name]), m: new Map(c.vars.map(v => [v.name, v.coef])) }));
  const reducedCosts = [];
  for (let i = 0; i < feeds.length; i++) {
    const vn = varNames[i];
    if (!vn) continue;
    const x = num(vars[vn]);
    if (x > 1e-4) continue;                 // yalnız kullanılmayan yemler
    let rc = num(objMap.get(vn));
    for (const cm of constMaps) {
      const coef = cm.m.get(vn);
      if (coef !== undefined) rc -= cm.dual * coef;
    }
    if (rc > EPS) {
      const feed = feeds[i];
      const dmFrac = (num(feed.dm) || 90) / 100;
      reducedCosts.push({
        feedId: feed.id,
        name: feed.name,
        nameEn: feed.nameEn,
        category: feed.category,
        reducedCost: rc,                      // TL/kg KM
        currentPrice: num(feed.pricePerTon),  // TL/ton (yaş)
        priceToEnter: rc * 1000 * dmFrac,     // rasyona girmesi için gereken TL/ton düşüşü
      });
    }
  }
  reducedCosts.sort((a, b) => a.priceToEnter - b.priceToEnter);  // girmeye en yakın önce

  return { applicable: true, shadowPrices, reducedCosts };
}
