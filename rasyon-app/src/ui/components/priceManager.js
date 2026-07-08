/**
 * Yem Fiyat Yöneticisi — FAZ 7B
 *
 * Tüm 201 yemi gösterir, kullanıcı fiyat girebilir (TL/ton yaş ağırlık),
 * toplu kayıt IndexedDB'ye yazılır → economics hesapları anında güncel olur.
 *
 * Türkiye 2026 referans fiyatları bir preset olarak sunulur.
 */

import { getAllFeeds, updateFeed, feedMatchesQuery } from '../../data/feedService.js';
import { FEED_CATEGORIES, CATEGORY_LABELS_TR } from '../../data/feedService.js';
import { TR_REGIONS, TR_REGION_IDS, adjustPriceForRegion, regionFlagshipFeeds } from '../../data/regionTemplates.js';
import { priceHistorySnapshot, priceHistoryGetByFeed, priceHistoryDeleteByFeed } from '../../data/db.js';
import { showToast, escHtml, fmt } from '../utils.js';
import { t } from '../i18n.js';

const catLabel = (cat) => { const k = `categories.${cat}`; const v = t(k); return v === k ? (CATEGORY_LABELS_TR[cat] || cat) : v; };

// ─── Türkiye 2026 referans fiyatları (TL/ton yaş ağırlık, Mayıs 2026) ───────
// Pazar koşullarına göre güncellenmeli; kullanıcı her zaman değiştirebilir.
// ID'ler feedLibrary.json / feedLibraryExt.json / feedLibraryExt2.json ile eşleştirildi.
const TR_REF_PRICES = {
  // ── Kaba yemler ────────────────────────────────────────────────────────────
  tr_corn_silage_early:          1100,
  tr_corn_silage_mid:            1200,
  tr_corn_silage_late:           1300,
  nrc_corn_silage_std:           1200,
  tr_sorghum_silage:             1050,
  tr_grain_sorghum_silage:       1000,
  tr_sweet_corn_silage:          1150,
  nrc_alfalfa_hay_1cut:          7000,
  nrc_alfalfa_hay_2cut:          6500,
  nrc_alfalfa_hay_3cut:          6000,
  tr_alfalfa_silage:             2000,
  tr_alfalfa_silage_wilted:      2200,
  tr_alfalfa_haylage:            2500,
  tr_alfalfa_meal_dehydrated:   14000,
  tr_fresh_alfalfa:              2500,
  nrc_grass_hay:                 4500,
  tr_grass_silage:               1200,
  tr_wheat_straw:                2000,
  tr_barley_straw:               1800,
  tr_rye_straw:                  1700,
  tr_oat_straw:                  1800,
  tr_corn_stover:                1200,
  tr_cotton_stalks:               800,
  tr_triticale_silage:           1000,
  tr_sunflower_silage:            900,
  tr_pea_silage:                 1100,
  tr_vetch_silage:               1000,
  tr_vetch_hay:                  4500,
  tr_lupin_silage:               1100,
  tr_clover_silage:              1100,
  tr_beet_tops_silage:            900,
  tr_sugar_beet_pulp_silage:     1200,
  tr_sudan_grass_hay:            4000,
  tr_sudan_grass_silage:         1100,
  tr_italian_ryegrass_hay:       5000,
  tr_italian_ryegrass_silage:    1200,
  tr_perennial_ryegrass:         4500,
  tr_orchardgrass_hay:           4500,
  tr_sainfoin_hay:               5500,
  tr_mungbean_hay:               5000,
  tr_mixed_legume_grass_hay:     4500,
  tr_red_clover_hay:             5000,
  tr_oat_silage:                 1100,
  tr_oat_hay:                    4500,
  tr_barley_silage_whole:        1000,
  tr_rye_silage:                 1000,
  tr_whole_crop_wheat_silage:    1000,
  nrc_bermuda_grass_hay:         4000,
  nrc_timothy_hay:               5000,
  tr_brassica_forage:            1200,
  tr_chickpea_straw:             1800,
  tr_tef_hay:                    4000,
  tr_corn_ccm:                   2000,
  tr_corn_grain_high_moisture:   7000,

  // ── Tahıllar ────────────────────────────────────────────────────────────────
  nrc_corn_grain_coarse:         9000,
  nrc_corn_grain_fine:           9200,
  tr_ground_corn_grain:          9200,
  nrc_steam_flaked_corn:         9500,
  nrc_high_moisture_corn:        7000,
  tr_wheat_grain_red:            9000,
  nrc_wheat_grain:               9000,
  tr_barley_grain:               8500,
  nrc_oat_grain:                 8000,
  nrc_grain_sorghum:             8500,
  tr_rice_grain:                 7500,
  tr_sweet_potato_dried:        10000,
  tr_chestnut_dried:             6000,
  tr_acorn:                      3500,

  // ── Protein kaynakları ──────────────────────────────────────────────────────
  nrc_soybean_meal_48:          24000,
  nrc_soybean_meal_44:          22000,
  nrc_whole_soybean:            26000,
  tr_extruded_soy:              28000,
  tr_cottonseed_meal:           14000,
  tr_cottonseed_meal_pressed:   13000,
  tr_whole_cottonseed:          14000,
  tr_sunflower_meal:            11000,
  nrc_canola_meal:              14000,
  tr_canola_meal:               14000,
  tr_canola_full_fat_roasted:   18000,
  tr_linseed_meal:              15000,
  tr_whole_flaxseed:            20000,
  tr_sesame_meal:               16000,
  tr_lupin_meal:                14000,
  tr_faba_bean:                 16000,
  nrc_corn_gluten_meal_60:      30000,
  nrc_corn_gluten_feed:         10000,
  nrc_fish_meal:                50000,
  nrc_meat_bone_meal:           20000,
  nrc_blood_meal:               35000,
  nrc_feather_meal:             25000,
  nrc_peas_whole:               18000,
  tr_safflower_meal:             9000,
  tr_safflower_seed:            12000,
  tr_peanut_meal:               18000,
  tr_corn_germ_meal:            10000,
  tr_meat_meal:                 20000,
  tr_brewers_yeast:             20000,
  tr_dairy_concentrate_18:      18000,
  tr_dairy_concentrate_22:      22000,
  tr_protein_concentrate_mix:   25000,
  tr_hazelnut_meal:             10000,
  tr_walnut_meal:               12000,
  tr_palm_kernel_meal:           8000,
  tr_copra_meal:                 9000,

  // ── Yan ürünler ─────────────────────────────────────────────────────────────
  tr_wheat_bran:                 7000,
  tr_barley_bran:                6500,
  tr_oat_bran:                   7000,
  tr_rice_bran:                  7000,
  tr_rice_bran_defatted:         8000,
  nrc_wheat_middlings:           7500,
  tr_distillers_dried_grains_wheat: 10000,
  nrc_corn_ddgs:                12000,
  tr_wheat_ddgs:                10000,
  tr_hominy_feed:                8000,
  nrc_soybean_hulls:             7000,
  tr_cottonseed_hulls:           4000,
  tr_sunflower_hulls:            3000,
  tr_pistachio_hulls:            2000,
  tr_almond_hulls:               3500,
  nrc_citrus_pulp_dried:        12000,
  tr_lemon_pulp_dried:          10000,
  nrc_beet_pulp_dried:          12000,
  nrc_beet_pulp_wet:             1500,
  tr_molasses_beet:              6000,
  nrc_brewers_grains_wet:        2500,
  tr_dried_brewers_grains:      10000,
  tr_grape_pomace:               5000,
  tr_winery_pomace:              4000,
  tr_tomato_pomace:              5000,
  tr_apple_pomace_dry:           4500,
  tr_dried_apple_pomace:         4500,
  tr_olive_leaves:               3000,
  tr_olive_kernel_meal:          4000,
  tr_olive_pomace:               3000,
  tr_pumpkin_pulp:               5000,
  tr_carob_pods:                 8000,
  tr_carob_meal:                 8000,
  tr_dried_whey:                18000,
  tr_liquid_whey:                1500,
  tr_potato_pulp_wet:            1200,
  tr_potato_pulp_dried:         10000,
  tr_starch_residue:             5000,
  tr_mushroom_substrate:         3000,
  tr_carrot_pulp:                4000,

  // ── Yağ kaynakları ──────────────────────────────────────────────────────────
  nrc_calcium_soap_fat:         45000,
  nrc_prilled_fat:              45000,
  nrc_tallow:                   28000,
  nrc_soybean_oil:              40000,
  tr_sunflower_oil:             38000,
  tr_corn_oil:                  40000,
  tr_palm_oil:                  36000,
  tr_cottonseed_oil:            38000,
  tr_fish_oil:                  60000,
  tr_linseed_oil:               45000,
  tr_olive_oil_waste:           20000,

  // ── Mineraller ve katkılar ──────────────────────────────────────────────────
  min_limestone:                 1000,
  min_dicalcium_phosphate:      18000,
  min_monocalcium_phosphate:    20000,
  min_sodium_bicarbonate:        8000,
  min_salt_nacl:                 2500,
  min_magnesium_oxide:          25000,
  min_magnesium_carbonate:      12000,
  min_potassium_chloride:       16000,
  min_sodium_sulfate:           10000,
  min_magnesium_sulfate:        12000,
  min_ammonium_chloride:        10000,
  min_calcium_chloride:          8000,
  min_calcium_sulfate:           5000,
  min_yeast_culture:            30000,
  min_calcium_propionate:       50000,
  min_urea:                     18000,
  min_niacin:                  100000,
  min_choline_chloride:         40000,
  min_organic_zinc:            120000,
  min_organic_selenium:        200000,
  min_mannan_oligo:            100000,
  min_biotin:                  300000,
  min_humic_acid:               30000,
  min_clinoptilolite:            5000,
};

let _allFeeds = null;
let _pendingChanges = {};  // feedId → pricePerTon
let _filterCat = '';
let _filterSearch = '';

export async function renderPriceManager(container, state = null) {
  _state = state;   // FAZ 15.7: flagship yem önerisini Rasyon Kurucu'ya eklemek için
  container.innerHTML = `
    <!-- 📖 Sekme Yardımı -->
    <details class="tab-help-accordion" style="margin-bottom:0.75rem">
      <summary style="cursor:pointer; font-weight:600; color:var(--primary); display:flex; align-items:center; gap:0.4rem">
        <i class="ti ti-info-circle"></i> Bu sekme ne işe yarar? <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted); margin-left:auto">▾</span>
      </summary>
      <div class="info-box" style="margin-top:0.5rem; font-size:0.85rem; line-height:1.7">
        <b>💰 Fiyat Yöneticisi</b> — Sistemdeki tüm yemlerin güncel piyasa fiyatlarını (TL/ton, yaş ağırlık) buradan tanımlayın.<br>
        • <b>Fiyat Girme:</b> Sağdaki kutulara fiyat yazıp "Kaydet"e basarak rasyon maliyetlerini anında güncelleyebilirsiniz.<br>
        • <b>Bölge ve Referans Fiyatlar:</b> Bölgenizi seçerek o bölgenin ortalama fiyat çarpanını uygulayabilir veya "TR Referans Yükle" ile hazır piyasa ortalamalarını getirebilirsiniz.<br>
        • <b>Öne Çıkan Yemler:</b> Bölgenize has, sık kullanılan uygun fiyatlı yemleri doğrudan rasyonunuza ekleme kısayolları mevcuttur.<br>
        • <b>Geçmiş (Snapshot):</b> Ayda bir "Şu anki fiyatları kaydet" (Snapshot) butonuna basarak fiyat değişim trendini (enflasyon vs.) takip edebilirsiniz.
      </div>
    </details>

    <div class="card">
      <div class="card-title">${t('pm.title')}</div>
      <p class="text-muted" style="margin:0 0 12px">
        ${t('pm.intro')}
      </p>

      <div class="flex-between mb-2" style="flex-wrap:wrap;gap:8px">
        <div class="flex gap-1" style="flex-wrap:wrap">
          <input id="pm-search" type="search" class="search-input"
            placeholder="${t('pm.search_ph')}" style="min-width:180px" />
          <select id="pm-cat" class="btn btn-secondary btn-sm" style="padding:4px 8px">
            <option value="">${t('pm.all_cats')}</option>
            ${FEED_CATEGORIES.map(c => `<option value="${c}">${catLabel(c)}</option>`).join('')}
          </select>
        </div>
        <div class="flex gap-1" style="flex-wrap:wrap">
          <select id="pm-region" class="btn btn-secondary btn-sm" style="padding:4px 8px" title="${t('pm.region_title')}">
            <option value="">${t('pm.region_general')}</option>
            ${TR_REGION_IDS.map(rid => `<option value="${rid}">${TR_REGIONS[rid].name}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" id="btn-preset" title="${t('pm.tr_ref_title')}">
            ${t('pm.tr_ref')}
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-snapshot" title="${t('pm.snapshot_title')}">
            ${t('pm.snapshot')}
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-export-prices" title="Excel fiyat şablonu indir">
            <i class="ti ti-file-export"></i> Şablon
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-import-prices" title="Excel'den fiyatları yükle">
            <i class="ti ti-file-import"></i> Yükle
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-clear-prices">
            ${t('pm.reset')}
          </button>
          <button class="btn btn-primary btn-sm" id="btn-save-prices">
            ${t('pm.save')}
          </button>
        </div>
      </div>

      <div id="pm-pending-notice" class="info-box box-warn" style="display:none">
        ${t('pm.pending')}
      </div>

      <div id="pm-region-info" class="info-box box-info" style="display:none"></div>

      <div id="pm-table-wrap">
        <div class="empty-state"><div class="icon"><i class="ti ti-loader-2 ti-spin"></i></div><p>${t('pm.loading')}</p></div>
      </div>

      <div class="flex-between mt-2" style="font-size:13px;color:var(--text-muted)">
        <span id="pm-count"></span>
        <span id="pm-total-value"></span>
      </div>
    </div>

    <!-- FAZ 11A: Geçmiş modal (yem-bazlı fiyat geçmişi) -->
    <div id="pm-history-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
      <div class="card" style="max-width:700px;max-height:80vh;overflow:auto;margin:1rem">
        <div class="flex-between">
          <div class="card-title" style="margin:0"><i class="ti ti-chart-bar"></i> <span id="pm-history-feedname"></span> — ${t('pm.history_title')}</div>
          <button class="btn btn-sm btn-secondary" id="btn-close-history">${t('pm.close')}</button>
        </div>
        <div id="pm-history-content" style="margin-top:1rem"></div>
      </div>
    </div>
  `;

  _pendingChanges = {};
  _filterCat = '';
  _filterSearch = '';

  try {
    _allFeeds = await getAllFeeds();
  } catch (err) {
    container.querySelector('#pm-table-wrap').innerHTML =
      `<div class="empty-state"><div class="icon"><i class="ti ti-alert-circle"></i></div><p>${t('pm.load_err')}${escHtml(err.message)}</p></div>`;
    return;
  }

  renderTable(container);

  // Input delegation — tek seferlik, renderTable çağrılarında birikmez
  container.querySelector('#pm-table-wrap').addEventListener('input', (e) => {
    if (!e.target.classList.contains('price-input')) return;
    const id = e.target.dataset.id;
    const val = parseFloat(e.target.value) || 0;
    _pendingChanges[id] = val;
    e.target.style.borderColor = '#f9a825';
    e.target.closest('tr').style.background = '#fffde7';
    container.querySelector('#pm-pending-notice').style.display = 'block';
    updateTotalValue(container);
  });

  container.querySelector('#pm-search').addEventListener('input', (e) => {
    _filterSearch = e.target.value;   // FAZ 15.10: ham değer; feedMatchesQuery normalize eder
    renderTable(container);
  });
  container.querySelector('#pm-cat').addEventListener('change', (e) => {
    _filterCat = e.target.value;
    renderTable(container);
  });

  container.querySelector('#btn-preset').addEventListener('click', () => {
    applyPreset(container);
  });
  container.querySelector('#btn-clear-prices').addEventListener('click', () => {
    clearAllPrices(container);
  });
  container.querySelector('#btn-save-prices').addEventListener('click', async () => {
    await savePrices(container);
  });
  container.querySelector('#btn-export-prices').addEventListener('click', () => {
    exportPriceTemplate();
  });
  container.querySelector('#btn-import-prices').addEventListener('click', () => {
    importPricesExcel(container);
  });

  // FAZ 11A: Bölge seçimi → preset uygula + info banner
  container.querySelector('#pm-region').addEventListener('change', (e) => {
    _selectedRegion = e.target.value || '';
    updateRegionInfo(container);
    if (_selectedRegion) {
      applyPreset(container);  // Bölge çarpanı otomatik dahil
    }
  });

  // FAZ 11A: Snapshot — şu anki fiyatları geçmişe kaydet
  container.querySelector('#btn-snapshot').addEventListener('click', async () => {
    await takeSnapshot(container);
  });

  // FAZ 11A: Tablo içinden "Geçmiş" linkine tıklayınca modal aç
  container.querySelector('#pm-table-wrap').addEventListener('click', async (e) => {
    if (!e.target.classList.contains('pm-history-link')) return;
    await openHistoryModal(container, e.target.dataset.id, e.target.dataset.name);
  });

  container.querySelector('#btn-close-history').addEventListener('click', () => {
    container.querySelector('#pm-history-modal').style.display = 'none';
  });

  updateRegionInfo(container);
}

// ─── FAZ 11A: Bölge bilgi bandı ─────────────────────────────────────────────
let _selectedRegion = '';
let _state = null;   // FAZ 15.7: Rasyon Kurucu'ya yem eklemek için global state

function updateRegionInfo(container) {
  const info = container.querySelector('#pm-region-info');
  if (!info) return;
  if (!_selectedRegion || !TR_REGIONS[_selectedRegion]) {
    info.style.display = 'none';
    return;
  }
  const r = TR_REGIONS[_selectedRegion];
  info.style.display = 'block';

  // FAZ 15.7: bölgenin öne çıkan (flagship) yemleri — bir tıkla Rasyon Kurucu'ya eklenir
  const flagshipFeeds = regionFlagshipFeeds(_selectedRegion)
    .map(id => _allFeeds.find(f => f.id === id))
    .filter(Boolean);

  info.innerHTML = `
    <b><i class="ti ti-map-pin"></i> ${escHtml(r.name)}</b> — ${escHtml(r.description)}<br>
    <span class="text-small">${t('pm.price_mult')}${r.priceMultiplier.toFixed(2)} ·
    ${escHtml(r.notes)}</span>
    ${flagshipFeeds.length ? `
      <div class="pm-flagship">
        <div class="pm-flagship-title">${t('pm.flagship_title')}${_state ? t('pm.flagship_add_hint') : ''}:</div>
        <div class="pm-flagship-list">
          ${flagshipFeeds.map(f => `
            <button class="pm-flagship-item ${_state ? '' : 'pm-flagship-static'}" data-feed-id="${escHtml(f.id)}"
              title="${escHtml(catLabel(f.category))}">
              <span class="pm-flagship-name">${escHtml(f.name)}</span>
              ${_state ? '<span class="pm-flagship-add"><i class="ti ti-plus"></i></span>' : ''}
            </button>`).join('')}
        </div>
      </div>` : ''}
  `;

  // FAZ 15.7: flagship yem → Rasyon Kurucu seçimine ekle
  if (_state) {
    info.querySelectorAll('.pm-flagship-item').forEach(btn => {
      btn.addEventListener('click', () => addFlagshipFeed(btn.dataset.feedId));
    });
  }
}

/** FAZ 15.7: bölge flagship yemini state.selectedFeeds'e ekler (Rasyon Kurucu). */
function addFlagshipFeed(feedId) {
  if (!_state) return;
  if (!Array.isArray(_state.selectedFeeds)) _state.selectedFeeds = [];
  const feed = _allFeeds.find(f => f.id === feedId);
  if (!feed) { showToast(t('pm.feed_not_found'), 'error'); return; }
  if (_state.selectedFeeds.some(sf => sf.id === feedId)) {
    showToast(t('pm.already_selected', { name: feed.name }), 'info');
    return;
  }
  _state.selectedFeeds.push({
    id: feed.id, name: feed.name, category: feed.category, minKg: null, maxKg: null,
  });
  showToast(t('pm.added_to_builder', { name: feed.name }), 'success');
}

// ─── FAZ 11A: Snapshot — geçerli fiyat seti tarihli kayıt ─────────────────
async function takeSnapshot(container) {
  // Önce kaydedilmemiş değişiklikler varsa uyar
  if (Object.keys(_pendingChanges).length > 0) {
    if (!confirm(t('pm.snap_confirm'))) return;
  }
  const note = prompt(t('pm.snap_note_prompt'), '') ?? '';
  try {
    const feedsWithPrice = _allFeeds.filter(f => Number(f.pricePerTon) > 0);
    if (feedsWithPrice.length === 0) {
      showToast(t('pm.snap_need_price'), 'error');
      return;
    }
    await priceHistorySnapshot(feedsWithPrice, _selectedRegion, note);
    showToast(t('pm.snap_done', { n: feedsWithPrice.length }), 'success');
  } catch (err) {
    console.error(err);
    showToast(t('pm.snap_err') + err.message, 'error');
  }
}

// ─── FAZ 11A: Geçmiş modal — yem-bazlı fiyat trendi ──────────────────────
async function openHistoryModal(container, feedId, feedName) {
  const modal = container.querySelector('#pm-history-modal');
  const titleEl = container.querySelector('#pm-history-feedname');
  const content = container.querySelector('#pm-history-content');
  if (!modal || !content) return;

  titleEl.textContent = feedName || feedId;
  modal.style.display = 'flex';
  content.innerHTML = `<p class="text-muted">${t('pm.loading')}</p>`;

  try {
    const history = await priceHistoryGetByFeed(feedId);
    if (history.length === 0) {
      content.innerHTML = `
        <div class="empty-state" style="padding:1.5rem">
          <p>${t('pm.hist_empty')}</p>
          <p class="text-small">${t('pm.hist_empty_hint')}</p>
        </div>`;
      return;
    }

    // Trend istatistikleri
    const prices = history.map(h => h.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    const first = prices[0];
    const last = prices[prices.length - 1];
    const change = last - first;
    const changePct = first > 0 ? (change / first * 100) : 0;

    content.innerHTML = `
      <div class="summary-bar" style="grid-template-columns: repeat(4, 1fr); gap: 0.5rem">
        <div class="summary-card"><div class="val">${min.toLocaleString()}</div><div class="lbl">${t('pm.h_min')}</div></div>
        <div class="summary-card"><div class="val">${Math.round(avg).toLocaleString()}</div><div class="lbl">${t('pm.h_avg')}</div></div>
        <div class="summary-card"><div class="val">${max.toLocaleString()}</div><div class="lbl">${t('pm.h_max')}</div></div>
        <div class="summary-card" style="background:${change >= 0 ? 'var(--above-bg)' : 'var(--primary-light)'}">
          <div class="val" style="color:${change >= 0 ? 'var(--danger)' : 'var(--primary)'}">
            ${change > 0 ? '+' : ''}${changePct.toFixed(1)}%
          </div>
          <div class="lbl">${t('pm.h_firstlast')}</div>
        </div>
      </div>

      <table class="diag-table" style="margin-top:1rem">
        <thead>
          <tr><th>${t('pm.h_col_date')}</th><th class="num">${t('pm.h_col_price')}</th><th>${t('pm.h_col_region')}</th><th>${t('pm.h_col_note')}</th></tr>
        </thead>
        <tbody>
          ${history.map(h => `<tr>
            <td>${new Date(h.date).toLocaleDateString()}</td>
            <td class="num">${h.price.toLocaleString()}</td>
            <td>${TR_REGIONS[h.region]?.name || '—'}</td>
            <td class="text-muted">${escHtml(h.note || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="flex gap-1 mt-1">
        <button class="btn btn-sm btn-danger" id="btn-clear-history">${t('pm.clear_history')}</button>
      </div>
      <p class="text-small text-muted mt-1">
        ${t('pm.records_note', { n: history.length })}
      </p>
    `;

    content.querySelector('#btn-clear-history')?.addEventListener('click', async () => {
      if (!confirm(t('pm.confirm_clear_hist', { name: feedName }))) return;
      await priceHistoryDeleteByFeed(feedId);
      showToast(t('pm.history_cleared'), 'success');
      modal.style.display = 'none';
    });
  } catch (err) {
    content.innerHTML = `<div class="warn-box">${t('pm.load_err')}${escHtml(err.message)}</div>`;
  }
}

// ─── Excel Export/Import ─────────────────────────────────────────────────────

async function exportPriceTemplate() {
  try {
    const XLSX = await import('xlsx-js-style');
    const data = _allFeeds.map(f => ({
      'ID': f.id,
      'Yem Adı': f.name,
      'Kategori': catLabel(f.category),
      'Fiyat (₺/ton)': f.pricePerTon || 0
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    
    // Sütun genişlikleri
    ws['!cols'] = [{wch: 22}, {wch: 45}, {wch: 25}, {wch: 18}];
    
    // Tam Sabitleme (1. satır sabit) - Hata vermeyen format
    ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' }];
    
    const range = XLSX.utils.decode_range(ws['!ref']);
    
    // Tasarım ve Renklendirme Döngüsü
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({c: C, r: R});
        const cell = ws[cellAddress];
        if (!cell) continue;
        
        const borderStyle = {
          top: { style: "thin", color: { rgb: "BFBFBF" } },
          bottom: { style: "thin", color: { rgb: "BFBFBF" } },
          left: { style: "thin", color: { rgb: "BFBFBF" } },
          right: { style: "thin", color: { rgb: "BFBFBF" } }
        };

        if (R === 0) {
          // Tablo Başlıkları
          cell.s = {
            fill: { fgColor: { rgb: "4F81BD" } },
            font: { bold: true, color: { rgb: "FFFFFF" } },
            alignment: { horizontal: "center", vertical: "center" },
            border: { bottom: { style: "medium", color: { rgb: "000000" } }, ...borderStyle }
          };
        } else {
          // Veri Satırları (Zebra deseni)
          const isEven = (R % 2 === 0);
          cell.s = {
            fill: { fgColor: { rgb: isEven ? "F2F2F2" : "FFFFFF" } },
            font: { color: { rgb: "000000" } },
            border: borderStyle,
            alignment: { vertical: "center" }
          };
          
          if (C === 3 && cell.t === 'n') {
            cell.z = '#,##0.00_"₺"';
          }
        }
      }
    }

    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fiyatlar");
    XLSX.writeFile(wb, "yem_fiyat_sablonu.xlsx");
    showToast('Şablon indirildi. Fiyatları düzenleyip geri yükleyebilirsiniz.', 'info');
  } catch (err) {
    showToast('Dışa aktarma hatası: ' + err.message, 'error');
  }
}

async function importPricesExcel(container) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx, .xls, .csv';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const XLSX = await import('xlsx-js-style');
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws);
          
          let updatedCount = 0;
          rows.forEach(row => {
            const id = row['ID'] || row['id'];
            const price = parseFloat(row['Fiyat (₺/ton)'] || row['Fiyat'] || row['price'] || row['Price']);
            
            if (id && !isNaN(price)) {
              // Yem listede var mı kontrolü
              const feedExists = _allFeeds.some(f => f.id === id);
              if (feedExists) {
                _pendingChanges[id] = price;
                updatedCount++;
              }
            }
          });
          
          if (updatedCount > 0) {
            showToast(`${updatedCount} yemin fiyatı içeri aktarıldı. Kaydetmeyi unutmayın!`, 'success');
            container.querySelector('#pm-pending-notice').style.display = 'block';
            renderTable(container);
            updateTotalValue(container);
          } else {
            showToast('Geçerli fiyat veya eşleşen ID bulunamadı.', 'warn');
          }
        } catch (err) {
          showToast('Dosya okunurken hata oluştu: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      showToast('İçe aktarma başlatılamadı: ' + err.message, 'error');
    }
  };
  input.click();
}

function renderTable(container) {
  const feeds = _allFeeds.filter(f => {
    if (_filterCat && f.category !== _filterCat) return false;
    // FAZ 15.10: Türkçe-toleranslı + typo toleranslı fuzzy arama (diğer arama yerleriyle tutarlı)
    if (_filterSearch && !feedMatchesQuery(f, _filterSearch)) return false;
    return true;
  });

  const wrap = container.querySelector('#pm-table-wrap');
  if (feeds.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="ti ti-search"></i></div><p>${t('pm.no_match')}</p></div>`;
    container.querySelector('#pm-count').textContent = t('pm.n_feeds', { n: 0 });
    return;
  }

  // Kategoriye göre grupla
  const groups = {};
  for (const f of feeds) {
    (groups[f.category] = groups[f.category] || []).push(f);
  }

  let html = `
    <div style="overflow-x:auto">
    <table class="data-table" style="width:100%">
      <thead>
        <tr>
          <th style="text-align:left;min-width:200px">${t('pm.col_name')}</th>
          <th style="text-align:left;width:100px">${t('pm.col_cat')}</th>
          <th style="text-align:right;width:60px">${t('pm.col_dm')}</th>
          <th style="text-align:right;width:80px">${t('pm.col_nel')}</th>
          <th style="text-align:right;width:80px">${t('pm.col_cp')}</th>
          <th style="text-align:right;width:140px">${t('pm.col_price')}</th>
          <th style="text-align:center;width:80px">${t('pm.col_history')}</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const cat of FEED_CATEGORIES) {
    const list = groups[cat];
    if (!list) continue;
    html += `
      <tr style="background:var(--primary-light)">
        <td colspan="7" style="font-weight:700;padding:6px 8px;font-size:13px;color:var(--primary)">
          ${escHtml(catLabel(cat))} (${list.length})
        </td>
      </tr>
    `;
    for (const f of list) {
      const currentPrice = _pendingChanges[f.id] !== undefined
        ? _pendingChanges[f.id]
        : (f.pricePerTon || 0);
      const hasPending = _pendingChanges[f.id] !== undefined;
      html += `
        <tr data-feed-id="${escHtml(f.id)}" ${hasPending ? 'style="background:var(--below-bg)"' : ''}>
          <td>
            <div style="font-weight:500">${escHtml(f.name)}</div>
            ${f.nameEn ? `<div style="font-size:11px;color:var(--text-light)">${escHtml(f.nameEn)}</div>` : ''}
          </td>
          <td style="font-size:12px;color:var(--text-muted)">${escHtml(catLabel(f.category))}</td>
          <td style="text-align:right">${fmt(f.dm, 0)}%</td>
          <td style="text-align:right">${fmt(f.nel, 2)}</td>
          <td style="text-align:right">${fmt(f.cp, 1)}%</td>
          <td>
            <div class="flex" style="justify-content:flex-end;align-items:center;gap:4px">
              <input type="number" class="price-input" data-id="${escHtml(f.id)}"
                value="${currentPrice}"
                min="0" max="999999" step="100"
                style="width:90px;text-align:right;padding:3px 6px;border:1px solid ${hasPending ? '#f9a825' : '#ddd'};border-radius:4px;font-size:13px"
              />
              <span style="font-size:12px;color:var(--text-muted)">₺</span>
            </div>
          </td>
          <td style="text-align:center">
            <a href="#" class="pm-history-link" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}"
               style="color:var(--primary,#2d5f4a);text-decoration:underline;font-size:12px"
               title="${t('pm.view_title')}">${t('pm.view')}</a>
          </td>
        </tr>
      `;
    }
  }

  html += `</tbody></table></div>`;
  wrap.innerHTML = html;

  container.querySelector('#pm-count').textContent = t('pm.n_shown', { n: feeds.length });
  updateTotalValue(container);
}

function updateTotalValue(container) {
  if (!_allFeeds) return;
  const totalWithPrices = _allFeeds.filter(f => {
    const p = _pendingChanges[f.id] !== undefined ? _pendingChanges[f.id] : f.pricePerTon;
    return p > 0;
  }).length;
  container.querySelector('#pm-total-value').textContent =
    t('pm.n_defined', { defined: totalWithPrices, total: _allFeeds.length });
}

function applyPreset(container) {
  if (!_allFeeds) return;
  let applied = 0;
  for (const f of _allFeeds) {
    const base = TR_REF_PRICES[f.id];
    if (!base) continue;
    // FAZ 11A: bölge seçiliyse fiyatı çarpana göre ayarla
    _pendingChanges[f.id] = _selectedRegion
      ? adjustPriceForRegion(base, _selectedRegion, f.category)
      : base;
    applied++;
  }
  const regionTxt = _selectedRegion
    ? t('pm.region_mult_incl', { name: TR_REGIONS[_selectedRegion]?.name })
    : '';
  showToast(t('pm.preset_applied', { n: applied, region: regionTxt }), 'info');
  renderTable(container);
  container.querySelector('#pm-pending-notice').style.display = 'block';
}

function clearAllPrices(container) {
  if (!_allFeeds) return;
  for (const f of _allFeeds) {
    _pendingChanges[f.id] = 0;
  }
  showToast(t('pm.all_reset'), 'info');
  renderTable(container);
  container.querySelector('#pm-pending-notice').style.display = 'block';
}

async function savePrices(container) {
  const ids = Object.keys(_pendingChanges);
  if (ids.length === 0) {
    showToast(t('pm.no_changes'), 'info');
    return;
  }

  const btn = container.querySelector('#btn-save-prices');
  btn.disabled = true;
  btn.textContent = t('pm.saving');

  try {
    let saved = 0;
    for (const id of ids) {
      const feed = _allFeeds.find(f => f.id === id);
      if (!feed) continue;
      await updateFeed(id, { pricePerTon: _pendingChanges[id] });
      feed.pricePerTon = _pendingChanges[id];
      saved++;
    }
    _pendingChanges = {};
    container.querySelector('#pm-pending-notice').style.display = 'none';
    showToast(t('pm.n_saved', { n: saved }), 'success');
    renderTable(container);
  } catch (err) {
    showToast(t('pm.save_err') + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('pm.save');
  }
}
