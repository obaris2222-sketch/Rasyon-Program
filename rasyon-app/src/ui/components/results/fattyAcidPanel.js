/**
 * Yağ Asidi Profili & Süt Yağ Tahmini paneli (FAZ 15.8 — resultsPanel'den ayrıldı)
 * Diyet FA profili, Glasser 2008 süt yağ kompozisyon tahmini, MFD/ω6:ω3.
 */

import { escHtml } from '../../utils.js';
import { t } from '../../i18n.js';

export function renderFAPanel(fa, animal) {
  const { diet, milk, assessment } = fa;

  const gradeColor = {
    A: 'var(--primary)',
    B: 'var(--primary)',
    C: 'var(--warning)',
    D: 'var(--danger)',
  }[assessment.grade] || 'var(--text-muted)';

  const n6Colors = { optimal: 'var(--primary)', acceptable: 'var(--warning)', high_n6: 'var(--danger)', na: 'var(--text-muted)' };
  const n6n3Status = { label: t(`fa.n6_${milk.n6n3_status}`), color: n6Colors[milk.n6n3_status] || 'var(--text-muted)' };

  const mfdColor = {
    low: 'var(--primary)',
    moderate: 'var(--warning)',
    high: 'var(--danger)',
  }[milk.mfdRisk] || 'var(--text-muted)';

  const mfdLabel = t(`fa.mfd_${milk.mfdRisk}`);

  const severityColor = (sev) => sev === 'high' ? 'var(--danger)' : sev === 'medium' ? 'var(--warning)' : 'var(--text-muted)';

  // Gerçek vs tahmini süt yağı karşılaştırma
  const actualFat = animal.milkFat;
  const fatDelta = actualFat ? (actualFat - milk.estimatedMilkFatPct).toFixed(2) : null;

  return `
    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:1rem; margin-bottom:1rem">
      <div class="summary-card">
        <div class="val" style="color:${gradeColor}; font-size:2rem">${assessment.grade}</div>
        <div class="lbl">${t('fa.grade')}</div>
      </div>
      <div class="summary-card" style="background:${milk.mfdRisk === 'low' ? 'var(--primary-light)' : '#fff3cd'}">
        <div class="val" style="color:${mfdColor}; font-size:1rem; line-height:1.2">${mfdLabel}</div>
        <div class="lbl">${t('fa.mfd')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${milk.estimatedMilkFatPct.toFixed(2)}%</div>
        <div class="lbl">${t('fa.est_milk_fat')}${fatDelta !== null ? t('fa.actual_suffix', { v: actualFat }) : ''}</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:${n6n3Status.color}; font-size:1rem">${milk.n6n3_ratio?.toFixed(1) ?? '—'}</div>
        <div class="lbl">${t('fa.n6n3')}</div>
      </div>
    </div>

    <div class="section-title">${t('fa.diet_profile')}</div>
    <table class="diag-table">
      <thead>
        <tr><th>${t('fa.col_fa')}</th><th class="num">${t('fa.col_g_day')}</th><th class="num">${t('fa.col_pct_fat')}</th><th>${t('fa.col_importance')}</th></tr>
      </thead>
      <tbody>
        <tr><td>C16:0 (Palmitic)</td><td class="num">${diet.c16_0_g}</td><td class="num">${diet.totalFat_g > 0 ? (diet.c16_0_g / diet.totalFat_g * 100).toFixed(1) : '—'}%</td><td class="text-muted text-small">${t('fa.note_c16')}</td></tr>
        <tr><td>C18:0 (Stearic)</td><td class="num">${diet.c18_0_g}</td><td class="num">${diet.totalFat_g > 0 ? (diet.c18_0_g / diet.totalFat_g * 100).toFixed(1) : '—'}%</td><td class="text-muted text-small">${t('fa.note_c18_0')}</td></tr>
        <tr><td>C18:1 (Oleic, MUFA)</td><td class="num">${diet.c18_1_g}</td><td class="num">${diet.totalFat_g > 0 ? (diet.c18_1_g / diet.totalFat_g * 100).toFixed(1) : '—'}%</td><td class="text-muted text-small">${t('fa.note_c18_1')}</td></tr>
        <tr><td><b>C18:2 (Linoleic, ω-6) <i class="ti ti-star" style="color:var(--accent)"></i></b></td><td class="num"><b>${diet.c18_2_g}</b></td><td class="num">${diet.totalFat_g > 0 ? (diet.c18_2_g / diet.totalFat_g * 100).toFixed(1) : '—'}%</td><td class="text-muted text-small">${t('fa.note_c18_2')}</td></tr>
        <tr><td><b>C18:3 (α-Linolenic, ω-3) <i class="ti ti-star" style="color:var(--accent)"></i></b></td><td class="num"><b>${diet.c18_3_g}</b></td><td class="num">${diet.totalFat_g > 0 ? (diet.c18_3_g / diet.totalFat_g * 100).toFixed(1) : '—'}%</td><td class="text-muted text-small">${t('fa.note_c18_3')}</td></tr>
      </tbody>
      <tfoot>
        <tr><td><b>${t('fa.total_fat')}</b></td><td class="num"><b>${diet.totalFat_g}</b></td><td class="num"><b>100%</b></td><td></td></tr>
        <tr><td>SFA / MUFA / PUFA</td><td colspan="2" class="num">${diet.sfa_pct.toFixed(1)}% / ${diet.mufa_pct.toFixed(1)}% / ${diet.pufa_pct.toFixed(1)}%</td><td class="text-muted">${t('fa.sfa_note')}</td></tr>
      </tfoot>
    </table>

    <div class="section-title mt-2">${t('fa.milk_comp')}</div>
    <table class="diag-table">
      <thead>
        <tr><th>${t('fa.col_param')}</th><th class="num">${t('fa.col_value')}</th><th>${t('fa.col_meaning')}</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${t('fa.bh_eff')}</td>
          <td class="num">%${(milk.bhEfficiency * 100).toFixed(0)}</td>
          <td class="text-muted">${t('fa.bh_eff_note')}</td>
        </tr>
        <tr class="status-row-${milk.mfdRisk === 'low' ? 'ok' : milk.mfdRisk === 'moderate' ? 'below' : 'above'}">
          <td><b>${t('fa.denovo')}</b></td>
          <td class="num"><b>${(milk.deNovoSuppression * 100).toFixed(0)}%</b></td>
          <td>${milk.deNovoSuppression > 0.15 ? t('fa.denovo_high') : milk.deNovoSuppression > 0.08 ? t('fa.denovo_mod') : t('fa.denovo_normal')}</td>
        </tr>
        <tr>
          <td>${t('fa.cla')}</td>
          <td class="num">${milk.cla_mg_per_g_fat} ${t('fa.cla_unit')}</td>
          <td class="text-muted">${t('fa.cla_note')}</td>
        </tr>
        <tr>
          <td>${t('fa.trans')}</td>
          <td class="num">${milk.transFA_g_per_kgmilk} ${t('fa.trans_unit')}</td>
          <td class="text-muted">${t('fa.trans_note')}</td>
        </tr>
        ${fatDelta !== null ? `
        <tr>
          <td>${t('fa.compare')}</td>
          <td class="num">${t('fa.est')}: ${milk.estimatedMilkFatPct}% | ${t('fa.actual_lbl')}: ${actualFat}%</td>
          <td>${t('fa.diff')}: ${fatDelta > 0 ? '+' : ''}${fatDelta}%</td>
        </tr>` : ''}
      </tbody>
    </table>

    ${assessment.warnings.length > 0 ? `
      <hr class="divider" />
      <div class="section-title">${t('fa.warnings')}</div>
      <ul style="font-size:0.85rem; padding-left:1.2rem; line-height:1.7">
        ${assessment.warnings.map(w => `
          <li style="color:${severityColor(w.severity)}">
            <b>[${w.type}]</b> ${escHtml(w.message)}
          </li>`).join('')}
      </ul>
    ` : ''}

    ${assessment.recommendations.length > 0 ? `
      <div class="info-box box-ok" style="margin-top:0.5rem">
        <b>${t('fa.recommendations')}</b>
        <ul style="margin:0.3rem 0 0 0; padding-left:1.2rem">
          ${assessment.recommendations.map(r => `<li>${escHtml(r)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    <div class="text-small text-muted mt-1">
      ${t('fa.footer')}
    </div>
  `;
}
