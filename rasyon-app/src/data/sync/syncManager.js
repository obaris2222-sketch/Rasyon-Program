/**
 * Senkron Yöneticisi (FAZ 16.10 — Aşama 1).
 *
 * syncEngine + supabaseAdapter + tetikleyicileri (giriş / çevrimiçi olma /
 * sekme öne gelme / periyodik) birleştirir; durum (status) yayınlar.
 *
 * Local-first: arka planda çalışır, UI'ı bloklamaz. Çevrimdışıyken sessizce
 * bekler, çevrimiçi olunca otomatik devam eder.
 */

import { getSupabaseClient } from './supabaseClient.js';
import { createSupabaseAdapter } from './supabaseAdapter.js';
import { syncAll, countPendingChanges, resetSyncState } from './syncEngine.js';
import {
  clearAllData, farmGetAll, ensureDefaultFarm, setActiveFarmId,
} from '../db.js';
import { getSettings, saveSettings } from '../settings.js';

const SYNC_USER_KEY = 'rasyon_sync_user';
const PERIODIC_MS = 30000;   // 30 sn periyodik kontrol

const _state = {
  status: 'idle',     // idle | syncing | synced | pending | offline | error
  user: null,         // { id, email }
  lastSyncAt: null,
  pending: 0,
  error: null,
};
const _listeners = new Set();
let _adapter = null;
let _timer = null;
let _syncing = false;
let _boundOnline = null;
let _boundVisible = null;
let _boundChange = null;
let _debounceTimer = null;
const DEBOUNCE_MS = 4000;   // yerel yazma sonrası push gecikmesi (ardışık yazmaları toplar)

/** Yerel değişiklik sonrası debounce'lu senkron planla (anlık his). */
function scheduleSync() {
  if (!_adapter) return;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { if (typeof navigator === 'undefined' || navigator.onLine) syncNow(); }, DEBOUNCE_MS);
}

// ─── Durum yayını ─────────────────────────────────────────────────────────────

export function getSyncState() { return { ..._state }; }

export function onSyncStatus(cb) {
  _listeners.add(cb);
  cb(getSyncState());
  return () => _listeners.delete(cb);
}

function emit() {
  const snap = getSyncState();
  for (const cb of _listeners) { try { cb(snap); } catch { /* ignore */ } }
}

function setStatus(status, extra = {}) {
  _state.status = status;
  Object.assign(_state, extra);
  emit();
}

// ─── Başlat / Durdur ─────────────────────────────────────────────────────────

/**
 * Senkronu başlat (girişten sonra çağrılır). Hesap değişikliği güvenliği:
 * cihazda farklı bir kullanıcı giriş yaptıysa önceki yerel kullanıcı verisi
 * temizlenir (cross-account sızıntı önlenir).
 * @param {{id:string, email?:string}} user
 */
export async function startSync(user) {
  if (!user?.id) return;
  // Zaten bu kullanıcı için aktifse tekrar başlatma (TOKEN_REFRESHED/INITIAL_SESSION
  // tekrarlı tetiklenir → çift senkron/çift dinleyici önlenir).
  if (_state.user?.id === user.id && _adapter) return;
  _state.user = { id: user.id, email: user.email || '' };

  // Hesap değişikliği kontrolü (paylaşılan cihaz güvenliği)
  let prevUser = null;
  try { prevUser = localStorage.getItem(SYNC_USER_KEY); } catch { /* yok */ }
  if (prevUser && prevUser !== user.id) {
    await clearAllData({ includeUserFeeds: true });   // önceki kullanıcının TÜM yerel verisi (kullanıcı yemleri dahil) — cross-account sızıntı önlenir
    resetSyncState();          // pull imleçlerini sıfırla → tam yeniden çek
  }
  try { localStorage.setItem(SYNC_USER_KEY, user.id); } catch { /* yok */ }

  const client = await getSupabaseClient();
  if (!client) { setStatus('idle'); return; }
  _adapter = createSupabaseAdapter(client, user.id);

  // İlk tam senkron + aktif çiftlik uzlaştırma
  await syncNow();
  await reconcileActiveFarm();

  // Tetikleyiciler
  _boundOnline = () => { if (navigator.onLine) syncNow(); };
  _boundVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine) syncNow(); };
  window.addEventListener('online', _boundOnline);
  document.addEventListener('visibilitychange', _boundVisible);
  if (_timer) clearInterval(_timer);
  // Periyodik: çevrimiçiyken her zaman senkronla (pull uzak değişiklikleri getirir +
  // push yereli gönderir). NOT: `_state.pending` koşulu KULLANILMAZ — yerel yazma
  // sonrası bayat kalır (yazma→syncManager kancası yok) ve uzak çekimi de engellerdi.
  _timer = setInterval(() => { if (navigator.onLine) syncNow(); }, PERIODIC_MS);
  // Yerel yazma → debounce'lu push (db.js 'rasyon:local-change' olayını yayar)
  _boundChange = () => scheduleSync();
  window.addEventListener('rasyon:local-change', _boundChange);
}

/** Senkronu durdur (çıkışta). Yerel veri KORUNUR. */
export function stopSync() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_boundOnline) window.removeEventListener('online', _boundOnline);
  if (_boundVisible) document.removeEventListener('visibilitychange', _boundVisible);
  if (_boundChange) window.removeEventListener('rasyon:local-change', _boundChange);
  _boundOnline = _boundVisible = _boundChange = null;
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  _adapter = null;
  _state.user = null;
  _state.pending = 0;
  resetSyncState();
  // KRİTİK: SYNC_USER_KEY KORUNUR (silinmez) — çıkıştan sonra FARKLI bir kullanıcı
  // giriş yaparsa hesap değişikliği tespit edilip yerel veri temizlensin (aksi halde
  // önceki kullanıcının profilleri/yemleri yeni kullanıcıya sızar — paylaşılan cihaz).
  setStatus('idle');
}

// ─── Senkron çalıştır ─────────────────────────────────────────────────────────

/** Şimdi senkronize et (manuel veya tetikleyici). Çakışmayı önler (tek seferde bir). */
export async function syncNow() {
  if (!_adapter || _syncing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setStatus('offline');
    return;
  }
  _syncing = true;
  setStatus('syncing', { error: null });
  try {
    const res = await syncAll(_adapter);
    _state.lastSyncAt = res.at;
    _state.pending = await countPendingChanges();
    setStatus(_state.pending > 0 ? 'pending' : 'synced');
  } catch (err) {
    console.warn('[cloud] Senkron hatası:', err);
    setStatus('error', { error: err.message });
  } finally {
    _syncing = false;
  }
}

/**
 * Pull sonrası aktif çiftliği uzlaştırır: ayarlardaki çiftlik hâlâ varsa korur,
 * yoksa ilk çiftliği (veya yeni "Varsayılan Çiftlik") seçer.
 */
async function reconcileActiveFarm() {
  try {
    const farms = await farmGetAll();
    const settings = getSettings();
    let active = farms.find(f => f.id === settings.activeFarmId);
    if (!active) {
      active = farms[0] || await ensureDefaultFarm();
      saveSettings({ activeFarmId: active.id });
    }
    setActiveFarmId(active.id);
  } catch (err) {
    console.warn('[cloud] Aktif çiftlik uzlaştırma hatası:', err);
  }
}
