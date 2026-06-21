/**
 * FAZ 20.1 — Hassasiyet / Gölge Fiyat Paneli
 *
 * İki karar-destek tablosu (result.sensitivity'den; computeSensitivity üretir):
 *   1. Bağlayıcı kısıtlar (gölge fiyat): maliyeti belirleyen kısıtlar + marjinal değer.
 *   2. Yeme giriş eşiği (azaltılmış maliyet): kullanılmayan yemin girmesi için TL/ton düşüşü.
 *
 * Yalnız result.sensitivity.applicable=true iken çağrılır (saf LP + cost amacı + optimal).
 */
import { t, feedDisplayName } from '../../i18n.js';
import { escHtml } from '../../utils.js';

// Bağlayıcı kısıt → okunabilir etiket (yalnız belirsiz olanlar; gerisi ham ad).
const LABEL_KEY = {
  DMI: 'sens.c_dmi', NEL: 'sens.c_nel', MP: 'sens.c_mp', MP_RDP: 'sens.c_mp_rdp',
  RDP: 'sens.c_rdp', Forage: 'sens.c_forage', peNDF_min: 'sens.c_pendf',
};
// Gölge fiyat birimi (RHS birimi başına TL/gün).
const UNIT = {
  DMI: 'TL/kg', NEL: 'TL/Mcal',
  MP: 'TL/g', MP_RDP: 'TL/g', RDP: 'TL/birim',
  Ca: 'TL/g', P: 'TL/g', Mg: 'TL/g', K: 'TL/g', Na: 'TL/g', S: 'TL/g', Cl: 'TL/g',
  Lys: 'TL/g', Met: 'TL/g', His: 'TL/g',
};

function constraintLabel(p) {
  if (p.feedLimit) return t('sens.feed_limit', { name: feedDisplayName(p.feedLimit) || p.constraint });
  return LABEL_KEY[p.constraint] ? t(LABEL_KEY[p.constraint]) : p.constraint;
}
function constraintUnit(name) {
  if (name.startsWith('limit_')) return 'TL/kg';
  return UNIT[name] || 'TL/birim';
}
function feedName(r) {
  return escHtml(feedDisplayName(r) || r.feedId);
}

/**
 * @param {object} sensitivity - result.sensitivity ({ applicable, shadowPrices, reducedCosts })
 * @returns {string} HTML
 */
export function renderSensitivityPanel(sensitivity) {
  if (!sensitivity || !sensitivity.applicable) return '';
  const { shadowPrices = [], reducedCosts = [] } = sensitivity;

  const binding = shadowPrices.length > 0 ? `
    <div class="section-title mt-1">${t('sens.binding_title')}</div>
    <table class="diag-table">
      <thead><tr><th>${t('sens.col_constraint')}</th><th class="num">${t('sens.col_shadow')}</th><th>${t('sens.col_unit')}</th></tr></thead>
      <tbody>
        ${shadowPrices.map(p => `
          <tr>
            <td><b>${escHtml(constraintLabel(p))}</b></td>
            <td class="num">${Math.abs(p.dual) >= 0.01 ? Math.abs(p.dual).toFixed(2) : Math.abs(p.dual).toExponential(1)}</td>
            <td class="text-small text-muted">${constraintUnit(p.constraint)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="text-small text-muted mt-1">${t('sens.binding_hint')}</div>
  ` : `<div class="info-box mt-1">${t('sens.no_binding')}</div>`;

  const entry = reducedCosts.length > 0 ? `
    <div class="section-title mt-2">${t('sens.entry_title')}</div>
    <table class="diag-table">
      <thead><tr>
        <th>${t('sens.col_feed')}</th>
        <th class="num">${t('sens.col_current_price')}</th>
        <th class="num">${t('sens.col_drop')}</th>
        <th class="num">${t('sens.col_target')}</th>
      </tr></thead>
      <tbody>
        ${reducedCosts.slice(0, 8).map(r => {
          const target = Math.max(0, r.currentPrice - r.priceToEnter);
          // FAZ 23.3: canlı what-if kaydırıcısı — fiyatı düşür, rasyona girer mi anlık gör.
          const cur = Math.round(r.currentPrice) || 0;
          const step = Math.max(1, Math.round(cur / 200)) || 1;
          const slider = cur > 0 ? `
          <tr class="whatif-row">
            <td colspan="4" style="padding-top:0.1rem">
              <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap">
                <span class="text-small text-muted" style="min-width:90px"><i class="ti ti-adjustments-horizontal"></i> ${t('sens.whatif')}</span>
                <input type="range" class="whatif-slider" data-feed-id="${escHtml(r.feedId)}" min="0" max="${cur}" value="${cur}" step="${step}" style="flex:1; min-width:140px" />
                <span class="whatif-price text-small" style="min-width:90px; text-align:right; font-family:var(--font-mono,monospace)">${cur.toLocaleString()} ₺/ton</span>
                <span class="whatif-result text-small" style="min-width:130px"></span>
              </div>
            </td>
          </tr>` : '';
          return `
          <tr>
            <td>${feedName(r)}</td>
            <td class="num">${r.currentPrice ? Math.round(r.currentPrice).toLocaleString() : '—'}</td>
            <td class="num" style="color:var(--warning)">↓ ${Math.round(r.priceToEnter).toLocaleString()}</td>
            <td class="num"><b>${Math.round(target).toLocaleString()}</b></td>
          </tr>${slider}`;
        }).join('')}
      </tbody>
    </table>
    <div class="text-small text-muted mt-1">${t('sens.entry_hint')} ${t('sens.whatif_hint')}</div>
  ` : `<div class="info-box mt-1">${t('sens.no_entry')}</div>`;

  return `
    <div class="info-box box-info text-small">${t('sens.intro')}</div>
    ${binding}
    ${entry}
    <div class="text-small text-muted mt-2">${t('sens.note')}</div>
  `;
}
