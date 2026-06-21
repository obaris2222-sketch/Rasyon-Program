/**
 * feedService.js + db.js entegrasyon testleri
 * fake-indexeddb ile Node ortamında çalışır.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// Her test öncesi temiz DB garantisi — db.js singleton'ını resetle
import { _resetDB } from '../src/data/db.js';
import {
  seedFeedLibrary, reseedFeedLibrary, getAllFeeds,
  getFeedsByCategory, getFeedById,
  searchFeeds, filterFeedsByNutrient, queryFeeds,
  addCustomFeed, updateFeed, deleteFeed,
  importFeedsFromJSON, exportFeedsToJSON,
  feedCountByCategory, getFeedNames,
} from '../src/data/feedService.js';

// ── Küçük test veri seti (gerçek feedLibrary'den türetilmiş) ─────────────────
const TEST_LIBRARY = {
  version: 'test-1.0',
  feeds: [
    {
      id: 'test_corn_silage',
      name: 'Mısır Silajı (Test)',
      nameEn: 'Corn Silage Test',
      category: 'roughage',
      dm: 33, nel: 1.72, tdn: 71, cp: 8.2,
      rup: 15, rdp: 85, rupIntD: 62,
      ndf: 44, adf: 27, aNDF: 42, nfc: 36,
      starch: 27, sugar: 1.2, fat: 3.3, ash: 4.3,
      ca: 0.24, p: 0.22, mg: 0.15, k: 1.05,
      na: 0.01, s: 0.11, cl: 0.09,
      pricePerTon: 0,
    },
    {
      id: 'test_soybean_meal',
      name: 'Soya Küspesi (Test)',
      nameEn: 'Soybean Meal Test',
      category: 'protein',
      dm: 89, nel: 1.99, tdn: 82, cp: 48,
      rup: 35, rdp: 65, rupIntD: 85,
      ndf: 10, adf: 5, aNDF: 8, nfc: 28,
      starch: 2, sugar: 8, fat: 1.5, ash: 7,
      ca: 0.33, p: 0.70, mg: 0.30, k: 2.20,
      na: 0.02, s: 0.45, cl: 0.04,
      pricePerTon: 0,
    },
    {
      id: 'test_corn_grain',
      name: 'Mısır Tane (Test)',
      nameEn: 'Corn Grain Test',
      category: 'grain',
      dm: 88, nel: 1.72, tdn: 74, cp: 9.0,
      rup: 40, rdp: 60, rupIntD: 70,
      ndf: 10, adf: 3, aNDF: 8, nfc: 74,
      starch: 68, sugar: 2, fat: 4, ash: 1.4,
      ca: 0.02, p: 0.28, mg: 0.10, k: 0.38,
      na: 0.01, s: 0.10, cl: 0.05,
      pricePerTon: 0,
    },
    {
      id: 'test_limestone',
      name: 'Kireçtaşı (Test)',
      nameEn: 'Limestone Test',
      category: 'mineral',
      dm: 99, nel: 0, tdn: 0, cp: 0,
      ndf: 0, adf: 0, aNDF: 0, nfc: 0,
      fat: 0, ash: 100,
      ca: 38, p: 0, mg: 0.35, k: 0,
      na: 0, s: 0, cl: 0,
      pricePerTon: 0,
    },
  ],
};

// ── Kurulum ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Her test öncesi temiz IndexedDB + temiz DB singleton
  globalThis.indexedDB = new IDBFactory();
  _resetDB();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEED
// ═══════════════════════════════════════════════════════════════════════════════

describe('seedFeedLibrary', () => {
  it('ilk çağrıda tüm yemleri yükler', async () => {
    const result = await seedFeedLibrary(TEST_LIBRARY);
    expect(result.seeded).toBe(true);
    expect(result.count).toBe(4);
    expect(result.version).toBe('test-1.0');
  });

  it('aynı sürümle tekrar çağrılırsa seed atlanır', async () => {
    await seedFeedLibrary(TEST_LIBRARY);
    const result2 = await seedFeedLibrary(TEST_LIBRARY);
    expect(result2.seeded).toBe(false);
  });

  it('force=true ile sürüm aynı olsa bile yeniden yükler', async () => {
    await seedFeedLibrary(TEST_LIBRARY);
    const result2 = await seedFeedLibrary(TEST_LIBRARY, true);
    expect(result2.seeded).toBe(true);
    expect(result2.count).toBe(4);
  });

  it('reseedFeedLibrary DB\'yi temizleyip yeniden yükler', async () => {
    await seedFeedLibrary(TEST_LIBRARY);
    const result = await reseedFeedLibrary(TEST_LIBRARY);
    expect(result.seeded).toBe(true);
    const all = await getAllFeeds();
    expect(all.length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEMEL OKUMA
// ═══════════════════════════════════════════════════════════════════════════════

describe('getAllFeeds / getFeedsByCategory / getFeedById', () => {
  beforeEach(async () => {
    await seedFeedLibrary(TEST_LIBRARY, true);
  });

  it('getAllFeeds tüm yemleri döndürür', async () => {
    const feeds = await getAllFeeds();
    expect(feeds.length).toBe(4);
  });

  it('getFeedsByCategory roughage → sadece kaba yemler', async () => {
    const roughages = await getFeedsByCategory('roughage');
    expect(roughages.length).toBe(1);
    expect(roughages[0].id).toBe('test_corn_silage');
  });

  it('getFeedsByCategory protein → protein kaynakları', async () => {
    const proteins = await getFeedsByCategory('protein');
    expect(proteins.length).toBe(1);
    expect(proteins[0].id).toBe('test_soybean_meal');
  });

  it('getFeedById var olan yemi getirir', async () => {
    const feed = await getFeedById('test_corn_grain');
    expect(feed).toBeDefined();
    expect(feed.category).toBe('grain');
    expect(feed.starch).toBe(68);
  });

  it('getFeedById olmayan ID → undefined', async () => {
    const feed = await getFeedById('yok_olan_id');
    expect(feed).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ARAMA
// ═══════════════════════════════════════════════════════════════════════════════

describe('searchFeeds', () => {
  beforeEach(async () => {
    await seedFeedLibrary(TEST_LIBRARY, true);
  });

  it('boş sorgu → tüm yemleri döndürür', async () => {
    const result = await searchFeeds('');
    expect(result.length).toBe(4);
  });

  it('"Mısır" ile arama → mısır silajı + mısır tane', async () => {
    const result = await searchFeeds('Mısır');
    expect(result.length).toBe(2);
  });

  it('"Soy" ile İngilizce isimde arama çalışır', async () => {
    const result = await searchFeeds('Soy');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test_soybean_meal');
  });

  it('büyük/küçük harf duyarsız', async () => {
    const upper = await searchFeeds('SOYA');
    const lower = await searchFeeds('soya');
    expect(upper.length).toBe(lower.length);
    expect(upper.length).toBeGreaterThan(0);
  });

  it('kategori filtresiyle birlikte çalışır', async () => {
    const result = await searchFeeds('Test', { category: 'mineral' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test_limestone');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BESİN FİLTRESİ
// ═══════════════════════════════════════════════════════════════════════════════

describe('filterFeedsByNutrient', () => {
  beforeEach(async () => {
    await seedFeedLibrary(TEST_LIBRARY, true);
  });

  it('yüksek CP filtresi: CP > 20 → sadece soya', async () => {
    const result = await filterFeedsByNutrient([{ nutrient: 'cp', min: 20 }]);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test_soybean_meal');
  });

  it('yüksek nişasta: starch > 50 → mısır tane', async () => {
    const result = await filterFeedsByNutrient([{ nutrient: 'starch', min: 50 }]);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test_corn_grain');
  });

  it('NDF aralığı: 30-50 → mısır silajı', async () => {
    const result = await filterFeedsByNutrient([
      { nutrient: 'ndf', min: 30, max: 50 },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test_corn_silage');
  });

  it('birden fazla kriter AND ile çalışır', async () => {
    // NEL > 1.5 VE starch > 50 → sadece mısır tane
    const result = await filterFeedsByNutrient([
      { nutrient: 'nel', min: 1.5 },
      { nutrient: 'starch', min: 50 },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test_corn_grain');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUERY (birleşik arama+filtre+sıralama)
// ═══════════════════════════════════════════════════════════════════════════════

describe('queryFeeds', () => {
  beforeEach(async () => {
    await seedFeedLibrary(TEST_LIBRARY, true);
  });

  it('parametresiz çağrı tüm yemleri döndürür', async () => {
    const result = await queryFeeds();
    expect(result.length).toBe(4);
  });

  it('kategori + sortBy ile sıralı liste', async () => {
    const result = await queryFeeds({ sortBy: 'nel', sortDir: 'desc' });
    // nel sıralaması desc: soybean (1.99), corn_grain (1.72), corn_silage (1.72), limestone (0)
    expect(result[0].nel).toBeGreaterThanOrEqual(result[1].nel);
    expect(result[1].nel).toBeGreaterThanOrEqual(result[2].nel);
  });

  it('query + nutrients birleşik filtre', async () => {
    const result = await queryFeeds({
      query: 'Mısır',
      nutrients: [{ nutrient: 'starch', min: 50 }],
    });
    // Mısır silajı starch=27 → elenir; mısır tane starch=68 → kalır
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test_corn_grain');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// YAZMA OPERASYONLARI
// ═══════════════════════════════════════════════════════════════════════════════

describe('addCustomFeed / updateFeed / deleteFeed', () => {
  beforeEach(async () => {
    await seedFeedLibrary(TEST_LIBRARY, true);
  });

  it('addCustomFeed yeni kayıt ekler', async () => {
    const feed = await addCustomFeed({
      name: 'Özel Yem',
      category: 'grain',
      dm: 90, nel: 1.80, cp: 12,
    });
    expect(feed.id).toMatch(/^custom_/);
    const fetched = await getFeedById(feed.id);
    expect(fetched).toBeDefined();
    expect(fetched.source).toBe('custom');
  });

  it('addCustomFeed belirtilen ID korunur', async () => {
    const feed = await addCustomFeed({ id: 'my_feed', name: 'Benim Yemim', category: 'roughage' });
    expect(feed.id).toBe('my_feed');
  });

  it('updateFeed alanları günceller', async () => {
    await updateFeed('test_corn_silage', { nel: 1.80, comment: 'Güncellendi' });
    const updated = await getFeedById('test_corn_silage');
    expect(updated.nel).toBe(1.80);
    expect(updated.comment).toBe('Güncellendi');
    // Diğer alanlar korunmalı
    expect(updated.cp).toBe(8.2);
  });

  it('updateFeed olmayan ID → hata fırlatır', async () => {
    await expect(updateFeed('yok_olan', { nel: 1.5 })).rejects.toThrow('Feed bulunamadı');
  });

  it('deleteFeed kaydı siler', async () => {
    await deleteFeed('test_corn_silage');
    const deleted = await getFeedById('test_corn_silage');
    expect(deleted).toBeUndefined();
    const all = await getAllFeeds();
    expect(all.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT / EXPORT (ROUND-TRIP)
// ═══════════════════════════════════════════════════════════════════════════════

describe('importFeedsFromJSON / exportFeedsToJSON', () => {
  beforeEach(async () => {
    await seedFeedLibrary(TEST_LIBRARY, true);
  });

  it('export sonucu geçerli yapıya sahip', async () => {
    const exported = await exportFeedsToJSON();
    expect(exported.version).toBe('1.0');
    expect(exported.count).toBe(4);
    expect(Array.isArray(exported.feeds)).toBe(true);
    expect(exported.exportedAt).toBeTruthy();
  });

  it('export → import round-trip veri kaybı olmaz', async () => {
    const exported = await exportFeedsToJSON();
    // DB'yi sıfırla
    globalThis.indexedDB = new IDBFactory();
    _resetDB();
    // Yalnızca export'u import et
    const { imported } = await importFeedsFromJSON(exported.feeds);
    expect(imported).toBe(4);
    const all = await getAllFeeds();
    expect(all.length).toBe(4);
  });

  it('export edilen yemler _createdAt/_updatedAt içermez', async () => {
    const exported = await exportFeedsToJSON();
    for (const f of exported.feeds) {
      expect(f._createdAt).toBeUndefined();
      expect(f._updatedAt).toBeUndefined();
    }
  });

  it('importFeedsFromJSON ID eksik kayıtları atlar', async () => {
    const badFeeds = [
      { name: 'ID yok', category: 'grain', nel: 1.5 },    // ID eksik
      { id: 'imported_ok', name: 'Geçerli', category: 'grain', nel: 1.5 },
    ];
    const result = await importFeedsFromJSON(badFeeds);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors.length).toBe(1);
  });

  it('importFeedsFromJSON obje formatını (feeds array) kabul eder', async () => {
    const obj = { version: '2.0', feeds: [{ id: 'imp_1', name: 'Test', category: 'fat', nel: 5 }] };
    const result = await importFeedsFromJSON(obj);
    expect(result.imported).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// İSTATİSTİK
// ═══════════════════════════════════════════════════════════════════════════════

describe('feedCountByCategory / getFeedNames', () => {
  beforeEach(async () => {
    await seedFeedLibrary(TEST_LIBRARY, true);
  });

  it('feedCountByCategory doğru sayıları döndürür', async () => {
    const counts = await feedCountByCategory();
    expect(counts.roughage).toBe(1);
    expect(counts.protein).toBe(1);
    expect(counts.grain).toBe(1);
    expect(counts.mineral).toBe(1);
    expect(counts.fat).toBe(0);
  });

  it('getFeedNames hafif liste döndürür (id + name + category)', async () => {
    const names = await getFeedNames();
    expect(names.length).toBe(4);
    expect(names[0]).toHaveProperty('id');
    expect(names[0]).toHaveProperty('name');
    expect(names[0]).toHaveProperty('category');
    // Büyük alanlar (ndf, adf vb.) olmamalı
    expect(names[0].ndf).toBeUndefined();
  });
});
