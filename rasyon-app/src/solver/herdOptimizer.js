/**
 * FAZ 20.2 — Sürü-Geneli Eşzamanlı Optimizasyon (ortak yem stoğu altında)
 *
 * Toplu sürü her grubu BAĞIMSIZ optimize eder (her grup kendi en-düşük-maliyet rasyonu).
 * Ancak gruplar ORTAK bir yem stoğunu paylaşıyorsa (örn. elde ay boyunca toplam X kg mısır
 * silajı), bağımsız çözümler stoğu aşabilir. Sürü-geneli optimizasyon TÜM grupları TEK
 * birleşik LP'de çözer: her grubun kendi besin kısıtları + gruplar arası ortak stok kısıtı,
 * amaç = toplam sürü maliyeti.
 *
 * Yaklaşım (kısıt mantığını YENİDEN YAZMADAN): her grup için optimizeRation({_returnPrep})
 * ile hazır LP alınır → değişken/kısıt adları grup-bazlı (g<idx>_) yeniden adlandırılır →
 * tek LP'ye birleştirilir → ortak stok kısıtları eklenir → bir kez çözülür → grup rasyonları
 * çözümden çıkarılır. Ortak kısıt yoksa LP blok-köşegen olur → bağımsız optimumların birleşimi
 * (toplu sürü ile aynı); değer, stok bağlayıcı olunca ortaya çıkar.
 *
 * v1 KAPSAM: ortak YEM STOĞU (as-fed kg/gün) kısıtı; saf LP (NRC; MILP/CNCPS hesap modu yok).
 * FAZ 23.1: opsiyonel toplam günlük BÜTÇE kısıtı (₺/gün; sürü-geneli yem maliyeti tavanı).
 * FAZ 23.2: opsiyonel iz mineral/vitamin DAHİL (includeMicros) — min tarafına SOFT slack
 *   (premiks varsa karşılanır; yoksa açık raporlanır), max (toksisite) hard; default kapalı
 *   (mevcut davranış: micros hariç → premikssiz hard-infeasible önlenir). MILP sürü-geneli
 *   kapsam dışı kalır (birleşik MILP boyut/performans riski → "saf-LP" etiketi korunur).
 */
import { GLP } from './lpBuilder.js';
import { solveLP } from './glpkSolver.js';
import { optimizeRation } from './rationOptimizer.js';

function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function r(v, d = 2) { const f = 10 ** d; return Math.round(num(v) * f) / f; }

/**
 * @param {object} args
 *   @param {Array}  args.groups  — [{ id, name, profile (AnimalProfile), size (hayvan sayısı) }]
 *   @param {Array}  args.feeds   — kullanılabilir yemler (tüm gruplar aynı set)
 *   @param {object} [args.sharedStock] — { feedId: maxAsFedKgPerDay } (sürü/gün toplam stok)
 *   @param {string} [args.system]
 *   @param {string} [args.dmiMethod='auto']
 *   @param {boolean}[args.autoEnergyDiscount=false]
 * @returns {Promise<object>} { feasible, status, message, groups:[...], totalCost, stockUsage:[...] }
 */
export async function optimizeHerd({ groups, feeds, sharedStock = {}, feedLimits = {}, groupLimits = {}, system, dmiMethod = 'auto', autoEnergyDiscount = false, budget = 0, includeMicros = false } = {}) {
  if (!Array.isArray(groups) || groups.length === 0) throw new Error('optimizeHerd: groups gerekli');
  if (!Array.isArray(feeds) || feeds.length === 0) throw new Error('optimizeHerd: feeds gerekli');

  const usable = groups.filter(g => g && g.profile && num(g.size, 0) > 0);
  if (usable.length === 0) throw new Error('optimizeHerd: geçerli grup (profil + hayvan sayısı) yok');

  // 1. Her grup için hazır LP (çözmeden) — optimizeRation kısıt mantığını yeniden kullan.
  const preps = [];
  for (const g of usable) {
    const prep = await optimizeRation({
      animal: g.profile, feeds, feedLimits, groupLimits, system, dmiMethod, autoEnergyDiscount, _returnPrep: true,
    });
    preps.push({ group: g, prep, size: num(g.size, 1) });
  }

  // 2. Birleşik LP: değişken/kısıt adlarını g<idx>_ ile yeniden adlandır; objektif katsayısını
  //    grup büyüklüğüyle ölçekle (per-animal maliyet → grup toplam maliyeti).
  const objVars = [];
  const subjectTo = [];
  const bounds = [];
  const groupMeta = [];   // [{ feedIds, varNames(remapped), size }]
  const microSlackVars = [];   // FAZ 23.2: [{ name, constraint, group }] — ihlal raporu için
  let microSlackCounter = 0;
  // Mikro slack cezası: yem maliyetinden (~1e2–1e4) DEVASA büyük → micro açığı yalnız GERÇEKTEN
  // karşılanamıyorsa (premiks yoksa) kabul edilir; aksi halde solver premiksi ölçekler.
  const MICRO_PENALTY = 1e6;

  preps.forEach(({ prep, size }, gIdx) => {
    const pfx = `g${gIdx}_`;
    const lp = prep.lp;
    for (const v of lp.objective.vars) objVars.push({ name: pfx + v.name, coef: v.coef * size });
    for (const c of lp.subjectTo) {
      const isMicro = /^(trace_|vit_)/.test(c.name);
      // Default (includeMicros=false): iz mineral + vitamin kısıtları herd LP'den ÇIKARILIR —
      // premiks-tedarikli mikro-besinler; tek-grup yolu da kaynak yetersizse gevşetir → herd'de
      // gevşetme olmadığından, hariç tutulmazsa premikssiz hard-infeasible olur.
      if (isMicro && !includeMicros) continue;
      const rvars = c.vars.map(v => ({ name: pfx + v.name, coef: v.coef }));
      if (isMicro) {
        // FAZ 23.2: min (eksiklik) tarafına SOFT slack (premiks varsa karşılanır, yoksa raporlanır);
        // max (toksisite) HARD kalır (premiks ölçeklenebilir olduğundan bağlamaz).
        const hasLower = c.bnds.type === GLP.LO || c.bnds.type === GLP.DB;
        if (hasLower) {
          const sName = `mslk${microSlackCounter++}`;
          objVars.push({ name: sName, coef: MICRO_PENALTY });
          bounds.push({ name: sName, type: GLP.LO, lb: 0, ub: 0 });
          microSlackVars.push({ name: sName, constraint: c.name, group: gIdx });
          if (c.bnds.type === GLP.DB) {
            subjectTo.push({ name: `${pfx}${c.name}_lo`, vars: [...rvars, { name: sName, coef: 1 }], bnds: { type: GLP.LO, lb: c.bnds.lb } });
            subjectTo.push({ name: `${pfx}${c.name}_up`, vars: rvars, bnds: { type: GLP.UP, ub: c.bnds.ub } });
          } else {
            subjectTo.push({ name: pfx + c.name, vars: [...rvars, { name: sName, coef: 1 }], bnds: { ...c.bnds } });
          }
        } else {
          subjectTo.push({ name: pfx + c.name, vars: rvars, bnds: { ...c.bnds } });   // yalnız UP — slack gerekmez
        }
      } else {
        subjectTo.push({ name: pfx + c.name, vars: rvars, bnds: { ...c.bnds } });
      }
    }
    if (Array.isArray(lp.bounds)) for (const b of lp.bounds) bounds.push({ ...b, name: pfx + b.name });
    groupMeta.push({ varNames: lp._meta.varNames.map(vn => pfx + vn), size });
  });

  // 3. Ortak yem-stoğu kısıtları: Σ_g (x_{g,i}[kg KM] / DMfrac_i × size_g) ≤ stok_i [as-fed kg/gün]
  const feedIndexById = new Map(feeds.map((f, k) => [f.id, k]));
  const stockMeta = [];   // [{ feedId, k, limit }]
  for (let k = 0; k < feeds.length; k++) {
    const feed = feeds[k];
    const limit = num(sharedStock[feed.id], 0);
    if (!(limit > 0)) continue;
    const dmFrac = (num(feed.dm) || 90) / 100;
    const vars = groupMeta.map(gm => ({ name: gm.varNames[k], coef: gm.size / dmFrac }));
    subjectTo.push({ name: `stock_${k}`, vars, bnds: { type: GLP.UP, ub: limit } });
    stockMeta.push({ feedId: feed.id, k, limit });
  }

  // 3b. FAZ 23.1: opsiyonel toplam günlük BÜTÇE kısıtı (₺/gün). objVars feed maliyet terimleridir;
  //     micro slack (mslk*, MICRO_PENALTY) DAHİL EDİLMEZ → bütçe yalnız gerçek yem maliyetini bağlar.
  const budgetVal = num(budget, 0);
  if (budgetVal > 0) {
    const costVars = objVars.filter(v => !/^mslk/.test(v.name)).map(v => ({ name: v.name, coef: v.coef }));
    subjectTo.push({ name: 'herd_budget', vars: costVars, bnds: { type: GLP.UP, ub: budgetVal } });
  }

  const combinedLP = {
    name: 'herd',
    objective: { direction: GLP.MIN, name: 'herd_cost', vars: objVars },
    subjectTo,
    bounds,
  };

  // 4. Çöz (GLP_UNDEF → presol kapalı yeniden dene; tek-kaynak robustluk).
  let solution = await solveLP(combinedLP);
  if (solution.statusName === 'undef') solution = await solveLP(combinedLP, { presol: false });
  const feasible = solution.optimal;
  const vars = solution.vars || {};

  // 5. Grup rasyonlarını çözümden çıkar.
  const groupResults = preps.map(({ group, prep, size }, gIdx) => {
    const gm = groupMeta[gIdx];
    const items = [];
    let costPerAnimal = 0;
    for (let k = 0; k < feeds.length; k++) {
      const dmKg = r(vars[gm.varNames[k]], 4);
      if (dmKg <= 0) continue;
      const feed = feeds[k];
      const dmFrac = (num(feed.dm) || 90) / 100;
      const asFedKg = dmKg / dmFrac;
      const itemCost = asFedKg * num(feed.pricePerTon) / 1000;   // TL/gün (hayvan başına)
      costPerAnimal += itemCost;
      items.push({
        id: feed.id, name: feed.name, nameEn: feed.nameEn, category: feed.category,
        dmKg, asFedKg: r(asFedKg, 3), costPerDay: r(itemCost, 2),
      });
    }
    return {
      id: group.id, name: group.name, size,
      dmi_kg: prep.dmi_kg,
      items,
      costPerAnimal: r(costPerAnimal, 2),
      costGroup: r(costPerAnimal * size, 2),
      requirements: { nel: prep.nel?.total, mp: prep.mp?.total },
    };
  });

  const totalCost = r(groupResults.reduce((s, g) => s + g.costGroup, 0), 2);

  // 6. Ortak stok kullanım raporu.
  const stockUsage = stockMeta.map(({ feedId, k, limit }) => {
    const dmFrac = (num(feeds[k].dm) || 90) / 100;
    let used = 0;
    for (const gm of groupMeta) used += num(vars[gm.varNames[k]]) / dmFrac * gm.size;
    const feed = feeds[k];
    return {
      feedId, name: feed.name, nameEn: feed.nameEn,
      usedAsFedKg: r(used, 1), limitAsFedKg: limit,
      utilizationPct: limit > 0 ? r((used / limit) * 100, 1) : 0,
    };
  });

  // 7. FAZ 23.1: bütçe kullanımı.
  const budgetUsage = budgetVal > 0
    ? { usedTl: totalCost, limitTl: budgetVal, utilizationPct: r((totalCost / budgetVal) * 100, 1) }
    : null;

  // 8. FAZ 23.2: karşılanamayan (slack > 0) iz mineral/vitamin min kısıtları (premiks gerekir).
  const microViolations = [];
  if (includeMicros) {
    for (const s of microSlackVars) {
      const amt = num(vars[s.name]);
      if (amt > 0.01) {
        microViolations.push({
          group: groupResults[s.group]?.name ?? `#${s.group + 1}`,
          nutrient: s.constraint.replace(/^(trace_|vit_)/, ''),
          deficit: r(amt, 2),
        });
      }
    }
  }

  return {
    feasible,
    status: solution.statusName,
    message: feasible
      ? 'Sürü-geneli optimal çözüm bulundu'
      : (solution.message || 'Sürü-geneli çözüm bulunamadı — ortak stok/bütçe yetersiz olabilir'),
    groups: groupResults,
    totalCost,
    stockUsage,
    budgetUsage,        // FAZ 23.1 (null = bütçe verilmedi)
    microViolations,    // FAZ 23.2 ([] = ihlal yok / micros dahil değil)
    objectiveValue: solution.z,
    feedIndexById,   // (rapor/test yardımcısı)
  };
}
