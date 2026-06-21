/**
 * FAZ 5E — Yem kütüphanesi genişletme testleri
 * Hem ana hem ek kütüphane şema bütünlüğü
 */

import { describe, it, expect } from 'vitest';
import feedLibraryJSON from '../src/data/feedLibrary.json';
import feedLibraryExtJSON from '../src/data/feedLibraryExt.json';
import feedLibraryExt2JSON from '../src/data/feedLibraryExt2.json';

const VALID_CATEGORIES = ['roughage', 'grain', 'protein', 'byproduct', 'fat', 'mineral'];

describe('Ana yem kütüphanesi (feedLibrary.json)', () => {
  it('en az 80 yem içerir', () => {
    expect(feedLibraryJSON.feeds.length).toBeGreaterThanOrEqual(80);
  });

  it('versiyon ve source alanları tanımlı', () => {
    expect(feedLibraryJSON.version).toBeDefined();
    expect(feedLibraryJSON.source).toBeDefined();
  });
});

describe('Ek yem kütüphanesi (feedLibraryExt.json — FAZ 5E)', () => {
  it('en az 50 yeni yem içerir', () => {
    expect(feedLibraryExtJSON.feeds.length).toBeGreaterThanOrEqual(50);
  });

  it('tüm kategorileri kapsar', () => {
    const cats = new Set(feedLibraryExtJSON.feeds.map(f => f.category));
    for (const c of VALID_CATEGORIES) {
      expect(cats.has(c)).toBe(true);
    }
  });
});

describe('Birleştirilmiş kütüphane şema bütünlüğü', () => {
  const all = [
    ...feedLibraryJSON.feeds,
    ...feedLibraryExtJSON.feeds,
    ...feedLibraryExt2JSON.feeds,
  ];

  it('toplam ≥200 yem (3 birleşik kütüphane)', () => {
    expect(all.length).toBeGreaterThanOrEqual(200);
  });

  it('ID çakışması yok', () => {
    const ids = all.map(f => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('her yemde zorunlu alanlar var (id, name, category, dm)', () => {
    for (const f of all) {
      expect(f.id).toBeDefined();
      expect(typeof f.id).toBe('string');
      expect(f.name).toBeDefined();
      expect(typeof f.name).toBe('string');
      expect(VALID_CATEGORIES).toContain(f.category);
      expect(f.dm).toBeGreaterThanOrEqual(5);  // sıvı whey ~6%, yaş yan ürünler ~10-15% KM
      expect(f.dm).toBeLessThanOrEqual(100);
    }
  });

  it('her yemde NEL, CP, NDF tanımlı (mineral hariç)', () => {
    for (const f of all) {
      if (f.category === 'mineral' || f.category === 'fat') continue;
      expect(typeof f.nel).toBe('number');
      expect(typeof f.cp).toBe('number');
      expect(typeof f.ndf).toBe('number');
    }
  });

  it('her yemde temel mineraller tanımlı (Ca, P, K, Na)', () => {
    for (const f of all) {
      expect(typeof f.ca).toBe('number');
      expect(typeof f.p).toBe('number');
      expect(typeof f.k).toBe('number');
      expect(typeof f.na).toBe('number');
    }
  });

  it('Lys ve Met % değerleri makul aralıkta (0-15, mineral hariç)', () => {
    for (const f of all) {
      if (f.lys === undefined || f.lys === null) continue;
      // Mineral premiksler (Zn-Met vb.) saf AA içerebilir — atlatın
      if (f.category === 'mineral') continue;
      expect(f.lys).toBeGreaterThanOrEqual(0);
      expect(f.lys).toBeLessThan(15);
      expect(f.met).toBeGreaterThanOrEqual(0);
      expect(f.met).toBeLessThan(10);
    }
  });

  it('Kategori dağılımı dengeli (her kategori ≥5)', () => {
    const counts = {};
    for (const f of all) counts[f.category] = (counts[f.category] || 0) + 1;
    for (const c of VALID_CATEGORIES) {
      expect(counts[c]).toBeGreaterThanOrEqual(5);
    }
  });
});
