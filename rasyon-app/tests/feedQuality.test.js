import { describe, it, expect } from 'vitest';
import {
  MYCOTOXIN_LIMITS, MYCOTOXIN_KEYS,
  aggregateMycotoxins, interpretMycotoxinRisk,
  silageFermentationScore, aggregateSilageQuality,
} from '../src/core/feedQuality.js';

describe('MYCOTOXIN_LIMITS — yapı', () => {
  it('6 mikotoksin tanımlı, her biri limit+label içerir', () => {
    expect(MYCOTOXIN_KEYS.length).toBe(6);
    for (const k of MYCOTOXIN_KEYS) {
      expect(MYCOTOXIN_LIMITS[k]).toBeTruthy();
      expect(MYCOTOXIN_LIMITS[k].limit).toBeGreaterThan(0);
      expect(typeof MYCOTOXIN_LIMITS[k].label).toBe('string');
    }
  });
  it('aflatoksin en düşük limit (en katı)', () => {
    expect(MYCOTOXIN_LIMITS.aflatoxinB1.limit).toBeLessThan(MYCOTOXIN_LIMITS.don.limit);
    expect(MYCOTOXIN_LIMITS.aflatoxinB1.limit).toBeLessThan(MYCOTOXIN_LIMITS.fumonisin.limit);
  });
});

describe('aggregateMycotoxins — rasyon yükü', () => {
  it('veri yoksa anyData=false, tüm değerler 0', () => {
    const a = aggregateMycotoxins([{ feed: { id: 'x', cp: 10 }, dmKg: 10 }], 10);
    expect(a.anyData).toBe(false);
    expect(a.toxins.aflatoxinB1.value).toBe(0);
    expect(a.overall).toBe('ok');
  });

  it('KM-ağırlıklı μg/kg KM hesaplar', () => {
    // 10 kg yem aflatoksin 10 ppb + 10 kg temiz → rasyon 5 ppb
    const ing = [
      { feed: { id: 'a', aflatoxinB1: 10 }, dmKg: 10 },
      { feed: { id: 'b' }, dmKg: 10 },
    ];
    const a = aggregateMycotoxins(ing, 20);
    expect(a.toxins.aflatoxinB1.value).toBeCloseTo(5, 1);
    expect(a.anyData).toBe(true);
  });

  it('limit aşımı → danger; limite yaklaşma → warning', () => {
    const danger = aggregateMycotoxins([{ feed: { id: 'a', aflatoxinB1: 8 }, dmKg: 10 }], 10);
    expect(danger.toxins.aflatoxinB1.status).toBe('danger');  // 8 > 5 limit
    expect(danger.overall).toBe('danger');
    const warn = aggregateMycotoxins([{ feed: { id: 'a', aflatoxinB1: 3 }, dmKg: 10 }], 10);
    expect(warn.toxins.aflatoxinB1.status).toBe('warning');   // 3 ≥ 0.5×5=2.5
    expect(warn.overall).toBe('warning');
    const ok = aggregateMycotoxins([{ feed: { id: 'a', aflatoxinB1: 1 }, dmKg: 10 }], 10);
    expect(ok.toxins.aflatoxinB1.status).toBe('ok');          // 1 < 2.5
  });

  it('fumonisin ruminantta yüksek limit (50000) → büyük değer bile ok', () => {
    const a = aggregateMycotoxins([{ feed: { id: 'a', fumonisin: 10000 }, dmKg: 10 }], 10);
    expect(a.toxins.fumonisin.status).toBe('ok');  // 10000 < 0.6×50000=30000
  });

  it('contributors kontamine yemleri listeler', () => {
    const a = aggregateMycotoxins([{ feed: { id: 'a', name: 'Mısır Silajı', don: 3000 }, dmKg: 10 }], 10);
    expect(a.toxins.don.contributors).toContain('Mısır Silajı');
  });

  it('boş/geçersiz girdi güvenli', () => {
    const a = aggregateMycotoxins([], 0);
    expect(a.anyData).toBe(false);
    expect(a.overall).toBe('ok');
  });
});

describe('interpretMycotoxinRisk', () => {
  it('veri yok → na', () => {
    expect(interpretMycotoxinRisk({ anyData: false }).level).toBe('na');
  });
  it('danger → öneriler dolu', () => {
    const a = aggregateMycotoxins([{ feed: { id: 'a', aflatoxinB1: 8 }, dmKg: 10 }], 10);
    const r = interpretMycotoxinRisk(a);
    expect(r.level).toBe('danger');
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
  it('düşük düzey → ok', () => {
    const a = aggregateMycotoxins([{ feed: { id: 'a', aflatoxinB1: 1 }, dmKg: 10 }], 10);
    expect(interpretMycotoxinRisk(a).level).toBe('ok');
  });
});

describe('silageFermentationScore', () => {
  it('pH yoksa null (fermentasyon verisi yok)', () => {
    expect(silageFermentationScore({ id: 'x', dm: 35 })).toBe(null);
  });

  it('iyi fermente mısır silajı → yüksek skor', () => {
    const s = silageFermentationScore({ dm: 35, silagePH: 3.8, silageLacticAcid: 6, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 6 });
    expect(s.score).toBeGreaterThanOrEqual(85);
    expect(s.level).toBe('excellent');
  });

  it('yüksek butirik asit (klostridyal) → düşük skor', () => {
    const good = silageFermentationScore({ dm: 30, silagePH: 4.0, silageLacticAcid: 5, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 6 });
    const bad = silageFermentationScore({ dm: 30, silagePH: 4.0, silageLacticAcid: 5, silageAceticAcid: 2, silageButyricAcid: 1.0, silageNH3N: 6 });
    expect(bad.score).toBeLessThan(good.score);
    expect(bad.notes.some(n => /butirik|klostridyal/i.test(n))).toBe(true);
  });

  it('yüksek pH → ceza (KM-ayarlı ideal)', () => {
    const lowPH = silageFermentationScore({ dm: 30, silagePH: 3.9, silageLacticAcid: 5, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 6 });
    const highPH = silageFermentationScore({ dm: 30, silagePH: 5.2, silageLacticAcid: 5, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 6 });
    expect(highPH.score).toBeLessThan(lowPH.score);
  });

  it('yüksek NH3-N (proteoliz) → ceza', () => {
    const good = silageFermentationScore({ dm: 30, silagePH: 4.0, silageLacticAcid: 5, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 5 });
    const bad = silageFermentationScore({ dm: 30, silagePH: 4.0, silageLacticAcid: 5, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 20 });
    expect(bad.score).toBeLessThan(good.score);
  });

  it('skor 0-100 aralığında, grade tutarlı', () => {
    const s = silageFermentationScore({ dm: 25, silagePH: 5.5, silageLacticAcid: 2, silageAceticAcid: 4, silageButyricAcid: 1.5, silageNH3N: 22 });
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.level).toBe('poor');
  });

  it('tam veride partial=false (mevcut davranış korunur)', () => {
    const s = silageFermentationScore({ dm: 35, silagePH: 3.8, silageLacticAcid: 6, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 6 });
    expect(s.partial).toBe(false);
    expect(s.missing).toEqual([]);
  });

  it('DENETİM: yalnız pH girilince eksik alanlar 0 SAYILMAZ (null) + partial uyarısı', () => {
    const s = silageFermentationScore({ dm: 35, silagePH: 3.8 });
    expect(s.partial).toBe(true);
    expect(s.butyric).toBe(null);   // 0 değil → "mükemmel" yanılsaması yok
    expect(s.nh3).toBe(null);
    expect(s.missing).toContain('butirik asit');
    expect(s.missing).toContain('NH3-N');
    expect(s.notes.some(n => /eksik veriye dayalı/i.test(n))).toBe(true);
  });

  it('kısmi veri (butirik girilmemiş) butirik cezası uygulanmaz ama uyarılır', () => {
    const s = silageFermentationScore({ dm: 35, silagePH: 4.0, silageLacticAcid: 6, silageAceticAcid: 2, silageNH3N: 6 });
    expect(s.butyric).toBe(null);
    expect(s.missing).toContain('butirik asit');
    expect(s.partial).toBe(true);
  });
});

describe('aggregateSilageQuality', () => {
  it('yalnız fermentasyon verisi olan silajları toplar', () => {
    const ing = [
      { feed: { id: 'cs', name: 'Mısır Silajı', dm: 35, silagePH: 3.8, silageLacticAcid: 6, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 6 }, dmKg: 12 },
      { feed: { id: 'hay', name: 'Yonca Kuru Otu', dm: 89 }, dmKg: 5 },  // veri yok
    ];
    const a = aggregateSilageQuality(ing);
    expect(a.anyData).toBe(true);
    expect(a.items.length).toBe(1);
    expect(a.items[0].name).toBe('Mısır Silajı');
  });

  it('veri yoksa boş', () => {
    const a = aggregateSilageQuality([{ feed: { id: 'x', dm: 90 }, dmKg: 5 }]);
    expect(a.anyData).toBe(false);
    expect(a.items.length).toBe(0);
  });
});
