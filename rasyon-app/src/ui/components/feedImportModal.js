/**
 * Yem İçe Aktarma Modal'ı — CSV / Excel sürükle-bırak (FAZ 16.7)
 *
 * Akış: dosya seç/bırak → ayrıştır (CSV metin / Excel dinamik XLSX) → önizleme
 * (geçerli/geçersiz/uyarı) → toplu ekleme (importFeedsFromJSON).
 *
 * XLSX yalnızca .xlsx/.xls verilince DİNAMİK yüklenir (ana bundle küçük kalır).
 * Çekirdek ayrıştırma/validasyon feedImporter.js'te (saf, test edilmiş).
 */

import {
  parseCSV, processImportRows, buildTemplateCSV, IMPORT_COLUMNS, getTemplateObjects
} from '../../data/feedImporter.js';
import { importFeedsFromJSON, CATEGORY_LABELS_TR } from '../../data/feedService.js';
import { showToast, escHtml, fmt } from '../utils.js';
import { t } from '../i18n.js';

const catLabel = (cat) => { const k = `categories.${cat}`; const v = t(k); return v === k ? (CATEGORY_LABELS_TR[cat] || cat) : v; };

const PREVIEW_LIMIT = 12;   // önizleme tablosunda gösterilen geçerli yem sayısı
const ERROR_LIMIT = 20;     // listelenecek hatalı satır sayısı

let _result = null;   // son processImportRows çıktısı (import butonu kullanır)

// ─── Modal kabuğu ────────────────────────────────────────────────────────────

function closeImportModal() {
  document.getElementById('feed-import-overlay')?.remove();
  document.removeEventListener('keydown', _escHandler);
  _result = null;
}

function _escHandler(e) { if (e.key === 'Escape') closeImportModal(); }

/**
 * İçe aktarma modal'ını aç.
 * @param {function} [onImported] — başarılı toplu eklemeden sonra çağrılır (liste tazele)
 */
export function openFeedImportModal(onImported) {
  closeImportModal();
  _result = null;

  const overlay = document.createElement('div');
  overlay.className = 'feed-modal-overlay';
  overlay.id = 'feed-import-overlay';
  overlay.innerHTML = `
    <div class="feed-modal" role="dialog" aria-modal="true" aria-label="${t('imp.aria')}">
      <div class="feed-modal-header">
        <h2>${t('imp.title')}</h2>
        <button class="modal-close-btn" type="button" aria-label="${t('imp.close')}"><i class="ti ti-x"></i></button>
        <div class="feed-modal-meta">
          ${t('imp.meta')}
        </div>
      </div>
      <div class="feed-modal-body">
        <div class="info-box box-info">
          <b>${t('imp.how_title')}</b> ${t('imp.how_desc')}
          <div class="flex gap-1" style="margin-top:0.5rem">
            <button class="btn btn-sm btn-secondary" id="import-template-btn">
              ${t('imp.template_btn')}
            </button>
            <button class="btn btn-sm btn-secondary" id="import-template-excel-btn">
              <i class="ti ti-file-spreadsheet"></i> Örnek Şablon İndir (.xlsx)
            </button>
          </div>
        </div>

        <div id="import-dropzone" class="import-dropzone" tabindex="0">
          <input type="file" id="import-file-input" accept=".csv,.xlsx,.xls,text/csv" hidden />
          <div class="import-dropzone-inner">
            <div class="import-dropzone-icon"><i class="ti ti-file-upload"></i></div>
            <p>${t('imp.drop_here')}</p>
            <p class="text-small text-muted">.csv · .xlsx · .xls</p>
          </div>
        </div>

        <div id="import-preview"></div>
      </div>
      <div class="feed-modal-footer">
        <button class="btn btn-secondary" id="import-cancel-btn">${t('imp.cancel')}</button>
        <button class="btn btn-primary" id="import-confirm-btn" disabled>${t('imp.import_btn')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeImportModal(); });
  document.addEventListener('keydown', _escHandler);
  overlay.querySelector('.modal-close-btn')?.addEventListener('click', closeImportModal);
  overlay.querySelector('#import-cancel-btn')?.addEventListener('click', closeImportModal);

  // Şablon indir
  overlay.querySelector('#import-template-btn')?.addEventListener('click', downloadTemplate);
  overlay.querySelector('#import-template-excel-btn')?.addEventListener('click', downloadExcelTemplate);

  // Dosya seçimi
  const dropzone = overlay.querySelector('#import-dropzone');
  const fileInput = overlay.querySelector('#import-file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });

  // Sürükle-bırak
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  // Toplu ekleme
  overlay.querySelector('#import-confirm-btn')?.addEventListener('click', () => doImport(onImported));
}

// ─── Şablon indirme ──────────────────────────────────────────────────────────

function downloadTemplate() {
  // UTF-8 BOM → Excel Türkçe karakterleri doğru açar
  const blob = new Blob(['﻿' + buildTemplateCSV()], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, 'yem-sablon.csv');
  showToast(t('imp.template_done'), 'info');
}

async function downloadExcelTemplate() {
  try {
    const XLSX = await import('xlsx-js-style');
    const objects = getTemplateObjects();
    const data = objects.map(ex => {
      const row = {};
      IMPORT_COLUMNS.forEach(col => { row[col.label] = ex[col.field] ?? ''; });
      return row;
    });
    
    const headers = IMPORT_COLUMNS.map(c => c.label);
    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    const wb = XLSX.utils.book_new();
    
    // Basit bir sığdırma ve filtre (şablon formatı)
    ws['!cols'] = IMPORT_COLUMNS.map(c => ({ wch: c.field === 'name' || c.field === 'nameEn' || c.field === 'comment' ? 25 : 12 }));
    ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
    ws['!autofilter'] = { ref: ws['!ref'] };
    
    // Başlık Satırını Renklendir
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = ws[XLSX.utils.encode_cell({c: C, r: 0})];
      if (cell) {
        cell.s = {
          fill: { fgColor: { rgb: "339966" } }, // Yeşil
          font: { bold: true, color: { rgb: "FFFFFF" } },
          alignment: { horizontal: "center", vertical: "center" },
          border: { bottom: { style: "medium", color: { rgb: "000000" } } }
        };
      }
    }
    
    XLSX.utils.book_append_sheet(wb, ws, "Yemler");
    XLSX.writeFile(wb, "yem-sablon.xlsx");
    showToast('Excel şablonu indirildi.', 'info');
  } catch (err) {
    showToast('Şablon oluşturulurken hata: ' + err.message, 'error');
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Dosya işleme ────────────────────────────────────────────────────────────

async function handleFile(file) {
  const preview = document.getElementById('import-preview');
  if (preview) preview.innerHTML = `<p class="text-muted">${t('imp.reading')}</p>`;

  try {
    let rows;
    const name = (file.name || '').toLowerCase();
    const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls');

    if (isExcel) {
      rows = await readExcelRows(file);
    } else {
      const text = await file.text();
      rows = parseCSV(text).rows;
    }

    if (!rows || rows.length === 0) {
      _result = null;
      setConfirmEnabled(0);
      if (preview) preview.innerHTML = `<div class="warn-box box-warn">${t('imp.no_rows')}</div>`;
      return;
    }

    _result = processImportRows(rows);
    renderPreview(_result, file.name);
    setConfirmEnabled(_result.summary.valid);
  } catch (err) {
    console.error('İçe aktarma okuma hatası:', err);
    _result = null;
    setConfirmEnabled(0);
    if (preview) preview.innerHTML = `<div class="warn-box box-danger">${t('imp.read_err')}${escHtml(err.message || String(err))}</div>`;
  }
}

/** Excel dosyasını başlık-anahtarlı satır nesnelerine çevir (XLSX dinamik yüklenir). */
async function readExcelRows(file) {
  const XLSX = await import('xlsx-js-style');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  // raw:true → sayılar sayı kalır; defval:'' → boş hücreler boş string
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  // Tamamen boş satırları at (Excel'de görünmez kalıntı satırlar)
  return rows.filter(r => Object.values(r).some(v => String(v ?? '').trim() !== ''));
}

function setConfirmEnabled(validCount) {
  const btn = document.getElementById('import-confirm-btn');
  if (!btn) return;
  btn.disabled = !(validCount > 0);
  btn.textContent = validCount > 0 ? t('imp.add_n', { n: validCount }) : t('imp.import_btn');
}

// ─── Önizleme ────────────────────────────────────────────────────────────────

function renderPreview(result, fileName) {
  const preview = document.getElementById('import-preview');
  if (!preview) return;
  const { summary, rowResults, feeds } = result;

  const summaryClass = summary.invalid > 0 ? 'box-warn' : 'box-ok';
  const summaryBox = `
    <div class="info-box ${summaryClass}" style="margin-top:1rem">
      ${t('imp.summary', { file: escHtml(fileName), total: summary.total, valid: summary.valid, invalid: summary.invalid })}
      ${summary.warnings ? t('imp.warnings_n', { n: summary.warnings }) : ''}
    </div>`;

  // Geçerli yem önizleme tablosu
  let validTable = '';
  if (feeds.length) {
    const shown = feeds.slice(0, PREVIEW_LIMIT);
    validTable = `
      <div class="text-small text-muted" style="margin:0.5rem 0 0.25rem">${t('imp.feeds_to_add', { shown: shown.length, total: feeds.length })}</div>
      <div class="feed-table-wrap" style="max-height:230px; overflow:auto">
        <table class="diag-table" style="font-size:0.82rem">
          <thead><tr><th>${t('imp.col_name')}</th><th>${t('imp.col_cat')}</th><th class="num">${t('imp.col_dm')}</th><th class="num">${t('imp.col_nel')}</th><th class="num">${t('imp.col_cp')}</th></tr></thead>
          <tbody>
            ${shown.map(f => `
              <tr>
                <td>${escHtml(f.name)}</td>
                <td>${escHtml(catLabel(f.category))}</td>
                <td class="num">${fmt(f.dm, 0)}</td>
                <td class="num">${fmt(f.nel)}</td>
                <td class="num">${fmt(f.cp, 1)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Hatalı satırlar
  const invalidRows = rowResults.filter(r => !r.ok);
  let errorList = '';
  if (invalidRows.length) {
    const shown = invalidRows.slice(0, ERROR_LIMIT);
    errorList = `
      <details class="acc-panel" open style="margin-top:0.6rem">
        <summary><strong>${t('imp.invalid_rows', { n: invalidRows.length })}</strong></summary>
        <ul class="import-issue-list">
          ${shown.map(r => `
            <li><b>${t('imp.row')} ${r.row}</b> ${escHtml(r.name)}: ${escHtml(r.errors.join('; '))}</li>
          `).join('')}
          ${invalidRows.length > ERROR_LIMIT ? `<li class="text-muted">${t('imp.more_rows', { n: invalidRows.length - ERROR_LIMIT })}</li>` : ''}
        </ul>
      </details>`;
  }

  // Uyarılı satırlar (geçerli ama eksik/şüpheli)
  const warnRows = rowResults.filter(r => r.ok && r.warnings.length);
  let warnList = '';
  if (warnRows.length) {
    const shown = warnRows.slice(0, ERROR_LIMIT);
    warnList = `
      <details class="acc-panel" style="margin-top:0.4rem">
        <summary><strong>${t('imp.warn_rows', { n: warnRows.length })}</strong></summary>
        <ul class="import-issue-list">
          ${shown.map(r => `
            <li><b>${t('imp.row')} ${r.row}</b> ${escHtml(r.name)}: ${escHtml(r.warnings.join('; '))}</li>
          `).join('')}
        </ul>
      </details>`;
  }

  // Eşleşmeyen başlıklar (ilk satırdan örnek)
  const allUnmapped = [...new Set(rowResults.flatMap(r => r.unmapped))];
  const unmappedNote = allUnmapped.length
    ? `<div class="text-small text-muted" style="margin-top:0.5rem">
         ${t('imp.unmapped', { n: allUnmapped.length })}${escHtml(allUnmapped.slice(0, 12).join(', '))}${allUnmapped.length > 12 ? '…' : ''}
       </div>`
    : '';

  preview.innerHTML = summaryBox + validTable + errorList + warnList + unmappedNote;
}

// ─── Toplu ekleme ────────────────────────────────────────────────────────────

async function doImport(onImported) {
  if (!_result || !_result.feeds.length) return;
  const btn = document.getElementById('import-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = t('imp.adding'); }
  try {
    const { imported, skipped, errors } = await importFeedsFromJSON(_result.feeds);
    if (imported > 0) {
      showToast(t('imp.imported', { n: imported }) + (skipped ? t('imp.imported_skipped', { n: skipped }) : '') + '.', 'success');
    } else {
      showToast(t('imp.none_added'), 'error');
    }
    if (errors?.length) console.warn('İçe aktarma atlananlar:', errors);
    closeImportModal();
    if (typeof onImported === 'function') await onImported(imported);
  } catch (err) {
    console.error('İçe aktarma yazma hatası:', err);
    showToast(t('imp.import_err') + (err.message || err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = t('imp.add_n', { n: _result.feeds.length }); }
  }
}
