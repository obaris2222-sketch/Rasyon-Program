/**
 * Toplu Sürü Optimizasyonu Paneli
 *
 * Kayıtlı tüm hayvan profilleri için tek tıkla rasyon optimize eder,
 * karşılaştırmalı tablo ve toplam sürü-ölçek ekonomik analiz gösterir.
 */

import { animalProfileGetAll, herdGroupGetAll } from '../../data/db.js';
import { getAllFeeds, FEED_CATEGORIES, feedMatchesQuery } from '../../data/feedService.js';
import { optimizeViaWorker } from '../../solver/glpkWorker.js';
import { optimizeHerd } from '../../solver/herdOptimizer.js';
import { calcEconomics } from '../../core/economics.js';
import { getSettings } from '../../data/settings.js';
import { showToast, showLoading, updateLoadingProgress, escHtml } from '../utils.js';
import { t, feedDisplayName } from '../i18n.js';
import { renderRationItemsTable, renderDiagnostics, renderCompositionTable, renderMissingSources } from './results/tables.js';

// Son toplu optimizasyon sonucu — PDF butonu için saklanır
let _lastBatchResults = null;
let _lastMilkPrice = 18;
let _allFeeds = [];

const stageLabel = (s) => { const k = `herd.st_${s}`; const v = t(k); return v === k ? t('herd.st_early') : v; };

export async function renderHerdBatchPanel(container, state) {
  const [profiles, groups, allFeeds] = await Promise.all([
    animalProfileGetAll().catch(() => []),
    herdGroupGetAll().catch(() => []),
    getAllFeeds().catch(() => [])
  ]);
  _allFeeds = allFeeds;
  state.herdSelectedFeeds = state.herdSelectedFeeds || [];

  if (profiles.length === 0) {
    container.innerHTML = `
      <!-- 📖 Sekme Yardımı -->
      <details class="tab-help-accordion" style="margin-bottom:0.75rem">
        <summary style="cursor:pointer; font-weight:600; color:var(--primary); display:flex; align-items:center; gap:0.4rem">
          <i class="ti ti-info-circle"></i> Bu sekme ne işe yarar? <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted); margin-left:auto">▾</span>
        </summary>
        <div class="info-box" style="margin-top:0.5rem; font-size:0.85rem; line-height:1.7">
          <b>🐄 Toplu Sürü Optimizasyonu</b> — Kayıtlı tüm hayvan profilleriniz veya belirli bir grup için tek tıkla rasyon hesaplar.<br>
          • <b>Toplu Optimize (Bireysel):</b> Seçilen gruptaki her profil için kendi yem fiyatlarıyla ayrı ayrı optimum rasyonu bulur. Kârlılık, tüketim ve metan emisyonu kıyaslaması yapar.<br>
          • <b>Ortak Stok (Sürü-Geneli):</b> Seçilen yemler için çiftliğinizdeki mevcut stok miktarını (kg) veya bütçeyi (₺) girmenize olanak tanır. Program, eldeki kısıtlı yemi tüm hayvan gruplarına en kârlı olacak şekilde paylaştırır.<br>
          • <b>Raporlama:</b> Toplu sonuçları tek bir PDF raporunda (Sürü Özeti) indirebilirsiniz.
        </div>
      </details>

      <div class="card">
        <div class="card-title">${t('herd.title')}</div>
        <div class="empty-state" style="padding:2.5rem">
          <div class="icon"><i class="ti ti-users"></i></div>
          <p>${t('herd.empty_no_profile')}</p>
          <p class="mt-1">${t('herd.add_profile_first')}</p>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <!-- 📖 Sekme Yardımı -->
    <details class="tab-help-accordion" style="margin-bottom:0.75rem">
      <summary style="cursor:pointer; font-weight:600; color:var(--primary); display:flex; align-items:center; gap:0.4rem">
        <i class="ti ti-info-circle"></i> Bu sekme ne işe yarar? <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted); margin-left:auto">▾</span>
      </summary>
      <div class="info-box" style="margin-top:0.5rem; font-size:0.85rem; line-height:1.7">
        <b>🐄 Toplu Sürü Optimizasyonu</b> — Kayıtlı tüm hayvan profilleriniz veya belirli bir grup için tek tıkla rasyon hesaplar.<br>
        • <b>Toplu Optimize (Bireysel):</b> Seçilen gruptaki her profil için kendi yem fiyatlarıyla ayrı ayrı optimum rasyonu bulur. Kârlılık, tüketim ve metan emisyonu kıyaslaması yapar.<br>
        • <b>Ortak Stok (Sürü-Geneli):</b> Seçilen yemler için çiftliğinizdeki mevcut stok miktarını (kg) veya bütçeyi (₺) girmenize olanak tanır. Program, eldeki kısıtlı yemi tüm hayvan gruplarına en kârlı olacak şekilde paylaştırır.<br>
        • <b>Raporlama:</b> Toplu sonuçları tek bir PDF raporunda (Sürü Özeti) indirebilirsiniz.
      </div>
    </details>

    <div class="card">
      <div class="card-title">${t('herd.title')}
        <span class="text-small text-muted" style="font-weight:400; margin-left:auto">
          ${t('herd.n_profiles', { n: profiles.length })}
        </span>
      </div>

      <div class="info-box">
        ${t('herd.info')}
      </div>

      <div class="card mb-2" style="border-left: 4px solid var(--primary); padding-bottom: 1rem;">
        <div class="flex-between" style="margin-bottom:0.5rem">
          <div class="card-title" style="margin:0">${t('ration.feed_selection')}</div>
          <span class="text-small text-muted" id="herd-feed-count">${t('ration.feeds_selected', { n: state.herdSelectedFeeds.length })}</span>
        </div>
        <div class="text-small text-muted" style="margin-bottom:1rem">${t('herd.feed_hint')}</div>
        
        <div class="search-wrap" style="position:relative">
          <i class="ti ti-search" style="position:absolute; left:0.8rem; top:50%; transform:translateY(-50%); color:var(--text-muted)"></i>
          <input class="search-input" id="herd-feed-search" type="search"
            placeholder="${t('ration.search_feed')}" autocomplete="off"
            style="width:100%; padding:0.6rem 0.6rem 0.6rem 2.2rem; border:1px solid var(--border); border-radius:4px" />
          <div id="herd-feed-list" class="feed-selection-list" style="max-height:200px; overflow-y:auto; border:1px solid var(--border); border-top:none; border-radius:0 0 4px 4px; display:none;"></div>
        </div>

        <div id="herd-selected-feeds-area" class="mt-2"></div>
        <button class="btn btn-secondary btn-sm mt-1" id="herd-clear-feeds-btn">${t('ration.clear_all')}</button>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label>${t('herd.milk_price')}</label>
          <input type="number" id="batch-milk-price" min="0" step="0.5"
            value="${state.economics?.milkPrice_tl ?? 18}" />
        </div>
        <div class="form-group">
          <label>${t('herd.filter_group')}</label>
          <select id="batch-group-filter">
            <option value="">${t('herd.all_groups')}</option>
            ${groups.map(g => `<option value="${escHtml(g.id)}">${escHtml(g.name)} (${t('herd.heads', { n: g.animalCount || 0 })})</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="flex gap-1 mt-2">
        <button class="btn btn-primary" id="btn-batch-optimize">
          ${t('herd.optimize_all')}
        </button>
        <button class="btn btn-secondary btn-sm" id="btn-batch-clear">${t('herd.clear')}</button>
      </div>

      <details class="acc-panel mt-2">
        <summary><strong>${t('herd.hw_title')}</strong></summary>
        <div class="info-box text-small">${t('herd.hw_info')}</div>
        ${(state.herdSelectedFeeds && state.herdSelectedFeeds.length) ? `
          <div class="text-small text-muted" style="margin:0.4rem 0">${t('herd.hw_stock_hint')}</div>
          <div class="feed-table-wrap">
          <table class="diag-table" style="font-size:0.85rem; max-width:520px">
            <thead><tr><th>${t('herd.hw_feed')}</th><th class="num">${t('herd.hw_stock')}</th></tr></thead>
            <tbody>
              ${state.herdSelectedFeeds.map(sf => `
                <tr>
                  <td>${escHtml(sf.name || sf.id)}</td>
                  <td class="num"><input type="number" class="herd-stock-input" data-feed-id="${escHtml(sf.id)}" min="0" step="10" placeholder="${t('herd.hw_no_limit')}" style="width:120px" /></td>
                </tr>`).join('')}
            </tbody>
          </table>
          </div>
          <div class="form-grid" style="margin:0.6rem 0; max-width:520px">
            <div class="form-group">
              <label>${t('herd.hw_budget')}</label>
              <input type="number" id="herd-budget-input" min="0" step="100" placeholder="${t('herd.hw_budget_ph')}" />
              <span class="hint">${t('herd.hw_budget_hint')}</span>
            </div>
            <div class="form-group">
              <div class="checkbox-group" style="display:flex; align-items:center; gap:0.5rem; margin-top:1.5rem;">
                <input type="checkbox" id="herd-include-micros" />
                <label for="herd-include-micros" style="margin-bottom:0; font-weight:bold; cursor:pointer;">${t('herd.hw_include_micros')}</label>
              </div>
              <span class="hint" style="display:block; margin-top:0.5rem; line-height:1.4;">${t('herd.hw_micros_hint')}</span>
            </div>
          </div>
          <button class="btn btn-primary mt-1" id="btn-herd-optimize">${t('herd.hw_optimize')}</button>
          <div id="herd-results" class="mt-2"></div>
        ` : `<div class="info-box mt-1">${t('herd.select_feeds_first')}</div>`}
      </details>

      <hr class="divider" />

      <div id="batch-results"></div>
    </div>
  `;

  container.querySelector('#btn-batch-optimize').addEventListener('click', () =>
    runBatchOptimization(container, state, profiles, groups)
  );

  container.querySelector('#btn-batch-clear').addEventListener('click', () => {
    container.querySelector('#batch-results').innerHTML = '';
  });

  // FAZ 20.2: Sürü-geneli (ortak stok) optimizasyon
  container.querySelector('#btn-herd-optimize')?.addEventListener('click', () =>
    runHerdOptimization(container, state, profiles, groups)
  );

  setupHerdFeedSelection(container, state);
}

// ─── FAZ 20.2: Sürü-Geneli Eşzamanlı Optimizasyon (ortak yem stoğu) ──────────

async function runHerdOptimization(container, state, profiles, groups) {
  if (!state.herdSelectedFeeds || state.herdSelectedFeeds.length === 0) { showToast(t('herd.select_feeds_first'), 'error'); return; }
  const filterGroupId = container.querySelector('#batch-group-filter').value;
  const targetProfiles = filterGroupId ? profiles.filter(p => p.groupId === filterGroupId) : profiles;
  if (targetProfiles.length === 0) { showToast(t('herd.no_match_profile'), 'error'); return; }

  // Ortak yem-stoğu girdileri (as-fed kg/gün); boş/0 = sınır yok
  const sharedStock = {};
  container.querySelectorAll('.herd-stock-input').forEach(inp => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v) && v > 0) sharedStock[inp.dataset.feedId] = v;
  });
  // FAZ 23.1/23.2: günlük bütçe (₺) + iz mineral/vitamin dahil et (soft)
  const budgetRaw = parseFloat(container.querySelector('#herd-budget-input')?.value);
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 0;
  const includeMicros = !!container.querySelector('#herd-include-micros')?.checked;

  const resultsEl = container.querySelector('#herd-results');
  showLoading(true, { message: t('herd.hw_optimizing') });
  if (resultsEl) resultsEl.innerHTML = '';
  try {
    const allFeeds = await getAllFeeds();
    const feeds = state.herdSelectedFeeds.map(sf => allFeeds.find(f => f.id === sf.id)).filter(Boolean);
    // Yem kg limitleri (Rasyon Kurucu ile tutarlı); MILP tipi sürü-geneli v1'de yok sayılır (saf LP).
    const feedLimits = {};
    for (const sf of state.herdSelectedFeeds) {
      if (sf.minKg != null || sf.maxKg != null) feedLimits[sf.id] = { min: sf.minKg ?? undefined, max: sf.maxKg ?? undefined };
    }
    const science = getSettings().science || {};
    // Her profil bir "grup" (büyüklük = ait olduğu sürü grubunun hayvan sayısı; batch ile tutarlı)
    const herdGroups = targetProfiles.map(p => ({
      id: p.id,
      name: p.name || groups.find(g => g.id === p.groupId)?.name || '—',
      profile: p,
      size: groups.find(g => g.id === p.groupId)?.animalCount ?? 1,
    }));
    const res = await optimizeHerd({
      groups: herdGroups, feeds, sharedStock, budget, includeMicros,
      feedLimits, groupLimits: state.groupLimits || {},
      system: science.system || 'NASEM2021',
      dmiMethod: science.dmiMethod || 'auto',
      autoEnergyDiscount: science.autoEnergyDiscount !== false,
    });
    renderHerdResults(resultsEl, res);
  } catch (err) {
    if (resultsEl) resultsEl.innerHTML = `<div class="warn-box">${t('herd.hw_error')}: ${escHtml(err.message)}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderHerdResults(el, res) {
  if (!el) return;
  if (!res.feasible) {
    el.innerHTML = `<div class="warn-box"><i class="ti ti-alert-triangle"></i> ${escHtml(res.message)}<br><span class="text-small">${t('herd.hw_infeasible_hint')}</span></div>`;
    return;
  }
  const groupRows = res.groups.map(g => `
    <tr>
      <td><b>${escHtml(g.name)}</b></td>
      <td class="num">${g.size}</td>
      <td class="num">${Number.isFinite(g.dmi_kg) ? g.dmi_kg.toFixed(1) : '—'}</td>
      <td class="num">${g.costPerAnimal.toFixed(2)}</td>
      <td class="num"><b>${Math.round(g.costGroup).toLocaleString()}</b></td>
    </tr>`).join('');
  const stockRows = res.stockUsage.map(s => `
    <tr>
      <td>${escHtml(s.name || s.feedId)}</td>
      <td class="num">${Math.round(s.usedAsFedKg).toLocaleString()}</td>
      <td class="num">${Math.round(s.limitAsFedKg).toLocaleString()}</td>
      <td class="num" style="color:${s.utilizationPct >= 99 ? 'var(--warning)' : 'var(--text-muted)'}">${s.utilizationPct}%</td>
    </tr>`).join('');
  // FAZ 23.1: bütçe kullanım kartı (verildiyse)
  const bu = res.budgetUsage;
  const budgetCard = bu ? `
      <div class="summary-card"><div class="val" style="color:${bu.utilizationPct >= 99.5 ? 'var(--warning)' : 'var(--text)'}">${bu.utilizationPct}%</div><div class="lbl">${t('herd.hw_budget_usage')} (${Math.round(bu.limitTl).toLocaleString()} ₺)</div></div>` : '';
  // FAZ 23.2: karşılanamayan mikro-besin uyarısı (premiks gerekir)
  const microWarn = (res.microViolations && res.microViolations.length) ? `
    <div class="warn-box mt-2 text-small"><i class="ti ti-alert-triangle"></i> ${t('herd.hw_micro_violations')}:
      ${res.microViolations.map(v => `${escHtml(v.group)} — ${escHtml(v.nutrient)} (−${v.deficit})`).join('; ')}
    </div>` : '';
  el.innerHTML = `
    <div class="summary-bar">
      <div class="summary-card"><div class="val">${Math.round(res.totalCost).toLocaleString()} ₺</div><div class="lbl">${t('herd.hw_total_cost')}</div></div>
      <div class="summary-card"><div class="val">${res.groups.length}</div><div class="lbl">${t('herd.hw_groups')}</div></div>
      ${budgetCard}
    </div>
    ${microWarn}
    <div class="section-title mt-2">${t('herd.hw_group_table')}</div>
    <div class="feed-table-wrap"><table class="diag-table">
      <thead><tr><th>${t('herd.hw_group')}</th><th class="num">${t('herd.hw_size')}</th><th class="num">${t('herd.hw_dmi')}</th><th class="num">${t('herd.hw_cost_animal')}</th><th class="num">${t('herd.hw_cost_group')}</th></tr></thead>
      <tbody>${groupRows}</tbody>
    </table></div>
    ${stockRows ? `
      <div class="section-title mt-2">${t('herd.hw_stock_usage')}</div>
      <div class="feed-table-wrap"><table class="diag-table">
        <thead><tr><th>${t('herd.hw_feed')}</th><th class="num">${t('herd.hw_used')}</th><th class="num">${t('herd.hw_limit')}</th><th class="num">${t('herd.hw_util')}</th></tr></thead>
        <tbody>${stockRows}</tbody>
      </table></div>` : `<div class="info-box mt-2 text-small">${t('herd.hw_no_stock_set')}</div>`}
    <div class="text-small text-muted mt-2">${t('herd.hw_note')}</div>
  `;
}

async function runBatchOptimization(container, state, profiles, groups) {
  if (!state.herdSelectedFeeds || state.herdSelectedFeeds.length === 0) {
    showToast(t('herd.select_feeds_first'), 'error');
    return;
  }

  const filterGroupId = container.querySelector('#batch-group-filter').value;
  const milkPrice = +container.querySelector('#batch-milk-price').value || 18;

  const targetProfiles = filterGroupId
    ? profiles.filter(p => p.groupId === filterGroupId)
    : profiles;

  if (targetProfiles.length === 0) {
    showToast(t('herd.no_match_profile'), 'error');
    return;
  }

  // FAZ 15.5: sürü modunda hayvan-başına ilerleme yüzdesi
  const total = targetProfiles.length;
  let done = 0;
  showLoading(true, { message: t('herd.optimizing'), percent: 0, sub: t('herd.profiles_progress', { done: 0, total }) });
  const resultsEl = container.querySelector('#batch-results');
  resultsEl.innerHTML = `<div class="empty-state" style="padding:1rem"><p>${t('herd.optimizing_short')}</p></div>`;

  try {
    const allFeeds = await getAllFeeds();
    const feedIds = state.herdSelectedFeeds.map(sf => sf.id);
    const feeds = feedIds.map(id => allFeeds.find(f => f.id === id)).filter(Boolean);

    // Rasyon Kurucu ile tutarlı: kg limit + FAZ 14.11 MILP tipi
    const feedLimits = {};
    for (const sf of state.herdSelectedFeeds) {
      if (sf.minKg !== null || sf.maxKg !== null || sf.milpType) {
        const lim = { min: sf.minKg ?? undefined, max: sf.maxKg ?? undefined };
        if (sf.milpType) lim.type = sf.milpType;
        feedLimits[sf.id] = lim;
      }
    }
    // FAZ 14.7: kategori grup sınırları da sürü moduna taşınır
    const groupLimits = state.groupLimits || {};

    // FAZ 15.2: Bilim sistemi + KMT yöntemi Ayarlar'dan (tekil optimize ile tutarlı)
    const settings = getSettings();
    const science = settings.science || {};

    // Her profil için optimizasyonu paralelle çalıştır (FAZ 14.1: Worker üzerinden)
    const optimizationPromises = targetProfiles.map(async profile => {
      try {
        const result = await optimizeViaWorker({
          animal: profile,
          feeds,
          feedLimits,
          groupLimits,
          objective: 'cost',
          system: science.system || 'NASEM2021',
          dmiMethod: science.dmiMethod || 'auto',   // FAZ 17.3: bilim sistemiyle tutarlı
          autoEnergyDiscount: science.autoEnergyDiscount !== false,  // FAZ 18.4
          calcMode: science.calcMode || 'nrc',      // FAZ 19.1: nrc tek-geçiş | cncps iteratif
        });
        const groupName = groups.find(g => g.id === profile.groupId)?.name ?? '—';
        const groupSize = groups.find(g => g.id === profile.groupId)?.animalCount ?? 1;
        const economics = calcEconomics({
          milkYield_kg: profile.milkYield,
          milkPrice_tl: milkPrice,
          feedCost_tl_day: result.totalCost,
          dmi_kg: result.dmi.achieved_kg,
          herdSize: groupSize,
        });
        return { profile, result, economics, groupName, groupSize, error: null };
      } catch (err) {
        return { profile, result: null, economics: null, groupName: '', groupSize: 1, error: err.message };
      } finally {
        // FAZ 15.5: her profil bitince ilerleme güncellenir (paralel tamamlanma)
        done++;
        updateLoadingProgress(Math.round((done / total) * 100), t('herd.profiles_progress', { done, total }));
      }
    });

    const results = await Promise.all(optimizationPromises);
    _lastBatchResults = results;
    _lastMilkPrice = milkPrice;

    renderBatchResults(resultsEl, results, milkPrice);
    attachBatchPDFHandler(container);
    showToast(t('herd.n_optimized', { n: results.length }), 'success');
  } catch (err) {
    console.error('Toplu optimizasyon hatası:', err);
    resultsEl.innerHTML = `<div class="warn-box">${t('herd.batch_err')}${err.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderBatchResults(el, results, milkPrice) {
  const feasibleCount = results.filter(r => r.result?.feasible).length;
  const totalGroupAnimals = results.reduce((s, r) => s + r.groupSize, 0);
  const totalDailyIOFC = results.reduce(
    (s, r) => s + (r.economics?.herd?.dailyIOFC_tl ?? 0), 0
  );
  const totalDailyFeedCost = results.reduce(
    (s, r) => s + (r.economics ? r.economics.daily.feedCost_tl * r.groupSize : 0), 0
  );
  // FAZ 16.2: sürü ölçek toplam enterik metan (kg CH₄/gün) + CO₂eq (ton/yıl)
  const totalCh4KgDay = results.reduce(
    (s, r) => s + ((r.result?.methane?.production_g ?? 0) * r.groupSize) / 1000, 0
  );
  const totalCo2TonYear = results.reduce(
    (s, r) => s + ((r.result?.methane?.co2eq_kg_day ?? 0) * r.groupSize * 365) / 1000, 0
  );

  el.innerHTML = `
    <div class="flex-between" style="margin-bottom:0.75rem">
      <div></div>
      <div class="flex gap-1 no-print">
        <button class="btn btn-secondary btn-sm" id="btn-herd-pdf" title="${t('herd.herd_pdf_title')}">${t('herd.herd_pdf')}</button>
      </div>
    </div>

    <!-- Toplam özet -->
    <div class="summary-bar">
      <div class="summary-card">
        <div class="val">${results.length}</div>
        <div class="lbl">${t('herd.sum_optimized')}</div>
      </div>
      <div class="summary-card" style="background:${feasibleCount === results.length ? 'var(--primary-light)' : '#fff3cd'}">
        <div class="val">${feasibleCount}/${results.length}</div>
        <div class="lbl">${t('herd.sum_feasible')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${totalGroupAnimals}</div>
        <div class="lbl">${t('herd.sum_total_animals')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${totalDailyFeedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        <div class="lbl">${t('herd.sum_feed_cost')}</div>
      </div>
      <div class="summary-card" style="background:${totalDailyIOFC > 0 ? 'var(--primary-light)' : 'var(--above-bg)'}">
        <div class="val" style="color:${totalDailyIOFC > 0 ? 'var(--primary)' : 'var(--danger)'}">
          ${totalDailyIOFC.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
        <div class="lbl">${t('herd.sum_iofc')}</div>
      </div>
      <div class="summary-card" title="Enterik metan emisyonu (FAZ 16.2) — sürü ölçek toplam">
        <div class="val">${totalCh4KgDay.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
        <div class="lbl">${t('herd.sum_ch4')}</div>
      </div>
    </div>

    <!-- Karşılaştırma tablosu -->
    <div class="feed-table-wrap">
    <table class="diag-table" style="font-size:0.8rem">
      <thead>
        <tr>
          <th>${t('herd.col_profile')}</th>
          <th>${t('herd.col_group')}</th>
          <th>${t('herd.col_stage')}</th>
          <th class="num">${t('herd.col_milk')}</th>
          <th class="num">${t('herd.col_dmi')}</th>
          <th class="num">${t('herd.col_nel')}</th>
          <th class="num">${t('herd.col_cp')}</th>
          <th class="num">${t('herd.col_feedcost')}</th>
          <th class="num">${t('herd.col_iofc')}</th>
          <th class="num">${t('herd.col_groupsize')}</th>
          <th class="num">${t('herd.col_groupiofc')}</th>
          <th>${t('herd.col_status')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${results.map((r, i) => renderRow(r, i)).join('')}
      </tbody>
    </table>
    </div>

    <div class="text-small text-muted mt-1">
      ${t('herd.annual_iofc')}
      <b>${(totalDailyIOFC * 305).toLocaleString(undefined, { maximumFractionDigits: 0 })} ₺</b>
      &nbsp;•&nbsp; ${t('herd.milk_price_used')} <b>${milkPrice} ₺</b>
      &nbsp;•&nbsp; ${t('herd.herd_co2')}
      <b>${totalCo2TonYear.toLocaleString(undefined, { maximumFractionDigits: 0 })} ton</b>
    </div>

    <!-- Rasyon Detay Modal -->
    <div id="herd-detail-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:1000; align-items:center; justify-content:center; padding:1rem">
      <div class="card" style="max-width:900px; width:100%; max-height:90vh; overflow-y:auto; position:relative;">
        <div class="flex-between" style="position:sticky; top:0; background:var(--bg-main); padding-bottom:1rem; border-bottom:1px solid var(--border); z-index:10; margin-bottom:1rem;">
          <div class="card-title" id="herd-detail-title" style="margin:0">Rasyon Detayı</div>
          <button class="btn btn-sm btn-secondary" id="btn-close-herd-detail"><i class="ti ti-x"></i></button>
        </div>
        <div id="herd-detail-content"></div>
      </div>
    </div>
  `;

  // Detay butonlarına event listener ekle
  const detailModal = el.querySelector('#herd-detail-modal');
  const detailContent = el.querySelector('#herd-detail-content');
  const detailTitle = el.querySelector('#herd-detail-title');
  
  el.querySelector('#btn-close-herd-detail')?.addEventListener('click', () => {
    detailModal.style.display = 'none';
  });

  el.querySelectorAll('.btn-herd-detail').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const r = results[idx];
      if (!r || !r.result || !r.result.feasible) return;
      
      detailTitle.textContent = `${escHtml(r.profile.name || r.profile.id)} - Rasyon Detayı`;
      
      detailContent.innerHTML = `
        <div class="card" style="box-shadow:none; border:1px solid var(--border); margin-bottom:1rem">
          <div class="card-title">${t('results.card_items')}</div>
          ${renderRationItemsTable(r.result.items, r.result.dmi)}
        </div>
        <div class="card" style="box-shadow:none; border:1px solid var(--border); margin-bottom:1rem">
          <div class="card-title">${t('results.card_diagnostics')}</div>
          ${renderMissingSources(r.result.missingSources)}
          ${renderDiagnostics(r.result.diagnostics, r.result.requirements)}
        </div>
        <div class="card" style="box-shadow:none; border:1px solid var(--border)">
          <div class="card-title">${t('results.card_composition')}</div>
          ${renderCompositionTable(r.result.composition)}
        </div>
      `;
      
      detailModal.style.display = 'flex';
    });
  });
}

function renderRow(r, idx) {
  if (r.error) {
    return `
      <tr class="status-row-above">
        <td><b>${escHtml(r.profile.name || r.profile.id)}</b></td>
        <td colspan="10" class="text-muted">${escHtml(r.error)}</td>
        <td><span class="status-above">${t('herd.status_err')}</span></td>
        <td></td>
      </tr>`;
  }
  if (!r.result.feasible) {
    return `
      <tr class="status-row-above">
        <td><b>${escHtml(r.profile.name || r.profile.id)}</b></td>
        <td>${escHtml(r.groupName)}</td>
        <td>${stageLabel(r.profile.lactationStage)}</td>
        <td class="num">${r.profile.milkYield ?? '—'}</td>
        <td colspan="6" class="text-muted">${t('herd.status_infeasible')} (${r.result.statusName})</td>
        <td><span class="status-above">${t('herd.status_infeasible')}</span></td>
        <td></td>
      </tr>`;
  }

  const iofc = r.economics.daily.iofc_tl;
  const iofcCls = iofc > 0 ? 'status-row-ok' : 'status-row-above';

  return `
    <tr class="${iofcCls}">
      <td><b>${escHtml(r.profile.name || r.profile.id)}</b></td>
      <td>${escHtml(r.groupName)}</td>
      <td>${stageLabel(r.profile.lactationStage)}</td>
      <td class="num">${r.profile.milkYield}</td>
      <td class="num">${r.result.dmi.achieved_kg.toFixed(1)}</td>
      <td class="num">${r.result.composition.nel_mcal.toFixed(1)}</td>
      <td class="num">${r.result.composition.cp_pct.toFixed(1)}</td>
      <td class="num">${r.result.totalCost.toFixed(2)}</td>
      <td class="num"><b>${iofc.toFixed(2)}</b></td>
      <td class="num">${r.groupSize}</td>
      <td class="num"><b>${r.economics.herd.dailyIOFC_tl.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b></td>
      <td><span class="status-ok">${t('herd.status_ok')}</span></td>
      <td><button class="btn btn-sm btn-secondary btn-herd-detail" data-idx="${idx}" title="Rasyon Detayını Gör"><i class="ti ti-eye"></i> Detay</button></td>
    </tr>`;
}

// ─── Sürü PDF İndirme (FAZ 6 plan #4) ────────────────────────────────────────
function attachBatchPDFHandler(container) {
  const btn = container.querySelector('#btn-herd-pdf');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!_lastBatchResults || _lastBatchResults.length === 0) {
      showToast(t('herd.pdf_run_first'), 'error');
      return;
    }
    try {
      showToast(t('herd.pdf_prep'), 'info', 3000);
      const { downloadHerdSummaryPDF } = await import('../../reports/pdfExport.js');
      await downloadHerdSummaryPDF(_lastBatchResults, { milkPrice_tl: _lastMilkPrice });
      showToast(t('herd.pdf_done'), 'success');
    } catch (err) {
      console.error('Sürü PDF hatası:', err);
      showToast(t('herd.pdf_err') + err.message, 'error');
    }
  });
}

// ─── Sürü Geneli Yem Seçimi (Bağımsız Modül) ─────────────────────────────────

function setupHerdFeedSelection(container, state) {
  const searchInput = container.querySelector('#herd-feed-search');
  if (searchInput) {
    let debounce = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => updateHerdQuickList(container, state, searchInput.value), 200);
    });
    // Menü dışına tıklanınca listeyi gizle
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) {
        const listEl = container.querySelector('#herd-feed-list');
        if (listEl) listEl.style.display = 'none';
      }
    });
    searchInput.addEventListener('focus', () => {
      const listEl = container.querySelector('#herd-feed-list');
      if (listEl && listEl.innerHTML.trim() !== '') listEl.style.display = 'block';
    });
  }

  container.querySelector('#herd-clear-feeds-btn')?.addEventListener('click', () => {
    state.herdSelectedFeeds = [];
    refreshHerdSelectedFeeds(container, state);
  });

  updateHerdQuickList(container, state, '');
  refreshHerdSelectedFeeds(container, state);
}

function updateHerdQuickList(container, state, query) {
  const listEl = container.querySelector('#herd-feed-list');
  if (!listEl) return;

  let feeds = _allFeeds;
  if (query.trim()) {
    feeds = feeds.filter(f => feedMatchesQuery(f, query));
  } else {
    const commonKeywords = ['yonca', 'mısır silajı', 'mısır tane', 'soya', 'süt yemi', 'premiks', 'saman', 'arpa'];
    const commonFeeds = [];
    const otherFeeds = [];
    for (const f of feeds) {
      const name = (f.name || '').toLocaleLowerCase('tr-TR');
      if (commonKeywords.some(kw => name.includes(kw))) {
        commonFeeds.push(f);
      } else {
        otherFeeds.push(f);
      }
    }
    feeds = [...commonFeeds, ...otherFeeds];
  }
  const visible = feeds.slice(0, 60);

  if (visible.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="padding:0.75rem"><p>${t('ration.no_results')}</p></div>`;
    listEl.style.display = 'block';
    return;
  }

  const catLabel = (cat) => t(`feed.cat_${cat}`);

  listEl.innerHTML = visible.map(f => {
    const sel = !!state.herdSelectedFeeds.find(s => s.id === f.id);
    return `
      <div class="feed-selection-item${sel ? ' selected' : ''}" data-id="${f.id}" style="padding:0.4rem 0.6rem; cursor:pointer; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:0.5rem">
        <input type="checkbox" ${sel ? 'checked' : ''} data-id="${f.id}" style="margin:0" />
        <span class="feed-sel-name" style="flex:1">${escHtml(feedDisplayName(f))}</span>
        <span class="feed-sel-cat" style="font-size:0.7rem; color:var(--text-muted); background:var(--bg-main); padding:0.1rem 0.3rem; border-radius:3px">${catLabel(f.category)}</span>
      </div>`;
  }).join('');
  listEl.style.display = 'block';

  listEl.querySelectorAll('.feed-selection-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Checkbox tıklandıysa çift tetiklemeyi önle
      if (e.target.tagName.toLowerCase() === 'input') return;
      const chk = item.querySelector('input');
      chk.checked = !chk.checked;
      chk.dispatchEvent(new Event('change'));
    });
  });

  listEl.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.id;
      if (chk.checked) {
        if (!state.herdSelectedFeeds.find(s => s.id === id)) {
          const feed = _allFeeds.find(f => f.id === id);
          if (feed) {
            state.herdSelectedFeeds.push({ id: feed.id, name: feed.name, nameEn: feed.nameEn, category: feed.category, minKg: null, maxKg: null });
          }
        }
      } else {
        const idx = state.herdSelectedFeeds.findIndex(s => s.id === id);
        if (idx !== -1) {
          state.herdSelectedFeeds.splice(idx, 1);
        }
      }
      refreshHerdSelectedFeeds(container, state);
    });
  });
}

function refreshHerdSelectedFeeds(container, state) {
  const area = container.querySelector('#herd-selected-feeds-area');
  if (!area) return;

  const countSpan = container.querySelector('#herd-feed-count');
  if (countSpan) countSpan.textContent = t('ration.feeds_selected', { n: state.herdSelectedFeeds.length });

  if (state.herdSelectedFeeds.length === 0) {
    area.innerHTML = `<div class="empty-state" style="padding:1rem; background:var(--bg-main); border-radius:4px">
      <div class="icon" style="font-size:1.5rem"><i class="ti ti-leaf"></i></div>
      <p>Sürü optimizasyonlarında kullanılmak üzere henüz yem seçilmedi.</p>
    </div>`;
    return;
  }

  // Sadece Min/Maks kg gösterilecek, MILP vs yok
  area.innerHTML = `
    <div class="selected-feeds-list">
      <div class="selected-feed-row selected-feed-head" style="font-weight:700; font-size:0.72rem; color:var(--text-muted); display:grid; grid-template-columns: 2fr 1fr 1fr 30px; gap:0.5rem; padding-bottom:0.4rem">
        <span>${t('ration.col_feed')}</span><span>${t('ration.col_min')}</span><span>${t('ration.col_max')}</span><span></span>
      </div>
      ${state.herdSelectedFeeds.map((sf, i) => `
        <div class="selected-feed-row" data-idx="${i}" style="display:grid; grid-template-columns: 2fr 1fr 1fr 30px; gap:0.5rem; align-items:center; margin-bottom:0.4rem">
          <span title="${sf.category}" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escHtml(feedDisplayName(sf))}</span>
          <input type="number" class="limit-min" min="0" step="0.1" value="${sf.minKg ?? ''}" placeholder="—" data-idx="${i}" style="width:100%" />
          <input type="number" class="limit-max" min="0" step="0.1" value="${sf.maxKg ?? ''}" placeholder="—" data-idx="${i}" style="width:100%" />
          <button class="remove-feed-btn btn btn-sm btn-secondary" data-idx="${i}" aria-label="Kaldır" style="padding:0.2rem; display:flex; justify-content:center"><i class="ti ti-x"></i></button>
        </div>
      `).join('')}
    </div>`;

  area.querySelectorAll('.remove-feed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      state.herdSelectedFeeds.splice(idx, 1);
      refreshHerdSelectedFeeds(container, state);
      updateHerdQuickList(container, state, container.querySelector('#herd-feed-search')?.value ?? '');
    });
  });

  area.querySelectorAll('.limit-min').forEach(input => {
    input.addEventListener('change', () => {
      const idx = +input.dataset.idx;
      state.herdSelectedFeeds[idx].minKg = input.value !== '' ? +input.value : null;
    });
  });

  area.querySelectorAll('.limit-max').forEach(input => {
    input.addEventListener('change', () => {
      const idx = +input.dataset.idx;
      state.herdSelectedFeeds[idx].maxKg = input.value !== '' ? +input.value : null;
    });
  });
}

