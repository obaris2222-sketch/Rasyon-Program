/**
 * Çiftlik Seçici (FAZ 16.11 — danışman/çoklu-çiftlik).
 *
 * Header'daki "🏠 <aktif çiftlik> ▾" butonu → modal: çiftlik listesi (tıkla=geçiş),
 * yeni çiftlik, yeniden adlandır, sil (kademeli — çiftlik + verisi).
 *
 * Çiftlik geçişi tüm veri okumalarını yeni çiftliğe yeniden kapsamlar (db.js
 * setActiveFarmId) ve aktif sekmeyi tazeler (onSwitch).
 */

import {
  farmGetAll, farmGetById, farmAdd, farmPut, farmDeleteCascade,
  setActiveFarmId, getActiveFarmId,
} from '../../data/db.js';
import { saveSettings } from '../../data/settings.js';
import { showToast, escHtml } from '../utils.js';
import { t } from '../i18n.js';

let _onSwitch = () => {};

/** Header çiftlik butonunu bağla + ilk adı yaz. */
export function initFarmSwitcher(onSwitch) {
  _onSwitch = onSwitch || (() => {});
  document.getElementById('farm-btn')?.addEventListener('click', () => openFarmModal());
  refreshFarmButton();
}

/** Header butonundaki aktif çiftlik adını günceller. */
export async function refreshFarmButton() {
  const btn = document.getElementById('farm-btn');
  if (!btn) return;
  const id = getActiveFarmId();
  let name = '';
  if (id) { const f = await farmGetById(id); name = f?.name || ''; }
  const label = btn.querySelector('.farm-btn-label');
  if (label) label.textContent = name || t('farm.no_farm');
  btn.title = `${t('farm.title')}${name ? ' — ' + name : ''}`;
}

async function switchFarm(farmId) {
  const f = await farmGetById(farmId);
  if (!f) return;
  setActiveFarmId(farmId);
  saveSettings({ activeFarmId: farmId }, { silent: true });
  await refreshFarmButton();
  closeFarmModal();
  showToast(t('farm.switched', { name: f.name }), 'info');
  _onSwitch();
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function closeFarmModal() {
  document.getElementById('farm-modal-overlay')?.remove();
  document.removeEventListener('keydown', _esc);
}
function _esc(e) { if (e.key === 'Escape') closeFarmModal(); }

export async function openFarmModal() {
  closeFarmModal();
  const overlay = document.createElement('div');
  overlay.className = 'feed-modal-overlay';
  overlay.id = 'farm-modal-overlay';
  overlay.innerHTML = `
    <div class="feed-modal" style="max-width:480px" role="dialog" aria-modal="true" aria-label="${t('farm.aria')}">
      <div class="feed-modal-header">
        <h2><i class="ti ti-building-warehouse"></i> ${t('farm.title')}</h2>
        <button class="modal-close-btn" type="button" aria-label="${t('farm.close')}"><i class="ti ti-x"></i></button>
      </div>
      <div class="feed-modal-body" id="farm-modal-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close-btn').addEventListener('click', closeFarmModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFarmModal(); });
  document.addEventListener('keydown', _esc);
  await renderFarmList();
}

async function renderFarmList() {
  const body = document.getElementById('farm-modal-body');
  if (!body) return;
  const farms = await farmGetAll();
  const activeId = getActiveFarmId();
  body.innerHTML = `
    <div class="info-box">${t('farm.hint')}</div>
    <div class="farm-list">
      ${farms.map(f => `
        <div class="farm-row ${f.id === activeId ? 'farm-active' : ''}">
          <button class="farm-select" data-id="${escHtml(f.id)}">
            ${f.id === activeId ? '<i class="ti ti-check" style="color:var(--success)"></i> ' : ''}<b>${escHtml(f.name)}</b>
          </button>
          <button class="btn btn-sm btn-secondary farm-rename" data-id="${escHtml(f.id)}" title="${t('farm.rename')}" aria-label="${t('farm.rename')}"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-danger farm-del" data-id="${escHtml(f.id)}" title="${t('farm.delete')}" aria-label="${t('farm.delete')}" ${farms.length <= 1 ? 'disabled' : ''}><i class="ti ti-trash"></i></button>
        </div>
      `).join('')}
    </div>
    <button class="btn btn-primary mt-1" id="farm-new"><i class="ti ti-plus"></i> ${t('farm.new')}</button>
  `;
  body.querySelectorAll('.farm-select').forEach(b => b.addEventListener('click', () => switchFarm(b.dataset.id)));
  body.querySelectorAll('.farm-rename').forEach(b => b.addEventListener('click', () => renderFarmEdit(b.dataset.id)));
  body.querySelectorAll('.farm-del').forEach(b => b.addEventListener('click', () => deleteFarm(b.dataset.id)));
  body.querySelector('#farm-new').addEventListener('click', createFarm);
}

async function createFarm() {
  const name = prompt(t('farm.new_prompt'));
  if (!name || !name.trim()) return;
  const f = await farmAdd({ name: name.trim() });
  showToast(t('farm.created', { name: f.name }), 'success');
  await renderFarmEdit(f.id);   // oluşturunca düzenleme formuna git (adres/danışman/bilim sistemi)
}

/** Çiftlik düzenleme formu (FAZ 16.11/2.3 — ad/adres/danışman/bilim sistemi). */
async function renderFarmEdit(id) {
  const body = document.getElementById('farm-modal-body');
  const f = await farmGetById(id);
  if (!body || !f) return;
  body.innerHTML = `
    <button class="btn-link" id="farm-back" type="button"><i class="ti ti-arrow-left"></i> ${t('farm.back')}</button>
    <div class="form-group"><label>${t('farm.name_label')}</label>
      <input id="fe-name" type="text" maxlength="60" value="${escHtml(f.name || '')}" /></div>
    <div class="form-group"><label>${t('farm.address')}</label>
      <input id="fe-address" type="text" maxlength="160" value="${escHtml(f.address || '')}" /></div>
    <div class="form-group"><label>${t('farm.advisor')}</label>
      <input id="fe-advisor" type="text" maxlength="80" value="${escHtml(f.advisor || '')}" /></div>
    <div class="form-group"><label>${t('farm.science')}</label>
      <select id="fe-science">
        <option value="">${t('farm.science_default')}</option>
        <option value="NASEM2021" ${f.science === 'NASEM2021' ? 'selected' : ''}>NASEM 2021</option>
        <option value="NRC2001" ${f.science === 'NRC2001' ? 'selected' : ''}>NRC 2001</option>
        <option value="INRA2018" ${f.science === 'INRA2018' ? 'selected' : ''}>INRA 2018</option>
      </select>
      <span class="hint">${t('farm.science_hint')}</span></div>
    <button class="btn btn-primary" id="fe-save" type="button">${t('farm.save')}</button>
  `;
  body.querySelector('#farm-back').addEventListener('click', renderFarmList);
  body.querySelector('#fe-save').addEventListener('click', async () => {
    const name = body.querySelector('#fe-name').value.trim();
    if (!name) { showToast(t('farm.name_req'), 'warn'); return; }
    await farmPut({
      ...f, name,
      address: body.querySelector('#fe-address').value.trim(),
      advisor: body.querySelector('#fe-advisor').value.trim(),
      science: body.querySelector('#fe-science').value,
    });
    showToast(t('farm.saved'), 'success');
    await refreshFarmButton();
    await renderFarmList();
  });
}

async function deleteFarm(id) {
  const farms = await farmGetAll();
  if (farms.length <= 1) { showToast(t('farm.cant_delete_last'), 'warn'); return; }
  const f = await farmGetById(id);
  if (!f) return;
  if (!confirm(t('farm.delete_confirm', { name: f.name }))) return;
  await farmDeleteCascade(id);
  // Aktif çiftlik silindiyse kalan ilk çiftliğe geç
  if (getActiveFarmId() === id) {
    const remaining = (await farmGetAll())[0];
    if (remaining) { setActiveFarmId(remaining.id); saveSettings({ activeFarmId: remaining.id }, { silent: true }); }
  }
  showToast(t('farm.deleted'), 'info');
  await refreshFarmButton();
  await renderFarmList();
  _onSwitch();
}
