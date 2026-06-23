/**
 * Sonuçlar Paneli — Orchestrator (FAZ 15.8'de modüllere bölündü)
 *
 * renderResultsPanel ana düzeni kurar; her bölüm `results/` alt modüllerinden
 * gelir (tablolar, ekonomi, AA, DCAD, FA, rumen, vitamin/mineral, ısı stresi,
 * rapor/geçmiş). Grafikler charts.js'te kalır.
 */

import { renderNutrientCharts } from '../charts.js';
import { escHtml, showToast, showLoading } from '../utils.js';
import { t } from '../i18n.js';
import { getAllFeeds } from '../../data/feedService.js';   // FAZ 17.5: danışmanlık katkısını yem listesine ekle
import { optimizeViaWorker } from '../../solver/glpkWorker.js';  // FAZ 20.3: senaryo karşılaştırma çözümleri
import { runScenarioComparison, renderScenarioComparison } from './scenarioCompare.js';  // FAZ 20.3
import { attachReportHandlers } from './results/historyReports.js';
import { renderRationItemsTable, renderDiagnostics, renderCompositionTable, renderMissingSources } from './results/tables.js';
import { renderEconomicsPanel, attachEconomicsHandlers } from './results/economicsPanel.js';
import { renderAAPanel } from './results/aminoAcidPanel.js';
import { renderDCADPanel } from './results/dcadPanel.js';
import { renderFAPanel } from './results/fattyAcidPanel.js';
import { renderRumenDynamicsPanel, renderRumenHealthPanel } from './results/rumenPanel.js';
import { renderVitaminTraceMineralPanel } from './results/vitaminMineralPanel.js';
import { renderHeatStressPanel } from './results/heatStressPanel.js';
import { renderEnvironmentalImpactPanel } from './results/environmentalImpactPanel.js';
import { renderCNCPSFractionsPanel } from './results/cncpsFractionsPanel.js';
import { renderStarchDigestionPanel } from './results/starchDigestionPanel.js';
import { renderFeedQualityPanel } from './results/feedQualityPanel.js';
import { renderINRAPanel } from './results/inraPanel.js';  // FAZ 16.1: INRA 2018 kartı
import { renderSensitivityPanel } from './results/sensitivityPanel.js';  // FAZ 20.1: gölge fiyat / hassasiyet

/**
 * PROBLEMLER #3 — TMR Nem Dengesi & Eklenecek Su.
 * Hedef TMR nemi (composition.tmr_target_moisture) verilmişse: hedef / rasyondan karşılanan /
 * su ile karşılanan (açık) yığılmış bar + eklenecek su (kg/gün) kartı. Aksi halde boş döner.
 */
function renderTmrMoisturePanel(comp) {
  const T = comp.tmr_target_moisture;
  if (!Number.isFinite(T)) return '';
  const rm = comp.tmr_ration_moisture_pct ?? 0;   // rasyondan (final TMR nem %)
  const wm = comp.tmr_water_moisture_pct ?? 0;    // su ile / açık (final TMR nem %)
  const waterKg = comp.tmr_water_add_kg ?? 0;
  const finalMoist = comp.tmr_final_moisture_pct ?? rm;
  const finalMass = comp.tmr_final_mass_kg ?? 0;
  const overTarget = finalMoist > T + 0.5;        // rasyon zaten hedeften ıslak → su gerekmez
  const total = (rm + wm) || 1;
  const rmW = Math.round(rm / total * 100);       // bar içi pay (%)
  const wmW = 100 - rmW;
  return `
    <div class="card" style="grid-column: 1 / -1">
      <div class="card-title"><i class="ti ti-droplet"></i> ${t('results.tmr_water_title')}</div>
      <div class="summary-bar">
        <div class="summary-card"><div class="val">${T}%</div><div class="lbl">${t('results.tmr_target')}</div></div>
        <div class="summary-card"><div class="val">${rm}%</div><div class="lbl">${t('results.tmr_from_ration')}</div></div>
        <div class="summary-card"><div class="val">${wm}%</div><div class="lbl">${t('results.tmr_from_water')}</div></div>
        <div class="summary-card"><div class="val">${waterKg}</div><div class="lbl">${t('results.tmr_water_add')}</div></div>
      </div>
      <div class="tmr-moist-bar" title="${t('results.tmr_target')} ${T}%">
        <div class="tmr-seg tmr-seg-ration" style="width:${rmW}%">${rmW >= 14 ? `${t('results.tmr_seg_ration')} ${rm}%` : ''}</div>
        ${wm > 0 ? `<div class="tmr-seg tmr-seg-water" style="width:${wmW}%">${wmW >= 14 ? `${t('results.tmr_seg_water')} ${wm}%` : ''}</div>` : ''}
      </div>
      <div class="text-small text-muted mt-1">${overTarget
        ? t('results.tmr_already_wet', { m: finalMoist })
        : t('results.tmr_water_note', { kg: waterKg, mass: finalMass, t: T })}</div>
    </div>`;
}

export function renderResultsPanel(container, state) {
  const result = state.rationResult;

  if (!result) {
    container.innerHTML = `
      <div class="flex-between report-bar" style="margin-bottom:1rem; flex-wrap:wrap; gap:0.75rem">
        <div></div>
        <div class="flex gap-1 no-print" style="flex-wrap: wrap; justify-content: flex-end; position: relative; z-index: 10;">
          <button class="btn btn-secondary btn-sm" id="btn-history" title="${t('results.btn_history_title')}"><i class="ti ti-history"></i> ${t('results.btn_history')}</button>
        </div>
      </div>

      <!-- Geçmiş Rasyonlar Modal (gizli, butonla açılır) -->
      <div id="history-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:1000; align-items:center; justify-content:center">
        <div class="card" style="max-width:900px; max-height:80vh; overflow:auto; margin:1rem; width:100%">
          <div class="flex-between">
            <div class="card-title" style="margin:0">${t('results.history_modal')}</div>
            <button class="btn btn-sm btn-secondary" id="btn-close-history">${t('results.close')}</button>
          </div>
          <div id="history-content" style="margin-top:1rem"></div>
        </div>
      </div>

      <div class="card">
        <div class="empty-state" style="padding:3rem">
          <div class="icon"><i class="ti ti-chart-bar"></i></div>
          <p>${t('results.no_ration')}</p>
          <p class="mt-1">${t('results.go_optimize')}</p>
        </div>
      </div>`;
      
    attachReportHandlers(container, state);
    return;
  }

  const { feasible, statusName, items, composition, diagnostics, requirements, dmi, totalCost, relaxation, infeasibilityDiagnosis, missingSources } = result;
  const optTime = state.lastOptimizedAt ? new Date(state.lastOptimizedAt).toLocaleTimeString() : '';
  // FAZ 14.8: gevşetilmiş (soft) çözüm — feasible değil ama bir rasyon var + ihlal raporu
  const relaxed = relaxation?.applied === true && items && items.length > 0;
  // FAZ 14.9: tamamen infeasible (relax bile çözemedi) → çelişen kısıt tanısı
  const iisDesc = infeasibilityDiagnosis?.description;
  // FAZ 19.1d: CNCPS iteratif motor durum bildirimi (yalnız calcMode='cncps' seçiliyken dolu)
  const cncpsEngine = result.cncps && result.cncps.mode === 'cncps' ? result.cncps : null;

  const STATUS_LABELS = {
    optimal:     t('results.st_optimal'),
    feasible:    t('results.st_feasible'),
    infeasible:  t('results.st_infeasible'),
    no_feasible: t('results.st_no_feasible'),
    unbounded:   t('results.st_unbounded'),
    undef:       t('results.st_undef'),
  };
  const statusLabel = STATUS_LABELS[statusName] ?? statusName ?? t('results.st_unknown');

  container.innerHTML = `
    <!-- Başlık & Durum + Rapor butonları -->
    <div class="flex-between report-bar" style="margin-bottom:1rem; flex-wrap:wrap; gap:0.75rem">
      <div>
        <span class="status-badge ${feasible ? 'badge-ok' : (relaxed ? 'badge-warn' : 'badge-infeasible')}">
          ${feasible ? t('results.badge_feasible') : (relaxed ? t('results.badge_relaxed') : t('results.badge_infeasible'))}
        </span>
        ${!feasible && !relaxed ? `<span class="text-muted text-small" style="margin-left:0.5rem">(${statusLabel})</span>` : ''}
        <span class="text-muted text-small" style="margin-left:0.75rem">${optTime}</span>
      </div>
      <div class="flex gap-1 no-print" style="flex-wrap: wrap; justify-content: flex-end; position: relative; z-index: 10;">
        <button class="btn btn-secondary btn-sm" id="btn-save-ration" title="${t('results.btn_save_title')}"><i class="ti ti-device-floppy"></i> ${t('results.btn_save')}</button>
        <button class="btn btn-secondary btn-sm" id="btn-history"     title="${t('results.btn_history_title')}"><i class="ti ti-history"></i> ${t('results.btn_history')}</button>
        <button class="btn btn-secondary btn-sm" id="btn-pdf"   title="${t('results.btn_pdf_title')}"><i class="ti ti-file-type-pdf"></i> ${t('results.btn_pdf')}</button>
        <button class="btn btn-secondary btn-sm" id="btn-excel" title="${t('results.btn_excel_title')}"><i class="ti ti-file-spreadsheet"></i> ${t('results.btn_excel')}</button>
        <button class="btn btn-secondary btn-sm" id="btn-print" title="${t('results.btn_print_title')}"><i class="ti ti-printer"></i> ${t('results.btn_print')}</button>
        <button class="btn btn-secondary btn-sm" id="btn-scenario" title="${t('scen.btn_title')}"><i class="ti ti-versions"></i> ${t('scen.btn')}</button>
      </div>
    </div>

    <!-- FAZ 20.3: Senaryo karşılaştırma sonuçları (buton tetikler) -->
    <div id="scenario-compare-results" class="no-print"></div>

    ${relaxed ? `<div class="warn-box box-warn">
      ${t('results.relaxed_box')}
      <ul style="margin:0.4rem 0 0 1.1rem; padding:0">
        ${relaxation.messages.map(m => `<li>${escHtml(m.message)}</li>`).join('')}
      </ul>
      <div class="text-small text-muted" style="margin-top:0.4rem">
        ${t('results.relaxed_hint')}
      </div>
    </div>` : ''}

    ${!feasible && !relaxed ? `<div class="warn-box">
      ${t('results.infeasible_box', { status: statusLabel })}<br>
      ${iisDesc ? '' : t('results.infeasible_hint')}
    </div>` : ''}

    ${!feasible && !relaxed && iisDesc ? `<div class="warn-box box-danger">
      <b>${t('results.iis_title')}</b><br>
      ${escHtml(iisDesc.summary)}
      ${iisDesc.items && iisDesc.items.length ? `
        <ul style="margin:0.4rem 0 0 1.1rem; padding:0">
          ${iisDesc.items.map(it => `<li><b>${escHtml(it.label)}</b>${it.bound ? ` <span class="text-muted">(${escHtml(it.bound)})</span>` : ''}</li>`).join('')}
        </ul>` : ''}
      <div class="text-small text-muted" style="margin-top:0.4rem">
        ${t('results.iis_hint')}
      </div>
    </div>` : ''}

    <!-- FAZ 18.2: Tüketim-duyarlı KMT — yüksek NDF (doluluk) tüketimi sınırladıysa bildir -->
    ${dmi.fillAdjusted && Number.isFinite(dmi.baseDmi) ? `
      <div class="info-box box-warn" style="margin-bottom:0.6rem">
        ${t('results.dmi_fill_note', { base: dmi.baseDmi.toFixed(1), adj: dmi.target_kg.toFixed(1), ndf: composition.ndf_pct.toFixed(0) })}
      </div>
    ` : ''}

    <!-- FAZ 18.4: Tüketim-düzeyi enerji iskontosu uygulandıysa bildir -->
    ${dmi.energyDiscountPct > 0 ? `
      <div class="info-box box-info" style="margin-bottom:0.6rem">
        ${t('results.energy_discount_note', { pct: dmi.energyDiscountPct })}
      </div>
    ` : ''}

    <!-- FAZ 19.1d: CNCPS iteratif motor durumu (calcMode='cncps') -->
    ${cncpsEngine ? (cncpsEngine.fallbackReason ? `
      <div class="info-box box-warn" style="margin-bottom:0.6rem"><i class="ti ti-settings"></i> ${t('results.cncps_engine_fallback')}</div>
    ` : `
      <div class="info-box box-info" style="margin-bottom:0.6rem"><i class="ti ti-settings"></i> ${t(cncpsEngine.converged ? 'results.cncps_engine_note' : 'results.cncps_engine_unconv', {
        iter: cncpsEngine.iterations,
        liquid: (cncpsEngine.passageRates?.liquid ?? 0).toFixed(1),
        conc: (cncpsEngine.passageRates?.concentrate ?? 0).toFixed(1),
        rough: (cncpsEngine.passageRates?.roughage ?? 0).toFixed(1),
      })}</div>
    `) : ''}

    <!-- Özet kartlar (FAZ 12 Madde 7: MP belirleyici, HP bilgi amaçlı) -->
    <div class="summary-bar">
      <div class="summary-card"${dmi.fillAdjusted ? ` title="${t('results.dmi_fill_card_title', { base: dmi.baseDmi?.toFixed(1) })}"` : ''}>
        <div class="val">${dmi.achieved_kg.toFixed(1)}${dmi.fillAdjusted ? ' <span style="font-size:0.6em; color:var(--warning)">▼</span>' : ''}</div>
        <div class="lbl">${t('results.sum_dmi')}</div>
      </div>
      <div class="summary-card" title="${t('results.sum_asfed_title')}">
        <div class="val">${(composition.asFed_kg || 0).toFixed(1)}</div>
        <div class="lbl">${t('results.sum_asfed')}</div>
      </div>
      <div class="summary-card" title="${t('results.sum_moisture_title')}">
        <div class="val">${(composition.moisture_pct ?? 0).toFixed(0)}%</div>
        <div class="lbl">${t('results.sum_moisture')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${composition.nel_mcal.toFixed(1)}</div>
        <div class="lbl">${t('results.sum_nel')}</div>
      </div>
      <div class="summary-card" title="${t('results.mp_title')}">
        <div class="val">${(composition.mp_g || 0).toFixed(0)}</div>
        <div class="lbl">${t('results.sum_mp')}</div>
      </div>
      <div class="summary-card" title="${t('results.cp_title')}">
        <div class="val">${composition.cp_pct.toFixed(1)}%</div>
        <div class="lbl">${t('results.sum_cp')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${composition.ndf_pct.toFixed(1)}%</div>
        <div class="lbl">${t('results.sum_ndf')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${totalCost.toFixed(2)}</div>
        <div class="lbl">${t('results.sum_cost')}</div>
      </div>
    </div>

    <!-- Geçmiş Rasyonlar Modal (gizli, butonla açılır) -->
    <div id="history-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:1000; align-items:center; justify-content:center">
      <div class="card" style="max-width:900px; max-height:80vh; overflow:auto; margin:1rem">
        <div class="flex-between">
          <div class="card-title" style="margin:0">${t('results.history_modal')}</div>
          <button class="btn btn-sm btn-secondary" id="btn-close-history">${t('results.close')}</button>
        </div>
        <div id="history-content" style="margin-top:1rem"></div>
      </div>
    </div>

    <div class="results-grid">
      <!-- Rasyon Bileşenleri -->
      <div class="card">
        <div class="card-title">${t('results.card_items')}</div>
        ${renderRationItemsTable(items, dmi)}
      </div>

      <!-- Diagnostik -->
      <div class="card">
        <div class="card-title">${t('results.card_diagnostics')}</div>
        ${renderMissingSources(missingSources)}
        ${renderDiagnostics(diagnostics, requirements)}
      </div>

      <!-- Enerji & Protein grafiği -->
      <div class="card">
        <div class="card-title">${t('results.card_nutrient_balance')}</div>
        <div class="chart-wrap">
          <div class="chart-inner">
            <canvas id="chart-nutrients"></canvas>
          </div>
        </div>
      </div>

      <!-- Mineral grafiği -->
      <div class="card">
        <div class="card-title">${t('results.card_mineral_balance')}</div>
        <div class="chart-wrap">
          <div class="chart-inner">
            <canvas id="chart-minerals"></canvas>
          </div>
        </div>
      </div>

      <!-- Rasyon dağılımı -->
      <div class="card">
        <div class="card-title">${t('results.card_distribution')}</div>
        <div class="chart-wrap">
          <div class="chart-inner">
            <canvas id="chart-pie"></canvas>
          </div>
        </div>
      </div>

      <!-- Besin profili tablosu -->
      <div class="card">
        <div class="card-title">${t('results.card_composition')}</div>
        ${renderCompositionTable(composition)}
      </div>

      <!-- INRA 2018 Raporu (FAZ 16.1) -->
      ${result.inra ? renderINRAPanel(result) : ''}

      <!-- PROBLEMLER #3: TMR Nem Dengesi & Eklenecek Su (yalnız hedef nem verilince) -->
      ${renderTmrMoisturePanel(composition)}

      <!-- DCAD & İdrar pH -->
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-title">${t('results.card_dcad')}</div>
        ${renderDCADPanel(composition, state.animal, result.milkFever, result.dmi?.achieved_kg)}
      </div>

      <!-- Rumen Sağlığı Skoru -->
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-title">${t('results.card_rumen_health')}</div>
        ${renderRumenHealthPanel(composition, state.animal)}
      </div>

      <!-- Rumen pH Dinamik Tahmini (FAZ 8, FAZ 16.14) -->
      ${result.rumenDynamics ? `
        <div class="card" style="grid-column: 1 / -1">
          <div class="card-title">${t('results.card_rumen_ph')}</div>
          ${renderRumenDynamicsPanel(result.rumenDynamics)}
        </div>
      ` : ''}

      <!-- FAZ 20.1: Hassasiyet / Gölge Fiyat (yalnız saf LP + cost amacı + optimal) -->
      ${result.sensitivity?.applicable ? `
        <div class="card" style="grid-column: 1 / -1">
          <div class="card-title">${t('sens.title')}</div>
          ${renderSensitivityPanel(result.sensitivity)}
        </div>
      ` : ''}

      <!-- CNCPS v6.5 Tam Alt Fraksiyonlar (FAZ 16.3) -->
      ${result.cncpsSubFractions ? `
        <div class="card" style="grid-column: 1 / -1">
          <div class="card-title">${t('results.card_cncps')}<span class="badge badge-display">${t('results.display_badge')}</span></div>
          ${renderCNCPSFractionsPanel(result)}
        </div>
      ` : ''}

      <!-- Nişasta Sindirim Profili — Rumen/Bağırsak (FAZ 16.4) -->
      ${result.starchDigestion && result.starchDigestion.starch_g > 0 ? `
        <div class="card" style="grid-column: 1 / -1">
          <div class="card-title">${t('results.card_starch')}</div>
          ${renderStarchDigestionPanel(result)}
        </div>
      ` : ''}

      <!-- Yem Kalitesi — Mikotoksin + Silaj (FAZ 16.6) -->
      ${result.mycotoxinRisk || result.silageQuality ? `
        <div class="card" style="grid-column: 1 / -1">
          <div class="card-title">${t('results.card_feed_quality')}</div>
          ${renderFeedQualityPanel(result)}
        </div>
      ` : ''}

      <!-- Yağ Asidi Profili & Süt Yağ Tahmini (FAZ 8) -->
      ${result.fattyAcids ? `
        <div class="card" style="grid-column: 1 / -1">
          <div class="card-title">${t('results.card_fatty_acid')}</div>
          ${renderFAPanel(result.fattyAcids, state.animal)}
        </div>
      ` : ''}

      <!-- Vitamin & İz Mineral Profili -->
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-title">${t('results.card_vitamin_mineral')}</div>
        ${renderVitaminTraceMineralPanel(composition, result.requirements, dmi)}
      </div>

      <!-- Isı Stresi Yönetimi (THI varsa) -->
      ${Number.isFinite(state.animal.thi) ? `
        <div class="card" style="grid-column: 1 / -1">
          <div class="card-title">${t('results.card_heat_stress')}</div>
          ${renderHeatStressPanel(state.animal, result)}
        </div>
      ` : ''}

      <!-- Amino Asit Dengesi -->
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-title">${t('results.card_amino_acid')}</div>
        ${renderAAPanel(result.aminoAcids)}
      </div>

      <!-- Ekonomik Analiz -->
      <div class="card" data-card="econ" style="grid-column: 1 / -1">
        <div class="card-title">${t('results.card_economics')}</div>
        ${renderEconomicsPanel(result, state)}
      </div>

      <!-- Çevresel Etki — Enterik Metan (FAZ 16.2) -->
      ${result.methane ? `
        <div class="card" data-card="env" style="grid-column: 1 / -1">
          <div class="card-title">${t('results.card_environmental')}<span class="badge badge-display">${t('results.display_badge')}</span></div>
          ${renderEnvironmentalImpactPanel(result, state)}
        </div>
      ` : ''}
    </div>
  `;

  // Grafikleri oluştur (küçük gecikme: DOM hazır olsun)
  requestAnimationFrame(() => {
    renderNutrientCharts(result);
  });

  // Rapor butonlarına event handler'lar
  attachReportHandlers(container, state);

  // FAZ 20.3: Senaryo karşılaştırma
  container.querySelector('#btn-scenario')?.addEventListener('click', () => runScenarioCompare(container, state));

  // Ekonomi paneli input handler'ları (FAZ 15.8: economicsPanel.js'e taşındı).
  // Sürü büyüklüğü değişince Çevresel Etki kartının (FAZ 16.2 metan herd-scale)
  // senkron kalması orchestrator'a ait → callback olarak geçilir.
  attachEconomicsHandlers(container, result, state, () => {
    if (result.methane) {
      const envCard = container.querySelector('.card[data-card="env"]');
      if (envCard) {
        envCard.innerHTML = `<div class="card-title">${t('results.card_environmental')}<span class="badge badge-display">${t('results.display_badge')}</span></div>${renderEnvironmentalImpactPanel(result, state)}`;
      }
    }
  });

  // FAZ 17.5: Danışmanlık önerisi (RP-AA / anyonik tuz) "Yem listesine ekle" butonları.
  // Önerilen hazır katkı yemini Rasyon Kurucu seçili-yem listesine (global state) ekler →
  // kullanıcı LP'ye aday yem olarak dahil edip yeniden optimize edebilir.
  attachAdvisoryFeedHandlers(container, state);

  // FAZ 23.3: Hassasiyet what-if kaydırıcıları (kullanılmayan yem fiyatını düşür → canlı yeniden-çöz)
  attachWhatIfHandlers(container, state);
}

/**
 * FAZ 23.3 — Gölge-fiyat panelindeki what-if kaydırıcıları. Kullanıcı kullanılmayan bir yemin
 * fiyatını düşürünce (debounce) state.lastOptimizeInput temel alınıp o yemin pricePerTon'u
 * override edilerek worker'da yeniden çözülür → yem rasyona GİRDİ Mİ + miktar anlık gösterilir.
 * Statik reduced-cost tablosunun ("ne kadar ucuzlarsa girer") canlı doğrulamasıdır.
 */
function attachWhatIfHandlers(container, state) {
  const sliders = container.querySelectorAll('.whatif-slider');
  if (!sliders.length) return;
  const base = state.lastOptimizeInput;
  let timer = null;
  sliders.forEach(slider => {
    const row = slider.closest('.whatif-row');
    const priceSpan = row?.querySelector('.whatif-price');
    const resultSpan = row?.querySelector('.whatif-result');
    if (!resultSpan) return;
    slider.addEventListener('input', () => {
      const price = +slider.value;
      if (priceSpan) priceSpan.textContent = `${price.toLocaleString()} ₺/ton`;
      if (!base || !Array.isArray(base.feeds)) return;
      clearTimeout(timer);
      resultSpan.textContent = '…';
      resultSpan.style.color = 'var(--text-muted)';
      timer = setTimeout(async () => {
        try {
          const feedId = slider.dataset.feedId;
          const feeds = base.feeds.map(f => f.id === feedId ? { ...f, pricePerTon: price } : f);
          const res = await optimizeViaWorker({ ...base, feeds });
          if (!res.feasible) { resultSpan.textContent = t('sens.whatif_infeasible'); resultSpan.style.color = 'var(--warning)'; return; }
          const item = res.items?.find(it => it.id === feedId);
          if (item && item.dmKg > 0.001) {
            resultSpan.innerHTML = `<i class="ti ti-check"></i> ${t('sens.whatif_in', { kg: item.dmKg.toFixed(1) })}`;
            resultSpan.style.color = 'var(--success)';
          } else {
            resultSpan.textContent = t('sens.whatif_out');
            resultSpan.style.color = 'var(--text-muted)';
          }
        } catch (e) {
          resultSpan.textContent = '—';
        }
      }, 400);
    });
  });
}

/**
 * FAZ 20.3: Senaryo karşılaştırmasını çalıştır + render et.
 * Son optimize input'unu (state.lastOptimizeInput) temel alıp 3 senaryo varyantını
 * (en ucuz / dengeli / CNCPS) worker'da çözer, #scenario-compare-results'a yazar.
 */
async function runScenarioCompare(container, state) {
  const base = state.lastOptimizeInput;
  const el = container.querySelector('#scenario-compare-results');
  if (!base || !base.animal) { showToast(t('scen.no_base'), 'warn'); return; }
  if (!el) return;
  showLoading(true, { message: t('scen.running') });
  el.innerHTML = '';
  try {
    const scenarios = await runScenarioComparison(base, optimizeViaWorker);
    const milkPrice = state.economics?.milkPrice_tl ?? 0;
    el.innerHTML = `
      <div class="card mt-2">
        <div class="flex-between">
          <div class="card-title" style="margin:0">${t('scen.title')}</div>
          <button class="btn btn-sm btn-secondary" id="btn-close-scenario" title="${t('results.close')}"><i class="ti ti-x"></i></button>
        </div>
        ${renderScenarioComparison(scenarios, { milkYield: base.animal.milkYield, milkPrice })}
      </div>`;
    el.querySelector('#btn-close-scenario')?.addEventListener('click', () => { el.innerHTML = ''; });
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    el.innerHTML = `<div class="warn-box">${t('scen.error')}: ${escHtml(err.message)}</div>`;
  } finally {
    showLoading(false);
  }
}

/**
 * FAZ 17.5: ".add-advisory-feed" butonlarını bağlar. Buton `data-feed-ids` (virgülle
 * ayrılmış yem id'leri) taşır; tıklanınca ilgili yemler state.selectedFeeds'e eklenir.
 */
function attachAdvisoryFeedHandlers(container, state) {
  container.querySelectorAll('.add-advisory-feed').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ids = (btn.dataset.feedIds || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!ids.length) return;
      btn.disabled = true;
      try {
        const added = await addAdvisoryFeeds(state, ids);
        showToast(added > 0 ? t('results.advisory_added', { n: added }) : t('results.advisory_exists'),
                  added > 0 ? 'success' : 'info');
      } catch (e) {
        showToast(String(e?.message || e), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/**
 * Verilen yem id'lerini (zaten ekli olmayanları) global state.selectedFeeds'e ekler.
 * Yem kütüphanesinden (feedService) aranır → Rasyon Kurucu render edilmemiş olsa da çalışır.
 * @returns {Promise<number>} eklenen yem sayısı
 */
async function addAdvisoryFeeds(state, ids) {
  if (!Array.isArray(state.selectedFeeds)) state.selectedFeeds = [];
  const all = await getAllFeeds();
  let added = 0;
  for (const id of ids) {
    if (state.selectedFeeds.find(s => s.id === id)) continue;   // zaten ekli
    const feed = all.find(f => f.id === id);
    if (!feed) continue;
    state.selectedFeeds.push({ id: feed.id, name: feed.name, nameEn: feed.nameEn, category: feed.category, minKg: null, maxKg: null });
    added++;
  }
  return added;
}
