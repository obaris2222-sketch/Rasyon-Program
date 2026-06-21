/**
 * FAZ 16.10 — DB v2 → v3 UUID göçü testleri.
 *
 * Eski sayısal autoIncrement id'lerin UUID'ye dönüşümü + yabancı anahtar
 * (groupId/rationId/profileId) yeniden yazımının doğruluğu.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';

import {
  _resetDB, DB_NAME,
  animalProfileGetAll, rationGetAll, herdGroupGetAll,
  observationGetAll, priceHistoryGetAll,
} from '../src/data/db.js';
import { looksLikeUuid } from '../src/data/uuid.js';

/** Eski (v2) şemayı autoIncrement ile oluşturup numeric-id'li veri ekler. */
async function buildV2WithData() {
  const db = await openDB(DB_NAME, 2, {
    upgrade(d) {
      const feeds = d.createObjectStore('feeds', { keyPath: 'id' });
      feeds.createIndex('by_category', 'category');
      const ap = d.createObjectStore('animalProfiles', { keyPath: 'id', autoIncrement: true });
      ap.createIndex('by_name', 'name');
      const r = d.createObjectStore('rations', { keyPath: 'id', autoIncrement: true });
      r.createIndex('by_name', 'name');
      const hg = d.createObjectStore('herdGroups', { keyPath: 'id', autoIncrement: true });
      hg.createIndex('by_name', 'name');
      const ph = d.createObjectStore('feedPriceHistory', { keyPath: 'id', autoIncrement: true });
      ph.createIndex('by_feedId', 'feedId');
      const obs = d.createObjectStore('fieldObservations', { keyPath: 'id', autoIncrement: true });
      obs.createIndex('by_profileId', 'profileId');
    },
  });

  // Numeric id'ler autoIncrement ile atanır (id alanı = 1, 2, ...)
  const rId = await db.add('rations', { name: 'R1', totalCostTl: 50 });          // → 1
  const gId = await db.add('herdGroups', { name: 'G1', rationId: rId });          // → 1, rationId=1
  const pId = await db.add('animalProfiles', { name: 'P1', bw: 600, groupId: gId }); // → 1, groupId=1
  await db.add('fieldObservations', { profileId: pId, milkYield: 30 });           // profileId=1
  await db.add('feedPriceHistory', { feedId: 'nrc_corn', price: 100 });           // string FK
  db.close();
  return { rId, gId, pId };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDB();
});

describe('FAZ 16.10 — UUID göçü (v2 → v3)', () => {
  it('tüm kullanıcı kayıtlarının id\'si UUID\'ye dönüşür', async () => {
    await buildV2WithData();
    _resetDB();   // singleton sıfırla → getDB v3 olarak yeniden açar (upgrade tetiklenir)

    const profiles = await animalProfileGetAll();
    const rations = await rationGetAll();
    const groups = await herdGroupGetAll();
    const obs = await observationGetAll();
    const prices = await priceHistoryGetAll();

    expect(profiles.length).toBe(1);
    expect(rations.length).toBe(1);
    expect(groups.length).toBe(1);
    expect(obs.length).toBe(1);
    expect(prices.length).toBe(1);

    expect(looksLikeUuid(profiles[0].id)).toBe(true);
    expect(looksLikeUuid(rations[0].id)).toBe(true);
    expect(looksLikeUuid(groups[0].id)).toBe(true);
    expect(looksLikeUuid(obs[0].id)).toBe(true);
    expect(looksLikeUuid(prices[0].id)).toBe(true);
  });

  it('yabancı anahtarlar yeni UUID\'lere yeniden yazılır', async () => {
    await buildV2WithData();
    _resetDB();

    const r = (await rationGetAll())[0];
    const g = (await herdGroupGetAll())[0];
    const p = (await animalProfileGetAll())[0];
    const o = (await observationGetAll())[0];

    expect(g.rationId).toBe(r.id);     // herdGroup.rationId → ration.id (yeni UUID)
    expect(p.groupId).toBe(g.id);      // profile.groupId   → herdGroup.id (yeni UUID)
    expect(o.profileId).toBe(p.id);    // observation.profileId → profile.id (yeni UUID)
  });

  it('string yabancı anahtar (feedId → feeds) değişmeden korunur', async () => {
    await buildV2WithData();
    _resetDB();

    const price = (await priceHistoryGetAll())[0];
    expect(price.feedId).toBe('nrc_corn');   // feeds zaten string id → dokunulmaz
  });

  it('göç edilen kayıtlar _dirty işaretlenir (ilk girişte buluta itilir)', async () => {
    await buildV2WithData();
    _resetDB();

    const p = (await animalProfileGetAll())[0];
    expect(p._dirty).toBe(true);
    expect(p.deletedAt).toBe(null);
    expect(p.updatedAt).toBeTruthy();
  });

  it('orijinal alan değerleri korunur (veri kaybı yok)', async () => {
    await buildV2WithData();
    _resetDB();

    const p = (await animalProfileGetAll())[0];
    const r = (await rationGetAll())[0];
    expect(p.name).toBe('P1');
    expect(p.bw).toBe(600);
    expect(r.name).toBe('R1');
    expect(r.totalCostTl).toBe(50);
  });
});
