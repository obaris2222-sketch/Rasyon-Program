/**
 * FAZ 15.10 — Fuzzy / Türkçe-toleranslı yem arama testleri
 * Saf fonksiyonlar (DOM/IndexedDB bağımsız): normalizeTr, editDistance,
 * fuzzyTextMatch, feedMatchesQuery.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTr, editDistance, fuzzyTextMatch, feedMatchesQuery,
} from '../src/data/feedService.js';

describe('normalizeTr — Türkçe-duyarsız normalize', () => {
  it('Türkçe karakterleri ASCII karşılığına indirger', () => {
    expect(normalizeTr('Mısır Silajı')).toBe('misir silaji');
    expect(normalizeTr('Şeker Pancarı Küspesi')).toBe('seker pancari kuspesi');
    expect(normalizeTr('Çayır Otu')).toBe('cayir otu');
    expect(normalizeTr('Göğüs')).toBe('gogus');
  });

  it('büyük/küçük harf farkını siler (İ/I tuzağı dahil)', () => {
    expect(normalizeTr('YONCA')).toBe('yonca');
    expect(normalizeTr('İYİ')).toBe('iyi');
    expect(normalizeTr('IIII')).toBe('iiii');
  });

  it('null/undefined/sayı için güvenli (boş ya da string döner)', () => {
    expect(normalizeTr(null)).toBe('');
    expect(normalizeTr(undefined)).toBe('');
    expect(normalizeTr('  arpa  ')).toBe('arpa');   // trim
  });
});

describe('editDistance — Levenshtein', () => {
  it('aynı string için 0', () => {
    expect(editDistance('misir', 'misir')).toBe(0);
  });
  it('boş string kenar durumları', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });
  it('tek harf değişimi / ekleme / silme = 1', () => {
    expect(editDistance('misir', 'misr')).toBe(1);    // silme
    expect(editDistance('misr', 'misir')).toBe(1);    // ekleme
    expect(editDistance('yonca', 'yanca')).toBe(1);   // değişim
  });
  it('çoklu düzenleme', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('fuzzyTextMatch — typo toleranslı eşleşme', () => {
  it('boş sorgu her zaman eşleşir', () => {
    expect(fuzzyTextMatch('', 'Mısır Silajı')).toBe(true);
    expect(fuzzyTextMatch('   ', 'Arpa')).toBe(true);
  });

  it('substring (Türkçe-duyarsız) eşleşir', () => {
    expect(fuzzyTextMatch('misir', 'Mısır Silajı')).toBe(true);   // ı→i
    expect(fuzzyTextMatch('SILAJ', 'Mısır Silajı')).toBe(true);   // büyük harf
    expect(fuzzyTextMatch('pancar', 'Şeker Pancarı Küspesi')).toBe(true);
  });

  it('tek harf typo toleransı (kısa kelime)', () => {
    expect(fuzzyTextMatch('yanca', 'Yonca')).toBe(true);    // o→a, distance 1
    expect(fuzzyTextMatch('arba', 'Arpa')).toBe(true);      // p→b, distance 1
  });

  it('prefix typo (eksik/yanlış harf kelime başında)', () => {
    expect(fuzzyTextMatch('misr', 'Mısır Silajı')).toBe(true);   // mısır'a 1 mesafe
  });

  it('çok farklı sorgu eşleşmez', () => {
    expect(fuzzyTextMatch('xyzqw', 'Mısır Silajı')).toBe(false);
    expect(fuzzyTextMatch('soya', 'Mısır Silajı')).toBe(false);
  });

  it('boş metin eşleşmez (boş olmayan sorguda)', () => {
    expect(fuzzyTextMatch('misir', '')).toBe(false);
    expect(fuzzyTextMatch('misir', null)).toBe(false);
  });

  it('maxDistance override katı eşleşmeyi zorlar', () => {
    // "yanca" → "yonca" mesafe 1; tolerans 0 verilince eşleşmez
    expect(fuzzyTextMatch('yanca', 'Yonca', { maxDistance: 0 })).toBe(false);
  });
});

describe('fuzzyTextMatch — yanlış-pozitif önleme (hassasiyet regresyonu)', () => {
  it('kısa sorgu (≤3 harf) yalnız substring — fuzzy yapılmaz', () => {
    expect(fuzzyTextMatch('abc', 'abd')).toBe(false);    // tol 0, mesafe 1
    expect(fuzzyTextMatch('mis', 'Mısır')).toBe(true);   // substring yine çalışır
  });

  it('5 harfli sorguda yalnız 1 düzenleme (yaygın kelimeler eşleşmez)', () => {
    expect(fuzzyTextMatch('yonca', 'önce')).toBe(false);   // mesafe 2
    expect(fuzzyTextMatch('yonca', 'sonra')).toBe(false);  // mesafe 2
    expect(fuzzyTextMatch('yanca', 'Yonca')).toBe(true);   // mesafe 1
  });

  it('gevşek prefix eşleşmesi yapmaz ("yonca" ≠ "Pancarı")', () => {
    expect(fuzzyTextMatch('yonca', 'Şeker Pancarı Posası')).toBe(false);
  });
});

describe('feedMatchesQuery — yorum substring-only (fuzzy değil)', () => {
  const feed = { name: 'X', nameEn: 'Y', comment: 'Geçiş döneminde önce ve sonra verilir' };

  it('yorumdaki yaygın kelimeler fuzzy eşleşmez (gürültü önleme)', () => {
    expect(feedMatchesQuery(feed, 'yonca')).toBe(false);   // "önce"/"sonra" artık eşleşmez
  });

  it('yorumda gerçek substring eşleşir (Türkçe-duyarsız)', () => {
    expect(feedMatchesQuery(feed, 'geçiş')).toBe(true);    // normalize: gecis
    expect(feedMatchesQuery(feed, 'donem')).toBe(true);
  });
});

describe('feedMatchesQuery — yem nesnesi üzerinde arama', () => {
  const feed = {
    id: 'tr_corn_silage',
    name: 'Mısır Silajı',
    nameEn: 'Corn Silage',
    comment: 'Enerji açısından zengin kaba yem',
  };

  it('boş sorgu tüm yemleri kabul eder', () => {
    expect(feedMatchesQuery(feed, '')).toBe(true);
    expect(feedMatchesQuery(feed, '  ')).toBe(true);
  });

  it('Türkçe ad üzerinde eşleşir (duyarsız)', () => {
    expect(feedMatchesQuery(feed, 'misir')).toBe(true);
    expect(feedMatchesQuery(feed, 'SILAJ')).toBe(true);
  });

  it('İngilizce ad üzerinde eşleşir', () => {
    expect(feedMatchesQuery(feed, 'corn')).toBe(true);
    expect(feedMatchesQuery(feed, 'silage')).toBe(true);
  });

  it('id alt-dizgisi üzerinde eşleşir', () => {
    expect(feedMatchesQuery(feed, 'corn_sil')).toBe(true);
  });

  it('typo toleranslı ad eşleşmesi', () => {
    expect(feedMatchesQuery(feed, 'misr')).toBe(true);     // mısır prefix-typo
    expect(feedMatchesQuery(feed, 'corm')).toBe(true);     // corn → 1 mesafe
  });

  it('alakasız sorgu eşleşmez', () => {
    expect(feedMatchesQuery(feed, 'pamuk')).toBe(false);
    expect(feedMatchesQuery(feed, 'zzzzz')).toBe(false);
  });

  it('eksik alanlarda çökmez', () => {
    expect(feedMatchesQuery({ name: 'Arpa' }, 'arpa')).toBe(true);
    expect(feedMatchesQuery({ id: 'x' }, 'arpa')).toBe(false);
  });
});
