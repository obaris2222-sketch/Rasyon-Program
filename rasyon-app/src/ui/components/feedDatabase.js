/**
 * Yem Veritabanı Görünümü
 */

import { queryFeeds, FEED_CATEGORIES, CATEGORY_LABELS_TR, getFeedById } from '../../data/feedService.js';
import { showToast, escHtml, fmt } from '../utils.js';
import { openFeedDetail, openFeedEditor, confirmDeleteFeed, isUserFeed } from './feedEditor.js';
import { openFeedImportModal } from './feedImportModal.js';
import { t } from '../i18n.js';

/** Yem kategorisi etiketi (dil-duyarlı; bilinmeyen → feedService TR fallback). */
function catLabel(cat) {
  const v = t(`categories.${cat}`);
  return v === `categories.${cat}` ? (CATEGORY_LABELS_TR[cat] ?? cat) : v;
}

const NUTRIENT_COLS = [
  { key: 'nel',    label: 'NEL',    unit: 'Mcal/kg' },
  { key: 'cp',     label: 'HP',     unit: '%KM' },
  { key: 'ndf',    label: 'NDF',    unit: '%KM' },
  { key: 'adf',    label: 'ADF',    unit: '%KM' },
  { key: 'nfc',    label: 'NFC',    unit: '%KM' },
  { key: 'fat',    label: 'Yağ',    unit: '%KM' },
  { key: 'ca',     label: 'Ca',     unit: '%KM' },
  { key: 'p',      label: 'P',      unit: '%KM' },
];
/** Besin sütun başlığı (dil-duyarlı: HP→CP, Yağ→Fat; diğerleri evrensel). */
function colLabel(c) {
  if (c.key === 'cp')  return t('feeds.nut_cp');
  if (c.key === 'fat') return t('feeds.nut_fat');
  return c.label;
}
function colUnit(c) {
  return c.key === 'nel' ? c.unit : t('feeds.nut_unit');
}

let _currentCategory = '';
let _searchDebounce = null;

export async function renderFeedDatabase(container, state) {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">${t('feeds.title')}</div>

      <div class="feed-controls">
        <input class="search-input" id="feed-search" type="search"
          placeholder="${t('feeds.search_ph')}" autocomplete="off" />
        <div class="category-tabs">
          <button class="cat-btn active" data-cat="">${t('feeds.all')}</button>
          ${FEED_CATEGORIES.map(c => `
            <button class="cat-btn" data-cat="${c}">${catLabel(c)}</button>
          `).join('')}
        </div>
      </div>

      <div id="feed-table-container">
        <div class="empty-state"><div class="icon"><i class="ti ti-loader-2 ti-spin"></i></div><p>${t('feeds.loading')}</p></div>
      </div>

      <div class="flex-between mt-2">
        <span class="text-muted" id="feed-count"></span>
        <div class="flex gap-1">
          <button class="btn btn-primary btn-sm" id="new-feed-btn">${t('feeds.new_feed')}</button>
          <button class="btn btn-secondary btn-sm" id="import-feed-btn">${t('feeds.import')}</button>
          <button class="btn btn-secondary btn-sm" id="select-all-visible">${t('feeds.add_all')}</button>
        </div>
      </div>
    </div>
  `;

  const searchEl = container.querySelector('#feed-search');
  const catBtns  = container.querySelectorAll('.cat-btn');

  catBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      catBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _currentCategory = btn.dataset.cat;
      loadFeeds(container, state);
    });
  });

  searchEl.addEventListener('input', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => loadFeeds(container, state), 250);
  });

  // FAZ 12 Madde 9: Yeni Yem
  container.querySelector('#new-feed-btn').addEventListener('click', () => {
    openFeedEditor(null, 'new', async () => {
      await loadFeeds(container, state);
    });
  });

  // FAZ 16.7: CSV/Excel toplu içe aktarma
  container.querySelector('#import-feed-btn').addEventListener('click', () => {
    openFeedImportModal(async (imported) => {
      if (imported > 0) await loadFeeds(container, state);
    });
  });

  container.querySelector('#select-all-visible').addEventListener('click', () => {
    const visibleIds = [...container.querySelectorAll('.add-feed-btn')].map(b => b.dataset.id);
    let added = 0;
    visibleIds.forEach(id => {
      if (!state.selectedFeeds.find(f => f.id === id)) {
        const row = container.querySelector(`[data-row-id="${id}"]`);
        if (row) {
          const name = row.dataset.name;
          const cat  = row.dataset.cat;
          state.selectedFeeds.push({ id, name, category: cat, minKg: null, maxKg: null });
          added++;
        }
      }
    });
    showToast(t('feeds.added_n', { n: added }), 'success');
    loadFeeds(container, state);
  });

  await loadFeeds(container, state);
}

async function loadFeeds(container, state) {
  const searchEl = container.querySelector('#feed-search');
  const query = searchEl?.value ?? '';

  try {
    const feeds = await queryFeeds({
      query,
      category: _currentCategory,
      sortBy: 'name',
    });

    const tableContainer = container.querySelector('#feed-table-container');
    const countEl = container.querySelector('#feed-count');

    if (countEl) countEl.textContent = t('feeds.count_n', { n: feeds.length });

    if (feeds.length === 0) {
      tableContainer.innerHTML = `
        <div class="empty-state">
          <div class="icon"><i class="ti ti-leaf"></i></div>
          <p>${t('feeds.no_results')}</p>
        </div>`;
      return;
    }

    tableContainer.innerHTML = `
      <div class="feed-table-wrap">
        <table class="feed-table">
          <thead>
            <tr>
              <th></th>
              <th>${t('feeds.col_name')}</th>
              <th>${t('feeds.col_category')}</th>
              ${NUTRIENT_COLS.map(c => `<th title="${colUnit(c)}">${colLabel(c)}</th>`).join('')}
              <th>${t('feeds.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${feeds.map(f => renderFeedRow(f, state)).join('')}
          </tbody>
        </table>
      </div>`;

    // Add/remove butonları
    tableContainer.querySelectorAll('.add-feed-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleFeedSelection(btn, state, container));
    });

    // FAZ 12 Madde 9: Detay / Düzenle / Sil aksiyon butonları
    tableContainer.querySelectorAll('.feed-detail-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const feed = await getFeedById(btn.dataset.id);
        if (feed) openFeedDetail(feed);
      });
    });
    tableContainer.querySelectorAll('.feed-edit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const feed = await getFeedById(btn.dataset.id);
        if (feed) openFeedEditor(feed, 'edit', async () => loadFeeds(container, state));
      });
    });
    tableContainer.querySelectorAll('.feed-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const feed = await getFeedById(btn.dataset.id);
        if (feed) confirmDeleteFeed(feed, async () => loadFeeds(container, state));
      });
    });
  } catch (err) {
    console.error('Feed yükleme hatası:', err);
    container.querySelector('#feed-table-container').innerHTML =
      `<div class="warn-box">${t('feeds.load_error')}: ${err.message}</div>`;
  }
}

function renderFeedRow(f, state) {
  const selected = !!state.selectedFeeds.find(s => s.id === f.id);
  const catClass = `cat-${f.category}`;
  const userFeed = isUserFeed(f);
  const userBadge = userFeed ? `<span class="user-badge" title="${t('feeds.user_feed')}"><i class="ti ti-user"></i></span>` : '';

  // FAZ 12 Madde 9: Her satıra Detay (her zaman), Edit/Sil (yalnız user feeds)
  const editBtn = userFeed
    ? `<button class="btn-icon feed-edit-btn"   data-id="${f.id}" title="${t('feeds.edit')}"><i class="ti ti-edit"></i></button>`
    : `<button class="btn-icon" disabled title="${t('feeds.std_no_edit')}" style="opacity:0.3; cursor:not-allowed"><i class="ti ti-edit"></i></button>`;
  const delBtn = userFeed
    ? `<button class="btn-icon feed-delete-btn" data-id="${f.id}" title="${t('feeds.delete')}"><i class="ti ti-trash"></i></button>`
    : `<button class="btn-icon" disabled title="${t('feeds.std_no_delete')}" style="opacity:0.3; cursor:not-allowed"><i class="ti ti-trash"></i></button>`;

  return `
    <tr data-row-id="${f.id}" data-name="${escHtml(f.name)}" data-cat="${f.category}">
      <td>
        <button class="btn btn-sm ${selected ? 'btn-danger' : 'btn-primary'} add-feed-btn"
          data-id="${f.id}" title="${selected ? t('feeds.remove_from_ration') : t('feeds.add_to_ration')}">
          ${selected ? '−' : '+'}
        </button>
      </td>
      <td>
        <div>${escHtml(f.name)} ${userBadge}</div>
        ${f.nameEn ? `<div class="text-small text-muted">${escHtml(f.nameEn)}</div>` : ''}
      </td>
      <td><span class="category-pill ${catClass}">${catLabel(f.category)}</span></td>
      ${NUTRIENT_COLS.map(c => `<td class="num">${fmt(f[c.key])}</td>`).join('')}
      <td class="feed-actions">
        <button class="btn-icon feed-detail-btn" data-id="${f.id}" title="${t('feeds.detail')}"><i class="ti ti-eye"></i></button>
        ${editBtn}
        ${delBtn}
      </td>
    </tr>`;
}

function toggleFeedSelection(btn, state, container) {
  const id = btn.dataset.id;
  const idx = state.selectedFeeds.findIndex(f => f.id === id);
  const row = container.querySelector(`[data-row-id="${id}"]`);
  const name = row?.dataset.name ?? id;
  const cat  = row?.dataset.cat ?? '';

  if (idx === -1) {
    state.selectedFeeds.push({ id, name, category: cat, minKg: null, maxKg: null });
    btn.textContent = '−';
    btn.classList.replace('btn-primary', 'btn-danger');
    btn.title = t('feeds.remove_from_ration');
    showToast(t('feeds.added_one', { name }), 'info');
  } else {
    state.selectedFeeds.splice(idx, 1);
    btn.textContent = '+';
    btn.classList.replace('btn-danger', 'btn-primary');
    btn.title = t('feeds.add_to_ration');
  }
}

