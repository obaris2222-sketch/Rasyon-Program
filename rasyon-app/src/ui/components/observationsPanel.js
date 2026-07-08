/**
 * Saha Gözlem Paneli (FAZ 11B)
 *
 * Kayıtlı hayvan profilleri için haftalık gözlem kaydı + trend analizi.
 * Tahmin vs gerçek performans karşılaştırması.
 */

import {
  animalProfileGetAll, rationGetById, rationGetAll,
  observationAdd, observationGetByProfile, observationDelete, observationDeleteByProfile,
} from '../../data/db.js';
import { analyzeObservations, performanceGrade } from '../../core/observationAnalysis.js';
import { resolveDmiMethod } from '../../core/animalRequirements.js';  // FAZ 17.3: tahmini KMT bilim sistemiyle tutarlı
import { validateDmiForProfile, validateDmiAcrossProfiles, validatePredictionForProfile, VALIDATION_MIN_SAMPLES } from '../../core/validation.js';  // FAZ 19.3 + 22.2: model validasyon (RMSE/bias + çok-profil R²)
import { runDiagnostic } from '../../core/calibrationEngine.js'; // FAZ 3
import { showCalibrationModal } from './calibrationModal.js'; // FAZ 4
import { getSettings } from '../../data/settings.js';
import { showToast, escHtml } from '../utils.js';
import { t } from '../i18n.js';
import { validateFormElement, attachLiveValidation, summarizeErrors } from '../validation.js';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// FAZ 15.9 — Gözlem formu alan eşlemesi (input name → FIELD_RULES anahtarı)
const OBSERVATION_FIELD_BINDINGS = [
  { name: 'milkYield', rule: 'obs_milkYield' },
  { name: 'milkFat', rule: 'obs_milkFat' },
  { name: 'milkProtein', rule: 'obs_milkProtein' },
  { name: 'bcs', rule: 'obs_bcs' },
  { name: 'dmiActual', rule: 'obs_dmiActual' },
  { name: 'methane', rule: 'obs_methane' },
  { name: 'rumenPh', rule: 'obs_rumenPh' },
  { name: 'mun', rule: 'obs_mun' },
  { name: 'manureScore', rule: 'obs_manureScore' },
];

// FAZ 15.6: trend + karşılaştırma grafik örnekleri (yeniden çizimde destroy edilir)
let _obsTrendChart = null;
let _obsCompareChart = null;

/**
 * Saha gözlem zaman serisi + tahmin-vs-gerçek grafiklerini çizer.
 * @param {object[]} observations — tarih sıralı (yeniden eskiye) gözlemler
 * @param {object} analysis — analyzeObservations çıktısı (myDelta/dmiDelta)
 */
function drawObservationCharts(observations, analysis) {
  if (_obsTrendChart) { _obsTrendChart.destroy(); _obsTrendChart = null; }
  if (_obsCompareChart) { _obsCompareChart.destroy(); _obsCompareChart = null; }

  // ── Zaman serisi (kronolojik: eski → yeni) ──
  const series = [...observations].reverse();
  const trendCanvas = document.getElementById('obs-trend-chart');
  if (trendCanvas && series.length >= 2) {
    const labels = series.map(o => new Date(o.date).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }));
    _obsTrendChart = new Chart(trendCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: t('obs.chart_milk'), yAxisID: 'y',
            data: series.map(o => Number.isFinite(o.milkYield) ? o.milkYield : null),
            borderColor: 'rgba(29,78,216,1)', backgroundColor: 'rgba(29,78,216,0.12)',
            borderWidth: 2, tension: 0.3, pointRadius: 3, fill: true, spanGaps: true,
          },
          {
            label: t('obs.chart_real_dmi'), yAxisID: 'y',
            data: series.map(o => Number.isFinite(o.dmiActual) ? o.dmiActual : null),
            borderColor: 'rgba(240,165,0,1)', backgroundColor: 'rgba(240,165,0,0.10)',
            borderWidth: 2, tension: 0.3, pointRadius: 3, borderDash: [5, 4], fill: false, spanGaps: true,
          },
          {
            label: t('obs.chart_bcs'), yAxisID: 'y1',
            data: series.map(o => Number.isFinite(o.bcs) ? o.bcs : null),
            borderColor: 'rgba(58,134,208,1)', backgroundColor: 'rgba(58,134,208,0.10)',
            borderWidth: 2, tension: 0.3, pointRadius: 3, fill: false, spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14 } } },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } },
          y: { position: 'left', title: { display: true, text: t('obs.chart_kgday'), font: { size: 10 } }, ticks: { font: { size: 10 } } },
          y1: {
            position: 'right', min: 2, max: 5, title: { display: true, text: 'BCS', font: { size: 10 } },
            grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } }
          },
        },
      },
    });
  }

  // ── Tahmin vs Gerçek (bar) ──
  const cmpCanvas = document.getElementById('obs-compare-chart');
  const hasCmp = analysis && (analysis.myDelta || analysis.dmiDelta);
  if (cmpCanvas && hasCmp) {
    const cats = [], predicted = [], actual = [];
    if (analysis.myDelta) { cats.push(t('obs.t_milk')); predicted.push(analysis.myDelta.predicted); actual.push(analysis.myDelta.actual); }
    if (analysis.dmiDelta) { cats.push('KMT'); predicted.push(analysis.dmiDelta.predicted); actual.push(analysis.dmiDelta.actual); }
    _obsCompareChart = new Chart(cmpCanvas, {
      type: 'bar',
      data: {
        labels: cats,
        datasets: [
          { label: t('obs.chart_pred'), data: predicted, backgroundColor: 'rgba(58,134,208,0.7)', borderRadius: 3 },
          { label: t('obs.chart_actual'), data: actual, backgroundColor: 'rgba(29,78,216,0.75)', borderRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14 } } },
        scales: { x: { ticks: { font: { size: 11 } } }, y: { beginAtZero: true, title: { display: true, text: t('obs.chart_kgday'), font: { size: 10 } } } },
      },
    });
  }
}

export async function renderObservationsPanel(container, state) {
  const [profiles, allRations] = await Promise.all([
    animalProfileGetAll().catch(() => []),
    rationGetAll().catch(() => [])
  ]);

  if (profiles.length === 0) {
    container.innerHTML = `
      <!-- 📖 Sekme Yardımı -->
      <details class="tab-help-accordion" style="margin-bottom:0.75rem">
        <summary style="cursor:pointer; font-weight:600; color:var(--primary); display:flex; align-items:center; gap:0.4rem">
          <i class="ti ti-info-circle"></i> Bu sekme ne işe yarar? <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted); margin-left:auto">▾</span>
        </summary>
        <div class="info-box" style="margin-top:0.5rem; font-size:0.85rem; line-height:1.7">
          <b>📈 Saha Gözlem Paneli</b> — Hayvanlarınızın gerçek sahadaki performansını (süt verimi, KM tüketimi, kondisyon vb.) kaydeder ve programın tahminleriyle kıyaslar.<br>
          • <b>Yeni Kayıt / İçe Aktar:</b> Günlük veya haftalık ölçümlerinizi forma girebilir veya CSV dosyasından topluca aktarabilirsiniz.<br>
          • <b>Tahmin vs Gerçek:</b> Programın "Rasyon Kurucu"da tahmin ettiği süt verimi veya tüketim ile sizin sahadan girdiğiniz gerçek rakamları grafik üzerinde karşılaştırır.<br>
          • <b>Trend Analizi:</b> Kondisyon skoru (BCS) veya verim düşüşlerini tespit ederek size erken uyarılar üretir.<br>
          • <b>Sürü Validasyonu:</b> Modelin çiftliğinizdeki doğruluğunu (RMSE, Hata payı) ölçer ve programı kalibre etmenize yardımcı olur.
        </div>
      </details>

      <div class="card">
        <div class="card-title">${t('obs.title')}</div>
        <div class="empty-state" style="padding:2.5rem">
          <div class="icon"><i class="ti ti-clipboard-list"></i></div>
          <p>${t('obs.empty_no_profile')}</p>
          <p class="mt-1">${t('obs.add_profile_first')}</p>
        </div>
      </div>`;
    return;
  }

  // Aktif profil seçimi (state'ten ya da ilkinden)
  let activeProfileId = state.activeObservationProfileId || profiles[0].id;
  let activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];

  container.innerHTML = `
    <!-- 📖 Sekme Yardımı -->
    <details class="tab-help-accordion" style="margin-bottom:0.75rem">
      <summary style="cursor:pointer; font-weight:600; color:var(--primary); display:flex; align-items:center; gap:0.4rem">
        <i class="ti ti-info-circle"></i> Bu sekme ne işe yarar? <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted); margin-left:auto">▾</span>
      </summary>
      <div class="info-box" style="margin-top:0.5rem; font-size:0.85rem; line-height:1.7">
        <b>📈 Saha Gözlem Paneli</b> — Hayvanlarınızın gerçek sahadaki performansını (süt verimi, KM tüketimi, kondisyon vb.) kaydeder ve programın tahminleriyle kıyaslar.<br>
        • <b>Yeni Kayıt / İçe Aktar:</b> Günlük veya haftalık ölçümlerinizi forma girebilir veya CSV dosyasından topluca aktarabilirsiniz.<br>
        • <b>Tahmin vs Gerçek:</b> Programın "Rasyon Kurucu"da tahmin ettiği süt verimi veya tüketim ile sizin sahadan girdiğiniz gerçek rakamları grafik üzerinde karşılaştırır.<br>
        • <b>Trend Analizi:</b> Kondisyon skoru (BCS) veya verim düşüşlerini tespit ederek size erken uyarılar üretir.<br>
        • <b>Sürü Validasyonu:</b> Modelin çiftliğinizdeki doğruluğunu (RMSE, Hata payı) ölçer ve programı kalibre etmenize yardımcı olur.
      </div>
    </details>

    <div class="card">
      <div class="card-title">${t('obs.title')}
        <span class="text-small text-muted" style="font-weight:400;margin-left:auto">
          ${t('obs.n_profiles', { n: profiles.length })}
        </span>
      </div>

      <div class="info-box">
        ${t('obs.info')}
        <br>${t('obs.typical')}
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label>${t('obs.select_profile')}</label>
          <select id="obs-profile-select">
            ${profiles.map(p => `<option value="${escHtml(p.id)}" ${p.id === activeProfileId ? 'selected' : ''}>
              ${escHtml(p.name)} (${p.milkYield ?? '?'} kg/gün, DIM ${p.dim ?? '?'})
            </option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Kullanılacak Rasyon</label>
          <select id="obs-ration-select">
            <!-- JavaScript ile doldurulacak -->
          </select>
        </div>
      </div>
    </div>

    <!-- Yeni gözlem ekleme formu -->
    <div class="card mt-2">
      <div class="card-title" style="display:flex; align-items:center;">
        ${t('obs.add_obs')}
        <label for="obs-csv-upload" class="btn btn-sm btn-secondary" style="margin-left:auto; cursor:pointer;" title="${t('obs.csv_import_title')}">${t('obs.csv_import')}</label>
        <input type="file" id="obs-csv-upload" accept=".csv,.json" style="display:none;" />
      </div>
      <form id="obs-form" novalidate>
        <div class="form-grid">
          <div class="form-group">
            <label>${t('obs.date')}</label>
            <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" required />
          </div>
          <div class="form-group">
            <label>${t('obs.milk')}</label>
            <input type="number" name="milkYield" min="0" max="80" step="0.5" placeholder="${t('obs.milk_ph')}" required />
          </div>
          <div class="form-group">
            <label>${t('obs.fat')}</label>
            <input type="number" name="milkFat" min="2" max="6" step="0.1" placeholder="${t('obs.fat_ph')}" />
          </div>
          <div class="form-group">
            <label>${t('obs.protein')}</label>
            <input type="number" name="milkProtein" min="2" max="4.5" step="0.1" placeholder="${t('obs.protein_ph')}" />
          </div>
          <div class="form-group">
            <label>${t('obs.bcs')}</label>
            <input type="number" name="bcs" min="1" max="5" step="0.25" placeholder="${t('obs.bcs_ph')}" />
          </div>
          <div class="form-group">
            <label>${t('obs.dmi')}</label>
            <input type="number" name="dmiActual" min="5" max="40" step="0.5" placeholder="${t('obs.dmi_ph')}" />
          </div>
          <div class="form-group">
            <label>${t('obs.methane')}</label>
            <input type="number" name="methane" min="0" max="1000" step="1" placeholder="${t('obs.methane_ph')}" />
          </div>
          <div class="form-group">
            <label>${t('obs.rumen_ph')}</label>
            <input type="number" name="rumenPh" min="4" max="7.5" step="0.01" placeholder="${t('obs.rumen_ph_ph')}" />
          </div>
          <div class="form-group">
            <label>${t('obs.mun') || 'MUN (mg/dL)'}</label>
            <input type="number" name="mun" min="0" max="40" step="0.1" placeholder="10-16" />
          </div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:0.25rem;">
              ${t('obs.manure_score') || 'Dışkı Skoru'}
              <i class="ti ti-info-circle text-primary" style="cursor:pointer;" title="Skor detaylarını görmek için tıklayın" onclick="alert('Dışkı Skoru (1-5)\\n\\n1: Çok cıvık, su gibi (Asidoz/İshal)\\n2: İnce, cıvık, vıcık vıcık (Hızlı rumen geçişi, taze bahar otu)\\n3: İDEAL. Lapa gibi, ortası hafif çukur, yavaşça yayılır (Sağlıklı rumen)\\n4: Koyu ve kuru, üst üste katmanlanır (Geç laktasyon, yüksek kaba yem)\\n5: Çok sert ve kuru topaklar (Susuzluk, tıkanıklık, aşırı düşük kalite kaba yem)')"></i>
            </label>
            <input type="number" name="manureScore" min="1" max="5" step="0.25" placeholder="1-5" />
          </div>
          <div class="form-group full-width">
            <label>${t('obs.notes')}</label>
            <input type="text" name="notes" placeholder="${t('obs.notes_ph')}" />
          </div>
        </div>
        <div class="flex gap-1 mt-1">
          <button type="submit" class="btn btn-primary btn-sm">${t('obs.save_obs')}</button>
          <button type="button" class="btn btn-danger btn-sm" id="btn-clear-obs">${t('obs.clear_obs')}</button>
        </div>
      </form>
    </div>

    <!-- Analiz + trend -->
    <div class="card mt-2" id="obs-analysis-card">
      <div class="card-title" style="display:flex; align-items:center;">
        ${t('obs.perf_analysis')}
        <button class="btn btn-sm btn-primary" id="btn-run-calibration" style="margin-left:auto;"><i class="ti ti-stethoscope"></i> Kalibrasyon Teşhisini Başlat</button>
      </div>
      <div id="obs-analysis-content"><p class="text-muted">${t('obs.loading')}</p></div>
    </div>

    <!-- Kayıt geçmişi -->
    <div class="card mt-2">
      <div class="card-title">${t('obs.record_history')}</div>
      <div id="obs-history-content"><p class="text-muted">${t('obs.loading')}</p></div>
    </div>

    <!-- FAZ 22.2: Sürü-geneli (çok-profil) KMT validasyonu — değişken tahmin → anlamlı R² -->
    <div class="card mt-2" id="herd-validation-card">
      <div class="card-title">${t('obs.herd_val_title')}<span class="badge badge-display">${t('results.display_badge')}</span></div>
      <div id="herd-validation-content"><p class="text-muted">${t('obs.herd_val_loading')}</p></div>
    </div>
  `;

  function updateRationSelect(profileId) {
    const rationSelect = container.querySelector('#obs-ration-select');
    if (!rationSelect) return;
    
    const profileRations = allRations.filter(r => r.animal?.id === profileId || r.animal?._profileId === profileId);
    profileRations.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    
    let html = `<option value="current">Mevcut (Yeni Çözülmüş) Rasyon</option>`;
    for (const r of profileRations) {
      const d = r.savedAt ? new Date(r.savedAt).toLocaleDateString() : '';
      const name = escHtml(r.name || 'İsimsiz Rasyon');
      html += `<option value="${r.id}">${name} ${d ? '('+d+')' : ''}</option>`;
    }
    rationSelect.innerHTML = html;
  }

  updateRationSelect(activeProfile.id);

  await refreshAnalysis(container, activeProfile, state);
  // FAZ 22.2: sürü-geneli validasyon — tüm profillerin gözlemlerini topla (profil bağımsız).
  renderHerdValidation(container, profiles).catch(() => { });

  // Profil değişimi
  container.querySelector('#obs-profile-select').addEventListener('change', async (e) => {
    const id = e.target.value;
    state.activeObservationProfileId = id;
    activeProfile = profiles.find(p => p.id === id);
    updateRationSelect(activeProfile.id);
    await refreshAnalysis(container, activeProfile, state);
  });

  // Rasyon değişimi
  container.querySelector('#obs-ration-select')?.addEventListener('change', async () => {
    await refreshAnalysis(container, activeProfile, state);
  });

  // Yeni gözlem formu — canlı validasyon (FAZ 15.9)
  attachLiveValidation(container.querySelector('#obs-form'), OBSERVATION_FIELD_BINDINGS);

  container.querySelector('#obs-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    // FAZ 15.9: Submit öncesi validasyon — ihlal varsa toast + focus
    const validation = validateFormElement(e.target, OBSERVATION_FIELD_BINDINGS);
    if (!validation.ok) {
      showToast(summarizeErrors(validation.errors), 'warn');
      return;
    }
    const fd = new FormData(e.target);
    const date = fd.get('date');
    try {
      await observationAdd({
        profileId: activeProfile.id,
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        milkYield: !Number.isNaN(parseFloat(fd.get('milkYield'))) ? parseFloat(fd.get('milkYield')) : null,
        milkFat: !Number.isNaN(parseFloat(fd.get('milkFat'))) ? parseFloat(fd.get('milkFat')) : null,
        milkProtein: !Number.isNaN(parseFloat(fd.get('milkProtein'))) ? parseFloat(fd.get('milkProtein')) : null,
        bcs: !Number.isNaN(parseFloat(fd.get('bcs'))) ? parseFloat(fd.get('bcs')) : null,
        dmiActual: !Number.isNaN(parseFloat(fd.get('dmiActual'))) ? parseFloat(fd.get('dmiActual')) : null,
        methane: !Number.isNaN(parseFloat(fd.get('methane'))) ? parseFloat(fd.get('methane')) : null,
        rumenPh: !Number.isNaN(parseFloat(fd.get('rumenPh'))) ? parseFloat(fd.get('rumenPh')) : null,
        notes: fd.get('notes') || '',
      });
      showToast(t('obs.saved'), 'success');
      e.target.reset();
      // Tarihi yine bugünle doldur (reset sonrası)
      e.target.querySelector('[name="date"]').value = new Date().toISOString().slice(0, 10);
      await refreshAnalysis(container, activeProfile, state);
    } catch (err) {
      console.error(err);
      showToast(t('obs.save_err') + err.message, 'error');
    }
  });

  // CSV Import Listener (FAZ 16.13)
  const csvUploadInput = container.querySelector('#obs-csv-upload');
  if (csvUploadInput) {
    csvUploadInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      showToast(t('obs.csv_reading'), 'info');
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const text = ev.target.result;
          // FAZ 16.13: CSV veya JSON — uzantı/içeriğe göre otomatik yönlendirme
          const { parseObservationFile } = await import('../../core/observationImporter.js');
          const { results, errors } = parseObservationFile(text, file.name);

          if (results.length === 0) {
            showToast(t('obs.csv_no_data'), 'error');
            return;
          }

          if (errors.length > 0) {
            console.warn('CSV Parse hataları:', errors);
            showToast(t('obs.csv_skipped', { n: errors.length }), 'warn');
          }

          let addedCount = 0;
          for (const row of results) {
            await observationAdd({
              profileId: activeProfile.id,
              date: row.date,
              milkYield: row.milkYield || 0,
              milkFat: row.milkFat || null,
              milkProtein: row.milkProtein || null,
              bcs: row.bcs || null,
              dmiActual: row.dmiActual || null,
              methane: row.methane || null,
              rumenPh: row.rumenPh || null,
              notes: row.notes || 'CSV Import'
            });
            addedCount++;
          }

          showToast(t('obs.csv_added', { n: addedCount }), 'success');
          await refreshAnalysis(container, activeProfile, state);
        } catch (err) {
          showToast(t('obs.csv_err') + err.message, 'error');
        } finally {
          csvUploadInput.value = ''; // Reset input
        }
      };
      reader.onerror = () => showToast(t('obs.csv_read_err'), 'error');
      reader.readAsText(file);
    });
  }

  // Toplu silme
  container.querySelector('#btn-clear-obs').addEventListener('click', async () => {
    if (!confirm(t('obs.confirm_clear', { name: activeProfile.name }))) return;
    await observationDeleteByProfile(activeProfile.id);
    showToast(t('obs.all_deleted'), 'success');
    await refreshAnalysis(container, activeProfile, state);
  });

  // FAZ 4: Kalibrasyon Teşhis Butonu
  const btnRunCalib = container.querySelector('#btn-run-calibration');
  if (btnRunCalib) {
    btnRunCalib.addEventListener('click', async () => {
      try {
        const observations = await observationGetByProfile(activeProfile.id);
        const rationSelect = container.querySelector('#obs-ration-select');
        let selectedRation = state.latestResult?.composition || {};
        
        if (rationSelect && rationSelect.value !== 'current') {
          const r = await rationGetById(rationSelect.value);
          if (r) {
            selectedRation = {
              dmi_kg: r.dmi,
              milkYield: r.milkYield || activeProfile.milkYield,
              ...r
            };
          }
        }
        
        const diagResult = runDiagnostic(activeProfile, observations, selectedRation);
        showCalibrationModal(diagResult, activeProfile.id, () => {
          // Modal kapandıktan sonra (veya uygulandıktan sonra) analizi yenile
          refreshAnalysis(container, activeProfile, state);
        });
      } catch (err) {
        console.error(err);
        showToast('Teşhis çalıştırılırken bir hata oluştu.', 'error');
      }
    });
  }
}

async function refreshAnalysis(container, profile, state) {
  const analysisEl = container.querySelector('#obs-analysis-content');
  const historyEl = container.querySelector('#obs-history-content');
  if (!analysisEl || !historyEl) return;

  try {
    const observations = await observationGetByProfile(profile.id);
    // FAZ 17.3: tahmini KMT'yi optimizer ile aynı yöntemle hesapla (NASEM/INRA → de Souza).
    const sci = getSettings().science || {};
    const dmiMethod = resolveDmiMethod(sci.dmiMethod, sci.system);
    const analysis = analyzeObservations(observations, profile, { dmiMethod });
    // FAZ 19.3: KMT tahmin doğruluğu (RMSE/bias) — gözlemler birikince model validasyonu
    const validations = {
      dmi: validateDmiForProfile(observations, profile, { dmiMethod }),
      methane: null,
      rumenPh: null,
      milkFat: null
    };

    let res = null;

    const rationSelect = container.querySelector('#obs-ration-select');
    const selectedRationId = rationSelect ? rationSelect.value : 'current';

    if (selectedRationId === 'current') {
      // 1. Öncelik: Aynı oturumda az önce çözülmüş rasyon sonucu
      const optimizedProfileId = state.lastOptimizedAnimal?.id || state.lastOptimizedAnimal?._profileId;
      if (state?.rationResult && optimizedProfileId === profile.id) {
        res = state.rationResult;
      }
      // Yedek: Eğer 'current' seçili ama state'te rasyon yoksa, DB'den profildeki targetRationId'ye bak
      if (!res && profile.targetRationId) {
        const savedRation = await rationGetById(profile.targetRationId);
        if (savedRation && savedRation.result) {
          res = savedRation.result;
        }
      }
    } else {
      // Dropdown'dan spesifik bir kayıtlı rasyon seçilmiş
      const savedRation = await rationGetById(selectedRationId);
      if (savedRation && savedRation.result) {
        res = savedRation.result;
      }
    }

    if (res) {
      if (res.methane && res.methane.production_g) {
        validations.methane = validatePredictionForProfile(observations, res.methane.production_g, 'methane');
      }
      if (res.rumenDynamics?.meanPH) {
        validations.rumenPh = validatePredictionForProfile(observations, res.rumenDynamics.meanPH, 'rumenPh');
      }
      if (res.fattyAcids?.milk?.estimatedMilkFatPct) {
        validations.milkFat = validatePredictionForProfile(observations, res.fattyAcids.milk.estimatedMilkFatPct, 'milkFat');
      }
      // Eski formatta kaydedilmiş rasyonlarda methane/rumenDynamics/fattyAcids alanları yok
      if (!res.methane && !res.rumenDynamics && !res.fattyAcids) {
        validations._rationMissingPredictions = true;
      }
    }

    const hasRationResult = !!res;
    analysisEl.innerHTML = renderAnalysis(analysis, validations, state, profile, hasRationResult);
    historyEl.innerHTML = renderHistory(observations);

    // FAZ 15.6: trend + tahmin-vs-gerçek grafiklerini çiz (innerHTML sonrası)
    if (!analysis.empty) drawObservationCharts(observations, analysis);

    // Sil butonları
    historyEl.querySelectorAll('.btn-del-obs').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('obs.confirm_del'))) return;
        await observationDelete(btn.dataset.id);   // FAZ 16.10: UUID string (eski +sayısal NaN bug'ı)
        showToast(t('obs.deleted'), 'success');
        await refreshAnalysis(container, profile, state);
      });
    });

    // Yeni gözlem eklendiğinde/silindiğinde Sürü Geneli Validasyonu'nu anında güncelle
    const allProfiles = await animalProfileGetAll();
    await renderHerdValidation(container, allProfiles);
  } catch (err) {
    analysisEl.innerHTML = `<div class="warn-box">${t('obs.err')}${escHtml(err.message)}</div>`;
  }
}

/**
 * FAZ 22.2 — Sürü-geneli (çok-profil) KMT validasyonu.
 * Tek profilde tahmin sabit → R² yanıltıcı; birden çok profil DEĞİŞKEN tahmin üretir → anlamlı R².
 * Her profil için tahmin = calcDMI; gözlem = o profilin dmiActual ortalaması (validateDmiAcrossProfiles).
 */
async function renderHerdValidation(container, profiles) {
  const el = container.querySelector('#herd-validation-content');
  if (!el) return;
  try {
    const sci = getSettings().science || {};
    const dmiMethod = resolveDmiMethod(sci.dmiMethod, sci.system);
    const entries = [];
    for (const p of profiles) {
      const obs = await observationGetByProfile(p.id).catch(() => []);
      if (obs && obs.length) entries.push({ profile: p, observations: obs });
    }
    const v = validateDmiAcrossProfiles(entries, { dmiMethod });
    // R² anlamlı olması için yeterli (≥ MIN_SAMPLES) DEĞİŞKEN-tahminli profil + tanımlı r2 gerekir.
    const enough = (v.profiles >= VALIDATION_MIN_SAMPLES) && v.r2 != null;
    el.innerHTML = `
      <div class="info-box box-info text-small">${t('obs.herd_val_intro')}</div>
      ${enough ? `
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table">
          <thead><tr><th>${t('obs.val_metric')}</th><th class="num">${t('obs.val_value')}</th></tr></thead>
          <tbody>
            <tr><td>${t('obs.herd_val_profiles')}</td><td class="num">${v.profiles}</td></tr>
            <tr><td>${t('obs.herd_val_r2')}</td><td class="num">${v.r2}</td></tr>
            <tr><td>RMSE (KMT)</td><td class="num">${v.rmse} kg</td></tr>
            <tr><td>${t('obs.val_bias')}</td><td class="num">${v.bias > 0 ? '+' : ''}${v.bias} kg</td></tr>
            <tr><td>MAE</td><td class="num">${v.mae} kg</td></tr>
          </tbody>
        </table>
</div>
      ` : `
        <div class="info-box mt-1">${t('obs.herd_val_insufficient', { have: v.profiles, need: VALIDATION_MIN_SAMPLES })}</div>
      `}
      <div class="text-small text-muted mt-1">${t('obs.validation_note')}</div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="warn-box">${t('obs.err')}${escHtml(err.message)}</div>`;
  }
}

function renderAnalysis(a, validations = {}, state, profile, hasRationResult) {
  if (a.empty) {
    return `
      <div class="empty-state" style="padding:1.5rem">
        <p>${t('obs.empty_obs')}</p>
        <p class="text-small">${t('obs.empty_obs_hint')}</p>
      </div>`;
  }

  const grade = performanceGrade(a.performanceScore);
  const dirIcon = (tr) => tr?.direction === 'up' ? '<i class="ti ti-trending-up"></i>' : tr?.direction === 'down' ? '<i class="ti ti-trending-down"></i>' : '<i class="ti ti-arrow-right"></i>';
  const dirColor = (tr) => tr?.direction === 'up' ? 'var(--primary)' : tr?.direction === 'down' ? 'var(--danger)' : 'var(--text-muted)';
  const dirText = (tr) => tr?.direction === 'up' ? t('obs.dir_up') : tr?.direction === 'down' ? t('obs.dir_down') : t('obs.dir_stable');

  return `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:1rem; margin-bottom:1rem">
      <div class="summary-card" style="background:var(--primary-light)">
        <div class="val" style="color:${grade.color}; font-size:2rem">${grade.grade}</div>
        <div class="lbl">${grade.label}</div>
      </div>
      <div class="summary-card">
        <div class="val">${a.performanceScore}/100</div>
        <div class="lbl">${t('obs.perf_score')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${a.count}</div>
        <div class="lbl">${t('obs.total_obs')}</div>
      </div>
      <div class="summary-card">
        <div class="val">${new Date(a.latest.date).toLocaleDateString()}</div>
        <div class="lbl">${t('obs.last_measure')}</div>
      </div>
    </div>

    <div class="info-box box-info">
      <b>${t('obs.summary')}</b> ${escHtml(a.summary)}
    </div>

    ${a.count >= 2 ? `
      <div class="section-title mt-2">${t('obs.trend_chart')}</div>
      <div class="obs-chart-wrap"><canvas id="obs-trend-chart"></canvas></div>
    ` : `
      <div class="info-box mt-2">${t('obs.trend_need2', { n: a.count })}</div>
    `}

    ${a.myDelta || a.dmiDelta ? `
      <div class="section-title mt-2">${t('obs.pred_vs_actual_chart')}</div>
      <div class="obs-chart-wrap obs-chart-sm"><canvas id="obs-compare-chart"></canvas></div>

      <div class="section-title mt-2">${t('obs.pred_vs_actual')}</div>
      <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table">
        <thead><tr><th>${t('obs.col_metric')}</th><th class="num">${t('obs.col_pred')}</th><th class="num">${t('obs.col_actual')}</th><th class="num">${t('obs.col_diff')}</th><th>${t('obs.col_status')}</th></tr></thead>
        <tbody>
          ${a.myDelta ? `<tr class="status-row-${Math.abs(a.myDelta.pct) <= 10 ? 'ok' : 'above'}">
            <td><b>${t('obs.metric_milk')}</b></td>
            <td class="num">${a.myDelta.predicted.toFixed(1)}</td>
            <td class="num"><b>${a.myDelta.actual.toFixed(1)}</b></td>
            <td class="num">${a.myDelta.diff > 0 ? '+' : ''}${a.myDelta.diff.toFixed(1)} (${a.myDelta.pct > 0 ? '+' : ''}${a.myDelta.pct.toFixed(1)}%)</td>
            <td>${Math.abs(a.myDelta.pct) <= 10 ? t('obs.consistent') : a.myDelta.pct > 0 ? t('obs.higher_than') : t('obs.lower_than')}</td>
          </tr>` : ''}
          ${a.dmiDelta ? `<tr class="status-row-${Math.abs(a.dmiDelta.pct) <= 10 ? 'ok' : 'below'}">
            <td><b>${t('obs.metric_dmi')}</b></td>
            <td class="num">${a.dmiDelta.predicted.toFixed(1)}</td>
            <td class="num"><b>${a.dmiDelta.actual.toFixed(1)}</b></td>
            <td class="num">${a.dmiDelta.diff > 0 ? '+' : ''}${a.dmiDelta.diff.toFixed(1)} (${a.dmiDelta.pct > 0 ? '+' : ''}${a.dmiDelta.pct.toFixed(1)}%)</td>
            <td>${Math.abs(a.dmiDelta.pct) <= 10 ? t('obs.consistent') : a.dmiDelta.pct > 0 ? t('obs.higher_than') : t('obs.low_palatability')}</td>
          </tr>` : ''}
        </tbody>
      </table>
</div>
    ` : ''}

    ${a.trend?.my || a.trend?.bcs || a.trend?.dmi ? `
      <div class="section-title mt-2">${t('obs.trends_title')}</div>
      <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table">
        <thead><tr><th>${t('obs.col_param')}</th><th class="num">${t('obs.col_mean')}</th><th class="num">${t('obs.col_minmax')}</th><th class="num">${t('obs.col_slope')}</th><th>${t('obs.col_dir')}</th></tr></thead>
        <tbody>
          ${a.trend.my ? `<tr>
            <td>${t('obs.t_milk')}</td>
            <td class="num">${a.trend.my.mean.toFixed(1)}</td>
            <td class="num">${a.trend.my.min.toFixed(1)} - ${a.trend.my.max.toFixed(1)}</td>
            <td class="num" style="color:${dirColor(a.trend.my)}">${a.trend.my.slope > 0 ? '+' : ''}${a.trend.my.slope.toFixed(2)}</td>
            <td>${dirIcon(a.trend.my)} ${dirText(a.trend.my)}</td>
          </tr>` : ''}
          ${a.trend.bcs ? `<tr>
            <td>${t('obs.t_bcs')}</td>
            <td class="num">${a.trend.bcs.mean.toFixed(2)}</td>
            <td class="num">${a.trend.bcs.min.toFixed(2)} - ${a.trend.bcs.max.toFixed(2)}</td>
            <td class="num" style="color:${dirColor(a.trend.bcs)}">${a.trend.bcs.slope > 0 ? '+' : ''}${a.trend.bcs.slope.toFixed(3)}</td>
            <td>${dirIcon(a.trend.bcs)} ${dirText(a.trend.bcs)}</td>
          </tr>` : ''}
          ${a.trend.dmi ? `<tr>
            <td>${t('obs.t_dmi')}</td>
            <td class="num">${a.trend.dmi.mean.toFixed(1)}</td>
            <td class="num">${a.trend.dmi.min.toFixed(1)} - ${a.trend.dmi.max.toFixed(1)}</td>
            <td class="num" style="color:${dirColor(a.trend.dmi)}">${a.trend.dmi.slope > 0 ? '+' : ''}${a.trend.dmi.slope.toFixed(2)}</td>
            <td>${dirIcon(a.trend.dmi)} ${dirText(a.trend.dmi)}</td>
          </tr>` : ''}
        </tbody>
      </table>
</div>
    ` : ''}

    ${validations.dmi && validations.dmi.n > 0 ? `
      <div class="section-title mt-2">${t('obs.validation_title')}<span class="badge badge-display">${t('results.display_badge')}</span></div>
      <div class="info-box box-info text-small">${t('obs.validation_intro')}</div>
      ${validations.dmi.sufficient ? `
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table">
          <thead><tr><th>${t('obs.val_metric')}</th><th class="num">${t('obs.val_value')}</th></tr></thead>
          <tbody>
            <tr><td>${t('obs.val_n')}</td><td class="num">${validations.dmi.n}</td></tr>
            <tr><td>RMSE (KMT)</td><td class="num">${validations.dmi.rmse} kg</td></tr>
            <tr><td>${t('obs.val_bias')}</td><td class="num">${validations.dmi.bias > 0 ? '+' : ''}${validations.dmi.bias} kg</td></tr>
            <tr><td>MAE</td><td class="num">${validations.dmi.mae} kg</td></tr>
            <tr><td>CV(RMSE)</td><td class="num">${validations.dmi.cvRmse != null ? validations.dmi.cvRmse + '%' : '—'}</td></tr>
          </tbody>
        </table>
</div>
        <div class="text-small text-muted mt-1">${t(validations.dmi.bias > 0 ? 'obs.val_bias_over' : validations.dmi.bias < 0 ? 'obs.val_bias_under' : 'obs.val_bias_neutral')}</div>
      ` : `
        <div class="info-box mt-1">${t('obs.validation_insufficient', { have: validations.dmi.n, need: VALIDATION_MIN_SAMPLES })}</div>
      `}
      <div class="text-small text-muted mt-1">${t('obs.validation_note')}</div>
    ` : ''}

    ${validations.milkFat && validations.milkFat.n > 0 ? `
      <div class="section-title mt-2">${t('obs.val_title_fat')}<span class="badge badge-display">${t('results.display_badge')}</span></div>
      ${validations.milkFat.sufficient ? `
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table">
          <thead><tr><th>${t('obs.val_metric')}</th><th class="num">${t('obs.val_value')}</th></tr></thead>
          <tbody>
            <tr><td>${t('obs.val_n')}</td><td class="num">${validations.milkFat.n}</td></tr>
            <tr><td>RMSE</td><td class="num">${validations.milkFat.rmse} %</td></tr>
            <tr><td>${t('obs.val_bias')}</td><td class="num">${validations.milkFat.bias > 0 ? '+' : ''}${validations.milkFat.bias} %</td></tr>
            <tr><td>MAE</td><td class="num">${validations.milkFat.mae} %</td></tr>
            <tr><td>CV(RMSE)</td><td class="num">${validations.milkFat.cvRmse != null ? validations.milkFat.cvRmse + '%' : '—'}</td></tr>
          </tbody>
        </table>
</div>
      ` : `
        <div class="info-box mt-1">${t('obs.validation_insufficient', { have: validations.milkFat.n, need: VALIDATION_MIN_SAMPLES })}</div>
      `}
      <div class="text-small text-muted mt-1">${t('obs.validation_note')}</div>
    ` : ''}

    ${validations.methane && validations.methane.n > 0 ? `
      <div class="section-title mt-2">${t('obs.val_title_methane')}<span class="badge badge-display">${t('results.display_badge')}</span></div>
      ${validations.methane.sufficient ? `
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table">
          <thead><tr><th>${t('obs.val_metric')}</th><th class="num">${t('obs.val_value')}</th></tr></thead>
          <tbody>
            <tr><td>${t('obs.val_n')}</td><td class="num">${validations.methane.n}</td></tr>
            <tr><td>RMSE</td><td class="num">${validations.methane.rmse} g</td></tr>
            <tr><td>${t('obs.val_bias')}</td><td class="num">${validations.methane.bias > 0 ? '+' : ''}${validations.methane.bias} g</td></tr>
            <tr><td>MAE</td><td class="num">${validations.methane.mae} g</td></tr>
            <tr><td>CV(RMSE)</td><td class="num">${validations.methane.cvRmse != null ? validations.methane.cvRmse + '%' : '—'}</td></tr>
          </tbody>
        </table>
</div>
      ` : `
        <div class="info-box mt-1">${t('obs.validation_insufficient', { have: validations.methane.n, need: VALIDATION_MIN_SAMPLES })}</div>
      `}
      <div class="text-small text-muted mt-1">${t('obs.validation_note')}</div>
    ` : ''}

    ${validations.rumenPh && validations.rumenPh.n > 0 ? `
      <div class="section-title mt-2">${t('obs.val_title_ph')}<span class="badge badge-display">${t('results.display_badge')}</span></div>
      ${validations.rumenPh.sufficient ? `
        <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table">
          <thead><tr><th>${t('obs.val_metric')}</th><th class="num">${t('obs.val_value')}</th></tr></thead>
          <tbody>
            <tr><td>${t('obs.val_n')}</td><td class="num">${validations.rumenPh.n}</td></tr>
            <tr><td>RMSE</td><td class="num">${validations.rumenPh.rmse}</td></tr>
            <tr><td>${t('obs.val_bias')}</td><td class="num">${validations.rumenPh.bias > 0 ? '+' : ''}${validations.rumenPh.bias}</td></tr>
            <tr><td>MAE</td><td class="num">${validations.rumenPh.mae}</td></tr>
            <tr><td>CV(RMSE)</td><td class="num">${validations.rumenPh.cvRmse != null ? validations.rumenPh.cvRmse + '%' : '—'}</td></tr>
          </tbody>
        </table>
</div>
      ` : `
        <div class="info-box mt-1">${t('obs.validation_insufficient', { have: validations.rumenPh.n, need: VALIDATION_MIN_SAMPLES })}</div>
      `}
      <div class="text-small text-muted mt-1">${t('obs.validation_note')}</div>
    ` : ''}

    ${(!hasRationResult) ? `
      <div class="info-box box-info mt-2">
        <i class="ti ti-info-circle"></i>
        Metan, Rumen pH ve Süt Yağı validasyonlarını görebilmek için önce <b>Rasyon Kurucu</b>'da bu profile ait bir rasyon çözüp kaydetmeniz gereklidir.
      </div>
    ` : (validations._rationMissingPredictions) ? `
      <div class="info-box box-warning mt-2">
        <i class="ti ti-alert-triangle"></i>
        Kayıtlı rasyon sonucunda Metan, Rumen pH ve Süt Yağı tahmin verileri bulunmuyor. Bu rasyon eski bir sürümde kaydedilmiş olabilir.
        <b>Rasyon Kurucu</b>'da rasyonu tekrar çözüp yeniden kaydedin, ardından bu profil için geçmiş rasyonlardan yeni kaydı seçin.
      </div>
    ` : ((!validations.methane || validations.methane.n === 0) && (!validations.rumenPh || validations.rumenPh.n === 0) && (!validations.milkFat || validations.milkFat.n === 0)) ? `
      <div class="info-box mt-1 text-small text-muted">
        <i class="ti ti-info-circle"></i> Rasyon modeli mevcut ancak Metan, Rumen pH veya Süt Yağı için kayıtlı saha gözleminiz bulunmadığından karşılaştırma yapılamıyor.
      </div>
    ` : ''}

    <div class="text-small text-muted mt-1">
      ${t('obs.perf_footer')}
    </div>
  `;
}

function renderHistory(observations) {
  if (!observations || observations.length === 0) {
    return `<div class="empty-state"><p class="text-muted">${t('obs.hist_empty')}</p></div>`;
  }
  return `
    <div class="feed-table-wrap" style="width:100%; overflow-x:auto;">
<table class="diag-table" style="font-size:0.85rem">
      <thead>
        <tr>
          <th>${t('obs.col_date')}</th>
          <th class="num">${t('obs.col_milk')}</th>
          <th class="num">${t('obs.col_fat')}</th>
          <th class="num">${t('obs.col_prot')}</th>
          <th class="num">${t('obs.col_bcs')}</th>
          <th class="num">${t('obs.col_dmi')}</th>
          <th class="num">${t('obs.col_methane')}</th>
          <th class="num">${t('obs.col_rumen_ph')}</th>
          <th>${t('obs.col_notes')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${observations.map(o => `<tr>
          <td>${new Date(o.date).toLocaleDateString()}</td>
          <td class="num">${o.milkYield?.toFixed(1) ?? '—'}</td>
          <td class="num">${o.milkFat?.toFixed(1) ?? '—'}</td>
          <td class="num">${o.milkProtein?.toFixed(1) ?? '—'}</td>
          <td class="num">${o.bcs?.toFixed(2) ?? '—'}</td>
          <td class="num">${o.dmiActual?.toFixed(1) ?? '—'}</td>
          <td class="num">${o.methane?.toFixed(0) ?? '—'}</td>
          <td class="num">${o.rumenPh?.toFixed(2) ?? '—'}</td>
          <td class="text-muted text-small">${escHtml(o.notes || '')}</td>
          <td><button class="btn btn-sm btn-danger btn-del-obs" data-id="${o.id}" aria-label="Sil"><i class="ti ti-trash"></i></button></td>
        </tr>`).join('')}
      </tbody>
    </table>
</div>
    <p class="text-small text-muted mt-1">${t('obs.total_records', { n: observations.length })}</p>
  `;
}
