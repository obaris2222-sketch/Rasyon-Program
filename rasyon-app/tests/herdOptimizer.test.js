/**
 * FAZ 20.2 — Sürü-geneli eşzamanlı optimizasyon (ortak yem stoğu) testleri.
 * Birleşik LP: gruplar arası ortak stok kısıtı; ortak kısıt yoksa bağımsız optimumların birleşimi.
 */
import { describe, it, expect } from 'vitest';
import { optimizeHerd } from '../src/solver/herdOptimizer.js';
import { optimizeRation } from '../src/solver/rationOptimizer.js';

const FEEDS = [
  { id: 'corn_silage', name: 'Mısır Silajı', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, rup: 15, rdp: 85, ndf: 44, adf: 27, aNDF: 42, nfc: 36, fat: 3.3, ash: 4.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
  { id: 'alfalfa_hay', name: 'Yonca', category: 'roughage', dm: 89, nel: 1.30, cp: 18, rup: 20, rdp: 80, ndf: 42, adf: 32, aNDF: 39, nfc: 25, fat: 2, ash: 11, ca: 1.45, p: 0.30, mg: 0.32, k: 2.50, na: 0.10, s: 0.27, cl: 0.40, pricePerTon: 6000 },
  { id: 'corn_grain', name: 'Mısır', category: 'grain', dm: 88, nel: 2.0, cp: 9, rup: 50, rdp: 50, ndf: 10, adf: 3, aNDF: 8, nfc: 74, fat: 4, ash: 1.4, ca: 0.02, p: 0.28, mg: 0.10, k: 0.38, na: 0.01, s: 0.10, cl: 0.05, pricePerTon: 9000 },
  { id: 'soybean_meal', name: 'Soya', category: 'protein', dm: 89, nel: 1.99, cp: 48, rup: 35, rdp: 65, ndf: 10, adf: 5, aNDF: 8, nfc: 28, fat: 1.5, ash: 7, ca: 0.33, p: 0.70, mg: 0.30, k: 2.20, na: 0.02, s: 0.45, cl: 0.04, pricePerTon: 18000 },
  { id: 'limestone', name: 'Kireç', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100, ca: 38, p: 0, mg: 0.35, k: 0, na: 0, s: 0, cl: 0, pricePerTon: 3000 },
  { id: 'dcp', name: 'DCP', category: 'mineral', dm: 97, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100, ca: 22, p: 18, mg: 0.6, k: 0, na: 0.1, s: 0.8, cl: 0, pricePerTon: 15000 },
  { id: 'salt', name: 'Tuz', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100, ca: 0, p: 0, mg: 0, k: 0, na: 39, s: 0, cl: 60, pricePerTon: 2000 },
];
const LIMITS = { alfalfa_hay: { maxPct: 40 }, corn_silage: { maxPct: 45, minPct: 15 }, corn_grain: { maxPct: 40 }, soybean_meal: { maxPct: 25 }, salt: { maxPct: 1 } };
const GROUPS = [
  { id: 'g1', name: 'Yüksek Verim', size: 40, profile: { bw: 600, parity: 2, dim: 90, milkYield: 35, milkFat: 3.7, milkProtein: 3.2, bcs: 3.0, pregnant: false, gestDays: 0 } },
  { id: 'g2', name: 'Orta Verim', size: 60, profile: { bw: 620, parity: 3, dim: 160, milkYield: 25, milkFat: 3.9, milkProtein: 3.3, bcs: 3.2, pregnant: false, gestDays: 0 } },
];

function herdFeedAsFed(res, feedId) {
  let s = 0;
  for (const g of res.groups) { const it = g.items.find(i => i.id === feedId); if (it) s += it.asFedKg * g.size; }
  return s;
}

describe('FAZ 20.2 — optimizeHerd', () => {
  it('fizibil çözüm + grup rasyonları + toplam = grup maliyetleri toplamı', async () => {
    const res = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS });
    expect(res.feasible).toBe(true);
    expect(res.groups).toHaveLength(2);
    res.groups.forEach(g => { expect(g.items.length).toBeGreaterThan(0); expect(g.costGroup).toBeGreaterThan(0); });
    const sum = res.groups.reduce((s, g) => s + g.costGroup, 0);
    expect(res.totalCost).toBeCloseTo(sum, 1);
  });

  it('ortak stok yokken: blok-köşegen → bağımsız optimum toplamına eşit (maliyet)', async () => {
    const herd = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS });
    let indep = 0;
    for (const g of GROUPS) {
      const r = await optimizeRation({ animal: g.profile, feeds: FEEDS, feedLimits: LIMITS });
      indep += r.totalCost * g.size;
    }
    // Ortak kısıt yok → LP ayrışır; toplam maliyet bağımsız toplamla eşleşmeli (±%1).
    expect(Math.abs(herd.totalCost - indep) / indep).toBeLessThan(0.01);
  });

  it('bağlayıcı ortak stok: kullanım ≤ limit ve toplam maliyet ≥ serbest (kısıt pahalılaştırır)', async () => {
    const free = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS });
    // corn_grain'in minPct tabanı YOK → güvenle kısıtlanabilir (min-floor çelişkisi olmaz).
    const freeGrain = herdFeedAsFed(free, 'corn_grain');
    expect(freeGrain).toBeGreaterThan(0);
    const limit = freeGrain * 0.5;   // serbest kullanımın yarısı → bağlayıcı
    const cap = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS, sharedStock: { corn_grain: limit } });
    expect(cap.feasible).toBe(true);
    const su = cap.stockUsage.find(s => s.feedId === 'corn_grain');
    expect(su.usedAsFedKg).toBeLessThanOrEqual(limit + 1);             // stok aşılmadı
    expect(su.limitAsFedKg).toBe(limit);
    expect(cap.totalCost).toBeGreaterThanOrEqual(free.totalCost - 1);  // kısıt → maliyet ≥ serbest
  });

  it('aşırı sıkı stok (tüm kaba yem ~0) → kaba yem (forage) gereksinimi karşılanamaz → infeasible (dürüst)', async () => {
    const cap = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS, sharedStock: { corn_silage: 1, alfalfa_hay: 1 } });
    expect(cap.feasible).toBe(false);
    expect(cap.status).toBeDefined();
  });

  it('stok kullanım raporu doğru (kullanım + limit + %)', async () => {
    const free = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS });
    const limit = herdFeedAsFed(free, 'corn_grain') * 0.7;
    const cap = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS, sharedStock: { corn_grain: limit } });
    const su = cap.stockUsage.find(s => s.feedId === 'corn_grain');
    expect(su).toBeTruthy();
    expect(su.limitAsFedKg).toBe(limit);
    expect(su.usedAsFedKg).toBeGreaterThan(0);
    expect(su.utilizationPct).toBeGreaterThan(0);
  });

  it('guard: groups boş / feeds boş → hata', async () => {
    await expect(optimizeHerd({ groups: [], feeds: FEEDS })).rejects.toThrow();
    await expect(optimizeHerd({ groups: GROUPS, feeds: [] })).rejects.toThrow();
  });

  // ─── FAZ 23.1 — Bütçe kısıtı ───────────────────────────────────────────────
  it('FAZ 23.1: bütçe verilmezse budgetUsage null + davranış değişmez', async () => {
    const res = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS });
    expect(res.budgetUsage).toBeNull();
    expect(res.feasible).toBe(true);
  });

  it('FAZ 23.1: bütçe gevşek (serbest×1.2) → feasible + totalCost ≤ bütçe + kullanım < %100', async () => {
    const free = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS });
    const budget = free.totalCost * 1.2;
    const res = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS, budget });
    expect(res.feasible).toBe(true);
    expect(res.totalCost).toBeLessThanOrEqual(budget + 1);
    expect(res.budgetUsage.limitTl).toBeCloseTo(budget, 1);
    expect(res.budgetUsage.utilizationPct).toBeLessThan(100);
  });

  it('FAZ 23.1: bütçe optimal maliyetin altında (serbest×0.8) → infeasible (dürüst)', async () => {
    const free = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS });
    const res = await optimizeHerd({ groups: GROUPS, feeds: FEEDS, feedLimits: LIMITS, budget: free.totalCost * 0.8 });
    expect(res.feasible).toBe(false);
  });

  // ─── FAZ 23.2 — İz mineral/vitamin dahil (soft) ────────────────────────────
  // İz mineral kaynağı olan feed seti (kaba yemlere düşük trace → constraint oluşur ama yetersiz).
  const TRACE = { zn: 25, cu: 5, mn: 30, se: 0.05, fe: 150, i: 0.2, co: 0.1 };
  const FEEDS_TM = FEEDS.map(f => f.category === 'roughage' ? { ...f, ...TRACE } : f);
  const TM_PREMIX = { id: 'tm_premix', name: 'İz Premiks', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100, ca: 0, p: 0, mg: 0, k: 0, na: 0, s: 0, cl: 0, zn: 80000, cu: 20000, mn: 60000, se: 300, fe: 50000, i: 1000, co: 300, pricePerTon: 50000 };

  it('FAZ 23.2: includeMicros=false (default) → trace/vit hariç → microViolations boş', async () => {
    const res = await optimizeHerd({ groups: GROUPS, feeds: FEEDS_TM, feedLimits: LIMITS });
    expect(res.feasible).toBe(true);
    expect(res.microViolations).toEqual([]);
  });

  it('FAZ 23.2: includeMicros=true + premiks YOK → soft (infeasible DEĞİL) + ihlal raporlanır', async () => {
    const res = await optimizeHerd({ groups: GROUPS, feeds: FEEDS_TM, feedLimits: LIMITS, includeMicros: true });
    expect(res.feasible).toBe(true);                       // soft slack → infeasible yapmaz
    expect(res.microViolations.length).toBeGreaterThan(0); // karşılanamayan mikro-besin(ler)
    expect(res.microViolations.some(v => /se|zn|cu/.test(v.nutrient))).toBe(true);
  });

  it('FAZ 23.2: includeMicros=true + premiks VAR → karşılanır (ihlal yok)', async () => {
    const res = await optimizeHerd({ groups: GROUPS, feeds: [...FEEDS_TM, TM_PREMIX], feedLimits: LIMITS, includeMicros: true });
    expect(res.feasible).toBe(true);
    expect(res.microViolations).toEqual([]);
  });
});
