/**
 * Hayvan Profili Formu
 */

import { calcAllRequirements } from '../../core/animalRequirements.js';
import { calcTHI, classifyTHI, heatStressRecommendations } from '../../core/heatStress.js';
import { interpretDCAD, estimateUrinePH } from '../../core/dcad.js';
import { animalProfileGetAll, animalProfilePut, animalProfileDelete, herdGroupGetAll, herdGroupPut, herdGroupDelete } from '../../data/db.js';
import { getSettings } from '../../data/settings.js';
import { fetchCurrentWeather } from '../../core/weatherApi.js';
import { showToast, escHtml } from '../utils.js';
import { validateFormElement, attachLiveValidation, summarizeErrors } from '../validation.js';
import { t } from '../i18n.js';

// FAZ 15.9 — Hayvan profili formu alan eşlemesi (input name → FIELD_RULES anahtarı)
const ANIMAL_FIELD_BINDINGS = [
  { name: 'bw', rule: 'bw' },
  { name: 'milkYield', rule: 'milkYield' },
  { name: 'milkFat', rule: 'milkFat' },
  { name: 'milkProtein', rule: 'milkProtein' },
  { name: 'milkLactose', rule: 'milkLactose' },
  { name: 'targetADG', rule: 'targetADG' },
  { name: 'dim', rule: 'dim' },
  { name: 'bcs', rule: 'bcs' },
  { name: 'ambientTemp', rule: 'ambientTemp' },
  { name: 'humidity', rule: 'humidity' },
  { name: 'urinePH', rule: 'urinePH' },
  { name: 'pregnancyMonth', rule: 'pregnancyMonth' },
  { name: 'parity', rule: 'parity' },
];

// ─── Laktasyon evresi DIM aralıkları ────────────────────────────────────────
const DIM_RANGES = {
  early:    { min: 0,   max: 100, default: 45 },
  mid:      { min: 101, max: 200, default: 150 },
  late:     { min: 201, max: 500, default: 250 },
  far_off:  { min: 1,   max: 60,  default: 30 },
  close_up: { min: 1,   max: 21,  default: 14 },
};

export async function renderAnimalForm(container, state) {
  const [profiles, groups] = await Promise.all([
    animalProfileGetAll().catch(() => []),
    herdGroupGetAll().catch(() => []),
  ]);

  container.innerHTML = `
    <!-- Profil & Sürü Yönetimi Kartı -->
    <div class="card">
      <div class="card-title">${t('animal.profile_mgmt')}</div>
      <div class="form-grid">
        <div class="form-group">
          <label>${t('animal.load_profile')}</label>
          <select id="profile-select">
            <option value="">${t('animal.new_profile_opt')}</option>
            ${profiles.map(p => `<option value="${escHtml(p.id)}" ${state.animal._profileId === p.id ? 'selected' : ''}>
              ${escHtml(p.name)} ${p.groupId ? `[${escHtml(groupName(p.groupId, groups))}]` : ''}
            </option>`).join('')}
          </select>
          <span class="hint">${t('animal.saved_profiles', { n: profiles.length })}</span>
        </div>
        <div class="form-group">
          <label>${t('animal.profile_name')}</label>
          <input type="text" id="profile-name" value="${escHtml(state.animal.name || '')}" placeholder="${t('animal.profile_name_ph')}" />
        </div>
        <div class="form-group">
          <label>${t('animal.herd_group')}</label>
          <select id="profile-group">
            <option value="">${t('animal.no_group')}</option>
            ${groups.map(g => `<option value="${escHtml(g.id)}" ${state.animal.groupId === g.id ? 'selected' : ''}>
              ${escHtml(g.name)} (${g.animalCount || 0} ${t('dashboard.head_unit')})
            </option>`).join('')}
          </select>
        </div>
      </div>
      <div class="btn-row mt-1">
        <button type="button" class="btn btn-primary btn-sm" id="profile-save"><i class="ti ti-device-floppy"></i> ${t('animal.save_profile')}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="profile-new"><i class="ti ti-plus"></i> ${t('animal.new')}</button>
        <button type="button" class="btn btn-danger btn-sm" id="profile-delete" ${state.animal._profileId ? '' : 'disabled'}><i class="ti ti-trash"></i> ${t('animal.delete')}</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary btn-sm" id="herd-manage"><i class="ti ti-users"></i> ${t('animal.manage_herds')}</button>
      </div>
      <div id="herd-manager" style="display:none; margin-top:1rem"></div>
    </div>

    <div class="card mt-2">
      <div class="card-title">${t('animal.title')}</div>
      <form id="animal-form" novalidate>
        <div class="form-subhead"><i class="ti ti-droplet"></i> ${t('animal.sec_basic')}</div>
        <div class="form-grid">
          <div class="form-group">
            <label>${t('animal.bw')}</label>
            <input type="number" name="bw" min="50" max="1500" step="5" value="${state.animal.bw}" required />
            <span class="hint">${t('animal.bw_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('animal.milk_yield')}</label>
            <input type="number" name="milkYield" min="0" max="150" step="0.5" value="${state.animal.milkYield}" required />
          </div>
          <div class="form-group">
            <label>${t('animal.milk_fat')}</label>
            <input type="number" name="milkFat" min="0" max="15" step="0.05" value="${state.animal.milkFat}" required />
          </div>
          <div class="form-group">
            <label>${t('animal.milk_protein')}</label>
            <input type="number" name="milkProtein" min="0" max="10" step="0.05" value="${state.animal.milkProtein}" required />
          </div>
          <div class="form-group">
            <label>${t('animal.milk_lactose')}</label>
            <input type="number" name="milkLactose" min="0" max="10" step="0.05" value="${state.animal.milkLactose ?? ''}" placeholder="${t('animal.lactose_ph')}" />
            <span class="hint">${t('animal.lactose_hint')}</span>
          </div>
        </div>

        <div class="form-subhead"><i class="ti ti-clipboard-list"></i> ${t('animal.sec_animal')}</div>
        <div class="form-grid">
          <div class="form-group full-width">
            <label>${t('animal.lactation_stage')}</label>
            <select name="lactationStage">
              <option value="early"      ${(state.animal.lactationStage ?? 'early') === 'early' ? 'selected' : ''}>${t('animal.stage_early_opt')}</option>
              <option value="mid"        ${state.animal.lactationStage === 'mid' ? 'selected' : ''}>${t('animal.stage_mid_opt')}</option>
              <option value="late"       ${state.animal.lactationStage === 'late' ? 'selected' : ''}>${t('animal.stage_late_opt')}</option>
              <option value="far_off"    ${state.animal.lactationStage === 'far_off' ? 'selected' : ''}>${t('animal.stage_faroff_opt')}</option>
              <option value="close_up"   ${state.animal.lactationStage === 'close_up' ? 'selected' : ''}>${t('animal.stage_closeup_opt')}</option>
            </select>
            <span class="hint" id="stage-hint">${t('animal.stage_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('animal.breed')}</label>
            <select name="breed">
              <option value="Holstein"     ${(state.animal.breed ?? 'Holstein') === 'Holstein' ? 'selected' : ''}>${t('animal.breed_holstein')}</option>
              <option value="Jersey"       ${state.animal.breed === 'Jersey' ? 'selected' : ''}>Jersey</option>
              <option value="Simental"     ${state.animal.breed === 'Simental' ? 'selected' : ''}>Simental</option>
              <option value="Montofon"     ${state.animal.breed === 'Montofon' ? 'selected' : ''}>Montofon (Braunvieh)</option>
              <option value="BrownSwiss"   ${state.animal.breed === 'BrownSwiss' ? 'selected' : ''}>Brown Swiss</option>
              <option value="Other"        ${state.animal.breed === 'Other' ? 'selected' : ''}>${t('animal.breed_other')}</option>
            </select>
            <span class="hint">${t('animal.breed_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('animal.parity')}</label>
            <select name="parity">
              <option value="1" ${state.animal.parity === 1 ? 'selected' : ''}>${t('animal.parity_1')}</option>
              <option value="2" ${state.animal.parity === 2 ? 'selected' : ''}>${t('animal.parity_2')}</option>
              <option value="3" ${state.animal.parity >= 3 ? 'selected' : ''}>${t('animal.parity_3')}</option>
            </select>
            <span class="hint">${t('animal.parity_hint')}</span>
          </div>
          <div class="form-group" id="adg-group" style="${state.animal.parity === 1 ? '' : 'display:none'}">
            <label>${t('animal.target_adg')}</label>
            <input type="number" name="targetADG" min="0" max="3" step="0.05" value="${state.animal.targetADG ?? ''}" placeholder="${t('animal.adg_ph')}" />
            <span class="hint">${t('animal.adg_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('animal.dim')}</label>
            <input type="number" name="dim" min="${DIM_RANGES[state.animal.lactationStage]?.min ?? 1}" max="${DIM_RANGES[state.animal.lactationStage]?.max ?? 500}" step="1" value="${state.animal.dim}" required />
            <span class="hint" id="dim-hint">${t('animal.dim_hint', { min: DIM_RANGES[state.animal.lactationStage]?.min ?? 1, max: DIM_RANGES[state.animal.lactationStage]?.max ?? 500 })}</span>
          </div>
          <div class="form-group">
            <label>${t('animal.bcs')}</label>
            <input type="number" name="bcs" min="1" max="5" step="0.25" value="${state.animal.bcs}" required />
            <span class="hint">${t('animal.bcs_hint')}</span>
          </div>
        </div>

        <div class="form-subhead"><i class="ti ti-temperature"></i> ${t('animal.sec_env')}</div>
        <div class="form-grid">
          <div class="form-group full-width">
            <label>${t('animal.thi')}</label>
            <div class="thi-row">
              <div class="thi-field">
                <span class="sub-label">${t('animal.ambient_temp')}</span>
                <input type="number" name="ambientTemp" min="-40" max="60" step="0.5" value="${state.animal.ambientTemp ?? ''}" placeholder="${t('animal.temp_ph')}" />
              </div>
              <div class="thi-field">
                <span class="sub-label">${t('animal.humidity')}</span>
                <input type="number" name="humidity" min="0" max="100" step="1" value="${state.animal.humidity ?? ''}" placeholder="${t('animal.humidity_ph')}" />
              </div>
              <div id="thi-display" class="thi-box" style="display:${(state.animal.ambientTemp != null && state.animal.humidity != null) ? 'flex' : 'none'}">
                <div id="thi-value" class="thi-value">—</div>
                <span class="hint" id="thi-status-hint">THI</span>
              </div>
              <button type="button" id="btn-fetch-weather" class="btn btn-sm btn-secondary thi-weather-btn" title="${t('animal.fetch_weather_title')}"><i class="ti ti-cloud-download"></i> ${t('animal.fetch_weather')}</button>
            </div>
            <span class="hint">${t('animal.thi_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('animal.urine_ph')}</label>
            <input type="number" name="urinePH" min="0" max="14" step="0.1" value="${state.animal.urinePH ?? ''}" placeholder="${t('animal.urine_ph_ph')}" />
            <span class="hint">${t('animal.urine_ph_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('animal.daily_walk')}</label>
            <input type="number" name="dailyWalkKm" min="0" max="50" step="0.1" value="${state.animal.dailyWalkKm ?? 0}" placeholder="0" />
            <span class="hint">${t('animal.daily_walk_hint')}</span>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" name="pregnant" id="chk-pregnant" ${state.animal.pregnant ? 'checked' : ''} />
            <label for="chk-pregnant">${t('animal.pregnant')}</label>
          </div>
          <div class="form-group" id="pregnancy-month-group" style="display:${state.animal.pregnant ? 'flex' : 'none'}">
            <label>${t('animal.pregnancy_month')}</label>
            <input type="number" name="pregnancyMonth" min="1" max="12" step="1" value="${state.animal.pregnancyMonth || 5}" />
          </div>
        </div>

        <hr class="divider" />

        <div id="animal-summary"></div>

        <div class="mt-2">
          <button type="button" id="go-to-ration" class="btn btn-large">
            <i class="ti ti-arrow-right"></i> ${t('animal.go_to_ration')}
          </button>
        </div>
      </form>
    </div>

    <div class="card mt-2" id="animal-info-card">
      <div class="card-title">${t('animal.calculated_values')}</div>
      <div id="animal-calc"></div>
    </div>
  `;

  const form = container.querySelector('#animal-form');
  const pregnantChk = form.querySelector('[name="pregnant"]');
  const pregnancyGroup = container.querySelector('#pregnancy-month-group');

  pregnantChk.addEventListener('change', () => {
    pregnancyGroup.style.display = pregnantChk.checked ? 'flex' : 'none';
  });

  // Laktasyon evresi değişince DIM aralığını güncelle + süt alanlarını kilitle (FAZ 12 Madde 3)
  const stageSelect = form.querySelector('[name="lactationStage"]');
  const dimInput = form.querySelector('[name="dim"]');
  stageSelect.addEventListener('change', () => {
    const stage = stageSelect.value;
    const range = DIM_RANGES[stage] || { min: 1, max: 500 };
    dimInput.min = range.min;
    dimInput.max = range.max;
    const currentDim = +dimInput.value;
    if (currentDim < range.min || currentDim > range.max) {
      dimInput.value = range.default;
    }
    const dimHint = container.querySelector('#dim-hint');
    if (dimHint) dimHint.textContent = t('animal.dim_hint', { min: range.min, max: range.max });
    applyStageLocking(form, container, state, stage);
    // Kullanıcı manuel değiştirdi → state güncelle ve calc yenile
    Object.assign(state.animal, readForm(form));
    updateCalc(form, state, container);
  });
  // İlk render'da da uygula
  applyStageLocking(form, container, state, state.animal.lactationStage || 'early');

  // FAZ 13.10: Parite 1 (primipar) → "Hedef ADG" alanını göster/gizle
  const paritySelect = form.querySelector('[name="parity"]');
  const adgGroup = container.querySelector('#adg-group');
  const toggleAdg = () => {
    if (adgGroup) adgGroup.style.display = paritySelect?.value === '1' ? '' : 'none';
  };
  paritySelect?.addEventListener('change', toggleAdg);
  toggleAdg();

  // Sıcaklık veya nem değişince THI'yi otomatik hesapla ve göster
  const tempInput = form.querySelector('[name="ambientTemp"]');
  const humInput  = form.querySelector('[name="humidity"]');
  const thiDisplay = container.querySelector('#thi-display');
  const thiValEl   = container.querySelector('#thi-value');
  const thiHintEl  = container.querySelector('#thi-status-hint');
  const updateTHIDisplay = () => {
    const temp = tempInput.value !== '' ? +tempInput.value : null;
    const hum  = humInput.value !== '' ? +humInput.value : null;
    if (temp !== null && hum !== null && Number.isFinite(temp) && Number.isFinite(hum)) {
      const thi = calcTHI(temp, hum);
      const thiClass = classifyTHI(thi);
      if (thiDisplay) thiDisplay.style.display = 'flex';
      if (thiValEl) {
        thiValEl.textContent = `THI: ${thi.toFixed(1)}`;
        thiValEl.style.color = thiClass.color === 'green' ? 'var(--primary)' : thiClass.color;
      }
      if (thiHintEl) thiHintEl.textContent = thiClass.label;
    } else {
      if (thiDisplay) thiDisplay.style.display = 'none';
    }
  };
  tempInput.addEventListener('input', updateTHIDisplay);
  humInput.addEventListener('input', updateTHIDisplay);
  updateTHIDisplay();

  // FAZ 16.9: Hava durumu API entegrasyonu
  const btnWeather = container.querySelector('#btn-fetch-weather');
  if (btnWeather) {
    btnWeather.addEventListener('click', async () => {
      const s = getSettings();
      if (s.farm.latitude == null || s.farm.longitude == null) {
        showToast(t('acalc.weather_no_loc'), 'warn');
        return;
      }
      btnWeather.innerHTML = '<i class="ti ti-loader-2 ti-spin"></i>';
      btnWeather.disabled = true;
      try {
        const w = await fetchCurrentWeather(s.farm.latitude, s.farm.longitude);
        tempInput.value = w.temperature.toFixed(1);
        humInput.value = w.humidity.toFixed(0);
        updateTHIDisplay();
        Object.assign(state.animal, readForm(form));
        updateCalc(form, state, container);
        showToast(t('acalc.weather_done'), 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btnWeather.innerHTML = `<i class="ti ti-cloud-download"></i> ${t('animal.fetch_weather')}`;
        btnWeather.disabled = false;
      }
    });
  }

  form.addEventListener('change', () => {
    Object.assign(state.animal, readForm(form));
    updateCalc(form, state, container);
  });

  container.querySelector('#go-to-ration').addEventListener('click', () => {
    const result = validateFormElement(form, ANIMAL_FIELD_BINDINGS);
    if (!result.ok) {
      showToast(summarizeErrors(result.errors), 'warn');
      return;
    }
    Object.assign(state.animal, readForm(form));
    document.querySelector('[data-tab="ration"]')?.click();
  });

  // FAZ 15.9: Canlı form validasyonu — kullanıcı alandan çıkınca anlık geri bildirim
  attachLiveValidation(form, ANIMAL_FIELD_BINDINGS);

  // Profil & Sürü yönetimi event handler'ları
  setupProfileHandlers(container, state, profiles, groups);

  updateCalc(form, state, container);
}

// ─── Profil & Sürü Yönetimi ──────────────────────────────────────────────────

function groupName(id, groups) {
  return groups.find(g => g.id === id)?.name ?? id;
}

function setupProfileHandlers(container, state, profiles, groups) {
  const selectEl = container.querySelector('#profile-select');
  const nameEl   = container.querySelector('#profile-name');
  const groupEl  = container.querySelector('#profile-group');

  // Profil yükle
  selectEl.addEventListener('change', () => {
    const id = selectEl.value;
    if (!id) return;
    const p = profiles.find(x => x.id === id);
    if (!p) return;
    // Sadece tanımlı animal alanlarını state'e kopyala
    const animalKeys = ['bw','milkYield','milkFat','milkProtein','milkLactose','parity','dim','bcs','pregnant','pregnancyMonth','gestDays','thi','ambientTemp','humidity','urinePH','dailyWalkKm','breed','name','groupId','lactationStage','targetADG'];
    for (const k of animalKeys) {
      if (p[k] !== undefined) state.animal[k] = p[k];
    }
    state.animal._profileId = p.id;
    showToast(t('acalc.profile_loaded', { name: p.name }), 'success');
    renderAnimalForm(container, state); // tam re-render
  });

  // Profil kaydet
  container.querySelector('#profile-save').addEventListener('click', async () => {
    const form = container.querySelector('#animal-form');
    const validation = validateFormElement(form, ANIMAL_FIELD_BINDINGS);
    if (!validation.ok) {
      showToast(summarizeErrors(validation.errors), 'warn');
      return;
    }
    Object.assign(state.animal, readForm(form));
    const name = nameEl.value.trim();
    if (!name) { showToast(t('acalc.profile_name_req'), 'warn'); return; }
    const groupId = groupEl.value || '';
    // FAZ 16.10: Yeni profil → db.js küresel UUID üretir (cihazlar arası çakışma yok);
    // mevcut profil → _profileId korunur. (Eski `profile_${Date.now()}` çakışabilirdi.)
    const profile = { ...state.animal, name, groupId };
    delete profile._profileId;   // UI-içi alan, DB kaydına yazma
    if (state.animal._profileId) profile.id = state.animal._profileId;
    try {
      const savedId = await animalProfilePut(profile);
      state.animal._profileId = savedId;
      state.animal.name = name;
      state.animal.groupId = groupId;
      showToast(t('acalc.profile_saved', { name }), 'success');
      renderAnimalForm(container, state);
    } catch (err) {
      showToast(t('acalc.save_err') + err.message, 'error');
    }
  });

  // Yeni profil
  container.querySelector('#profile-new').addEventListener('click', () => {
    delete state.animal._profileId;
    state.animal.name = '';
    state.animal.groupId = '';
    showToast(t('acalc.profile_new'), 'info');
    renderAnimalForm(container, state);
  });

  // Profil sil
  container.querySelector('#profile-delete').addEventListener('click', async () => {
    if (!state.animal._profileId) return;
    if (!confirm(t('acalc.confirm_del_profile'))) return;
    try {
      await animalProfileDelete(state.animal._profileId);
      delete state.animal._profileId;
      state.animal.name = '';
      showToast(t('acalc.profile_deleted'), 'success');
      renderAnimalForm(container, state);
    } catch (err) {
      showToast(t('acalc.del_err') + err.message, 'error');
    }
  });

  // Sürü grup yönetimi panelini aç/kapat
  const herdMgr = container.querySelector('#herd-manager');
  container.querySelector('#herd-manage').addEventListener('click', () => {
    if (herdMgr.style.display === 'none') {
      herdMgr.style.display = 'block';
      renderHerdManager(herdMgr, container, state, groups);
    } else {
      herdMgr.style.display = 'none';
    }
  });
}

function renderHerdManager(panel, parentContainer, state, groups) {
  panel.innerHTML = `
    <hr class="divider" />
    <div class="section-title">${t('acalc.herd_groups')}</div>
    <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table">
      <thead>
        <tr><th>${t('acalc.g_name')}</th><th>${t('acalc.g_desc')}</th><th class="num">${t('acalc.g_animals')}</th><th>${t('acalc.g_action')}</th></tr>
      </thead>
      <tbody>
        ${groups.length === 0
          ? `<tr><td colspan="4" class="text-muted" style="text-align:center">${t('acalc.no_groups')}</td></tr>`
          : groups.map(g => `
              <tr data-id="${escHtml(g.id)}">
                <td><b>${escHtml(g.name)}</b></td>
                <td>${escHtml(g.description || '')}</td>
                <td class="num">${g.animalCount || 0}</td>
                <td><button class="btn btn-sm btn-danger del-group" data-id="${escHtml(g.id)}" aria-label="Sil"><i class="ti ti-trash"></i></button></td>
              </tr>`).join('')}
      </tbody>
    </table>
</div>

    <div class="form-grid mt-2">
      <div class="form-group">
        <label>${t('acalc.new_group_name')}</label>
        <input type="text" id="new-group-name" placeholder="${t('acalc.new_group_ph')}" />
      </div>
      <div class="form-group">
        <label>${t('acalc.desc')}</label>
        <input type="text" id="new-group-desc" placeholder="${t('acalc.desc_ph')}" />
      </div>
      <div class="form-group">
        <label>${t('acalc.animal_count')}</label>
        <input type="number" id="new-group-count" min="0" step="1" value="0" />
      </div>
    </div>
    <button class="btn btn-primary btn-sm mt-1" id="add-group">${t('acalc.add_group')}</button>
  `;

  panel.querySelector('#add-group').addEventListener('click', async () => {
    const name = panel.querySelector('#new-group-name').value.trim();
    if (!name) { showToast(t('acalc.group_name_req'), 'error'); return; }
    const description = panel.querySelector('#new-group-desc').value.trim();
    const animalCount = +panel.querySelector('#new-group-count').value || 0;
    try {
      // FAZ 16.10: id verilmez → db.js küresel UUID üretir (cihazlar arası çakışma yok)
      await herdGroupPut({ name, description, animalCount });
      showToast(t('acalc.group_added', { name }), 'success');
      renderAnimalForm(parentContainer, state);
    } catch (err) {
      showToast(t('acalc.err') + err.message, 'error');
    }
  });

  panel.querySelectorAll('.del-group').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm(t('acalc.confirm_del_group'))) return;
      try {
        await herdGroupDelete(id);
        showToast(t('acalc.group_deleted'), 'success');
        renderAnimalForm(parentContainer, state);
      } catch (err) {
        showToast(t('acalc.err') + err.message, 'error');
      }
    });
  });
}

// ─── FAZ 12 Madde 3: Dönem-bazlı süt alanı kilitleme ─────────────────────────
const MILK_FIELDS = ['milkYield', 'milkFat', 'milkProtein', 'milkLactose'];
const _lockedCache = {}; // {fieldName: lastValue}

function applyStageLocking(form, container, state, stage) {
  const isDry = stage === 'far_off' || stage === 'close_up';
  const isCloseUp = stage === 'close_up';
  const isFarOff = stage === 'far_off';

  // ─── 1) Süt verim alanları kilitle/aç (laktasyon parametreleri) ─────────
  for (const name of MILK_FIELDS) {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) continue;
    if (isDry) {
      if (!input.readOnly && input.value !== '') _lockedCache[name] = input.value;
      input.value = 0;
      input.readOnly = true;
      input.tabIndex = -1;
      input.style.opacity = '0.5';
      input.style.pointerEvents = 'none';
      input.style.backgroundColor = 'var(--bg-light, #f5f5f5)';
      input.classList.remove('input-invalid');
      input.removeAttribute('data-error');
      input.removeAttribute('title');
    } else {
      if (input.readOnly && _lockedCache[name] !== undefined) input.value = _lockedCache[name];
      input.readOnly = false;
      input.removeAttribute('tabIndex');
      input.style.opacity = '';
      input.style.pointerEvents = '';
      input.style.backgroundColor = '';
    }
  }

  // ─── 2) DIM label & hint — dönem-bazlı dinamik ─────────────────────────
  const dimInput = form.querySelector('[name="dim"]');
  if (dimInput) {
    const dimGroup = dimInput.closest('.form-group');
    const dimLabel = dimGroup?.querySelector('label');
    const dimHint = dimGroup?.querySelector('#dim-hint');
    if (isCloseUp) {
      if (dimLabel) dimLabel.textContent = t('acalc.dim_closeup_label');
      if (dimHint) dimHint.textContent = t('acalc.dim_closeup_hint');
    } else if (isFarOff) {
      if (dimLabel) dimLabel.textContent = t('acalc.dim_faroff_label');
      if (dimHint) dimHint.textContent = t('acalc.dim_faroff_hint');
    } else {
      if (dimLabel) dimLabel.textContent = t('acalc.dim_lact_label');
      const r = DIM_RANGES[stage] || { min: 0, max: 500 };
      if (dimHint) dimHint.textContent = t('acalc.dim_lact_hint', { min: r.min, max: r.max });
    }
  }

  // ─── 3) BCS hint — dönem-bazlı hedef ───────────────────────────────────
  const bcsInput = form.querySelector('[name="bcs"]');
  if (bcsInput) {
    const bcsHint = bcsInput.closest('.form-group')?.querySelector('.hint');
    if (bcsHint) {
      if (isCloseUp) bcsHint.textContent = t('acalc.bcs_closeup');
      else if (isFarOff) bcsHint.textContent = t('acalc.bcs_faroff');
      else bcsHint.textContent = t('acalc.bcs_lact');
    }
  }

  // ─── 4) İdrar pH — sadece kuru dönemde göster ──────────────────────────
  const phInput = form.querySelector('[name="urinePH"]');
  if (phInput) {
    const phGroup = phInput.closest('.form-group');
    const phHint = phGroup?.querySelector('.hint');
    if (phGroup) phGroup.style.display = isDry ? '' : 'none';
    if (phHint) {
      if (isCloseUp) phHint.textContent = t('acalc.ph_closeup');
      else if (isFarOff) phHint.textContent = t('acalc.ph_faroff');
    }
  }

  // ─── 5) Gebelik — kuru dönemde otomatik checked + disabled ─────────────
  const pregChk = form.querySelector('[name="pregnant"]');
  const pregGroup = container.querySelector('#pregnancy-month-group');
  const pregMonth = form.querySelector('[name="pregnancyMonth"]');
  const pregLabel = pregChk?.closest('.form-group');
  if (pregChk && pregGroup && pregMonth) {
    if (isDry) {
      pregChk.checked = true;
      pregChk.disabled = true;
      if (pregLabel) {
        pregLabel.style.opacity = '0.75';
        pregLabel.title = t('acalc.preg_dry_title');
      }
      pregGroup.style.display = 'flex';
      const currentMonth = +pregMonth.value || 0;
      if (isCloseUp) {
        // Son 3 hafta → 9. ay
        if (currentMonth < 8) pregMonth.value = 9;
        pregMonth.min = 8;
        pregMonth.max = 9;
      } else { // far_off → 7-8. ay
        if (currentMonth < 6 || currentMonth > 8) pregMonth.value = 7;
        pregMonth.min = 6;
        pregMonth.max = 8;
      }
    } else {
      pregChk.disabled = false;
      if (pregLabel) {
        pregLabel.style.opacity = '';
        pregLabel.title = '';
      }
      pregMonth.min = 1;
      pregMonth.max = 9;
      pregGroup.style.display = pregChk.checked ? 'flex' : 'none';
    }
  }

  // ─── 6) Stage hint — genel açıklama ────────────────────────────────────
  const hint = container.querySelector('#stage-hint');
  if (hint) {
    if (isCloseUp) {
      hint.textContent = t('acalc.stage_closeup');
      hint.style.color = 'var(--warning, #b85c00)';
    } else if (isFarOff) {
      hint.textContent = t('acalc.stage_faroff');
      hint.style.color = 'var(--warning, #b85c00)';
    } else {
      hint.textContent = t('acalc.stage_lact');
      hint.style.color = '';
    }
  }
}

function readForm(form) {
  const fd = new FormData(form);
  const ambientTemp = fd.get('ambientTemp') !== '' ? +fd.get('ambientTemp') : null;
  const humidity    = fd.get('humidity') !== '' ? +fd.get('humidity') : null;

  // THI otomatik hesapla — sıcaklık + nem ikisi de girilmişse
  let thi = null;
  if (ambientTemp !== null && humidity !== null) {
    thi = Math.round(calcTHI(ambientTemp, humidity) * 10) / 10;
  }

  // DIM değerini laktasyon evresine göre sınırla
  const stage = fd.get('lactationStage') || 'early';
  const dimRange = DIM_RANGES[stage] || { min: 1, max: 500 };
  let dim = +fd.get('dim');
  if (!Number.isFinite(dim) || dim < dimRange.min) dim = dimRange.min;
  if (dim > dimRange.max) dim = dimRange.max;

  const pregnant = form.querySelector('[name="pregnant"]').checked;
  const pregnancyMonth = +fd.get('pregnancyMonth') || 0;
  // Çekirdek fonksiyonların kullandığı gestDays (gün) — aylık girişten türetilir
  const gestDays = pregnant && pregnancyMonth > 0 ? pregnancyMonth * 30 : 0;

  return {
    lactationStage: stage,
    bw:             +fd.get('bw'),
    milkYield:      +fd.get('milkYield'),
    milkFat:        +fd.get('milkFat'),
    milkProtein:    +fd.get('milkProtein'),
    milkLactose:    fd.get('milkLactose') !== '' ? +fd.get('milkLactose') : null,
    parity:         +fd.get('parity'),
    dim,
    bcs:            +fd.get('bcs'),
    pregnant,
    pregnancyMonth,
    gestDays,
    ambientTemp,
    humidity,
    thi,
    urinePH:        fd.get('urinePH') !== '' ? +fd.get('urinePH') : null,
    dailyWalkKm:    fd.get('dailyWalkKm') !== '' ? +fd.get('dailyWalkKm') : 0,
    breed:          fd.get('breed') || 'Holstein',
    // FAZ 13.10: primipar büyüme — boş bırakılırsa 0 (büyüme eklenmez)
    targetADG:      fd.get('targetADG') !== '' && fd.get('targetADG') != null ? +fd.get('targetADG') : 0,
  };
}

function updateCalc(form, state, container) {
  const animal = readForm(form);
  const calcEl = container.querySelector('#animal-calc');
  if (!calcEl) return;

  try {
    // #4 düzeltmesi: Hayvan Profili önizlemesi de Ayarlar'daki KMT yöntemi (de Souza/NRC)
    // ve bilim sistemini (NASEM/NRC/INRA) kullansın → optimizer ile tutarlı sayılar
    // (eskiden hep NRC2001 KMT + NASEM default gösteriyordu, ayar seçimini yok sayıyordu).
    const sci = getSettings().science || {};
    const r = calcAllRequirements(animal, { dmiMethod: sci.dmiMethod, system: sci.system });
    const { dmi, nel, mp, minerals: min, traceMinerals: tm, vitamins: vit, aaTargets, compTargets, dcadCowPeriod, water } = r;

    const n2 = v => Number.isFinite(v) ? v.toFixed(2) : '—';
    const n1 = v => Number.isFinite(v) ? v.toFixed(1) : '—';
    const n0 = v => Number.isFinite(v) ? v.toFixed(0) : '—';

    // THI sınıflandırma
    let thiBadge = '';
    let heatRecs = null;
    if (animal.thi !== null) {
      const thiClass = classifyTHI(animal.thi);
      heatRecs = heatStressRecommendations(thiClass);
      const color = thiClass.color === 'green' ? 'var(--primary)' : thiClass.color;
      thiBadge = `<span style="color:${color}; font-weight:600">THI ${animal.thi.toFixed(1)} — ${thiClass.label}</span>`;
    }

    // AA gereksinim (mp.total üzerinden hedef Lys / Met)
    const lysG = (mp.total * aaTargets.lys.pctMP) / 100;
    const metG = (mp.total * aaTargets.met.pctMP) / 100;

    // DCAD hedef
    const dcadTarget = compTargets.dcad_meq;
    const dcadInterp = interpretDCAD(0, dcadCowPeriod);
    const phTarget = estimateUrinePH(0, dcadCowPeriod, animal.breed).targetRange;

    // Vit A: rasyondan değil — hedef IU
    const compRanges = (key) => {
      const c = compTargets[key];
      if (!c) return '—';
      if (c.min !== undefined && c.max !== undefined) return `${c.min}–${c.max}`;
      if (c.min !== undefined) return `≥ ${c.min}`;
      if (c.max !== undefined) return `≤ ${c.max}`;
      return '—';
    };

    calcEl.innerHTML = `
      <!-- 🔢 ÖZET KARTLAR (her zaman açık) -->
      <div class="summary-bar">
        <div class="summary-card"><div class="val">${n1(dmi.dmi)}</div><div class="lbl">${t('acalc.sum_dmi')}</div></div>
        <div class="summary-card"><div class="val">${n1(dmi.ecm)}</div><div class="lbl">${t('acalc.sum_ecm')}</div></div>
        <div class="summary-card"><div class="val">${n1(nel.total)}</div><div class="lbl">${t('acalc.sum_nel')}</div></div>
        <div class="summary-card"><div class="val">${n0(mp.total)}</div><div class="lbl">${t('acalc.sum_mp')}</div></div>
        <div class="summary-card"><div class="val">${n0(min.ca.dietary)}</div><div class="lbl">${t('acalc.sum_ca')}</div></div>
        <div class="summary-card"><div class="val">${n0(min.p.total)}</div><div class="lbl">${t('acalc.sum_p')}</div></div>
      </div>

      <!-- ⚡ ENERJİ DETAYI -->
      <details class="acc-panel" style="margin-top:0.75rem">
        <summary><strong>${t('acalc.energy_detail')}</strong></summary>
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table" style="font-size:0.85rem; margin-top:0.5rem">
          <tbody>
            <tr><td>${t('acalc.nel_maint')}${nel.heatAdjusted ? t('acalc.heat_adj_sfx') : ''}</td><td class="num">${n2(nel.maintenance)} Mcal</td></tr>
            <tr><td>${t('acalc.nel_milk')}</td><td class="num">${n2(nel.lactation)} Mcal</td></tr>
            <tr><td>${t('acalc.nel_preg')}</td><td class="num">${n2(nel.pregnancy)} Mcal</td></tr>
            ${Number.isFinite(nel.activity) ? `<tr><td>${t('acalc.nel_act')}</td><td class="num">${n2(nel.activity)} Mcal</td></tr>` : ''}
            ${nel.mobilization ? `<tr><td>${t('acalc.nel_mob')}</td><td class="num">${n2(nel.mobilization)} Mcal</td></tr>` : ''}
            ${nel.growth ? `<tr><td>${t('acalc.nel_growth')}</td><td class="num">${n2(nel.growth)} Mcal</td></tr>` : ''}
            <tr style="font-weight:700"><td>${t('acalc.nel_total')}</td><td class="num">${n2(nel.total)} Mcal/gün</td></tr>
            <tr><td>${t('acalc.fcm')}</td><td class="num">${n2(dmi.fcm)} kg/gün</td></tr>
            <tr><td>${t('acalc.ecm')}</td><td class="num">${n2(dmi.ecm)} kg/gün</td></tr>
            <tr><td>${t('acalc.dmi_method')}</td><td class="num">${dmi.method}${dmi.heatAdjusted ? t('acalc.heat_adj_sfx') : ''}</td></tr>
            <tr><td colspan="2" class="text-small text-muted">${t('acalc.dmi_fill_hint')}</td></tr>
          </tbody>
        </table>
</div>
      </details>

      <!-- 🥩 PROTEİN DETAYI -->
      <details class="acc-panel" style="margin-top:0.5rem">
        <summary><strong>${t('acalc.protein_detail')}</strong></summary>
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table" style="font-size:0.85rem; margin-top:0.5rem">
          <tbody>
            <tr><td>${t('acalc.mp_maint')}</td><td class="num">${n0(mp.maintenance)} g</td></tr>
            <tr><td>${t('acalc.mp_milk')}</td><td class="num">${n0(mp.lactation)} g</td></tr>
            <tr><td>${t('acalc.mp_preg')}</td><td class="num">${n0(mp.pregnancy)} g</td></tr>
            ${mp.growth ? `<tr><td>${t('acalc.mp_growth')}</td><td class="num">${n0(mp.growth)} g</td></tr>` : ''}
            <tr style="font-weight:700"><td>${t('acalc.mp_total')}</td><td class="num">${n0(mp.total)} g/gün</td></tr>
            <tr><td colspan="2" style="background:var(--bg-light,#f5f5f5); font-weight:600; padding-top:0.4rem">${t('acalc.aa_targets')}</td></tr>
            <tr><td>${t('acalc.lys_target')}</td><td class="num">${aaTargets.lys.pctMP}% MP ≈ ${n0(lysG)} g/gün</td></tr>
            <tr><td>${t('acalc.met_target')}</td><td class="num">${aaTargets.met.pctMP}% MP ≈ ${n0(metG)} g/gün</td></tr>
            <tr><td>${t('acalc.lysmet_ratio')}</td><td class="num">${aaTargets.lysMet_ratio.ideal} (${t('acalc.ratio_min')} ${aaTargets.lysMet_ratio.min})</td></tr>
          </tbody>
        </table>
</div>
      </details>

      <!-- 🧪 MİNERAL DETAYI -->
      <details class="acc-panel" style="margin-top:0.5rem">
        <summary><strong>${t('acalc.min_detail')}</strong></summary>
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table" style="font-size:0.82rem; margin-top:0.5rem">
          <thead><tr><th>${t('acalc.col_mineral')}</th><th class="num">${t('acalc.col_min')}</th><th class="num">${t('acalc.col_max')}</th><th>${t('acalc.col_note')}</th></tr></thead>
          <tbody>
            <tr><td>Ca (g/gün)</td><td class="num">${n1(min.ca.dietary)}</td><td class="num">—</td><td class="text-small text-muted">${min.ca.note || ''}</td></tr>
            <tr><td>P (g/gün)</td><td class="num">${n1(min.p.total)}</td><td class="num">—</td><td></td></tr>
            <tr><td>Mg (g/gün)</td><td class="num">${n1(min.mg.total)}</td><td class="num">—</td><td class="text-small text-muted">${min.mg.heatAdjusted ? t('acalc.heat_adj_tag') : ''}</td></tr>
            <tr><td>K (g/gün)</td><td class="num">${n1(min.k.total)}</td><td class="num">—</td><td class="text-small text-muted">${min.k.heatAdjusted ? t('acalc.heat_adj_tag') : ''}</td></tr>
            <tr><td>Na (g/gün)</td><td class="num">${n1(min.na.total)}</td><td class="num">—</td><td class="text-small text-muted">${min.na.heatAdjusted ? t('acalc.heat_adj_tag') : ''}</td></tr>
            <tr><td>S (g/gün)</td><td class="num">${n1(min.s.minG)}</td><td class="num">${n1(min.s.maxG)}</td><td></td></tr>
            <tr><td>Cl (g/gün)</td><td class="num">${n1(min.cl.minG)}</td><td class="num">—</td><td></td></tr>
            <tr><td colspan="4" style="background:var(--bg-light,#f5f5f5); font-weight:600">${t('acalc.trace_min')}</td></tr>
            <tr><td>Fe</td><td class="num">${n0(tm.fe?.minMg)}</td><td class="num">${n0(tm.fe?.maxMg)}</td><td></td></tr>
            <tr><td>Zn</td><td class="num">${n0(tm.zn?.minMg)}</td><td class="num">${n0(tm.zn?.maxMg)}</td><td></td></tr>
            <tr><td>Cu</td><td class="num">${n0(tm.cu?.minMg)}</td><td class="num">${n0(tm.cu?.maxMg)}</td><td></td></tr>
            <tr><td>Mn</td><td class="num">${n0(tm.mn?.minMg)}</td><td class="num">${n0(tm.mn?.maxMg)}</td><td></td></tr>
            <tr><td>Se</td><td class="num">${n2(tm.se?.minMg)}</td><td class="num">${n2(tm.se?.maxMg)}</td><td></td></tr>
            <tr><td>Co</td><td class="num">${n2(tm.co?.minMg)}</td><td class="num">${n2(tm.co?.maxMg)}</td><td></td></tr>
            <tr><td>I</td><td class="num">${n2(tm.i?.minMg)}</td><td class="num">${n2(tm.i?.maxMg)}</td><td></td></tr>
          </tbody>
        </table>
</div>
      </details>

      <!-- 💊 VİTAMİN DETAYI -->
      <details class="acc-panel" style="margin-top:0.5rem">
        <summary><strong>${t('acalc.vit_detail')}</strong></summary>
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table" style="font-size:0.85rem; margin-top:0.5rem">
          <tbody>
            <tr><td>Vitamin A</td><td class="num">${n0(vit.vitA?.recommendedIU)} IU/gün</td></tr>
            <tr><td>Vitamin D</td><td class="num">${n0(vit.vitD?.recommendedIU)} IU/gün</td></tr>
            <tr><td>Vitamin E</td><td class="num">${n0(vit.vitE?.recommendedIU)} IU/gün</td></tr>
            <tr><td>${t('acalc.bcarotene_label')}</td><td class="num">${n0(vit.bcarotene?.recommendedMg)} mg/gün</td></tr>
            <tr><td>${t('acalc.niacin_label')}</td><td class="num">${n0(vit.niacin?.recommendedG)} g/gün</td></tr>
            <tr><td>${t('acalc.biotin_label')}</td><td class="num">${n0(vit.biotin?.recommendedMg)} mg/gün</td></tr>
            <tr><td>${t('acalc.choline_label')}</td><td class="num">${n1(vit.choline?.recommendedIonG)} g/gün (≈ ${n0(vit.choline?.recommendedProductG_25pct)} ${t('acalc.choline_sfx')})</td></tr>
            ${vit.b12?.recommendedMg ? `<tr><td>${t('acalc.b12_label')}</td><td class="num">${n1(vit.b12.recommendedMg)} mg/gün <span class="text-muted">${t('acalc.conditional')}</span></td></tr>` : ''}
            ${vit.folicAcid?.recommendedMg ? `<tr><td>${t('acalc.folic_label')}</td><td class="num">${n0(vit.folicAcid.recommendedMg)} mg/gün <span class="text-muted">${t('acalc.conditional')}</span></td></tr>` : ''}
            <tr><td colspan="2" class="text-muted" style="font-size:0.78rem">${t('acalc.bgroup_note')}</td></tr>
          </tbody>
        </table>
</div>
      </details>

      <!-- 🌡️ ÇEVRE & DCAD -->
      <details class="acc-panel" style="margin-top:0.5rem">
        <summary><strong>${t('acalc.env_dcad')}</strong></summary>
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table" style="font-size:0.85rem; margin-top:0.5rem">
          <tbody>
            <tr><td>THI</td><td class="num">${thiBadge || `<span class="text-muted">${t('acalc.not_entered')}</span>`}</td></tr>
            <tr><td>${t('acalc.dmi_heat_adj')}</td><td class="num">${dmi.heatAdjusted ? t('acalc.applied') : '—'}</td></tr>
            <tr><td>${t('acalc.nel_heat_adj')}</td><td class="num">${nel.heatAdjusted ? t('acalc.applied') : '—'}</td></tr>
            ${water ? `<tr><td>${t('acalc.water')}</td><td class="num">~${n0(water.intakeL)} ${t('acalc.water_unit')}${water.waterPerKgDM ? ` (${water.waterPerKgDM} ${t('acalc.water_perdm')})` : ''}${water.level === 'high_demand' ? t('acalc.high_demand') : ''}</td></tr>` : ''}
            <tr><td>${t('acalc.dcad_period')}</td><td class="num">${dcadInterp.cowPeriod || dcadCowPeriod}</td></tr>
            <tr><td>${t('acalc.dcad_range')}</td><td class="num">${dcadTarget ? `${dcadTarget.min} – ${dcadTarget.max} ${t('acalc.dcad_unit')}` : '—'}</td></tr>
            <tr><td>${t('acalc.urine_ph_target')} (${animal.breed || 'Holstein'})</td><td class="num">${phTarget}</td></tr>
            <tr><td colspan="2" style="background:var(--bg-light,#f5f5f5); font-weight:600">${t('acalc.comp_targets')}</td></tr>
            <tr><td>NDF ${t('acalc.unit_dm')}</td><td class="num">${compRanges('ndf_pct')}</td></tr>
            <tr><td>ADF ${t('acalc.unit_dm')}</td><td class="num">${compRanges('adf_pct')}</td></tr>
            <tr><td>NFC ${t('acalc.unit_dm')}</td><td class="num">${compRanges('nfc_pct')}</td></tr>
            <tr><td>peNDF ${t('acalc.unit_dm')}</td><td class="num">${compRanges('peNDF_pct')}</td></tr>
            <tr><td>${t('acalc.forage_label')} ${t('acalc.unit_dm')}</td><td class="num">${compRanges('forage_pct')}</td></tr>
          </tbody>
        </table>
</div>
        ${heatRecs ? `<div class="info-box" style="margin-top:0.5rem">
          <strong>${t('acalc.heat_mgmt')}</strong>
          <ul style="margin:0.3rem 0 0 1rem; font-size:0.85rem">
            ${(heatRecs.actions || []).map(a => `<li>${a}</li>`).join('')}
          </ul>
        </div>` : ''}
      </details>
    `;
  } catch (err) {
    calcEl.innerHTML = `<div class="warn-box">Hesaplama hatası: ${err.message}</div>`;
  }
}
