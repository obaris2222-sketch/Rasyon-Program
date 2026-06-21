/**
 * rationOptimizer.js — uçtan uca rasyon optimizasyonu testleri
 */

import { describe, it, expect } from 'vitest';
import { optimizeRation, DEFAULT_COMPOSITION, compositionForStage } from '../src/solver/rationOptimizer.js';
import { mpComponentsPerKgDM } from '../src/solver/lpBuilder.js';  // FAZ 18.1: rasyon-düzeyi MP doğrulaması
import { feedIntakeDiscountFactor } from '../src/core/nrc2001.js';

const FEEDS = [
  {
    id: 'corn_silage', name: 'Mısır Silajı', category: 'roughage',
    dm: 33, tdn: 68, nel: 1.72, cp: 8.2, rup: 15, rdp: 85, ndf: 44, adf: 27, aNDF: 42, nfc: 36,
    fat: 3.3, ash: 4.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09,
    pricePerTon: 2500
  },
  {
    id: 'alfalfa_hay', name: 'Yonca Kuru Otu', category: 'roughage',
    dm: 89, tdn: 60, nel: 1.30, cp: 18, rup: 20, rdp: 80, ndf: 42, adf: 32, aNDF: 39, nfc: 25,
    fat: 2, ash: 11, ca: 1.45, p: 0.30, mg: 0.32, k: 2.50, na: 0.10, s: 0.27, cl: 0.40,
    pricePerTon: 6000
  },
  {
    id: 'corn_grain', name: 'Mısır Tane', category: 'grain',
    dm: 88, tdn: 88, nel: 2.0, cp: 9, rup: 50, rdp: 50, ndf: 10, adf: 3, aNDF: 8, nfc: 74,
    fat: 4, ash: 1.4, ca: 0.02, p: 0.28, mg: 0.10, k: 0.38, na: 0.01, s: 0.10, cl: 0.05,
    pricePerTon: 9000
  },
  {
    id: 'soybean_meal', name: 'Soya Küspesi', category: 'protein',
    dm: 89, tdn: 84, nel: 1.99, cp: 48, rup: 35, rdp: 65, ndf: 10, adf: 5, aNDF: 8, nfc: 28,
    fat: 1.5, ash: 7, ca: 0.33, p: 0.70, mg: 0.30, k: 2.20, na: 0.02, s: 0.45, cl: 0.04,
    pricePerTon: 18000
  },
  {
    id: 'limestone', name: 'Kireçtaşı', category: 'mineral',
    dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
    ca: 38, p: 0, mg: 0.35, k: 0, na: 0, s: 0, cl: 0, pricePerTon: 3000
  },
  {
    id: 'dcp', name: 'DCP', category: 'mineral',
    dm: 97, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
    ca: 22, p: 18, mg: 0.6, k: 0, na: 0.10, s: 0.80, cl: 0, pricePerTon: 15000
  },
  {
    id: 'salt', name: 'Tuz', category: 'mineral',
    dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
    ca: 0, p: 0, mg: 0, k: 0, na: 39, s: 0, cl: 60, pricePerTon: 2000
  },
];

const HOLSTEIN_HIGH_PRODUCER = {
  bw: 600, parity: 2, dim: 60,
  milkYield: 35, milkFat: 3.7, milkProtein: 3.2, milkLactose: 4.8,
  bcs: 3.0, targetBcs: 3.0, pregnant: false, gestDays: 0, dailyWalkKm: 0,
};

// FAZ 10A: MP kısıtı eklendiği için soya üst sınırı 15→25%'e yükseltildi.
// Önceki %15 yüksek-verim Holstein için MP açığı yaratıyordu (CP yeterli görünür
// ama RUP-bazlı MP yetersiz). Bu sektör standardı pratiğine uygundur.
const DEFAULT_LIMITS = {
  alfalfa_hay: { maxPct: 40 },
  corn_silage: { maxPct: 40, minPct: 15 },
  corn_grain: { maxPct: 35 },
  soybean_meal: { maxPct: 25 },
  salt: { maxPct: 1 },
};

describe('optimizeRation — temel doğrulama', () => {
  it('animal eksikse hata fırlatır', async () => {
    await expect(optimizeRation({ feeds: FEEDS })).rejects.toThrow();
  });

  it('feeds boşsa hata fırlatır', async () => {
    await expect(optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: [] })).rejects.toThrow();
  });

  it('yüksek verim Holstein için fizibil çözüm üretir', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('FAZ 18.2: yüksek-NDF (düşük verim + kötü kaba yem) rasyon doluluk-sınırlı KMT ile yeniden çözülür', async () => {
    // Gerçekçi fill senaryosu: DÜŞÜK verimli inek (14 kg) yalnız yüksek-NDF kaba yemle → rasyon
    // ~%50 NDF → KM tüketimi (17.95 kg) × NDF, doluluk kapasitesini (1.35% CA) aşar → KMT düşer.
    const HIGH_NDF_FEEDS = [
      {
        id: 'grass_silage', name: 'Çayır Silajı', category: 'roughage', dm: 35, nel: 1.35, cp: 14, rup: 20, rdp: 80,
        ndf: 55, adf: 34, aNDF: 53, nfc: 20, fat: 3, ash: 9, ca: 0.6, p: 0.32, mg: 0.22, k: 2.6, na: 0.04, s: 0.18, cl: 0.5, pricePerTon: 2200
      },
      {
        id: 'straw', name: 'Saman', category: 'roughage', dm: 90, nel: 1.0, cp: 5, rup: 25, rdp: 75,
        ndf: 70, adf: 46, aNDF: 68, nfc: 14, fat: 1.5, ash: 8.5, ca: 0.35, p: 0.1, mg: 0.12, k: 1.3, na: 0.02, s: 0.1, cl: 0.2, pricePerTon: 1300
      },
      {
        id: 'corn_grain', name: 'Mısır', category: 'grain', dm: 88, nel: 2.0, cp: 9, rup: 50, rdp: 50,
        ndf: 10, adf: 3, aNDF: 8, nfc: 74, fat: 4, ash: 1.4, ca: 0.02, p: 0.28, mg: 0.1, k: 0.38, na: 0.01, s: 0.1, cl: 0.05, pricePerTon: 9000
      },
      {
        id: 'soybean_meal', name: 'Soya', category: 'protein', dm: 89, nel: 1.99, cp: 48, rup: 35, rdp: 65,
        ndf: 10, adf: 5, aNDF: 8, nfc: 28, fat: 1.5, ash: 7, ca: 0.33, p: 0.7, mg: 0.3, k: 2.2, na: 0.02, s: 0.45, cl: 0.04, pricePerTon: 18000
      },
      {
        id: 'limestone', name: 'Kireç', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
        ca: 38, p: 0, mg: 0.35, k: 0, na: 0, s: 0, cl: 0, pricePerTon: 3000
      },
      {
        id: 'dcp', name: 'DCP', category: 'mineral', dm: 97, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
        ca: 22, p: 18, mg: 0.6, k: 0, na: 0.1, s: 0.8, cl: 0, pricePerTon: 15000
      },
      {
        id: 'salt', name: 'Tuz', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
        ca: 0, p: 0, mg: 0, k: 0, na: 39, s: 0, cl: 60, pricePerTon: 2000
      },
    ];
    const lowProducer = {
      bw: 620, parity: 2, dim: 220, milkYield: 14, milkFat: 3.8, milkProtein: 3.3,
      milkLactose: 4.8, bcs: 3.2, lactationStage: 'late', pregnancyMonth: 5
    };
    const r = await optimizeRation({
      animal: lowProducer, feeds: HIGH_NDF_FEEDS,
      composition: { ndf_pct: { min: 52, max: 72 }, forage_pct: { min: 85, max: 100 } },
    });
    expect(r.dmi.fillAdjusted).toBe(true);                 // doluluk düzeltmesi uygulandı
    expect(r.dmi.baseDmi).toBeGreaterThan(r.dmi.target_kg); // hayvan-bazlı > düzeltilmiş
    expect(r.dmi.target_kg).toBeGreaterThan(0);
  });

  it('FAZ 18.2: normal NDF rasyonda doluluk düzeltmesi YOK (fillAdjusted=false)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.dmi.fillAdjusted).toBe(false);
    expect(r.dmi.baseDmi).toBeUndefined();   // düzeltme yoksa baseDmi taşınmaz
  });

  it('FAZ 18.1: ulaşılan MP rasyon-düzeyi min(E,R) kullanır (per-feed min toplamı değil)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    const byId = new Map(FEEDS.map(f => [f.id, f]));
    let mpRUP = 0, enPool = 0, rdpPool = 0, perFeedMic = 0;
    for (const it of r.items) {
      const c = mpComponentsPerKgDM(byId.get(it.id));
      mpRUP += it.dmKg * c.mpRUP;
      enPool += it.dmKg * c.mpEnergyPool;
      rdpPool += it.dmKg * c.mpRdpPool;
      perFeedMic += it.dmKg * c.mpMicrobial;
    }
    const rationLevelMp = mpRUP + Math.min(enPool, rdpPool);   // FAZ 18.1 doğru formül
    const perFeedMp = mpRUP + perFeedMic;                  // eski (per-feed min) yaklaşımı
    // ulaşılan kompozisyon rasyon-düzeyi formülünü yansıtmalı
    expect(r.composition.mp_g).toBeCloseTo(rationLevelMp, 0);
    // rasyon-düzeyi MP, per-feed min toplamından düşük olamaz (genelde ≥ → sinerji)
    expect(rationLevelMp).toBeGreaterThanOrEqual(perFeedMp - 1e-6);
  });

  it('SAHA-DENETİM A: mp_g_max → raporlanan mp_g üst sınırı AŞMAZ (dual-havuz HARD tavan)', async () => {
    // Eski per-feed `MP_max` (Σ mpTotal = Σmin) raporlanan min(ΣE,ΣR)'den küçüktü → raporlanan
    // MP "hard" max'ı sinerji boşluğu kadar aşabiliyordu. Dual-havuz tavanı (mpRUP+ΣE ≤ ub AND
    // mpRUP+ΣR ≤ ub) raporlanan mp_g ≤ ub'yi GARANTİ eder.
    const base = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS });
    const cap = Math.round(base.composition.mp_g - 50);  // doğal seviyenin altında bir tavan → bağlar
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { mp_g: { min: 1200, max: cap } },
    });
    // dual-havuz tavanı HARD (relax listesinde değil) → raporlanan mp_g her durumda ≤ cap
    expect(r.composition.mp_g).toBeLessThanOrEqual(cap + 1);
  });

  it('FAZ 18.4: autoEnergyDiscount açık → tüketim-düzeyi enerji iskontosu uygulanır', async () => {
    const off = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS, autoEnergyDiscount: false });
    const on = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS, autoEnergyDiscount: true });
    expect(off.dmi.energyDiscountPct).toBe(0);                 // kapalı → iskonto yok
    expect(on.dmi.energyDiscountPct).toBeGreaterThan(2);       // yüksek verim → birkaç % iskonto
    expect(on.dmi.energyDiscountPct).toBeLessThan(12);         // üst sınır altında
  });

  it('FAZ 18.4 (denetim): enerji iskontosu TDN-türevli mikrobiyal MP enerji-havuzunu da düşürür', async () => {
    const off = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS, autoEnergyDiscount: false });
    const on = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS, autoEnergyDiscount: true });
    // İskonto açıkken ulaşılan MP rasyon-düzeyi formülünü (enerji-havuz × iskonto) yansıtmalı
    const intakeMultiple = on.dmi.target_kg / (HOLSTEIN_HIGH_PRODUCER.bw * 0.013);
    const byId = new Map(FEEDS.map(f => [f.id, f]));
    let mpRUP = 0, enPool = 0, rdpPool = 0;
    for (const it of on.items) {
      const f = byId.get(it.id);
      const c = mpComponentsPerKgDM(f);
      const feedDisc = feedIntakeDiscountFactor(f, intakeMultiple);
      mpRUP += it.dmKg * c.mpRUP; enPool += it.dmKg * c.mpEnergyPool * feedDisc; rdpPool += it.dmKg * c.mpRdpPool;
    }
    expect(on.composition.mp_g).toBeCloseTo(mpRUP + Math.min(enPool, rdpPool), 0);  // LP↔kompozisyon tutarlı (iskontolu)
  });
});

describe('optimizeRation — sonuç yapısı', () => {
  it('items KMT toplamı target_kg ±%3 slack bandı içinde (FAZ 13.3)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const sum = r.items.reduce((s, it) => s + it.dmKg, 0);
    // FAZ 13.3: DMI ±%3 slack — achieved_kg de aynı bandda olmalı
    expect(sum).toBeGreaterThanOrEqual(r.dmi.target_kg * 0.97 - 1e-3);
    expect(sum).toBeLessThanOrEqual(r.dmi.target_kg * 1.03 + 1e-3);
    expect(r.dmi.achieved_kg).toBeCloseTo(sum, 2);
  });

  it('her item için as-fed > KM (su içeriği nedeniyle)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    for (const it of r.items) {
      if (it.dmKg > 0) {
        expect(it.asFedKg).toBeGreaterThanOrEqual(it.dmKg - 0.01);
      }
    }
  });

  it('toplam maliyet item maliyetlerinin toplamı', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const sum = r.items.reduce((s, it) => s + it.costPerDay, 0);
    expect(r.totalCost).toBeCloseTo(sum, 1);
  });

  it('composition KMT bazında doğru hesaplanır', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    // FAZ 10A: CP max artık MP-bazlı oransal düzeltme ile gevşek (15.4-22)
    // Yüksek verimde rasyon CP'si 18-22 arasında olabilir (MP gereksinimi nedeniyle)
    expect(r.composition.cp_pct).toBeGreaterThanOrEqual(15 - 0.1);
    expect(r.composition.cp_pct).toBeLessThanOrEqual(22 + 0.1);
  });

  it('diagnostics her gereksinim için durum bildirir', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const names = r.diagnostics.map(d => d.name);
    // NEL var
    const nelD = r.diagnostics.find(d => d.name.includes('NEL'));
    expect(nelD).toBeDefined();
    // FAZ 12 Madde 7: CP artık default LP kısıtı değil — MP belirleyici
    expect(names.some(n => n.includes('MP'))).toBe(true);
    expect(names.some(n => n.includes('NDF'))).toBe(true);
    expect(names.some(n => n.includes('Ca'))).toBe(true);
    expect(names.some(n => n.includes('DCAD'))).toBe(true);
  });
});

describe('optimizeRation — bilimsel doğruluk', () => {
  it('NEL gereksinimi karşılanıyor (NRC 2001)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    expect(r.composition.nel_mcal).toBeGreaterThanOrEqual(r.requirements.nel.total - 0.5);
  });

  it('Ca diyet gereksinimi karşılanıyor (NRC 2001)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.composition.ca_g).toBeGreaterThanOrEqual(r.requirements.minerals.ca.dietary - 1);
  });

  it('peNDF ≥ 22% (Mertens 1997)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.composition.peNDF_pct).toBeGreaterThanOrEqual(22 - 0.1);
  });

  it('Kaba yem oranı 40-70% aralığında', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.composition.forage_pct).toBeGreaterThanOrEqual(40 - 0.1);
    expect(r.composition.forage_pct).toBeLessThanOrEqual(70 + 0.1);
  });

  it('DCAD laktasyon aralığında (20-50 mEq/100g)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.composition.dcad_meq).toBeGreaterThanOrEqual(20 - 0.5);
    expect(r.composition.dcad_meq).toBeLessThanOrEqual(50 + 0.5);
  });
});

describe('optimizeRation — kompozisyon override', () => {
  it('kullanıcı composition default\'u ezebilir', async () => {
    // FAZ 10A: User override CP_max=22 (yüksek verim Holstein için MP=2132g'a yer aç)
    // Test rasyon yem seti soya hariç düşük-RUP; MP'yi karşılamak için CP%KM 21+ olabilir
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { cp_pct: { min: 17, max: 22 } },
    });
    expect(r.feasible).toBe(true);
    expect(r.composition.cp_pct).toBeGreaterThanOrEqual(17 - 0.1);
    expect(r.composition.cp_pct).toBeLessThanOrEqual(22 + 0.1);
  });

  it('FAZ 12 Madde 6: NEL min override requirements\'a yansır', async () => {
    // Doğal NEL ~34 Mcal; override 38 → requirements.nel_mcal = 38
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { nel_mcal: { min: 38 } },
    });
    expect(r.requirements.compositionTargets.nel_mcal).toBe(38);
  });

  it('FAZ 12 Madde 6: MP min override requirements\'a yansır', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { mp_g: { min: 2300 } },
    });
    expect(r.requirements.compositionTargets.mp_g).toBe(2300);
  });

  it('FAZ 12 Madde 6: composition boşsa hesaplanan NEL/MP kullanılır', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    // Hesaplanan NEL.total = requirements.nel_mcal
    expect(r.requirements.compositionTargets.nel_mcal).toBeCloseTo(r.requirements.nel.total, 1);
    expect(r.requirements.compositionTargets.mp_g).toBeCloseTo(r.requirements.mp.total, 0);
  });

  it('FAZ 12 Madde 7: composition.cp_pct vermeyince LP\'de CP kısıtı oluşmaz', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    // Diagnostik'te CP kontrolü yok (sadece MP)
    const cpDiag = r.diagnostics.find(d => d.name.startsWith('CP'));
    expect(cpDiag).toBeUndefined();
    const mpDiag = r.diagnostics.find(d => d.name.startsWith('MP'));
    expect(mpDiag).toBeDefined();
  });

  it('feedLimits soya küspesini sınırlayabilir', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS,
      feedLimits: { ...DEFAULT_LIMITS, soybean_meal: { maxPct: 5 } },
    });
    const soy = r.items.find(it => it.id === 'soybean_meal');
    if (soy) {
      expect(soy.pctDm).toBeLessThanOrEqual(5 + 0.1);
    }
  });
});

describe('optimizeRation — düşük verim inek (kolay rasyon)', () => {
  it('20 kg sütlü inek için fizibil çözüm', async () => {
    const lowProducer = { ...HOLSTEIN_HIGH_PRODUCER, milkYield: 20 };
    const r = await optimizeRation({
      animal: lowProducer, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    // Daha az NEL gerekecek
    expect(r.requirements.nel.total).toBeLessThan(35);
  });
});

describe('DEFAULT_COMPOSITION yapı', () => {
  it('temel kompozisyon hedefleri içerir', () => {
    expect(DEFAULT_COMPOSITION.ndf_pct).toBeDefined();
    expect(DEFAULT_COMPOSITION.peNDF_pct).toBeDefined();
    expect(DEFAULT_COMPOSITION.forage_pct).toBeDefined();
    expect(DEFAULT_COMPOSITION.dcad_meq).toBeDefined();
  });

  it('cp_pct varsayılan yok — MP belirleyici (FAZ 13.5)', () => {
    expect(DEFAULT_COMPOSITION.cp_pct).toBeUndefined();
  });

  it('rup_pct varsayılan yok (opsiyonel)', () => {
    expect(DEFAULT_COMPOSITION.rup_pct).toBeUndefined();
  });
});

// ─── FAZ 5D: Laktasyon evresi kompozisyonu ────────────────────────────────────

describe('compositionForStage — laktasyon evresi hedefleri', () => {
  it('early → DEFAULT_COMPOSITION ile aynı', () => {
    const c = compositionForStage('early');
    expect(c.ndf_pct).toEqual(DEFAULT_COMPOSITION.ndf_pct);
    expect(c.dcad_meq).toEqual(DEFAULT_COMPOSITION.dcad_meq);
    expect(c.cp_pct).toBeUndefined();  // FAZ 13.5: CP hedefi yok
  });

  it('mid → orta laktasyon, NDF artar (CP hedefi yok — FAZ 13.5)', () => {
    const c = compositionForStage('mid');
    expect(c.cp_pct).toBeUndefined();
    expect(c.ndf_pct.min).toBeGreaterThanOrEqual(DEFAULT_COMPOSITION.ndf_pct.min);
  });

  it('late → yüksek kaba yem', () => {
    const c = compositionForStage('late');
    expect(c.cp_pct).toBeUndefined();
    expect(c.forage_pct.min).toBeGreaterThanOrEqual(50);
  });

  it('far_off → kuru dönem, düşük enerji, orta DCAD', () => {
    const c = compositionForStage('far_off');
    expect(c.cp_pct).toBeUndefined();  // FAZ 13.5
    expect(c.ndf_pct.min).toBeGreaterThanOrEqual(40);
    expect(c.dcad_meq.min).toBeGreaterThan(0);
    expect(c.forage_pct.min).toBeGreaterThanOrEqual(60);
  });

  it('close_up → NEGATİF DCAD (anyonik rasyon)', () => {
    const c = compositionForStage('close_up');
    expect(c.dcad_meq.max).toBeLessThan(0);
    expect(c.dcad_meq.min).toBeLessThan(c.dcad_meq.max);
    expect(c.dcad_meq.min).toBeGreaterThanOrEqual(-20); // -15 ile -5 aralığında
  });

  it('geçersiz değer → DEFAULT_COMPOSITION döner', () => {
    const c = compositionForStage('unknown');
    expect(c.ndf_pct).toEqual(DEFAULT_COMPOSITION.ndf_pct);
  });

  it('parametresiz → early döner', () => {
    const c = compositionForStage();
    expect(c.ndf_pct).toEqual(DEFAULT_COMPOSITION.ndf_pct);
  });
});

describe('compositionForStage — FAZ 9 dinamik düzeltmeler', () => {
  // FAZ 13.5: CP min dinamik artış/azalış testleri kaldırıldı — cp_pct artık
  // bir kompozisyon hedefi değil (protein yeterliliği MP ile belirleniyor).

  it('Düve (parite 1) → NDF min düşer (daha az kapasite)', () => {
    const heifer = { lactationStage: 'early', milkYield: 25, parity: 1, bcs: 3.0, milkFat: 3.5, milkProtein: 3.1 };
    const c = compositionForStage('early', heifer);
    expect(c.ndf_pct.min).toBeLessThan(DEFAULT_COMPOSITION.ndf_pct.min);
  });

  it('THI > 78 → NFC max düşer, peNDF artar', () => {
    const heatStressed = { lactationStage: 'early', milkYield: 30, parity: 2, bcs: 3.0, thi: 82, milkFat: 3.5, milkProtein: 3.1 };
    const c = compositionForStage('early', heatStressed);
    expect(c.nfc_pct.max).toBeLessThan(DEFAULT_COMPOSITION.nfc_pct.max);
    expect(c.peNDF_pct.min).toBeGreaterThan(DEFAULT_COMPOSITION.peNDF_pct.min);
  });

  it('Düşük BCS (2.5) → NFC max artar (kilo aldırma)', () => {
    const thin = { lactationStage: 'early', milkYield: 30, parity: 2, bcs: 2.5, milkFat: 3.5, milkProtein: 3.1 };
    const c = compositionForStage('early', thin);
    expect(c.nfc_pct.max).toBeGreaterThan(DEFAULT_COMPOSITION.nfc_pct.max);
  });

  it('Süt yağı/protein < 1.1 (MFD belirtisi) → peNDF artar, NFC düşer', () => {
    const mfd = { lactationStage: 'early', milkYield: 30, parity: 2, bcs: 3.0, milkFat: 3.0, milkProtein: 3.2 };
    const c = compositionForStage('early', mfd);
    expect(c.peNDF_pct.min).toBeGreaterThan(DEFAULT_COMPOSITION.peNDF_pct.min);
    expect(c.nfc_pct.max).toBeLessThan(DEFAULT_COMPOSITION.nfc_pct.max);
  });

  it('Kuru dönem (far_off) → animal verilse de baz değişmez', () => {
    const dryCow = { lactationStage: 'far_off', milkYield: 0, parity: 3, bcs: 3.5, thi: 80 };
    const c = compositionForStage('far_off', dryCow);
    expect(c.dcad_meq.min).toBeGreaterThan(0); // far_off için pozitif DCAD
  });

  it('Tutarlılık: min ≤ max her zaman', () => {
    const extreme = { lactationStage: 'early', milkYield: 50, parity: 1, bcs: 2.5, thi: 85, milkFat: 2.8, milkProtein: 3.2 };
    const c = compositionForStage('early', extreme);
    if (c.nfc_pct?.min !== undefined && c.nfc_pct?.max !== undefined) {
      expect(c.nfc_pct.min).toBeLessThanOrEqual(c.nfc_pct.max);
    }
  });
});

describe('optimizeRation — laktasyon evresi entegrasyonu', () => {
  it('animal.lactationStage=late → düşük verim için feasible (FAZ 10A + FAZ 12)', async () => {
    const animal = { ...HOLSTEIN_HIGH_PRODUCER, dim: 250, milkYield: 18, lactationStage: 'late' };
    const r = await optimizeRation({ animal, feeds: FEEDS, feedLimits: DEFAULT_LIMITS });
    expect(r.feasible).toBe(true);
    // FAZ 12 Madde 7: CP artık default LP kısıtı değil — MP belirleyici
    // Late stage düşük verim → MP gereksinimi düşük, LP feasible olmalı
    expect(r.composition.mp_g).toBeGreaterThan(0);
  });
});

// ─── FAZ 13.8: Süt humması risk skoru entegrasyonu ──────────────────────────

describe('optimizeRation — süt humması risk notu (FAZ 13.8)', () => {
  it('result.milkFever { score, riskLevel, recommendations } döndürür', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.milkFever).toBeDefined();
    expect(typeof r.milkFever.score).toBe('number');
    expect(['low', 'moderate', 'high', 'very_high']).toContain(r.milkFever.riskLevel);
    expect(Array.isArray(r.milkFever.recommendations)).toBe(true);
  });

  it('geçiş dönemi (close_up, 3. parite) süt humması skoru hesaplanır', async () => {
    const closeUp = { ...HOLSTEIN_HIGH_PRODUCER, lactationStage: 'close_up', milkYield: 0, parity: 3 };
    const r = await optimizeRation({ animal: closeUp, feeds: FEEDS, feedLimits: DEFAULT_LIMITS });
    expect(r.milkFever).toBeDefined();
    // 3. parite riski + DCAD/Ca katkısı → skor pozitif
    expect(r.milkFever.score).toBeGreaterThan(0);
  });
});

// ─── FAZ 13.11 entegrasyon: su tüketimi sonuç pipeline'ında ────────────────

describe('optimizeRation — su tüketimi sonuçta raporlanır (FAZ 13.11)', () => {
  it('result.requirements.water { intakeL, level, notes } döndürür', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.requirements.water).toBeDefined();
    expect(r.requirements.water.intakeL).toBeGreaterThan(0);
    expect(Array.isArray(r.requirements.water.notes)).toBe(true);
  });
});

// ─── FAZ 14.2 entegrasyon: İz mineral LP kısıtları + graceful fallback ──────

describe('optimizeRation — iz mineral LP kısıtları (FAZ 14.2)', () => {
  it('yemler iz mineral içermiyorsa LP\'ye trace kısıt geçirilmez (graceful)', async () => {
    // FEEDS objelerinde zn/cu/mn/se/fe/i/co yok → buildTraceRequirement bunları atlar
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    // Diagnostics'te iz mineral satırı OLMAMALI (kısıt eklenmediğinden)
    const traceDiag = r.diagnostics.filter(d => /\((Zn|Cu|Mn|Se|Fe|I|Co) \(mg\/gün\)/.test(d.name));
    expect(traceDiag).toHaveLength(0);
  });

  it('iz mineral içeren yemlerle çalışınca diagnostics\'te trace satırları görünür', async () => {
    // FEEDS'e iz mineral değerleri ekleyerek genişletilmiş set
    const enrichedFeeds = FEEDS.map(f => {
      if (f.category === 'roughage' || f.category === 'grain' || f.category === 'protein') {
        return { ...f, zn: 30, cu: 8, mn: 35, se: 0.1, fe: 200, i: 0.15, co: 0.15 };
      }
      return f;
    });
    // Mineral premix yemi ekle (ticari iz mineral premikslerine yakın değerler)
    enrichedFeeds.push({
      id: 'trace_premix', name: 'İz Mineral Premiks', category: 'mineral',
      dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
      ca: 12, p: 0, mg: 0, k: 0, na: 0, s: 0, cl: 0,
      zn: 12000, cu: 2500, mn: 6000, se: 100, fe: 4500, i: 120, co: 50,
      pricePerTon: 40000,
    });
    const limitsWithPremix = { ...DEFAULT_LIMITS, trace_premix: { maxPct: 1.0 } };
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: enrichedFeeds, feedLimits: limitsWithPremix,
    });
    expect(r.feasible).toBe(true);
    // Diagnostics 7 iz mineral satırı içermeli
    const traceNames = r.diagnostics.map(d => d.name).filter(n => /^(Zn|Cu|Mn|Se|Fe|I|Co) \(mg\/gün\)$/.test(n));
    expect(traceNames).toEqual(['Zn (mg/gün)', 'Cu (mg/gün)', 'Mn (mg/gün)', 'Se (mg/gün)', 'Fe (mg/gün)', 'I (mg/gün)', 'Co (mg/gün)']);
    // Composition iz mineral değerleri pozitif
    expect(r.composition.zn_mg).toBeGreaterThan(0);
    expect(r.composition.cu_mg).toBeGreaterThan(0);
  });

  it('user-override composition.traceMinerals önceliklidir', async () => {
    const enrichedFeeds = FEEDS.map(f => ({ ...f, zn: 30, cu: 8, mn: 35, se: 0.1, fe: 200, i: 0.15, co: 0.15 }));
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: enrichedFeeds, feedLimits: DEFAULT_LIMITS,
      composition: { traceMinerals: { zn: { min: 1 } } },  // çok düşük min
    });
    // composition override LP'ye 1 mg/gün geçti → Zn diag.min = 1
    const znDiag = r.diagnostics.find(d => d.name === 'Zn (mg/gün)');
    expect(znDiag).toBeDefined();
    expect(znDiag.min).toBe(1);
  });
});

// ─── FAZ 14.3 entegrasyon: Vitamin LP kısıtları (Vit A/D/E) ────────────────

describe('optimizeRation — vitamin LP kısıtları (FAZ 14.3)', () => {
  it('yemler vitamin içermiyorsa LP\'ye vit kısıtı geçirilmez (graceful)', async () => {
    // FEEDS objelerinde vitA/vitD/vitE/bcarotene yok → buildVitaminRequirement atlar
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    const vitDiag = r.diagnostics.filter(d => /^Vit [ADE] \(IU\/gün\)$/.test(d.name));
    expect(vitDiag).toHaveLength(0);
  });

  it('vitamin premiks ile feasible + diagnostics 3 satır + β-karoten Vit A\'ya katkı sağlar', async () => {
    // Vit E doğal yağda var; Vit A/D premikse bağımlı → premix ekle
    const enrichedFeeds = FEEDS.map(f => {
      if (f.category === 'roughage') return { ...f, vitE: 60, bcarotene: 80 };
      return f;
    });
    enrichedFeeds.push({
      id: 'vit_premix_test', name: 'Vit Premiks', category: 'mineral',
      dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
      ca: 15, p: 0, mg: 0, k: 0, na: 0, s: 0, cl: 0,
      vitA: 800000, vitD: 400000, vitE: 8000, bcarotene: 200,
      pricePerTon: 55000,
    });
    const limitsWithPremix = { ...DEFAULT_LIMITS, vit_premix_test: { maxPct: 0.5 } };
    // Vit A max'ı esnetilir — NASEM 2021 max (150 IU/kg BW) konservatif; gerçek toksisite çok yüksek
    // ve forage β-karoten bunu sıkça aşar. Test feasibility için max yumuşatılır.
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: enrichedFeeds, feedLimits: limitsWithPremix,
      composition: { vitamins: { vitA: { min: 60000, max: 600000 } } },
    });
    expect(r.feasible).toBe(true);
    const vitNames = r.diagnostics.map(d => d.name).filter(n => /^Vit [ADE] \(IU\/gün\)$/.test(n));
    expect(vitNames).toEqual(['Vit A (IU/gün)', 'Vit D (IU/gün)', 'Vit E (IU/gün)']);
    // Vit A diag.value β-karoten katkısı dahil edilmiş olmalı (composition.vitA_IU + bcarotene_mg × 200)
    const vitADiag = r.diagnostics.find(d => d.name === 'Vit A (IU/gün)');
    const baseVitA = r.composition.vitA_IU || 0;
    const bcaroteneIU = (r.composition.bcarotene_mg || 0) * 200;
    expect(vitADiag.value).toBeCloseTo(baseVitA + bcaroteneIU, -2);  // ±100 IU yuvarlama
    expect(bcaroteneIU).toBeGreaterThan(0);
  });

  it('#1/#16: Vit A MAX default uygulanmaz — β-karoten zengin yem fizibiliteyi bozmaz', async () => {
    // Kaba yeme YÜKSEK β-karoten (Vit A önerilen tavanını aşar) + Vit A/D/E premiks
    const enriched = FEEDS.map(f => f.category === 'roughage' ? { ...f, vitE: 60, bcarotene: 300 } : f);
    enriched.push({
      id: 'vit_premix_hi', name: 'Vit Premiks', category: 'mineral',
      dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
      ca: 15, p: 0, mg: 0, k: 0, na: 0, s: 0, cl: 0,
      vitA: 800000, vitD: 400000, vitE: 8000, pricePerTon: 55000,
    });
    const limits = { ...DEFAULT_LIMITS, vit_premix_hi: { maxPct: 0.5 } };
    // composition.vitamins override YOK → default MAX uygulanmamalı (yalnız min)
    const r = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: enriched, feedLimits: limits });
    expect(r.feasible).toBe(true);                       // Vit A max'ı SAHTE infeasibility yaratmaz
    const vitA = r.diagnostics.find(d => d.name === 'Vit A (IU/gün)');
    expect(vitA).toBeDefined();
    expect(vitA.max).toBeUndefined();                    // default'ta üst sınır yok
    expect(vitA.status).not.toBe('above');               // 'above' ile cezalandırılmaz
  });
});

// ─── Denetim bulgusu: kaynaksız besin şeffaflığı (missingSources) ──────────

describe('optimizeRation — kaynaksız besin uyarısı (missingSources)', () => {
  it('yem setinde vitamin/iz mineral kaynağı yoksa missingSources raporlar', async () => {
    // FEEDS hiç vitA/vitD/vitE veya iz mineral içermez → kaynaksız olarak işaretlenmeli
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(Array.isArray(r.missingSources)).toBe(true);
    const keys = r.missingSources.map(m => m.key);
    expect(keys).toContain('vitA');           // Vit A kaynağı yok → uyarıda
    for (const m of r.missingSources) {        // her kayıt label + type taşır
      expect(typeof m.label).toBe('string');
      expect(['trace', 'vitamin']).toContain(m.type);
    }
  });

  it('yem seti kaynağı sağlıyorsa o besin missingSources\'ta YER ALMAZ', async () => {
    const enriched = FEEDS.map(f => ({ ...f, zn: 40, cu: 12, mn: 35, se: 0.3, fe: 200, i: 0.5, co: 0.2 }));
    enriched.push({
      id: 'vit_src', name: 'Vit Premiks', category: 'mineral',
      dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
      ca: 0, p: 0, mg: 0, k: 0, na: 0, s: 0, cl: 0,
      vitA: 800000, vitD: 400000, vitE: 8000, pricePerTon: 50000,
    });
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: enriched,
      feedLimits: { ...DEFAULT_LIMITS, vit_src: { maxPct: 0.5 } },
    });
    const keys = r.missingSources.map(m => m.key);
    expect(keys).not.toContain('zn');          // Zn kaynağı var
    expect(keys).not.toContain('vitA');        // Vit A kaynağı var
  });
});

// ─── #4: TMR taze (yaş) kg + nem hesabı + nem hedefi ───────────────────────

describe('optimizeRation — TMR nem/taze kg (#4)', () => {
  it('composition asFed_kg + dm_pct + moisture_pct hesaplar (yaş > kuru)', async () => {
    const r = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS });
    expect(r.composition.asFed_kg).toBeGreaterThan(r.dmi.achieved_kg);  // yaş ağırlık > kuru madde
    expect(r.composition.dm_pct + r.composition.moisture_pct).toBeCloseTo(100, 0);
    expect(r.composition.moisture_pct).toBeGreaterThan(0);
  });

  it('nem hedefi konunca rasyon DM% bandında kalır + teşhiste TMR Nem satırı', async () => {
    // Nem %45-55 → DM %45-55. (DEFAULT_LIMITS'te silaj zaten var; band korunmalı.)
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { tmr_moisture_pct: { min: 45, max: 55 } },
    });
    expect(r.diagnostics.some(d => d.name === 'TMR Nem (%)')).toBe(true);
    if (r.feasible) {
      // band: DM %45-55 (yuvarlama toleransı ±1.5)
      expect(r.composition.dm_pct).toBeGreaterThanOrEqual(43.5);
      expect(r.composition.dm_pct).toBeLessThanOrEqual(56.5);
    }
  });

  it('PROBLEMLER #3: hedef nem + rasyondan min nem → su hesabı (rasyon + su = final nem)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { tmr_target_moisture: 50, tmr_min_ration_moisture: 30 },
    });
    const c = r.composition;
    expect(c.tmr_target_moisture).toBe(50);
    expect(Number.isFinite(c.tmr_water_add_kg)).toBe(true);
    // rasyondan + su ile (açık) = final nem (kütle dengesi)
    expect(c.tmr_ration_moisture_pct + c.tmr_water_moisture_pct).toBeCloseTo(c.tmr_final_moisture_pct, 0);
    if (c.tmr_water_add_kg > 0) {
      expect(c.tmr_final_moisture_pct).toBeCloseTo(50, 0);                       // su eklendiyse hedefe ulaşır
      expect(c.tmr_final_mass_kg).toBeCloseTo(c.asFed_kg + c.tmr_water_add_kg, 1); // toplam = taze + su
    }
  });

  it('PROBLEMLER #3: hedef nem yoksa su hesabı alanları eklenmez (geriye uyumlu)', async () => {
    const r = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS });
    expect(r.composition.tmr_target_moisture).toBeUndefined();
    expect(r.composition.tmr_water_add_kg).toBeUndefined();
  });
});

// ─── #1: makro mineral / RUP / AA kullanıcı override ───────────────────────

describe('optimizeRation — makro mineral override (#1)', () => {
  it('composition.ca {min,max} makro mineral bandını LP + teşhise geçirir', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { ca: { min: 60, max: 250 } },
    });
    const caDiag = r.diagnostics.find(d => d.name === 'Ca (g/gün)');
    expect(caDiag).toBeDefined();
    expect(caDiag.min).toBe(60);
    expect(caDiag.max).toBe(250);
  });

  it('makro mineral override YOKSA eski davranış (yalnız hesaplanan min)', async () => {
    const r = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS });
    const caDiag = r.diagnostics.find(d => d.name === 'Ca (g/gün)');
    expect(caDiag).toBeDefined();
    expect(caDiag.max).toBeUndefined();   // üst sınır yok (eski davranış)
    expect(caDiag.min).toBeGreaterThan(0);
  });
});

// ─── FAZ 14.4 entegrasyon: Lys/Met LP kısıtları + tutarlılık ───────────────

describe('optimizeRation — amino asit LP kısıtları (FAZ 14.4)', () => {
  it('requirements.aminoAcids LP\'ye geçer (lys_g/met_g min)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const aa = r.requirements.compositionTargets.aminoAcids;
    expect(aa).toBeDefined();
    expect(aa.lys_g.min).toBeGreaterThan(0);
    expect(aa.met_g.min).toBeGreaterThan(0);
  });

  it('Tam EAA Katman B: leu_g override → Leu LP kısıtı (opt-in); override yokken oluşmaz', async () => {
    // Override YOK → 7 EAA kısıtı eklenmez (varsayılan floor yok — gösterim odaklı)
    const base = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS, _returnPrep: true,
    });
    const baseNames = base.lp.subjectTo.map(c => c.name);
    expect(baseNames).not.toContain('Leu');
    expect(baseNames).toContain('Lys');   // Lys/Met/His varsayılan floor korunur
    // leu_g override → Leu kısıtı (LO, lb=override) uçtan uca (composition→buildAA→aaMap→LP)
    const over = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { aminoAcids: { leu_g: { min: 150 } } }, _returnPrep: true,
    });
    const leuC = over.lp.subjectTo.find(c => c.name === 'Leu');
    expect(leuC).toBeDefined();
    expect(leuC.bnds.lb).toBe(150);
  });

  it('composition.lys_g/met_g, AA paneli supply ile BİREBİR tutarlı (çift sayım fix)', async () => {
    // FAZ 14.4 kalbi: LP coefficient (aaPerKgDM) = post-hoc rapor (computeAminoAcids)
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.composition.lys_g).toBeCloseTo(r.aminoAcids.supply.lys.total_g, 1);
    expect(r.composition.met_g).toBeCloseTo(r.aminoAcids.supply.met.total_g, 1);
  });

  it('diagnostics\'te Lys/Met satırları görünür', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const names = r.diagnostics.map(d => d.name);
    expect(names).toContain('Lys (g/gün)');
    expect(names).toContain('Met (g/gün)');
  });

  it('düşük-Met yem setiyle Met kısıtı infeasible yapar (plan §14.4)', async () => {
    // Gerçek soya Met %1.38 düşük; yüksek hedefle Met sınırlayıcı olur
    const lowMetFeeds = FEEDS.map(f =>
      f.id === 'soybean_meal' ? { ...f, lys: 6.2, met: 1.0 } : f);  // çok düşük Met
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: lowMetFeeds, feedLimits: DEFAULT_LIMITS,
      composition: { aminoAcids: { met_g: { min: 70 } } },  // yüksek Met hedefi
    });
    // Met karşılanamaz → infeasible
    expect(r.feasible).toBe(false);
  });

  it('RP-Met yemi eklenince Met kısıtı feasible olur (RPMet çözümü)', async () => {
    // Rumen korumalı Met (yüksek met%, yüksek RUP, yüksek IntD) → Met açığını kapatır
    const feedsWithRPMet = [
      ...FEEDS,
      {
        id: 'rp_met', name: 'Rumen Korumalı Metiyonin', category: 'protein',
        dm: 95, nel: 1.0, cp: 70, rup: 90, rdp: 10, tdn: 80, rupIntD: 90,
        ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 5,
        ca: 0, p: 0, mg: 0, k: 0, na: 0, s: 0, cl: 0,
        lys: 1, met: 50, pricePerTon: 200000
      },  // çok yüksek Met
    ];
    const limits = { ...DEFAULT_LIMITS, rp_met: { maxPct: 2 } };
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: feedsWithRPMet, feedLimits: limits,
      composition: { aminoAcids: { met_g: { min: 60 } } },
    });
    expect(r.feasible).toBe(true);
    // RP-Met çözüme dahil edilmiş olmalı
    const rpMetItem = r.items.find(it => it.id === 'rp_met');
    expect(rpMetItem).toBeDefined();
    expect(rpMetItem.dmKg).toBeGreaterThan(0);
  });
});

// ─── FAZ 14.5 entegrasyon: RDP min/max LP kısıtı ───────────────────────────

describe('optimizeRation — RDP LP kısıtı (FAZ 14.5)', () => {
  it('default laktasyon rasyonunda RDP min kısıtı LP\'ye geçer + diagnostics satırı', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    // requirements'ta rdp_pct min %9 (laktasyon default)
    expect(r.requirements.compositionTargets.rdp_pct).toBeDefined();
    expect(r.requirements.compositionTargets.rdp_pct.min).toBe(9);
    // diagnostics'te RDP satırı, değer min'in üstünde
    const rdpDiag = r.diagnostics.find(d => d.name === 'RDP (%KM)');
    expect(rdpDiag).toBeDefined();
    expect(rdpDiag.value).toBeGreaterThanOrEqual(9);
    expect(rdpDiag.status).toBe('ok');
  });

  it('composition.rdp_pct, rdp_g ile tutarlı (rdp_g / target_dmi / 10)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    // rdp_pct, aggregateComposition'da target DMI (dmi.dmi) bazında hesaplanır
    const expected = r.composition.rdp_g / r.dmi.target_kg / 10;
    expect(r.composition.rdp_pct).toBeCloseTo(expected, 1);
  });

  it('kullanıcı RDP max override edebilir (composition.rdp_pct)', async () => {
    // Çok düşük RDP max → yüksek-RDP yem setiyle infeasible
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { rdp_pct: { min: 9, max: 10 } },  // test FEEDS RDP ~13-15 → max 10 aşılır
    });
    expect(r.feasible).toBe(false);
  });
});

// ─── FAZ 14.6 entegrasyon: Starch/Sugar/Fat max LP kısıtları ───────────────

describe('optimizeRation — Starch/Sugar/Fat max kısıtları (FAZ 14.6)', () => {
  it('default laktasyon rasyonunda 3 üst sınır LP\'ye geçer + diagnostics satırları', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    const ct = r.requirements.compositionTargets;
    expect(ct.starch_pct.max).toBe(28);
    expect(ct.sugar_pct.max).toBe(8);
    expect(ct.fat_pct.max).toBe(7);
    const names = r.diagnostics.map(d => d.name);
    expect(names).toContain('Nişasta (%KM)');
    expect(names).toContain('Şeker (%KM)');
    expect(names).toContain('Yağ (%KM)');
  });

  it('çok düşük Fat max ile infeasible olur (rumen lif sindirimi koruması)', async () => {
    // Temel yemler fat %2-4 (silaj 3.3, mısır 4); fat-sız yalnız mineraller.
    // Fat max %2 → enerji/protein için forage+grain zorunlu → fat>2 kaçınılmaz → infeasible.
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { fat_pct: { max: 2 } },
    });
    expect(r.feasible).toBe(false);
  });
});

// ─── FAZ 14.7 entegrasyon: Yem grup kısıtları ──────────────────────────────

describe('optimizeRation — yem grup kısıtları (FAZ 14.7)', () => {
  it('groupLimits passthrough — protein max kg toplam soyayı sınırlar', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      groupLimits: { protein: { max: 1.5 } },  // toplam protein konsantresi ≤ 1.5 kg KM
    });
    if (r.feasible) {
      // protein kategorisi yemlerinin (soybean_meal) toplam KM'si ≤ 1.5
      const proteinKg = r.items.filter(it => it.category === 'protein')
        .reduce((s, it) => s + it.dmKg, 0);
      expect(proteinKg).toBeLessThanOrEqual(1.5 + 0.05);
    }
  });

  it('roughage min kg toplam kaba yemi zorunlu kılar', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      groupLimits: { roughage: { min: 10 } },  // en az 10 kg KM kaba yem
    });
    if (r.feasible) {
      const roughageKg = r.items.filter(it => it.category === 'roughage')
        .reduce((s, it) => s + it.dmKg, 0);
      expect(roughageKg).toBeGreaterThanOrEqual(10 - 0.05);
    }
  });
});

// ─── FAZ 14.10 entegrasyon: PUFA / ω6:ω3 LP kısıtları ──────────────────────

describe('optimizeRation — PUFA / ω6:ω3 kısıtları (FAZ 14.10)', () => {
  it('default laktasyon rasyonunda PUFA max LP\'ye geçer + diagnostics satırı', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.requirements.compositionTargets.pufa_pct.max).toBe(5);
    const names = r.diagnostics.map(d => d.name);
    expect(names).toContain('PUFA (%KM)');
    // composition.pufa_pct hesaplanmış (faCoefPerKgDM ile)
    expect(r.composition.pufa_pct).toBeGreaterThanOrEqual(0);
  });

  it('composition.n6n3_ratio = omega6/omega3 tutarlı', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    if (r.composition.omega3_pct > 0) {
      const expected = r.composition.omega6_pct / r.composition.omega3_pct;
      expect(r.composition.n6n3_ratio).toBeCloseTo(expected, 1);
    }
  });

  it('düşük PUFA max ile yağlı yem infeasible/gevşetilir (MFD koruması)', async () => {
    // Yüksek yağlı yem (tam soya benzeri) zorunlu + çok düşük PUFA max
    const fattyFeeds = FEEDS.map(f =>
      f.id === 'soybean_meal'
        ? { ...f, fat: 18, faProfile: { c16_0: 11, c18_0: 4, c18_1: 23, c18_2: 53, c18_3: 9 } }
        : f);
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: fattyFeeds,
      feedLimits: { ...DEFAULT_LIMITS, soybean_meal: { minPct: 20, maxPct: 25 } },  // yüksek-yağ zorunlu
      composition: { pufa_pct: { max: 1.5 } },  // çok düşük PUFA tavanı
    });
    // PUFA aşılır → feasible değil (relax gevşetebilir ama trulyFeasible false)
    expect(r.feasible).toBe(false);
  });
});

// ─── FAZ 14 denetimi: yuvarlama toleransı (feasible çözümde yanlış below/above yok) ───

describe('optimizeRation — feasible çözümde yuvarlama artefaktı below/above yapmaz', () => {
  it('tam-özellikli feasible rasyonda her diagnostics gerçek durum (round artefaktı değil)', async () => {
    // items.dmKg round(4) yuvarlaması, composition değerini kısıt sınırının mikroskobik
    // altına/üstüne taşıyabilir → FAZ 14 denetiminde %0.1 tolerans eklendi.
    const r = await optimizeRation({
      animal: { ...HOLSTEIN_HIGH_PRODUCER, milkYield: 28 },
      feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    if (r.feasible) {
      // Feasible çözümde her 'below'/'above' GERÇEK ihlal olmalı (>%0.5 sapma), yuvarlama değil
      for (const d of r.diagnostics) {
        if (d.status === 'below' && d.min !== undefined) {
          expect(d.value).toBeLessThan(d.min * 0.995);  // gerçek ihlal (yuvarlama değil)
        }
        if (d.status === 'above' && d.max !== undefined) {
          expect(d.value).toBeGreaterThan(d.max * 1.005);
        }
      }
    }
  });
});

// ─── FAZ 14.13 entegrasyon: NEL max default + maliyet üst sınırı ───────────

describe('optimizeRation — NEL max default + maliyet tavanı (FAZ 14.13)', () => {
  it('NEL max default = gereksinim × 1.10 (user override yoksa)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const ct = r.requirements.compositionTargets;
    expect(ct.nel_mcal_max).toBeCloseTo(ct.nel_mcal * 1.10, 1);
    // diagnostics NEL satırı max içerir
    const nelDiag = r.diagnostics.find(d => d.name === 'NEL (Mcal/gün)');
    expect(nelDiag.max).toBeCloseTo(ct.nel_mcal * 1.10, 1);
  });

  it('user composition.nel_mcal.max degeri override eder', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      composition: { nel_mcal: { max: 100 } },
    });
    expect(r.requirements.compositionTargets.nel_mcal_max).toBe(100);
  });

  it('costMax passthrough → çok düşük tavan infeasible yapar', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      costMax: 1,  // 1 TL/gün imkansız
    });
    expect(r.feasible).toBe(false);
  });
});

// ─── FAZ 5A: Amino Asit hesabı ────────────────────────────────────────────────

describe('optimizeRation — amino asit paneli (FAZ 5A)', () => {
  it('aminoAcids alanı protein yemli rasyonda tanımlı', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.aminoAcids).not.toBeNull();
    expect(r.aminoAcids.supply.lys.total_g).toBeGreaterThan(0);
    expect(r.aminoAcids.supply.met.total_g).toBeGreaterThan(0);
    expect(r.aminoAcids.requirement.lys_g).toBeGreaterThan(0);
    expect(r.aminoAcids.assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.aminoAcids.assessment.overallScore).toBeLessThanOrEqual(100);
  });

  it('FAZ 24.4: AA mikrobiyal tedariği rasyon-düzeyi MP_Microbial ile aynı bazdadır (discount ve min E/R uyumlu)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS, autoEnergyDiscount: true
    });
    // MP Panelindeki mikrobiyal MP, aminoAcids.supply.mpTotal_g ile uyumlu olmalıdır (Math.round() farklılıkları hariç)
    expect(Math.abs(r.aminoAcids.supply.mpTotal_g - Math.round(r.composition.mp_g))).toBeLessThanOrEqual(1);
  });

  it('Lys/Met assessment status değerleri geçerli', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const validStatuses = ['optimal', 'marginal', 'deficient', 'excess'];
    expect(validStatuses).toContain(r.aminoAcids.assessment.lys.status);
    expect(validStatuses).toContain(r.aminoAcids.assessment.met.status);
  });

  it('Lys:Met oranı sayısal', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(typeof r.aminoAcids.assessment.ratio.actual).toBe('number');
    expect(r.aminoAcids.assessment.ratio.actual).toBeGreaterThan(0);
  });

  it('eksik AA durumunda recommendations dizisi dolu', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(Array.isArray(r.aminoAcids.recommendations)).toBe(true);
    // Her öneride deficitG ve type olmalı
    for (const rec of r.aminoAcids.recommendations) {
      expect(rec.type).toMatch(/^RP(Met|Lys)$/);
      expect(rec.deficitG).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── FAZ 16.2: Enterik metan entegrasyonu (result.methane) ────────────────────
describe('optimizeRation — enterik metan (FAZ 16.2)', () => {
  it('result.methane tam yapıda döner', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.methane).toBeDefined();
    for (const k of ['production_g', 'moraes_g', 'niu_g', 'yield_g_per_kg_dmi',
      'intensity_g_per_kg_milk', 'co2eq_kg_day', 'energyLossMcal', 'interpretation']) {
      expect(r.methane).toHaveProperty(k);
    }
    expect(r.methane.interpretation).toHaveProperty('level');
  });

  it('CH₄ üretimi gerçekçi aralıkta (yield IPCC Tier 2 ~15-22 g/kg KMT)', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.methane.production_g).toBeGreaterThan(250);
    expect(r.methane.production_g).toBeLessThan(500);
    expect(r.methane.yield_g_per_kg_dmi).toBeGreaterThan(14);
    expect(r.methane.yield_g_per_kg_dmi).toBeLessThan(23);
  });

  it('production_g = Moraes (birincil); niu_g ayrı alternatif', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.methane.production_g).toBe(r.methane.moraes_g);
    expect(r.methane.niu_g).toBeGreaterThan(0);
  });

  it('CO₂eq = CH₄ × 28 / 1000 (GWP100) ve enerji kaybı tutarlı', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.methane.co2eq_kg_day).toBeCloseTo(r.methane.production_g * 28 / 1000, 1);
    expect(r.methane.energyLossMcal).toBeCloseTo(r.methane.production_g / 1000 * 13.30, 1);
  });

  it('yoğunluk = CH₄ / süt; yüksek verimde "tipik/düşük" seviye', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.methane.intensity_g_per_kg_milk)
      .toBeCloseTo(r.methane.production_g / HOLSTEIN_HIGH_PRODUCER.milkYield, 1);
    expect(['low', 'normal']).toContain(r.methane.interpretation.level);
  });
});

// ─── FAZ 16.3: CNCPS v6.5 alt fraksiyon entegrasyonu (result.cncpsSubFractions) ─
describe('optimizeRation — CNCPS v6.5 alt fraksiyonlar (FAZ 16.3)', () => {
  it('result.cncpsSubFractions cho (8) + protein (6) havuzlarıyla döner', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.cncpsSubFractions).toBeTruthy();
    for (const k of ['cA1', 'cA2', 'cA3', 'cA4', 'cB1', 'cB2', 'cB3', 'cC']) {
      expect(r.cncpsSubFractions.cho).toHaveProperty(k);
    }
    for (const k of ['pA1', 'pA2', 'pB1', 'pB2', 'pB3', 'pC']) {
      expect(r.cncpsSubFractions.protein).toHaveProperty(k);
    }
  });

  it('protein havuzları ≈ 100% HP; CHO havuzları pozitif', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const p = r.cncpsSubFractions.protein;
    const sum = p.pA1 + p.pA2 + p.pB1 + p.pB2 + p.pB3 + p.pC;
    expect(sum).toBeCloseTo(100, 0);
    const cho = r.cncpsSubFractions.cho;
    expect(cho.cB1 + cho.cB3).toBeGreaterThan(0);  // nişasta + sind. NDF
  });
});

// ─── FAZ 16.4: Nişasta rumen/bağırsak sindirimi (result.starchDigestion) ───────
describe('optimizeRation — nişasta sindirimi (FAZ 16.4)', () => {
  it('result.starchDigestion tam yapıda döner', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.starchDigestion).toBeTruthy();
    for (const k of ['starch_g', 'rumenStarch_g', 'intestinalStarch_g', 'fecalStarch_g',
      'starch_pct', 'rumenStarch_pct', 'rsd', 'totalTract', 'interpretation']) {
      expect(r.starchDigestion).toHaveProperty(k);
    }
    expect(r.starchDigestion.interpretation).toHaveProperty('level');
  });

  it('rumen + bağırsak + dışkı = toplam nişasta; oranlar 0-1', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    const sd = r.starchDigestion;
    expect(sd.rumenStarch_g + sd.intestinalStarch_g + sd.fecalStarch_g).toBeCloseTo(sd.starch_g, 0);
    expect(sd.rsd).toBeGreaterThanOrEqual(0);
    expect(sd.rsd).toBeLessThanOrEqual(1);
    expect(sd.rumenStarch_pct).toBeLessThanOrEqual(sd.starch_pct + 0.01);
  });

  it('yem işleme tipi result.starchDigestion\'a uçtan uca yansır (steam-flaked > whole RSD)', async () => {
    // corn_grain'e starch + işleme tipi ekle (FEEDS'te corn_grain'de starch yok → ekle)
    const withProc = (proc) => FEEDS.map(f =>
      f.id === 'corn_grain' ? { ...f, starch: 70, starchProcessing: proc } : f);
    const flaked = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: withProc('steamFlaked'), feedLimits: DEFAULT_LIMITS });
    const whole = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: withProc('whole'), feedLimits: DEFAULT_LIMITS });
    // İşleme tipi RSD'yi etkilemeli (steam-flaked rumende daha çok fermente)
    expect(flaked.starchDigestion.rsd).toBeGreaterThan(whole.starchDigestion.rsd);
  });
});

// ─── FAZ 16.6: Mikotoksin + silaj kalitesi (result.mycotoxinRisk/silageQuality) ─
describe('optimizeRation — mikotoksin + silaj kalitesi (FAZ 16.6)', () => {
  it('lab verisi yokken mycotoxinRisk anyData=false (na)', async () => {
    const r = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS });
    expect(r.mycotoxinRisk).toBeTruthy();
    expect(r.mycotoxinRisk.anyData).toBe(false);
    expect(r.mycotoxinRisk.interpretation.level).toBe('na');
    expect(r.silageQuality).toBeTruthy();
    expect(r.silageQuality.anyData).toBe(false);  // FEEDS'te silaj fermentasyon verisi yok
  });

  it('aflatoksinli yem → result.mycotoxinRisk uçtan uca danger', async () => {
    const contaminated = FEEDS.map(f => f.id === 'corn_silage' ? { ...f, aflatoxinB1: 15 } : f);
    const r = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: contaminated, feedLimits: DEFAULT_LIMITS });
    expect(r.mycotoxinRisk.anyData).toBe(true);
    expect(r.mycotoxinRisk.toxins.aflatoxinB1.value).toBeGreaterThan(0);
    expect(['warning', 'danger']).toContain(r.mycotoxinRisk.overall);
  });

  it('silaj fermentasyon verili yem → result.silageQuality skoru döner', async () => {
    const withFerment = FEEDS.map(f => f.id === 'corn_silage'
      ? { ...f, silagePH: 3.8, silageLacticAcid: 6, silageAceticAcid: 2, silageButyricAcid: 0.05, silageNH3N: 6 } : f);
    const r = await optimizeRation({ animal: HOLSTEIN_HIGH_PRODUCER, feeds: withFerment, feedLimits: DEFAULT_LIMITS });
    expect(r.silageQuality.anyData).toBe(true);
    expect(r.silageQuality.items[0].score).toBeGreaterThanOrEqual(85);  // iyi fermente
  });
});

// ─── FAZ 16.1: INRA 2018 sistemi entegrasyonu (result.inra) ──────────────────────
describe('optimizeRation — INRA 2018 entegrasyonu (FAZ 16.1)', () => {
  it('settings.system INRA2018 ise result.inra tam yapıda döner', async () => {
    // LP çözümü için INRA'yı sisteme geçiriyoruz
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
      system: 'INRA2018',
    });
    expect(r.inra).toBeDefined();
    for (const k of ['supply', 'requirements', 'balance']) {
      expect(r.inra).toHaveProperty(k);
    }
    for (const k of ['ufl', 'pdie_g', 'pdin_g', 'uel', 'perKgDM']) {
      expect(r.inra.supply).toHaveProperty(k);
    }
    expect(r.inra.balance).toHaveProperty('limitingFactor');
  });

  it('settings.system NASEM2021 (default) ise result.inra dönmez', async () => {
    const r = await optimizeRation({
      animal: HOLSTEIN_HIGH_PRODUCER, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.inra).toBeUndefined(); // Sadece INRA2018 sisteminde hesaplanır
  });
});
