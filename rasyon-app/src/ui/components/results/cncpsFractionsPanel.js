/**
 * CNCPS v6.5 Tam Alt Fraksiyonlar paneli (FAZ 16.3)
 *
 * Rasyon düzeyinde 8 havuz karbonhidrat (CA1-CA4, CB1-CB3, CC) ve 6 havuz protein
 * (PA1, PA2, PB1, PB2, PB3, PC) ayrıntılı fermentasyon profili. (Bkz. core/cncps.js
 * aggregateCNCPSSubFractions.) Bu görünüm tanı/eğitim amaçlıdır; RDP/RUP/MCP
 * hesabı mevcut 4/5 havuz modelinden gelir ve bu panelden ETKİLENMEZ.
 */

import { t } from '../../i18n.js';

// CHO havuzları: anahtar + fermentasyon hızı sınıfı (etiket/açıklama i18n'den)
const CHO_POOLS = [
  { k: 'cA1', speed: 'product' },
  { k: 'cA2', speed: 'product' },
  { k: 'cA3', speed: 'product' },
  { k: 'cA4', speed: 'instant' },
  { k: 'cB1', speed: 'medium'  },
  { k: 'cB2', speed: 'fast'    },
  { k: 'cB3', speed: 'slow'    },
  { k: 'cC',  speed: 'none'    },
];

// Protein havuzları
const PROT_POOLS = [
  { k: 'pA1', speed: 'instant'  },
  { k: 'pA2', speed: 'fast'     },
  { k: 'pB1', speed: 'medium'   },
  { k: 'pB2', speed: 'slow'     },
  { k: 'pB3', speed: 'veryslow' },
  { k: 'pC',  speed: 'none'     },
];

const SPEED_COLOR = {
  product:  'var(--text-muted)',
  instant:  'var(--danger)',
  fast:     'var(--warning)',
  medium:   'var(--primary)',
  slow:     'var(--primary)',
  veryslow: 'var(--text-muted)',
  none:     'var(--text-muted)',
};

// kind: 'cho' | 'prot' (i18n etiket anahtarı öneki)
function poolRow(pool, kind, value, unit, maxVal) {
  const color = SPEED_COLOR[pool.speed] || SPEED_COLOR.medium;
  const speedTxt = t(`cncps.sp_${pool.speed}`);
  const label = t(`cncps.${kind}_${pool.k}_l`);
  const note  = t(`cncps.${kind}_${pool.k}_n`);
  const pct = maxVal > 0 ? Math.min(100, (value / maxVal) * 100) : 0;
  return `
    <tr>
      <td>${label}</td>
      <td class="num"><b>${value.toFixed(2)}</b> ${unit}</td>
      <td style="min-width:110px">
        <div style="background:var(--bg); border-radius:4px; height:9px; overflow:hidden">
          <div style="width:${pct.toFixed(0)}%; height:100%; background:${color}"></div>
        </div>
      </td>
      <td><span class="text-small" style="color:${color}">${speedTxt}</span></td>
      <td class="text-small text-muted">${note}</td>
    </tr>`;
}

export function renderCNCPSFractionsPanel(result) {
  const sf = result.cncpsSubFractions;
  if (!sf || !sf.cho) {
    return `<div class="text-muted text-small">${t('cncps.no_data')}</div>`;
  }

  const cho = sf.cho;
  const prot = sf.protein;
  const choMax = Math.max(...CHO_POOLS.map(p => cho[p.k] || 0), 1);
  const protMax = Math.max(...PROT_POOLS.map(p => prot[p.k] || 0), 1);

  const choTotal = CHO_POOLS.reduce((s, p) => s + (cho[p.k] || 0), 0);
  // Hızlı fermente (asidoz göstergesi): şeker + nişasta + çözünür lif
  const fastFermCHO = (cho.cA4 || 0) + (cho.cB1 || 0) + (cho.cB2 || 0);
  // Hızlı yıkılabilir N göstergesi: NPN + peptit
  const fastN = (prot.pA1 || 0) + (prot.pA2 || 0);

  const DM = t('cncps.unit_dm'), CP = t('cncps.unit_cp');

  return `
    <div class="info-box box-info">
      ${t('cncps.intro')}
    </div>

    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:1rem; margin:0.75rem 0">
      <div class="summary-card">
        <div class="val">${fastFermCHO.toFixed(1)}%</div>
        <div class="lbl">${t('cncps.fast_ferm')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${(choTotal).toFixed(1)}%</div>
        <div class="lbl">${t('cncps.total_cho')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${fastN.toFixed(1)}%</div>
        <div class="lbl">${t('cncps.fast_n')}</div>
      </div>
    </div>

    <div class="section-title" style="margin-top:0.5rem">${t('cncps.sec_cho')}</div>
    <div style="overflow-x: auto;">
      <table class="diag-table">
        <thead><tr><th>${t('cncps.col_pool')}</th><th class="num">${t('cncps.col_value')}</th><th></th><th>${t('cncps.col_speed')}</th><th>${t('cncps.col_desc')}</th></tr></thead>
        <tbody>
          ${CHO_POOLS.map(p => poolRow(p, 'cho', cho[p.k] || 0, DM, choMax)).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-title" style="margin-top:1rem">${t('cncps.sec_prot')}</div>
    <div style="overflow-x: auto;">
      <table class="diag-table">
        <thead><tr><th>${t('cncps.col_pool')}</th><th class="num">${t('cncps.col_value')}</th><th></th><th>${t('cncps.col_speed')}</th><th>${t('cncps.col_desc')}</th></tr></thead>
        <tbody>
          ${PROT_POOLS.map(p => poolRow(p, 'prot', prot[p.k] || 0, CP, protMax)).join('')}
        </tbody>
      </table>
    </div>

    <div class="text-small text-muted mt-1">
      ${t('cncps.method')}
    </div>
  `;
}
