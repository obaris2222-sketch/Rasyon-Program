/**
 * Ekonomik analiz modülü testleri
 */

import { describe, it, expect } from 'vitest';
import {
  calcEconomics,
  interpretFeedEfficiency,
  interpretFeedCostPerLiter,
} from '../src/core/economics.js';

describe('calcEconomics — temel hesaplamalar', () => {
  it('günlük IOFC = gelir − yem maliyeti', () => {
    const r = calcEconomics({
      milkYield_kg: 30, milkPrice_tl: 15, feedCost_tl_day: 200, dmi_kg: 22,
    });
    expect(r.daily.revenue_tl).toBe(450);
    expect(r.daily.feedCost_tl).toBe(200);
    expect(r.daily.iofc_tl).toBe(250);
  });

  it('feedCostPerLiter doğru hesaplanır', () => {
    const r = calcEconomics({
      milkYield_kg: 25, milkPrice_tl: 14, feedCost_tl_day: 150, dmi_kg: 20,
    });
    expect(r.daily.feedCostPerLiter_tl).toBe(6);
  });

  it('feedEfficiency = ECM / kg KMT (FAZ 9 — NASEM 2021 standardı)', () => {
    const r = calcEconomics({
      milkYield_kg: 35, milkFat_pct: 3.5, milkProtein_pct: 3.1,
      milkPrice_tl: 14, feedCost_tl_day: 200, dmi_kg: 23,
    });
    // ECM = 35 × (0.327 + 0.1276×3.5 + 0.0978×3.1) = 35 × 1.0758 ≈ 37.65
    // FE = 37.65 / 23 ≈ 1.64
    const expectedECM = 35 * (0.327 + 0.1276 * 3.5 + 0.0978 * 3.1);
    expect(r.daily.feedEfficiency).toBeCloseTo(expectedECM / 23, 2);
    expect(r.daily.ecm_kg).toBeCloseTo(expectedECM, 1);
  });

  it('rawFeedEfficiency = kg süt / kg KMT (geriye uyumluluk)', () => {
    const r = calcEconomics({
      milkYield_kg: 35, milkPrice_tl: 14, feedCost_tl_day: 200, dmi_kg: 23,
    });
    expect(r.daily.rawFeedEfficiency).toBeCloseTo(35 / 23, 2);
  });

  it('yıllık projeksiyon 305 gün laktasyon ile çarpar', () => {
    const r = calcEconomics({
      milkYield_kg: 30, milkPrice_tl: 14, feedCost_tl_day: 180, dmi_kg: 22,
    });
    expect(r.annual.milkRevenue_tl).toBe(30 * 14 * 305);
    expect(r.annual.lactationDays).toBe(305);
  });

  it('herdSize toplam IOFC çarpar', () => {
    const r = calcEconomics({
      milkYield_kg: 30, milkPrice_tl: 14, feedCost_tl_day: 200, dmi_kg: 22, herdSize: 100,
    });
    expect(r.herd.size).toBe(100);
    expect(r.herd.dailyIOFC_tl).toBe(r.daily.iofc_tl * 100);
  });

  it('milkPrice 0 ise IOFC negatif', () => {
    const r = calcEconomics({
      milkYield_kg: 30, milkPrice_tl: 0, feedCost_tl_day: 200, dmi_kg: 22,
    });
    expect(r.daily.iofc_tl).toBe(-200);
    expect(r.status.level).toBe('loss');
  });

  it('dmi_kg 0 ise sıfıra bölme hatası vermez', () => {
    const r = calcEconomics({
      milkYield_kg: 30, milkPrice_tl: 14, feedCost_tl_day: 200, dmi_kg: 0,
    });
    expect(r.daily.feedEfficiency).toBe(0);
    expect(r.daily.revenuePerKgFeed_tl).toBe(0);
  });

  it('milkYield 0 ise feedCostPerLiter 0 (NaN değil)', () => {
    const r = calcEconomics({
      milkYield_kg: 0, milkPrice_tl: 14, feedCost_tl_day: 50, dmi_kg: 10,
    });
    expect(r.daily.feedCostPerLiter_tl).toBe(0);
  });
});

describe('IOFC yorumu', () => {
  it('IOFC negatif → loss', () => {
    const r = calcEconomics({
      milkYield_kg: 25, milkPrice_tl: 10, feedCost_tl_day: 300, dmi_kg: 22,
    });
    expect(r.status.level).toBe('loss');
  });

  it('IOFC çok yüksek → excellent', () => {
    const r = calcEconomics({
      milkYield_kg: 30, milkPrice_tl: 20, feedCost_tl_day: 100, dmi_kg: 22,
    });
    expect(r.status.level).toBe('excellent');
  });

  it('orta IOFC → good veya medium', () => {
    const r = calcEconomics({
      milkYield_kg: 30, milkPrice_tl: 14, feedCost_tl_day: 250, dmi_kg: 22,
    });
    expect(['good', 'medium']).toContain(r.status.level);
  });
});

describe('interpretFeedEfficiency', () => {
  it('1.8 → excellent', () => {
    expect(interpretFeedEfficiency(1.8).level).toBe('excellent');
  });
  it('1.5 → good', () => {
    expect(interpretFeedEfficiency(1.5).level).toBe('good');
  });
  it('1.3 → medium', () => {
    expect(interpretFeedEfficiency(1.3).level).toBe('medium');
  });
  it('1.0 → low', () => {
    expect(interpretFeedEfficiency(1.0).level).toBe('low');
  });
});

describe('interpretFeedCostPerLiter', () => {
  it('5 ₺ → excellent', () => {
    expect(interpretFeedCostPerLiter(5).level).toBe('excellent');
  });
  it('8 ₺ → good', () => {
    expect(interpretFeedCostPerLiter(8).level).toBe('good');
  });
  it('11 ₺ → medium', () => {
    expect(interpretFeedCostPerLiter(11).level).toBe('medium');
  });
  it('15 ₺ → high', () => {
    expect(interpretFeedCostPerLiter(15).level).toBe('high');
  });
  it('0 → na', () => {
    expect(interpretFeedCostPerLiter(0).level).toBe('na');
  });
});
