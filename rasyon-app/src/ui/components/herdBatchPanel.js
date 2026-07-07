/**
 * Toplu Sürü Optimizasyonu Paneli
 *
 * Kayıtlı tüm hayvan profilleri için tek tıkla rasyon optimize eder,
 * karşılaştırmalı tablo ve toplam sürü-ölçek ekonomik analiz gösterir.
 */

import { animalProfileGetAll, herdGroupGetAll } from '../../data/db.js';
import { getAllFeeds } from '../../data/feedService.js';
import { optimizeViaWorker } from '../../solver/glpkWorker.js';
import { optimizeHerd } from '../../solver/herdOptimizer.js';  // FAZ 20.2: sürü-geneli ortak-stok optimizasyonu
import { calcEconomics } from '../../core/economics.js';
import { getSettings } from '../../data/settings.js';
import { showToast, showLoading, updateLoadingProgress, escHtml } from '../utils.js';
import { t } from '../i18n.js';

// Son toplu optimizasyon sonucu — PDF butonu için saklanır
let _lastBatchResults = null;
let _lastMilkPrice = 18;

const stageLabel = (s) => { const k = `herd.st_${s}`; const v = t(k); return v === k ? t('herd.st_early') : v; };

export async function renderHerdBatchPanel(container, state) {
  const [profiles, groups] = await Promise.all([
    animalProfileGetAll().catch(() => []),
    herdGroupGetAll().catch(() => []),
  ]);

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

      <div class="form-grid">
        <div class="form-group">
          <label>${t('herd.feed_count')}</label>
          <input type="text" value="${t('herd.feeds_unit', { n: state.selectedFeeds?.length || 0 })}" disabled />
          <span class="hint">${t('herd.feed_hint')}</span>
        </div>
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
        ${(state.selectedFeeds && state.selectedFeeds.length) ? `
          <div class="text-small text-muted" style="margin:0.4rem 0">${t('herd.hw_stock_hint')}</div>
          <div class="feed-table-wrap">
          <table class="diag-table" style="font-size:0.85rem; max-width:520px">
            <thead><tr><th>${t('herd.hw_feed')}</th><th class="num">${t('herd.hw_stock')}</th></tr></thead>
            <tbody>
              ${state.selectedFeeds.map(sf => `
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
}

// ─── FAZ 20.2: Sürü-Geneli Eşzamanlı Optimizasyon (ortak yem stoğu) ──────────

async function runHerdOptimization(container, state, profiles, groups) {
  if (!state.selectedFeeds || state.selectedFeeds.length === 0) { showToast(t('herd.select_feeds_first'), 'error'); return; }
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
    const feeds = state.selectedFeeds.map(sf => allFeeds.find(f => f.id === sf.id)).filter(Boolean);
    // Yem kg limitleri (Rasyon Kurucu ile tutarlı); MILP tipi sürü-geneli v1'de yok sayılır (saf LP).
    const feedLimits = {};
    for (const sf of state.selectedFeeds) {
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
  if (!state.selectedFeeds || state.selectedFeeds.length === 0) {
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
    const feedIds = state.selectedFeeds.map(sf => sf.id);
    const feeds = feedIds.map(id => allFeeds.find(f => f.id === id)).filter(Boolean);

    // Rasyon Kurucu ile tutarlı: kg limit + FAZ 14.11 MILP tipi
    const feedLimits = {};
    for (const sf of state.selectedFeeds) {
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
        </tr>
      </thead>
      <tbody>
        ${results.map(r => renderRow(r)).join('')}
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
  `;
}

function renderRow(r) {
  if (r.error) {
    return `
      <tr class="status-row-above">
        <td><b>${escHtml(r.profile.name || r.profile.id)}</b></td>
        <td colspan="10" class="text-muted">${escHtml(r.error)}</td>
        <td><span class="status-above">${t('herd.status_err')}</span></td>
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
