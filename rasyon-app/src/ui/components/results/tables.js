/**
 * Sonuç tabloları (FAZ 15.8 — resultsPanel'den ayrıldı)
 * Rasyon bileşenleri, kısıt diagnostiği, besin profili tablosu.
 */

import { escHtml, fmt } from '../../utils.js';
import { t, feedDisplayName } from '../../i18n.js';

export function renderRationItemsTable(items, dmi) {
  if (!items || items.length === 0) {
    return `<div class="empty-state"><p>${t('results.ration_empty')}</p></div>`;
  }

  const totalDm  = items.reduce((s, i) => s + i.dmKg, 0);
  const totalAsFed = items.reduce((s, i) => s + i.asFedKg, 0);
  const totalCost  = items.reduce((s, i) => s + i.costPerDay, 0);

  return `
    <div class="table-scroll-wrap">
      <table class="ration-items-table" style="min-width: 600px;">
        <thead>
          <tr>
            <th>${t('results.ti_feed')}</th>
            <th class="num">${t('results.ti_dm_kg')}</th>
            <th class="num">${t('results.ti_asfed_kg')}</th>
            <th class="num">${t('results.ti_pct_dm')}</th>
            <th class="num">${t('results.ti_cost_day')}</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>${escHtml(feedDisplayName(it))}</td>
              <td class="num">${it.dmKg.toFixed(2)}</td>
              <td class="num">${it.asFedKg.toFixed(2)}</td>
              <td class="num">${it.pctDm.toFixed(1)}</td>
              <td class="num">${it.costPerDay > 0 ? it.costPerDay.toFixed(2) : '—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td><b>${t('results.total')}</b></td>
            <td class="num"><b>${totalDm.toFixed(2)}</b></td>
            <td class="num"><b>${totalAsFed.toFixed(2)}</b></td>
            <td class="num"><b>100</b></td>
            <td class="num"><b>${totalCost.toFixed(2)}</b></td>
          </tr>
          <tr>
            <td colspan="5" class="text-muted" style="font-size:0.75rem; font-weight:400">
              ${t('results.target_dmi', { val: dmi.target_kg.toFixed(2), method: dmi.method })}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

export function renderDiagnostics(diagnostics, requirements) {
  if (!diagnostics || diagnostics.length === 0) return `<p class="text-muted">${t('results.no_data')}</p>`;

  const statusLabel = { ok: t('results.st_ok'), below: t('results.st_below'), above: t('results.st_above') };

  return `
    <div class="table-scroll-wrap">
      <table class="diag-table" style="min-width: 600px;">
        <thead>
          <tr>
            <th>${t('results.diag_constraint')}</th>
            <th class="num">${t('results.diag_value')}</th>
            <th class="num">${t('results.diag_min')}</th>
            <th class="num">${t('results.diag_max')}</th>
            <th>${t('results.diag_status')}</th>
          </tr>
        </thead>
        <tbody>
          ${diagnostics.map(d => `
            <tr class="status-row-${d.status}">
              <td>${escHtml(d.name)}</td>
              <td class="num">${fmt(d.value)}</td>
              <td class="num">${d.min !== undefined ? fmt(d.min) : '—'}</td>
              <td class="num">${d.max !== undefined ? fmt(d.max) : '—'}</td>
              <td><span class="status-${d.status}">${statusLabel[d.status] ?? d.status}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/**
 * Kaynaksız besin uyarısı (denetim bulgusu): yem setinde hiç kaynağı olmayan
 * iz mineral/vitamin kısıtları LP'den çıkarılır; kullanıcı sessizce yanılmasın diye
 * "premiks/katkı gerekli" uyarısı olarak gösterilir.
 * @param {Array<{key,label,type}>} missing
 * @returns {string} HTML (boşsa '')
 */
export function renderMissingSources(missing) {
  if (!Array.isArray(missing) || missing.length === 0) return '';
  const labels = missing.map(m => escHtml(m.label)).join(', ');
  return `
    <div class="missing-sources-warn" style="padding:0.6rem 0.8rem; margin-bottom:0.75rem; background:rgba(232,146,12,0.12); border-left:3px solid #e8920c; border-radius:4px; font-size:0.88rem">
      <i class="ti ti-alert-triangle"></i> ${t('results.missing_sources')}: <strong>${labels}</strong>
    </div>`;
}

export function renderCompositionTable(c) {
  const dm = t('results.unit_dm');           // %KM / %DM
  const gd = t('results.unit_g_day');         // g/gün / g/day
  const md = t('results.unit_mcal_day');      // Mcal/gün / Mcal/day
  const cp = t('results.comp_cp');            // HP / CP
  const rows = [
    [`NEL (${md})`,                  c.nel_mcal,   2],
    [`${cp} (${gd})`,                c.cp_g,       1],
    [`${cp} (${dm})`,                c.cp_pct,     2],
    [`RUP (${gd})`,                  c.rup_g,      1],
    [`RDP (${gd})`,                  c.rdp_g,      1],
    [`NDF (${dm})`,                  c.ndf_pct,    2],
    [`ADF (${dm})`,                  c.adf_pct,    2],
    [`aNDF (${dm})`,                 c.aNDF_pct,   2],
    [`NFC (${dm})`,                  c.nfc_pct,    2],
    [`${t('results.comp_starch')} (${dm})`, c.starch_pct, 2],
    [`${t('results.comp_sugar')} (${dm})`,  c.sugar_pct,  2],
    [`${t('results.comp_fat')} (${dm})`,    c.fat_pct,    2],
    [`${t('results.comp_ash')} (${dm})`,    c.ash_pct,    2],
    [`peNDF (${dm})`,                c.peNDF_pct,  2],
    [`${t('results.comp_forage')} (${dm})`, c.forage_pct, 1],
    ['DCAD (mEq/100g)',              c.dcad_meq,   1],
    [`Ca (${gd})`,                   c.ca_g,       2],
    [`P (${gd})`,                    c.p_g,        2],
    [`Mg (${gd})`,                   c.mg_g,       2],
    [`K (${gd})`,                    c.k_g,        2],
    [`Na (${gd})`,                   c.na_g,       2],
    [`S (${gd})`,                    c.s_g,        2],
    [`Cl (${gd})`,                   c.cl_g,       2],
  ];

  return `
    <div style="overflow-x: auto;">
      <table class="diag-table">
        <thead><tr><th>${t('results.comp_nutrient')}</th><th class="num">${t('results.comp_value')}</th></tr></thead>
        <tbody>
          ${rows.map(([label, val, dec]) => `
            <tr><td>${label}</td><td class="num">${fmt(val, dec)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
