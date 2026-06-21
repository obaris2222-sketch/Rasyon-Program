/**
 * FAZ 12 Madde 9: Yem Detay / Düzenle / Yeni Modal'ı
 *
 * 3 mod:
 *   - detail: read-only, kategorize tüm alanlar gösterilir
 *   - edit:   mevcut yem düzenlenir (yalnızca user_ prefix)
 *   - new:    sıfırdan tam form, ID otomatik user_<timestamp>
 *
 * Fiyat (pricePerTon) bu modalda **read-only** — Fiyat Yöneticisi'ne yönlendirilir.
 */

import { addCustomFeed, updateFeed, deleteFeed } from '../../data/feedService.js';
import { CATEGORY_LABELS_TR } from '../../data/feedService.js';
import { STARCH_PROCESSING } from '../../core/starch.js';  // FAZ 16.4: nişasta işleme tipleri
import { cncpsProteinDataSource } from '../../core/cncps.js';  // FAZ 19.2: CNCPS protein veri-kaynağı göstergesi
import { newId } from '../../data/uuid.js';                // FAZ 16.11: kullanıcı yemi küresel benzersiz id

// FAZ 16.4: nişasta işleme tipi seçenek etiketleri (boş = belirtilmemiş)
const STARCH_PROC_LABELS = {
  '': '— Belirtilmemiş',
  ...Object.fromEntries(Object.entries(STARCH_PROCESSING).map(([k, v]) => [k, v.label])),
};
import { showToast, escHtml } from '../utils.js';
import { t } from '../i18n.js';
import { formatRangeError, formatRequiredError, formatTypeError } from '../validation.js';

// i18n yardımcıları — anahtar yoksa mevcut TR label'a düşer (geriye uyumlu)
const tf = (key, fallback) => { const v = t(key); return v === key ? fallback : v; };
const catLabel = (cat) => tf(`categories.${cat}`, CATEGORY_LABELS_TR[cat] || cat);
const feLabel = (f) => tf(`fe.f_${f.name}`, f.label);
const feGroupTitle = (idx) => tf(`fe.g${idx}`, FIELD_GROUPS[idx].title);
function optLabel(f, opt) {
  if (f.name === 'starchProcessing') {
    if (opt === '') return tf('fe.sp_empty', f.optionLabels?.[''] || opt);
    return tf(`fe.proc_${opt}`, f.optionLabels?.[opt] || opt);
  }
  if (f.name === 'category') return catLabel(opt);
  return (f.optionLabels && f.optionLabels[opt]) || CATEGORY_LABELS_TR[opt] || opt;
}

// ─── Alan tanımları (gruplu) ─────────────────────────────────────────────────
const FIELD_GROUPS = [
  {
    title: '📋 Temel Bilgi',
    fields: [
      { name: 'name',     label: 'Yem Adı (TR)',  type: 'text',   required: true },
      { name: 'nameEn',   label: 'Yem Adı (EN)',  type: 'text' },
      { name: 'category', label: 'Kategori',      type: 'select', required: true,
        options: ['roughage','grain','protein','byproduct','fat','mineral'] },
      { name: 'dm',       label: 'KM (%)',        type: 'number', min: 5, max: 99, step: 0.1, required: true },
    ],
  },
  {
    title: '⚡ Enerji',
    fields: [
      { name: 'nel',         label: 'NEL (Mcal/kg KM)',   type: 'number', min: 0, max: 3, step: 0.01, required: true },
      { name: 'nelDiscount', label: 'NEL İskontosu (% — LP\'ye uygulanır)', type: 'number', min: 0, max: 30, step: 0.1 },
      { name: 'me',          label: 'ME (Mcal/kg KM)',    type: 'number', step: 0.01 },
      { name: 'tdn',         label: 'TDN (%)',            type: 'number', step: 0.1 },
    ],
  },
  {
    title: '🥩 Protein',
    fields: [
      { name: 'cp',        label: 'HP/CP (%KM)',          type: 'number', min: 0, max: 50, step: 0.1, required: true },
      { name: 'rdp',       label: 'RDP (%CP)',            type: 'number', min: 0, max: 100, step: 1 },
      { name: 'rup',       label: 'RUP (%CP)',            type: 'number', min: 0, max: 100, step: 1 },
      { name: 'rupIntD',   label: 'RUP Intest. Sind. (%)', type: 'number', min: 0, max: 100, step: 1 },
      { name: 'ndicp',     label: 'NDICP (%KM)',          type: 'number', step: 0.1 },
    ],
  },
  {
    title: '🧬 Karbonhidrat & Lif',
    fields: [
      { name: 'ndf',    label: 'NDF (%KM)',     type: 'number', step: 0.1 },
      { name: 'adf',    label: 'ADF (%KM)',     type: 'number', step: 0.1 },
      { name: 'lignin', label: 'Lignin (%KM)',  type: 'number', step: 0.1 },
      { name: 'nfc',    label: 'NFC (%KM)',     type: 'number', step: 0.1 },
      { name: 'starch', label: 'Nişasta (%KM)', type: 'number', step: 0.1 },
      { name: 'starchProcessing', label: 'Nişasta İşleme Tipi (rumen sind.)', type: 'select',
        options: ['', 'whole', 'cracked', 'dryGround', 'dryGroundFine', 'highMoisture', 'steamFlaked'],
        optionLabels: STARCH_PROC_LABELS },
      { name: 'sugar',  label: 'Şeker (%KM)',   type: 'number', step: 0.1 },
      { name: 'fat',    label: 'Yağ (%KM)',     type: 'number', step: 0.1 },
      { name: 'ash',    label: 'Kül (%KM)',     type: 'number', step: 0.1 },
    ],
  },
  {
    title: '🧪 Makro Mineraller (%KM)',
    fields: [
      { name: 'ca', label: 'Ca', type: 'number', step: 0.01 },
      { name: 'p',  label: 'P',  type: 'number', step: 0.01 },
      { name: 'mg', label: 'Mg', type: 'number', step: 0.01 },
      { name: 'k',  label: 'K',  type: 'number', step: 0.01 },
      { name: 'na', label: 'Na', type: 'number', step: 0.01 },
      { name: 'cl', label: 'Cl', type: 'number', step: 0.01 },
      { name: 's',  label: 'S',  type: 'number', step: 0.01 },
    ],
  },
  {
    title: '🧪 İz Mineraller (mg/kg KM)',
    fields: [
      { name: 'fe', label: 'Fe (Demir)',   type: 'number', step: 1 },
      { name: 'zn', label: 'Zn (Çinko)',   type: 'number', step: 1 },
      { name: 'cu', label: 'Cu (Bakır)',   type: 'number', step: 0.1 },
      { name: 'mn', label: 'Mn (Manganez)', type: 'number', step: 1 },
      { name: 'se', label: 'Se (Selenyum)', type: 'number', step: 0.01 },
      { name: 'co', label: 'Co (Kobalt)',   type: 'number', step: 0.01 },
      { name: 'i',  label: 'I (İyot)',      type: 'number', step: 0.01 },
    ],
  },
  {
    title: '💊 Vitaminler & Fonksiyonel Besinler',
    fields: [
      { name: 'vitA',      label: 'Vit A (IU/kg KM)',  type: 'number', step: 100 },
      { name: 'vitD',      label: 'Vit D (IU/kg KM)',  type: 'number', step: 100 },
      { name: 'vitE',      label: 'Vit E (IU/kg KM)',  type: 'number', step: 1 },
      { name: 'bcarotene', label: 'β-karoten (mg/kg)', type: 'number', step: 1 },
      { name: 'niacin',    label: 'Niacin (mg/kg)',    type: 'number', step: 10 },
      { name: 'biotin',    label: 'Biotin (mg/kg)',    type: 'number', step: 0.1 },
      { name: 'choline',   label: 'Kolin (g/kg KM)',   type: 'number', step: 1 },
    ],
  },
  {
    title: '🥛 Yağ Asidi Profili (% toplam FA, opsiyonel)',
    fields: [
      { name: 'fa_c16_0', label: 'C16:0 Palmitik',   type: 'number', step: 0.1 },
      { name: 'fa_c18_0', label: 'C18:0 Stearik',    type: 'number', step: 0.1 },
      { name: 'fa_c18_1', label: 'C18:1 Oleik',      type: 'number', step: 0.1 },
      { name: 'fa_c18_2', label: 'C18:2 Linoleik',   type: 'number', step: 0.1 },
      { name: 'fa_c18_3', label: 'C18:3 Linolenik',  type: 'number', step: 0.1 },
    ],
  },
  {
    title: '🧬 Amino Asit Profili (% HP, opsiyonel)',
    fields: [
      { name: 'lys', label: 'Lys (Lizin)',       type: 'number', min: 0, max: 15, step: 0.01 },
      { name: 'met', label: 'Met (Metiyonin)',   type: 'number', min: 0, max: 6,  step: 0.01 },
      { name: 'his', label: 'His (Histidin)',    type: 'number', min: 0, max: 6,  step: 0.01 },
      { name: 'arg', label: 'Arg (Arginin)',     type: 'number', min: 0, max: 12, step: 0.01 },
      { name: 'thr', label: 'Thr (Treonin)',     type: 'number', min: 0, max: 8,  step: 0.01 },
      { name: 'ile', label: 'Ile (İzolösin)',    type: 'number', min: 0, max: 8,  step: 0.01 },
      { name: 'leu', label: 'Leu (Lösin)',       type: 'number', min: 0, max: 15, step: 0.01 },
      { name: 'val', label: 'Val (Valin)',       type: 'number', min: 0, max: 8,  step: 0.01 },
      { name: 'phe', label: 'Phe (Fenilalanin)', type: 'number', min: 0, max: 8,  step: 0.01 },
      { name: 'trp', label: 'Trp (Triptofan)',   type: 'number', min: 0, max: 4,  step: 0.01 },
    ],
  },
  {
    title: '🇫🇷 INRA 2018 Değerleri (opsiyonel)',
    fields: [
      { name: 'inraUFL',  label: 'UFL/kg KM',      type: 'number', min: 0, max: 2,   step: 0.01 },
      { name: 'inraPDIE', label: 'PDIE (g/kg KM)', type: 'number', min: 0, max: 400, step: 1 },
      { name: 'inraPDIN', label: 'PDIN (g/kg KM)', type: 'number', min: 0, max: 400, step: 1 },
      { name: 'inraUEL',  label: 'UEL/kg KM',      type: 'number', min: 0, max: 2,   step: 0.01 },
    ],
  },
  {
    title: '🔬 CNCPS Parçalanma Hızları (kd, %/saat, ölçülü - opsiyonel)',
    fields: [
      { name: 'choKdB1', label: 'CHO kd-B1 (Nişasta/Pektin)', type: 'number', step: 0.1 },
      { name: 'choKdB2', label: 'CHO kd-B2 (Sind. NDF)',      type: 'number', step: 0.1 },
      { name: 'protKdB1', label: 'Prot kd-B1 (Orta-Hızlı)',   type: 'number', step: 0.1 },
      { name: 'protKdB2', label: 'Prot kd-B2 (Yavaş)',        type: 'number', step: 0.1 },
      { name: 'protKdB3', label: 'Prot kd-B3 (Lif-bağlı)',    type: 'number', step: 0.1 },
      { name: 'kdB1', label: 'Eski CHO kd-B1 (Fallback)',     type: 'number', step: 0.1 },
      { name: 'kdB2', label: 'Eski CHO kd-B2 (Fallback)',     type: 'number', step: 0.1 },
      { name: 'kdB3', label: 'Eski CHO kd-C (Fallback)',      type: 'number', step: 0.1 },
    ],
  },
  {
    title: '🧫 Mikotoksin (μg/kg KM, lab analizi, opsiyonel)',
    fields: [
      { name: 'aflatoxinB1', label: 'Aflatoksin B1',       type: 'number', min: 0, step: 0.1 },
      { name: 'don',         label: 'DON (Vomitoksin)',    type: 'number', min: 0, step: 1 },
      { name: 'zearalenone', label: 'Zearalenon',          type: 'number', min: 0, step: 1 },
      { name: 'fumonisin',   label: 'Fumonisin',           type: 'number', min: 0, step: 1 },
      { name: 't2toxin',     label: 'T-2 Toksini',         type: 'number', min: 0, step: 1 },
      { name: 'ochratoxin',  label: 'Okratoksin A',        type: 'number', min: 0, step: 0.1 },
    ],
  },
  {
    title: '🌾 Silaj Fermentasyon Kalitesi (lab analizi, yalnız silaj)',
    fields: [
      { name: 'silagePH',         label: 'Silaj pH',              type: 'number', min: 3, max: 7, step: 0.1 },
      { name: 'silageLacticAcid', label: 'Laktik Asit (%KM)',     type: 'number', min: 0, max: 20, step: 0.1 },
      { name: 'silageAceticAcid', label: 'Asetik Asit (%KM)',     type: 'number', min: 0, max: 15, step: 0.1 },
      { name: 'silageButyricAcid',label: 'Butirik Asit (%KM)',    type: 'number', min: 0, max: 10, step: 0.01 },
      { name: 'silageNH3N',       label: 'NH3-N (% toplam N)',    type: 'number', min: 0, max: 50, step: 0.1 },
    ],
  },
  {
    title: '📝 Yorum / Notlar',
    fields: [
      { name: 'notes', label: 'Açıklama / kaynak (opsiyonel)', type: 'textarea' },
    ],
  },
];

const NUMERIC_FIELD_NAMES = new Set();
FIELD_GROUPS.forEach(g => g.fields.forEach(f => { if (f.type === 'number') NUMERIC_FIELD_NAMES.add(f.name); }));
// FAZ 16.4: select alanları — boş seçim ('') kaydedilir (merge'de eski değeri temizler)
const SELECT_FIELD_NAMES = new Set();
FIELD_GROUPS.forEach(g => g.fields.forEach(f => { if (f.type === 'select') SELECT_FIELD_NAMES.add(f.name); }));

// ─── Modal yardımcıları ─────────────────────────────────────────────────────

function openModal(html, opts = {}) {
  // Mevcut modal varsa kapat
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'feed-modal-overlay';
  overlay.id = 'feed-modal-overlay';
  overlay.innerHTML = `
    <div class="feed-modal" role="dialog" aria-modal="true">
      ${html}
    </div>
  `;
  document.body.appendChild(overlay);
  // Tıklama dışarıda → kapat
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && !opts.persistent) closeModal();
  });
  // ESC → kapat
  document.addEventListener('keydown', _escHandler);
  return overlay;
}

function _escHandler(e) {
  if (e.key === 'Escape') closeModal();
}

export function closeModal() {
  const existing = document.getElementById('feed-modal-overlay');
  if (existing) existing.remove();
  document.removeEventListener('keydown', _escHandler);
}

// ─── Detay Modalı (read-only) ───────────────────────────────────────────────

export function openFeedDetail(feed) {
  const isUserFeed = (feed.id || '').startsWith('user_') || feed.source === 'user' || feed.source === 'custom';
  const sourceLabel = isUserFeed ? t('fe.src_user') :
    feed.id?.startsWith('nrc_') ? t('fe.src_nrc') :
    feed.id?.startsWith('tr_')  ? t('fe.src_tr') :
    feed.id?.startsWith('min_') ? t('fe.src_min') : t('fe.src_std');

  // FAZ 19.2: CNCPS protein veri-kaynağı göstergesi (proteinli yemlerde) — ölçülü alt-fraksiyon
  // (solCP+ndicp+adicp) varsa CNCPS analiz paneli gerçek veriye dayanır; yoksa kategori-türetme.
  const hasProtein = Number(feed.cp) > 0 && feed.category !== 'mineral' && feed.category !== 'fat';
  const cncpsSrc = hasProtein ? cncpsProteinDataSource(feed) : null;
  const cncpsBadge = cncpsSrc
    ? `<span class="badge ${cncpsSrc === 'measured' ? 'badge-display' : ''}" title="${t(cncpsSrc === 'measured' ? 'fe.cncps_measured_hint' : 'fe.cncps_derived_hint')}">${t(cncpsSrc === 'measured' ? 'fe.cncps_measured' : 'fe.cncps_derived')}</span>`
    : '';

  const sections = FIELD_GROUPS.map((group, idx) => {
    const rows = group.fields
      .filter(f => feed[f.name] !== undefined && feed[f.name] !== null && feed[f.name] !== '')
      .map(f => `
        <tr>
          <td>${escHtml(feLabel(f))}</td>
          <td class="num">${escHtml(String(feed[f.name]))}</td>
        </tr>`).join('');
    if (!rows) return '';
    return `
      <details class="acc-panel" open>
        <summary><strong>${feGroupTitle(idx)}</strong></summary>
        <table class="diag-table" style="margin-top:0.5rem; font-size:0.85rem">
          <tbody>${rows}</tbody>
        </table>
      </details>`;
  }).filter(Boolean).join('');

  const priceRow = feed.pricePerTon ? `
    <div class="info-box" style="margin-bottom:0.5rem">
      ${t('fe.price')} <b>${feed.pricePerTon} ${t('fe.price_unit')}</b>
      <span class="text-muted text-small">${t('fe.price_note')}</span>
    </div>` : '';

  openModal(`
    <div class="feed-modal-header">
      <h2><i class="ti ti-eye"></i> ${escHtml(feed.name)}</h2>
      <div class="feed-modal-meta">
        <span>${sourceLabel}</span>
        <span class="text-muted">${t('fe.id')} ${escHtml(feed.id)}</span>
        ${feed.category ? `<span class="category-pill cat-${feed.category}">${catLabel(feed.category)}</span>` : ''}
        ${cncpsBadge}
      </div>
      <button class="modal-close-btn" type="button" aria-label="${t('fe.close')}"><i class="ti ti-x"></i></button>
    </div>
    <div class="feed-modal-body">
      ${priceRow}
      ${sections}
    </div>
    <div class="feed-modal-footer">
      <button class="btn btn-secondary" id="modal-close-btn-2">${t('fe.close')}</button>
    </div>
  `);

  document.querySelector('.modal-close-btn')?.addEventListener('click', closeModal);
  document.querySelector('#modal-close-btn-2')?.addEventListener('click', closeModal);
}

// ─── Edit / New Modal ───────────────────────────────────────────────────────

export function openFeedEditor(feed, mode = 'new', onSave) {
  const isEdit = mode === 'edit';
  const title = isEdit ? t('fe.edit_title', { name: escHtml(feed?.name || '') }) : t('fe.new_title');
  const current = feed || { category: 'roughage' };

  const sections = FIELD_GROUPS.map((group, idx) => `
    <details class="acc-panel" ${['📋 Temel Bilgi','⚡ Enerji','🥩 Protein'].includes(group.title) ? 'open' : ''}>
      <summary><strong>${feGroupTitle(idx)}</strong></summary>
      <div class="form-grid" style="margin-top:0.5rem">
        ${group.fields.map(f => renderField(f, current)).join('')}
      </div>
    </details>
  `).join('');

  openModal(`
    <div class="feed-modal-header">
      <h2>${title}</h2>
      <button class="modal-close-btn" type="button" aria-label="${t('fe.close')}"><i class="ti ti-x"></i></button>
    </div>
    <div class="feed-modal-body">
      <form id="feed-editor-form" novalidate>
        ${sections}
        <div id="feed-editor-err" class="warn-box" style="display:none; margin-top:0.5rem"></div>
      </form>
    </div>
    <div class="feed-modal-footer">
      <button class="btn btn-secondary" id="cancel-btn">${t('fe.cancel')}</button>
      <button class="btn btn-primary" id="save-btn">${isEdit ? t('fe.update') : t('fe.save')}</button>
    </div>
  `, { persistent: true });

  document.querySelector('.modal-close-btn')?.addEventListener('click', closeModal);
  document.querySelector('#cancel-btn')?.addEventListener('click', closeModal);
  document.querySelector('#save-btn')?.addEventListener('click', () => handleSave(current, isEdit, onSave));
}

function renderField(f, current) {
  const v = current[f.name];
  const value = v === undefined || v === null ? '' : v;
  const req = f.required ? 'required' : '';
  const star = f.required ? '<span style="color:var(--danger,#c0392b)">*</span>' : '';
  if (f.type === 'textarea') {
    return `
      <div class="form-group full-width">
        <label>${escHtml(feLabel(f))} ${star}</label>
        <textarea name="${f.name}" rows="2" ${req}>${escHtml(String(value))}</textarea>
      </div>`;
  }
  if (f.type === 'select') {
    return `
      <div class="form-group">
        <label>${escHtml(feLabel(f))} ${star}</label>
        <select name="${f.name}" ${req}>
          ${f.options.map(opt => `<option value="${opt}" ${opt === value ? 'selected' : ''}>${escHtml(optLabel(f, opt))}</option>`).join('')}
        </select>
      </div>`;
  }
  const attrs = [
    f.min  !== undefined ? `min="${f.min}"`   : '',
    f.max  !== undefined ? `max="${f.max}"`   : '',
    f.step !== undefined ? `step="${f.step}"` : '',
  ].filter(Boolean).join(' ');
  return `
    <div class="form-group">
      <label>${escHtml(feLabel(f))} ${star}</label>
      <input type="${f.type}" name="${f.name}" value="${escHtml(String(value))}" ${attrs} ${req} />
    </div>`;
}

async function handleSave(current, isEdit, onSave) {
  const form = document.querySelector('#feed-editor-form');
  const errEl = document.querySelector('#feed-editor-err');
  errEl.style.display = 'none';
  errEl.textContent = '';
  const fd = new FormData(form);
  const data = {};
  for (const [k, v] of fd.entries()) {
    // Select alanları için boş ('') değere izin ver → merge'de eski değeri temizler
    // (örn. nişasta işleme tipini "— Belirtilmemiş"e geri çevirme). Diğer boşlar atlanır.
    if ((v === '' || v === null) && !SELECT_FIELD_NAMES.has(k)) continue;
    if (NUMERIC_FIELD_NAMES.has(k)) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      data[k] = n;
    } else {
      data[k] = v;
    }
  }

  // Yağ asidi profili nested → faProfile
  const fa = {};
  ['fa_c16_0','fa_c18_0','fa_c18_1','fa_c18_2','fa_c18_3'].forEach(k => {
    if (data[k] !== undefined) {
      fa[k.replace('fa_', '')] = data[k];
      delete data[k];
    }
  });
  if (Object.keys(fa).length) data.faProfile = fa;

  // FAZ 15.9: FIELD_GROUPS taban validation — required + tip + range, Türkçe açıklayıcı mesaj
  const errors = [];
  for (const grp of FIELD_GROUPS) {
    for (const f of grp.fields) {
      const v = data[f.name];
      const isEmpty = v === undefined || v === null || v === '';
      const lbl = feLabel(f);
      if (f.required && isEmpty) { errors.push(formatRequiredError(lbl)); continue; }
      if (isEmpty) continue;
      if (f.type === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) { errors.push(formatTypeError(lbl, 'number')); continue; }
        if (Number.isFinite(f.min) && n < f.min) { errors.push(formatRangeError(lbl, n, f.min, f.max)); continue; }
        if (Number.isFinite(f.max) && n > f.max) { errors.push(formatRangeError(lbl, n, f.min, f.max)); continue; }
      }
    }
  }
  if (errors.length) {
    errEl.textContent = errors[0] + (errors.length > 1 ? t('fe.err_more', { n: errors.length - 1 }) : '');
    errEl.style.display = 'block';
    return;
  }

  try {
    let saved;
    if (isEdit) {
      saved = await updateFeed(current.id, data);
      showToast(t('fe.updated', { name: saved.name }), 'success');
    } else {
      data.id = `user_${newId()}`;   // küresel benzersiz (cihazlar arası senkron-güvenli)
      data.source = 'user';
      saved = await addCustomFeed(data);
      showToast(t('fe.added', { name: saved.name }), 'success');
    }
    closeModal();
    if (typeof onSave === 'function') await onSave(saved);
  } catch (err) {
    errEl.textContent = t('fe.save_err') + (err.message || err);
    errEl.style.display = 'block';
  }
}

// ─── Sil ───────────────────────────────────────────────────────────────────

export async function confirmDeleteFeed(feed, onDeleted) {
  const ok = window.confirm(t('fe.confirm_del', { name: feed.name }));
  if (!ok) return;
  try {
    await deleteFeed(feed.id);
    showToast(t('fe.deleted', { name: feed.name }), 'info');
    if (typeof onDeleted === 'function') await onDeleted(feed);
  } catch (err) {
    showToast(t('fe.del_err') + (err.message || err), 'error');
  }
}

// ─── User feed mi? ──────────────────────────────────────────────────────────

export function isUserFeed(feed) {
  return (feed.id || '').startsWith('user_') || feed.source === 'user' || feed.source === 'custom';
}
