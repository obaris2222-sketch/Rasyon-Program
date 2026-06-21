/**
 * Nişasta Sindirim Profili paneli — Rumen / Bağırsak / By-pass (FAZ 16.4)
 *
 * Diyet nişastasının rumende fermente olan (RSD), bağırsakta sindirilen ve
 * sindirilmeden atılan (dışkı) oranlarını gösterir. Rumende fermente nişasta
 * SARA/asidoz riskini sürükler; rumeni geçen nişasta bağırsakta glikoz olarak
 * sindirilir. İşleme tipi (bütün/kırılmış/öğütülmüş/HMC/steam-flaked) RSD'yi
 * belirler. (Bkz. src/core/starch.js)
 */

import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

const LEVEL_BOX = { low: 'box-ok', moderate: 'box-warn', high: 'box-danger' };
const LEVEL_COLOR = { low: 'var(--primary)', moderate: 'var(--warning)', high: 'var(--danger)' };

export function renderStarchDigestionPanel(result) {
  const sd = result.starchDigestion;
  if (!sd || sd.starch_g <= 0) {
    return `<div class="text-muted text-small">${t('starch.no_data')}</div>`;
  }

  const interp = sd.interpretation || { level: 'low', label: '—', message: '' };
  const color = LEVEL_COLOR[interp.level] || 'var(--text-muted)';
  const boxCls = LEVEL_BOX[interp.level] || 'box-info';
  // Core etiket/mesaj yerine seviye kodundan çeviri
  const lk = `starch.lvl_${interp.level}`, mk = `starch.msg_${interp.level}`;
  const interpLabel = t(lk) === lk ? interp.label : t(lk);
  const interpMsg = t(mk) === mk ? interp.message : t(mk);
  const GD = t('starch.unit_g_day');

  const total = sd.starch_g || 1;
  const rumenPct = (sd.rumenStarch_g / total) * 100;
  const intPct = (sd.intestinalStarch_g / total) * 100;
  const fecalPct = (sd.fecalStarch_g / total) * 100;

  return `
    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:1rem; margin-bottom:1rem">
      <div class="summary-card">
        <div class="val" style="color:${color}">${sd.rumenStarch_pct.toFixed(1)}%</div>
        <div class="lbl">${t('starch.rumen_ferm')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${(sd.rsd * 100).toFixed(0)}%</div>
        <div class="lbl">${t('starch.rsd')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${sd.intestinalStarch_g.toLocaleString()}</div>
        <div class="lbl">${t('starch.int_starch')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${(sd.totalTract * 100).toFixed(0)}%</div>
        <div class="lbl">${t('starch.total_dig')}</div>
      </div>
    </div>

    <!-- Rumen / bağırsak / dışkı dağılım çubuğu -->
    <div style="display:flex; height:22px; border-radius:5px; overflow:hidden; margin-bottom:0.4rem">
      <div title="${t('starch.bar_rumen')}" style="width:${rumenPct.toFixed(1)}%; background:var(--primary)"></div>
      <div title="${t('starch.bar_int')}" style="width:${intPct.toFixed(1)}%; background:var(--warning)"></div>
      <div title="${t('starch.bar_fecal')}" style="width:${fecalPct.toFixed(1)}%; background:var(--text-muted)"></div>
    </div>
    <div class="flex gap-2 text-small text-muted" style="flex-wrap:wrap; margin-bottom:0.75rem">
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--primary);border-radius:2px"></span> ${t('starch.bar_rumen')} ${rumenPct.toFixed(0)}%</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--warning);border-radius:2px"></span> ${t('starch.bar_int')} ${intPct.toFixed(0)}%</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--text-muted);border-radius:2px"></span> ${t('starch.bar_fecal')} ${fecalPct.toFixed(0)}%</span>
    </div>

    <div class="info-box ${boxCls}">
      <b>${t('starch.acidosis_header', { label: escHtml(interpLabel) })}</b><br>
      ${escHtml(interpMsg)}
    </div>

    <table class="diag-table" style="margin-top:0.75rem; font-size:0.85rem">
      <tbody>
        <tr><td>${t('starch.row_total')}</td><td class="num"><b>${sd.starch_g.toLocaleString()} ${GD}</b></td><td class="text-muted">${sd.starch_pct.toFixed(1)} ${t('starch.unit_dm')}</td></tr>
        <tr><td>${t('starch.row_rumen')}</td><td class="num">${sd.rumenStarch_g.toLocaleString()} ${GD}</td><td class="text-muted">${t('starch.note_sara')}</td></tr>
        <tr><td>${t('starch.row_int')}</td><td class="num">${sd.intestinalStarch_g.toLocaleString()} ${GD}</td><td class="text-muted">${t('starch.note_glucose')}</td></tr>
        <tr><td>${t('starch.row_fecal')}</td><td class="num">${sd.fecalStarch_g.toLocaleString()} ${GD}</td><td class="text-muted">${t('starch.note_loss')}</td></tr>
      </tbody>
    </table>

    <div class="text-small text-muted mt-1">
      ${t('starch.method')}
    </div>
  `;
}
