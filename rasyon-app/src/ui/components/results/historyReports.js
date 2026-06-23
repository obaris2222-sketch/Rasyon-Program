/**
 * Rapor & Geçmiş işlemleri (FAZ 15.8 — resultsPanel'den ayrıldı)
 * PDF/Excel/yazdır/kaydet butonları + geçmiş rasyon karşılaştırma modalı.
 */

import { rationAdd, rationGetAll, rationDelete } from '../../../data/db.js';
import { showToast, escHtml } from '../../utils.js';
import { t, feedDisplayName } from '../../i18n.js';
import { renderCompositionTable, renderDiagnostics } from './tables.js';   // denetim #15: detayda tam tablo

function _lockZoom() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
}

function _restoreZoom() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta && document.body.getAttribute('data-active-tab') === 'results') {
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  }
}

// PDF/Excel modülleri dinamik yüklenir — ana bundle küçük kalsın
export function attachReportHandlers(container, state) {
  const result = state.rationResult;
  if (!result) return;

  container.querySelector('#btn-pdf')?.addEventListener('click', async () => {
    try {
      showToast(t('history.pdf_prep'), 'info', 3000);
      const { downloadRationPDF } = await import('../../../reports/pdfExport.js');
      await downloadRationPDF({ animal: state.animal, result });
      showToast(t('history.pdf_done'), 'success');
    } catch (err) {
      console.error('PDF hatası:', err);
      showToast(t('history.pdf_err') + err.message, 'error');
    }
  });

  container.querySelector('#btn-excel')?.addEventListener('click', async () => {
    try {
      showToast(t('history.excel_prep'), 'info', 1500);
      const { downloadRationExcel } = await import('../../../reports/excelExport.js');
      downloadRationExcel({ animal: state.animal, result });
      showToast(t('history.excel_done'), 'success');
    } catch (err) {
      console.error('Excel hatası:', err);
      showToast(t('history.excel_err') + err.message, 'error');
    }
  });

  container.querySelector('#btn-print')?.addEventListener('click', () => {
    window.print();
  });

  // Rasyonu kaydet (geçmiş için)
  container.querySelector('#btn-save-ration')?.addEventListener('click', async () => {
    try {
      const profileName = state.animal.name || `${state.animal.lactationStage}-${state.animal.milkYield}kg`;
      const defaultName = `${profileName} — ${new Date().toLocaleDateString()}`;
      // denetim #3: prompt() yerine uygulama-içi modal (kurulu PWA/mobilde prompt engellenebiliyor)
      const name = await promptModal(t('history.prompt_name'), defaultName);
      if (!name) return;
      const ration = {
        name,
        animal: { ...state.animal },
        // denetim #15: daha zengin snapshot → geçmiş "Detay"ında tam kompozisyon + teşhis
        result: {
          feasible: result.feasible,
          statusName: result.statusName,
          totalCost: result.totalCost,
          dmi: result.dmi,
          items: result.items,
          composition: result.composition,
          diagnostics: result.diagnostics,
          milkFever: result.milkFever ? { score: result.milkFever.score, riskLevel: result.milkFever.riskLevel } : null,
          requirements: { nel: result.requirements?.nel, mp: result.requirements?.mp },
        },
        savedAt: new Date().toISOString(),
      };
      await rationAdd(ration);
      showToast(t('history.saved', { name }), 'success');
    } catch (err) {
      console.error('Kayıt hatası:', err);
      showToast(t('history.save_err') + err.message, 'error');
    }
  });

  // Geçmiş rasyonları göster
  container.querySelector('#btn-history')?.addEventListener('click', async () => {
    _lockZoom();
    const modal = container.querySelector('#history-modal');
    const content = container.querySelector('#history-content');
    if (!modal || !content) return;
    modal.style.display = 'flex';
    content.innerHTML = `<p class="text-muted">${t('history.loading')}</p>`;
    try {
      const rations = await rationGetAll();
      content.innerHTML = renderHistoryContent(rations, result);
      bindHistoryHandlers(content, result);   // sil + detay aç/kapa (denetim #15)
    } catch (err) {
      content.innerHTML = `<div class="warn-box">${t('history.load_err')}${err.message}</div>`;
    }
  });

  container.querySelector('#btn-close-history')?.addEventListener('click', () => {
    _restoreZoom();
    const modal = container.querySelector('#history-modal');
    if (modal) modal.style.display = 'none';
  });

  // Modal dışına tıklanarak kapatma
  const historyModal = container.querySelector('#history-modal');
  if (historyModal) {
    historyModal.addEventListener('mousedown', (e) => {
      if (e.target === historyModal) {
        _restoreZoom();
        historyModal.style.display = 'none';
      }
    });
  }
}

/**
 * Denetim #3: prompt() yerine uygulama-içi isim modalı (kurulu PWA / bazı mobil
 * tarayıcılarda window.prompt engellenip kayıt sessizce başarısız oluyordu).
 * @returns {Promise<string|null>} girilen ad (boş/iptal → null)
 */
function promptModal(title, defaultValue = '') {
  _lockZoom();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:2000; display:flex; align-items:center; justify-content:center; padding:1rem';
    overlay.innerHTML = `
      <div class="card" style="max-width:420px; width:100%; margin:0">
        <div class="card-title" style="margin-bottom:0.6rem">${escHtml(title)}</div>
        <input type="text" id="__prompt-input" value="${escHtml(defaultValue)}"
          style="width:100%; padding:0.55rem 0.65rem; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:16px; box-sizing:border-box" />
        <div class="flex gap-1" style="justify-content:flex-end; margin-top:0.75rem">
          <button class="btn btn-secondary btn-sm" id="__prompt-cancel">${t('history.modal_cancel')}</button>
          <button class="btn btn-primary btn-sm" id="__prompt-ok">${t('history.modal_save')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#__prompt-input');
    const done = (val) => { overlay.remove(); _restoreZoom(); resolve(val); };
    setTimeout(() => { input.focus(); input.select(); }, 30);
    overlay.querySelector('#__prompt-ok').addEventListener('click', () => done(input.value.trim() || null));
    overlay.querySelector('#__prompt-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) done(null); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      else if (e.key === 'Escape') done(null);
    });
  });
}

/** Geçmiş tablosu olay bağlama: sil + Detay aç/kapa (yeniden kullanılabilir; reload sonrası tekrar bağlanır). */
function bindHistoryHandlers(content, result) {
  content.querySelectorAll('.btn-del-ration').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('history.confirm_del'))) return;
      await rationDelete(btn.dataset.id);   // FAZ 16.10: UUID string
      showToast(t('history.deleted'), 'success');
      const updated = await rationGetAll();
      content.innerHTML = renderHistoryContent(updated, result);
      bindHistoryHandlers(content, result);
    });
  });
  // denetim #15: Detay satırını aç/kapat (tam kompozisyon + teşhis)
  content.querySelectorAll('.btn-detail-ration').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = content.querySelector(`.hist-detail-row[data-idx="${btn.dataset.idx}"]`);
      if (row) row.style.display = (row.style.display === 'none') ? '' : 'none';
    });
  });
}

function renderHistoryContent(rations, currentResult) {
  if (!rations || rations.length === 0) {
    return `<div class="empty-state"><p>${t('history.empty')}</p></div>`;
  }

  // Tarihe göre sırala (yeniden eskiye)
  const sorted = [...rations].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

  // Mevcut rasyonla karşılaştırma için temel metrikler
  const cur = currentResult ? {
    cost: currentResult.totalCost,
    dmi: currentResult.dmi.achieved_kg,
    nel: currentResult.composition.nel_mcal,
    cp:  currentResult.composition.cp_pct,
    ndf: currentResult.composition.ndf_pct,
  } : null;

  return `
    <div class="info-box box-info" style="margin-bottom:1rem">
      ${t('history.count_info', { n: sorted.length })}
    </div>
    <table class="diag-table" style="font-size:0.85rem">
      <thead>
        <tr>
          <th>${t('history.col_date')}</th>
          <th>${t('history.col_name')}</th>
          <th class="num">${t('history.col_cost')}</th>
          <th class="num">${t('history.col_dmi')}</th>
          <th class="num">${t('history.col_nel')}</th>
          <th class="num">${t('history.col_cp')}</th>
          <th class="num">${t('history.col_ndf')}</th>
          <th>${t('history.col_action')}</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map((r, i) => {
          const d = r.savedAt ? new Date(r.savedAt).toLocaleString() : '—';
          const c = r.result?.composition || {};
          const cost = r.result?.totalCost ?? 0;
          const dmi = r.result?.dmi?.achieved_kg ?? 0;
          const delta = (val, curVal) => {
            if (!cur || curVal == null) return '';
            const diff = val - curVal;
            if (Math.abs(diff) < 0.05 * curVal) return '<span class="text-muted">≈</span>';
            return diff > 0
              ? `<span style="color:var(--danger)" title="${t('history.more_than', { v: diff.toFixed(1) })}"><i class="ti ti-trending-up"></i></span>`
              : `<span style="color:var(--primary)" title="${t('history.less_than', { v: Math.abs(diff).toFixed(1) })}"><i class="ti ti-trending-down"></i></span>`;
          };
          const items = r.result?.items || [];
          const feedsLine = items.length
            ? items.map(it => `${escHtml(feedDisplayName(it))} <span class="text-muted">(${(it.dmKg ?? 0).toFixed(1)} kg)</span>`).join(', ')
            : '—';
          return `<tr>
            <td>${d}</td>
            <td><b>${escHtml(r.name || '—')}</b></td>
            <td class="num">${cost.toFixed(2)} ${delta(cost, cur?.cost)}</td>
            <td class="num">${dmi.toFixed(1)} ${delta(dmi, cur?.dmi)}</td>
            <td class="num">${(c.nel_mcal || 0).toFixed(1)} ${delta(c.nel_mcal, cur?.nel)}</td>
            <td class="num">${(c.cp_pct || 0).toFixed(1)} ${delta(c.cp_pct, cur?.cp)}</td>
            <td class="num">${(c.ndf_pct || 0).toFixed(1)} ${delta(c.ndf_pct, cur?.ndf)}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-secondary btn-detail-ration" data-idx="${i}" title="${t('history.detail')}"><i class="ti ti-eye"></i></button>
              <button class="btn btn-sm btn-danger btn-del-ration" data-id="${r.id}" aria-label="Sil"><i class="ti ti-trash"></i></button>
            </td>
          </tr>
          <tr class="hist-detail-row" data-idx="${i}" style="display:none">
            <td colspan="8" style="background:var(--bg)">
              <div class="text-small" style="margin:0.3rem 0 0.5rem"><b>${t('history.detail_feeds')}:</b> ${feedsLine}</div>
              <div class="results-grid">
                <div>
                  <div class="section-title">${t('results.card_composition')}</div>
                  ${r.result?.composition ? renderCompositionTable(r.result.composition) : `<p class="text-muted">${t('history.no_detail')}</p>`}
                </div>
                <div>
                  <div class="section-title">${t('results.card_diagnostics')}</div>
                  ${r.result?.diagnostics?.length ? renderDiagnostics(r.result.diagnostics) : `<p class="text-muted">${t('history.no_detail')}</p>`}
                </div>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="text-small text-muted mt-1">
      ${t('history.footer')}
    </div>
  `;
}
