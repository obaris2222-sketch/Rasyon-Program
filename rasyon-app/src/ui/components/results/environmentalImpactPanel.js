/**
 * Çevresel Etki paneli — Enterik Metan Emisyonu (FAZ 16.2)
 *
 * CH₄ üretimi (g/gün), verim (g/kg KMT), yoğunluk (g/kg süt), CO₂ eşdeğeri,
 * metan enerji kaybı ve sürü-ölçek toplam emisyon. Moraes 2014 birincil model,
 * Niu 2018 alternatif karşılaştırma. (Bkz. src/core/methane.js)
 */

import { METHANE_GWP100 } from '../../../core/methane.js';
import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

const LEVEL_COLOR = {
  low:       'var(--primary)',
  normal:    'var(--primary)',
  high:      'var(--warning)',
  very_high: 'var(--danger)',
  na:        'var(--text-muted)',
};
const LEVEL_BOX = {
  low:       'box-ok',
  normal:    'box-ok',
  high:      'box-warn',
  very_high: 'box-danger',
  na:        'box-info',
};

export function renderEnvironmentalImpactPanel(result, state) {
  const m = result.methane;
  if (!m) return `<div class="text-muted text-small">${t('env.no_data')}</div>`;

  const interp = m.interpretation || { level: 'na', label: '—', message: '', recommendations: [] };
  const color = LEVEL_COLOR[interp.level] || 'var(--text-muted)';
  const boxCls = LEVEL_BOX[interp.level] || 'box-info';
  // Core etiket/mesaj yerine seviye kodundan çeviri (core TR döner, burada gösterilmez)
  const lk = `env.lvl_${interp.level}`, mk = `env.msg_${interp.level}`;
  const interpLabel = t(lk) === lk ? interp.label : t(lk);
  const interpMsg = t(mk) === mk ? interp.message : t(mk);

  const herdSize = Math.max(1, Number(state?.economics?.herdSize) || 1);
  const intensityTxt = m.intensity_g_per_kg_milk === null || m.intensity_g_per_kg_milk === undefined
    ? '—'
    : m.intensity_g_per_kg_milk.toFixed(1);

  // Sürü ölçek toplam (× hayvan sayısı)
  const herdCh4KgDay   = (m.production_g * herdSize) / 1000;          // kg CH₄/gün
  const herdCo2TonYear = (m.co2eq_kg_day * herdSize * 365) / 1000;    // ton CO₂eq/yıl
  const cowCo2TonYear  = (m.co2eq_kg_day * 365) / 1000;              // ton CO₂eq/yıl (inek başı)

  return `
    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:1rem; margin-bottom:1rem">
      <div class="summary-card">
        <div class="val" style="color:${color}">${m.production_g.toFixed(0)}</div>
        <div class="lbl">${t('env.ch4_day')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${m.yield_g_per_kg_dmi.toFixed(1)}</div>
        <div class="lbl">${t('env.ch4_yield')}</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:${color}">${intensityTxt}</div>
        <div class="lbl">${t('env.intensity')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${m.co2eq_kg_day.toFixed(1)}</div>
        <div class="lbl">${t('env.co2eq_day')}</div>
      </div>
    </div>

    <div class="info-box ${boxCls}">
      <b>${t('env.header', { label: escHtml(interpLabel) })}</b><br>
      ${escHtml(interpMsg)}
    </div>

    <table class="diag-table" style="margin-top:0.75rem; font-size:0.85rem">
      <tbody>
        <tr>
          <td>${t('env.moraes')}</td>
          <td class="num"><b>${m.moraes_g.toFixed(0)} ${t('env.unit_g_day')}</b></td>
          <td class="text-muted">${t('env.moraes_note')}</td>
        </tr>
        <tr>
          <td>${t('env.niu')}</td>
          <td class="num">${m.niu_g.toFixed(0)} ${t('env.unit_g_day')}</td>
          <td class="text-muted">${t('env.niu_note')}</td>
        </tr>
        <tr>
          <td>${t('env.energy_loss')}</td>
          <td class="num">${m.energyLossMcal.toFixed(2)} ${t('env.unit_mcal_day')}</td>
          <td class="text-muted">${t('env.energy_loss_note')}</td>
        </tr>
        <tr>
          <td>${t('env.co2_cow_year')}</td>
          <td class="num">${cowCo2TonYear.toFixed(2)} ${t('env.unit_ton_year')}</td>
          <td class="text-muted">${t('env.gwp_note', { x: METHANE_GWP100 })}</td>
        </tr>
      </tbody>
    </table>

    <hr class="divider" />
    <div class="section-title">${t('env.herd_title', { n: herdSize })}</div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-top:0.5rem">
      <div class="summary-card">
        <div class="val">${herdCh4KgDay.toFixed(1)}</div>
        <div class="lbl">${t('env.herd_ch4')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${herdCo2TonYear.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
        <div class="lbl">${t('env.herd_co2')}</div>
      </div>
    </div>
    <div class="text-small text-muted mt-1">
      ${t('env.herd_note')}
    </div>

    ${interp.recommendations && interp.recommendations.length ? `
      <hr class="divider" />
      <div class="section-title">${t('env.reduction_recs')}</div>
      <ul style="font-size:0.9rem; padding-left:1.2rem; line-height:1.8">
        ${interp.recommendations.map(r => `<li>${escHtml(r)}</li>`).join('')}
      </ul>
    ` : ''}

    <div class="text-small text-muted mt-1">
      ${t('env.method')}
    </div>
  `;
}
