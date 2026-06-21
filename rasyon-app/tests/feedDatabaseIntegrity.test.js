/**
 * Yem Veritabanı Bütünlük Testi — FAZ 16.5
 *
 * Tüm yem kütüphanesi dosyalarını (ana + ext1-7) kapsamlı doğrular:
 *   - ID benzersizliği (TÜM dosyalar arası — eski test Ext3'ü atlıyordu)
 *   - Zorunlu alanlar + tipler
 *   - Sayısal aralıklar (cp/ndf/adf/fat/dm/lys/met/rdp/rup)
 *   - Yapısal tutarlılık (adf≤ndf, lignin≤adf, rdp+rup≈100)
 *   - Kütle dengesi (cp+fat+ash+ndf+nfc, non-mineral/fat)
 *   - Kategori kapsamı
 *
 * Bu test 291 yeni yemin (FAZ 16.5) veri-giriş hatalarını otomatik yakalar.
 * Yeni dosya eklendikçe import + FILES dizisine eklenir.
 */

import { describe, it, expect } from 'vitest';
import lib0 from '../src/data/feedLibrary.json';
import lib1 from '../src/data/feedLibraryExt.json';
import lib2 from '../src/data/feedLibraryExt2.json';
import lib3 from '../src/data/feedLibraryExt3.json';
import lib4 from '../src/data/feedLibraryExt4.json';
import lib5 from '../src/data/feedLibraryExt5.json';
import lib6 from '../src/data/feedLibraryExt6.json';
import lib7 from '../src/data/feedLibraryExt7.json';
import lib8 from '../src/data/feedLibraryExt8.json';

const FILES = [
  { name: 'feedLibrary.json', json: lib0 },
  { name: 'feedLibraryExt.json', json: lib1 },
  { name: 'feedLibraryExt2.json', json: lib2 },
  { name: 'feedLibraryExt3.json', json: lib3 },
  { name: 'feedLibraryExt4.json', json: lib4 },
  { name: 'feedLibraryExt5.json', json: lib5 },
  { name: 'feedLibraryExt6.json', json: lib6 },
  { name: 'feedLibraryExt7.json', json: lib7 },
  { name: 'feedLibraryExt8.json', json: lib8 },
];

const VALID_CATEGORIES = ['roughage', 'grain', 'protein', 'byproduct', 'fat', 'mineral'];
const VALID_STARCH_PROC = ['', 'whole', 'cracked', 'dryGround', 'dryGroundFine', 'highMoisture', 'steamFlaked'];

// Tüm yemler (kaynak dosya etiketiyle)
const ALL = [];
for (const f of FILES) {
  for (const fd of (f.json.feeds || [])) ALL.push({ ...fd, _file: f.name });
}

describe('Yem DB bütünlük — ID benzersizliği (TÜM dosyalar)', () => {
  it('hiçbir ID çakışmıyor (9 dosya arası)', () => {
    const seen = new Map();
    const dups = [];
    for (const f of ALL) {
      if (seen.has(f.id)) dups.push(`${f.id} (${seen.get(f.id)} & ${f._file})`);
      else seen.set(f.id, f._file);
    }
    expect(dups).toEqual([]);
  });

  it('her dosyada version + source tanımlı', () => {
    for (const f of FILES) {
      expect(f.json.version, `${f.name} version`).toBeDefined();
      expect(f.json.source, `${f.name} source`).toBeDefined();
      expect(Array.isArray(f.json.feeds), `${f.name} feeds dizisi`).toBe(true);
    }
  });
});

describe('Yem DB bütünlük — zorunlu alanlar & tipler', () => {
  it('her yemde id/name/category/dm geçerli', () => {
    for (const f of ALL) {
      expect(typeof f.id, `${f.id} id`).toBe('string');
      expect(f.id.length, `${f.id} id boş değil`).toBeGreaterThan(0);
      expect(typeof f.name, `${f.id} name`).toBe('string');
      expect(VALID_CATEGORIES, `${f.id} category`).toContain(f.category);
      expect(f.dm, `${f.id} dm`).toBeGreaterThanOrEqual(5);
      expect(f.dm, `${f.id} dm`).toBeLessThanOrEqual(100);
    }
  });

  it('non-mineral/fat yemlerde nel/cp/ndf sayı', () => {
    for (const f of ALL) {
      if (f.category === 'mineral' || f.category === 'fat') continue;
      expect(typeof f.nel, `${f.id} nel`).toBe('number');
      expect(typeof f.cp, `${f.id} cp`).toBe('number');
      expect(typeof f.ndf, `${f.id} ndf`).toBe('number');
    }
  });

  it('her yemde Ca/P/K/Na sayı', () => {
    for (const f of ALL) {
      for (const m of ['ca', 'p', 'k', 'na']) {
        expect(typeof f[m], `${f.id} ${m}`).toBe('number');
      }
    }
  });

  it('id öneki geçerli (tr_/nrc_/min_/inra_/cvb_/user_/feedipedia_)', () => {
    for (const f of ALL) {
      expect(/^(tr|nrc|min|inra|cvb|user|feedipedia)_/.test(f.id), `${f.id} öneki geçerli`).toBe(true);
    }
  });
});

describe('Yem DB bütünlük — sayısal aralıklar', () => {
  const inRange = (v, lo, hi) => v == null || (typeof v === 'number' && v >= lo && v <= hi);
  it('cp/ndf/adf/fat/ash aralıkta (mineral CP: NPN/üre 0-350)', () => {
    for (const f of ALL) {
      // Mineral kategorisi NPN kaynağı içerebilir (üre CP ~281 = azot eşdeğeri)
      const cpMax = f.category === 'mineral' ? 350 : 100;
      expect(inRange(f.cp, 0, cpMax), `${f.id} cp=${f.cp}`).toBe(true);
      expect(inRange(f.ndf, 0, 100), `${f.id} ndf=${f.ndf}`).toBe(true);
      expect(inRange(f.adf, 0, 100), `${f.id} adf=${f.adf}`).toBe(true);
      expect(inRange(f.fat, 0, 100), `${f.id} fat=${f.fat}`).toBe(true);
      expect(inRange(f.ash, 0, 100), `${f.id} ash=${f.ash}`).toBe(true);
    }
  });

  it('nel aralıkta (yağ 0-7 enerji-yoğun, diğer 0-3.5); lys 0-15, met 0-10', () => {
    for (const f of ALL) {
      const nelMax = f.category === 'fat' ? 7 : 3.5;
      expect(inRange(f.nel, 0, nelMax), `${f.id} nel=${f.nel}`).toBe(true);
      if (f.category === 'mineral') continue;
      expect(inRange(f.lys, 0, 15), `${f.id} lys=${f.lys}`).toBe(true);
      expect(inRange(f.met, 0, 10), `${f.id} met=${f.met}`).toBe(true);
    }
  });

  it('lys/met makul %CP aralığında (cp≥8 non-mineral: lys 0.8-11, met 0.4-4.5)', () => {
    // lys/met % CP bazında; gross 10× hatayı (örn. %KM ile karıştırma) yakalar.
    // Mısır gluteni lys ~1.0 (lizince fakir) meşru → alt sınır 0.8.
    for (const f of ALL) {
      if (f.category === 'mineral' || !(f.cp >= 8)) continue;
      if (f.lys != null) {
        expect(f.lys, `${f.id} lys=${f.lys} (%CP düşük?)`).toBeGreaterThanOrEqual(0.8);
        expect(f.lys, `${f.id} lys=${f.lys}`).toBeLessThanOrEqual(11);
      }
      if (f.met != null) {
        expect(f.met, `${f.id} met=${f.met} (%CP düşük?)`).toBeGreaterThanOrEqual(0.4);
        expect(f.met, `${f.id} met=${f.met}`).toBeLessThanOrEqual(4.5);
      }
    }
  });

  it('rdp/rup 0-100; starchProcessing geçerli enum', () => {
    for (const f of ALL) {
      expect(inRange(f.rdp, 0, 100), `${f.id} rdp=${f.rdp}`).toBe(true);
      expect(inRange(f.rup, 0, 100), `${f.id} rup=${f.rup}`).toBe(true);
      if (f.starchProcessing !== undefined) {
        expect(VALID_STARCH_PROC, `${f.id} starchProcessing`).toContain(f.starchProcessing);
      }
    }
  });
});

describe('Yem DB bütünlük — yapısal tutarlılık', () => {
  it('adf ≤ ndf (tüm yemler)', () => {
    for (const f of ALL) {
      if (f.adf == null || f.ndf == null) continue;
      expect(f.adf, `${f.id} adf>ndf`).toBeLessThanOrEqual(f.ndf + 0.5);
    }
  });

  it('lignin ≤ adf (tüm yemler)', () => {
    for (const f of ALL) {
      if (f.lignin == null || f.adf == null) continue;
      expect(f.lignin, `${f.id} lignin>adf`).toBeLessThanOrEqual(f.adf + 0.5);
    }
  });

  it('rdp + rup ≈ 100 (protein içeren yemlerde, ±2)', () => {
    for (const f of ALL) {
      if (f.rdp == null || f.rup == null) continue;
      if (!f.cp || f.cp <= 0) continue;  // proteinsiz yem (yağ/bazı mineraller) → bölünme yok
      expect(Math.abs(f.rdp + f.rup - 100), `${f.id} rdp+rup=${f.rdp + f.rup}`).toBeLessThanOrEqual(2);
    }
  });

  it('kütle dengesi: cp+fat+ash+ndf+nfc 80-120 (non-mineral/fat, nfc varsa)', () => {
    for (const f of ALL) {
      if (f.category === 'mineral' || f.category === 'fat' || f.nfc == null) continue;
      const sum = (f.cp || 0) + (f.fat || 0) + (f.ash || 0) + (f.ndf || 0) + (f.nfc || 0);
      expect(sum, `${f.id} kütle=${sum.toFixed(1)}`).toBeGreaterThanOrEqual(80);
      expect(sum, `${f.id} kütle=${sum.toFixed(1)}`).toBeLessThanOrEqual(120);
    }
  });
});

describe('Yem DB bütünlük — kategori kapsamı & toplam', () => {
  it('6 kategorinin hepsi temsil ediliyor (≥5 yem)', () => {
    const counts = {};
    for (const f of ALL) counts[f.category] = (counts[f.category] || 0) + 1;
    for (const c of VALID_CATEGORIES) {
      expect(counts[c] || 0, `${c} kategorisi`).toBeGreaterThanOrEqual(5);
    }
  });

  it('toplam yem sayısı hedefe doğru ilerliyor (≥200)', () => {
    // FAZ 16.5 hedefi 500; her aşamada artar. Şimdilik mevcut taban.
    expect(ALL.length).toBeGreaterThanOrEqual(200);
  });
});
