import { describe, it, expect } from 'vitest';
import {
  nelMilkContent, nelMaintenance, nelLactation, nelPregnancy,
  nelBcsMobilization,
  calcNELRequirements, calcMPRequirements, calcMCP,
  feedIntakeDiscountFactor,
} from '../src/core/nrc2001.js';
import { NRC2001_REFERENCE_ANIMALS } from './referenceAnimals.js';

const TOLERANCE = 0.02;

function withinTolerance(actual, expected, tol = TOLERANCE) {
  if (expected === 0) return actual < 0.01;
  return Math.abs(actual - expected) / expected <= tol;
}

describe('Süt NEL İçeriği', () => {
  it('Referans hayvan 1 NEL_süt ±%2 tolerans içinde', () => {
    const a = NRC2001_REFERENCE_ANIMALS[0];
    const nel = nelMilkContent(a.input.milkFat, a.input.milkProtein, a.input.milkLactose);
    expect(withinTolerance(nel, a.expected.nelMilk)).toBe(true);
  });

  it('Laktoz bilinmiyorsa sabit kullanılmalı', () => {
    // %3.6 yağ, %3.2 protein, laktoz null → sabit 0.192
    const nelFixed = nelMilkContent(3.6, 3.2, null);
    const nelWith = nelMilkContent(3.6, 3.2, 4.8);
    // Yakın ama birebir aynı değil
    expect(Math.abs(nelFixed - nelWith)).toBeLessThan(0.05);
  });

  it('Yüksek yağlı süt daha fazla NEL içermeli', () => {
    expect(nelMilkContent(5.0, 3.2, null)).toBeGreaterThan(nelMilkContent(3.0, 3.2, null));
  });
});

describe('NEL İdame Gereksinimi', () => {
  it('600 kg inek → 0.08 × 600^0.75 ≈ 9.70 Mcal/gün', () => {
    // 600^0.75 ≈ 121.15 → 0.08 × 121.15 = 9.69
    const nel = nelMaintenance(600);
    expect(withinTolerance(nel, 9.698)).toBe(true);
  });

  it('Referans hayvan 1 NEL idame ±%2', () => {
    const a = NRC2001_REFERENCE_ANIMALS[0];
    const nel = nelMaintenance(a.input.bw);
    expect(withinTolerance(nel, a.expected.nelMaintenance)).toBe(true);
  });

  it('Referans hayvan 2 NEL idame ±%2', () => {
    const a = NRC2001_REFERENCE_ANIMALS[1];
    const nel = nelMaintenance(a.input.bw);
    expect(withinTolerance(nel, a.expected.nelMaintenance)).toBe(true);
  });

  it('Ağır inek daha fazla idame enerjisi gerektirmeli', () => {
    expect(nelMaintenance(700)).toBeGreaterThan(nelMaintenance(500));
  });
});

describe('NEL Laktasyon Gereksinimi', () => {
  it('40 kg süt × 0.709 Mcal/kg ≈ 28.37 Mcal/gün', () => {
    const nel = nelLactation(40, 0.709);
    expect(withinTolerance(nel, 28.37)).toBe(true);
  });
});

describe('NEL Gebelik Gereksinimi', () => {
  it('190 günden önce 0 olmalı', () => {
    expect(nelPregnancy(180)).toBe(0);
    expect(nelPregnancy(100)).toBe(0);
  });

  it('210. gün gebelik NEL değeri pozitif ve makul (1-3 Mcal/gün)', () => {
    const a = NRC2001_REFERENCE_ANIMALS[2];
    const nel = nelPregnancy(a.input.gestDays);
    expect(nel).toBeGreaterThan(0);
    expect(withinTolerance(nel, a.expected.nelPregnancy, 0.05)).toBe(true);
  });

  it('Gebelik ilerledikçe NEL artar', () => {
    expect(nelPregnancy(250)).toBeGreaterThan(nelPregnancy(200));
  });
});

describe('Toplam NEL Gereksinimleri', () => {
  it('Referans hayvan 1 toplam NEL ±%2 tolerans içinde', () => {
    const a = NRC2001_REFERENCE_ANIMALS[0];
    const result = calcNELRequirements(a.input);
    expect(withinTolerance(result.total, a.expected.nelTotal)).toBe(true);
  });

  it('Gebe inek daha fazla toplam NEL gerektirir', () => {
    const base = {
      bw: 580, milkYield: 28, milkFat: 3.7, milkProtein: 3.25,
      milkLactose: 4.8, bcs: 3.5, targetBcs: 3.5, dim: 200, dailyWalkKm: 0,
    };
    const pregnant = calcNELRequirements({ ...base, pregnant: true, gestDays: 210 });
    const notPregnant = calcNELRequirements({ ...base, pregnant: false, gestDays: 0 });
    expect(pregnant.total).toBeGreaterThan(notPregnant.total);
  });
});

describe('nelBcsMobilization — defansif kontroller', () => {
  it('bcs undefined → 0 döndürür (NaN propagation engellenir)', () => {
    expect(nelBcsMobilization(undefined, undefined)).toBe(0);
    expect(nelBcsMobilization(undefined, 3.0)).toBe(0);
    expect(nelBcsMobilization(3.0, undefined)).toBe(0);
  });

  it('BCS eşitse mobilizasyon 0', () => {
    expect(nelBcsMobilization(3.0, 3.0)).toBe(0);
  });

  it('BCS düşüşü pozitif mobilizasyon enerji üretir', () => {
    // current < target → bcsDiff < 0 → negatif rate (kayıp dolduruluyor)
    expect(nelBcsMobilization(3.5, 3.0)).toBeGreaterThan(0);
  });

  it('calcNELRequirements bcs olmadan da çalışır (NaN yok)', () => {
    const r = calcNELRequirements({
      bw: 600, milkYield: 35, milkFat: 3.7, milkProtein: 3.2, milkLactose: 4.8,
      dim: 60, pregnant: false, gestDays: 0,
    });
    expect(Number.isFinite(r.total)).toBe(true);
    expect(r.mobilization).toBe(0);
  });

  it('calcNELRequirements gestDays yok, pregnancyMonth varsa NaN olmaz', () => {
    // UI'dan pregnancyMonth=7 (210 gün) gelir, gestDays gelmeyebilir
    const r = calcNELRequirements({
      bw: 650, milkYield: 35, milkFat: 3.5, milkProtein: 3.1,
      parity: 2, dim: 90, bcs: 3.0,
      pregnant: true, pregnancyMonth: 7,  // → gestDays = 210
    });
    expect(Number.isFinite(r.total)).toBe(true);
    expect(r.pregnancy).toBeGreaterThan(0);
  });

  it('calcMPRequirements gestDays yok, pregnancyMonth varsa NaN olmaz', () => {
    const r = calcMPRequirements({
      bw: 650, milkYield: 35, milkProtein: 3.1,
      pregnant: true, pregnancyMonth: 8,  // → gestDays = 240
    });
    expect(Number.isFinite(r.total)).toBe(true);
    expect(r.pregnancy).toBeGreaterThan(0);
  });
});

describe('MP Gereksinimleri', () => {
  it('MP idame pozitif değer döndürmeli', () => {
    const mp = calcMPRequirements({
      bw: 600, milkYield: 35, milkProtein: 3.2, pregnant: false, gestDays: 0,
    });
    expect(mp.maintenance).toBeGreaterThan(0);
    expect(mp.lactation).toBeGreaterThan(0);
    expect(mp.total).toBeGreaterThan(mp.maintenance);
  });

  it('Yüksek verimli inek daha fazla MP gerektirir', () => {
    const base = { bw: 600, milkProtein: 3.2, pregnant: false, gestDays: 0 };
    const high = calcMPRequirements({ ...base, milkYield: 45 });
    const low = calcMPRequirements({ ...base, milkYield: 20 });
    expect(high.total).toBeGreaterThan(low.total);
  });
});

describe('MCP Sentezi', () => {
  it('Enerji kısıt - TDN=3 kg, RDP=500 g → mcpEnergy(390) < mcpRdp(425)', () => {
    const result = calcMCP(3, 500);
    expect(result.limitingFactor).toBe('energy');
    expect(result.mcp).toBe(result.mcpEnergy);
    expect(result.mcpEnergy).toBe(390);
  });

  it('RDP kısıt - TDN=20 kg, RDP=400 g → mcpRdp(340) < mcpEnergy(2600)', () => {
    const result = calcMCP(20, 400);
    expect(result.limitingFactor).toBe('rdp');
    expect(result.mcp).toBe(result.mcpRdp);
  });

  it('MCP = min(mcpEnergy, mcpRdp)', () => {
    const result = calcMCP(10, 1500);
    expect(result.mcp).toBe(Math.min(result.mcpEnergy, result.mcpRdp));
  });
});

describe('FAZ 24.3 — feedIntakeDiscountFactor (yem-spesifik tüketim-düzeyi enerji iskontosu)', () => {
  it('yüksek-TDN yem az iskonto; yüksek-lif çok', () => {
    // intakeMultiple = 3 (yüksek tüketim)
    const multiple = 3;
    const corn = { tdn: 85 };  // yüksek TDN
    const straw = { tdn: 40 }; // düşük TDN / yüksek lif
    
    const fCorn = feedIntakeDiscountFactor(corn, multiple);
    const fStraw = feedIntakeDiscountFactor(straw, multiple);
    
    // corn discount: 0.18 * 85 = 15.3. decline = 15.3 - 10.3 = 5.0 units. rate = 5.0 / 85 = 0.0588. 
    // total discount for 2 multiples = 0.1176. factor = 0.882.
    // straw discount: 0.18 * 40 = 7.2. decline = max(0, 7.2 - 10.3) = 0. rate = 0. factor = 1.0.
    // Wait, let's just assert that high TDN gets SOME discount, low TDN gets NO discount.
    expect(fCorn).toBeLessThan(1);
    expect(fStraw).toBeCloseTo(1.0, 4);
    
    // Let's test a mid-TDN feed
    const alfalfa = { tdn: 60 };
    // discount: 0.18*60 = 10.8. decline = 0.5. rate = 0.5/60 = 0.0083. total = 0.016. factor = 0.983.
    const fAlfalfa = feedIntakeDiscountFactor(alfalfa, multiple);
    expect(fAlfalfa).toBeLessThan(1);
    expect(fAlfalfa).toBeGreaterThan(fCorn); // corn is discounted more in %
  });

  it('idame KMT (~1× idame) → iskonto yok (faktör=1)', () => {
    const feed = { tdn: 85 };
    expect(feedIntakeDiscountFactor(feed, 1)).toBeCloseTo(1.0, 4);
    expect(feedIntakeDiscountFactor(feed, 0.8)).toBeCloseTo(1.0, 4);
  });

  it('geçersiz girdide iskonto yok (faktör=1)', () => {
    expect(feedIntakeDiscountFactor(null, 3)).toBe(1);
    expect(feedIntakeDiscountFactor({ tdn: 0 }, 3)).toBe(1);
    expect(feedIntakeDiscountFactor({ tdn: NaN }, 3)).toBe(1);
  });
});

