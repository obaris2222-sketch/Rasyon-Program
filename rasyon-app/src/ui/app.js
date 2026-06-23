/**
 * Ana Uygulama — Durum yönetimi, tab routing, başlatma
 */

// FAZ 21 (Veri Terminali arayüzü) — self-host fontlar + Tabler ikon webfontu.
// Offline PWA olduğundan CDN yerine bundle edilir (Vite woff2'leri precache eder).
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';

import { seedFeedLibrary } from '../data/feedService.js';
import feedLibraryJSON from '../data/feedLibrary.json';
import feedLibraryExtJSON from '../data/feedLibraryExt.json';
import feedLibraryExt2JSON from '../data/feedLibraryExt2.json';
import feedLibraryExt3JSON from '../data/feedLibraryExt3.json';
import feedLibraryExt4JSON from '../data/feedLibraryExt4.json';  // FAZ 16.5: kaba yem + tahıl
import feedLibraryExt5JSON from '../data/feedLibraryExt5.json';  // FAZ 16.5: protein + yağ
import feedLibraryExt6JSON from '../data/feedLibraryExt6.json';  // FAZ 16.5: yan ürünler
import feedLibraryExt7JSON from '../data/feedLibraryExt7.json';  // FAZ 16.5: mineral + katkı + TR
import { optimizeViaWorker } from '../solver/glpkWorker.js';
import { renderDashboardPanel } from './components/dashboardPanel.js';
import { renderAnimalForm } from './components/animalForm.js';
import { renderFeedDatabase } from './components/feedDatabase.js';
import { renderRationBuilder } from './components/rationBuilder.js';
import { renderResultsPanel } from './components/resultsPanel.js';
import { setChartTheme, resizeAllCharts } from './charts.js';
import { renderHerdBatchPanel } from './components/herdBatchPanel.js';
import { renderPriceManager } from './components/priceManager.js';
import { renderObservationsPanel } from './components/observationsPanel.js';
import { renderSettingsPanel } from './components/settingsPanel.js';
import { shouldShowOnboarding, showOnboarding } from './components/onboarding.js';
import { getSettings, saveSettings, migrateDmiMethodToAuto } from '../data/settings.js';
import { ensureDefaultFarm, farmGetById, farmPut, getActiveFarm, setActiveFarmId, backfillFarmId } from '../data/db.js';
import { openAuthModal } from './components/authPanel.js';
import { initFarmSwitcher, refreshFarmButton } from './components/farmSwitcher.js';
import { startSync, stopSync, onSyncStatus } from '../data/sync/syncManager.js';
import { onAuthChange, isCloudConfigured } from '../data/auth.js';
import { showToast, showLoading } from './utils.js';
import { validateForm, summarizeErrors } from './validation.js';
import { initI18n, t } from './i18n.js';

// FAZ 15.9 — Optimize öncesi state.animal'da kontrol edilecek alanlar (FIELD_RULES anahtarları)
const ANIMAL_VALIDATE_FIELDS = [
  'bw','milkYield','milkFat','milkProtein','milkLactose','targetADG',
  'dim','bcs','ambientTemp','humidity','urinePH','pregnancyMonth','parity',
];

// ─── Global Uygulama Durumu ──────────────────────────────────────────────────

export const state = {
  animal: {
    lactationStage: 'early',
    bw: 650,
    milkYield: 35,
    milkFat: 3.5,
    milkProtein: 3.1,
    parity: 2,
    dim: 90,
    pregnant: false,
    pregnancyMonth: 0,
    bcs: 3.0,
    milkLactose: null,
    thi: null,
    ambientTemp: null,
    humidity: null,
    urinePH: null,
    gestDays: 0,
    breed: 'Holstein',
  },
  economics: {
    milkPrice_tl: 18,     // ₺/litre (Türkiye 2026 ortalama)
    herdSize: 1,
  },
  selectedFeeds: [],   // { id, name, category, minKg, maxKg }
  rationResult: null,
  lastOptimizedAt: null,
  lastOptimizedAnimal: null,   // FAZ 15.1: Dashboard "Son Rasyon" kartı için snapshot
};

// ─── Tab Routing ─────────────────────────────────────────────────────────────

const TABS = ['dashboard', 'animal', 'feeds', 'ration', 'results', 'herd', 'prices', 'observations', 'settings'];
// FAZ 15.4: mobil alt barda doğrudan gösterilen çekirdek sekmeler (kalanlar "Daha Fazla"da)
const BOTTOM_NAV_TABS = ['dashboard', 'animal', 'ration', 'results'];
let activeTab = 'dashboard';

async function switchTab(tab) {
  if (!TABS.includes(tab)) return;
  activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // FAZ 15.4: mobil alt navigasyon senkronizasyonu — sekme alt barda yoksa
  // "Daha Fazla" düğmesi aktif görünür
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    if (btn.id === 'bn-more') btn.classList.toggle('active', !BOTTOM_NAV_TABS.includes(tab));
    else btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tab}`);
  });

  // CSS hook: body class ile aktif sekmeyi işaretle (body:has() alternatifi)
  document.body.setAttribute('data-active-tab', tab);

  // Sekme değişince sonuçlar zum'unu sıfırla
  if (tab !== 'results') resetResultsZoom();

  // Mobil yakınlaştırma (zoom) kontrolü: Sadece sonuçlar sekmesinde serbest
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    if (tab === 'results') {
      viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    } else {
      viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    }
  }

  updatePageTitle(tab);   // FAZ 21: üst-bar sayfa başlığı
  await renderTab(tab);

  // Sonuçlar/Grafikler sekmesine geçince Chart.js'yi yeniden boyutlandır
  if (tab === 'results') {
    // RAF + küçük gecikme: renderTab DOM'u güncelledikten sonra grafikleri yeniden çiz
    requestAnimationFrame(() => setTimeout(() => {
      resizeAllCharts();
      window.dispatchEvent(new Event('resize'));
    }, 80));
  }
}

async function renderTab(tab) {
  const panel = document.getElementById(`tab-${tab}`);
  switch (tab) {
    case 'dashboard': await renderDashboardPanel(panel, state, { onNavigate: switchTab }); break;
    case 'animal':  renderAnimalForm(panel, state); break;
    case 'feeds':   await renderFeedDatabase(panel, state); break;
    case 'ration':  await renderRationBuilder(panel, state, { onOptimize: handleOptimize }); break;
    case 'results': renderResultsPanel(panel, state); break;
    case 'herd':    await renderHerdBatchPanel(panel, state); break;
    case 'prices':  await renderPriceManager(panel, state); break;
    case 'observations': await renderObservationsPanel(panel, state); break;
    case 'settings': renderSettingsPanel(panel, state, { onSettingsChange: handleSettingsChange }); break;
  }
}

/** i18n etiketinden baştaki olası emoji+boşluğu ayıklar (FAZ 21: ikonlar artık statik SVG). */
function stripLeadingIcon(s) {
  return String(s).replace(/^\s*[\p{Extended_Pictographic}☀-➿️‍]+\s*/u, '').trim() || String(s);
}

/** Üst-bardaki aktif sayfa başlığını günceller (kenar menü sekme adından). */
function updatePageTitle(tab = activeTab) {
  const el = document.querySelector('.page-title');
  if (!el) return;
  const key = `tabs.${tab}`;
  if (t(key) !== key) el.textContent = stripLeadingIcon(t(key));
}

function updateAppUIStrings() {
  // Kenar menü nav etiketleri — ikonlar statik SVG, yalnız .tab-label metnini güncelle
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    const label = btn.querySelector('.tab-label');
    const key = `tabs.${tab}`;
    if (label && t(key) !== key) label.textContent = stripLeadingIcon(t(key));
  });

  // Mobil "Daha Fazla" sayfası etiketleri (.mi-label)
  document.querySelectorAll('.more-item[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    const label = btn.querySelector('.mi-label');
    const key = `tabs.${tab}`;
    if (label && t(key) !== key) label.textContent = stripLeadingIcon(t(key));
  });

  // Mobil alt navigasyon kısa etiketleri (bottomNav.* anahtarları)
  document.querySelectorAll('.bottom-nav-btn[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    const label = btn.querySelector('.bn-label');
    if (tab && label && t(`bottomNav.${tab}`) !== `bottomNav.${tab}`) {
      label.textContent = t(`bottomNav.${tab}`);
    }
  });
  const moreLabel = document.querySelector('#bn-more .bn-label');
  if (moreLabel && t('bottomNav.more') !== 'bottomNav.more') moreLabel.textContent = t('bottomNav.more');

  updatePageTitle();
}

window.addEventListener('language-changed', async () => {
  updateAppUIStrings();
  // Re-render active tab
  await renderTab(activeTab);
});

// ─── Ayarlar Değişikliği ────────────────────────────────────────────────────────

/**
 * Ayarlar kaydedilince global state'i tazeler (FAZ 15.2).
 * Süt fiyatı global olduğundan hemen uygulanır; hayvan varsayılanları (parite/BCS/
 * sıcaklık) mevcut çalışan formu bozmamak için yalnızca init'te uygulanır.
 */
function handleSettingsChange(settings) {
  if (Number.isFinite(settings?.defaults?.milkPrice_tl)) {
    state.economics.milkPrice_tl = settings.defaults.milkPrice_tl;
  }
  // FAZ 15.10: Ayarlar panelinden tema değişince anında uygula
  if (settings?.theme) applyTheme(settings.theme);
}

/** Açılışta ayarların varsayılan değerlerini başlangıç state'ine uygular. */
function applySettingsToState() {
  const s = getSettings();
  const d = s.defaults || {};
  if (Number.isFinite(d.parity))       state.animal.parity = d.parity;
  if (Number.isFinite(d.bcs))          state.animal.bcs = d.bcs;
  if (Number.isFinite(d.ambientTemp))  state.animal.ambientTemp = d.ambientTemp;
  if (Number.isFinite(d.humidity))     state.animal.humidity = d.humidity;
  if (Number.isFinite(d.milkPrice_tl)) state.economics.milkPrice_tl = d.milkPrice_tl;
}

/**
 * FAZ 16.10/16.11 — Aktif çiftliği hazırlar. Ayarlardaki activeFarmId hâlâ
 * geçerliyse kullanır; değilse "Varsayılan Çiftlik" oluşturur ve kaydeder.
 * İlk kurulumda (veya v2→v3 göçü sonrası) çiftliksiz kayıtları aktif çiftliğe
 * bağlar (tek seferlik backfill — flag ile tekrar taranmaz).
 */
async function initActiveFarm() {
  try {
    const settings = getSettings();
    let farm = settings.activeFarmId ? await farmGetById(settings.activeFarmId) : null;
    if (!farm) {
      // FAZ 16.11/2.3: varsayılan çiftliği kullanıcının genel çiftlik adıyla tohumla
      farm = await ensureDefaultFarm(settings.farm?.name);
      saveSettings({ activeFarmId: farm.id });
    }
    setActiveFarmId(farm.id);

    if (!settings.cloud?.farmBackfillDone) {
      await backfillFarmId(farm.id);
      saveSettings({ cloud: { farmBackfillDone: true } });
    }

    // FAZ 16.11/2.3: eski genel çiftlik profilini (ad/adres/danışman) aktif çiftliğe bir kez taşı
    if (!settings.cloud?.farmProfileMigrated) {
      const gf = settings.farm || {};
      if (gf.address || gf.advisor || gf.name) {
        await farmPut({
          ...farm,
          name: (farm.name && farm.name !== 'Varsayılan Çiftlik') ? farm.name : (gf.name || farm.name),
          address: farm.address || gf.address || '',
          advisor: farm.advisor || gf.advisor || '',
        });
      }
      saveSettings({ cloud: { farmProfileMigrated: true } });
    }
  } catch (err) {
    console.warn('Aktif çiftlik hazırlama hatası:', err);
  }
}

// ─── Bulut / Hesap (FAZ 16.10) ───────────────────────────────────────────────

const CLOUD_ICON = { idle: 'ti-cloud', syncing: 'ti-refresh', synced: 'ti-cloud-check', pending: 'ti-clock', offline: 'ti-cloud-off', error: 'ti-alert-triangle' };

/** Header bulut butonunu senkron durumuna göre günceller (FAZ 21: SVG ikon). */
function updateCloudButton(state) {
  const btn = document.getElementById('cloud-btn');
  if (!btn) return;
  btn.innerHTML = `<i class="ti ${CLOUD_ICON[state.status] || 'ti-cloud'}"></i>`;
  btn.classList.toggle('spin', state.status === 'syncing');
  btn.title = `${t('cloud.header_title')}${state.user?.email ? ' — ' + state.user.email : ''}`;
  btn.classList.toggle('cloud-active', !!state.user);
  // Senkron sonrası çiftlik adı değişmiş olabilir (pull/uzlaştırma) → header'ı tazele
  if (state.status === 'synced') refreshFarmButton();
}

/**
 * Bulut/hesap altyapısını başlatır. Bulut yapılandırılmamışsa (`.env` yok)
 * butonu gizler → program girişsiz tam yerel çalışır.
 */
async function initCloud() {
  const btn = document.getElementById('cloud-btn');
  if (!isCloudConfigured()) {
    if (btn) btn.style.display = 'none';
    return;
  }
  if (btn) btn.addEventListener('click', () => openAuthModal());
  onSyncStatus(updateCloudButton);
  // Oturum değişimi → senkronu başlat/durdur (INITIAL_SESSION ile açılışta da çalışır)
  await onAuthChange((event, session) => {
    if (session?.user) startSync(session.user);
    else if (event === 'SIGNED_OUT') stopSync();
  });
}

// ─── Optimize Handler ─────────────────────────────────────────────────────────

async function handleOptimize(optimizeInput) {
  // FAZ 15.9: Optimize öncesi hayvan profili validasyonu —
  // form'da hatalı veri varsa kullanıcıyı uyar ve animal sekmesine yönlendir.
  // #11 düzeltmesi: kuru dönemde (far_off/close_up) süt alanları kilitli/0 olduğundan
  // süt yağ/protein/laktoz validasyonu atlanır (aksi halde "geçersiz süt yağı: 0" ile
  // kuru inek optimizasyonu yanlışlıkla bloklanıyordu).
  const isDry = ['far_off', 'close_up'].includes(optimizeInput.animal?.lactationStage);
  const validateFields = isDry
    ? ANIMAL_VALIDATE_FIELDS.filter(f => !['milkFat', 'milkProtein', 'milkLactose'].includes(f))
    : ANIMAL_VALIDATE_FIELDS;
  const v = validateForm(optimizeInput.animal || {}, validateFields);
  if (!v.ok) {
    showToast(summarizeErrors(v.errors), 'warn');
    await switchTab('animal');
    return;
  }
  // FAZ 15.5: tek rasyon — belirsiz spinner + mesaj (LP atomik, yüzde yok);
  // mesaj/progress reset ederek sürü modundan kalan ilerleme çubuğunu temizler
  showLoading(true, { message: 'Rasyon optimize ediliyor...' });
  try {
    // FAZ 15.2: Bilim sistemi (NRC2001/NASEM2021) Ayarlar'dan gelir; rasyon kurucu
    // açıkça geçmediyse kullanıcının seçtiği varsayılan sistem uygulanır
    // (rationOptimizer system'i requirements pipeline'ına aktarır → NEL/MP/mineral farkı).
    // FAZ 16.11/2.3: bilim sistemi önceliği — açık seçim > aktif çiftlik override > genel ayar
    if (!optimizeInput.system) {
      const farm = await getActiveFarm();
      optimizeInput.system = farm?.science || getSettings().science.system;
    }
    // FAZ 18.4: tüketim-düzeyi enerji iskontosu (Ayarlar; varsayılan açık) — solver'da opt-in.
    if (optimizeInput.autoEnergyDiscount === undefined) {
      optimizeInput.autoEnergyDiscount = getSettings().science.autoEnergyDiscount !== false;
    }
    // FAZ 19.1: hesap modu (Ayarlar; varsayılan 'nrc' tek-geçiş) — 'cncps' iteratif motor.
    if (optimizeInput.calcMode === undefined) {
      optimizeInput.calcMode = getSettings().science.calcMode || 'nrc';
    }
    // FAZ 20.3: çözülmüş input'u sakla → Sonuçlar'da senaryo karşılaştırma temel alır.
    state.lastOptimizeInput = optimizeInput;
    // FAZ 14.1: Web Worker üzerinden optimize et (Worker yoksa main thread fallback).
    const result = await optimizeViaWorker(optimizeInput);
    state.rationResult = result;
    state.lastOptimizedAt = new Date();
    // FAZ 15.1: Dashboard'ın "Son Rasyon" kartı optimize anındaki hayvan
    // bilgisini (breed/BW/dönem/süt) sonuçla tutarlı göstersin diye snapshot al
    // (form sonradan değişse bile sonuç bu profil için hesaplanmıştı).
    state.lastOptimizedAnimal = { ...optimizeInput.animal };

    const badge = document.getElementById('results-badge');
    if (badge) badge.style.display = result.feasible ? 'inline-flex' : 'none';

    showToast(
      result.feasible
        ? 'Rasyon başarıyla optimize edildi!'
        : `Optimizasyon tamamlandı (${result.statusName})`,
      result.feasible ? 'success' : 'error'
    );

    await switchTab('results');
  } catch (err) {
    console.error('Optimizasyon hatası:', err);
    showToast('Hata: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── Tema (FAZ 15.10) ───────────────────────────────────────────────────────

/** Temayı <html data-theme> üzerine uygular ve toggle ikonunu günceller. */
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = dark ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon"></i>';
    btn.title = dark ? 'Açık temaya geç (Alt+T)' : 'Koyu temaya geç (Alt+T)';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0a1322' : '#0f2747');
  setChartTheme(dark ? 'dark' : 'light');   // Chart.js global metin/ızgara rengi
}

/** Açık/koyu tema arasında geçiş yapar ve ayarı kalıcı kaydeder. */
function toggleTheme() {
  const next = (getSettings().theme === 'dark') ? 'light' : 'dark';
  applyTheme(next);
  saveSettings({ theme: next });
}

// Modül yüklenir yüklenmez temayı uygula (deferred module → documentElement hazır;
// ilk boyamadan önce çalışır, açık-tema parlaması olmaz).
applyTheme(getSettings().theme);

// ─── Sonuçlar Sekmesi Parmak Zum (FAZ 22.1) ──────────────────────────────────
// transform:scale() yalnızca #tab-results'a uygulanır → position:fixed olan
// bottom-nav tamamen bağımsız kalır ve hiç etkilenmez.

let _resultsZoomScale = 1;

function resetResultsZoom() {
  const panel = document.getElementById('tab-results');
  if (!panel) return;
  _resultsZoomScale = 1;
  panel.style.transform = '';
  panel.style.transformOrigin = '';
  panel.style.marginRight = '';
  panel.style.marginBottom = '75px';
}
window.resetResultsZoom = resetResultsZoom;

function initResultsPinchZoom() {
  if (!('ontouchstart' in window)) return;   // Masaüstünde devre dışı

  let lastPinchDist = 0;
  let startScale   = 1;
  let lastTapTime  = 0;
  let isPinching   = false;

  /** İki parmak arası mesafe */
  const pinchDist = (touches) =>
    Math.hypot(touches[1].clientX - touches[0].clientX,
               touches[1].clientY - touches[0].clientY);

  /** Scale'i sınırla ve uygula */
  function applyScale(s) {
    const panel = document.getElementById('tab-results');
    if (!panel) return;
    
    // Panelin o anki içeriğinin gerçek fiziksel boyutları
    // CSS transform (scale) offsetWidth ve scrollWidth değerlerini etkilemez, her zaman orijinal (unscaled) boyutu verir.
    // Saniyede 60 kez çalışan touchmove içinde transform'u sıfırlamak performansı (ve alt navigasyonu) bozar, o yüzden doğrudan ölçüyoruz.
    const w = panel.scrollWidth || 1100;
    const h = panel.scrollHeight || panel.offsetHeight;
    
    // Ekranın tam genişliğini al (scrollbar hariç net görünür alan)
    const viewW = document.documentElement.clientWidth;
    
    // Sayfanın hiçbir şekilde ekran sınırlarından daha fazla küçülmemesi için minimum zoom oranı
    const minZoom = Math.min(1, viewW / w);
    _resultsZoomScale = Math.min(3, Math.max(minZoom, s));
    
    panel.style.transformOrigin = '0 0';   // sol-üst köşeden ölçekle
    
    if (_resultsZoomScale === 1) {
      panel.style.transform = '';
      panel.style.marginRight = '';
      // Alt navigasyon (bottom-nav) yüksekliğini kurtarmak için 75px boşluk
      panel.style.marginBottom = '75px';
    } else {
      panel.style.transform = `scale(${_resultsZoomScale.toFixed(3)})`;
      
      // Transform, HTML elementinin render edilen görselini küçültürken
      // DOM üzerindeki kapladığı fiziksel çerçeveyi (bounding box) daraltmaz.
      // Bu yüzden sağda ve altta kalan 'hayalet' alanı negatif margin ile yok ediyoruz.
      const emptyW = w - (w * _resultsZoomScale);
      const emptyH = h - (h * _resultsZoomScale);
      
      panel.style.marginRight = `-${emptyW}px`;
      // Negatif marjı 75px daha az yaparak altta bottom-nav'ın örteceği ekstra boşluk bırakıyoruz
      panel.style.marginBottom = `-${emptyH - 75}px`;
    }
  }

  /** Sonuçlar sekmesi aktif mi ve gözlem ekranı kapalı mı? */
  const onResults = () => {
    // Geçmiş rasyon gözlem ekranı açıkken uzaklaştırmayı (pinch-zoom) kapat
    if (document.getElementById('history-modal')?.style.display === 'flex') return false;
    return document.body.getAttribute('data-active-tab') === 'results';
  };

  document.addEventListener('touchstart', (e) => {
    if (!onResults()) return;

    if (e.touches.length === 2) {
      // Kıstırma başlıyor
      isPinching   = true;
      lastPinchDist = pinchDist(e.touches);
      startScale   = _resultsZoomScale;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!onResults() || e.touches.length !== 2) return;
    
    // Çift parmakla dokunulduğunda tarayıcının varsayılan sayfa yakınlaştırmasını (native zoom) engelle!
    // Bu sayede .bottom-nav ve sayfa yapısı bozulmaz. Sadece bizim custom applyScale() çalışır.
    if (e.cancelable) e.preventDefault();
    
    isPinching = true;
    const dist = pinchDist(e.touches);
    if (lastPinchDist > 0) {
      applyScale(startScale * (dist / lastPinchDist));
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      isPinching    = false;
      lastPinchDist = 0;
    }
  }, { passive: true });
}

// ─── Dokunmatik bilgi tooltip'leri (denetim #23) ─────────────────────────────
// Mobilde `title` tooltip'i hover olmadığından açılmaz; ℹ️ simgesine tıklayınca/
// dokununca metni toast olarak gösterir (masaüstünde de çalışır; delegated →
// dinamik render edilen içerikte de geçerli).
function initInfoTooltips() {
  document.addEventListener('click', (e) => {
    const icon = e.target.closest('.info-icon');
    if (!icon) return;
    const msg = icon.getAttribute('title') || icon.dataset.tip;
    if (msg) showToast(msg, 'info', 6000);
  });
}

// ─── Klavye Kısayolları (FAZ 15.10) ──────────────────────────────────────────

function initKeyboardShortcuts() {
  // Not: tüm kısayollar modifier'lı (Alt/Ctrl/Cmd) → input içinde yazarken de
  // güvenli (bilinçli global davranış; tek tuş kısayolu yok).
  document.addEventListener('keydown', (e) => {
    // Alt+T → tema değiştir
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      toggleTheme();
      return;
    }
    // Alt+1..9 → sekme geçişi (TABS sırası)
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
      const idx = Number(e.key) - 1;
      if (idx < TABS.length) {
        e.preventDefault();
        switchTab(TABS[idx]);
      }
      return;
    }
    // Ctrl/Cmd+Enter → rasyonu optimize et (her sekmeden çalışır → önce ration'a geç)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      triggerOptimizeShortcut();
      return;
    }
    // Ctrl/Cmd+S → hayvan profilini kaydet; tarayıcının "sayfayı kaydet" dialogunu
    // her sekmede engelle (uygulamada anlamsız), kaydetme yalnız animal sekmesinde
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (activeTab === 'animal') document.getElementById('profile-save')?.click();
      return;
    }
  });
}

/** Ctrl+Enter: ration sekmesindeyse optimize butonuna tıklar, değilse sekmeye geçer. */
async function triggerOptimizeShortcut() {
  if (activeTab !== 'ration') {
    await switchTab('ration');
    // render sonrası buton hazır olunca tıkla
    requestAnimationFrame(() => document.getElementById('optimize-btn')?.click());
    return;
  }
  document.getElementById('optimize-btn')?.click();
}

// ─── Başlatma ─────────────────────────────────────────────────────────────────

async function init() {
  // Initialize i18n
  await initI18n();
  updateAppUIStrings();

  // FAZ 17.3: Tek seferlik KMT göçü — eski 'NRC2001' default → 'auto' (bilim
  // sistemiyle tutarlı). Sessiz değil: değişiklik olduysa kullanıcı bilgilendirilir.
  try {
    const { migrated } = migrateDmiMethodToAuto();
    if (migrated) showToast(t('settings.dmi_migrated_toast'), 'info', 8000);
  } catch { /* göç best-effort; başarısızsa sessiz geç */ }

  // FAZ 15.2: Kullanıcı varsayılanlarını (parite/BCS/sıcaklık/nem/süt fiyatı) uygula
  applySettingsToState();

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // FAZ 15.4: mobil alt navigasyon + "Daha Fazla" alt sayfası
  const moreSheet = document.getElementById('more-sheet');
  const openMore = () => {
    // Açık sekmeyi sheet'te vurgula (kullanıcı nerede olduğunu görsün)
    moreSheet?.querySelectorAll('.more-item').forEach(it =>
      it.classList.toggle('active', it.dataset.tab === activeTab));
    moreSheet?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';   // arka plan scroll-lock
  };
  const closeMore = () => {
    if (!moreSheet || moreSheet.classList.contains('hidden')) return;
    const panel = moreSheet.querySelector('.more-sheet-panel');
    if (panel) {
      panel.style.transition = 'transform 0.22s ease-in';
      panel.style.transform = 'translateY(100%)';
    }
    // Animasyon süresi kadar bekleyip sonra tamamen gizle
    setTimeout(() => {
      moreSheet.classList.add('hidden');
      document.body.style.overflow = '';
      if (panel) panel.style.transform = ''; // resetle
    }, 220);
  };
  document.querySelectorAll('.bottom-nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('bn-more')?.addEventListener('click', openMore);
  document.getElementById('more-sheet-backdrop')?.addEventListener('click', closeMore);
  document.querySelectorAll('.more-item').forEach(btn => {
    btn.addEventListener('click', () => { switchTab(btn.dataset.tab); closeMore(); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && moreSheet && !moreSheet.classList.contains('hidden')) closeMore();
  });

  // FAZ 15.4 Ek: Swipe-down (aşağı kaydırma) ile menüyü kapatma
  const moreSheetPanel = moreSheet?.querySelector('.more-sheet-panel');
  if (moreSheetPanel) {
    let startY = 0;
    let currentY = 0;
    
    moreSheetPanel.addEventListener('touchstart', (e) => {
      // Eğer kullanıcının tıkladığı yer içeriklerin scroll edildiği bir div ise 
      // (örneğin listenin ortası) ve liste en üstte değilse kaydırma iptal edilebilir.
      // Ancak basit kullanım için panel tutamacına (handle) veya tüm panele genel bir algılayıcı ekliyoruz:
      if (moreSheetPanel.scrollTop === 0) {
        startY = e.touches[0].clientY;
      } else {
        startY = 0; // Scroll içindeyken kapatmayı devre dışı bırak
      }
    }, { passive: true });

    moreSheetPanel.addEventListener('touchmove', (e) => {
      if (!startY) return;
      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;
      
      // Aşağı çekiliyorsa (ve scroll en üstteyse)
      if (deltaY > 0 && moreSheetPanel.scrollTop <= 0) {
        if (e.cancelable) e.preventDefault(); // Native scroll/overscroll u engelle
        moreSheetPanel.style.transform = `translateY(${deltaY}px)`;
        moreSheetPanel.style.transition = 'none';
      }
    }, { passive: false }); // PreventDefault kullanabilmek için false

    moreSheetPanel.addEventListener('touchend', () => {
      if (!startY) return;
      const deltaY = currentY - startY;
      
      if (deltaY > 60) {
        // Yeterince aşağı çekildiyse kapat (closeMore zaten transition ile kaydırır)
        closeMore();
      } else {
        // Yeterli değilse eski konumuna geri dön
        moreSheetPanel.style.transition = 'transform 0.22s ease-out';
        moreSheetPanel.style.transform = 'translateY(0)';
      }
      
      startY = 0;
      currentY = 0;
    });
  }

  // FAZ 15.10: Tema toggle butonu + global klavye kısayolları
  applyTheme(getSettings().theme);   // ikon/başlığı kesin senkronla (buton render edildi)
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  initKeyboardShortcuts();
  initInfoTooltips();   // denetim #23: dokunmatik tooltip
  initResultsPinchZoom();  // FAZ 22.1: Sonuçlar sekmesi parmak zum

  try {
    // Dört kütüphaneyi birleştir; sürüm farklı → yeniden seed
    // FAZ 16.5: 8 dosya birleştirilir; ID çakışmasında sonraki dosya kazanır (feedBulkPut upsert).
    const allFeeds = [
      ...feedLibraryJSON.feeds,
      ...feedLibraryExtJSON.feeds,
      ...feedLibraryExt2JSON.feeds,
      ...feedLibraryExt3JSON.feeds,
      ...feedLibraryExt4JSON.feeds,
      ...feedLibraryExt5JSON.feeds,
      ...feedLibraryExt6JSON.feeds,
      ...feedLibraryExt7JSON.feeds,
    ];
    // version yem SAYISINDAN türetilir → her yem eklemesinde otomatik değişir →
    // mevcut kullanıcılarda reseed tetiklenir (yoksa sabit version'da yeni yemler yüklenmez).
    const merged = {
      version: `1.x-merged-${allFeeds.length}`,
      source: [
        feedLibraryJSON.source,
        feedLibraryExtJSON.source,
        feedLibraryExt2JSON.source,
        feedLibraryExt3JSON.source,
        feedLibraryExt4JSON.source,
        feedLibraryExt5JSON.source,
        feedLibraryExt6JSON.source,
        feedLibraryExt7JSON.source,
      ].join(' + '),
      updatedAt: feedLibraryExt7JSON.updatedAt,
      feeds: allFeeds,
    };
    await seedFeedLibrary(merged);
  } catch (err) {
    console.warn('Feed seed hatası:', err);
  }

  // FAZ 16.10/16.11: Aktif çiftliği hazırla (yoksa "Varsayılan Çiftlik" oluştur)
  // + mevcut/göç edilmiş kayıtları bir kereye mahsus çiftliğe bağla (backfill).
  await initActiveFarm();

  // FAZ 16.11: Çiftlik seçici (header) — geçişte aktif sekmeyi tazeler
  initFarmSwitcher(() => renderTab(activeTab));

  await renderTab(activeTab);

  // FAZ 16.10: Bulut/hesap (tembel — supabase yalnız yapılandırılmışsa yüklenir).
  // Fire-and-forget: UI'ı bloklamaz; oturum varsa arka planda senkron başlar.
  initCloud();

  if (shouldShowOnboarding()) {
    showOnboarding();
  }
}

init();
