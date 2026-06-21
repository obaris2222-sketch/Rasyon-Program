/**
 * FAZ 16.7 — Yem İçe Aktarma (CSV/Excel) testleri
 *
 * Saf çekirdek (parse/map/validate/template) DOM/IDB gerektirmez.
 * Son blok feedService.importFeedsFromJSON ile fake-indexeddb round-trip (toplu ekleme).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import {
  parseCSV, parseNumber, normalizeHeader, matchColumn, normalizeCategory,
  mapRowToFeed, validateImportedFeed, processImportRows, coerceUserId,
  buildTemplateCSV, TEMPLATE_COLUMNS, IMPORT_COLUMNS,
} from '../src/data/feedImporter.js';

import { _resetDB } from '../src/data/db.js';
import { importFeedsFromJSON, getAllFeeds } from '../src/data/feedService.js';

// ─── parseCSV ────────────────────────────────────────────────────────────────

describe('FAZ 16.7 — parseCSV', () => {
  it('başlık + satırları ayrıştırır, boş hücreleri keser', () => {
    const csv = 'name,category,dm\nMısır,grain,88\nYonca,roughage,90\n';
    const { headers, rows, delimiter } = parseCSV(csv);
    expect(delimiter).toBe(',');
    expect(headers).toEqual(['name', 'category', 'dm']);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ name: 'Mısır', category: 'grain', dm: '88' });
    expect(rows[1].name).toBe('Yonca');
  });

  it("noktalı virgül ayracı + ondalık virgülü tespit eder", () => {
    const csv = 'name;dm;nel\nArpa;87;2,05\n';
    const { delimiter, rows } = parseCSV(csv);
    expect(delimiter).toBe(';');
    expect(rows[0].nel).toBe('2,05');   // ham string; parseNumber 2.05'e çevirir
    expect(parseNumber(rows[0].nel)).toBeCloseTo(2.05, 2);
  });

  it('tırnaklı alanlar (gömülü virgül, kaçışlı tırnak) doğru ayrışır', () => {
    const csv = 'name,comment\n"Soya, tam yağlı","12"" boy, ""özel"""\n';
    const { rows } = parseCSV(csv);
    expect(rows[0].name).toBe('Soya, tam yağlı');
    expect(rows[0].comment).toBe('12" boy, "özel"');
  });

  it('BOM siler, tamamen boş satırları atar', () => {
    const csv = '﻿name,dm\n\nMısır,88\n\n';
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(['name', 'dm']);
    expect(rows.length).toBe(1);
  });

  it('boş metin → boş sonuç', () => {
    expect(parseCSV('').rows).toEqual([]);
    expect(parseCSV('   ').headers).toEqual([]);
  });
});

// ─── parseNumber ─────────────────────────────────────────────────────────────

describe('FAZ 16.7 — parseNumber', () => {
  it('ondalık virgül (Türkçe) → nokta', () => {
    expect(parseNumber('1,25')).toBeCloseTo(1.25);
    expect(parseNumber('0,06')).toBeCloseTo(0.06);
  });
  it('hem nokta hem virgül → son ayraç ondalık', () => {
    expect(parseNumber('1.250,5')).toBeCloseTo(1250.5);   // Avrupa
    expect(parseNumber('1,250.5')).toBeCloseTo(1250.5);   // ABD
  });
  it('yüzde işareti ve boşluk temizlenir', () => {
    expect(parseNumber('18 %')).toBe(18);
    expect(parseNumber(' 42 ')).toBe(42);
  });
  it('sayı zaten sayıysa aynen döner; boş → NaN', () => {
    expect(parseNumber(3.14)).toBe(3.14);
    expect(Number.isNaN(parseNumber(''))).toBe(true);
    expect(Number.isNaN(parseNumber('abc'))).toBe(true);
  });
});

// ─── Başlık eşleme ───────────────────────────────────────────────────────────

describe('FAZ 16.7 — başlık eşleme', () => {
  it('normalizeHeader birim parantezini ve Türkçe karakteri sadeleştirir', () => {
    expect(normalizeHeader('NEL (Mcal/kg KM)')).toBe('nel');
    expect(normalizeHeader('Süt Yağı %')).toBe('sut yagi');
    expect(normalizeHeader('Ham Protein')).toBe('ham protein');
  });

  it('kanonik ad + TR/EN takma adlar eşleşir', () => {
    expect(matchColumn('NEL (Mcal/kg)').field).toBe('nel');
    expect(matchColumn('Ham Protein').field).toBe('cp');
    expect(matchColumn('CP').field).toBe('cp');
    expect(matchColumn('Kuru Madde').field).toBe('dm');
    expect(matchColumn('KM').field).toBe('dm');
    expect(matchColumn('Kalsiyum').field).toBe('ca');
    expect(matchColumn('Fiyat (₺/ton)').field).toBe('pricePerTon');
  });

  it('tek harf mineral başlıkları doğru eşlenir (P/K/S/I çakışmaz)', () => {
    expect(matchColumn('P').field).toBe('p');
    expect(matchColumn('K').field).toBe('k');
    expect(matchColumn('S').field).toBe('s');
    expect(matchColumn('I').field).toBe('i');
    expect(matchColumn('Na').field).toBe('na');
  });

  it('bilinmeyen başlık → null', () => {
    expect(matchColumn('rastgele sütun')).toBeNull();
    expect(matchColumn('')).toBeNull();
  });
});

// ─── Kategori normalleştirme ─────────────────────────────────────────────────

describe('FAZ 16.7 — normalizeCategory', () => {
  it('Türkçe/İngilizce kategori adlarını kanoniğe çevirir', () => {
    expect(normalizeCategory('Kaba Yem')).toBe('roughage');
    expect(normalizeCategory('tahıl')).toBe('grain');
    expect(normalizeCategory('Protein')).toBe('protein');
    expect(normalizeCategory('Yan Ürün')).toBe('byproduct');
    expect(normalizeCategory('Yağ')).toBe('fat');
    expect(normalizeCategory('mineral')).toBe('mineral');
    expect(normalizeCategory('premiks')).toBe('mineral');
  });
  it('kanonik değer aynen geçer, bilinmeyen → null', () => {
    expect(normalizeCategory('roughage')).toBe('roughage');
    expect(normalizeCategory('bilinmeyen')).toBeNull();
    expect(normalizeCategory('')).toBeNull();
  });
});

// ─── mapRowToFeed ────────────────────────────────────────────────────────────

describe('FAZ 16.7 — mapRowToFeed', () => {
  it('başlıkları alana eşler, sayıları ayrıştırır, kategoriyi normalleştirir', () => {
    const row = { 'Yem Adı': 'Mısır Silajı', 'Kategori': 'Kaba Yem', 'KM (%)': '32', 'NEL (Mcal/kg)': '1,45', 'Ham Protein': '8.5' };
    const { feed } = mapRowToFeed(row);
    expect(feed.name).toBe('Mısır Silajı');
    expect(feed.category).toBe('roughage');
    expect(feed.dm).toBe(32);
    expect(feed.nel).toBeCloseTo(1.45);
    expect(feed.cp).toBeCloseTo(8.5);
  });

  it('eşleşmeyen başlıkları unmapped olarak izler, boşları atar', () => {
    const row = { name: 'X', dm: '88', 'Garip Sütun': 'değer', 'Boş': '' };
    const { feed, unmapped } = mapRowToFeed(row);
    expect(feed.name).toBe('X');
    expect(unmapped).toContain('Garip Sütun');
    expect(unmapped).not.toContain('Boş');   // boş değer unmapped sayılmaz
  });

  it('ayrıştırılamayan sayı ham string olarak kalır (validasyon yakalar)', () => {
    const { feed } = mapRowToFeed({ name: 'X', category: 'grain', dm: 'çok', nel: '2' });
    expect(feed.dm).toBe('çok');
  });
});

// ─── validateImportedFeed ────────────────────────────────────────────────────

describe('FAZ 16.7 — validateImportedFeed', () => {
  it('geçerli yem → ok', () => {
    const { ok, errors } = validateImportedFeed({ name: 'Mısır', category: 'grain', dm: 88, nel: 2, cp: 9 });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });

  it('zorunlu alan eksik → hata', () => {
    const r = validateImportedFeed({ category: 'grain', dm: 88 });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /Yem Adı/.test(e))).toBe(true);
  });

  it('aralık dışı değer → hata (dm 150)', () => {
    const r = validateImportedFeed({ name: 'X', category: 'grain', dm: 150 });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /KM.*çok yüksek/.test(e))).toBe(true);
  });

  it('geçersiz kategori → hata', () => {
    const r = validateImportedFeed({ name: 'X', category: 'uydurma', dm: 88 });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /Kategori/.test(e))).toBe(true);
  });

  it('sayısal alanda string → tip hatası', () => {
    const r = validateImportedFeed({ name: 'X', category: 'grain', dm: 'çok' });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /sayısal/.test(e))).toBe(true);
  });

  it('eksik NEL/CP (kaba/tahıl) → uyarı (hata değil)', () => {
    const r = validateImportedFeed({ name: 'X', category: 'roughage', dm: 90 });
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => /NEL/.test(w))).toBe(true);
    expect(r.warnings.some(w => /HP\/CP/.test(w))).toBe(true);
  });

  it('mineral yeminde eksik NEL/CP uyarı vermez', () => {
    const r = validateImportedFeed({ name: 'Kireçtaşı', category: 'mineral', dm: 99, ca: 38 });
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => /NEL/.test(w))).toBe(false);
  });

  it('ADF > NDF yapısal uyarı verir', () => {
    const r = validateImportedFeed({ name: 'X', category: 'roughage', dm: 90, nel: 1, cp: 10, ndf: 40, adf: 50 });
    expect(r.warnings.some(w => /ADF.*NDF/.test(w))).toBe(true);
  });
});

// ─── coerceUserId ────────────────────────────────────────────────────────────

describe('FAZ 16.7 — coerceUserId', () => {
  it('ID yoksa zaman+indeks bazlı user_ ID üretir', () => {
    expect(coerceUserId('', 111, 0)).toBe('user_imp_111_0');
    expect(coerceUserId(null, 111, 3)).toBe('user_imp_111_3');
  });
  it('sağlanan ID\'ye user_ öneki zorlar (paketli yem korunur)', () => {
    expect(coerceUserId('nrc_corn', 111, 0)).toBe('user_nrc_corn');
    expect(coerceUserId('my feed!', 111, 0)).toBe('user_my_feed');
  });
  it('zaten user_ önekliyse aynen korur', () => {
    expect(coerceUserId('user_custom1', 111, 0)).toBe('user_custom1');
  });
});

// ─── processImportRows ───────────────────────────────────────────────────────

describe('FAZ 16.7 — processImportRows', () => {
  it('geçerli + geçersiz karışımı doğru özetler', () => {
    const rows = [
      { name: 'Mısır', category: 'grain', dm: '88', nel: '2', cp: '9' },     // geçerli
      { name: '', category: 'grain', dm: '88' },                              // ad yok → geçersiz
      { name: 'Bozuk', category: 'uydurma', dm: '88' },                       // kategori → geçersiz
    ];
    const res = processImportRows(rows);
    expect(res.summary.total).toBe(3);
    expect(res.summary.valid).toBe(1);
    expect(res.summary.invalid).toBe(2);
    expect(res.feeds.length).toBe(1);
  });

  it('geçerli yemlere user_ ID + source=user verir', () => {
    const res = processImportRows([{ name: 'Test', category: 'grain', dm: '88', nel: '2', cp: '9' }]);
    expect(res.feeds[0].id.startsWith('user_')).toBe(true);
    expect(res.feeds[0].source).toBe('user');
  });

  it('batch içi yinelenen ID\'leri benzersizleştirir', () => {
    const rows = [
      { id: 'corn', name: 'Mısır 1', category: 'grain', dm: '88', nel: '2', cp: '9' },
      { id: 'corn', name: 'Mısır 2', category: 'grain', dm: '88', nel: '2', cp: '9' },
    ];
    const res = processImportRows(rows);
    const ids = res.feeds.map(f => f.id);
    expect(new Set(ids).size).toBe(2);   // benzersiz
    expect(ids[0]).toBe('user_corn');
  });

  it('satır numarası başlık ofsetiyle raporlanır (2-tabanlı)', () => {
    const res = processImportRows([{ name: 'X', category: 'grain', dm: '88', nel: '2', cp: '9' }]);
    expect(res.rowResults[0].row).toBe(2);
  });

  it('Excel ham SAYI değerlerini işler (sheet_to_json raw:true sözleşmesi)', () => {
    // XLSX.utils.sheet_to_json(raw:true) string değil sayı verir — readExcelRows bunu
    // doğrudan processImportRows'a geçirir. Türkçe başlık + sayı değer birlikte çalışmalı.
    const excelRows = [
      { 'Yem Adı': 'Excel Soya', 'Kategori': 'Protein', 'KM (%)': 90, 'NEL (Mcal/kg)': 2.1, 'Ham Protein': 46, 'Zn (mg/kg)': 55 },
    ];
    const res = processImportRows(excelRows);
    expect(res.summary.valid).toBe(1);
    expect(res.feeds[0].dm).toBe(90);
    expect(res.feeds[0].nel).toBeCloseTo(2.1);
    expect(res.feeds[0].cp).toBe(46);
    expect(res.feeds[0].zn).toBe(55);
    expect(res.feeds[0].category).toBe('protein');
  });
});

// ─── Şablon ──────────────────────────────────────────────────────────────────

describe('FAZ 16.7 — buildTemplateCSV', () => {
  it('şablon parseCSV → processImportRows ile tamamen geçerli', () => {
    const csv = buildTemplateCSV();
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(TEMPLATE_COLUMNS);
    expect(rows.length).toBe(2);
    const res = processImportRows(rows);
    expect(res.summary.valid).toBe(2);
    expect(res.summary.invalid).toBe(0);
  });

  it('şablon sütunlarının tümü tanınan başlık (matchColumn)', () => {
    for (const col of TEMPLATE_COLUMNS) {
      expect(matchColumn(col), `${col} eşleşmeli`).not.toBeNull();
    }
  });

  it('IMPORT_COLUMNS zorunlu alanlar name/category/dm içerir', () => {
    const required = IMPORT_COLUMNS.filter(c => c.required).map(c => c.field);
    expect(required).toEqual(['name', 'category', 'dm']);
  });
});

// ─── Entegrasyon: toplu ekleme (fake-indexeddb) ──────────────────────────────

describe('FAZ 16.7 — IndexedDB toplu ekleme round-trip', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetDB();
  });

  it('processImportRows çıktısı importFeedsFromJSON ile DB\'ye yazılır', async () => {
    const csv = buildTemplateCSV();
    const { rows } = parseCSV(csv);
    const { feeds } = processImportRows(rows);

    const result = await importFeedsFromJSON(feeds);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);

    const all = await getAllFeeds();
    expect(all.length).toBe(2);
    expect(all.every(f => f.id.startsWith('user_'))).toBe(true);
    expect(all.every(f => f.source === 'user')).toBe(true);
    const corn = all.find(f => f.name === 'Örnek Mısır Tane');
    expect(corn.category).toBe('grain');
    expect(corn.dm).toBe(88);
  });
});
