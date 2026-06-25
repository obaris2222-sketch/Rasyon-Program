/**
 * Rumen panelleri (FAZ 15.8 — resultsPanel'den ayrıldı)
 * 24h pH dinamik tahmini + rumen sağlığı / SARA risk skoru.
 */

import { interpretRumenRisk } from '../../../core/rumenDynamics.js';
import { assessRumenHealth, getDynamicRumenTargets } from '../../../core/rumenHealth.js';
import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

export function renderRumenDynamicsPanel(sim) {
  const risk = interpretRumenRisk(sim.riskLevel);
  const riskLabel = t(`rumen.risk_${sim.riskLevel}`);   // core etiket yerine koddan çeviri

  const cardBg = sim.riskLevel === 'safe' ? 'var(--primary-light)'
              : sim.riskLevel === 'marginal' ? 'var(--below-bg)'
              : 'var(--above-bg)';

  return `
    <div class="res-grid-4">
      <div class="summary-card" style="background:${cardBg}">
        <div class="val" style="color:${risk.color}; font-size:1rem; line-height:1.2">${riskLabel}</div>
        <div class="lbl">${t('rumen.risk_level')}</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:${sim.minPH < 5.8 ? 'var(--danger)' : 'var(--primary)'}">${sim.minPH.toFixed(2)}</div>
        <div class="lbl">${t('rumen.min_ph_24h')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${sim.meanPH.toFixed(2)}</div>
        <div class="lbl">${t('rumen.mean_ph')}</div>
      </div>
      <div class="summary-card" style="background:${sim.saraHours >= 3 ? 'var(--above-bg)' : 'var(--primary-light)'}">
        <div class="val" style="color:${sim.saraHours >= 3 ? 'var(--danger)' : 'var(--primary)'}">${sim.saraHours}</div>
        <div class="lbl">${t('rumen.sara_hours')}</div>
      </div>
    </div>

    <div class="chart-wrap" style="height:280px">
      <div class="chart-inner">
        <canvas id="chart-rumen-ph"></canvas>
      </div>
    </div>

    ${sim.riskFlags.length > 0 ? `
      <div class="info-box box-danger" style="margin-top:0.75rem">
        <b>${t('rumen.warnings')} (${sim.riskFlags.length}):</b>
        <ul style="margin:0.3rem 0 0 0; padding-left:1.2rem">
          ${sim.riskFlags.map(f => `<li>${escHtml(f.message)}</li>`).join('')}
        </ul>
      </div>
    ` : `
      <div class="info-box box-ok" style="margin-top:0.75rem">
        ${t('rumen.safe_box')}
      </div>
    `}

    <div class="table-scroll-wrap">
      <table class="diag-table" style="margin-top:0.75rem">
        <thead>
          <tr><th>${t('rumen.col_param')}</th><th class="num">${t('rumen.col_value')}</th><th>${t('rumen.col_meaning')}</th></tr>
        </thead>
        <tbody>
          <tr><td>${t('rumen.base_ph')}</td><td class="num">${sim.basePH.toFixed(2)}</td><td class="text-muted">${t('rumen.base_ph_note')}</td></tr>
          <tr><td>${t('rumen.min_ph_pp')}</td><td class="num">${sim.minPH.toFixed(2)}</td><td class="text-muted">${t('rumen.min_ph_pp_note')}</td></tr>
          <tr><td>${t('rumen.amplitude')}</td><td class="num">${sim.amplitude.toFixed(2)}</td><td class="text-muted">${t('rumen.amplitude_note')}</td></tr>
          <tr class="status-row-${sim.saraHours >= 3 ? 'above' : 'ok'}">
            <td><b>${t('rumen.sara_duration')}</b></td>
            <td class="num"><b>${sim.saraHours} ${t('rumen.hours_day')}</b></td>
            <td>${t('rumen.sara_duration_note')}</td>
          </tr>
          ${sim.acidosisHours > 0 ? `<tr class="status-row-above">
            <td><b>${t('rumen.acute_acidosis')}</b></td>
            <td class="num"><b>${sim.acidosisHours} ${t('rumen.hours_day')}</b></td>
            <td><b>${t('rumen.acute_note')}</b></td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>

    <div class="text-small text-muted mt-1">
      ${t('rumen.dyn_footer')}
    </div>
  `;
}

export function renderRumenHealthPanel(composition, animal) {
  const assessment = assessRumenHealth({
    ndfPct:      composition.ndf_pct,
    peNDFPct:    composition.peNDF_pct,
    nfcPct:      composition.nfc_pct,
    forageRatio: composition.forage_pct,
    milkFatPct:     animal.milkFat,
    milkProteinPct: animal.milkProtein,
    breed:          animal.breed,   // PROBLEMLER #1: ırka göre F:P bandı
    lactationStage: animal.lactationStage,
    milkYield:      animal.milkYield,
  });

  const targets = getDynamicRumenTargets(animal.lactationStage, animal.milkYield);

  const gradeColor = {
    A: 'var(--primary)',
    B: 'var(--primary)',
    C: 'var(--warning)',
    D: 'var(--danger)',
  }[assessment.grade] || 'var(--text-muted)';

  const phColor = assessment.saraRisk === 'low' ? 'var(--primary)'
                : assessment.saraRisk === 'moderate' ? 'var(--warning)' : 'var(--danger)';

  const saraRiskLabel = {
    low: t('rumen.sara_low'),
    moderate: t('rumen.sara_moderate'),
    high: t('rumen.sara_high'),
  }[assessment.saraRisk] || assessment.saraRisk;

  const severityColor = (sev) => sev === 'high' ? 'var(--danger)' : sev === 'medium' ? 'var(--warning)' : 'var(--text-muted)';

  // Süt yağı/protein oranı (SARA göstergesi)
  const fpRatio = animal.milkFat && animal.milkProtein
    ? (animal.milkFat / animal.milkProtein).toFixed(2)
    : '—';
  const fpRatioStatus = animal.milkFat && animal.milkProtein
    ? (animal.milkFat / animal.milkProtein < 1.0 ? 'above' : animal.milkFat / animal.milkProtein < 1.2 ? 'below' : 'ok')
    : 'ok';

  return `
    <div class="res-grid-4">
      <div class="summary-card" style="background:${assessment.grade === 'A' || assessment.grade === 'B' ? 'var(--primary-light)' : 'var(--below-bg)'}">
        <div class="val" style="color:${gradeColor}; font-size:2.5rem">${assessment.grade}</div>
        <div class="lbl">${t('rumen.health_grade')}</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:${gradeColor}">${assessment.score}/100</div>
        <div class="lbl">${t('rumen.score')}</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:${phColor}">${assessment.estimatedPH.toFixed(2)}</div>
        <div class="lbl">${t('rumen.est_ph')}</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:${phColor}; font-size:1rem">${saraRiskLabel}</div>
        <div class="lbl">${t('rumen.sara_risk')}</div>
      </div>
    </div>

    <div class="table-scroll-wrap">
      <table class="diag-table">
      <thead><tr><th>${t('rumen.col_param')}</th><th class="num">${t('rumen.col_value')}</th><th>${t('rumen.col_target')}</th><th>${t('rumen.col_status')}</th></tr></thead>
      <tbody>
        <tr>
          <td>NDF (${t('results.unit_dm')})</td>
          <td class="num">${composition.ndf_pct.toFixed(1)}</td>
          <td>≥ ${targets.minNDF}</td>
          <td><span class="status-${composition.ndf_pct >= targets.minNDF ? 'ok' : composition.ndf_pct >= (targets.minNDF - 3) ? 'below' : 'above'}">${composition.ndf_pct >= targets.minNDF ? t('rumen.ndf_ok') : composition.ndf_pct >= (targets.minNDF - 3) ? t('rumen.ndf_marginal') : t('rumen.ndf_critical')}</span></td>
        </tr>
        <tr>
          <td>peNDF (${t('results.unit_dm')})</td>
          <td class="num">${composition.peNDF_pct.toFixed(1)}</td>
          <td>≥ ${targets.minPeNDF}</td>
          <td><span class="status-${composition.peNDF_pct >= targets.minPeNDF ? 'ok' : composition.peNDF_pct >= (targets.minPeNDF - 3) ? 'below' : 'above'}">${composition.peNDF_pct >= targets.minPeNDF ? t('rumen.pendf_ok') : composition.peNDF_pct >= (targets.minPeNDF - 3) ? t('rumen.pendf_marginal') : t('rumen.pendf_risk')}</span></td>
        </tr>
        <tr>
          <td>NFC (${t('results.unit_dm')})</td>
          <td class="num">${composition.nfc_pct.toFixed(1)}</td>
          <td>≤ ${targets.maxNFC}</td>
          <td><span class="status-${composition.nfc_pct <= targets.maxNFC ? 'ok' : composition.nfc_pct <= (targets.maxNFC + 2) ? 'below' : 'above'}">${composition.nfc_pct <= targets.maxNFC ? t('rumen.nfc_ok') : composition.nfc_pct <= (targets.maxNFC + 2) ? t('rumen.nfc_borderline') : t('rumen.nfc_risk')}</span></td>
        </tr>
        <tr>
          <td>${t('rumen.forage_ratio')}</td>
          <td class="num">${composition.forage_pct.toFixed(1)}</td>
          <td>≥ ${targets.minForage}</td>
          <td><span class="status-${composition.forage_pct >= targets.minForage ? 'ok' : composition.forage_pct >= (targets.minForage - 10) ? 'below' : 'above'}">${composition.forage_pct >= targets.minForage ? t('rumen.forage_ok') : composition.forage_pct >= (targets.minForage - 10) ? t('rumen.forage_low') : t('rumen.forage_critical')}</span></td>
        </tr>
        <tr>
          <td>${t('rumen.fp_ratio')}</td>
          <td class="num">${fpRatio}</td>
          <td>${t('rumen.fp_target')}</td>
          <td><span class="status-${fpRatioStatus}">${fpRatioStatus === 'ok' ? t('rumen.fp_normal') : fpRatioStatus === 'below' ? t('rumen.fp_low') : t('rumen.fp_depression')}</span></td>
        </tr>
      </tbody>
    </table>
    </div>

    ${assessment.warnings.length > 0 ? `
      <hr class="divider" />
      <div class="section-title">${t('rumen.warnings')} (${assessment.warnings.length})</div>
      <ul style="font-size:0.85rem; padding-left:1.2rem; line-height:1.7">
        ${assessment.warnings.map(w => `
          <li style="color:${severityColor(w.severity)}">
            <b>[${w.type}]</b> ${escHtml(w.message)}
          </li>`).join('')}
      </ul>
    ` : `
      <div class="info-box box-ok" style="margin-top:0.75rem">
        ${t('rumen.health_ok_box')}
      </div>
    `}

    <div class="text-small text-muted mt-1">
      ${t('rumen.health_footer')}
    </div>
  `;
}
