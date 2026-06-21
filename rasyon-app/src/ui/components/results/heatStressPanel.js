/**
 * Isı Stresi Yönetimi paneli (FAZ 15.8 — resultsPanel'den ayrıldı)
 * THI sınıflandırma, KMT/NEL düzeltmeleri, yönetimsel öneriler (West 2003, Mader 2006).
 */

import { classifyTHI, heatStressRecommendations } from '../../../core/heatStress.js';
import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

export function renderHeatStressPanel(animal, result) {
  const thi = animal.thi;
  const thiClass = classifyTHI(thi);
  const recs = heatStressRecommendations(thiClass);

  const colorMap = {
    none: 'var(--primary)',
    mild: 'var(--warning)',
    moderate: 'orange',
    severe: 'var(--danger)',
    extreme: 'darkred',
  };
  const color = colorMap[thiClass.level] || 'var(--text-muted)';
  const levelKey = `heat.lvl_${thiClass.level}`;
  const levelLabel = t(levelKey) === levelKey ? thiClass.label : t(levelKey);

  // KMT ve NEL düzeltmeleri varsa göster
  const dmiAdjusted = result.dmi?.heatAdjusted;
  const nelAdjusted = result.requirements?.nel?.heatAdjusted;

  return `
    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:1rem; margin-bottom:1rem">
      <div class="summary-card" style="background:${thiClass.level === 'none' ? 'var(--primary-light)' : '#fff3cd'}">
        <div class="val" style="color:${color}">${thi.toFixed(1)}</div>
        <div class="lbl">THI</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:${color}; font-size:1.1rem">${levelLabel}</div>
        <div class="lbl">${t('heat.stress_level')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${thiClass.dmiReduction > 0 ? '−' + thiClass.dmiReduction.toFixed(1) : '0'} kg</div>
        <div class="lbl">${t('heat.exp_dmi_loss')}</div>
      </div>
    </div>

    ${thi > 72 ? `
      <div class="info-box box-warn">
        <b>${t('heat.active_adj')}</b>
        <ul style="margin:0.5rem 0 0 0; padding-left:1.2rem">
          ${dmiAdjusted ? `<li>${t('heat.adj_dmi')}</li>` : ''}
          ${nelAdjusted ? `<li>${t('heat.adj_nel')}</li>` : ''}
          ${!dmiAdjusted && !nelAdjusted ? `<li>${t('heat.adj_none')}</li>` : ''}
        </ul>
      </div>
    ` : `
      <div class="info-box box-ok">
        ${t('heat.no_stress_box', { v: thi.toFixed(1) })}
      </div>
    `}

    ${recs.length > 0 ? `
      <hr class="divider" />
      <div class="section-title">${t('heat.mgmt_recs')}</div>
      <ul style="font-size:0.9rem; padding-left:1.2rem; line-height:1.8">
        ${recs.map(r => `<li>${escHtml(r)}</li>`).join('')}
      </ul>
    ` : ''}

    <div class="text-small text-muted mt-1">
      ${t('heat.footer')}
    </div>
  `;
}
