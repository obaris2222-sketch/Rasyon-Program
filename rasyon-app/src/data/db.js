/**
 * IndexedDB Altyapısı — rasyon-db
 * idb kütüphanesi v8 kullanır.
 *
 * Stores:
 *   feeds              → yem maddesi kayıtları (FeedIngredient şeması)
 *   rations            → rasyon kayıtları       (Ration şeması)
 *   animalProfiles     → hayvan profil kayıtları (AnimalProfile şeması)
 *   herdGroups         → sürü grubu kayıtları   (HerdGroup şeması)
 *   feedPriceHistory   → yem fiyat geçmişi (FAZ 11A) — tarih bazlı snapshot
 *   fieldObservations  → saha gözlemleri (FAZ 11B) — haftalık süt/BCS/DMI
 *   farms              → çiftlik kayıtları (FAZ 16.10/16.11) — çoklu-çiftlik/danışman
 *
 * FAZ 16.10 — Bulut Senkronizasyon temeli:
 *   - Tüm kullanıcı kayıtları UUID anahtarlıdır (cihazlar arası çakışma yok)
 *   - Senkron meta verisi her kayıtta: updatedAt (LWW), deletedAt (tombstone),
 *     farmId (kapsam), _dirty (buluta itilmeyi bekliyor)
 *   - Soft delete: *Delete tombstone bırakır; okumalar deletedAt'i filtreler
 *   - DB v2 → v3 göçü: eski sayısal autoIncrement id'leri UUID'ye çevirir +
 *     yabancı anahtarları (groupId/rationId/profileId) yeniden yazar
 */

import { openDB } from 'idb';
import { newId } from './uuid.js';
import { getSettings, clearSettingsDirty, applyRemoteSettings } from './settings.js';

// ─── Sabitler ───────────────────────────────────────────────────────────────

export const DB_NAME    = 'rasyon-db';
export const DB_VERSION = 4;  // FAZ 16.10: UUID göçü + farms store + senkron meta, v4: aiChats

/**
 * Senkronizasyona tabi kullanıcı store'ları (çiftlik-kapsamlı).
 * `feeds` (paylaşılan kütüphane, seed) ve `farms` (sahip-kapsamlı) ayrı ele alınır.
 */
export const SYNC_STORES = [
  'animalProfiles', 'rations', 'herdGroups', 'feedPriceHistory', 'fieldObservations', 'aiChats',
];

// ─── Aktif çiftlik (modül-içi; app katmanı setActiveFarmId ile besler) ────────
// Test ortamında ayarlanmaz → null → yazmalarda farmId stamplanmaz, okumalar
// çiftliğe göre filtrelenmez (mevcut davranış birebir korunur).
let _activeFarmId = null;

/** Aktif çiftlik id'sini ayarla (app init / çiftlik geçişi). */
export function setActiveFarmId(id) { _activeFarmId = id ?? null; }
/** Aktif çiftlik id'sini döndür. */
export function getActiveFarmId() { return _activeFarmId; }

// ─── Veritabanı açma / şema oluşturma ────────────────────────────────────────

let _db = null;

/**
 * Veritabanını aç (singleton). İlk çağrıda şema oluşturulur / göç yapılır.
 * @returns {Promise<IDBDatabase>}
 */
export async function getDB() {
  if (_db) return _db;

  _db = await openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, newVersion, tx) {
      // ── feeds store (tüm sürümler; string id, değişmez) ──────────────
      if (!db.objectStoreNames.contains('feeds')) {
        const feedStore = db.createObjectStore('feeds', { keyPath: 'id' });
        feedStore.createIndex('by_category', 'category', { unique: false });
        feedStore.createIndex('by_name',     'name',     { unique: false });
        feedStore.createIndex('by_source',   'source',   { unique: false });
      }

      // ── animalProfiles store ─────────────────────────────────────────
      if (!db.objectStoreNames.contains('animalProfiles')) {
        const apStore = db.createObjectStore('animalProfiles', {
          keyPath: 'id', autoIncrement: true,
        });
        apStore.createIndex('by_name', 'name', { unique: false });
      }

      // ── rations store ────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('rations')) {
        const rStore = db.createObjectStore('rations', {
          keyPath: 'id', autoIncrement: true,
        });
        rStore.createIndex('by_name',      'name',      { unique: false });
        rStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
      }

      // ── herdGroups store ─────────────────────────────────────────────
      if (!db.objectStoreNames.contains('herdGroups')) {
        const hgStore = db.createObjectStore('herdGroups', {
          keyPath: 'id', autoIncrement: true,
        });
        hgStore.createIndex('by_name', 'name', { unique: false });
      }

      // ── FAZ 11A: feedPriceHistory store ──────────────────────────────
      if (oldVersion < 2 && !db.objectStoreNames.contains('feedPriceHistory')) {
        const phStore = db.createObjectStore('feedPriceHistory', {
          keyPath: 'id', autoIncrement: true,
        });
        phStore.createIndex('by_feedId', 'feedId', { unique: false });
        phStore.createIndex('by_date',   'date',   { unique: false });
        phStore.createIndex('by_region', 'region', { unique: false });
      }

      // ── FAZ 11B: fieldObservations store ─────────────────────────────
      if (oldVersion < 2 && !db.objectStoreNames.contains('fieldObservations')) {
        const obsStore = db.createObjectStore('fieldObservations', {
          keyPath: 'id', autoIncrement: true,
        });
        obsStore.createIndex('by_profileId', 'profileId', { unique: false });
        obsStore.createIndex('by_date',      'date',      { unique: false });
      }

      // ── FAZ 16.10: eski sayısal id'leri UUID'ye göç et (yalnız mevcut DB) ──
      // Fresh DB (oldVersion 0) için yeni kayıtlar zaten UUID alır → göç gereksiz.
      if (oldVersion >= 1 && oldVersion < 3) {
        await migrateNumericIdsToUuid(db, tx);
      }

      // ── FAZ 16.10/16.11: farms store ─────────────────────────────────
      if (!db.objectStoreNames.contains('farms')) {
        const fStore = db.createObjectStore('farms', { keyPath: 'id' });
        fStore.createIndex('by_name', 'name', { unique: false });
      }

      // ── AI Sohbet Geçmişi (v4) ───────────────────────────────────────
      if (!db.objectStoreNames.contains('aiChats')) {
        const aiStore = db.createObjectStore('aiChats', { keyPath: 'id' });
        aiStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
      }
    },
  });

  return _db;
}

/**
 * Singleton'ı sıfırla. Sadece test ortamında kullanılır.
 */
export function _resetDB() {
  _db = null;
}

// ─── Yardımcı: timestamp ─────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

// ─── FAZ 16.10: Senkron meta verisi yardımcıları ─────────────────────────────

/**
 * Bir kayda senkron meta verisini damgalar (id/farmId/updatedAt/deletedAt/_dirty).
 * `feeds` HARİÇ tüm kullanıcı kayıtları için yazma öncesi çağrılır.
 * @param {object} rec
 * @param {object} [opts]
 *   @param {boolean} [opts.scoped=true] — farmId stample (farms kendisi için false)
 * @returns {object} yeni nesne (rec mutasyona uğramaz)
 */
function withSyncMeta(rec, { scoped = true } = {}) {
  const out = { ...rec };
  if (!out.id) out.id = newId();
  if (scoped && out.farmId === undefined) out.farmId = _activeFarmId ?? null;
  if (out.deletedAt === undefined) out.deletedAt = null;
  out.updatedAt = now();    // LWW için kanonik zaman damgası
  out._dirty = true;        // buluta itilmeyi bekliyor
  notifyLocalChange();      // debounce'lu push tetikleyici (syncManager dinler)
  return out;
}

/**
 * Yerel kullanıcı yazması olduğunu bildirir (debounce'lu bulut push için).
 * Tarayıcı olayı; Node/test ortamında (window yok) sessizce atlanır.
 * applyRemoteRecord/migration/backfill bunu ÇAĞIRMAZ (yalnız withSyncMeta + softDelete).
 */
function notifyLocalChange() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('rasyon:local-change'));
  }
}

/** Bir kaydın canlı (tombstone değil) olup olmadığı. */
function notDeleted(r) {
  return r != null && !r.deletedAt;
}

/**
 * Görünür kayıtlar: tombstone'ları eler + aktif çiftliğe göre kapsamlar (FAZ 16.11).
 * Aktif çiftlik ayarlı değilse (test/legacy) yalnız tombstone filtresi uygulanır.
 * farmId'siz (null) eski kayıtlar her çiftlikte görünür (güvenli geri uyumluluk).
 */
function visible(records) {
  const live = records.filter(notDeleted);
  if (!_activeFarmId) return live;
  return live.filter(r => r.farmId === _activeFarmId || r.farmId == null);
}

/**
 * Bir yemin kullanıcı yemi olup olmadığı (FAZ 16.11). Kullanıcı yemleri buluta
 * senkronlanır (advisor-global); paketli 500-yem seed kütüphanesi yereldir.
 */
function isUserFeed(feed) {
  return !!feed && (feed.source === 'user' || /^(user_|custom_)/.test(feed.id || ''));
}

/**
 * Sanal senkron store adlarını fiziksel IndexedDB store'una eşler.
 * 'userFeeds' (advisor-global kullanıcı yemleri) fiziksel 'feeds' store'unda durur.
 */
const STORE_REDIRECT = { userFeeds: 'feeds' };
function physStore(name) { return STORE_REDIRECT[name] || name; }

/**
 * Soft delete: kaydı silmek yerine deletedAt damgalar (tombstone).
 * Böylece silme diğer cihazlara senkronla yayılır.
 * @param {string} storeName
 * @param {*} id
 */
async function softDelete(storeName, id) {
  const db = await getDB();
  const rec = await db.get(storeName, id);
  if (!rec) return;
  rec.deletedAt = now();
  rec.updatedAt = now();
  rec._dirty = true;
  await db.put(storeName, rec);
  notifyLocalChange();   // silme de debounce'lu push tetikler
}

/**
 * DB v2 → v3 göçü: eski sayısal (autoIncrement) id'leri UUID'ye çevirir ve
 * yabancı anahtarları (groupId/rationId/profileId) yeniden yazar.
 * Tümü tek versionchange transaction'ında → hata olursa abort, DB v2'de kalır.
 * @param {IDBPDatabase} db
 * @param {IDBPTransaction} tx — upgrade transaction (versionchange)
 */
async function migrateNumericIdsToUuid(db, tx) {
  // Bağımlılık sırası önemsiz — tüm haritalar önce kurulur, sonra yazılır.
  const stores = SYNC_STORES;

  // 1. Tüm eski kayıtları oku + her store için sayısal→UUID haritası kur
  const data = {};
  const idMap = {};
  for (const name of stores) {
    if (!db.objectStoreNames.contains(name)) continue;
    const recs = await tx.objectStore(name).getAll();
    data[name] = recs;
    const m = new Map();
    for (const r of recs) {
      if (r && r.id != null && typeof r.id !== 'string') {
        const nid = newId();
        m.set(r.id, nid);
        m.set(String(r.id), nid);
      }
    }
    idMap[name] = m;
  }

  const remapFk = (val, map) => {
    if (!map) return val;
    return map.get(val) ?? map.get(String(val)) ?? val;
  };

  // 2. Sayısal id'li kayıtları sil + UUID'li + FK-yeniden-yazılmış halini ekle
  for (const name of stores) {
    if (!data[name]) continue;
    const store = tx.objectStore(name);
    for (const r of data[name]) {
      if (!r || r.id == null || typeof r.id === 'string') continue; // zaten UUID/string
      const oldId = r.id;
      const rec = { ...r, id: idMap[name].get(oldId) };

      if (name === 'animalProfiles' && rec.groupId != null) {
        rec.groupId = remapFk(rec.groupId, idMap.herdGroups);
      }
      if (name === 'herdGroups' && rec.rationId != null) {
        rec.rationId = remapFk(rec.rationId, idMap.rations);
      }
      if (name === 'fieldObservations' && rec.profileId != null) {
        rec.profileId = remapFk(rec.profileId, idMap.animalProfiles);
      }
      // feedPriceHistory.feedId → feeds (string id, değişmez)

      // Senkron meta verisini geriye dönük doldur
      if (rec.deletedAt === undefined) rec.deletedAt = null;
      if (!rec.updatedAt) rec.updatedAt = rec._updatedAt || rec._createdAt || now();
      rec._dirty = true;   // göç sonrası ilk girişte buluta itilir

      await store.delete(oldId);
      await store.put(rec);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEEDS CRUD  (paylaşılan kütüphane — Stage 0'da senkron/soft-delete kapsamı DIŞI)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tüm yem maddelerini döndür.
 * @returns {Promise<FeedIngredient[]>}
 */
export async function feedGetAll() {
  const db = await getDB();
  return (await db.getAll('feeds')).filter(f => !f.deletedAt);   // kullanıcı-yemi tombstone'ları gizle
}

/**
 * Belirli bir kategorideki yem maddelerini döndür.
 * @param {string} category — roughage | grain | protein | byproduct | fat | mineral
 * @returns {Promise<FeedIngredient[]>}
 */
export async function feedGetByCategory(category) {
  const db = await getDB();
  return (await db.getAllFromIndex('feeds', 'by_category', category)).filter(f => !f.deletedAt);
}

/**
 * ID ile tek yem maddesi getir.
 * @param {string} id
 * @returns {Promise<FeedIngredient|undefined>}
 */
export async function feedGetById(id) {
  const db = await getDB();
  const f = await db.get('feeds', id);
  return f && !f.deletedAt ? f : undefined;
}

/**
 * Yem maddesi ekle (ID çakışıyorsa hata fırlatır).
 * @param {FeedIngredient} feed
 * @returns {Promise<string>} eklenen kaydın ID'si
 */
export async function feedAdd(feed) {
  if (!feed.id) throw new Error('feedAdd: feed.id zorunludur');
  const db = await getDB();
  // Kullanıcı yemleri senkron meta'sı alır (buluta gider); seed yemleri yerel kalır.
  const rec = isUserFeed(feed)
    ? withSyncMeta({ ...feed, _createdAt: now() }, { scoped: false })
    : { ...feed, _createdAt: now() };
  return db.add('feeds', rec);
}

/**
 * Yem maddesini güncelle (upsert = yoksa oluştur).
 * @param {FeedIngredient} feed
 * @returns {Promise<string>}
 */
export async function feedPut(feed) {
  if (!feed.id) throw new Error('feedPut: feed.id zorunludur');
  const db = await getDB();
  const rec = isUserFeed(feed)
    ? withSyncMeta({ ...feed, _updatedAt: now() }, { scoped: false })
    : { ...feed, _updatedAt: now() };
  return db.put('feeds', rec);
}

/**
 * Yem maddesini sil.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function feedDelete(id) {
  const db = await getDB();
  const f = await db.get('feeds', id);
  if (f && isUserFeed(f)) return softDelete('feeds', id);   // kullanıcı yemi → tombstone (senkronlanır)
  return db.delete('feeds', id);                             // seed yem → sert sil (yerel)
}

/**
 * feeds store'unu tamamen temizle.
 * @returns {Promise<void>}
 */
export async function feedClear() {
  const db = await getDB();
  return db.clear('feeds');
}

/**
 * Birden fazla yem maddesini tek transaction'da toplu ekle.
 * Hız için put (upsert) kullanır — varsa üzerine yazar.
 * @param {FeedIngredient[]} feeds
 * @returns {Promise<void>}
 */
export async function feedBulkPut(feeds) {
  const db = await getDB();
  const tx = db.transaction('feeds', 'readwrite');
  const ts = now();
  await Promise.all([
    ...feeds.map(f => tx.store.put({ ...f, _updatedAt: ts })),
    tx.done,
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMAL PROFILES CRUD
// ═══════════════════════════════════════════════════════════════════════════════

export async function animalProfileGetAll() {
  const db = await getDB();
  return visible(await db.getAll('animalProfiles'));
}

export async function animalProfileGetById(id) {
  const db = await getDB();
  const r = await db.get('animalProfiles', id);
  return notDeleted(r) ? r : undefined;
}

export async function animalProfileAdd(profile) {
  const db = await getDB();
  const rec = withSyncMeta({ ...profile, _createdAt: now() });
  await db.add('animalProfiles', rec);
  return rec.id;
}

export async function animalProfilePut(profile) {
  const db = await getDB();
  const rec = withSyncMeta({ ...profile, _updatedAt: now() });
  await db.put('animalProfiles', rec);
  return rec.id;
}

export async function animalProfileDelete(id) {
  return softDelete('animalProfiles', id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATIONS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

export async function rationGetAll() {
  const db = await getDB();
  return visible(await db.getAll('rations'));
}

export async function rationGetById(id) {
  const db = await getDB();
  const r = await db.get('rations', id);
  return notDeleted(r) ? r : undefined;
}

export async function rationAdd(ration) {
  const db = await getDB();
  const rec = withSyncMeta({ ...ration, createdAt: ration.createdAt || now() });
  await db.add('rations', rec);
  return rec.id;
}

export async function rationPut(ration) {
  const db = await getDB();
  const rec = withSyncMeta({ ...ration });
  await db.put('rations', rec);
  return rec.id;
}

export async function rationDelete(id) {
  return softDelete('rations', id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HERD GROUPS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

export async function herdGroupGetAll() {
  const db = await getDB();
  return visible(await db.getAll('herdGroups'));
}

export async function herdGroupGetById(id) {
  const db = await getDB();
  const r = await db.get('herdGroups', id);
  return notDeleted(r) ? r : undefined;
}

export async function herdGroupAdd(group) {
  const db = await getDB();
  const rec = withSyncMeta({ ...group, _createdAt: now() });
  await db.add('herdGroups', rec);
  return rec.id;
}

export async function herdGroupPut(group) {
  const db = await getDB();
  const rec = withSyncMeta({ ...group, _updatedAt: now() });
  await db.put('herdGroups', rec);
  return rec.id;
}

export async function herdGroupDelete(id) {
  return softDelete('herdGroups', id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FARMS CRUD (FAZ 16.10/16.11 — çoklu-çiftlik/danışman)
// Çiftlikler sahip-kapsamlıdır (farmId taşımaz); bulutta owner_id ile senkronlanır.
// ═══════════════════════════════════════════════════════════════════════════════

export async function farmGetAll() {
  const db = await getDB();
  return (await db.getAll('farms')).filter(notDeleted);
}

export async function farmGetById(id) {
  const db = await getDB();
  const r = await db.get('farms', id);
  return notDeleted(r) ? r : undefined;
}

export async function farmAdd(farm) {
  const db = await getDB();
  const rec = withSyncMeta({ ...farm, _createdAt: now() }, { scoped: false });
  await db.add('farms', rec);
  return rec;
}

export async function farmPut(farm) {
  const db = await getDB();
  const rec = withSyncMeta({ ...farm, _updatedAt: now() }, { scoped: false });
  await db.put('farms', rec);
  return rec;
}

export async function farmDelete(id) {
  return softDelete('farms', id);
}

/**
 * Çiftliği VE ona ait tüm kayıtları (profil/rasyon/grup/gözlem/fiyat) soft-delete
 * eder (tombstone → senkronla diğer cihazlara yayılır). Yem kütüphanesi etkilenmez.
 * @param {string} farmId
 * @returns {Promise<number>} silinen veri kaydı sayısı
 */
export async function farmDeleteCascade(farmId) {
  const db = await getDB();
  let count = 0;
  for (const name of SYNC_STORES) {
    const all = await db.getAll(name);
    for (const r of all) {
      if (r.farmId === farmId && !r.deletedAt) { await softDelete(name, r.id); count++; }
    }
  }
  await softDelete('farms', farmId);
  return count;
}

/**
 * En az bir çiftlik olmasını garanti eder; yoksa varsayılan oluşturur.
 * @param {string} [name]
 * @returns {Promise<object>} aktif/ilk çiftlik
 */
export async function ensureDefaultFarm(name = 'Varsayılan Çiftlik') {
  const farms = await farmGetAll();
  if (farms.length > 0) return farms[0];
  return farmAdd({ name: name || 'Varsayılan Çiftlik' });
}

/**
 * Aktif çiftlik kaydını döndürür (yoksa null). FAZ 16.11 — PDF/optimize aktif
 * çiftliğin profilini (ad/adres/danışman/bilim sistemi) okumak için kullanır.
 * @returns {Promise<object|null>}
 */
export async function getActiveFarm() {
  if (!_activeFarmId) return null;
  return farmGetById(_activeFarmId);
}

/**
 * farmId'si olmayan tüm kullanıcı kayıtlarını verilen çiftliğe atar (tek seferlik,
 * göç sonrası). Mevcut yerel veriyi varsayılan çiftliğe bağlar.
 * @param {string} farmId
 * @returns {Promise<number>} güncellenen kayıt sayısı
 */
export async function backfillFarmId(farmId) {
  if (!farmId) return 0;
  const db = await getDB();
  let updated = 0;
  for (const name of SYNC_STORES) {
    const tx = db.transaction(name, 'readwrite');
    const all = await tx.store.getAll();
    for (const r of all) {
      if (r.farmId === undefined || r.farmId === null) {
        r.farmId = farmId;
        r._dirty = true;
        await tx.store.put(r);
        updated++;
      }
    }
    await tx.done;
  }
  return updated;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAZ 11A — FEED PRICE HISTORY CRUD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tarih bazlı fiyat snapshot kaydet
 * @param {object} entry - { feedId, price, region?, date?, note? }
 */
export async function priceHistoryAdd(entry) {
  const db = await getDB();
  const rec = withSyncMeta({ ...entry, date: entry.date || now(), _createdAt: now() });
  await db.add('feedPriceHistory', rec);
  return rec.id;
}

/** Tüm fiyat geçmişi kayıtları */
export async function priceHistoryGetAll() {
  const db = await getDB();
  return visible(await db.getAll('feedPriceHistory'));
}

/** Belirli yemin tüm geçmişi (tarih sıralı) */
export async function priceHistoryGetByFeed(feedId) {
  const db = await getDB();
  const all = await db.getAllFromIndex('feedPriceHistory', 'by_feedId', feedId);
  return visible(all).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

/** Belirli bölgenin tüm fiyat kayıtları */
export async function priceHistoryGetByRegion(region) {
  const db = await getDB();
  return visible(await db.getAllFromIndex('feedPriceHistory', 'by_region', region));
}

export async function priceHistoryDelete(id) {
  return softDelete('feedPriceHistory', id);
}

/** Bir yemin tüm geçmişini sil (soft) */
export async function priceHistoryDeleteByFeed(feedId) {
  const db = await getDB();
  const all = await db.getAllFromIndex('feedPriceHistory', 'by_feedId', feedId);
  for (const r of all.filter(notDeleted)) await softDelete('feedPriceHistory', r.id);
}

/** Toplu snapshot — mevcut yem fiyatlarının tamamını kaydet */
export async function priceHistorySnapshot(feeds, region = '', note = '') {
  const db = await getDB();
  const date = now();
  const tx = db.transaction('feedPriceHistory', 'readwrite');
  await Promise.all(feeds.filter(f => f.pricePerTon > 0).map(f =>
    tx.store.add(withSyncMeta({
      feedId: f.id, feedName: f.name,
      price: f.pricePerTon, region, note, date, _createdAt: date,
    }))
  ));
  await tx.done;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAZ 11B — FIELD OBSERVATIONS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Saha gözlem kaydı ekle (haftalık süt verim, BCS, DMI vb.)
 * @param {object} obs - { profileId, date?, milkYield, milkFat?, milkProtein?, bcs?, dmiActual?, notes? }
 */
export async function observationAdd(obs) {
  const db = await getDB();
  const rec = withSyncMeta({ ...obs, date: obs.date || now(), _createdAt: now() });
  await db.add('fieldObservations', rec);
  return rec.id;
}

/** Belirli profilin tüm gözlemleri (tarih sıralı, yeniden eskiye) */
export async function observationGetByProfile(profileId) {
  const db = await getDB();
  const all = await db.getAllFromIndex('fieldObservations', 'by_profileId', profileId);
  return visible(all).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function observationGetAll() {
  const db = await getDB();
  return visible(await db.getAll('fieldObservations'));
}

export async function observationDelete(id) {
  return softDelete('fieldObservations', id);
}

export async function observationDeleteByProfile(profileId) {
  const db = await getDB();
  const all = await db.getAllFromIndex('fieldObservations', 'by_profileId', profileId);
  for (const r of all.filter(notDeleted)) await softDelete('fieldObservations', r.id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAZ 16.10 — SENKRONİZASYON YARDIMCILARI (sync engine tarafından kullanılır)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Bir store'daki "kirli" (yerelde değişmiş, buluta itilmeyi bekleyen) kayıtlar.
 * Tombstone'lar (silmeler) DAHİL — silmeler de senkronlanmalı.
 * @param {string} storeName
 * @returns {Promise<object[]>}
 */
export async function getDirtyRecords(storeName) {
  if (storeName === 'userSettings') {
    const s = getSettings();
    return s._dirty ? [{ id: 'singleton', ...s }] : [];
  }
  const db = await getDB();
  if (storeName === 'userFeeds') {
    // Sanal store: yalnızca kullanıcı yemleri (seed kütüphanesi senkronlanmaz)
    return (await db.getAll('feeds')).filter(f => f && f._dirty && isUserFeed(f));
  }
  return (await db.getAll(storeName)).filter(r => r && r._dirty);
}

/**
 * Belirtilen kayıtların _dirty bayrağını temizler (başarılı push sonrası).
 * Yarış güvenliği: yalnızca push edilen sürümle (updatedAt) hâlâ eşleşiyorsa
 * temizler — arada kayıt yeniden değiştiyse dirty kalır (sonraki push'ta gider).
 * @param {string} storeName
 * @param {Array<{id:string, updatedAt:string}>} pushed
 */
export async function markRecordsSynced(storeName, pushed) {
  if (storeName === 'userSettings') {
    clearSettingsDirty();
    return pushed.length;
  }
  const db = await getDB();
  const tx = db.transaction(physStore(storeName), 'readwrite');
  for (const { id, updatedAt } of pushed) {
    const r = await tx.store.get(id);
    if (r && r._dirty && (!updatedAt || r.updatedAt === updatedAt)) {
      r._dirty = false;
      await tx.store.put(r);
    }
  }
  await tx.done;
  return pushed.length;
}

/**
 * Uzaktan gelen bir kaydı LWW (last-write-wins) ile yerele uygular.
 * remote.updatedAt > local.updatedAt ise (veya yerel yoksa) üzerine yazar.
 * Tombstone (deletedAt dolu) da bir güncellemedir → yayılır.
 * @param {string} storeName
 * @param {object} remote — bulut kaydı (id + updatedAt + alanlar)
 * @returns {Promise<boolean>} uygulandı mı?
 */
export async function applyRemoteRecord(storeName, remote) {
  if (!remote || !remote.id) return false;
  if (storeName === 'userSettings') {
    return applyRemoteSettings(remote);
  }
  const db = await getDB();
  const phys = physStore(storeName);
  const local = await db.get(phys, remote.id);
  const remoteTs = remote.updatedAt || '';
  const localTs = local?.updatedAt || '';
  if (!local || remoteTs > localTs) {
    await db.put(phys, { ...remote, _dirty: false });
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERİTABANI SAĞLIK KONTROLÜ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Her store'daki (canlı) kayıt sayısını döndürür.
 * Kullanıcı store'larında tombstone'lar sayılmaz.
 * @returns {Promise<{feeds:number, rations:number, animalProfiles:number, herdGroups:number, ...}>}
 */
export async function dbStats() {
  const db = await getDB();
  const out = {};
  out.feeds = await db.count('feeds');   // feeds soft-delete dışı → ham sayım
  // Kullanıcı store'ları: canlı (tombstone hariç) sayım
  for (const s of ['rations', 'animalProfiles', 'herdGroups']) {
    out[s] = (await db.getAll(s)).filter(notDeleted).length;
  }
  // FAZ 11 yeni store'lar + farms opsiyonel (eski DB sürümünden gelirse yok olabilir)
  for (const s of ['feedPriceHistory', 'fieldObservations', 'farms']) {
    out[s] = db.objectStoreNames.contains(s)
      ? (await db.getAll(s)).filter(notDeleted).length
      : 0;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI SOHBET GEÇMİŞİ (AI CHATS) (FAZ v4)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getAiChats() {
  const db = await getDB();
  const index = db.transaction('aiChats').store.index('by_updatedAt');
  const all = await index.getAll();
  return visible(all).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function saveAiChat(chat) {
  const db = await getDB();
  const tx = db.transaction('aiChats', 'readwrite');
  const existing = await tx.store.get(chat.id);
  
  const rec = { ...(existing || {}), ...chat };
  const toSave = withSyncMeta(rec);
  
  await tx.store.put(toSave);
  await tx.done;
  return toSave;
}

export async function deleteAiChat(id) {
  return softDelete('aiChats', id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// YEDEK / GERİ YÜKLEME (FAZ 15.2 Aşama 2)
// ═══════════════════════════════════════════════════════════════════════════════

/** Yedeklemeye dahil edilen tüm object store'lar. */
export const ALL_STORES = [
  'feeds', 'animalProfiles', 'rations', 'herdGroups',
  'feedPriceHistory', 'fieldObservations', 'farms', 'aiChats',
];

/**
 * "Tüm verileri temizle" ile silinebilen store'lar — `feeds` HARİÇ.
 * Yem kütüphanesi seed verisidir (kullanıcı verisi değil) ve `seedFeedLibrary`
 * localStorage flag'ına bakıp atladığı için silinirse yeniden yüklenmez → korunur.
 */
export const CLEARABLE_STORES = ALL_STORES.filter(s => s !== 'feeds');

/**
 * Tüm IndexedDB store'larını JSON-serileştirilebilir nesneye aktarır.
 * (Ayarlar localStorage'da olduğundan UI katmanı `settings` alanını ekler.)
 * Tombstone'lar dahil edilir (silme durumu da yedeklenir).
 * @returns {Promise<{app:string, version:number, exportedAt:string, stores:object}>}
 */
export async function exportAllData() {
  const db = await getDB();
  const stores = {};
  for (const name of ALL_STORES) {
    stores[name] = db.objectStoreNames.contains(name) ? await db.getAll(name) : [];
  }
  return {
    app: 'rasyon-programi',
    version: DB_VERSION,
    exportedAt: now(),
    stores,
  };
}

/**
 * Yedek nesnesinden tüm store'ları geri yükler.
 * @param {object} data — exportAllData() çıktısı
 * @param {object} [opts]
 *   @param {boolean} [opts.clear=true] — yüklemeden önce mevcut kayıtları sil
 * @returns {Promise<object>} her store'a yüklenen kayıt sayısı
 */
export async function importAllData(data, { clear = true } = {}) {
  if (!data || typeof data !== 'object' || !data.stores || typeof data.stores !== 'object') {
    throw new Error('Geçersiz yedek dosyası: "stores" alanı bulunamadı.');
  }
  const db = await getDB();
  const counts = {};
  for (const name of ALL_STORES) {
    if (!db.objectStoreNames.contains(name)) continue;
    const records = Array.isArray(data.stores[name]) ? data.stores[name] : [];
    // Yem kütüphanesi (feeds) yalnızca yedekte DOLU ise geri yüklenir; boş/eksik
    // ise mevcut kütüphane korunur (seed flag'ı durduğundan aksi halde feeds yok olurdu).
    if (name === 'feeds' && records.length === 0) continue;
    const tx = db.transaction(name, 'readwrite');
    if (clear) await tx.store.clear();
    for (const rec of records) await tx.store.put(rec);
    await tx.done;
    counts[name] = records.length;
  }
  return counts;
}

/**
 * Tüm kullanıcı verisini siler (profiller, rasyonlar, gruplar, gözlemler, fiyat
 * geçmişi, çiftlikler). Yem kütüphanesi (feeds) seed kısmı KORUNUR — silinirse
 * `seedFeedLibrary` flag'ı yüzünden yeniden yüklenmez.
 * @param {object} [opts]
 *   @param {boolean} [opts.includeUserFeeds=false] — kullanıcı yemlerini de sil
 *     (hesap değişikliğinde cross-account sızıntıyı önlemek için; seed yemleri korunur).
 *     Varsayılan false → "Tüm Verileri Temizle" butonu kullanıcı yemlerini korur.
 * @returns {Promise<void>}
 */
export async function clearAllData({ includeUserFeeds = false } = {}) {
  const db = await getDB();
  for (const name of CLEARABLE_STORES) {
    if (!db.objectStoreNames.contains(name)) continue;
    const tx = db.transaction(name, 'readwrite');
    await tx.store.clear();
    await tx.done;
  }
  if (includeUserFeeds) {
    // Kullanıcı yemlerini sert sil (seed 500-yem kütüphanesi korunur)
    const tx = db.transaction('feeds', 'readwrite');
    const all = await tx.store.getAll();
    for (const f of all) { if (isUserFeed(f)) await tx.store.delete(f.id); }
    await tx.done;
  }
}
