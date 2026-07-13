/**
 * Senkron Motoru (FAZ 16.10) — Local-First push/pull orkestratörü.
 *
 * Backend'den bağımsız: bir `SyncAdapter` ardına çalışır → çekirdek mantık
 * Supabase olmadan (mockAdapter ile) tam test edilir.
 *
 * SyncAdapter arayüzü:
 *   async pushChanges(storeName, records) → { ok:boolean, ... }
 *      records: tam yerel kayıtlar (tombstone DAHİL; id/updatedAt/deletedAt/farmId taşır)
 *   async pullChanges(storeName, sinceTimestamp|null) → object[]
 *      sinceTimestamp'tan beri değişen uzak kayıtlar (tombstone dahil)
 *
 * İlke (LWW — last-write-wins): her kayıt `updatedAt` taşır; çakışmada en son
 * yazan kazanır. Önce PULL (uzak değişiklikleri al), sonra PUSH (yerel değişimleri
 * gönder) → yerel kayıt uzaktan daha yeniyse korunur ve gönderilir.
 */

import {
  SYNC_STORES, getDirtyRecords, markRecordsSynced, applyRemoteRecord,
} from '../db.js';

/** Senkronlanan tüm store'lar (Hiyerarşik sıralı: önce bağımsızlar, sonra bağımlılar) */
export const SYNCABLE_STORES = [
  'userSettings',      // FAZ 16.11: kullanıcı ayarları
  'farms',             // Hiçbir şeye bağımlı değil
  'userFeeds',         // Hiçbir şeye bağımlı değil
  'rations',           // farms'a bağımlı
  'animalProfiles',    // farms'a bağımlı
  'herdGroups',        // farms ve rations'a bağımlı
  'fieldObservations', // farms ve animalProfiles'a bağımlı
  'feedPriceHistory'   // farms ve userFeeds'e bağımlı
];

// ─── lastPull durumu (store başına son çekilen zaman damgası) ─────────────────

const LAST_PULL_KEY = 'rasyon_sync_lastPull_v1';
const _memory = new Map();

function readLastPull() {
  let raw;
  try { raw = localStorage.getItem(LAST_PULL_KEY); }
  catch { raw = _memory.get(LAST_PULL_KEY) ?? null; }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function writeLastPull(map) {
  const raw = JSON.stringify(map);
  try { localStorage.setItem(LAST_PULL_KEY, raw); }
  catch { _memory.set(LAST_PULL_KEY, raw); }
}

/** lastPull durumunu sıfırla (çıkış / hesap değişimi / test temizliği). */
export function resetSyncState() {
  try { localStorage.removeItem(LAST_PULL_KEY); }
  catch { _memory.delete(LAST_PULL_KEY); }
}

// ─── Tekil store senkronu ─────────────────────────────────────────────────────

/**
 * Yerel kirli (dirty) kayıtları buluta iter ve başarılıysa dirty bayrağını temizler.
 * @param {object} adapter @param {string} storeName
 * @returns {Promise<{pushed:number}>}
 */
export async function pushStore(adapter, storeName) {
  const dirty = await getDirtyRecords(storeName);
  if (dirty.length === 0) return { pushed: 0 };
  const res = await adapter.pushChanges(storeName, dirty);
  if (res && res.ok === false) {
    throw new Error(res.error || `pushChanges başarısız: ${storeName}`);
  }
  await markRecordsSynced(storeName, dirty.map(r => ({ id: r.id, updatedAt: r.updatedAt })));
  return { pushed: dirty.length };
}

/**
 * Uzaktaki (son çekimden beri değişen) kayıtları çeker ve LWW ile yerele uygular.
 * @param {object} adapter @param {string} storeName
 * @returns {Promise<{applied:number, fetched:number}>}
 */
export async function pullStore(adapter, storeName) {
  const lastPull = readLastPull();
  const since = lastPull[storeName] || null;
  const remote = await adapter.pullChanges(storeName, since);
  let applied = 0;
  let maxTs = since || '';
  for (const r of remote || []) {
    if (await applyRemoteRecord(storeName, r)) applied++;
    if (r.updatedAt && r.updatedAt > maxTs) maxTs = r.updatedAt;
  }
  if (maxTs) {
    lastPull[storeName] = maxTs;
    writeLastPull(lastPull);
  }
  return { applied, fetched: (remote || []).length };
}

/**
 * Tek store'u tam senkronla: önce pull (uzak → yerel), sonra push (yerel → uzak).
 * @param {object} adapter @param {string} storeName
 */
export async function syncStore(adapter, storeName) {
  const pull = await pullStore(adapter, storeName);
  const push = await pushStore(adapter, storeName);
  return { store: storeName, ...pull, ...push };
}

/**
 * Tüm senkronlanabilir store'ları sırayla senkronlar.
 * @param {object} adapter
 * @param {object} [opts] @param {string[]} [opts.stores]
 * @returns {Promise<{ok:boolean, results:object[], pushed:number, applied:number, at:string}>}
 */
export async function syncAll(adapter, { stores = SYNCABLE_STORES } = {}) {
  const results = [];
  for (const s of stores) {
    results.push(await syncStore(adapter, s));
  }
  const pushed = results.reduce((n, r) => n + (r.pushed || 0), 0);
  const applied = results.reduce((n, r) => n + (r.applied || 0), 0);
  return { ok: true, results, pushed, applied, at: new Date().toISOString() };
}

/**
 * Buluta itilmeyi bekleyen (kirli) toplam kayıt sayısı — UI göstergesi için.
 * @returns {Promise<number>}
 */
export async function countPendingChanges() {
  let total = 0;
  for (const s of SYNCABLE_STORES) {
    total += (await getDirtyRecords(s)).length;
  }
  return total;
}
