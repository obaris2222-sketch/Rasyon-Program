/**
 * Ekonomik Analiz paneli (FAZ 15.8 — resultsPanel'den ayrıldı)
 * IOFC, yem verimliliği, yıllık/sürü projeksiyon.
 */

import { calcEconomics, interpretFeedEfficiency, interpretFeedCostPerLiter } from '../../../core/economics.js';
import { t } from '../../i18n.js';

export function renderEconomicsPanel(result, state) {
  const econ = state.economics || { milkPrice_tl: 18, herdSize: 1 };
  const e = calcEconomics({
    milkYield_kg: state.animal.milkYield,
    milkFat_pct: state.animal.milkFat,           // FAZ 9: ECM hesabı için
    milkProtein_pct: state.animal.milkProtein,   // FAZ 9
    milkPrice_tl: econ.milkPrice_tl,
    feedCost_tl_day: result.totalCost,
    dmi_kg: result.dmi.achieved_kg,
    herdSize: econ.herdSize,
  });

  const effInterp  = interpretFeedEfficiency(e.daily.feedEfficiency);
  const costInterp = interpretFeedCostPerLiter(e.daily.feedCostPerLiter_tl);
  // Core yorum etiket/mesajları level KODUNA göre çevrilir (core'a dokunmadan; FAZ i18n).
  const lbl = (prefix, level) => t(`econ.${prefix}_${level}_l`);
  const msg = (prefix, level) => { const k = `econ.${prefix}_${level}_m`; const v = t(k); return v === k ? '' : v; };
  const statusColor = {
    excellent: 'var(--primary)',
    good:      'var(--primary)',
    medium:    'var(--warning)',
    low:       'var(--danger)',
    loss:      'var(--danger)',
    high:      'var(--danger)',
    na:        'var(--text-muted)',
  };

  const isDry = state.animal.lactationStage === 'close_up' || state.animal.lactationStage === 'far_off';

  if (isDry) {
    return `
      <!-- Girdi: sürü boyutu (kuru hayvan sayısı) -->
      <div class="form-grid" style="margin-bottom:1rem">
        <div class="form-group" style="display:none">
          <input type="number" id="econ-milk-price" value="${econ.milkPrice_tl}" />
        </div>
        <div class="form-group">
          <label>${t('econ.herd_size')}</label>
          <input type="number" id="econ-herd-size" min="1" step="1" value="${econ.herdSize}" />
          <span class="hint">${t('econ.dry_herd_hint')}</span>
        </div>
      </div>

      <!-- Günlük Özet -->
      <div class="summary-bar" style="display:flex; justify-content:center; gap:1rem;">
        <div class="summary-card" style="border: 2px solid var(--primary); min-width: 250px;">
          <div class="val" style="color: var(--primary)">${e.daily.feedCost_tl.toFixed(2)} ₺</div>
          <div class="lbl">${t('econ.daily_feed_cost')}</div>
        </div>
      </div>

      <div class="info-box" style="background:var(--bg-light); border-color:var(--text-muted); margin-top: 1rem">
        ${t('econ.dry_info')}
      </div>

      <!-- Detay tablo -->
      <table class="diag-table" style="margin-top: 1rem">
        <thead>
          <tr><th>${t('econ.col_metric')}</th><th class="num">${t('econ.col_value')}</th><th>${t('econ.col_comment')}</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>${t('econ.row_feed_cost')}</td>
            <td class="num"><b>${e.daily.feedCost_tl.toFixed(2)} ₺</b></td>
            <td class="text-muted">${t('econ.row_feed_cost_note')}</td>
          </tr>
          ${econ.herdSize > 1 ? `
          <tr>
            <td><b>Grup Günlük Yem Maliyeti</b></td>
            <td class="num"><b>${(e.daily.feedCost_tl * econ.herdSize).toLocaleString()} ₺/gün</b></td>
            <td class="text-muted">${econ.herdSize} hayvan için toplam günlük maliyet</td>
          </tr>
          ` : ''}
        </tbody>
      </table>
    `;
  }

  return `
    <!-- Girdi: süt fiyatı ve sürü boyutu -->
    <div class="form-grid" style="margin-bottom:1rem">
      <div class="form-group">
        <label>${t('econ.milk_price')}</label>
        <input type="number" id="econ-milk-price" min="0" step="0.5" value="${econ.milkPrice_tl}" />
        <span class="hint">${t('econ.milk_price_hint')}</span>
      </div>
      <div class="form-group">
        <label>${t('econ.herd_size')}</label>
        <input type="number" id="econ-herd-size" min="1" step="1" value="${econ.herdSize}" />
        <span class="hint">${t('econ.herd_size_hint')}</span>
      </div>
    </div>

    <!-- Günlük Özet -->
    <div class="summary-bar">
      <div class="summary-card">
        <div class="val">${e.daily.revenue_tl.toFixed(2)}</div>
        <div class="lbl">${t('econ.daily_revenue')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${e.daily.feedCost_tl.toFixed(2)}</div>
        <div class="lbl">${t('econ.daily_feed_cost')}</div>
      </div>
      <div class="summary-card" style="background:${e.status.level === 'loss' ? 'var(--above-bg)' : 'var(--primary-light)'}">
        <div class="val" style="color:${statusColor[e.status.level]}">${e.daily.iofc_tl.toFixed(2)}</div>
        <div class="lbl">${t('econ.iofc_per_cow')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${e.daily.feedCostPerLiter_tl.toFixed(2)}</div>
        <div class="lbl">${t('econ.feed_cost_liter')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${e.daily.feedEfficiency.toFixed(2)}</div>
        <div class="lbl">${t('econ.feed_eff_short')} <span class="text-muted" style="font-size:0.7rem">${t('econ.raw_short')}: ${e.daily.rawFeedEfficiency.toFixed(2)}</span></div>
      </div>
    </div>

    <!-- Durum yorumları (status.label/message core'dan gelir) -->
    <div class="info-box" style="background:${e.status.level === 'loss' ? 'var(--above-bg)' : 'var(--ok-bg)'}; border-color:${e.status.level === 'loss' ? 'var(--above-text)' : 'var(--ok-text)'}">
      <b>${t('econ.iofc_assessment')} — ${lbl('iofc', e.status.level)}:</b> ${msg('iofc', e.status.level)}
    </div>

    <!-- Detay tablo -->
    <table class="diag-table">
      <thead>
        <tr><th>${t('econ.col_metric')}</th><th class="num">${t('econ.col_value')}</th><th>${t('econ.col_comment')}</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${t('econ.row_revenue')}</td>
          <td class="num">${e.daily.revenue_tl.toFixed(2)} ₺</td>
          <td class="text-muted">${state.animal.milkYield} kg × ${econ.milkPrice_tl} ₺</td>
        </tr>
        <tr>
          <td>${t('econ.row_feed_cost')}</td>
          <td class="num">${e.daily.feedCost_tl.toFixed(2)} ₺</td>
          <td class="text-muted">${t('econ.row_feed_cost_note')}</td>
        </tr>
        <tr class="status-row-${e.status.level === 'loss' ? 'above' : (e.status.level === 'low' ? 'below' : 'ok')}">
          <td><b>${t('econ.row_iofc')}</b></td>
          <td class="num"><b>${e.daily.iofc_tl.toFixed(2)} ₺/${t('ration.sum_days')}</b></td>
          <td><b>${lbl('iofc', e.status.level)}</b></td>
        </tr>
        <tr>
          <td>${t('econ.row_cost_liter')}</td>
          <td class="num">${e.daily.feedCostPerLiter_tl.toFixed(2)} ₺</td>
          <td><span class="status-${costInterp.level === 'excellent' || costInterp.level === 'good' ? 'ok' : (costInterp.level === 'medium' ? 'below' : 'above')}">${lbl('cost', costInterp.level)}</span> — ${msg('cost', costInterp.level)}</td>
        </tr>
        <tr>
          <td>${t('econ.row_feed_eff')}</td>
          <td class="num">${e.daily.feedEfficiency.toFixed(2)}</td>
          <td><span class="status-${effInterp.level === 'excellent' || effInterp.level === 'good' ? 'ok' : (effInterp.level === 'medium' ? 'below' : 'above')}">${lbl('eff', effInterp.level)}</span> — ${msg('eff', effInterp.level)} <span class="text-muted">(ECM: ${e.daily.ecm_kg} kg)</span></td>
        </tr>
        <tr>
          <td>${t('econ.row_raw_eff')}</td>
          <td class="num">${e.daily.rawFeedEfficiency.toFixed(2)}</td>
          <td class="text-muted">${t('econ.row_raw_eff_note')}</td>
        </tr>
        <tr>
          <td>${t('econ.row_annual_rev')}</td>
          <td class="num">${e.annual.milkRevenue_tl.toLocaleString()} ₺</td>
          <td class="text-muted">${t('econ.row_annual_rev_note')}</td>
        </tr>
        <tr>
          <td>${t('econ.row_annual_iofc')}</td>
          <td class="num"><b>${e.annual.iofc_tl.toLocaleString()} ₺</b></td>
          <td class="text-muted">${t('econ.row_annual_iofc_note')}</td>
        </tr>
        ${econ.herdSize > 1 ? `
        <tr class="status-row-ok">
          <td><b>${t('econ.row_herd_daily', { n: econ.herdSize })}</b></td>
          <td class="num"><b>${e.herd.dailyIOFC_tl.toLocaleString()} ₺/${t('ration.sum_days')}</b></td>
          <td class="text-muted">${t('econ.row_herd_daily_note', { monthly: e.herd.monthlyIOFC_tl.toLocaleString() })}</td>
        </tr>
        <tr class="status-row-ok">
          <td><b>${t('econ.row_herd_annual')}</b></td>
          <td class="num"><b>${e.herd.annualIOFC_tl.toLocaleString()} ₺</b></td>
          <td class="text-muted">${t('econ.row_herd_annual_note', { n: econ.herdSize })}</td>
        </tr>` : ''}
      </tbody>
    </table>

    <div class="text-small text-muted mt-1">
      ${t('econ.iofc_note')}
    </div>
  `;
}

/**
 * Ekonomi paneli input handler'ları — süt fiyatı / sürü boyutu değişince yalnız
 * ekonomi kartını yeniden render eder (FAZ 15.8: orchestrator'dan bu modüle taşındı).
 *
 * NOT: DOM referanslarını closure'da TUTMA — re-render sonrası stale olur. Her
 * tetiklemede güncel elementler yeniden bulunur ve handler yeniden bağlanır.
 *
 * @param {HTMLElement} container - sonuç paneli kök elementi
 * @param {object} result - rationResult
 * @param {object} state - app state (state.economics okunur/yazılır)
 * @param {Function} [onChange] - ekonomi değişince çağrılır (örn. orchestrator'ın
 *   sürü-ölçek Çevresel Etki kartını senkronlaması için — modüller arası bağımlılık
 *   yaratmamak adına callback olarak geçilir).
 */
export function attachEconomicsHandlers(container, result, state, onChange) {
  const rebind = () => {
    // Her seferinde güncel DOM elementlerini bul (stale closure önlenir)
    const curPrice = container.querySelector('#econ-milk-price');
    const curHerd  = container.querySelector('#econ-herd-size');
    if (!curPrice || !curHerd) return;

    state.economics ??= { milkPrice_tl: 18, herdSize: 1 };
    state.economics.milkPrice_tl = +curPrice.value || 0;
    state.economics.herdSize     = +curHerd.value || 1;

    // Sadece ekonomi kartını yeniden render et (data-card="econ" — dil-bağımsız selector)
    const econCard = container.querySelector('.card[data-card="econ"]');
    if (econCard) {
      econCard.innerHTML = `<div class="card-title">${t('results.card_economics')}</div>${renderEconomicsPanel(result, state)}`;
      // Yeniden bağla — güncel elementlere
      const np = econCard.querySelector('#econ-milk-price');
      const nh = econCard.querySelector('#econ-herd-size');
      if (np && nh) {
        np.addEventListener('input', rebind);
        nh.addEventListener('input', rebind);
      }
    }

    if (typeof onChange === 'function') onChange();
  };

  container.querySelector('#econ-milk-price')?.addEventListener('input', rebind);
  container.querySelector('#econ-herd-size')?.addEventListener('input', rebind);
}
