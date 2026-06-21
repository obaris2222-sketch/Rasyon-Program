/**
 * DCAD & İdrar pH paneli (FAZ 15.8 — resultsPanel'den ayrıldı)
 * DCAD değerlendirme, idrar pH (ölçülen/tahmini), süt humması risk notu.
 */

import { estimateUrinePH, interpretDCAD, interpretMeasuredUrinePH, recommendAnionicSalts } from '../../../core/dcad.js';
import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

export function renderDCADPanel(composition, animal, milkFever = null, dmi = null) {
  const dcadVal = composition.dcad_meq;
  if (dcadVal === undefined || dcadVal === null) {
    return `<p class="text-muted">${t('dcad.no_data')}</p>`;
  }

  // Hayvan dönemine göre cowPeriod belirle
  let cowPeriod = 'lactation';
  if (animal.lactationStage === 'close_up') cowPeriod = 'transition';
  else if (animal.lactationStage === 'far_off') cowPeriod = 'dry_faroff';

  // FAZ 13.8: süt humması (hipokalsemi) risk notu — A/B/C/D
  // Esas geçiş/kuru dönemde anlamlı; laktasyonda gösterilmez.
  const MF_GRADE = {
    low:       { grade: 'A', label: t('dcad.mf_low'),       bg: 'var(--ok-bg)', border: 'var(--ok-text)' },
    moderate:  { grade: 'B', label: t('dcad.mf_moderate'),  bg: 'var(--below-bg)', border: 'var(--warning)' },
    high:      { grade: 'C', label: t('dcad.mf_high'),      bg: 'var(--below-bg)', border: 'var(--accent)' },
    very_high: { grade: 'D', label: t('dcad.mf_very_high'), bg: 'var(--above-bg)', border: 'var(--above-text)' },
  };
  const mf = milkFever ? (MF_GRADE[milkFever.riskLevel] || MF_GRADE.moderate) : null;
  const showMilkFever = mf && cowPeriod === 'transition';

  const dcadInterp = interpretDCAD(dcadVal, cowPeriod);

  // Saha ölçümlü idrar pH varsa öncelikli; yoksa DCAD'dan tahmin
  const measuredPH = Number.isFinite(animal.urinePH) ? animal.urinePH : null;
  const measuredInterp = measuredPH !== null ? interpretMeasuredUrinePH(measuredPH, cowPeriod, animal.breed) : null;
  const estimated = estimateUrinePH(dcadVal, cowPeriod, animal.breed);

  // Core'dan dönen Türkçe mesaj/etiketleri level KODUNA göre çevir (core'a dokunmadan).
  const periodLabel = t(`dcad.period_${cowPeriod}`);
  const dcadMsg = t(`dcad.msg_${dcadInterp.status}`, { label: periodLabel, min: dcadInterp.target.min, max: dcadInterp.target.max });
  let phMsg = '';
  if (measuredInterp) {
    const phPeriodLabel = measuredInterp.cowPeriod === 'transition'
      ? t(`dcad.phperiod_transition_${measuredInterp.breed === 'jersey' ? 'jersey' : 'holstein'}`)
      : t(`dcad.phperiod_${measuredInterp.cowPeriod}`);
    phMsg = t(`dcad.phmsg_${measuredInterp.status}`, { label: phPeriodLabel, min: measuredInterp.target.min, max: measuredInterp.target.max });
  }

  const dcadColor = dcadInterp.status === 'optimal' ? 'var(--primary)'
                 : dcadInterp.severity === 'high' ? 'var(--danger)' : 'var(--warning)';

  // pH gösterimi için renk
  let phColor, phLabel, phValue, phSource, phStatusText;
  if (measuredInterp) {
    phValue = measuredInterp.measuredPH.toFixed(2);
    phLabel = t('dcad.ph_measured');
    phSource = 'measured';
    phColor = measuredInterp.severity === 'none' ? 'var(--primary)'
            : measuredInterp.severity === 'high' ? 'var(--danger)' : 'var(--warning)';
    phStatusText = phMsg;
  } else {
    phValue = estimated.estimatedPH.toFixed(2);
    phLabel = t('dcad.ph_estimated');
    phSource = 'estimated';
    phColor = estimated.status === 'target_met' ? 'var(--primary)'
            : estimated.status === 'too_acidic_risk' ? 'var(--danger)' : 'var(--warning)';
    phStatusText = t('dcad.est_note', { range: estimated.targetRange });
  }

  // Ca emilim etkisi (sadece ölçülmüş pH varsa)
  const caImpactBadge = measuredInterp
    ? (measuredInterp.caAbsorptionImpact === 'enhanced'
       ? `<span class="status-ok">${t('dcad.ca_enhanced')}</span>`
       : measuredInterp.caAbsorptionImpact === 'reduced'
       ? `<span class="status-above">${t('dcad.ca_reduced')}</span>`
       : `<span class="text-muted">${t('dcad.ca_normal')}</span>`)
    : '';

  return `
    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:1rem; margin-bottom:1rem">
      <div class="summary-card">
        <div class="val" style="color:${dcadColor}">${dcadVal.toFixed(1)}</div>
        <div class="lbl">${t('dcad.summary_dcad')}</div>
      </div>
      <div class="summary-card" style="${phSource === 'measured' ? 'border:2px solid var(--primary)' : ''}">
        <div class="val" style="color:${phColor}">${phValue}</div>
        <div class="lbl">${phLabel}</div>
      </div>
      <div class="summary-card">
        <div class="val">${measuredInterp?.targetRange ?? estimated.targetRange}</div>
        <div class="lbl">${t('dcad.target_ph_range')}</div>
      </div>
    </div>

    <div class="info-box" style="background:${dcadInterp.status === 'optimal' ? 'var(--ok-bg)' : 'var(--below-bg)'}; border-color:${dcadInterp.status === 'optimal' ? 'var(--ok-text)' : 'var(--warning)'}">
      <b>${t('dcad.assessment')}</b> ${dcadMsg}
    </div>

    ${measuredInterp ? `
      <div class="info-box" style="background:${measuredInterp.severity === 'none' ? 'var(--ok-bg)' : measuredInterp.severity === 'high' ? 'var(--above-bg)' : 'var(--below-bg)'}; border-color:${measuredInterp.severity === 'none' ? 'var(--ok-text)' : measuredInterp.severity === 'high' ? 'var(--above-text)' : 'var(--warning)'}; margin-top:0.5rem">
        <b>${t('dcad.field_ph_assessment')}</b> ${phMsg}
        ${caImpactBadge ? `<br>${caImpactBadge}` : ''}
      </div>
    ` : ''}

    ${showMilkFever ? `
      <div class="info-box" style="margin-top:0.5rem; background:${mf.bg}; border-color:${mf.border}">
        <b>${t('dcad.mf_note', { grade: mf.grade, label: mf.label })}</b>
        <span class="text-muted">${t('dcad.mf_score', { score: milkFever.score })}</span>
        ${milkFever.recommendations.length > 0 ? `
          <ul style="margin:0.4rem 0 0 1.2rem; font-size:0.85rem; line-height:1.6">
            ${milkFever.recommendations.map(r => `<li>${escHtml(r)}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    ` : ''}

    ${(cowPeriod === 'transition' && Number.isFinite(dmi)) ? (() => {
      const rec = recommendAnionicSalts(dcadVal, -10, dmi);
      if (!rec) return '';
      const pd = t('dcad.per_day');
      return `
        <div class="info-box" style="margin-top:0.5rem; background:var(--primary-light); border-color:var(--info)">
          <b>${t('dcad.anionic_title')}</b> <span class="badge badge-display">${t('results.advisory_badge')}</span> ${t('dcad.anionic_msg', { target: -10, meq: rec.totalMEq })}
          <ul style="margin:0.4rem 0 0 1.2rem; font-size:0.85rem; line-height:1.6">
            <li>${t('dcad.anionic_cacl2')}: <b>~${rec.cacl2Only_g} ${pd}</b></li>
            <li>${t('dcad.anionic_mgso4')}: <b>~${rec.mgso4Only_g} ${pd}</b></li>
            <li>${t('dcad.anionic_mix')}: <b>${rec.mixed.cacl2_g} g CaCl₂ + ${rec.mixed.mgso4_g} g MgSO₄</b></li>
          </ul>
          <!-- FAZ 17.5: önerilen anyonik tuzları LP aday yemi olarak ekle -->
          <button type="button" class="btn btn-sm btn-secondary add-advisory-feed" data-feed-ids="min_calcium_chloride,min_magnesium_sulfate" style="margin-top:0.4rem">${t('results.add_to_feeds')}</button>
        </div>
      `;
    })() : ''}

    <table class="diag-table" style="margin-top:0.75rem">
      <thead><tr><th>${t('dcad.col_param')}</th><th class="num">${t('dcad.col_value')}</th><th>${t('dcad.col_status')}</th></tr></thead>
      <tbody>
        <tr>
          <td>DCAD</td>
          <td class="num">${dcadVal.toFixed(1)} mEq/100g</td>
          <td><span class="status-${dcadInterp.status === 'optimal' ? 'ok' : (dcadInterp.status === 'below_target' ? 'below' : 'above')}">${dcadInterp.status === 'optimal' ? t('dcad.st_optimal') : dcadInterp.status === 'below_target' ? t('dcad.st_below') : t('dcad.st_above')}</span></td>
        </tr>
        ${measuredInterp ? `
          <tr>
            <td><b>${t('dcad.row_field_ph')}</b></td>
            <td class="num"><b>${measuredInterp.measuredPH.toFixed(2)}</b></td>
            <td><span class="status-${measuredInterp.severity === 'none' ? 'ok' : (measuredInterp.severity === 'high' ? 'above' : 'below')}">${measuredInterp.status}</span></td>
          </tr>
          <tr>
            <td>${t('dcad.row_dcad_est')}</td>
            <td class="num text-muted">${estimated.estimatedPH.toFixed(2)}</td>
            <td class="text-muted">${t('dcad.for_comparison')}</td>
          </tr>
        ` : `
          <tr>
            <td>${t('dcad.row_est_ph')}</td>
            <td class="num">${estimated.estimatedPH.toFixed(2)}</td>
            <td><span class="status-${estimated.status === 'target_met' ? 'ok' : 'above'}">${estimated.status === 'target_met' ? t('dcad.st_target_met') : t('dcad.st_field_needed')}</span></td>
          </tr>
        `}
        <tr>
          <td>${t('dcad.target_period')}</td>
          <td class="num">${periodLabel}</td>
          <td class="text-muted">${t('dcad.dcad_target', { min: dcadInterp.target.min, max: dcadInterp.target.max })}</td>
        </tr>
      </tbody>
    </table>

    <div class="text-small text-muted mt-1">
      ${measuredInterp
        ? `${t('dcad.footer_measured')} ${phStatusText}`
        : `${t('dcad.footer_estimated')} ${phStatusText}`}
    </div>
  `;
}
