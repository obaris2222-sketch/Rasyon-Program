/**
 * Rasyon Kurucu — Yem seçimi, kısıt ayarları, optimizasyon
 */

import { getAllFeeds, CATEGORY_LABELS_TR, FEED_CATEGORIES, feedMatchesQuery } from '../../data/feedService.js';
import { DEFAULT_COMPOSITION, compositionForStage } from '../../solver/rationOptimizer.js';
import { calcAllRequirements, buildDynamicNotes, COMPOSITION_PRESETS } from '../../core/animalRequirements.js';
import { RELAX_PRIORITY } from '../../solver/softConstraints.js';  // FAZ 22.1: gevşetme önceliği UI
import { getSettings } from '../../data/settings.js';
import { escHtml, showToast } from '../utils.js';
import { t, feedDisplayName } from '../i18n.js';

// FAZ 22.1 — Gevşetme önceliği UI: kullanıcı-dostu gruplar → softConstraints token'ları.
// Grup sırası concat edildiğinde RELAX_PRIORITY'yi BİREBİR üretir (kullanıcı dokunmazsa
// state.relaxPriority undefined → optimizeRation default RELAX_PRIORITY'yi kullanır).
const RELAX_GROUP_TOKENS = {
  dcad: ['DCAD'], vit: ['vit_'], trace: ['trace_'],
  macro: ['Mg', 'K', 'Na', 'Cl', 'S'], cap: ['Ca_P_min', 'Ca_P_max'],
  pendf: ['peNDF_min', 'peNDF_max'], forage: ['Forage'],
  fat: ['Fat_max', 'Fat_min'], pufa: ['PUFA_max', 'PUFA_min', 'n6n3_ratio'],
  starch: ['Starch_max', 'Starch_min'], sugar: ['Sugar_max', 'Sugar_min'],
  nfc: ['NFC_max', 'NFC_min'], ndf: ['NDF'], adf: ['ADF_min', 'ADF_max'],
  rdp: ['RDP'], aa: ['Lys', 'Met', 'His', 'Arg', 'Thr', 'Ile', 'Leu', 'Val', 'Phe', 'Trp'],
  group: ['group_'], tmr: ['TMR_ration_moisture_min', 'TMR_DM_min', 'TMR_DM_max'],
};
const RELAX_DEFAULT_ORDER = ['dcad', 'vit', 'trace', 'cap', 'macro', 'pendf', 'forage', 'fat', 'pufa', 'starch', 'sugar', 'nfc', 'ndf', 'adf', 'rdp', 'aa', 'group', 'tmr'];

function relaxLabel(key) {
  switch (key) {
    case 'dcad': return 'DCAD'; case 'pendf': return 'peNDF'; case 'pufa': return 'PUFA / ω6:ω3';
    case 'nfc': return 'NFC'; case 'ndf': return 'NDF'; case 'adf': return 'ADF'; case 'rdp': return 'RDP';
    case 'vit': return t('ration.relax_g_vit'); case 'trace': return t('ration.relax_g_trace');
    case 'macro': return t('ration.relax_g_macro') || 'Makro Mineraller'; case 'cap': return t('ration.relax_g_cap') || 'Ca/P Oranı';
    case 'forage': return t('ration.relax_g_forage'); case 'fat': return t('ration.relax_g_fat');
    case 'starch': return t('ration.relax_g_starch'); case 'sugar': return t('ration.relax_g_sugar');
    case 'aa': return t('ration.relax_g_aa'); case 'group': return t('ration.relax_g_group');
    case 'tmr': return t('ration.relax_g_tmr'); default: return key;
  }
}
/** state.relaxPriority geçerli permütasyon mu? değilse (bayat/bozuk) default. */
function currentRelaxOrder(state) {
  const saved = state.relaxPriority;
  if (Array.isArray(saved) && saved.length === RELAX_DEFAULT_ORDER.length
      && RELAX_DEFAULT_ORDER.every(k => saved.includes(k))) return saved;
  return RELAX_DEFAULT_ORDER;
}
/** Grup-key sırasını softConstraints token listesine aç (güvenlik: hiçbir token düşmesin). */
function expandRelaxPriority(order) {
  const tokens = [], seen = new Set();
  for (const key of order) for (const tk of (RELAX_GROUP_TOKENS[key] || [])) if (!seen.has(tk)) { tokens.push(tk); seen.add(tk); }
  for (const tk of RELAX_PRIORITY) if (!seen.has(tk)) { tokens.push(tk); seen.add(tk); }
  return tokens;
}
function renderRelaxPriorityRows(order, state) {
  const hardSet = new Set(state ? (state.hardConstraints || ['Forage']) : ['Forage']);
  const visibleOrder = order.filter(key => {
    const tokens = RELAX_GROUP_TOKENS[key] || [];
    return !tokens.some(tk => hardSet.has(tk));
  });

  return visibleOrder.map((key, i) => `
    <div class="relax-row" data-key="${key}" style="display:flex; align-items:center; gap:0.5rem; padding:0.3rem 0; border-bottom:1px solid var(--border)">
      <span style="min-width:1.6rem; text-align:center; font-weight:600; color:var(--text-muted)">${i + 1}</span>
      <span style="flex:1">${escHtml(relaxLabel(key))}</span>
      <span style="display:flex; gap:0.25rem">
        <button type="button" class="btn btn-sm btn-secondary relax-up" data-key="${key}" ${i === 0 ? 'disabled' : ''} aria-label="up"><i class="ti ti-chevron-up"></i></button>
        <button type="button" class="btn btn-sm btn-secondary relax-down" data-key="${key}" ${i === visibleOrder.length - 1 ? 'disabled' : ''} aria-label="down"><i class="ti ti-chevron-down"></i></button>
      </span>
    </div>`).join('');
}

/** Laktasyon dönemi etiketi (dil-duyarlı). */
function stageLabel(key) {
  const v = t(`stages.${key}`);
  return v === `stages.${key}` ? (key || '—') : v;
}
/** Yem kategorisi etiketi (dil-duyarlı; bilinmeyen → feedService TR fallback). */
function catLabel(cat) {
  const v = t(`categories.${cat}`);
  return v === `categories.${cat}` ? (CATEGORY_LABELS_TR[cat] ?? cat) : v;
}
/** Kompozisyon preset etiket/açıklaması (dil-duyarlı; core COMPOSITION_PRESETS fallback). */
function presetLabel(key) {
  const v = t(`presets.${key}_label`);
  return v === `presets.${key}_label` ? (COMPOSITION_PRESETS[key]?.label ?? key) : v;
}
function presetDesc(key) {
  const v = t(`presets.${key}_desc`);
  return v === `presets.${key}_desc` ? (COMPOSITION_PRESETS[key]?.description ?? '') : v;
}

let _allFeeds = [];

export async function renderRationBuilder(container, state, { onOptimize }) {
  _allFeeds = await getAllFeeds();

  const stage = state.animal.lactationStage ?? 'early';
  const preset = state.compositionPreset || 'recommended';
  const stageDefaults = compositionForStage(stage, state.animal, { preset });  // FAZ 9+12: dinamik + preset

  // #12 düzeltmesi: kullanıcının girdiği kompozisyon kısıt override'larını sekme
  // geçişinde KORU. Ancak dönem/preset değişince bayat override'ları at (yeni dinamik
  // default'lar görünsün). İmza = stage|preset.
  const _compSig = `${stage}|${preset}`;
  if (state.composition && state._compositionSig && state._compositionSig !== _compSig) {
    state.composition = undefined;
  }
  state._compositionSig = _compSig;
  const compOverride = state.composition || {};
  const mergeComp = (key, base) => ({ ...(base || {}), ...(compOverride[key] || {}) });

  // #2: Zorunlu (hard) kısıtlar — infeasibility'de gevşetilmez (kullanıcı kilidi).
  // KMT/NEL/MP zaten her zaman hard; burada gevşetilebilir-ama-kritik olanlar seçilir.
  // Varsayılan: Kaba yem (Forage) zorunlu — kullanıcının "kaba yem oranı aşılmasın" isteği.
  const hardSet = new Set(state.hardConstraints ?? ['Forage']);
  const HARD_OPTIONS = [
    ['Forage', t('ration.forage')],
    ['NDF', t('ration.ndf')],          // PROBLEMLER #5: NDF kilitlenebilir (kilit min+max'ı birlikte hard yapar)
    ['peNDF_min', t('ration.pendf_min')],
    ['NFC_max', t('ration.nfc_max')],
    ['Starch_max', t('ration.starch')],
    ['DCAD', 'DCAD'],
  ];

  const isCloseUp = stage === 'close_up';
  const notes = buildDynamicNotes(stageDefaults, state.animal, stage);

  // FAZ 12 Madde 6: NEL & MP placeholder için hesaplanan değerler
  let reqsForPlaceholder = null;
  try {
    if (state.animal && state.animal.bw) reqsForPlaceholder = calcAllRequirements(state.animal, { preset });
  } catch (_) {}
  const nelHint = reqsForPlaceholder ? reqsForPlaceholder.nel.total.toFixed(1) : '';
  const mpHint  = reqsForPlaceholder ? reqsForPlaceholder.mp.total.toFixed(0)  : '';

  // denetim #2: İleri kısıt placeholder'ları — iz mineral (mg/gün) + vitamin (IU/gün) gereksinimi
  const tmReq = reqsForPlaceholder?.traceMinerals || {};
  const vitReq = reqsForPlaceholder?.vitamins || {};
  const TRACE_UI = [['zn', 'Zn'], ['cu', 'Cu'], ['mn', 'Mn'], ['se', 'Se'], ['fe', 'Fe'], ['i', 'İyot (I)'], ['co', 'Co']];
  const VIT_UI = [['vitA', 'Vit A'], ['vitD', 'Vit D'], ['vitE', 'Vit E']];
  const subHead = (txt, unit) => `<div class="text-small text-muted" style="margin:0.5rem 0 0.2rem; font-weight:600">${txt}${unit ? ` <span style="font-weight:400">(${unit})</span>` : ''}</div>`;

  // #1: makro mineral + protein (RUP/AA) placeholder'ları (g/gün gereksinim)
  const minReq = reqsForPlaceholder?.minerals || {};
  const aaT = reqsForPlaceholder?.aaTargets;
  const mpTot = reqsForPlaceholder?.mp?.total || 0;
  const num1 = v => Number.isFinite(v) ? v.toFixed(0) : null;
  const MACRO_UI = [
    ['ca', 'Ca', num1(minReq.ca?.dietary)], ['p', 'P', num1(minReq.p?.total)],
    ['mg', 'Mg', num1(minReq.mg?.total)],   ['k', 'K', num1(minReq.k?.total)],
    ['na', 'Na', num1(minReq.na?.total)],   ['s', 'S', num1(minReq.s?.minG)],
    ['cl', 'Cl', num1(minReq.cl?.minG)],
  ];
  const lysPh = (aaT && mpTot) ? num1(mpTot * aaT.lys.pctMP_min / 100) : null;
  const metPh = (aaT && mpTot) ? num1(mpTot * aaT.met.pctMP_min / 100) : null;
  const hisPh = (aaT && aaT.his && mpTot) ? num1(mpTot * aaT.his.pctMP_min / 100) : null;  // FAZ 18.3: His override placeholder
  // Tam EAA Katman B: 7 EAA opt-in override satırları (Arg/Thr/Ile/Leu/Val/Phe/Trp).
  // Etiket + referans placeholder (mpTot×pctMP_min/100, g/gün). OPT-IN → ph-computed DEĞİL
  // (boş bırakılırsa kısıt OLMAZ; gri/opsiyonel — referans yalnız ipucu).
  const EAA7_UI = [['arg', 'Arg'], ['thr', 'Thr'], ['ile', 'Ile'], ['leu', 'Leu'], ['val', 'Val'], ['phe', 'Phe'], ['trp', 'Trp']];

  // FAZ 15.2: KMT yöntemi varsayılanı Ayarlar'dan (kullanıcı burada geçici değiştirebilir)
  const dmiMethodDefault = state.dmiMethod || getSettings().science.dmiMethod || 'auto';  // FAZ 17.3

  // FAZ 17.4: çok-amaçlı denge aktif mi (herhangi bir ağırlık > 0) → preset düğmesi vurgusu
  const mobActive = ['cost', 'mfd_risk', 'aa_balance'].some(k => (state.objectiveWeights?.[k] ?? 0) > 0);

  container.innerHTML = `
    <div class="ration-layout">

      <!-- 📖 Sekme Yardımı (tam genişlik, sadece ilk kart) -->
      <div style="grid-column: 1 / -1; margin-bottom:0.25rem">
        <details class="tab-help-accordion">
          <summary style="cursor:pointer; font-weight:600; color:var(--primary); display:flex; align-items:center; gap:0.4rem">
            <i class="ti ti-info-circle"></i> Bu sekme ne işe yarar? <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted); margin-left:auto">▾</span>
          </summary>
          <div class="info-box" style="margin-top:0.5rem; font-size:0.85rem; line-height:1.7">
            <b>⚗️ Rasyon Kurucu</b> — Hayvan profilinize uygun optimum yem karmasını oluşturur.<br>
            • <b>Sol panel:</b> Rasyona dahil edilecek yemleri seçin. Her yem için isteğe bağlı min/maks kg sınırı girebilirsiniz.<br>
            • <b>Sağ panel:</b> Kısıtları (NDF, NFC, forage, enerji, protein, amino asit…) gözden geçirin. Koyu renkli (hesaplanan) placeholder değerleri LP'nin otomatik uyguladığı minimumları gösterir; alanı boş bırakırsanız bu değerler kullanılır.<br>
            • <b>Zorunlu kısıtlar:</b> İnfeasibility durumunda bile gevşetilmez (varsayılan: kaba yem oranı). Dikkatli kullanın.<br>
            • <b>İleri Kısıtlar:</b> Amino asit, iz mineral, vitamin ve TMR nem kısıtları buradadır — genellikle boş bırakmak yeterlidir.<br>
            • Hazır olunca <b>Optimize Et</b> butonuna basın; sonuç otomatik olarak <b>Sonuçlar</b> sekmesine taşır.
          </div>
        </details>
      </div>

      <!-- Sol: Yem seçimi -->
      <div>
        <div class="card">
          <div class="card-title">${t('ration.feed_selection')}
            <span class="text-small text-muted" style="font-weight:400; margin-left:auto">
              ${t('ration.feeds_selected', { n: state.selectedFeeds.length })}
            </span>
          </div>

          <div class="info-box">
            ${t('ration.feed_info')}
          </div>

          <!-- Hızlı ekleme arama -->
          <input class="search-input" id="quick-feed-search" type="search"
            placeholder="${t('ration.quick_add_ph')}" style="width:100%; margin-bottom:0.75rem" />

          <div id="quick-feed-list" class="feed-selection-list" style="max-height:200px"></div>

          <hr class="divider" />

          <!-- Seçili yemler & limitler -->
          <div class="section-title mt-1">${t('ration.selected_limits')}</div>
          <div id="selected-feeds-area"></div>

          <button class="btn btn-secondary btn-sm mt-1" id="clear-feeds-btn">${t('ration.clear_all')}</button>
        </div>
      </div>

      <!-- Sağ: Kısıtlar + Optimize -->
      <div>
        <div class="card">
          <div class="card-title">${t('ration.constraints')}</div>

          <div class="info-box">
            ${t('ration.stage_info', { stage: stageLabel(stage) })}
            <br>${t('ration.dynamic_targets', {
              milk: state.animal.milkYield ?? '?',
              parity: state.animal.parity ?? '?',
              bcs: state.animal.bcs ?? '?',
              thi: Number.isFinite(state.animal.thi) ? t('ration.thi_part', { thi: state.animal.thi.toFixed(0) }) : '',
            })}
            ${isCloseUp ? `<br>${t('ration.anionic_warning')}` : ''}
          </div>

          <!-- FAZ 12 Madde 8: Preset seçici -->
          <div class="form-group" style="margin:0.5rem 0">
            <label>${t('ration.preset_label')}</label>
            <select id="composition-preset-select">
              ${Object.keys(COMPOSITION_PRESETS).map(key => `
                <option value="${key}" ${preset === key ? 'selected' : ''}>${presetLabel(key)}</option>
              `).join('')}
            </select>
            <span class="hint">${presetDesc(preset)}</span>
          </div>

          <div class="section-title">${t('ration.energy_protein')}</div>
          <div class="constraint-grid">
            ${constraintRow('nel_mcal', t('ration.nel'), compOverride.nel_mcal || {}, { minPh: nelHint, maxPh: '—' })}
            ${constraintRow('mp_g',     t('ration.mp'),  compOverride.mp_g || {},     { minPh: mpHint,  maxPh: '—' })}
          </div>
          <div class="info-box" style="margin-top:0.4rem; font-size:0.82rem">
            ${t('ration.nelmp_info')}
          </div>

          <hr class="divider" />
          <div class="section-title">${t('ration.carb_fiber')}</div>
          <div class="constraint-grid">
            ${constraintRow('ndf_pct',   t('ration.ndf'),       mergeComp('ndf_pct', stageDefaults.ndf_pct),               { note: notes.ndf_pct })}
            ${constraintRow('adf_pct',   t('ration.adf_min'),   mergeComp('adf_pct', { min: stageDefaults.adf_pct?.min }),  { note: notes.adf_pct })}
            ${constraintRow('nfc_pct',   t('ration.nfc_max'),   mergeComp('nfc_pct', { max: stageDefaults.nfc_pct?.max }),  { note: notes.nfc_pct })}
            ${constraintRow('peNDF_pct', t('ration.pendf_min'), mergeComp('peNDF_pct', { min: stageDefaults.peNDF_pct?.min }),{ note: notes.peNDF_pct })}
            ${constraintRow('forage_pct',t('ration.forage'),    mergeComp('forage_pct', stageDefaults.forage_pct),         { note: notes.forage_pct })}
          </div>

          <hr class="divider" />
          <div class="section-title">${t('ration.dcad')}${isCloseUp ? t('ration.anionic_suffix') : ''}</div>
          <div class="constraint-grid">
            ${constraintRow('dcad_meq', 'DCAD', mergeComp('dcad_meq', stageDefaults.dcad_meq), { note: notes.dcad_meq })}
          </div>

          <hr class="divider" />
          <!-- #2: Zorunlu (hard) kısıtlar — infeasibility'de gevşetilmez -->
          <details class="constraint-accordion" open>
            <summary class="section-title" style="cursor:pointer">${t('ration.hard_constraints')}</summary>
            <div class="info-box" style="margin:0.4rem 0; font-size:0.82rem">${t('ration.hard_info')}</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.4rem 1.2rem">
              ${HARD_OPTIONS.map(([name, lbl]) => `
                <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.85rem; cursor:pointer">
                  <input type="checkbox" class="hard-cons" data-name="${name}" ${hardSet.has(name) ? 'checked' : ''} /> ${escHtml(lbl)}
                </label>`).join('')}
            </div>
          </details>

          <hr class="divider" />
          <!-- denetim #2: İleri kısıtlar — nişasta/şeker/yağ/RDP/PUFA + iz mineral + vitamin -->
          <details class="constraint-accordion">
            <summary class="section-title" style="cursor:pointer">${t('ration.advanced_constraints')}</summary>
            <div class="info-box" style="margin:0.4rem 0; font-size:0.82rem">${t('ration.advanced_info')}</div>
            <div class="constraint-legend">
              <span><i class="ph-swatch ph-computed-swatch"></i> ${t('ration.legend_computed')}</span>
              <span><i class="ph-swatch ph-hint-swatch"></i> ${t('ration.legend_optional')}</span>
            </div>

            ${subHead(t('ration.tmr_moisture'), '%')}
            <div class="info-box" style="margin:0.2rem 0 0.5rem; font-size:0.8rem">${t('ration.tmr_moisture_info2')}</div>
            <div class="constraint-grid">
              <div class="constraint-row">
                <label>${t('ration.tmr_target_moisture')} <span class="info-icon" title="${escHtml(t('ration.tmr_target_note'))}">ℹ️</span></label>
                <div class="constraint-inputs">
                  <input type="number" step="1" min="0" max="95" class="comp-single" data-key="tmr_target_moisture" value="${compOverride.tmr_target_moisture ?? ''}" placeholder="50" />
                  <span>%</span>
                </div>
              </div>
              <div class="constraint-row">
                <label>${t('ration.tmr_min_ration_moisture')} <span class="info-icon" title="${escHtml(t('ration.tmr_min_ration_note'))}">ℹ️</span></label>
                <div class="constraint-inputs">
                  <input type="number" step="1" min="0" max="95" class="comp-single" data-key="tmr_min_ration_moisture" value="${compOverride.tmr_min_ration_moisture ?? ''}" placeholder="30" />
                  <span>%</span>
                </div>
              </div>
            </div>

            ${subHead(t('ration.adv_carb_protein'))}
            <div class="constraint-grid">
              ${constraintRow('rdp_pct',    t('ration.rdp'),    mergeComp('rdp_pct', stageDefaults.rdp_pct))}
              ${constraintRow('starch_pct', t('ration.starch'), mergeComp('starch_pct', { max: stageDefaults.starch_pct?.max }))}
              ${constraintRow('sugar_pct',  t('ration.sugar'),  mergeComp('sugar_pct', { max: stageDefaults.sugar_pct?.max }))}
              ${constraintRow('fat_pct',    t('ration.fat'),    mergeComp('fat_pct', { max: stageDefaults.fat_pct?.max }))}
              ${constraintRow('pufa_pct',   t('ration.pufa'),   mergeComp('pufa_pct', { max: stageDefaults.pufa_pct?.max }))}
            </div>

            ${subHead(t('ration.adv_trace'), 'mg/gün')}
            <div class="constraint-grid">
              ${TRACE_UI.map(([k, lbl]) => { const ph = tmReq[k]?.minMgDay != null ? (+tmReq[k].minMgDay).toFixed(1) : null;
                return constraintRow('trace_' + k, lbl, compOverride['trace_' + k] || {}, {
                  minPh: ph ?? t('ration.min_ph'), maxPh: t('ration.max_ph'), minComputed: ph != null }); }).join('')}
            </div>

            ${subHead(t('ration.adv_vitamins'), 'IU/gün')}
            <div class="constraint-grid">
              ${VIT_UI.map(([k, lbl]) => { const ph = vitReq[k]?.minIU != null ? (+vitReq[k].minIU).toFixed(0) : null;
                return constraintRow('vit_' + k, lbl, compOverride['vit_' + k] || {}, {
                  minPh: ph ?? t('ration.min_ph'), maxPh: t('ration.max_ph'), minComputed: ph != null }); }).join('')}
            </div>

            ${subHead(t('ration.adv_macro'), 'g/gün')}
            <div class="constraint-grid">
              ${MACRO_UI.map(([k, lbl, ph]) => constraintRow('macro_' + k, lbl, compOverride['macro_' + k] || {}, {
                minPh: ph ?? t('ration.min_ph'), maxPh: t('ration.max_ph'), minComputed: ph != null,
              })).join('')}
              ${constraintRow('ca_p_ratio', 'Ca/P Oranı', compOverride.ca_p_ratio || {}, { minPh: '1.5', maxPh: '2.5' })}
            </div>

            ${subHead(t('ration.adv_protein2'))}
            <div class="constraint-grid">
              ${constraintRow('rup_pct', t('ration.rup_label'), compOverride.rup_pct || {}, { minPh: t('ration.min_ph'), maxPh: t('ration.max_ph') })}
              ${constraintRow('aa_lys', 'Lys (g/gün)', compOverride.aa_lys || {}, { minPh: lysPh ?? t('ration.min_ph'), maxPh: '—', minComputed: lysPh != null })}
              ${constraintRow('aa_met', 'Met (g/gün)', compOverride.aa_met || {}, { minPh: metPh ?? t('ration.min_ph'), maxPh: '—', minComputed: metPh != null })}
              ${constraintRow('aa_his', 'His (g/gün)', compOverride.aa_his || {}, { minPh: hisPh ?? t('ration.min_ph'), maxPh: '—', minComputed: hisPh != null })}
            </div>
            <div class="text-small text-muted" style="margin:0.4rem 0 0.2rem">${t('ration.eaa_optional_note')}</div>
            <div class="constraint-grid">
              ${EAA7_UI.map(([k, lbl]) => {
                const ph = (aaT && aaT[k] && mpTot) ? num1(mpTot * aaT[k].pctMP_min / 100) : null;
                return constraintRow('aa_' + k, lbl + ' (g/gün)', compOverride['aa_' + k] || {}, {
                  minPh: ph ?? t('ration.min_ph'), maxPh: '—' });  // OPT-IN: minComputed YOK (gri/opsiyonel)
              }).join('')}
            </div>
          </details>

          <hr class="divider" />
          <details class="constraint-accordion">
            <summary class="section-title" style="cursor:pointer">${t('ration.group_limits')}</summary>
            <div class="info-box" style="margin:0.4rem 0; font-size:0.82rem">
              ${t('ration.group_limits_info')}
            </div>
            <div class="constraint-grid">
              ${FEED_CATEGORIES.map(cat => groupLimitRow(cat, catLabel(cat), state)).join('')}
            </div>
          </details>

          <hr class="divider" />
          <!-- FAZ 22.1: Gevşetme önceliği — infeasibility'de hangi kısıt önce gevşer (gelişmiş) -->
          <details class="constraint-accordion">
            <summary class="section-title" style="cursor:pointer">${t('ration.relax_priority')}</summary>
            <div class="info-box" style="margin:0.4rem 0; font-size:0.82rem">${t('ration.relax_priority_info')}</div>
            <div id="relax-priority-list">${renderRelaxPriorityRows(currentRelaxOrder(state), state)}</div>
            <button type="button" class="btn btn-sm btn-secondary mt-1" id="relax-reset-btn"><i class="ti ti-rotate"></i> ${t('ration.relax_reset')}</button>
          </details>

          <hr class="divider" />
          <div class="section-title">${t('ration.objective')}</div>
          <div class="form-group">
            <select id="objective-select" ${mobActive ? 'disabled' : ''}>
              <option value="cost"  ${(state.objective || 'cost') === 'cost' ? 'selected' : ''}>${t('ration.obj_cost')}</option>
              <option value="minDM" ${state.objective === 'minDM' ? 'selected' : ''}>${t('ration.obj_mindm')}</option>
            </select>
            <span class="hint obj-mutex-badge" id="obj-mutex-badge" style="display:${mobActive ? 'inline-flex' : 'none'}"><i class="ti ti-info-circle"></i> ${t('ration.obj_mutex')}</span>
          </div>
          <div class="form-group" style="margin-top:0.5rem">
            <label>${t('ration.cost_max')}</label>
            <input type="number" id="cost-max-input" min="0" step="1"
              value="${state.costMax ?? ''}" placeholder="${t('ration.unlimited_ph')}" />
            <span class="hint">${t('ration.cost_max_hint')}</span>
          </div>

          <!-- denetim #7: KMT tolerans bandı (±%) — kullanıcı ayarlanabilir -->
          <div class="form-group" style="margin-top:0.5rem">
            <label>${t('ration.dmi_tolerance')} <span class="info-icon" title="${escHtml(t('ration.dmi_tolerance_hint'))}">ℹ️</span></label>
            <input type="number" id="dmi-tolerance-input" min="0" max="10" step="0.5" value="${state.dmiTolerancePct ?? 3}" />
            <span class="hint">${t('ration.dmi_tolerance_hint')}</span>
          </div>

          <!-- FAZ 17.4: Çok-amaçlı denge artık görünür kart + tek-tık preset (eskiden kapalı akordeon). -->
          <div class="section-title mt-2">${t('ration.multi_obj')}</div>
          <div class="info-box" style="margin:0.4rem 0; font-size:0.82rem">
            ${t('ration.multi_obj_info')}
          </div>
          <div class="obj-preset-row" id="obj-preset-row">
            <button type="button" class="btn btn-sm obj-preset ${mobActive ? 'btn-secondary' : 'btn-primary'}" data-preset="cost">${t('ration.obj_preset_cost')}</button>
            <button type="button" class="btn btn-sm obj-preset ${mobActive ? 'btn-primary' : 'btn-secondary'}" data-preset="balanced">${t('ration.obj_preset_balanced')}</button>
          </div>
          <details class="constraint-accordion" id="obj-finetune" ${mobActive ? 'open' : ''}>
            <summary class="text-small text-muted" style="cursor:pointer; margin-top:0.4rem">${t('ration.obj_finetune')}</summary>
            <div class="obj-weight-grid">
              ${objWeightRow('cost',       t('ration.obj_cost_w'), state)}
              ${objWeightRow('mfd_risk',   t('ration.obj_mfd_w'), state)}
              ${objWeightRow('aa_balance', t('ration.obj_aa_w'), state)}
            </div>
          </details>

          <div class="section-title mt-2">${t('ration.dmi_method')}</div>
          <div class="form-group">
            <select id="dmi-method-select">
              <option value="auto" ${dmiMethodDefault === 'auto' ? 'selected' : ''}>${t('settings.dmi_auto')}</option>
              <option value="NRC2001" ${dmiMethodDefault === 'NRC2001' ? 'selected' : ''}>NRC 2001</option>
              <option value="deSouza2019" ${dmiMethodDefault === 'deSouza2019' ? 'selected' : ''}>de Souza 2019</option>
            </select>
          </div>

          <button class="btn-large" id="optimize-btn">
            ${t('ration.optimize')}
          </button>

          <div id="ration-status" class="mt-1"></div>
        </div>

        <div class="card mt-2" id="animal-summary-mini">
          <div class="card-title">${t('ration.active_profile')}</div>
          ${renderAnimalSummary(state.animal)}
        </div>
      </div>
    </div>
  `;

  // Seçili yemler alanını güncelle
  refreshSelectedFeeds(container, state);

  // Hızlı arama
  setupQuickSearch(container, state);
  setupFeedDropZone(container, state);   // FAZ 15.10 (denetim): sürükle-bırak ile yem ekleme

  // Seçim temizle
  container.querySelector('#clear-feeds-btn').addEventListener('click', () => {
    state.selectedFeeds = [];
    refreshSelectedFeeds(container, state);
    updateQuickList(container, state, '');
  });

  // FAZ 12 Madde 8: Preset değişimi → state güncelle ve panel yenile
  const presetSel = container.querySelector('#composition-preset-select');
  if (presetSel) {
    presetSel.addEventListener('change', () => {
      state.compositionPreset = presetSel.value;
      renderRationBuilder(container, state, { onOptimize });
    });
  }

  // FAZ 14.12: Çok amaçlı ağırlık sürgüleri — anlık değer göstergesi + state kalıcılık
  container.querySelectorAll('.obj-weight').forEach(input => {
    input.addEventListener('input', () => {
      const valEl = container.querySelector(`.obj-weight-val[data-type="${input.dataset.type}"]`);
      if (valEl) valEl.textContent = input.value;
      state.objectiveWeights = { ...(state.objectiveWeights || {}), [input.dataset.type]: +input.value || 0 };
    });
  });

  // FAZ 17.4: Çok-amaçlı tek-tık preset (Yalnız maliyet / Dengeli) — keşfedilebilirlik.
  // Backend zaten çalışıyor (glpk weighted-sum); bu yalnız UI'da görünür kılar.
  const objWeightInputs = () => [...container.querySelectorAll('.obj-weight')];
  const syncObjPreset = () => {
    const active = objWeightInputs().some(i => (+i.value || 0) > 0) ? 'balanced' : 'cost';
    container.querySelectorAll('.obj-preset').forEach(b => {
      const on = b.dataset.preset === active;
      b.classList.toggle('btn-primary', on);
      b.classList.toggle('btn-secondary', !on);
    });
    // PROBLEMLER #4: çok-amaçlı aktifken tek hedef YOK SAYILIR (LP ağırlıklı toplamı kullanır)
    // → tek-hedef menüsünü devre dışı bırak + "yok sayılıyor" rozetini göster (net gösterge).
    const mob = active === 'balanced';
    const objSel = container.querySelector('#objective-select');
    if (objSel) objSel.disabled = mob;
    const badge = container.querySelector('#obj-mutex-badge');
    if (badge) badge.style.display = mob ? 'inline-flex' : 'none';
  };
  const applyObjPreset = (preset) => {
    const target = preset === 'balanced' ? 1 : 0;   // dengeli → cost/mfd/aa = 1; maliyet → 0
    objWeightInputs().forEach(input => {
      input.value = String(target);
      input.dispatchEvent(new Event('input', { bubbles: true }));  // mevcut handler state'i günceller
    });
    if (preset === 'balanced') {
      const ft = container.querySelector('#obj-finetune');
      if (ft) ft.open = true;   // ağırlıkları göster (şeffaflık — gizli bir şey yapmaz)
    }
    syncObjPreset();
  };
  container.querySelectorAll('.obj-preset').forEach(btn =>
    btn.addEventListener('click', () => applyObjPreset(btn.dataset.preset)));
  objWeightInputs().forEach(input => input.addEventListener('input', syncObjPreset));  // elle değişimde vurguyu güncelle

  // #12 düzeltmesi: kısıt panelindeki tüm girişleri (kompozisyon/maliyet/grup/amaç/KMT)
  // değiştikçe state'e yaz → sekme geçişinde sıfırlanmasın (optimize beklemeden korunur).
  const persistConstraints = () => {
    state.composition = readComposition(container);
    state.groupLimits = readGroupLimits(container);
    const cm = container.querySelector('#cost-max-input')?.value;
    state.costMax = (cm !== '' && cm != null) ? +cm : null;
    const objSel = container.querySelector('#objective-select');
    if (objSel) state.objective = objSel.value;
    const dmiSel = container.querySelector('#dmi-method-select');
    if (dmiSel) state.dmiMethod = dmiSel.value;
    const tolEl = container.querySelector('#dmi-tolerance-input');
    if (tolEl && tolEl.value !== '') state.dmiTolerancePct = +tolEl.value;
  };
  container.querySelectorAll('.comp-min, .comp-max, .comp-single, .group-min, .group-max, #cost-max-input, #objective-select, #dmi-method-select, #dmi-tolerance-input')
    .forEach(el => el.addEventListener('change', persistConstraints));

  // #2: Zorunlu (hard) kısıt kutuları → state.hardConstraints (kalıcı)
  container.querySelectorAll('.hard-cons').forEach(chk => {
    chk.addEventListener('change', () => {
      state.hardConstraints = [...container.querySelectorAll('.hard-cons:checked')].map(c => c.dataset.name);
      const rList = container.querySelector('#relax-priority-list');
      if (rList) rList.innerHTML = renderRelaxPriorityRows(currentRelaxOrder(state), state);
    });
  });

  // FAZ 22.1: Gevşetme önceliği — ▲▼ ile grup sırasını değiştir (state.relaxPriority kalıcı)
  const relaxListEl = container.querySelector('#relax-priority-list');
  if (relaxListEl) {
    const rerenderRelax = () => { relaxListEl.innerHTML = renderRelaxPriorityRows(currentRelaxOrder(state), state); };
    relaxListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.relax-up, .relax-down');
      if (!btn) return;
      const fullOrder = [...currentRelaxOrder(state)];
      const hardSet = new Set(state.hardConstraints || ['Forage']);
      const isVisible = k => !(RELAX_GROUP_TOKENS[k] || []).some(tk => hardSet.has(tk));
      const visibleOrder = fullOrder.filter(isVisible);

      const iVis = visibleOrder.indexOf(btn.dataset.key);
      const jVis = btn.classList.contains('relax-up') ? iVis - 1 : iVis + 1;
      if (iVis < 0 || jVis < 0 || jVis >= visibleOrder.length) return;

      const keyA = visibleOrder[iVis];
      const keyB = visibleOrder[jVis];

      const iFull = fullOrder.indexOf(keyA);
      const jFull = fullOrder.indexOf(keyB);
      [fullOrder[iFull], fullOrder[jFull]] = [fullOrder[jFull], fullOrder[iFull]];
      
      state.relaxPriority = fullOrder;
      rerenderRelax();
    });
    const relaxReset = container.querySelector('#relax-reset-btn');
    if (relaxReset) relaxReset.addEventListener('click', () => { state.relaxPriority = undefined; rerenderRelax(); });
  }

  // Optimize et
  container.querySelector('#optimize-btn').addEventListener('click', () => {
    handleOptimizeClick(container, state, onOptimize);
  });
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function refreshSelectedFeeds(container, state) {
  const area = container.querySelector('#selected-feeds-area');
  if (!area) return;

  if (state.selectedFeeds.length === 0) {
    area.innerHTML = `<div class="empty-state" style="padding:1rem">
      <div class="icon" style="font-size:1.5rem"><i class="ti ti-leaf"></i></div>
      <p>${t('ration.no_feeds')}</p>
    </div>`;
    return;
  }

  // FAZ 14.11: MILP değişken tipi seçenekleri (yem-başına)
  const MILP_TYPES = [
    { v: '',               label: t('ration.milp_continuous') },
    { v: 'semicontinuous', label: t('ration.milp_minorder') },
    { v: 'integer',        label: t('ration.milp_integer') },
  ];
  const milpOptions = (sel) => MILP_TYPES.map(mt =>
    `<option value="${mt.v}" ${(sel || '') === mt.v ? 'selected' : ''}>${mt.label}</option>`).join('');

  area.innerHTML = `
    <div class="selected-feeds-list">
      <div class="selected-feed-row selected-feed-head" style="font-weight:700; font-size:0.72rem; color:var(--text-muted)">
        <span></span><span>${t('ration.col_feed')}</span><span>${t('ration.col_min')}</span><span>${t('ration.col_max')}</span><span>${t('ration.col_type')} <span class="info-icon" title="${escHtml(t('ration.type_help'))}">ⓘ</span></span><span></span>
      </div>
      ${state.selectedFeeds.map((sf, i) => `
        <div class="selected-feed-row" data-idx="${i}">
          <span class="drag-handle" draggable="true">⠿</span>
          <span title="${sf.category}">${escHtml(feedDisplayName(sf))}</span>
          <input type="number" class="limit-min" min="0" step="0.1"
            value="${sf.minKg ?? ''}" placeholder="—" data-idx="${i}" />
          <input type="number" class="limit-max" min="0" step="0.1"
            value="${sf.maxKg ?? ''}" placeholder="—" data-idx="${i}" />
          <select class="milp-type" data-idx="${i}">${milpOptions(sf.milpType)}</select>
          <button class="remove-feed-btn" data-idx="${i}" aria-label="Kaldır"><i class="ti ti-x"></i></button>
        </div>
      `).join('')}
    </div>
    <div class="drag-hint text-small text-muted">${t('ration.drag_hint')}</div>`;

  area.querySelectorAll('.remove-feed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      state.selectedFeeds.splice(idx, 1);
      refreshSelectedFeeds(container, state);
      updateQuickList(container, state, container.querySelector('#quick-feed-search')?.value ?? '');
    });
  });

  area.querySelectorAll('.limit-min').forEach(input => {
    input.addEventListener('change', () => {
      const idx = +input.dataset.idx;
      state.selectedFeeds[idx].minKg = input.value !== '' ? +input.value : null;
    });
  });

  area.querySelectorAll('.limit-max').forEach(input => {
    input.addEventListener('change', () => {
      const idx = +input.dataset.idx;
      state.selectedFeeds[idx].maxKg = input.value !== '' ? +input.value : null;
    });
  });

  // FAZ 14.11: MILP değişken tipi (Sürekli / Min sipariş / Tam sayı)
  area.querySelectorAll('.milp-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = +sel.dataset.idx;
      state.selectedFeeds[idx].milpType = sel.value || null;
      // #3: 'Min sipariş' (semicontinuous) Min/Maks kg gerektirir; yoksa kullanıcıyı uyar
      if (sel.value === 'semicontinuous') {
        const sf = state.selectedFeeds[idx];
        if (!(sf.minKg > 0) || !(sf.maxKg > 0)) showToast(t('ration.milp_minorder_warn'), 'warn', 5000);
      }
    });
  });

  // FAZ 15.10: Sürükle-bırak ile yeniden sıralama (⠿ tutamacından)
  let dragSrcIdx = null;
  const rows = area.querySelectorAll('.selected-feed-row[data-idx]');
  rows.forEach(row => {
    const handle = row.querySelector('.drag-handle');
    if (handle) {
      handle.addEventListener('dragstart', (e) => {
        dragSrcIdx = +row.dataset.idx;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(dragSrcIdx)); } catch { /* Firefox guard */ }
      });
      handle.addEventListener('dragend', () => {
        dragSrcIdx = null;
        area.querySelectorAll('.selected-feed-row').forEach(r => r.classList.remove('dragging', 'drag-over'));
      });
    }
    row.addEventListener('dragover', (e) => {
      if (dragSrcIdx === null) return;   // ekleme sürüklemesi (text/feed-id) → alana bırak
      e.preventDefault();   // bırakmaya izin ver
      e.dataTransfer.dropEffect = 'move';
      if (+row.dataset.idx !== dragSrcIdx) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      if (dragSrcIdx === null) return;   // ekleme bırakması → alan drop handler'ı işler
      e.preventDefault();
      const from = dragSrcIdx;
      const to = +row.dataset.idx;
      row.classList.remove('drag-over');
      if (from === null || Number.isNaN(to) || from === to) return;
      moveSelectedFeed(state, from, to);
      refreshSelectedFeeds(container, state);   // idx'ler yeniden hesaplanır
    });
  });

  // Seçili yem sayısını başlıkta güncelle
  const title = container.querySelector('.card-title');
  if (title) {
    const span = title.querySelector('span');
    if (span) span.textContent = t('ration.feeds_selected', { n: state.selectedFeeds.length });
  }
}

/** FAZ 15.10: selectedFeeds dizisinde bir öğeyi `from`→`to` konumuna taşır. */
function moveSelectedFeed(state, from, to) {
  const arr = state.selectedFeeds;
  if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

function setupQuickSearch(container, state) {
  const input = container.querySelector('#quick-feed-search');
  if (!input) return;
  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => updateQuickList(container, state, input.value), 200);
  });
  updateQuickList(container, state, '');
}

function updateQuickList(container, state, query) {
  const listEl = container.querySelector('#quick-feed-list');
  if (!listEl) return;

  // FAZ 15.10: Türkçe-duyarsız + typo toleranslı fuzzy arama (feedService ile tutarlı)
  let feeds = _allFeeds;
  if (query.trim()) {
    feeds = feeds.filter(f => feedMatchesQuery(f, query));
  }
  const visible = feeds.slice(0, 60);

  if (visible.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="padding:0.75rem"><p>${t('ration.no_results')}</p></div>`;
    return;
  }

  listEl.innerHTML = visible.map(f => {
    const sel = !!state.selectedFeeds.find(s => s.id === f.id);
    return `
      <div class="feed-selection-item${sel ? ' selected' : ''}" data-id="${f.id}" draggable="true" title="${t('ration.drag_to_add')}">
        <input type="checkbox" ${sel ? 'checked' : ''} data-id="${f.id}" />
        <span class="feed-sel-name">${escHtml(feedDisplayName(f))}</span>
        <span class="feed-sel-cat">${catLabel(f.category)}</span>
      </div>`;
  }).join('');

  listEl.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.id;
      if (chk.checked) {
        addFeedToRation(container, state, id);
      } else {
        const idx = state.selectedFeeds.findIndex(s => s.id === id);
        if (idx !== -1) {
          state.selectedFeeds.splice(idx, 1);
          chk.closest('.feed-selection-item')?.classList.remove('selected');
          refreshSelectedFeeds(container, state);
        }
      }
    });
  });

  // FAZ 15.10 (denetim düzeltmesi): sürükle-bırak ile EKLEME — yem öğesi rasyona sürüklenir.
  // Reorder DnD 'text/plain' kullanır; ekleme 'text/feed-id' kullanır → çakışmaz.
  listEl.querySelectorAll('.feed-selection-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      try { e.dataTransfer.setData('text/feed-id', item.dataset.id); } catch { /* Firefox guard */ }
      e.dataTransfer.effectAllowed = 'copy';
    });
  });
}

/**
 * FAZ 15.10 (denetim düzeltmesi): bir yemi rasyona ekler (tıkla VEYA sürükle-bırak ortak yolu).
 * Zaten ekliyse veya bulunamazsa no-op. Eklerse her iki listeyi de tazeler.
 */
function addFeedToRation(container, state, id) {
  if (!id || state.selectedFeeds.find(s => s.id === id)) return false;
  const feed = _allFeeds.find(f => f.id === id);
  if (!feed) return false;
  state.selectedFeeds.push({ id: feed.id, name: feed.name, nameEn: feed.nameEn, category: feed.category, minKg: null, maxKg: null });
  refreshSelectedFeeds(container, state);
  updateQuickList(container, state, container.querySelector('#quick-feed-search')?.value ?? '');
  return true;
}

/**
 * FAZ 15.10 (denetim düzeltmesi): #selected-feeds-area'yı sürükle-bırak EKLEME hedefi yapar.
 * Bir kez kurulur (alan elementi kalıcı; yalnız innerHTML yenilenir). Yalnız 'text/feed-id'
 * taşıyan sürüklemelerde devreye girer → reorder ('text/plain') ile çakışmaz.
 */
function setupFeedDropZone(container, state) {
  const area = container.querySelector('#selected-feeds-area');
  if (!area || area.dataset.dropReady === '1') return;
  area.dataset.dropReady = '1';
  area.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('text/feed-id')) return;
    e.preventDefault();                       // ekleme sürüklemesine izin ver
    e.dataTransfer.dropEffect = 'copy';
    area.classList.add('drop-target');
  });
  area.addEventListener('dragleave', (e) => {
    if (!area.contains(e.relatedTarget)) area.classList.remove('drop-target');
  });
  area.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData('text/feed-id');
    area.classList.remove('drop-target');
    if (!id) return;                          // reorder bırakması → görmezden gel
    e.preventDefault();
    addFeedToRation(container, state, id);
  });
}

function constraintRow(key, label, defaults = {}, opts = {}) {
  // opts.minPh / opts.maxPh: placeholder metni (varsa dinamik hesaplanan değer)
  // opts.note: FAZ 12 Madde 8 — dynamic note (tooltip)
  const minPh = opts.minPh ?? t('ration.min_ph');
  const maxPh = opts.maxPh ?? t('ration.max_ph');
  const infoBtn = opts.note ? `<span class="info-icon" title="${escHtml(opts.note)}">ℹ️</span>` : '';
  // Madde 2: placeholder hesaplanan bir GEREKSİNİM ise (boş bıraksa da kısıt uygulanır) → ph-computed
  // (faint "ipucu" placeholder'dan görsel olarak ayrılır: koyu/italik + başlık ipucu).
  const minCls = opts.minComputed ? ' ph-computed' : '';
  const maxCls = opts.maxComputed ? ' ph-computed' : '';
  const compTitle = t('ration.computed_default_hint');
  return `
    <div class="constraint-row">
      <label>${label} ${infoBtn}</label>
      <div class="constraint-inputs">
        <input type="number" step="0.5" class="comp-min${minCls}" data-key="${key}"
          value="${defaults.min ?? ''}" placeholder="${minPh}"${minCls ? ` title="${escHtml(compTitle)}"` : ''} />
        <span>–</span>
        <input type="number" step="0.5" class="comp-max${maxCls}" data-key="${key}"
          value="${defaults.max ?? ''}" placeholder="${maxPh}"${maxCls ? ` title="${escHtml(compTitle)}"` : ''} />
      </div>
    </div>`;
}

// FAZ 14.7: Yem grup (kategori) sınırı satırı — min/max kg KM
function groupLimitRow(category, label, state) {
  const saved = state.groupLimits?.[category] || {};
  return `
    <div class="constraint-row">
      <label>${escHtml(label)}</label>
      <div class="constraint-inputs">
        <input type="number" step="0.5" min="0" class="group-min" data-group="${category}"
          value="${saved.min ?? ''}" placeholder="${t('ration.min_ph')}" />
        <span>–</span>
        <input type="number" step="0.5" min="0" class="group-max" data-group="${category}"
          value="${saved.max ?? ''}" placeholder="${t('ration.max_ph')}" />
      </div>
    </div>`;
}

// FAZ 14.12: Çok amaçlı ağırlık sürgüsü satırı (0-5)
function objWeightRow(type, label, state) {
  const w = state.objectiveWeights?.[type] ?? 0;
  return `
    <div class="obj-weight-row">
      <label>${escHtml(label)}</label>
      <input type="range" class="obj-weight" data-type="${type}" min="0" max="5" step="0.5" value="${w}" />
      <span class="obj-weight-val" data-type="${type}">${w}</span>
    </div>`;
}

// FAZ 14.12: UI'dan çok amaçlı ağırlıkları oku → [{type, weight}] | null (hepsi 0 ise)
function readObjectives(container) {
  const weights = {};
  let any = false;
  container.querySelectorAll('.obj-weight').forEach(input => {
    const w = +input.value || 0;
    weights[input.dataset.type] = w;
    if (w > 0) any = true;
  });
  if (!any) return { objectives: null, weights };  // çok amaçlı kapalı → tek amaç kullanılır
  const objectives = Object.entries(weights)
    .filter(([, w]) => w > 0)
    .map(([type, weight]) => ({ type, weight }));
  return { objectives, weights };
}

// FAZ 14.7: UI'dan kategori grup limitlerini oku → { [category]: { min?, max? } }
function readGroupLimits(container) {
  const groups = {};
  container.querySelectorAll('.group-min').forEach(input => {
    const cat = input.dataset.group;
    if (input.value !== '') (groups[cat] ??= {}).min = +input.value;
  });
  container.querySelectorAll('.group-max').forEach(input => {
    const cat = input.dataset.group;
    if (input.value !== '') (groups[cat] ??= {}).max = +input.value;
  });
  for (const k of Object.keys(groups)) {
    if (Object.keys(groups[k]).length === 0) delete groups[k];
  }
  return groups;
}

function renderAnimalSummary(a) {
  return `
    <div style="font-size:0.83rem; display:grid; grid-template-columns:1fr 1fr; gap:0.3rem 1rem">
      <span class="text-muted">${t('ration.sum_bw')}</span><span><b>${a.bw} kg</b></span>
      <span class="text-muted">${t('ration.sum_milk')}</span><span><b>${a.milkYield} ${t('ration.kg_per_day')}</b></span>
      <span class="text-muted">${t('ration.sum_fat_protein')}</span><span><b>${a.milkFat}% / ${a.milkProtein}%</b></span>
      <span class="text-muted">${t('ration.sum_dim_parity')}</span><span><b>${a.dim} ${t('ration.sum_days')} / ${a.parity}</b></span>
      <span class="text-muted">${t('ration.sum_bcs')}</span><span><b>${a.bcs}</b></span>
      ${a.pregnant ? `<span class="text-muted">${t('ration.sum_pregnancy')}</span><span><b>${t('ration.sum_month', { n: a.pregnancyMonth })}</b></span>` : ''}
    </div>`;
}

function readComposition(container) {
  const comp = {};
  container.querySelectorAll('.comp-min').forEach(input => {
    const key = input.dataset.key;
    if (!comp[key]) comp[key] = {};
    if (input.value !== '') comp[key].min = +input.value;
  });
  container.querySelectorAll('.comp-max').forEach(input => {
    const key = input.dataset.key;
    if (!comp[key]) comp[key] = {};
    if (input.value !== '') comp[key].max = +input.value;
  });
  // PROBLEMLER #3: tekil (skaler) değerler — TMR hedef nem / rasyondan min nem
  container.querySelectorAll('.comp-single').forEach(input => {
    if (input.value !== '') comp[input.dataset.key] = +input.value;
  });
  // Temizle: yalnız boş OBJECT'leri sil (skalerleri koru)
  for (const k of Object.keys(comp)) {
    const v = comp[k];
    if (v && typeof v === 'object' && Object.keys(v).length === 0) delete comp[k];
  }
  return comp;
}

async function handleOptimizeClick(container, state, onOptimize) {
  const statusEl = container.querySelector('#ration-status');

  if (state.selectedFeeds.length === 0) {
    statusEl.innerHTML = `<div class="warn-box">${t('ration.select_feed_warn')}</div>`;
    return;
  }

  if (!state.animal.bw || state.animal.milkYield == null) {
    statusEl.innerHTML = `<div class="warn-box">${t('ration.profile_missing_warn')}</div>`;
    return;
  }

  statusEl.innerHTML = '';

  // Seçili yemlerin tam nesnelerini DB'den çek
  const feedIds = state.selectedFeeds.map(sf => sf.id);
  const allFeeds = _allFeeds;
  const feeds = feedIds.map(id => allFeeds.find(f => f.id === id)).filter(Boolean);

  // Feed limitleri (+ FAZ 14.11 MILP tipi: semicontinuous / integer)
  const feedLimits = {};
  for (const sf of state.selectedFeeds) {
    if (sf.minKg !== null || sf.maxKg !== null || sf.milpType) {
      const lim = { min: sf.minKg ?? undefined, max: sf.maxKg ?? undefined };
      if (sf.milpType) lim.type = sf.milpType;  // 'semicontinuous' | 'integer'
      feedLimits[sf.id] = lim;
    }
  }

  const composition = readComposition(container);
  // denetim #2: trace_*/vit_* düz anahtarlarını LP'nin beklediği iç içe yapıya çevir
  // (composition.traceMinerals / composition.vitamins → buildTrace/VitaminRequirement override).
  {
    const traceMinerals = {}, vitamins = {}, aminoAcids = {};
    for (const key of Object.keys(composition)) {
      const v = composition[key];
      if (!v || (v.min == null && v.max == null)) continue;
      if (key.startsWith('trace_'))      { traceMinerals[key.slice(6)] = v; delete composition[key]; }
      else if (key.startsWith('vit_'))   { vitamins[key.slice(4)] = v;      delete composition[key]; }
      else if (key.startsWith('macro_')) { composition[key.slice(6)] = v;   delete composition[key]; }  // #1: macro_ca → ca
      else if (key === 'aa_lys')         { aminoAcids.lys_g = { min: v.min }; delete composition[key]; }  // #1
      else if (key === 'aa_met')         { aminoAcids.met_g = { min: v.min }; delete composition[key]; }
      else if (key === 'aa_his')         { aminoAcids.his_g = { min: v.min }; delete composition[key]; }  // FAZ 18.3: His override
      else if (/^aa_(arg|thr|ile|leu|val|phe|trp)$/.test(key)) {  // Tam EAA Katman B: 7 EAA opt-in override
        aminoAcids[key.slice(3) + '_g'] = { min: v.min }; delete composition[key];
      }
    }
    if (Object.keys(traceMinerals).length) composition.traceMinerals = traceMinerals;
    if (Object.keys(vitamins).length)      composition.vitamins = vitamins;
    if (Object.keys(aminoAcids).length)    composition.aminoAcids = aminoAcids;
  }
  const groupLimits = readGroupLimits(container);   // FAZ 14.7: kategori grup sınırları
  state.groupLimits = groupLimits;                  // panel yenilenince korunsun
  const objective = container.querySelector('#objective-select').value;
  // FAZ 14.12: çok amaçlı ağırlıklar (herhangi ≥1 ise tek amaç yerine weighted sum)
  const { objectives, weights } = readObjectives(container);
  state.objectiveWeights = weights;                 // kalıcılık
  const dmiMethod = container.querySelector('#dmi-method-select').value;
  const preset = container.querySelector('#composition-preset-select')?.value || 'recommended';
  // FAZ 14.13: maliyet tavanı (boş → sınırsız)
  const costMaxRaw = container.querySelector('#cost-max-input')?.value;
  const costMax = costMaxRaw !== '' && costMaxRaw != null ? +costMaxRaw : undefined;
  state.costMax = costMax ?? null;

  // denetim #7: KMT tolerans bandı (% → oran). 0-20 arası clamp; boş/geçersiz → %3.
  const tolRaw = container.querySelector('#dmi-tolerance-input')?.value;
  const tolPct = (tolRaw !== '' && tolRaw != null && Number.isFinite(+tolRaw)) ? Math.min(Math.max(+tolRaw, 0), 20) : 3;
  state.dmiTolerancePct = tolPct;
  const dmiSlack = tolPct / 100;

  // #2: Zorunlu (hard) kısıtlar — infeasibility'de gevşetilmez
  const hardConstraints = [...container.querySelectorAll('.hard-cons:checked')].map(c => c.dataset.name);
  state.hardConstraints = hardConstraints;

  // FAZ 22.1: kullanıcı gevşetme önceliğini değiştirdiyse token listesine açıp geçir (aksi default).
  const relaxPriority = Array.isArray(state.relaxPriority) && state.relaxPriority.length
    ? expandRelaxPriority(currentRelaxOrder(state)) : undefined;

  await onOptimize({
    animal: state.animal,
    feeds,
    feedLimits,
    composition,
    groupLimits,
    objective,
    objectives,   // FAZ 14.12: null ise tek amaç (objective) kullanılır
    costMax,      // FAZ 14.13: maliyet tavanı (undefined → sınırsız)
    dmiMethod,
    preset,
    dmiSlack,     // denetim #7: KMT tolerans bandı (±oran)
    hardConstraints,  // #2: zorunlu kısıtlar
    relaxPriority,    // FAZ 22.1: gevşetme öncelik sırası (undefined → RELAX_PRIORITY default)
  });
}

