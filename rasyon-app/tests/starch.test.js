import { describe, it, expect } from 'vitest';
import {
  STARCH_PROCESSING,
  DEFAULT_STARCH_KP,
  starchKdByProcessing,
  starchDigestibility,
  aggregateStarchDigestion,
  interpretRumenStarch,
} from '../src/core/starch.js';

describe('STARCH_PROCESSING — işleme tipleri', () => {
  it('6 işleme tipi tanımlı, kd artan sırada', () => {
    const order = ['whole', 'cracked', 'dryGround', 'dryGroundFine', 'highMoisture', 'steamFlaked'];
    for (const k of order) {
      expect(STARCH_PROCESSING[k]).toBeTruthy();
      expect(STARCH_PROCESSING[k].kd).toBeGreaterThan(0);
      expect(STARCH_PROCESSING[k].label).toBeTruthy();
    }
    // kd artan: whole < cracked < ... < steamFlaked
    for (let i = 1; i < order.length; i++) {
      expect(STARCH_PROCESSING[order[i]].kd).toBeGreaterThan(STARCH_PROCESSING[order[i - 1]].kd);
    }
  });

  it('bağırsak katsayısı işlemeyle artar (whole < steamFlaked)', () => {
    expect(STARCH_PROCESSING.steamFlaked.intestinal).toBeGreaterThan(STARCH_PROCESSING.whole.intestinal);
  });
});

describe('starchKdByProcessing', () => {
  it('geçerli tip kd döner', () => {
    expect(starchKdByProcessing('steamFlaked')).toBe(STARCH_PROCESSING.steamFlaked.kd);
  });
  it('tanımsız tip → null', () => {
    expect(starchKdByProcessing('xyz')).toBe(null);
    expect(starchKdByProcessing(undefined)).toBe(null);
  });
});

describe('starchDigestibility — yem-başına RSD', () => {
  it('RSD = kd / (kd + kp)', () => {
    const d = starchDigestibility({ category: 'grain', starchProcessing: 'dryGround', starch: 60 });
    const kd = STARCH_PROCESSING.dryGround.kd;
    expect(d.rsd).toBeCloseTo(kd / (kd + DEFAULT_STARCH_KP), 3);
  });

  it('işleme arttıkça RSD artar (whole < dryGround < steamFlaked)', () => {
    const whole = starchDigestibility({ category: 'grain', starchProcessing: 'whole' });
    const ground = starchDigestibility({ category: 'grain', starchProcessing: 'dryGround' });
    const flaked = starchDigestibility({ category: 'grain', starchProcessing: 'steamFlaked' });
    expect(whole.rsd).toBeLessThan(ground.rsd);
    expect(ground.rsd).toBeLessThan(flaked.rsd);
  });

  it('rsd + bypass = 1; totalTract = rsd + intestinal', () => {
    const d = starchDigestibility({ category: 'grain', starchProcessing: 'highMoisture' });
    expect(d.rsd + d.bypass).toBeCloseTo(1, 3);
    expect(d.totalTract).toBeCloseTo(d.rsd + d.intestinal, 3);
    expect(d.totalTract).toBeLessThanOrEqual(1.0001);
  });

  it('işleme tipi açık kdB1\'i geçersiz kılar (starch-özel öncelik)', () => {
    // İşleme tipi seçiliyse kullanıcının kasıtlı starch seçimi önceliklidir;
    // kdB1 (genel CHO-B1 hızı) yalnızca işleme belirtilmemişse fallback olur.
    const d = starchDigestibility({ category: 'grain', starchProcessing: 'whole', kdB1: 30 });
    expect(d.kd).toBe(STARCH_PROCESSING.whole.kd);  // işleme tipi öncelikli
  });

  it('işleme yokken kdB1 fallback kullanılır', () => {
    const d = starchDigestibility({ category: 'grain', kdB1: 30 });
    expect(d.kd).toBe(30);  // işleme yok → kdB1
  });

  it('işleme belirtilmezse kategori varsayılanı (grain) kullanılır', () => {
    const d = starchDigestibility({ category: 'grain', starch: 60 });
    expect(d.processing).toBe('default');
    expect(d.kd).toBeGreaterThan(0);
    expect(d.rsd).toBeGreaterThan(0.5);  // tipik dry-ground civarı
  });

  it('steam-flaked toplam sindirim ~%99 (gerçekçi)', () => {
    const d = starchDigestibility({ category: 'grain', starchProcessing: 'steamFlaked' });
    expect(d.totalTract).toBeGreaterThan(0.95);
  });

  it('bütün tane toplam sindirim daha düşük (~%73)', () => {
    const d = starchDigestibility({ category: 'grain', starchProcessing: 'whole' });
    expect(d.totalTract).toBeLessThan(0.85);
    expect(d.totalTract).toBeGreaterThan(0.6);
  });

  it('kpSolid parametresi RSD\'yi etkiler (yüksek kp → düşük RSD)', () => {
    const slow = starchDigestibility({ category: 'grain', starchProcessing: 'dryGround' }, { kpSolid: 4 });
    const fast = starchDigestibility({ category: 'grain', starchProcessing: 'dryGround' }, { kpSolid: 10 });
    expect(slow.rsd).toBeGreaterThan(fast.rsd);  // yavaş pasaj → daha çok rumen sindirimi
  });
});

describe('aggregateStarchDigestion — rasyon düzeyi', () => {
  const ingredients = [
    { feed: { category: 'grain', starch: 70, starchProcessing: 'steamFlaked' }, dmKg: 6 },   // yüksek RSD
    { feed: { category: 'grain', starch: 65, starchProcessing: 'whole' }, dmKg: 4 },          // düşük RSD
    { feed: { category: 'roughage', starch: 30, dm: 33 }, dmKg: 10 },                         // silaj nişastası
    { feed: { category: 'mineral', starch: 0 }, dmKg: 0.5 },                                  // nişastasız
  ];

  it('rumen + bağırsak + dışkı = toplam nişasta', () => {
    const a = aggregateStarchDigestion(ingredients, 20.5);
    expect(a.rumenStarch_g + a.intestinalStarch_g + a.fecalStarch_g).toBeCloseTo(a.starch_g, 0);
  });

  it('rsd ve oranlar 0-1 aralığında, totalTract ≥ rsd', () => {
    const a = aggregateStarchDigestion(ingredients, 20.5);
    expect(a.rsd).toBeGreaterThan(0);
    expect(a.rsd).toBeLessThanOrEqual(1);
    expect(a.totalTract).toBeGreaterThanOrEqual(a.rsd);
  });

  it('starch_pct ve rumenStarch_pct % KM olarak hesaplanır', () => {
    const a = aggregateStarchDigestion(ingredients, 20.5);
    expect(a.starch_pct).toBeCloseTo(a.starch_g / 20.5 / 10, 1);
    expect(a.rumenStarch_pct).toBeLessThanOrEqual(a.starch_pct);
  });

  it('nişastasız yem (mineral) profili etkilemez', () => {
    const withMineral = aggregateStarchDigestion(ingredients, 20.5);
    const noMineral = aggregateStarchDigestion(ingredients.slice(0, 3), 20);
    expect(withMineral.starch_g).toBeCloseTo(noMineral.starch_g, 0);
  });

  it('boş/geçersiz girdi güvenli (sıfır)', () => {
    const a = aggregateStarchDigestion([], 0);
    expect(a.starch_g).toBe(0);
    expect(a.rsd).toBe(0);
  });
});

describe('interpretRumenStarch — SARA göstergesi', () => {
  it('< 18% KM → düşük', () => {
    expect(interpretRumenStarch(12).level).toBe('low');
  });
  it('18-24% KM → orta', () => {
    expect(interpretRumenStarch(21).level).toBe('moderate');
  });
  it('> 24% KM → yüksek (SARA riski)', () => {
    const r = interpretRumenStarch(28);
    expect(r.level).toBe('high');
    expect(r.message).toMatch(/SARA|asidoz/i);
  });
  it('her seviye label + message içerir', () => {
    for (const v of [10, 21, 30]) {
      const r = interpretRumenStarch(v);
      expect(typeof r.label).toBe('string');
      expect(typeof r.message).toBe('string');
    }
  });
});
