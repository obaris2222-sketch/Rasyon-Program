/**
 * FAZ 20.3 — Senaryo Karşılaştırma
 *
 * AYNI hayvan + yem seti için farklı optimizasyon AYARLARINI (amaç / hesap modu) yan-yana
 * çözüp karşılaştırır — danışmanın "ucuz mu, dengeli mi, mekanistik mi?" kararını destekler.
 * Her senaryo mevcut optimizeRation'ı (worker) yeniden kullanır (yeni çözücü yok).
 *
 * v1 senaryolar (hepsi mevcut yeteneklerle GERÇEK; sahte "düşük metan amacı" yok — LP'de
 * metan amacı olmadığından metan yalnız SONUÇ olarak karşılaştırılır):
 *   💰 En ucuz       — objective: cost (tek-geçiş NRC)
 *   ⚖️ Dengeli       — çok-amaçlı: cost + MFD riski + AA dengesi
 *   ⚙️ CNCPS iteratif — calcMode: cncps (pasaj-bağımlı protein)
 */
import { t, feedDisplayName } from '../i18n.js';
import { escHtml } from '../utils.js';

export const SCENARIO_PRESETS = [
  { id: 'cost',     labelKey: 'scen.s_cost',     apply: (b) => ({ ...b, objective: 'cost', objectives: null, calcMode: 'nrc' }) },
  { id: 'balanced', labelKey: 'scen.s_balanced', apply: (b) => ({ ...b, objective: 'cost', objectives: [{ type: 'cost', weight: 1 }, { type: 'mfd_risk', weight: 1 }, { type: 'aa_balance', weight: 1 }], calcMode: 'nrc' }) },
  { id: 'cncps',    labelKey: 'scen.s_cncps',    apply: (b) => ({ ...b, objective: 'cost', objectives: null, calcMode: 'cncps' }) },
];

/**
 * Her senaryo için optimizasyonu çalıştır (optimizeFn enjekte edilir → test edilebilir).
 * @param {object} baseInput - çözülmüş optimize input (animal, feeds, feedLimits, system, ...)
 * @param {(input:object)=>Promise<object>} optimizeFn - optimizeViaWorker (veya test mock)
 * @param {Array} [presets=SCENARIO_PRESETS]
 * @returns {Promise<Array<{id, labelKey, result, error}>>}
 */
export async function runScenarioComparison(baseInput, optimizeFn, presets = SCENARIO_PRESETS) {
  const out = [];
  for (const p of presets) {
    let result = null, error = null;
    try { result = await optimizeFn(p.apply({ ...baseInput })); }
    catch (e) { error = e?.message || String(e); }
    out.push({ id: p.id, labelKey: p.labelKey, result, error });
  }
  return out;
}

function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }

/**
 * Bir senaryo sonucundan karşılaştırma metrikleri çıkar.
 * IOFC (yem üstü gelir) = süt geliri − yem maliyeti (basit); milkPrice yoksa null.
 */
export function scenarioMetrics(result, { milkYield = 0, milkPrice = 0 } = {}) {
  if (!result) return null;
  const c = result.composition || {};
  const aas = result.aminoAcids?.supply || {};   // FAZ 23.4: 7 EAA tedariği (opsiyonel detay)
  const feedCost = num(result.totalCost);
  const iofc = milkPrice > 0 ? num(milkYield) * num(milkPrice) - feedCost : null;
  return {
    feasible: result.feasible === true,
    relaxed: result.relaxation?.applied === true,
    dmi: num(result.dmi?.achieved_kg),
    cost: feedCost,
    iofc,
    nel: num(c.nel_mcal),
    mp: num(c.mp_g),
    ndf: num(c.ndf_pct),
    peNDF: num(c.peNDF_pct),
    lys: num(c.lys_g),
    met: num(c.met_g),
    his: num(c.his_g),   // sınırlayıcı trio (Lys/Met/His) — kompakt tabloda
    // FAZ 23.4: 7 EAA gösterim (opsiyonel "Detaylı AA" toggle'ında) — tedarik g/gün
    eaa: {
      arg: num(aas.arg?.total_g), thr: num(aas.thr?.total_g), ile: num(aas.ile?.total_g),
      leu: num(aas.leu?.total_g), val: num(aas.val?.total_g), phe: num(aas.phe?.total_g), trp: num(aas.trp?.total_g),
    },
    methane: num(result.methane?.production_g),
  };
}

const fmt = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '—';
const money = (v) => Number.isFinite(v) ? Math.round(v).toLocaleString() : '—';

/**
 * Senaryoları yan-yana karşılaştırma tablosu (metrik satırları × senaryo sütunları) +
 * her senaryonun ilk birkaç yemi. En düşük maliyet vurgulanır.
 * @param {Array} scenarios - runScenarioComparison çıktısı
 * @param {object} [ctx] - { milkYield, milkPrice }
 * @returns {string} HTML
 */
export function renderScenarioComparison(scenarios, ctx = {}) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) return '';
  const cols = scenarios.map(s => ({ ...s, m: scenarioMetrics(s.result, ctx) }));

  // En düşük maliyetli FİZİBİL senaryo (vurgu)
  const feasibleCosts = cols.filter(c => c.m && c.m.feasible).map(c => c.m.cost);
  const minCost = feasibleCosts.length ? Math.min(...feasibleCosts) : null;
  const hasMilk = num(ctx.milkPrice) > 0;

  const head = `<th>${t('scen.metric')}</th>` + cols.map(c => `<th class="num">${t(c.labelKey)}</th>`).join('');

  const statusCell = (c) => {
    if (c.error) return `<td class="num" style="color:var(--danger)">${t('scen.error')}</td>`;
    if (!c.m) return '<td class="num">—</td>';
    if (!c.m.feasible) return `<td class="num" style="color:var(--warning)">${c.m.relaxed ? t('scen.relaxed') : t('scen.infeasible')}</td>`;
    return `<td class="num" style="color:var(--success)"><i class="ti ti-check"></i></td>`;
  };

  const row = (labelKey, pick, opts = {}) => {
    const cells = cols.map(c => {
      if (!c.m) return '<td class="num">—</td>';
      const val = pick(c.m);
      const isBestCost = opts.cost && Number.isFinite(val) && minCost != null && Math.abs(val - minCost) < 0.01 && c.m.feasible;
      const style = isBestCost ? ' style="color:var(--primary); font-weight:700"' : '';
      return `<td class="num"${style}>${opts.render ? opts.render(val) : fmt(val, opts.d ?? 1)}</td>`;
    });
    return `<tr><td>${t(labelKey)}</td>${cells.join('')}</tr>`;
  };

  const metricRows = [
    `<tr><td><b>${t('scen.status')}</b></td>${cols.map(statusCell).join('')}</tr>`,
    row('scen.cost', m => m.cost, { cost: true, render: money }),
    ...(hasMilk ? [row('scen.iofc', m => m.iofc, { render: money })] : []),
    row('scen.dmi', m => m.dmi, { d: 1 }),
    row('scen.nel', m => m.nel, { d: 1 }),
    row('scen.mp', m => m.mp, { render: v => money(v) }),
    row('scen.ndf', m => m.ndf, { d: 1 }),
    row('scen.pendf', m => m.peNDF, { d: 1 }),
    row('scen.lys', m => m.lys, { render: v => money(v) }),
    row('scen.met', m => m.met, { d: 1 }),
    row('scen.his', m => m.his, { d: 1 }),
    row('scen.methane', m => m.methane, { render: v => money(v) }),
  ].join('');

  // FAZ 23.4: Diğer 7 EAA (gösterim) — opsiyonel katlanır detay (kompakt tabloyu şişirmez).
  // Yalnız en az bir senaryoda AA tedarik verisi varsa göster (aksi tüm satırlar 0.0 → yanıltıcı).
  const hasEaaData = cols.some(c => c.result?.aminoAcids?.supply);
  const EAA_COLS = [['Arg', 'arg'], ['Thr', 'thr'], ['Ile', 'ile'], ['Leu', 'leu'], ['Val', 'val'], ['Phe', 'phe'], ['Trp', 'trp']];
  const eaaRows = EAA_COLS.map(([lbl, key]) => {
    const cells = cols.map(c => c.m ? `<td class="num">${fmt(c.m.eaa?.[key], 1)}</td>` : '<td class="num">—</td>').join('');
    return `<tr><td>${lbl} <span class="text-muted text-small">(g)</span></td>${cells}</tr>`;
  }).join('');
  const eaaDetails = hasEaaData ? `
    <details class="mt-1">
      <summary class="text-small" style="cursor:pointer">${t('scen.show_eaa')}</summary>
      <div style="overflow-x:auto">
        <table class="diag-table mt-1"><thead><tr>${head}</tr></thead><tbody>${eaaRows}</tbody></table>
      </div>
    </details>` : '';

  // Her senaryonun başlıca yemleri (ilk 4, KM'ye göre)
  const feedLists = cols.map(c => {
    const items = (c.result?.items || []).slice().sort((a, b) => b.dmKg - a.dmKg).slice(0, 4);
    const li = items.map(it => `<li>${escHtml(feedDisplayName(it) || it.name)} <span class="text-muted">${fmt(it.dmKg, 1)} kg</span></li>`).join('');
    return `<div class="scen-feedlist"><div class="text-small" style="font-weight:600">${t(c.labelKey)}</div><ul class="text-small">${li || '—'}</ul></div>`;
  }).join('');

  return `
    <div class="info-box box-info text-small">${t('scen.intro')}</div>
    <div style="overflow-x:auto">
      <table class="diag-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${metricRows}</tbody>
      </table>
    </div>
    ${eaaDetails}
    <div class="section-title mt-2">${t('scen.rations')}</div>
    <div class="scen-feedlists" style="display:flex; gap:1rem; flex-wrap:wrap">${feedLists}</div>
    <div class="text-small text-muted mt-2">${t('scen.note')}</div>
  `;
}
