/**
 * Feed Service — Yem Veritabanı İş Katmanı
 *
 * Sorumluluklar:
 *  - feedLibrary.json'dan IndexedDB'ye ilk yükleme (seed)
 *  - CRUD sarmalayıcılar (db.js üstünde)
 *  - Arama, filtreleme, sıralama
 *  - JSON import / export (round-trip)
 *
 * Tüm fonksiyonlar async / Promise döndürür.
 */

import {
  feedGetAll, feedGetByCategory, feedGetById,
  feedAdd, feedPut, feedDelete, feedClear, feedBulkPut,
  dbStats,
} from './db.js';

// ─── Yem kategorileri ────────────────────────────────────────────────────────

export const FEED_CATEGORIES = [
  'roughage',  // Kaba yemler
  'grain',     // Tahıllar / enerji yemleri
  'protein',   // Protein kaynakları
  'byproduct', // Yan ürünler
  'fat',       // Yağ kaynakları
  'mineral',   // Mineral ve katkı maddeleri
];

export const CATEGORY_LABELS_TR = {
  roughage:  'Kaba Yemler',
  grain:     'Tahıllar / Enerji Yemleri',
  protein:   'Protein Kaynakları',
  byproduct: 'Yan Ürünler',
  fat:       'Yağ Kaynakları',
  mineral:   'Mineral & Katkı Maddeleri',
};

// ─── Seed (ilk yükleme) ───────────────────────────────────────────────────────

/** Hangi sürümün yüklü olduğunu localStorage'dan oku (browser) veya Map'ten (test). */
const _memoryFlags = new Map();

function _getFlag(key) {
  try { return localStorage.getItem(key); } catch { return _memoryFlags.get(key) ?? null; }
}
function _setFlag(key, val) {
  try { localStorage.setItem(key, val); } catch { _memoryFlags.set(key, val); }
}
function _clearFlag(key) {
  try { localStorage.removeItem(key); } catch { _memoryFlags.delete(key); }
}

const SEED_VERSION_KEY = 'feedLibrary_seedVersion';

/**
 * feedLibrary.json'u DB'ye yükle — zaten yüklüyse atla.
 * @param {object} libraryJSON  — import edilen JSON objesi (version + feeds[])
 * @param {boolean} [force=false] — sürüm farkı olmasa da yeniden yükle
 * @returns {Promise<{seeded: boolean, count: number, version: string}>}
 */
export async function seedFeedLibrary(libraryJSON, force = false) {
  const { version, feeds } = libraryJSON;

  const seededVersion = _getFlag(SEED_VERSION_KEY);
  if (!force && seededVersion === version) {
    const stats = await dbStats();
    return { seeded: false, count: stats.feeds, version };
  }

  await feedBulkPut(feeds);
  _setFlag(SEED_VERSION_KEY, version);
  return { seeded: true, count: feeds.length, version };
}

/**
 * Feed kütüphanesini sıfırla ve yeniden yükle (güncelleme/test için).
 * @param {object} libraryJSON
 * @returns {Promise<{seeded: boolean, count: number, version: string}>}
 */
export async function reseedFeedLibrary(libraryJSON) {
  await feedClear();
  _clearFlag(SEED_VERSION_KEY);
  return seedFeedLibrary(libraryJSON, true);
}

// ─── Okuma operasyonları ──────────────────────────────────────────────────────

/**
 * Tüm yemleri getir.
 * @returns {Promise<FeedIngredient[]>}
 */
export async function getAllFeeds() {
  return feedGetAll();
}

/**
 * Kategoriye göre filtrele.
 * @param {string} category
 * @returns {Promise<FeedIngredient[]>}
 */
export async function getFeedsByCategory(category) {
  return feedGetByCategory(category);
}

/**
 * ID ile tek yem getir.
 * @param {string} id
 * @returns {Promise<FeedIngredient|undefined>}
 */
export async function getFeedById(id) {
  return feedGetById(id);
}

// ─── Fuzzy / Türkçe-toleranslı metin eşleştirme (FAZ 15.10) ────────────────────

// Türkçe karakter → ASCII karşılığı (hem büyük hem küçük). 'İ'/'I' tuzağından
// kaçınmak için tek tek eşleme yapılır (str.toLowerCase('tr') güvenilmez).
const TR_NORM = {
  'ç': 'c', 'Ç': 'c', 'ş': 's', 'Ş': 's', 'ı': 'i', 'I': 'i', 'İ': 'i',
  'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o',
  'â': 'a', 'Â': 'a', 'î': 'i', 'Î': 'i', 'û': 'u', 'Û': 'u',
};

/**
 * Türkçe-duyarsız normalize: küçük harf + diakritik/Türkçe karakter sadeleştirme.
 * "Mısır Silajı" → "misir silaji", "YONCA" → "yonca". Aksanlı/eksik yazımı eşitler.
 * @param {string} str
 * @returns {string}
 */
export function normalizeTr(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    out += TR_NORM[ch] ?? ch.toLowerCase();
  }
  return out.trim();
}

/**
 * İki string arası Levenshtein düzenleme mesafesi (iki-satır DP, O(n) bellek).
 * @param {string} a @param {string} b @returns {number}
 */
export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * Typo-toleranslı metin eşleşmesi (FAZ 15.10 fuzzy search).
 * Önce substring (hızlı, mevcut davranış), eşleşmezse kelime-bazlı edit-distance.
 * Tolerans sorgu uzunluğuna bağlı (kısa sorguda katı, uzunda esnek).
 * @param {string} query — kullanıcı araması
 * @param {string} text  — aranan metin (yem adı vb.)
 * @param {object} [opts] @param {number} [opts.maxDistance] — override tolerans
 * @returns {boolean}
 */
export function fuzzyTextMatch(query, text, { maxDistance } = {}) {
  const q = normalizeTr(query);
  if (!q) return true;
  const t = normalizeTr(text);
  if (!t) return false;
  if (t.includes(q)) return true;   // normalize-substring (Türkçe + harf duyarsız) — hızlı yol
  // Typo toleransı KATI tutulur (yanlış-pozitif önleme): ≤3 harf → yalnız substring,
  // 4-9 harf → 1 düzenleme, 10+ → 2. Daha gevşek değerler ("misir"≈"aspir" gibi)
  // alakasız yem kalabalığı yaratıyordu.
  const tol = maxDistance ?? (q.length <= 3 ? 0 : q.length <= 9 ? 1 : 2);
  if (tol === 0) return false;
  const words = t.split(/[\s,./()\-]+/).filter(Boolean);
  for (const w of words) {
    // Uzunluk farkı tol'u aşıyorsa düzenleme mesafesi de aşar → hızlı eleme
    if (Math.abs(w.length - q.length) <= tol && editDistance(q, w) <= tol) return true;
  }
  return false;
}

/**
 * Bir yemin sorguyla eşleşip eşleşmediği.
 * Ad / İngilizce ad → typo toleranslı (fuzzy); id / yorum → yalnız normalize-substring
 * (yorum uzun cümle olduğundan fuzzy yapılırsa yaygın kelimeler kalabalık yaratır).
 * @param {object} feed @param {string} query @returns {boolean}
 */
export function feedMatchesQuery(feed, query) {
  if (!query || !query.trim()) return true;
  const nq = normalizeTr(query);
  return (
    fuzzyTextMatch(query, feed.name) ||
    fuzzyTextMatch(query, feed.nameEn) ||
    (!!feed.id && normalizeTr(feed.id).includes(nq)) ||
    (!!feed.comment && normalizeTr(feed.comment).includes(nq))
  );
}

// ─── Arama ───────────────────────────────────────────────────────────────────

/**
 * Yem adı veya ingilizce adı içinde metin arama (Türkçe-duyarsız + typo toleranslı).
 * @param {string} query — arama terimi (boş string → tümünü döndür)
 * @param {object} [opts]
 * @param {string} [opts.category] — ek kategori filtresi
 * @returns {Promise<FeedIngredient[]>}
 */
export async function searchFeeds(query, opts = {}) {
  const feeds = opts.category
    ? await feedGetByCategory(opts.category)
    : await feedGetAll();

  if (!query || query.trim() === '') return feeds;
  return feeds.filter(f => feedMatchesQuery(f, query));
}

/**
 * Besin değerine göre filtrele.
 * @param {object} criteria — { nutrient: string, min?: number, max?: number }[]
 *   Desteklenen nutrient isimleri: 'nel', 'cp', 'ndf', 'adf', 'nfc', 'starch',
 *   'fat', 'ca', 'p', 'mg', 'k', 'rdu', 'rup', vb.
 * @param {object} [opts] — { category?: string }
 * @returns {Promise<FeedIngredient[]>}
 */
export async function filterFeedsByNutrient(criteria, opts = {}) {
  const feeds = opts.category
    ? await feedGetByCategory(opts.category)
    : await feedGetAll();

  return feeds.filter(feed => {
    return criteria.every(({ nutrient, min, max }) => {
      const val = feed[nutrient];
      if (val === undefined || val === null) return false;
      if (min !== undefined && val < min) return false;
      if (max !== undefined && val > max) return false;
      return true;
    });
  });
}

/**
 * Birden fazla kriter birleştirerek arama + filtre.
 * @param {object} opts
 * @param {string}   [opts.query]         — metin arama
 * @param {string}   [opts.category]      — kategori
 * @param {object[]} [opts.nutrients]     — besin kriterleri
 * @param {string}   [opts.sortBy='name'] — sıralama alanı
 * @param {'asc'|'desc'} [opts.sortDir='asc']
 * @returns {Promise<FeedIngredient[]>}
 */
export async function queryFeeds({
  query    = '',
  category = '',
  nutrients = [],
  sortBy   = 'name',
  sortDir  = 'asc',
} = {}) {
  let feeds = category ? await feedGetByCategory(category) : await feedGetAll();

  // Metin filtresi (FAZ 15.10: Türkçe-duyarsız + typo toleranslı fuzzy)
  if (query.trim()) {
    feeds = feeds.filter(f => feedMatchesQuery(f, query));
  }

  // Besin filtresi
  if (nutrients.length) {
    feeds = feeds.filter(feed =>
      nutrients.every(({ nutrient, min, max }) => {
        const val = feed[nutrient];
        if (val === undefined || val === null) return false;
        if (min !== undefined && val < min) return false;
        if (max !== undefined && val > max) return false;
        return true;
      })
    );
  }

  // Sıralama
  const dir = sortDir === 'desc' ? -1 : 1;
  feeds.sort((a, b) => {
    const av = a[sortBy] ?? '';
    const bv = b[sortBy] ?? '';
    if (typeof av === 'string') return dir * av.localeCompare(bv, 'tr');
    return dir * (av - bv);
  });

  return feeds;
}

// ─── Yazma operasyonları ──────────────────────────────────────────────────────

/**
 * Yeni özel yem ekle. id otomatik üretilir (prefix + timestamp).
 * @param {object} feedData — id hariç yem alanları
 * @returns {Promise<FeedIngredient>} kaydedilen yem
 */
export async function addCustomFeed(feedData) {
  const id = feedData.id || `custom_${Date.now()}`;
  const feed = { ...feedData, id, source: feedData.source || 'custom' };
  await feedAdd(feed);
  return feed;
}

/**
 * Var olan bir yemi güncelle.
 * @param {string} id
 * @param {Partial<FeedIngredient>} changes
 * @returns {Promise<FeedIngredient>} güncellenmiş yem
 */
export async function updateFeed(id, changes) {
  const existing = await feedGetById(id);
  if (!existing) throw new Error(`Feed bulunamadı: ${id}`);
  const updated = { ...existing, ...changes, id };
  await feedPut(updated);
  return updated;
}

/**
 * Yem maddesini sil.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteFeed(id) {
  return feedDelete(id);
}

// ─── Import / Export ──────────────────────────────────────────────────────────

/**
 * Dışarıdan JSON formatında yem listesi import et.
 * Mevcut kayıtları korur; ID çakışması varsa günceller (upsert).
 * @param {object|object[]} jsonData — { version?, feeds[] } veya yalnızca feed[]
 * @returns {Promise<{imported: number, skipped: number, errors: string[]}>}
 */
export async function importFeedsFromJSON(jsonData) {
  const feeds = Array.isArray(jsonData)
    ? jsonData
    : (jsonData.feeds || jsonData);

  if (!Array.isArray(feeds)) {
    throw new TypeError('importFeedsFromJSON: geçersiz format — feeds dizisi bekleniyor');
  }

  let imported = 0, skipped = 0;
  const errors = [];

  for (const feed of feeds) {
    if (!feed.id) { skipped++; errors.push(`ID eksik: ${feed.name || '?'}`); continue; }
    try {
      await feedPut(feed);
      imported++;
    } catch (e) {
      skipped++;
      errors.push(`${feed.id}: ${e.message}`);
    }
  }

  return { imported, skipped, errors };
}

/**
 * Tüm yemleri JSON formatında dışa aktar.
 * @returns {Promise<{version: string, exportedAt: string, count: number, feeds: FeedIngredient[]}>}
 */
export async function exportFeedsToJSON() {
  const feeds = await feedGetAll();
  // _createdAt / _updatedAt meta alanlarını temizle
  const clean = feeds.map(({ _createdAt, _updatedAt, ...rest }) => rest);
  return {
    version:    '1.0',
    exportedAt: new Date().toISOString(),
    count:      clean.length,
    feeds:      clean,
  };
}

// ─── İstatistik ───────────────────────────────────────────────────────────────

/**
 * Kategori bazında yem sayısı.
 * @returns {Promise<Record<string, number>>}
 */
export async function feedCountByCategory() {
  const feeds = await feedGetAll();
  const counts = {};
  for (const cat of FEED_CATEGORIES) counts[cat] = 0;
  for (const f of feeds) {
    if (counts[f.category] !== undefined) counts[f.category]++;
    else counts[f.category] = 1;
  }
  return counts;
}

/**
 * Tüm yem isimleri + ID listesi (otocomplete için hafif liste).
 * @returns {Promise<{id: string, name: string, category: string}[]>}
 */
export async function getFeedNames() {
  const feeds = await feedGetAll();
  return feeds.map(f => ({ id: f.id, name: f.name, nameEn: f.nameEn, category: f.category }));
}
