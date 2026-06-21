/**
 * FAZ 11A — Türkiye bölge fiyat şablonları testleri
 */
import { describe, it, expect } from 'vitest';
import { TR_REGIONS, TR_REGION_IDS, adjustPriceForRegion, regionFlagshipFeeds } from '../src/data/regionTemplates.js';

describe('TR_REGIONS — 7 coğrafi bölge', () => {
  it('7 bölge tanımlı', () => {
    expect(TR_REGION_IDS).toHaveLength(7);
    expect(TR_REGION_IDS).toContain('marmara');
    expect(TR_REGION_IDS).toContain('ic_anadolu');
    expect(TR_REGION_IDS).toContain('akdeniz');
  });

  it('Her bölgede gerekli alanlar var', () => {
    for (const id of TR_REGION_IDS) {
      const r = TR_REGIONS[id];
      expect(r.name).toBeDefined();
      expect(r.priceMultiplier).toBeGreaterThan(0);
      expect(r.categoryAdj).toBeDefined();
      expect(r.flagship).toBeInstanceOf(Array);
    }
  });

  it('İç Anadolu tahıl ucuz (kategori çarpanı < 1)', () => {
    expect(TR_REGIONS.ic_anadolu.categoryAdj.grain).toBeLessThan(1);
  });

  it('Marmara kaba yem pahalı (çarpan > 1)', () => {
    expect(TR_REGIONS.marmara.categoryAdj.roughage).toBeGreaterThan(1);
  });

  it('Karadeniz ve İç Anadolu Se premiks önerir', () => {
    expect(TR_REGIONS.karadeniz.flagship).toContain('min_premix_se_enriched');
    expect(TR_REGIONS.ic_anadolu.flagship).toContain('min_premix_se_enriched');
  });
});

describe('adjustPriceForRegion', () => {
  it('Bölge yoksa orijinal fiyat dönülür', () => {
    expect(adjustPriceForRegion(10000, 'invalid', 'grain')).toBe(10000);
  });

  it('Bölge çarpanı + kategori çarpanı birlikte uygulanır', () => {
    // İç Anadolu mısır: 0.95 × 0.90 = 0.855 → 10000 → 8550
    const adjusted = adjustPriceForRegion(10000, 'ic_anadolu', 'grain');
    expect(adjusted).toBe(8550);
  });

  it('Doğu Anadolu protein pahalı (1.20 × 0.90 = 1.08)', () => {
    const adjusted = adjustPriceForRegion(20000, 'dogu_anadolu', 'protein');
    expect(adjusted).toBeGreaterThan(20000);  // Net pahalı
  });

  it('basePrice 0 ise 0 dön', () => {
    expect(adjustPriceForRegion(0, 'marmara', 'grain')).toBe(0);
  });
});

describe('regionFlagshipFeeds', () => {
  it('Ege için mısır silajı/tane önerilir', () => {
    const f = regionFlagshipFeeds('ege');
    expect(f.length).toBeGreaterThan(0);
    expect(f.some(id => id.includes('corn'))).toBe(true);
  });

  it('Bilinmeyen bölge için boş dizi', () => {
    expect(regionFlagshipFeeds('xxx')).toEqual([]);
  });
});
