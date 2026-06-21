/**
 * FAZ 15.2 Aşama 2 — Yedek / Geri Yükleme testleri (export/import round-trip)
 * fake-indexeddb ile Node ortamında çalışır.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import {
  _resetDB, ALL_STORES, CLEARABLE_STORES,
  exportAllData, importAllData, clearAllData,
  animalProfileAdd, animalProfileGetAll,
  herdGroupAdd, herdGroupGetAll,
  observationAdd, observationGetAll,
  feedAdd, feedGetAll,
} from '../src/data/db.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDB();
});

describe('FAZ 15.2 — ALL_STORES / CLEARABLE_STORES', () => {
  it('ALL_STORES 7 store içerir (FAZ 16.10: +farms)', () => {
    expect(ALL_STORES).toEqual([
      'feeds', 'animalProfiles', 'rations', 'herdGroups',
      'feedPriceHistory', 'fieldObservations', 'farms',
    ]);
  });

  it('CLEARABLE_STORES feeds HARİÇ (yem kütüphanesi korunur)', () => {
    expect(CLEARABLE_STORES).not.toContain('feeds');
    expect(CLEARABLE_STORES).toContain('animalProfiles');
    expect(CLEARABLE_STORES.length).toBe(ALL_STORES.length - 1);
  });
});

describe('FAZ 15.2 — exportAllData', () => {
  it('boş DB\'de geçerli yapı döner', async () => {
    const data = await exportAllData();
    expect(data.app).toBe('rasyon-programi');
    expect(data.exportedAt).toBeTruthy();
    expect(data.stores).toHaveProperty('animalProfiles');
    expect(data.stores.animalProfiles).toEqual([]);
  });

  it('eklenen kayıtları içerir', async () => {
    await animalProfileAdd({ name: 'İnek-1', bw: 600, milkYield: 30 });
    await observationAdd({ profileId: 1, date: '2026-06-01T00:00:00.000Z', milkYield: 28 });

    const data = await exportAllData();
    expect(data.stores.animalProfiles.length).toBe(1);
    expect(data.stores.animalProfiles[0].name).toBe('İnek-1');
    expect(data.stores.fieldObservations.length).toBe(1);
  });
});

describe('FAZ 15.2 — importAllData round-trip', () => {
  it('export → temizle → import ile veri geri gelir', async () => {
    await animalProfileAdd({ name: 'İnek-A', bw: 650, milkYield: 35 });
    await animalProfileAdd({ name: 'İnek-B', bw: 700, milkYield: 40 });
    await herdGroupAdd({ name: 'Yüksek Verim', animalCount: 25 });

    const backup = await exportAllData();

    // Her şeyi sil
    await clearAllData();
    expect((await animalProfileGetAll()).length).toBe(0);
    expect((await herdGroupGetAll()).length).toBe(0);

    // Geri yükle
    const counts = await importAllData(backup);
    expect(counts.animalProfiles).toBe(2);
    expect(counts.herdGroups).toBe(1);

    const profiles = await animalProfileGetAll();
    expect(profiles.length).toBe(2);
    expect(profiles.map(p => p.name).sort()).toEqual(['İnek-A', 'İnek-B']);
    const groups = await herdGroupGetAll();
    expect(groups[0].name).toBe('Yüksek Verim');
  });

  it('JSON serialize/parse sonrası da çalışır (gerçek dosya senaryosu)', async () => {
    await animalProfileAdd({ name: 'JSON-İnek', bw: 620, milkYield: 32 });
    const backup = await exportAllData();

    // Dosyaya yazılıp okunmuş gibi
    const roundTripped = JSON.parse(JSON.stringify(backup));

    await clearAllData();
    await importAllData(roundTripped);
    const profiles = await animalProfileGetAll();
    expect(profiles.length).toBe(1);
    expect(profiles[0].name).toBe('JSON-İnek');
  });

  it('clear:false ile mevcut kayıtların üzerine ekler', async () => {
    await animalProfileAdd({ name: 'Mevcut', bw: 600, milkYield: 30 });
    const backup = { stores: { animalProfiles: [{ name: 'Yeni', bw: 650, milkYield: 35 }] } };

    await importAllData(backup, { clear: false });
    const profiles = await animalProfileGetAll();
    expect(profiles.length).toBe(2);   // mevcut korundu + yeni eklendi
  });

  it('geçersiz yedek hata fırlatır', async () => {
    await expect(importAllData(null)).rejects.toThrow(/Geçersiz yedek/);
    await expect(importAllData({})).rejects.toThrow(/Geçersiz yedek/);
    await expect(importAllData({ foo: 1 })).rejects.toThrow(/stores/);
  });

  it('eksik store alanı boş dizi gibi işlenir (kısmi yedek)', async () => {
    await animalProfileAdd({ name: 'Silinecek', bw: 600, milkYield: 30 });
    // Sadece herdGroups içeren yedek; animalProfiles yok
    const partial = { stores: { herdGroups: [{ name: 'G1', animalCount: 5 }] } };
    await importAllData(partial);   // clear:true default
    expect((await animalProfileGetAll()).length).toBe(0);   // temizlendi, geri yüklenmedi
    expect((await herdGroupGetAll()).length).toBe(1);
  });
});

describe('FAZ 15.2 — clearAllData', () => {
  it('kullanıcı store\'larını temizler', async () => {
    await animalProfileAdd({ name: 'X', bw: 600, milkYield: 30 });
    await herdGroupAdd({ name: 'G', animalCount: 10 });
    await observationAdd({ profileId: 1, date: '2026-06-01T00:00:00.000Z', milkYield: 25 });

    await clearAllData();

    expect((await animalProfileGetAll()).length).toBe(0);
    expect((await herdGroupGetAll()).length).toBe(0);
    expect((await observationGetAll()).length).toBe(0);
  });

  it('yem kütüphanesini (feeds) KORUR — seed verisi kaybolmaz', async () => {
    await feedAdd({ id: 'test_corn', name: 'Test Mısır', category: 'grain', dm: 88 });
    await animalProfileAdd({ name: 'Silinecek', bw: 600, milkYield: 30 });

    await clearAllData();

    expect((await animalProfileGetAll()).length).toBe(0);   // kullanıcı verisi silindi
    expect((await feedGetAll()).length).toBe(1);            // yem kütüphanesi korundu
  });
});

describe('FAZ 15.2 — importAllData feeds koruması', () => {
  it('yedekte feeds boş/yoksa mevcut yem kütüphanesini korur', async () => {
    await feedAdd({ id: 'test_barley', name: 'Test Arpa', category: 'grain', dm: 89 });
    // feeds içermeyen (sadece profil) yedek
    const backup = { stores: { animalProfiles: [{ name: 'Yeni', bw: 640, milkYield: 33 }] } };

    await importAllData(backup);

    expect((await feedGetAll()).length).toBe(1);            // feeds dokunulmadı
    expect((await animalProfileGetAll()).length).toBe(1);   // profil yüklendi
  });

  it('yedekte feeds DOLU ise normal restore eder', async () => {
    await feedAdd({ id: 'eski_yem', name: 'Eski', category: 'grain', dm: 88 });
    const backup = { stores: { feeds: [
      { id: 'yedek_yem_1', name: 'Yedek 1', category: 'grain', dm: 87 },
      { id: 'yedek_yem_2', name: 'Yedek 2', category: 'protein', dm: 90 },
    ] } };

    await importAllData(backup);   // clear:true default → eski silinir, yedek yüklenir
    const feeds = await feedGetAll();
    expect(feeds.length).toBe(2);
    expect(feeds.map(f => f.id).sort()).toEqual(['yedek_yem_1', 'yedek_yem_2']);
  });
});

describe('FAZ 16.11 — clearAllData includeUserFeeds (hesap değişikliği güvenliği)', () => {
  it('varsayılan (false) kullanıcı yemlerini KORUR (ayarlar butonu sözleşmesi)', async () => {
    await feedAdd({ id: 'nrc_seed', name: 'Seed Yem', category: 'grain', dm: 88 });
    await feedAdd({ id: 'user_x', name: 'Özel Yem', category: 'grain', dm: 88, source: 'user' });
    await clearAllData();   // varsayılan: includeUserFeeds=false
    const feeds = await feedGetAll();
    expect(feeds.map(f => f.id).sort()).toEqual(['nrc_seed', 'user_x']);   // ikisi de korundu
  });

  it('includeUserFeeds:true kullanıcı yemlerini siler, seed\'i korur (cross-account sızıntı önlemi)', async () => {
    await feedAdd({ id: 'nrc_seed', name: 'Seed Yem', category: 'grain', dm: 88 });
    await feedAdd({ id: 'user_x', name: 'Özel Yem', category: 'grain', dm: 88, source: 'user' });
    await feedAdd({ id: 'custom_y', name: 'Custom Yem', category: 'grain', dm: 88 });
    await clearAllData({ includeUserFeeds: true });
    const feeds = await feedGetAll();
    expect(feeds.map(f => f.id)).toEqual(['nrc_seed']);   // yalnız seed kaldı; user_/custom_ silindi
  });
});
