/**
 * Ayarlar Paneli (FAZ 15.2 — Aşama 1)
 *
 * Bölümler:
 *   1. Bilim Sistemi   — NRC 2001 / NASEM 2021 + KMT yöntemi (gerçek pipeline etkisi)
 *   2. Çiftlik Profili — ad / adres / danışman (PDF rapor başlığı, Aşama 2)
 *   3. Varsayılan Değerler — yeni profil/rasyon ön-değerleri
 *   4. Genel — onboarding'i tekrar göster, varsayılana döndür
 *
 * (Aşama 2: Yedek/Geri Yükleme, Birim Sistemi, Dil, Veri Temizleme)
 */

import { getSettings, saveSettings, resetSettings } from '../../data/settings.js';
import { exportAllData, importAllData, clearAllData } from '../../data/db.js';
import { resetOnboarding, showOnboarding } from './onboarding.js';
import { openAuthModal } from './authPanel.js';
import { getSyncState, onSyncStatus } from '../../data/sync/syncManager.js';
import { reverseGeocode } from '../../core/weatherApi.js';   // denetim #19: koordinat → yer adı
import { isCloudConfigured } from '../../data/auth.js';
import { showToast, escHtml } from '../utils.js';
import { t, setLanguage } from '../i18n.js';

const CLOUD_STATUS_ICON = { idle: 'ti-cloud', syncing: 'ti-refresh', synced: 'ti-cloud-check', pending: 'ti-clock', offline: 'ti-cloud-off', error: 'ti-alert-triangle' };

const SYSTEM_INFO = {
  NASEM2021: {
    label: 'NASEM 2021 (önerilen)',
    desc: 'Tam mekanistik NASEM 2021 + CNCPS v6.5 motoru. NRC 2001 çekirdek üzerine NASEM 2021 güncellemeleri '
        + '(idame NEL 0.10×BW<sup>0.75</sup>, MP idame 4.1×BW<sup>0.75</sup>, BCS mobilizasyon 84 Mcal/BCS) + '
        + 'ölçülü yemlerde <b>dinamik amino asit (AA)</b>, <b>pasaj hızına bağlı RDP/RUP</b> ve '
        + '<b>iteratif CNCPS v6.5 motoru</b> (opt-in "CNCPS Hesap Modu"). '
        + 'Yüksek verimli modern sürüler için önerilir.',
  },
  NRC2001: {
    label: 'NRC 2001 (klasik)',
    desc: 'Klasik 7. baskı denklemleri. İdame NEL 0.08×BW<sup>0.75</sup>, MP idame 3.8×BW<sup>0.75</sup>, '
        + 'BCS mobilizasyon 62.56 Mcal/BCS. Geriye dönük karşılaştırma için.',
  },
  INRA2018: {
    label: 'INRA 2018 (Fransa)',
    desc: 'Avrupa standardı. Enerji UFL (Unité Fourragère Lait), protein PDIE/PDIN, '
        + 'doluluk UEL birimleri. LP optimizasyonu NASEM 2021 ile çalışır; INRA değerleri '
        + 'sonuç panelinde ek rapor olarak gösterilir.',
  },
};

export function renderSettingsPanel(container, state, options = {}) {
  const onSettingsChange = options.onSettingsChange || (() => {});
  const s = getSettings();

  container.innerHTML = `
    <div class="settings-panel">
      <div class="card">
        <div class="card-title">${t('settings.title')}</div>
        <div class="info-box">
          ${t('settings.description')}
        </div>
      </div>

      <!-- 1. Bilim Sistemi -->
      <div class="card mt-2">
        <div class="card-title">${t('settings.science_system')}</div>
        <div class="form-grid">
          <div class="form-group">
            <label>${t('settings.requirement_system')}</label>
            <select id="set-system">
              <option value="NASEM2021" ${s.science.system === 'NASEM2021' ? 'selected' : ''}>NASEM 2021</option>
              <option value="NRC2001" ${s.science.system === 'NRC2001' ? 'selected' : ''}>NRC 2001</option>
              <option value="INRA2018" ${s.science.system === 'INRA2018' ? 'selected' : ''}>INRA 2018</option>
            </select>
            <span class="hint">${t('settings.requirement_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('settings.dmi_method')}</label>
            <select id="set-dmi-method">
              <option value="auto" ${s.science.dmiMethod === 'auto' ? 'selected' : ''}>${t('settings.dmi_auto')}</option>
              <option value="NRC2001" ${s.science.dmiMethod === 'NRC2001' ? 'selected' : ''}>NRC 2001</option>
              <option value="deSouza2019" ${s.science.dmiMethod === 'deSouza2019' ? 'selected' : ''}>de Souza 2019</option>
            </select>
            <span class="hint">${t('settings.dmi_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('settings.calc_mode')}</label>
            <select id="set-calc-mode">
              <option value="nrc" ${(s.science.calcMode || 'nrc') === 'nrc' ? 'selected' : ''}>${t('settings.calc_mode_nrc')}</option>
              <option value="cncps" ${s.science.calcMode === 'cncps' ? 'selected' : ''}>${t('settings.calc_mode_cncps')}</option>
            </select>
            <span class="hint">${t('settings.calc_mode_hint')}</span>
          </div>
          <div class="form-group full-width">
            <label class="checkbox-label" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer">
              <input type="checkbox" id="set-energy-discount" ${s.science.autoEnergyDiscount !== false ? 'checked' : ''} style="width:auto" />
              ${t('settings.energy_discount')}
            </label>
            <span class="hint">${t('settings.energy_discount_hint')}</span>
          </div>
        </div>
        <div id="system-desc" class="system-desc-box"></div>
      </div>

      <!-- 2. Çiftlik Profili -->
      <div class="card mt-2">
        <div class="card-title">${t('settings.farm_profile')}</div>
        <div class="info-box">${t('settings.farm_profile_hint')}</div>
        <div class="form-grid">
          <div class="form-group">
            <label>${t('settings.farm_name')}</label>
            <input type="text" id="set-farm-name" maxlength="80"
              value="${escHtml(s.farm.name)}" />
          </div>
          <div class="form-group">
            <label>${t('settings.farm_advisor')}</label>
            <input type="text" id="set-farm-advisor" maxlength="80"
              value="${escHtml(s.farm.advisor)}" />
          </div>
          <div class="form-group full-width">
            <label>${t('settings.farm_address')}</label>
            <input type="text" id="set-farm-address" maxlength="160"
              value="${escHtml(s.farm.address)}" />
          </div>
          <div class="form-group">
            <label>${t('settings.latitude')}</label>
            <input type="number" id="set-farm-lat" step="0.000001" value="${s.farm.latitude !== null ? s.farm.latitude : ''}" placeholder="39.92077" />
          </div>
          <div class="form-group">
            <label>${t('settings.longitude')}
              <button type="button" id="btn-locate-me" class="btn btn-sm btn-secondary" style="margin-left:8px;"><i class="ti ti-map-pin"></i> ${t('settings.locate_me')}</button>
            </label>
            <input type="number" id="set-farm-lon" step="0.000001" value="${s.farm.longitude !== null ? s.farm.longitude : ''}" placeholder="32.85411" />
            <span class="hint">${t('settings.location_hint')}</span>
            <div id="farm-place-name" class="hint" style="margin-top:2px; font-weight:600; color:var(--primary)"></div>
          </div>
        </div>
      </div>

      <!-- 3. Varsayılan Değerler -->
      <div class="card mt-2">
        <div class="card-title">${t('settings.default_values')}</div>
        <div class="info-box">${t('settings.default_hint')}</div>
        <div class="form-grid">
          <div class="form-group">
            <label>${t('settings.ambient_temp')}</label>
            <input type="number" id="set-def-temp" min="-20" max="50" step="1" value="${num(s.defaults.ambientTemp)}" />
          </div>
          <div class="form-group">
            <label>${t('settings.humidity')}</label>
            <input type="number" id="set-def-humidity" min="0" max="100" step="1" value="${num(s.defaults.humidity)}" />
          </div>
          <div class="form-group">
            <label>${t('settings.default_parity')}</label>
            <select id="set-def-parity">
              ${[1, 2, 3, 4, 5].map(p => `<option value="${p}" ${s.defaults.parity === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>${t('settings.default_bcs')}</label>
            <input type="number" id="set-def-bcs" min="1" max="5" step="0.25" value="${num(s.defaults.bcs)}" />
          </div>
          <div class="form-group">
            <label>${t('settings.milk_price')}</label>
            <input type="number" id="set-def-milkprice" min="0" step="0.5" value="${num(s.defaults.milkPrice_tl)}" />
          </div>
        </div>
      </div>

      <!-- 4. Birim, Dil & Tema -->
      <div class="card mt-2">
        <div class="card-title">${t('settings.units_lang_theme')}</div>
        <div class="form-grid">
          <div class="form-group">
            <label>${t('settings.units')}</label>
            <select id="set-units">
              <option value="metric" ${s.units === 'metric' ? 'selected' : ''}>${t('settings.metric')}</option>
              <option value="imperial" ${s.units === 'imperial' ? 'selected' : ''}>${t('settings.imperial')}</option>
            </select>
            <span class="hint">${t('settings.units_hint')}</span>
          </div>
          <div class="form-group">
            <label>${t('settings.language')}</label>
            <select id="set-language">
              <option value="tr" ${s.language === 'tr' ? 'selected' : ''}>Türkçe</option>
              <option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option>
            </select>
            <span class="hint">${t('settings.language_desc')}</span>
          </div>
          <div class="form-group">
            <label>${t('settings.theme')}</label>
            <select id="set-theme">
              <option value="light" ${s.theme === 'light' ? 'selected' : ''}>${t('settings.theme_light')}</option>
              <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>${t('settings.theme_dark')}</option>
            </select>
            <span class="hint">${t('settings.theme_hint')}</span>
          </div>
        </div>
      </div>

      <!-- Hesap & Bulut (FAZ 16.10) -->
      <div class="card mt-2" id="cloud-settings-card">
        <div class="card-title"><i class="ti ti-cloud"></i> ${t('cloud.settings_title')}</div>
        <div class="info-box" id="cloud-settings-hint">${t('cloud.settings_hint')}</div>
        <div id="cloud-settings-status" class="auth-status-row" style="margin:0.4rem 0"></div>
        <button class="btn btn-primary" id="cloud-open-account"><i class="ti ti-login"></i> ${t('cloud.open_account')}</button>
      </div>

      <!-- 5. Veri Yönetimi -->
      <div class="card mt-2">
        <div class="card-title">${t('settings.data_management')}</div>
        <div class="info-box">${t('settings.data_hint')}</div>
        <div class="btn-row">
          <button class="btn btn-secondary" id="set-backup-download"><i class="ti ti-download"></i> ${t('settings.backup')}</button>
          <button class="btn btn-secondary" id="set-backup-restore-btn"><i class="ti ti-upload"></i> ${t('settings.restore')}</button>
          <input type="file" id="set-backup-file" accept="application/json,.json" style="display:none" />
          <button class="btn btn-secondary" id="set-clear-cache" title="${t('settings.clear_cache_hint')}"><i class="ti ti-refresh"></i> ${t('settings.clear_cache')}</button>
          <button class="btn btn-danger" id="set-clear-data"><i class="ti ti-trash"></i> ${t('settings.clear_data')}</button>
        </div>
        <div class="text-small text-muted mt-1">${t('settings.data_warning')}</div>
      </div>

      <!-- Kaydet / Genel -->
      <div class="card mt-2">
        <div class="btn-row">
          <button class="btn btn-primary" id="set-save"><i class="ti ti-device-floppy"></i> ${t('settings.save')}</button>
          <button class="btn btn-secondary" id="set-show-onboarding"><i class="ti ti-help-circle"></i> ${t('settings.show_onboarding')}</button>
          <button class="btn btn-secondary" id="set-reset"><i class="ti ti-arrow-back-up"></i> ${t('settings.reset')}</button>
        </div>
        <div id="set-status" class="text-small text-muted mt-1">
          ${s.updatedAt ? `${t('settings.last_saved')}: ${new Date(s.updatedAt).toLocaleString()}` : t('settings.not_customized')}
        </div>
      </div>
    </div>
  `;

  const systemSelect = container.querySelector('#set-system');
  const descBox = container.querySelector('#system-desc');

  function refreshDesc() {
    const info = SYSTEM_INFO[systemSelect.value] || SYSTEM_INFO.NASEM2021;
    descBox.innerHTML = `<b>${escHtml(info.label)}:</b> ${info.desc}`;
  }
  refreshDesc();
  systemSelect.addEventListener('change', refreshDesc);

  // ── Hesap & Bulut (FAZ 16.10) ──
  const cloudCard = container.querySelector('#cloud-settings-card');
  if (cloudCard) {
    const statusEl = cloudCard.querySelector('#cloud-settings-status');
    if (!isCloudConfigured()) {
      cloudCard.querySelector('#cloud-settings-hint').textContent = t('cloud.not_configured');
      cloudCard.querySelector('#cloud-open-account').style.display = 'none';
      statusEl.style.display = 'none';
    } else {
      const renderStatus = (st) => {
        if (!st.user) { statusEl.innerHTML = `<i class="ti ti-plug-connected-x"></i> ${escHtml(t('cloud.not_logged_in'))}`; return; }
        const icon = CLOUD_STATUS_ICON[st.status] || 'ti-cloud';
        const label = st.status === 'pending' && st.pending > 0
          ? `${t('cloud.status_pending')} (${st.pending})`
          : t(`cloud.status_${st.status}`);
        statusEl.innerHTML = `<i class="ti ${icon}"></i> <b>${escHtml(st.user.email)}</b> — ${escHtml(label)}`;
      };
      renderStatus(getSyncState());
      // Canlı güncelle; settings yeniden render edilince eski abonelik kendini iptal eder
      const unsub = onSyncStatus((st) => {
        if (!document.body.contains(statusEl)) { unsub(); return; }
        renderStatus(st);
      });
      cloudCard.querySelector('#cloud-open-account').addEventListener('click', () => openAuthModal());
    }
  }

  // ── Konum Bul (Geolocation) ──
  const btnLocate = container.querySelector('#btn-locate-me');
  if (btnLocate) {
    btnLocate.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Tarayıcınız konum bulmayı desteklemiyor.', 'error');
        return;
      }
      btnLocate.innerHTML = '<i class="ti ti-loader-2 ti-spin"></i> Aranıyor...';
      btnLocate.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          container.querySelector('#set-farm-lat').value = pos.coords.latitude.toFixed(6);
          container.querySelector('#set-farm-lon').value = pos.coords.longitude.toFixed(6);
          showToast('Konum başarıyla bulundu.', 'success');
          btnLocate.innerHTML = '<i class="ti ti-map-pin"></i> Konumumu Bul';
          btnLocate.disabled = false;
          resolvePlaceName();   // #19: koordinatları yer adına çevir ve göster
        },
        (err) => {
          console.warn('Geolocation error:', err);
          showToast('Konum alınamadı: İzin verilmemiş olabilir.', 'error');
          btnLocate.innerHTML = '<i class="ti ti-map-pin"></i> Konumumu Bul';
          btnLocate.disabled = false;
        },
        { timeout: 10000 }
      );
    });
  }

  // #19: koordinatları yer adına çevirip göster (reverse geocoding; başarısızsa boş kalır)
  async function resolvePlaceName() {
    const out = container.querySelector('#farm-place-name');
    if (!out) return;
    const lat = parseFloat(container.querySelector('#set-farm-lat')?.value);
    const lon = parseFloat(container.querySelector('#set-farm-lon')?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { out.textContent = ''; return; }
    out.innerHTML = '<i class="ti ti-map-pin"></i> …';
    const place = await reverseGeocode(lat, lon);
    out.innerHTML = place ? `<i class="ti ti-map-pin"></i> ${escHtml(place.name)}` : '';
  }
  container.querySelector('#set-farm-lat')?.addEventListener('change', resolvePlaceName);
  container.querySelector('#set-farm-lon')?.addEventListener('change', resolvePlaceName);
  resolvePlaceName();   // ilk render: mevcut koordinatlar varsa yer adını çöz

  // ── Kaydet ──
  container.querySelector('#set-save').addEventListener('click', () => {
    const payload = {
      science: {
        system: systemSelect.value,
        dmiMethod: container.querySelector('#set-dmi-method').value,
        autoEnergyDiscount: container.querySelector('#set-energy-discount').checked,  // FAZ 18.4
        calcMode: container.querySelector('#set-calc-mode').value,  // FAZ 19.1: nrc | cncps
      },
      farm: {
        name: container.querySelector('#set-farm-name').value.trim(),
        advisor: container.querySelector('#set-farm-advisor').value.trim(),
        address: container.querySelector('#set-farm-address').value.trim(),
        latitude: numOrNull(container.querySelector('#set-farm-lat').value),
        longitude: numOrNull(container.querySelector('#set-farm-lon').value),
      },
      defaults: {
        ambientTemp: numOr(container.querySelector('#set-def-temp').value, 20),
        humidity: numOr(container.querySelector('#set-def-humidity').value, 50),
        parity: numOr(container.querySelector('#set-def-parity').value, 2),
        bcs: numOr(container.querySelector('#set-def-bcs').value, 3.0),
        milkPrice_tl: numOr(container.querySelector('#set-def-milkprice').value, 18),
      },
      units: container.querySelector('#set-units').value,
      language: container.querySelector('#set-language').value,
      theme: container.querySelector('#set-theme').value,
    };
    const saved = saveSettings(payload);
    setLanguage(payload.language);
    onSettingsChange(saved);
    showToast(t('settings.saved_toast'), 'success');
    const status = container.querySelector('#set-status');
    if (status) status.textContent = `${t('settings.last_saved')}: ${new Date(saved.updatedAt).toLocaleString()}`;
  });

  // ── Yedek İndir ──
  container.querySelector('#set-backup-download').addEventListener('click', async () => {
    try {
      const data = await exportAllData();
      data.settings = getSettings();   // ayarları da yedeğe dahil et
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `rasyon-yedek-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Yedek dosyası indirildi.', 'success');
    } catch (err) {
      console.error('Yedek hatası:', err);
      showToast('Yedek alınamadı: ' + err.message, 'error');
    }
  });

  // ── Yedekten Geri Yükle ──
  const fileInput = container.querySelector('#set-backup-file');
  container.querySelector('#set-backup-restore-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Yedek geri yüklensin mi? Mevcut tüm veriler bu yedekle değiştirilecek.')) {
      fileInput.value = '';
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const counts = await importAllData(data);   // geçersizse fırlatır
      if (data.settings) saveSettings(data.settings);
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      showToast(`Geri yükleme tamam (${total} kayıt). Sayfa yenileniyor...`, 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      console.error('Geri yükleme hatası:', err);
      showToast('Geri yükleme başarısız: ' + err.message, 'error');
    } finally {
      fileInput.value = '';
    }
  });

  // ── Tüm Verileri Temizle ──
  container.querySelector('#set-clear-data').addEventListener('click', async () => {
    if (!confirm('TÜM hayvan profilleri, rasyonlar, sürü grupları, gözlemler ve fiyat geçmişi silinecek. Bu işlem geri alınamaz. Devam edilsin mi?')) return;
    if (!confirm('Emin misiniz? Son uyarı — yedeğiniz yoksa veriler kalıcı olarak kaybolur.')) return;
    try {
      await clearAllData();
      showToast('Tüm veriler temizlendi. Sayfa yenileniyor...', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      console.error('Temizleme hatası:', err);
      showToast('Temizleme başarısız: ' + err.message, 'error');
    }
  });

  // ── Uygulamayı Güncelle / Önbellek Temizle (PWA — denetim düzeltmesi) ──
  // Service-Worker / Cache Storage'daki bayat asset'leri temizler + SW'yi günceller +
  // sayfayı yeniler. IndexedDB VERİSİ SİLİNMEZ (clear-data'dan farklı; offline korunur).
  const clearCacheBtn = container.querySelector('#set-clear-cache');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      if (!confirm(t('settings.clear_cache_confirm'))) return;
      try {
        if (typeof caches !== 'undefined') {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n)));
        }
        if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.update().catch(() => {})));
        }
        showToast(t('settings.clear_cache_done'), 'success');
        setTimeout(() => window.location.reload(), 800);
      } catch (err) {
        console.error('Önbellek temizleme hatası:', err);
        showToast('Önbellek temizleme başarısız: ' + err.message, 'error');
      }
    });
  }

  // ── Onboarding tekrar göster ──
  container.querySelector('#set-show-onboarding').addEventListener('click', () => {
    resetOnboarding();
    showOnboarding();
  });

  // ── Varsayılana döndür ──
  container.querySelector('#set-reset').addEventListener('click', () => {
    if (!confirm('Tüm ayarlar varsayılana döndürülsün mü? (Hayvan profilleri ve rasyonlar etkilenmez.)')) return;
    const def = resetSettings();
    onSettingsChange(def);
    showToast('Ayarlar varsayılana döndürüldü.', 'success');
    renderSettingsPanel(container, state, options);  // formu tazele
  });
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────────

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : '';
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

