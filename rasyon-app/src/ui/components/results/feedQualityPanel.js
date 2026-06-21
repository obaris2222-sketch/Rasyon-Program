/**
 * Yem Kalitesi paneli — Mikotoksin Riski + Silaj Fermentasyon Kalitesi (FAZ 16.6)
 *
 * result.mycotoxinRisk (rasyon mikotoksin yükü vs limit) ve result.silageQuality
 * (silaj fermentasyon skorları) gösterimi. Veriler lab analizinden gelir; girilmemişse
 * bilgilendirme notu. (Bkz. core/feedQuality.js)
 */

import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

const STATUS_COLOR = { ok: 'var(--primary)', warning: 'var(--warning)', danger: 'var(--danger)' };
const LEVEL_BOX = { na: 'box-info', ok: 'box-ok', warning: 'box-warn', danger: 'box-danger' };
const SILAGE_COLOR = { excellent: 'var(--primary)', good: 'var(--primary)', moderate: 'var(--warning)', poor: 'var(--danger)' };
const SILAGE_BOX = { excellent: 'box-ok', good: 'box-ok', moderate: 'box-warn', poor: 'box-danger' };

const MYCOTOXIN_ORDER = ['aflatoxinB1', 'don', 'zearalenone', 'fumonisin', 't2toxin', 'ochratoxin'];

// Core level/status kodundan çeviri (core TR döner, burada gösterilmez)
const lvlLabel = (level, fallback) => { const k = `fq.lvl_${level}`; const v = t(k); return v === k ? (fallback ?? level) : v; };
const lvlMsg = (level, fallback) => { const k = `fq.msg_${level}`; const v = t(k); return v === k ? (fallback ?? '') : v; };

function mycotoxinSection(myco) {
  if (!myco) return '';
  const interp = myco.interpretation || { level: 'na', label: '—', message: '', recommendations: [] };
  const boxCls = LEVEL_BOX[interp.level] || 'box-info';

  if (!myco.anyData) {
    return `
      <div class="section-title">${t('fq.myco_title_simple')}</div>
      <div class="info-box box-info">${lvlMsg(interp.level, interp.message)}</div>`;
  }

  const rows = MYCOTOXIN_ORDER.map(k => {
    const tx = myco.toxins[k];
    if (!tx) return '';
    const color = STATUS_COLOR[tx.status] || 'var(--text-muted)';
    const statusTxt = tx.status === 'danger' ? t('fq.st_danger') : tx.status === 'warning' ? t('fq.st_warning') : t('fq.st_ok');
    const name = (t(`fq.tox_${k}`) === `fq.tox_${k}`) ? tx.label : t(`fq.tox_${k}`);
    return `
      <tr>
        <td>${escHtml(name)}</td>
        <td class="num">${tx.value.toFixed(2)}</td>
        <td class="num text-muted">${tx.limit}</td>
        <td class="num"><b style="color:${color}">${(tx.ratio * 100).toFixed(0)}%</b></td>
        <td><span class="text-small" style="color:${color}">${statusTxt}</span></td>
      </tr>`;
  }).join('');

  return `
    <div class="section-title">${t('fq.myco_title')}</div>
    <div class="info-box ${boxCls}">
      <b>${t('fq.myco_header', { label: escHtml(lvlLabel(interp.level, interp.label)) })}</b><br>${lvlMsg(interp.level, interp.message)}
    </div>
    <table class="diag-table" style="margin-top:0.5rem; font-size:0.85rem">
      <thead><tr><th>${t('fq.col_myco')}</th><th class="num">${t('fq.col_ration')}</th><th class="num">${t('fq.col_limit')}</th><th class="num">${t('fq.col_pctlimit')}</th><th>${t('fq.col_status')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${interp.recommendations && interp.recommendations.length ? `
      <ul style="font-size:0.85rem; padding-left:1.2rem; line-height:1.7; margin-top:0.4rem">
        ${interp.recommendations.map(r => `<li>${escHtml(r)}</li>`).join('')}
      </ul>` : ''}
    <div class="text-small text-muted mt-1">
      ${t('fq.myco_footer')}
    </div>`;
}

function silageSection(sq) {
  if (!sq) return '';
  if (!sq.anyData) {
    return `
      <hr class="divider" />
      <div class="section-title">${t('fq.silage_title')}</div>
      <div class="info-box box-info">${t('fq.silage_nodata')}</div>`;
  }

  const fmt = (v, unit = '') => (v === null || v === undefined) ? '—' : `${v}${unit}`;
  const cards = sq.items.map(s => {
    const color = SILAGE_COLOR[s.level] || 'var(--text-muted)';
    const boxCls = SILAGE_BOX[s.level] || 'box-info';
    const grade = (t(`fq.grade_${s.level}`) === `fq.grade_${s.level}`) ? s.grade : t(`fq.grade_${s.level}`);
    return `
      <div class="info-box ${boxCls}" style="margin-bottom:0.5rem">
        <div class="flex-between" style="align-items:center">
          <b>${escHtml(s.name)}</b>
          <span style="font-size:1.2rem; font-weight:700; color:${color}">${s.score}/100 · ${escHtml(grade)}${s.partial ? ` <span class="text-small" style="font-weight:400">${t('fq.partial')}</span>` : ''}</span>
        </div>
        <div class="text-small" style="margin-top:0.3rem">
          pH ${fmt(s.pH)} (${t('fq.sil_ideal')}${s.idealPH}) · ${t('fq.sil_lactic')} ${fmt(s.lactic, '%')} · ${t('fq.sil_acetic')} ${fmt(s.acetic, '%')} · ${t('fq.sil_butyric')} ${fmt(s.butyric, '%')} · ${t('fq.sil_nh3')} ${fmt(s.nh3, '%')}
        </div>
        ${s.notes && s.notes.length ? `<ul style="font-size:0.82rem; padding-left:1.1rem; margin:0.3rem 0 0; line-height:1.6">${s.notes.map(n => `<li>${escHtml(n)}</li>`).join('')}</ul>` : ''}
      </div>`;
  }).join('');

  return `
    <hr class="divider" />
    <div class="section-title">${t('fq.silage_title')}</div>
    ${cards}
    <div class="text-small text-muted mt-1">
      ${t('fq.silage_footer')}
    </div>`;
}

export function renderFeedQualityPanel(result) {
  const myco = result.mycotoxinRisk;
  const sq = result.silageQuality;
  if (!myco && !sq) return `<div class="text-muted text-small">${t('fq.no_data')}</div>`;
  return mycotoxinSection(myco) + silageSection(sq);
}
