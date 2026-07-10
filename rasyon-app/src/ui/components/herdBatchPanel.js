/**
 * Toplu Sürü Optimizasyonu Paneli
 *
 * Kayıtlı tüm hayvan profilleri için tek tıkla rasyon optimize eder,
 * karşılaştırmalı tablo ve toplam sürü-ölçek ekonomik analiz gösterir.
 */

import { animalProfileGetAll, herdGroupGetAll, animalProfilePut, rationGetAll, getActiveFarmId, farmGetById, farmPut } from '../../data/db.js';
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
  const [profiles, groups, allFeeds, rations] = await Promise.all([
    animalProfileGetAll().catch(() => []),
    herdGroupGetAll().catch(() => []),
    getAllFeeds().catch(() => []),
    rationGetAll().catch(() => [])
  ]);
  _allFeeds = allFeeds;

  if (profiles.length === 0) {
    container.innerHTML = `
      <!-- 📖 Sekme Yardımı -->
      <details class="tab-help-accordion" style="margin-bottom:0.75rem">
        <summary style="cursor:pointer; font-weight:600; color:var(--primary); display:flex; align-items:center; gap:0.4rem">
          <i class="ti ti-info-circle"></i> Bu sekme ne işe yarar? <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted); margin-left:auto">▾</span>
        </summary>
        <div class="info-box" style="margin-top:0.5rem; font-size:0.85rem; line-height:1.7">
          <b>🚜 Çiftlik Yönetim ve TMR Paneli</b> — Çiftliğinizdeki tüm grupların yem yönetimini tek ekrandan yapmanızı sağlar.<br>
          • <b>Rasyon Atama:</b> Kuru dönem, sağmal veya düveleriniz için hazırladığınız kayıtlı rasyonları ilgili gruplara atayın.<br>
          • <b>Günlük TMR İhtiyacı:</b> Tüm grupların hayvan sayıları ve reçeteleri üzerinden çiftliğinizin günlük toplam karma yem (TMR) tonajını otomatik hesaplar.<br>
          • <b>Maliyet Takibi:</b> Güncel fiyatlar üzerinden tüm çiftliğin makro karlılığını gösterir.
        </div>
      </details>

      <div class="card">
        <div class="card-title">Çiftlik Yönetim ve TMR Paneli</div>
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
        <b>🚜 Çiftlik Yönetim ve TMR Paneli</b> — Çiftliğinizdeki tüm grupların yem yönetimini tek ekrandan yapmanızı sağlar.<br>
        • <b>Rasyon Atama:</b> Kuru dönem, sağmal veya düveleriniz için hazırladığınız kayıtlı rasyonları ilgili gruplara atayın.<br>
        • <b>Günlük TMR İhtiyacı:</b> Tüm grupların hayvan sayıları ve reçeteleri üzerinden çiftliğinizin günlük toplam karma yem (TMR) tonajını otomatik hesaplar.<br>
        • <b>Stok Takibi:</b> Sürünüzün TMR ihtiyacına göre mevcut yem stoklarınızın kaç gün yeteceğini hesaplar.<br>
        • <b>Maliyet Takibi:</b> Güncel fiyatlar üzerinden tüm çiftliğin makro karlılığını gösterir.
      </div>
    </details>

    <div class="card">
      <div class="card-title">Çiftlik Yönetim ve TMR Paneli
        <span class="text-small text-muted" style="font-weight:400; margin-left:auto">
          ${t('herd.n_profiles', { n: profiles.length })}
        </span>
      </div>

      <div class="info-box">
        Bu panelde çiftliğinizdeki tüm hayvan gruplarına <b>kayıtlı rasyonlarınızı</b> atayabilir, güncel maliyetler ve hammadde fiyatları üzerinden çiftliğinizin makro özetini, <b>Günlük TMR (Yem) İhtiyacını</b> ve <b>Stok Durumunu</b> hesaplayabilirsiniz. Sağmallar, kuru dönem veya düveler için hazırladığınız özel reçeteleri kendi gruplarına bağlayarak tek ekrandan tüm çiftlik yükleme tablosunu görebilirsiniz.
      </div>

      <div class="card mb-2" style="border-left: 4px solid var(--primary); padding-bottom: 1rem;">
        <div class="card-title" style="margin-bottom: 0.5rem">Aktif Rasyon Atamaları</div>
        <div class="text-small text-muted" style="margin-bottom:1rem">Aşağıdaki her grup/profil için Rasyon Kurucu'da kaydettiğiniz reçetelerden birini seçin.</div>
        
        <div class="feed-table-wrap">
          <table class="diag-table" style="font-size:0.9rem; min-width: 450px;">
            <thead>
              <tr>
                <th>Profil / Grup Adı</th>
                <th>Bağlı Olduğu Sürü</th>
                <th>Aktif Kayıtlı Rasyon</th>
              </tr>
            </thead>
            <tbody>
              ${profiles.map(p => {
                const group = groups.find(g => g.id === p.groupId);
                const profileRations = rations.filter(r => r.animal?.id === p.id || r.animal?._profileId === p.id);
                profileRations.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
                const rationOpts = profileRations.map(r => `<option value="${r.id}" ${p.targetRationId === r.id ? 'selected' : ''}>${escHtml(r.name || r.id)}</option>`).join('');
                return `
                  <tr>
                    <td><b>${escHtml(p.name || p.id)}</b></td>
                    <td>${group ? escHtml(group.name) : '<span class="text-muted">—</span>'}</td>
                    <td>
                      <select class="profile-ration-select" data-profile-id="${p.id}" style="width: 100%; min-width: 150px;">
                        <option value="">-- Rasyon Seçin --</option>
                        ${rationOpts}
                      </select>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
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
          <i class="ti ti-calculator"></i> Çiftlik Tablosunu Hesapla
        </button>
        <button class="btn btn-secondary btn-sm" id="btn-batch-clear">${t('herd.clear')}</button>
      </div>

      <hr class="divider" />

      <div id="batch-results"></div>
    </div>
  `;

  // Profil-Rasyon atama değişikliklerini yakala ve kaydet
  container.querySelectorAll('.profile-ration-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const profileId = sel.dataset.profileId;
      const rationId = sel.value;
      const profile = profiles.find(p => p.id === profileId);
      if (profile) {
        profile.targetRationId = rationId || null;
        try {
          await animalProfilePut(profile);
          showToast('Rasyon ataması kaydedildi', 'success');
        } catch (e) {
          showToast('Hata: Atama kaydedilemedi', 'error');
        }
      }
    });
  });

  container.querySelector('#btn-batch-optimize').addEventListener('click', () =>
    runBatchOptimization(container, state, profiles, groups)
  );

  container.querySelector('#btn-batch-clear').addEventListener('click', () => {
    container.querySelector('#batch-results').innerHTML = '';
    _lastBatchResults = null; // Temizlendiğinde state'i sıfırla
  });

  // Eğer programda daha önce hesaplama yapıldıysa tabloyu geri getir
  if (_lastBatchResults && _lastBatchResults.length > 0) {
    const resultsEl = container.querySelector('#batch-results');
    renderBatchResults(resultsEl, _lastBatchResults, _lastMilkPrice).then(() => {
      attachBatchPDFHandler(container);
      attachStockHandlers(container);
    });
  }
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
  const filterGroupId = container.querySelector('#batch-group-filter').value;
  const milkPrice = +container.querySelector('#batch-milk-price').value || 18;

  const targetProfiles = filterGroupId
    ? profiles.filter(p => p.groupId === filterGroupId)
    : profiles;

  if (targetProfiles.length === 0) {
    showToast(t('herd.no_match_profile'), 'error');
    return;
  }

  const total = targetProfiles.length;
  let done = 0;
  showLoading(true, { message: 'TMR İhtiyaçları Hesaplanıyor...', percent: 0, sub: t('herd.profiles_progress', { done: 0, total }) });
  const resultsEl = container.querySelector('#batch-results');
  resultsEl.innerHTML = `<div class="empty-state" style="padding:1rem"><p>Hesaplanıyor...</p></div>`;

  try {
    const rations = await rationGetAll();
    const allFeeds = await getAllFeeds();
    const settings = getSettings();
    const science = settings.science || {};

    const optimizationPromises = targetProfiles.map(async profile => {
      try {
        if (!profile.targetRationId) {
           return { profile, result: null, economics: null, groupName: '', groupSize: 1, error: 'Kayıtlı rasyon atanmamış.' };
        }
        
        const ration = rations.find(r => r.id === profile.targetRationId);
        if (!ration) {
           return { profile, result: null, economics: null, groupName: '', groupSize: 1, error: 'Atanan rasyon bulunamadı (silinmiş olabilir).' };
        }

        if (!ration.result) {
           return { profile, result: null, economics: null, groupName: '', groupSize: 1, error: 'Kayıtlı rasyonun sonuç verisi eksik.' };
        }

        // Yeniden optimize etmek yerine kaydedilmiş reçeteyi güncel maliyetlerle klonla
        const clonedResult = JSON.parse(JSON.stringify(ration.result));
        let updatedTotalCost = 0;
        
        if (clonedResult.items && Array.isArray(clonedResult.items)) {
           clonedResult.items.forEach(item => {
              const currentFeed = allFeeds.find(f => f.id === (item.id || item.feedId));
              if (currentFeed && currentFeed.pricePerTon) {
                 const currentPrice = Number(currentFeed.pricePerTon);
                 const dmFraction = (Number(currentFeed.dm) || 90) / 100;
                 item.costPerDay = (item.dmKg * (currentPrice / 1000)) / dmFraction;
              }
              updatedTotalCost += item.costPerDay;
           });
           clonedResult.totalCost = updatedTotalCost;
        }

        const groupName = groups.find(g => g.id === profile.groupId)?.name ?? '—';
        const groupSize = groups.find(g => g.id === profile.groupId)?.animalCount ?? 1;
        const economics = calcEconomics({
          milkYield_kg: profile.milkYield,
          milkPrice_tl: milkPrice,
          feedCost_tl_day: updatedTotalCost,
          dmi_kg: clonedResult.dmi?.achieved_kg || 0,
          herdSize: groupSize,
        });

        return { profile, result: clonedResult, economics, groupName, groupSize, error: null };
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

    await renderBatchResults(resultsEl, results, milkPrice);
    attachBatchPDFHandler(container);
    attachStockHandlers(container);
    showToast(`${results.length} profil için hesaplama tamamlandı.`, 'success');
  } catch (err) {
    console.error('Toplu optimizasyon hatası:', err);
    resultsEl.innerHTML = `<div class="warn-box">${t('herd.batch_err')}${err.message}</div>`;
  } finally {
    showLoading(false);
  }
}

async function renderBatchResults(el, results, milkPrice) {
  const activeFarmId = getActiveFarmId();
  const activeFarm = activeFarmId ? await farmGetById(activeFarmId) : null;
  const stockTracking = activeFarm?.stockTracking || {};
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
        <div class="lbl">Hesaplanan Grup</div>
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
          <th class="num">MP (G)</th>
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

    ${(() => {
      const tmrTotals = {};
      results.filter(r => r.result && r.result.items).forEach(r => {
        r.result.items.forEach(item => {
          const feedId = item.id || item.feedId || item.name;
          const feedName = item.name;
          const dailyKg = item.asFedKg * (r.groupSize || 1);
          if (!tmrTotals[feedId]) {
            tmrTotals[feedId] = { name: feedName, kg: 0 };
          }
          tmrTotals[feedId].kg += dailyKg;
        });
      });

      const tmrRows = Object.values(tmrTotals)
        .sort((a, b) => b.kg - a.kg)
        .map(t => `
          <tr>
            <td>${escHtml(t.name)}</td>
            <td class="num">${t.kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</td>
            <td class="num">${(t.kg * 30).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</td>
          </tr>
        `).join('');

      const tmrCard = tmrRows ? `
        <div class="card mt-2 p-1 border-primary">
          <div class="flex-between" style="margin-bottom:0.5rem">
            <div class="card-title text-primary" style="margin-bottom:0">
              <i class="ti ti-truck-delivery"></i> Günlük Yükleme (TMR) İhtiyacı
            </div>
            <div class="flex gap-1 no-print">
              <button class="btn btn-sm btn-outline" id="btn-tmr-pdf" title="TMR İhtiyacını PDF Olarak İndir" style="border-color:var(--danger); color:var(--danger); padding:0.4rem 0.6rem;"><i class="ti ti-file-type-pdf"></i></button>
              <button class="btn btn-sm btn-outline" id="btn-tmr-excel" title="TMR İhtiyacını Excel Olarak İndir" style="border-color:var(--success); color:var(--success); padding:0.4rem 0.6rem;"><i class="ti ti-file-spreadsheet"></i></button>
            </div>
          </div>
          <div class="text-small text-muted" style="margin-bottom:1rem">
            Tüm hesaplanan grupların günlük ve aylık toplam karma ihtiyacı
          </div>
          <div class="feed-table-wrap">
            <table class="diag-table" style="min-width: 450px;">
              <thead>
                <tr>
                  <th>Yem Adı</th>
                  <th class="num">Günlük Toplam (Kg)</th>
                  <th class="num">Aylık Toplam (Kg)</th>
                </tr>
              </thead>
              <tbody>
                ${tmrRows}
              </tbody>
            </table>
          </div>
        </div>
      ` : '';

      let stockRows = '';
      if (Object.keys(tmrTotals).length > 0) {
        stockRows = Object.entries(tmrTotals)
          .sort((a, b) => b[1].kg - a[1].kg)
          .map(([feedId, t]) => {
            const stock = stockTracking[feedId] || {};
            const stockQty = stock.stockQty || '';
            const stockUnit = stock.stockUnit || 'kg';
            const planQty = stock.planQty || '';
            const planUnit = stock.planUnit || 'gun';
            
            const inputStyle = 'width:70px; text-align:center; padding:0.4rem; border:1px solid var(--border); border-radius:10px; background:var(--bg-main); color:var(--text); outline:none; font-size:0.85rem;';
            const selectStyle = 'padding:0.4rem 1.2rem 0.4rem 0.6rem; border:1px solid var(--border); border-radius:10px; background:var(--bg-main); color:var(--text); outline:none; font-size:0.85rem; cursor:pointer;';

            return `
              <tr class="stock-row" data-feed-id="${escHtml(feedId)}" data-daily-kg="${t.kg}">
                <td>${escHtml(t.name)}</td>
                <td class="num">${t.kg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                <td>
                  <div class="flex gap-1" style="justify-content:center">
                    <input type="number" class="stock-qty-input" style="${inputStyle}" value="${stockQty}" min="0">
                    <select class="stock-unit-input" style="${selectStyle}">
                      <option value="kg" ${stockUnit === 'kg' ? 'selected' : ''}>kg</option>
                      <option value="ton" ${stockUnit === 'ton' ? 'selected' : ''}>ton</option>
                    </select>
                  </div>
                </td>
                <td>
                  <div class="flex gap-1" style="justify-content:center">
                    <input type="number" class="plan-qty-input" style="${inputStyle}" value="${planQty}" min="0">
                    <select class="plan-unit-input" style="${selectStyle}">
                      <option value="gun" ${planUnit === 'gun' ? 'selected' : ''}>Gün</option>
                      <option value="hafta" ${planUnit === 'hafta' ? 'selected' : ''}>Hafta</option>
                      <option value="ay" ${planUnit === 'ay' ? 'selected' : ''}>Ay</option>
                    </select>
                  </div>
                </td>
                <td class="stock-status-cell" style="font-weight:bold; white-space:nowrap; text-align:right; width:120px;"></td>
              </tr>
            `;
          }).join('');
      }

      const stockCard = stockRows ? `
        <div class="card mt-2 p-1 border-primary">
          <div class="flex-between" style="margin-bottom:0.5rem">
            <div class="card-title text-primary" style="margin-bottom:0">
              <i class="ti ti-packages"></i> Stok Takibi
            </div>
            <div class="flex gap-1 no-print">
              <button class="btn btn-sm btn-secondary" id="btn-stock-clear"><i class="ti ti-trash"></i> Temizle</button>
              <button class="btn btn-sm btn-primary" id="btn-stock-save"><i class="ti ti-device-floppy"></i> Kaydet</button>
              <button class="btn btn-sm btn-outline" id="btn-stock-pdf" title="Stok Raporunu PDF İndir" style="border-color:var(--danger); color:var(--danger)"><i class="ti ti-file-type-pdf"></i></button>
              <button class="btn btn-sm btn-outline" id="btn-stock-excel" title="Stok Raporunu Excel İndir" style="border-color:var(--success); color:var(--success)"><i class="ti ti-file-spreadsheet"></i></button>
            </div>
          </div>
          <div class="text-small text-muted" style="margin-bottom:1rem">
            Günlük TMR ihtiyacına göre stoklarınızın ne kadar süre yeteceğini hesaplayın.
          </div>
          <div class="feed-table-wrap" style="overflow-x:auto; -webkit-overflow-scrolling:touch; width:100%">
            <table class="diag-table" id="stock-tracking-table" style="min-width: 750px;">
              <thead>
                <tr>
                  <th>Yem Adı</th>
                  <th class="num">Günlük İhtiyaç (kg)</th>
                  <th style="text-align:center">Stok Miktarı</th>
                  <th style="text-align:center">Planlanan Zaman</th>
                  <th style="text-align:right">Durum</th>
                </tr>
              </thead>
              <tbody>
                ${stockRows}
              </tbody>
            </table>
          </div>
        </div>
      ` : '';

      return tmrCard + stockCard;
    })()}

    <!-- Rasyon Detay Modal -->
    <div id="herd-detail-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:1000; align-items:center; justify-content:center; padding:1rem">
      <div class="card" style="max-width:900px; width:100%; max-height:90vh; overflow-y:auto; position:relative;">
        <div class="flex-between" style="padding-bottom:1rem; border-bottom:1px solid var(--border); margin-bottom:1rem;">
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
      if (!r || !r.result) return;
      
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
  if (r.error && !r.result) {
    return `
      <tr class="status-row-below" style="opacity:0.8">
        <td><b>${escHtml(r.profile.name || r.profile.id)}</b></td>
        <td colspan="11" class="text-muted">${escHtml(r.error)}</td>
        <td><span class="status-above">${t('herd.status_err')}</span></td>
        <td></td>
      </tr>`;
  }
  
  const iofc = r.economics?.daily?.iofc_tl || 0;
  const isFeasible = r.result && r.result.feasible !== false; // if cloned old ration, assume feasible
  const iofcCls = isFeasible ? (iofc > 0 ? 'status-row-ok' : 'status-row-above') : 'status-row-above';
  
  return `
    <tr class="${iofcCls}">
      <td><b>${escHtml(r.profile.name || r.profile.id)}</b></td>
      <td>${escHtml(r.groupName)}</td>
      <td>${stageLabel(r.profile.lactationStage)}</td>
      <td class="num">${r.profile.milkYield ?? '—'}</td>
      <td class="num">${r.result?.dmi?.achieved_kg?.toFixed(1) || '—'}</td>
      <td class="num">${r.result?.composition?.nel_mcal?.toFixed(1) || '—'}</td>
      <td class="num">${r.result?.composition?.mp_g?.toFixed(0) || '—'}</td>
      <td class="num">${r.result?.composition?.cp_pct?.toFixed(1) || '—'}</td>
      <td class="num">${r.result?.totalCost?.toFixed(2) || '—'}</td>
      <td class="num"><b>${iofc ? iofc.toFixed(2) : '—'}</b></td>
      <td class="num">${r.groupSize}</td>
      <td class="num"><b>${r.economics?.herd?.dailyIOFC_tl?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '—'}</b></td>
      <td><span class="${isFeasible ? 'status-ok' : 'status-above'}">${isFeasible ? t('herd.status_ok') : t('herd.status_infeasible')}</span></td>
      <td><button class="btn btn-sm btn-secondary btn-herd-detail" data-idx="${idx}" title="Rasyon Detayını Gör"><i class="ti ti-eye"></i> Detay</button></td>
    </tr>`;
}

// ─── Sürü PDF İndirme (FAZ 6 plan #4) ────────────────────────────────────────
function attachBatchPDFHandler(container) {
  const btn = container.querySelector('#btn-herd-pdf');
  if (btn) {
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

  const btnTmrPdf = container.querySelector('#btn-tmr-pdf');
  if (btnTmrPdf) {
    btnTmrPdf.addEventListener('click', async () => {
      if (!_lastBatchResults || _lastBatchResults.length === 0) return;
      try {
        showToast('PDF hazırlanıyor...', 'info', 2000);
        const { downloadTmrPDF } = await import('../../reports/pdfExport.js');
        await downloadTmrPDF(_lastBatchResults);
        showToast('TMR PDF indirildi', 'success');
      } catch (err) {
        console.error('TMR PDF hatası:', err);
        showToast('PDF hatası: ' + err.message, 'error');
      }
    });
  }

  const btnTmrExcel = container.querySelector('#btn-tmr-excel');
  if (btnTmrExcel) {
    btnTmrExcel.addEventListener('click', async () => {
      if (!_lastBatchResults || _lastBatchResults.length === 0) return;
      try {
        showToast('Excel hazırlanıyor...', 'info', 2000);
        const { downloadTmrExcel } = await import('../../reports/excelExport.js');
        await downloadTmrExcel(_lastBatchResults);
        showToast('TMR Excel indirildi', 'success');
      } catch (err) {
        console.error('TMR Excel hatası:', err);
        showToast('Excel hatası: ' + err.message, 'error');
      }
    });
  }
}

// ─── Stok Takibi Etkileşimleri ──────────────────────────────────────────────
function attachStockHandlers(container) {
  const table = container.querySelector('#stock-tracking-table');
  if (!table) return;

  const updateStatus = (row) => {
    const dailyKg = parseFloat(row.dataset.dailyKg) || 0;
    const stockQtyRaw = parseFloat(row.querySelector('.stock-qty-input').value);
    const stockUnit = row.querySelector('.stock-unit-input').value;
    const planQtyRaw = parseFloat(row.querySelector('.plan-qty-input').value);
    const planUnit = row.querySelector('.plan-unit-input').value;
    const statusCell = row.querySelector('.stock-status-cell');

    if (isNaN(stockQtyRaw) && isNaN(planQtyRaw)) {
      statusCell.textContent = '';
      return;
    }

    const stockKg = isNaN(stockQtyRaw) ? 0 : (stockUnit === 'ton' ? stockQtyRaw * 1000 : stockQtyRaw);
    let planDays = 0;
    if (!isNaN(planQtyRaw)) {
      if (planUnit === 'hafta') planDays = planQtyRaw * 7;
      else if (planUnit === 'ay') planDays = planQtyRaw * 30;
      else planDays = planQtyRaw;
    }

    // Stok yetme süresini hesapla (sadece stok girilmişse)
    if (!isNaN(stockQtyRaw) && isNaN(planQtyRaw)) {
      const daysWillLast = dailyKg > 0 ? Math.floor(stockKg / dailyKg) : 0;
      statusCell.textContent = `${daysWillLast} gün yetecek`;
      statusCell.style.color = 'var(--text)';
      return;
    }

    // Hedef ihtiyacı hesapla (ikisi de girilmişse)
    if (!isNaN(stockQtyRaw) && !isNaN(planQtyRaw)) {
      const neededKg = dailyKg * planDays;
      const diffKg = stockKg - neededKg;

      if (diffKg >= 0) {
        statusCell.textContent = 'Yeterli';
        statusCell.style.color = 'var(--success)';
      } else {
        const missing = Math.abs(diffKg);
        const missingText = missing >= 1000 ? `${(missing / 1000).toFixed(2)} ton eksik` : `${missing.toFixed(0)} kg eksik`;
        statusCell.textContent = missingText;
        statusCell.style.color = 'var(--danger)';
      }
    }
  };

  const rows = table.querySelectorAll('.stock-row');
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.addEventListener('input', () => updateStatus(row));
      input.addEventListener('change', () => updateStatus(row));
    });
    // İlk render'da hesapla
    updateStatus(row);
  });

  const btnSave = container.querySelector('#btn-stock-save');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const activeFarmId = getActiveFarmId();
      if (!activeFarmId) return;
      try {
        showLoading(true, { message: 'Kaydediliyor...' });
        const farm = await farmGetById(activeFarmId);
        if (!farm) throw new Error('Aktif çiftlik bulunamadı.');
        
        farm.stockTracking = farm.stockTracking || {};
        rows.forEach(row => {
          const feedId = row.dataset.feedId;
          farm.stockTracking[feedId] = {
            stockQty: parseFloat(row.querySelector('.stock-qty-input').value) || '',
            stockUnit: row.querySelector('.stock-unit-input').value,
            planQty: parseFloat(row.querySelector('.plan-qty-input').value) || '',
            planUnit: row.querySelector('.plan-unit-input').value,
          };
        });
        
        await farmPut(farm);
        showToast('Stok bilgileri başarıyla kaydedildi.', 'success');
      } catch (err) {
        showToast('Hata: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    });
  }

  const btnClear = container.querySelector('#btn-stock-clear');
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      rows.forEach(row => {
        row.querySelector('.stock-qty-input').value = '';
        row.querySelector('.stock-unit-input').value = 'kg';
        row.querySelector('.plan-qty-input').value = '';
        row.querySelector('.plan-unit-input').value = 'gun';
        updateStatus(row);
      });
      
      const activeFarmId = getActiveFarmId();
      if (!activeFarmId) return;
      try {
        const farm = await farmGetById(activeFarmId);
        if (farm) {
          farm.stockTracking = {};
          await farmPut(farm);
        }
      } catch (err) {
        console.error('Temizleme hatası', err);
      }
    });
  }

  const btnStockPdf = container.querySelector('#btn-stock-pdf');
  if (btnStockPdf) {
    btnStockPdf.addEventListener('click', async () => {
      try {
        const data = Array.from(rows).map(r => ({
          feedName: r.cells[0].textContent.trim(),
          dailyKg: parseFloat(r.dataset.dailyKg) || 0,
          stockQty: r.querySelector('.stock-qty-input').value,
          stockUnit: r.querySelector('.stock-unit-input').value,
          planQty: r.querySelector('.plan-qty-input').value,
          planUnit: r.querySelector('.plan-unit-input').value,
          status: r.querySelector('.stock-status-cell').textContent.trim()
        }));
        showToast('Stok PDF hazırlanıyor...', 'info', 2000);
        const { downloadStockReportPDF } = await import('../../reports/pdfExport.js');
        await downloadStockReportPDF(data);
        showToast('Stok PDF indirildi', 'success');
      } catch (err) {
        console.error('Stok PDF hatası:', err);
        showToast('PDF hatası: ' + err.message, 'error');
      }
    });
  }

  const btnStockExcel = container.querySelector('#btn-stock-excel');
  if (btnStockExcel) {
    btnStockExcel.addEventListener('click', async () => {
      try {
        const data = Array.from(rows).map(r => ({
          feedName: r.cells[0].textContent.trim(),
          dailyKg: parseFloat(r.dataset.dailyKg) || 0,
          stockQty: r.querySelector('.stock-qty-input').value,
          stockUnit: r.querySelector('.stock-unit-input').value,
          planQty: r.querySelector('.plan-qty-input').value,
          planUnit: r.querySelector('.plan-unit-input').value,
          status: r.querySelector('.stock-status-cell').textContent.trim()
        }));
        showToast('Stok Excel hazırlanıyor...', 'info', 2000);
        const { downloadStockReportExcel } = await import('../../reports/excelExport.js');
        await downloadStockReportExcel(data);
        showToast('Stok Excel indirildi', 'success');
      } catch (err) {
        console.error('Stok Excel hatası:', err);
        showToast('Excel hatası: ' + err.message, 'error');
      }
    });
  }
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

