/**
 * Amino Asit Dengesi paneli (FAZ 15.8 — resultsPanel'den ayrıldı)
 * Lys/Met tedarik-gereksinim, Lys:Met oranı, RP-AA önerileri.
 */

import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

// FAZ 17.5: RP-AA önerisi → yem kütüphanesindeki hazır katkı yemi (LP aday yemi olarak
// "Yem listesine ekle" butonuyla eklenir; tıklama resultsPanel'de yakalanır).
const RPAA_FEED_ID = {
  RPMet: 'min_rumen_protected_methionine',
  RPLys: 'min_rumen_protected_lysine',
};

export function renderAAPanel(aa) {
  if (!aa) {
    return `<p class="text-muted">${t('aa.no_data')}</p>`;
  }
  const { supply, requirement, assessment, recommendations, rupProfile } = aa;

  const statusMap = {
    optimal:   { label: t('aa.st_optimal'),   cls: 'status-ok' },
    marginal:  { label: t('aa.st_marginal'),  cls: 'status-below' },
    deficient: { label: t('aa.st_deficient'), cls: 'status-above' },
    excess:    { label: t('aa.st_excess'),    cls: 'status-below' },
    ok:        { label: t('aa.st_ok'),        cls: 'status-ok' },
    below_target:{label: t('aa.st_below'),   cls: 'status-below' },
  };

  const ratioSt = statusMap[assessment.ratio.status] ?? statusMap.ok;

  // Tam EAA (Katman A): 10 AA adı. Lys/Met/His sınırlayıcı (LP'de); 7 EAA GÖSTERİM.
  const AA_NAME = {
    lys: t('aa.lysine'), met: t('aa.methionine'), his: t('aa.histidine'),
    arg: t('aa.arginine'), thr: t('aa.threonine'), ile: t('aa.isoleucine'), leu: t('aa.leucine'),
    val: t('aa.valine'), phe: t('aa.phenylalanine'), trp: t('aa.tryptophan'),
  };
  const PRIMARY_AA = ['lys', 'met', 'his'];
  const OTHER_AA = ['arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp'];
  const fl = assessment.firstLimiting;

  // Tek AA satırı — sınırlayıcı (Lys/Met/His) kalın/vurgulu, 7 EAA soluk (gösterim).
  const aaRow = (key) => {
    const st = assessment[key];
    if (!st) return '';
    const sup = supply[key];
    const sm = statusMap[st.status] ?? statusMap.optimal;
    const rowCls = st.status === 'optimal' ? 'ok' : (st.status === 'excess' ? 'below' : 'above');
    const nameCell = PRIMARY_AA.includes(key)
      ? `<b>${AA_NAME[key]}</b>` : `<span class="text-muted">${AA_NAME[key]}</span>`;
    return `<tr class="status-row-${rowCls}">
      <td>${nameCell}</td>
      <td class="num">${sup.total_g}</td>
      <td class="num">${st.required_g ?? '—'}</td>
      <td class="num">${sup.pctMP}</td>
      <td class="num">${st.targetPctMP}</td>
      <td><span class="${sm.cls}">${sm.label}</span></td>
    </tr>`;
  };
  const hasOther = OTHER_AA.some(k => assessment[k]);

  const scoreColor = assessment.overallScore >= 85 ? 'var(--primary)'
                  : assessment.overallScore >= 70 ? 'var(--warning)' : 'var(--danger)';

  return `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom:1rem">
      <div class="summary-card" style="background:${scoreColor === 'var(--primary)' ? 'var(--primary-light)' : '#fff3cd'}">
        <div class="val" style="color:${scoreColor}">${assessment.overallScore}</div>
        <div class="lbl">${t('aa.score')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${assessment.ratio.actual ?? '—'}</div>
        <div class="lbl">${t('aa.ratio_label', { target: assessment.ratio.target })}</div>
      </div>
    </div>

    <table class="diag-table">
      <thead>
        <tr>
          <th>${t('aa.col_aa')}</th>
          <th class="num">${t('aa.col_supply')}</th>
          <th class="num">${t('aa.col_requirement')}</th>
          <th class="num">${t('aa.col_pct_mp')}</th>
          <th class="num">${t('aa.col_target_pct_mp')}</th>
          <th>${t('aa.col_status')}</th>
        </tr>
      </thead>
      <tbody>
        ${PRIMARY_AA.map(aaRow).join('')}
        ${hasOther ? `<tr class="aa-section-row"><td colspan="6">${t('aa.other_eaa_header')}</td></tr>` : ''}
        ${OTHER_AA.map(aaRow).join('')}
        <tr class="status-row-${assessment.ratio.status === 'ok' ? 'ok' : 'above'}">
          <td><b>${t('aa.ratio')}</b></td>
          <td class="num" colspan="3">${assessment.ratio.actual ?? '—'}</td>
          <td class="num">≥ ${assessment.ratio.target}</td>
          <td><span class="${ratioSt.cls}">${ratioSt.label}</span></td>
        </tr>
      </tbody>
    </table>

    ${fl ? `
    <div class="info-box ${fl.pctOfTarget < 100 ? 'box-warn' : 'box-ok'}" style="margin-top:0.5rem; font-size:0.85rem">
      ${t('aa.first_limiting', { aa: AA_NAME[fl.aa] || fl.aa, pct: fl.pctOfTarget })}
    </div>` : ''}

    <div class="text-small text-muted mt-1">
      ${t('aa.supply_note', { lysMcp: supply.lys.fromMCP_g, lysRup: supply.lys.fromRUP_g, metMcp: supply.met.fromMCP_g, metRup: supply.met.fromRUP_g, lysPct: rupProfile.lysPct, metPct: rupProfile.metPct })}
    </div>
    ${assessment.his ? `<div class="text-small text-muted mt-1">${t('aa.his_note')}</div>` : ''}
    ${hasOther ? `<div class="text-small text-muted mt-1">${t('aa.eaa_display_note')}</div>` : ''}

    ${recommendations.length > 0 ? `
      <hr class="divider" />
      <div class="section-title">${t('aa.recommendations')} <span class="badge badge-display">${t('results.advisory_badge')}</span></div>
      <ul style="font-size:0.85rem; padding-left:1.2rem; line-height:1.7">
        ${recommendations.map(r => {
          const fid = RPAA_FEED_ID[r.type];
          const addBtn = fid ? ` <button type="button" class="btn btn-sm btn-secondary add-advisory-feed" data-feed-ids="${fid}">${t('results.add_to_feeds')}</button>` : '';
          return `<li><b>${escHtml(r.name)}</b> — ${t('aa.deficit', { g: r.deficitG })} <span class="text-muted">(${escHtml(r.note)})</span>${addBtn}</li>`;
        }).join('')}
      </ul>
    ` : ''}
  `;
}
