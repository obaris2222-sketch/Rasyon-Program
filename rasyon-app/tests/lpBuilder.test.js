/**
 * lpBuilder.js — LP problem yapı testleri (saf, solver çağırmadan)
 */

import { describe, it, expect } from 'vitest';
import { buildRationLP, dcadCoefPerKgDM, GLP, mpPerKgDM, mpComponentsPerKgDM, aaPerKgDM, effectiveNel, TRACE_MINERAL_KEYS, VITAMIN_KEYS, BCAROTENE_TO_VITA_IU_PER_MG } from '../src/solver/lpBuilder.js';
import { feedIntakeDiscountFactor } from '../src/core/nrc2001.js';
import { faCoefPerKgDM } from '../src/core/fattyAcids.js';
import { solveLP } from '../src/solver/glpkSolver.js';  // FAZ 14.11: MILP gerçek çözüm testleri

const SAMPLE_FEEDS = [
  { id: 'silage',  category: 'roughage', dm: 33, tdn: 68, nel: 1.72, cp: 8.2, ndf: 44, adf: 27,
    aNDF: 42, nfc: 36, fat: 3.3, ash: 4.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05,
    na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
  { id: 'alfalfa', category: 'roughage', dm: 89, tdn: 60, nel: 1.30, cp: 18,  ndf: 42, adf: 32,
    aNDF: 39, nfc: 25, fat: 2, ash: 11, ca: 1.45, p: 0.30, mg: 0.32, k: 2.50,
    na: 0.10, s: 0.27, cl: 0.40, pricePerTon: 6000 },
  { id: 'grain',   category: 'grain', dm: 88, tdn: 88, nel: 2.0, cp: 9,  ndf: 10, adf: 3,
    aNDF: 8, nfc: 74, fat: 4, ash: 1.4, ca: 0.02, p: 0.28, mg: 0.10, k: 0.38,
    na: 0.01, s: 0.10, cl: 0.05, pricePerTon: 9000 },
];

describe('buildRationLP — temel yapı', () => {
  it('feeds boşsa hata fırlatır', () => {
    expect(() => buildRationLP({ feeds: [], dmi_kg: 20 })).toThrow();
  });

  it('dmi_kg ≤ 0 ise hata fırlatır', () => {
    expect(() => buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 0 })).toThrow();
    expect(() => buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: -1 })).toThrow();
  });

  it('amaç MIN yönünde', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22 });
    expect(lp.objective.direction).toBe(GLP.MIN);
  });

  it('her yem için bir değişken oluşur', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22 });
    expect(lp.objective.vars.length).toBe(SAMPLE_FEEDS.length);
  });

  it('#4: TMR DM% hedefi iki lineer kısıt üretir (coef = 1 − sınır/dm; ıslak yem negatif)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: { tmr_dm_pct: { min: 45, max: 55 } } });
    const dmMin = lp.subjectTo.find(c => c.name === 'TMR_DM_min');
    const dmMax = lp.subjectTo.find(c => c.name === 'TMR_DM_max');
    expect(dmMin).toBeDefined();
    expect(dmMax).toBeDefined();
    // silage dm=33, alfalfa dm=89 (SAMPLE_FEEDS sırası: silage, alfalfa, grain)
    expect(dmMin.vars[0].coef).toBeCloseTo(1 - 45 / 33, 3);
    expect(dmMin.vars[1].coef).toBeCloseTo(1 - 45 / 89, 3);
    expect(dmMax.vars[0].coef).toBeCloseTo(1 - 55 / 33, 3);
    expect(dmMin.bnds.lb).toBe(0);   // Σ … ≥ 0
    expect(dmMax.bnds.ub).toBe(0);   // Σ … ≤ 0
    // ıslak yem (silage) DM_max'ta NEGATİF katsayı → kısıtı sağlar → LP silaj eklemeye itilir
    expect(dmMax.vars[0].coef).toBeLessThan(0);
    // kuru yem (alfalfa) POZİTİF → kısıtı zorlaştırır (aşırı kuru yem engellenir)
    expect(dmMax.vars[1].coef).toBeGreaterThan(0);
  });

  it('#4: tmr_dm_pct verilmezse TMR kısıtı eklenmez (geriye uyumluluk)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22 });
    expect(lp.subjectTo.find(c => c.name === 'TMR_DM_min')).toBeUndefined();
    expect(lp.subjectTo.find(c => c.name === 'TMR_DM_max')).toBeUndefined();
  });

  it('PROBLEMLER #3: rasyondan-min-nem lineer kısıt (coef = (100−dm)/dm − M/(100−T))', () => {
    // T=50, M=30 → thr=0.6; silage dm33 → 67/33−0.6≈1.43 (POZİTİF, yaş yem yardımcı);
    // grain dm88 → 12/88−0.6≈−0.46 (NEGATİF, kuru yem kısıtı zorlaştırır → LP silaj eklemeye iter).
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: { tmr_min_ration_moisture: { min: 30, target: 50 } } });
    const c = lp.subjectTo.find(x => x.name === 'TMR_ration_moisture_min');
    expect(c).toBeDefined();
    expect(c.bnds.lb).toBe(0);  // Σ … ≥ 0
    expect(c.vars[0].coef).toBeCloseTo((100 - 33) / 33 - 30 / 50, 3);  // silage
    expect(c.vars[2].coef).toBeCloseTo((100 - 88) / 88 - 30 / 50, 3);  // grain
    expect(c.vars[0].coef).toBeGreaterThan(0);
    expect(c.vars[2].coef).toBeLessThan(0);
  });

  it('PROBLEMLER #3: M veya T eksikse rasyondan-min-nem kısıtı eklenmez (geriye uyumlu)', () => {
    const noM = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: { tmr_min_ration_moisture: { target: 50 } } });
    expect(noM.subjectTo.find(c => c.name === 'TMR_ration_moisture_min')).toBeUndefined();
    const none = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22 });
    expect(none.subjectTo.find(c => c.name === 'TMR_ration_moisture_min')).toBeUndefined();
  });

  it('#1: makro mineral {min,max} → Ca kısıtı çift-sınırlı (lb + ub)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 20, requirements: { ca_g: { min: 50, max: 100 } } });
    const ca = lp.subjectTo.find(c => c.name === 'Ca');
    expect(ca).toBeDefined();
    expect(ca.bnds.type).toBe(GLP.DB);   // double-bound
    expect(ca.bnds.lb).toBe(50);
    expect(ca.bnds.ub).toBe(100);
  });

  it('#1: makro mineral sayı (eski) → yalnız min (geriye uyumluluk)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 20, requirements: { ca_g: 50 } });
    const ca = lp.subjectTo.find(c => c.name === 'Ca');
    expect(ca.bnds.type).toBe(GLP.LO);
    expect(ca.bnds.lb).toBe(50);
  });

  it('DMI kısıtı ±%3 slack ile DB tipinde eklenir (FAZ 13.3)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22 });
    const dmiC = lp.subjectTo.find(c => c.name === 'DMI');
    expect(dmiC).toBeDefined();
    expect(dmiC.bnds.lb).toBeCloseTo(22 * 0.97, 6);  // 21.34
    expect(dmiC.bnds.ub).toBeCloseTo(22 * 1.03, 6);  // 22.66
    expect(dmiC.bnds.type).toBe(GLP.DB);
    // Tüm değişkenlerin katsayısı 1
    for (const v of dmiC.vars) expect(v.coef).toBe(1);
  });

  it('dmiSlack parametresi bant genişliğini özelleştirir (FAZ 13.3)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 20, dmiSlack: 0.05 });
    const dmiC = lp.subjectTo.find(c => c.name === 'DMI');
    expect(dmiC.bnds.lb).toBeCloseTo(20 * 0.95, 6);  // 19
    expect(dmiC.bnds.ub).toBeCloseTo(20 * 1.05, 6);  // 21
    expect(dmiC.bnds.type).toBe(GLP.DB);
    expect(lp._meta.dmiSlack).toBe(0.05);
  });

  it('dmiSlack=0 eski tam eşitlik (FX) davranışına döner (FAZ 13.3)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, dmiSlack: 0 });
    const dmiC = lp.subjectTo.find(c => c.name === 'DMI');
    expect(dmiC.bnds.lb).toBe(22);
    expect(dmiC.bnds.ub).toBe(22);
    expect(dmiC.bnds.type).toBe(GLP.FX);
    expect(lp._meta.dmiSlack).toBe(0);
  });

  it('_meta hayvan/yem izini taşır', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22 });
    expect(lp._meta.feedIds).toEqual(['silage', 'alfalfa', 'grain']);
    expect(lp._meta.dmi_kg).toBe(22);
  });

  it('her yem değişkeni için bounds[] alt sınır 0 (GLP_LO) içerir (FAZ 13.4)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22 });
    expect(Array.isArray(lp.bounds)).toBe(true);
    expect(lp.bounds.length).toBe(SAMPLE_FEEDS.length);
    for (const b of lp.bounds) {
      expect(b.type).toBe(GLP.LO);  // alt sınır → negatif yem imkânsız
      expect(b.lb).toBe(0);
    }
    // her değişken adı tam olarak bir bound'a karşılık gelir
    const boundNames = lp.bounds.map(b => b.name).sort();
    const varNames = lp._meta.varNames.slice().sort();
    expect(boundNames).toEqual(varNames);
  });
});

describe('effectiveNel — FAZ 17.2 yem-bazlı NEL iskontosu', () => {
  it('iskonto yoksa ham NEL döner (değişmez)', () => {
    expect(effectiveNel({ nel: 1.72 })).toBe(1.72);
    expect(effectiveNel({ nel: 1.72, nelDiscount: 0 })).toBe(1.72);
  });

  it('nelDiscount=10 → NEL %10 düşer', () => {
    expect(effectiveNel({ nel: 1.72, nelDiscount: 10 })).toBeCloseTo(1.548, 6);
    expect(effectiveNel({ nel: 2.0, nelDiscount: 25 })).toBeCloseTo(1.5, 6);
  });

  it('nelDiscount 0..100 aralığına clamp edilir (negatif→0, >100→0 enerji)', () => {
    expect(effectiveNel({ nel: 1.8, nelDiscount: -5 })).toBe(1.8);    // negatif yok sayılır
    expect(effectiveNel({ nel: 1.8, nelDiscount: 150 })).toBe(0);     // %100 üstü → tam iskonto
  });

  it('LP NEL kısıt katsayısı iskontolu yemde düşer, diğerlerinde aynı', () => {
    const feeds = [
      { id: 'grain_disc', category: 'grain', dm: 88, nel: 2.0, nelDiscount: 10, cp: 9, ndf: 10, pricePerTon: 9000 },
      { id: 'grain_full', category: 'grain', dm: 88, nel: 2.0, cp: 9, ndf: 10, pricePerTon: 9000 },
    ];
    const lp = buildRationLP({ feeds, dmi_kg: 20, requirements: { nel_mcal: 30 } });
    const nel = lp.subjectTo.find(c => c.name === 'NEL');
    expect(nel.vars[0].coef).toBeCloseTo(1.8, 6);  // 2.0 × (1 − 0.10)
    expect(nel.vars[1].coef).toBeCloseTo(2.0, 6);  // iskontosuz
  });

  it('NEL-türevli TDN (mikrobiyal protein) iskontoyu yansıtır; explicit TDN etkilenmez', () => {
    // Enerji-sınırlı yem (yüksek CP → RDP bol): MCP = min(enerji, RDP) enerji tarafından
    // belirlenir; tdn yok → NEL'den türetilir → iskonto mikrobiyal MP'yi düşürür.
    const base = { category: 'protein', nel: 2.0, cp: 48, rdp: 65, rup: 35 };
    const mpFull = mpComponentsPerKgDM({ ...base }).mpMicrobial;
    const mpDisc = mpComponentsPerKgDM({ ...base, nelDiscount: 15 }).mpMicrobial;
    expect(mpDisc).toBeLessThan(mpFull);
    // explicit tdn verilince NEL iskontosu TDN'i (dolayısıyla mikrobiyal MP'yi) DEĞİŞTİRMEZ
    const mpTdnFull = mpComponentsPerKgDM({ ...base, tdn: 80 }).mpMicrobial;
    const mpTdnDisc = mpComponentsPerKgDM({ ...base, tdn: 80, nelDiscount: 15 }).mpMicrobial;
    expect(mpTdnDisc).toBeCloseTo(mpTdnFull, 6);
  });
});

describe('buildRationLP — besin kısıtları', () => {
  it('NEL kısıtı yalnızca lb (üst sınır opsiyonel)', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30 },
    });
    const nel = lp.subjectTo.find(c => c.name === 'NEL');
    expect(nel.bnds.lb).toBe(30);
    expect(nel.bnds.type).toBe(GLP.LO);
  });

  it('NEL üst sınırı nel_mcal_max ile etkinleşir', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, nel_mcal_max: 36 },
    });
    const nel = lp.subjectTo.find(c => c.name === 'NEL');
    expect(nel.bnds.lb).toBe(30);
    expect(nel.bnds.ub).toBe(36);
    expect(nel.bnds.type).toBe(GLP.DB);
  });

  it('CP kısıtı %KM × DMI bazında ölçeklenir', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { cp_pct: { min: 16, max: 18 } },
    });
    const cp = lp.subjectTo.find(c => c.name === 'CP');
    expect(cp.bnds.lb).toBe(16 * 22);
    expect(cp.bnds.ub).toBe(18 * 22);
  });

  it('peNDF kısıtı kategoriye göre pef ile ağırlıklandırır', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { peNDF_pct: { min: 22 } },
    });
    const peNDF = lp.subjectTo.find(c => c.name === 'peNDF_min');
    // silage roughage pef=1.0 → 44 × 1.0 = 44
    expect(peNDF.vars[0].coef).toBe(44);
    // alfalfa roughage → 42 × 1.0 = 42
    expect(peNDF.vars[1].coef).toBe(42);
    // grain pef=0.42 → 10 × 0.42 = 4.2
    expect(peNDF.vars[2].coef).toBeCloseTo(4.2, 2);
  });

  it('Forage kısıtı sadece kaba yemleri sayar (coef=1 vs 0)', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { forage_pct: { min: 40, max: 60 } },
    });
    const forage = lp.subjectTo.find(c => c.name === 'Forage');
    expect(forage.vars[0].coef).toBe(1); // silage
    expect(forage.vars[1].coef).toBe(1); // alfalfa
    expect(forage.vars[2].coef).toBe(0); // grain
    expect(forage.bnds.lb).toBeCloseTo(0.4 * 22, 2);
    expect(forage.bnds.ub).toBeCloseTo(0.6 * 22, 2);
  });

  it('Mineral kısıtı (g/gün) × 10 katsayı ile ölçeklenir', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: { ca_g: 120 },
    });
    const ca = lp.subjectTo.find(c => c.name === 'Ca');
    // silage ca=0.24 → 2.4
    expect(ca.vars[0].coef).toBeCloseTo(2.4, 5);
    // alfalfa ca=1.45 → 14.5
    expect(ca.vars[1].coef).toBeCloseTo(14.5, 5);
    expect(ca.bnds.lb).toBe(120);
  });

  it('S için min ve max (toxicity) birlikte uygulanır', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { s_g: 44, s_g_max: 88 },
    });
    const s = lp.subjectTo.find(c => c.name === 'S');
    expect(s.bnds.lb).toBe(44);
    expect(s.bnds.ub).toBe(88);
    expect(s.bnds.type).toBe(GLP.DB);
  });

  it('eksik gereksinim kısıt oluşturmaz', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: {} });
    const names = lp.subjectTo.map(c => c.name);
    expect(names).toContain('DMI');
    expect(names).not.toContain('NEL');
    expect(names).not.toContain('Ca');
  });
});

describe('buildRationLP — feedLimits', () => {
  it('yem-özgü maxPct kısıt olarak eklenir', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      feedLimits: { alfalfa: { maxPct: 40 } },
    });
    const lim = lp.subjectTo.find(c => c.name === 'limit_alfalfa');
    expect(lim).toBeDefined();
    expect(lim.bnds.ub).toBeCloseTo(8.8, 1);
    expect(lim.bnds.type).toBe(GLP.UP);
  });

  it('minPct + maxPct birlikte DB tipinde kısıt üretir', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      feedLimits: { silage: { minPct: 15, maxPct: 40 } },
    });
    const lim = lp.subjectTo.find(c => c.name === 'limit_silage');
    expect(lim.bnds.lb).toBeCloseTo(0.15 * 22, 2);
    expect(lim.bnds.ub).toBeCloseTo(0.40 * 22, 2);
    expect(lim.bnds.type).toBe(GLP.DB);
  });

  it('feedLimits olmadan limit kısıtı eklenmez', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22 });
    const limits = lp.subjectTo.filter(c => c.name.startsWith('limit_'));
    expect(limits.length).toBe(0);
  });

  it('kg bazlı min/max limit kabul eder (min: 2 kg KM)', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      feedLimits: { silage: { min: 2 } },
    });
    const lim = lp.subjectTo.find(c => c.name === 'limit_silage');
    expect(lim).toBeDefined();
    expect(lim.bnds.lb).toBe(2);
    expect(lim.bnds.type).toBe(GLP.LO);
  });

  it('kg bazlı min + max birlikte çalışır', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      feedLimits: { alfalfa: { min: 1.5, max: 5 } },
    });
    const lim = lp.subjectTo.find(c => c.name === 'limit_alfalfa');
    expect(lim).toBeDefined();
    expect(lim.bnds.lb).toBe(1.5);
    expect(lim.bnds.ub).toBe(5);
    expect(lim.bnds.type).toBe(GLP.DB);
  });
});

describe('mpPerKgDM (FAZ 10A) — MP içeriği hesabı', () => {
  it('Soya küspesi: yüksek MP (>180 g/kg KM)', () => {
    const soy = { cp: 47, rup: 35, rdp: 65, tdn: 84, rupIntD: 92 };
    expect(mpPerKgDM(soy)).toBeGreaterThan(180);
  });

  it('Silaj (düşük protein) düşük MP (<80 g/kg KM)', () => {
    const silage = { cp: 8.2, rup: 15, rdp: 85, tdn: 68, rupIntD: 60 };
    expect(mpPerKgDM(silage)).toBeLessThan(80);
  });

  it('TDN yoksa NEL\'den tahmin edilir', () => {
    const corn = { cp: 9, rup: 50, rdp: 50, nel: 2.0, rupIntD: 80 };
    const mp = mpPerKgDM(corn);
    expect(mp).toBeGreaterThan(40);
    expect(mp).toBeLessThan(100);
  });

  it('Mineral premiks: MP ≈ 0', () => {
    const mineral = { cp: 0, rup: 0, rdp: 0, tdn: 0 };
    expect(mpPerKgDM(mineral)).toBeLessThan(1);
  });
});

describe('MP LP Kısıtı (FAZ 10A)', () => {
  it('mp_g kısıtı LP\'ye eklenir', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { mp_g: 1800 },
    });
    const mp = lp.subjectTo.find(c => c.name === 'MP');
    expect(mp).toBeDefined();
    expect(mp.bnds.lb).toBe(1800);
  });

  it('mp_g yoksa MP kısıtı eklenmez', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: {},
    });
    const mp = lp.subjectTo.find(c => c.name === 'MP');
    expect(mp).toBeUndefined();
    expect(lp.subjectTo.find(c => c.name === 'MP_RDP')).toBeUndefined();
  });
});

describe('FAZ 18.1 — Rasyon-düzeyi mikrobiyal protein', () => {
  it('mpComponentsPerKgDM enerji/RDP havuzlarını (×0.64) döndürür', () => {
    // tdn=88, cp=9, rdp=35%CP → tdn_g=880, rdp_g=31.5
    const c = mpComponentsPerKgDM({ category: 'grain', tdn: 88, cp: 9, rdp: 35, rup: 65 });
    expect(c.mpEnergyPool).toBeCloseTo(880 * 0.13 * 0.64, 4);   // 73.22
    expect(c.mpRdpPool).toBeCloseTo(31.5 * 0.85 * 0.64, 4);      // 17.14
    // per-feed mpMicrobial = 0.64 × min(enerji, RDP) = RDP-sınırlı
    expect(c.mpMicrobial).toBeCloseTo(Math.min(c.mpEnergyPool, c.mpRdpPool), 6);
  });

  it('MP kısıtı İKİ lineer havuz kısıtına açılır (MP + MP_RDP), ikisi de lb=req', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: { mp_g: 1800 } });
    const mpE = lp.subjectTo.find(c => c.name === 'MP');       // enerji-havuz yolu
    const mpR = lp.subjectTo.find(c => c.name === 'MP_RDP');   // RDP-havuz yolu
    expect(mpE).toBeDefined();
    expect(mpR).toBeDefined();
    expect(mpE.bnds.lb).toBe(1800);
    expect(mpR.bnds.lb).toBe(1800);
    // her yem için: enerji-yolu coef = mpRUP+mpEnergyPool, RDP-yolu coef = mpRUP+mpRdpPool
    const c0 = mpComponentsPerKgDM(SAMPLE_FEEDS[0]);
    expect(mpE.vars[0].coef).toBeCloseTo(c0.mpRUP + c0.mpEnergyPool, 4);
    expect(mpR.vars[0].coef).toBeCloseTo(c0.mpRUP + c0.mpRdpPool, 4);
  });

  it('rasyon-düzeyi mikrobiyal MP > per-feed min toplamı (tamamlayıcı yem sinerjisi)', () => {
    // A: enerji-zengin/RDP-fakir → tek başına RDP-sınırlı; B: enerji-fakir/RDP-zengin → enerji-sınırlı
    const A = mpComponentsPerKgDM({ category: 'grain',   tdn: 88, cp: 9,  rdp: 35, rup: 65 });
    const B = mpComponentsPerKgDM({ category: 'protein', tdn: 55, cp: 45, rdp: 75, rup: 25 });
    const perFeedMicrobial = A.mpMicrobial + B.mpMicrobial;                                   // Σ min
    const rationMicrobial  = Math.min(A.mpEnergyPool + B.mpEnergyPool, A.mpRdpPool + B.mpRdpPool);  // min Σ
    expect(rationMicrobial).toBeGreaterThan(perFeedMicrobial);   // sinerji: rasyon > per-feed
  });

  it('üst sınır (mp_g_max) → İKİ havuz üst kısıtı (MP_max + MP_RDP_max), katsayı = MP/MP_RDP min ile aynı', () => {
    // SAHA-DENETİM A: raporlanan mp_g = mpRUP+min(ΣE,ΣR); max'ı per-feed Σ mpTotal yerine
    // iki havuzu da bağlayarak ver → reported ≤ ub garanti (raporlanan max'ı aşamaz).
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: { mp_g: 1500, mp_g_max: 2200 } });
    const mpMax = lp.subjectTo.find(c => c.name === 'MP_max');       // enerji-havuz yolu
    const mpRdpMax = lp.subjectTo.find(c => c.name === 'MP_RDP_max'); // RDP-havuz yolu
    expect(mpMax).toBeDefined();
    expect(mpRdpMax).toBeDefined();
    expect(mpMax.bnds.type).toBe(GLP.UP);
    expect(mpRdpMax.bnds.type).toBe(GLP.UP);
    expect(mpMax.bnds.ub).toBe(2200);
    expect(mpRdpMax.bnds.ub).toBe(2200);
    // katsayılar MP / MP_RDP ALT sınır kısıtlarıyla BİREBİR aynı (tutarlılık garantisi)
    const c0 = mpComponentsPerKgDM(SAMPLE_FEEDS[0]);
    expect(mpMax.vars[0].coef).toBeCloseTo(c0.mpRUP + c0.mpEnergyPool, 4);
    expect(mpRdpMax.vars[0].coef).toBeCloseTo(c0.mpRUP + c0.mpRdpPool, 4);
  });

  it('mp_g_max enerji havuzu üst sınırı energyDiscount yansıtır (MP min ile simetrik)', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: { mp_g: 1500, mp_g_max: 2200 }, intakeMultiple: 3 });
    const mpMax = lp.subjectTo.find(c => c.name === 'MP_max');
    const c0 = mpComponentsPerKgDM(SAMPLE_FEEDS[0]);
    const feedDisc = feedIntakeDiscountFactor(SAMPLE_FEEDS[0], 3);
    expect(mpMax.vars[0].coef).toBeCloseTo(c0.mpRUP + c0.mpEnergyPool * feedDisc, 4);
  });
});

describe('buildRationLP — amaç fonksiyonu', () => {
  it('"cost" amacı pricePerTon ve dm oranına göre katsayı oluşturur', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, objective: 'cost' });
    // silage: 2500 TL/ton ÷ 1000 ÷ 0.33 dm = 7.576 TL/kg KM
    expect(lp.objective.vars[0].coef).toBeCloseTo(7.576, 2);
    // alfalfa: 6000 ÷ 1000 ÷ 0.89 ≈ 6.742
    expect(lp.objective.vars[1].coef).toBeCloseTo(6.742, 2);
  });

  it('"minDM" amacı her yem için katsayı 1', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, objective: 'minDM' });
    for (const v of lp.objective.vars) expect(v.coef).toBe(1);
  });
});

describe('dcadCoefPerKgDM', () => {
  it('alfalfa DCAD ≈ 40 mEq/100g (yüksek K)', () => {
    const alfalfa = SAMPLE_FEEDS[1];
    const dcad = dcadCoefPerKgDM(alfalfa);
    expect(dcad).toBeCloseTo(40.3, 0);
  });

  it('Mısır tane DCAD ≈ 0 (nötr)', () => {
    const grain = SAMPLE_FEEDS[2];
    const dcad = dcadCoefPerKgDM(grain);
    expect(Math.abs(dcad)).toBeLessThan(5);
  });

  it('eksik mineral değerlerini 0 sayar', () => {
    const incomplete = { id: 'x', category: 'mineral' };
    expect(dcadCoefPerKgDM(incomplete)).toBe(0);
  });
});

// FAZ 17.5: lpSummary kaldırıldı (ölü debug export) → ilgili test bloğu da temizlendi.

// ─── FAZ 14.2 — İz mineral LP kısıtları ─────────────────────────────────────

// Yem değerleri mg/kg KM (NRC 2001 Tablo 6-2 referans aralıklarda).
const TRACE_FEEDS = [
  { id: 'silage_te', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, ndf: 44, adf: 27,
    ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09,
    zn: 30, cu: 7, mn: 35, se: 0.05, fe: 200, i: 0.10, co: 0.10, pricePerTon: 2500 },
  { id: 'alfalfa_te', category: 'roughage', dm: 89, nel: 1.30, cp: 18, ndf: 42, adf: 32,
    ca: 1.45, p: 0.30, mg: 0.32, k: 2.50, na: 0.10, s: 0.27, cl: 0.40,
    zn: 25, cu: 9, mn: 40, se: 0.10, fe: 250, i: 0.20, co: 0.20, pricePerTon: 6000 },
  { id: 'premix_te', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0,
    ca: 15, p: 8, mg: 2, k: 0, na: 0, s: 0.5, cl: 0,
    zn: 5000, cu: 1200, mn: 3000, se: 30, fe: 4000, i: 60, co: 25, pricePerTon: 30000 },
];

describe('FAZ 14.2 — İz mineral LP kısıtları', () => {
  it('TRACE_MINERAL_KEYS doğru sırada 7 anahtar export eder', () => {
    expect(TRACE_MINERAL_KEYS).toEqual(['zn', 'cu', 'mn', 'se', 'fe', 'i', 'co']);
  });

  it('requirements.traceMinerals yoksa hiç iz mineral kısıtı eklenmez', () => {
    const lp = buildRationLP({
      feeds: TRACE_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30 },
    });
    const traceConstraints = lp.subjectTo.filter(c => c.name.startsWith('trace_'));
    expect(traceConstraints).toHaveLength(0);
  });

  it('tek bir mineralin min kısıtı doğru katsayı + lb ile LP\'ye girer (Zn)', () => {
    const lp = buildRationLP({
      feeds: TRACE_FEEDS, dmi_kg: 22,
      requirements: { traceMinerals: { zn: { min: 880 } } },
    });
    const zn = lp.subjectTo.find(c => c.name === 'trace_zn');
    expect(zn).toBeDefined();
    expect(zn.bnds.type).toBe(GLP.LO);
    expect(zn.bnds.lb).toBe(880);
    // Katsayılar yem mg/kg KM'sini birebir yansıtır
    expect(zn.vars[0].coef).toBe(30);    // silage_te.zn
    expect(zn.vars[1].coef).toBe(25);    // alfalfa_te.zn
    expect(zn.vars[2].coef).toBe(5000);  // premix_te.zn
  });

  it('max-only kısıtı UP tipinde eklenir (toksisite üst sınırı, ör. Cu)', () => {
    const lp = buildRationLP({
      feeds: TRACE_FEEDS, dmi_kg: 22,
      requirements: { traceMinerals: { cu: { max: 220 } } },
    });
    const cu = lp.subjectTo.find(c => c.name === 'trace_cu');
    expect(cu).toBeDefined();
    expect(cu.bnds.type).toBe(GLP.UP);
    expect(cu.bnds.ub).toBe(220);
  });

  it('min + max birlikte verildiğinde DB tipinde aralık kısıtı eklenir (Se)', () => {
    const lp = buildRationLP({
      feeds: TRACE_FEEDS, dmi_kg: 22,
      requirements: { traceMinerals: { se: { min: 6.6, max: 44 } } },
    });
    const se = lp.subjectTo.find(c => c.name === 'trace_se');
    expect(se).toBeDefined();
    expect(se.bnds.type).toBe(GLP.DB);
    expect(se.bnds.lb).toBe(6.6);
    expect(se.bnds.ub).toBe(44);
  });

  it('7 iz mineralin tümü birden eklenince ayrı 7 kısıt oluşur', () => {
    const trace = {
      zn: { min: 880 }, cu: { min: 220 }, mn: { min: 440 },
      se: { min: 6.6 }, fe: { min: 1100 }, i: { min: 8.8 }, co: { min: 2.4 },
    };
    const lp = buildRationLP({
      feeds: TRACE_FEEDS, dmi_kg: 22,
      requirements: { traceMinerals: trace },
    });
    const names = lp.subjectTo.filter(c => c.name.startsWith('trace_')).map(c => c.name).sort();
    expect(names).toEqual(['trace_co', 'trace_cu', 'trace_fe', 'trace_i', 'trace_mn', 'trace_se', 'trace_zn']);
  });

  it('boş range ({} veya {min:undefined,max:undefined}) o mineral için kısıt eklemez', () => {
    const lp = buildRationLP({
      feeds: TRACE_FEEDS, dmi_kg: 22,
      requirements: { traceMinerals: { zn: {}, cu: { min: undefined, max: undefined }, mn: { min: 440 } } },
    });
    const traceNames = lp.subjectTo.filter(c => c.name.startsWith('trace_')).map(c => c.name);
    expect(traceNames).toEqual(['trace_mn']);  // sadece Mn min eklendi
  });
});

// ─── FAZ 14.3 — Vitamin LP kısıtları (Vit A/D/E) ────────────────────────────

const VIT_FEEDS = [
  { id: 'silage_v', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, ndf: 44, adf: 27,
    ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09,
    vitA: 0, vitD: 0, vitE: 35, bcarotene: 60, pricePerTon: 2500 },
  { id: 'alfalfa_v', category: 'roughage', dm: 89, nel: 1.30, cp: 18, ndf: 42, adf: 32,
    ca: 1.45, p: 0.30, mg: 0.32, k: 2.50, na: 0.10, s: 0.27, cl: 0.40,
    vitA: 0, vitD: 0, vitE: 80, bcarotene: 120, pricePerTon: 6000 },
  { id: 'vit_premix', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0,
    ca: 12, p: 0, mg: 0, k: 0, na: 0, s: 0, cl: 0,
    vitA: 1200000, vitD: 300000, vitE: 8000, bcarotene: 400, pricePerTon: 50000 },
];

describe('FAZ 14.3 — Vitamin LP kısıtları (Vit A/D/E)', () => {
  it('VITAMIN_KEYS doğru sırada 3 anahtar + BCAROTENE_TO_VITA = 200 IU/mg export eder', () => {
    expect(VITAMIN_KEYS).toEqual(['vitA', 'vitD', 'vitE']);
    expect(BCAROTENE_TO_VITA_IU_PER_MG).toBe(200);
  });

  it('Vit A kısıtı β-karoten dönüşümünü coefficient\'e dahil eder (vitA + bcarotene×200)', () => {
    const lp = buildRationLP({
      feeds: VIT_FEEDS, dmi_kg: 22,
      requirements: { vitamins: { vitA: { min: 60000 } } },
    });
    const vitA = lp.subjectTo.find(c => c.name === 'vit_vitA');
    expect(vitA).toBeDefined();
    expect(vitA.bnds.type).toBe(GLP.LO);
    expect(vitA.bnds.lb).toBe(60000);
    // silage_v: vitA=0 + bcarotene=60 × 200 = 12000
    expect(vitA.vars[0].coef).toBe(12000);
    // alfalfa_v: 0 + 120 × 200 = 24000
    expect(vitA.vars[1].coef).toBe(24000);
    // vit_premix: 1200000 + 400 × 200 = 1280000
    expect(vitA.vars[2].coef).toBe(1280000);
  });

  it('Vit D/E kısıtları yem değerini doğrudan coefficient olarak kullanır (β-karoten yok)', () => {
    const lp = buildRationLP({
      feeds: VIT_FEEDS, dmi_kg: 22,
      requirements: { vitamins: { vitD: { min: 18000 }, vitE: { min: 480 } } },
    });
    const vitD = lp.subjectTo.find(c => c.name === 'vit_vitD');
    const vitE = lp.subjectTo.find(c => c.name === 'vit_vitE');
    expect(vitD).toBeDefined();
    expect(vitE).toBeDefined();
    // Vit D: silage=0, alfalfa=0, premix=300000 → β-karoten dahil edilmemeli
    expect(vitD.vars.map(v => v.coef)).toEqual([0, 0, 300000]);
    // Vit E: silage=35, alfalfa=80, premix=8000
    expect(vitE.vars.map(v => v.coef)).toEqual([35, 80, 8000]);
    expect(vitD.bnds.lb).toBe(18000);
    expect(vitE.bnds.lb).toBe(480);
  });
});

// ─── FAZ 14.4 — Amino asit (Lys/Met) LP kısıtları ───────────────────────────

describe('FAZ 14.4 — aaPerKgDM yem-başına Lys/Met katsayısı', () => {
  // Protein yem: cp 48, rup 35, rdp 65, tdn 84, lys 6.3, met 1.4 (% protein)
  const SOY = { cp: 48, rup: 35, rdp: 65, tdn: 84, category: 'protein', lys: 6.3, met: 1.4 };

  it('Lys/Met = mpMicrobial × MICROBIAL_AA + mpRUP × yem AA% (intD bir kez)', () => {
    const comp = mpComponentsPerKgDM(SOY);
    const aa = aaPerKgDM(SOY, 'NASEM2021');
    // NASEM2021 mikrobiyal: Lys 7.30, Met 2.40
    const expectedLys = comp.mpMicrobial * 7.30 / 100 + comp.mpRUP * 6.3 / 100;
    const expectedMet = comp.mpMicrobial * 2.40 / 100 + comp.mpRUP * 1.4 / 100;
    expect(aa.lys).toBeCloseTo(expectedLys, 4);
    expect(aa.met).toBeCloseTo(expectedMet, 4);
  });

  it('system parametresi mikrobiyal AA içeriğini değiştirir (NRC2001 > NASEM2021)', () => {
    const nasem = aaPerKgDM(SOY, 'NASEM2021');
    const nrc   = aaPerKgDM(SOY, 'NRC2001');
    // NRC2001 mikrobiyal Lys 7.90 > NASEM 7.30 → daha yüksek Lys tedariki
    expect(nrc.lys).toBeGreaterThan(nasem.lys);
    expect(nrc.met).toBeGreaterThan(nasem.met);
  });

  it('yem AA değeri yoksa default rupLys=6.5 / rupMet=2.0 kullanılır', () => {
    const noAA = { cp: 20, rup: 40, rdp: 60, tdn: 70, category: 'protein' };
    const comp = mpComponentsPerKgDM(noAA);
    const aa = aaPerKgDM(noAA, 'NASEM2021');
    const expectedLys = comp.mpMicrobial * 7.30 / 100 + comp.mpRUP * 6.5 / 100;
    expect(aa.lys).toBeCloseTo(expectedLys, 4);
  });
});

describe('FAZ 14.4 — Lys/Met LP kısıtları', () => {
  const AA_FEEDS = [
    { id: 'silage_a', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, rup: 15, rdp: 85, tdn: 68,
      ndf: 44, adf: 27, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09,
      lys: 4.5, met: 1.5, pricePerTon: 2500 },
    { id: 'soy_a', category: 'protein', dm: 89, nel: 1.99, cp: 48, rup: 35, rdp: 65, tdn: 84,
      ndf: 10, adf: 5, ca: 0.33, p: 0.70, mg: 0.30, k: 2.20, na: 0.02, s: 0.45, cl: 0.04,
      lys: 6.3, met: 1.4, pricePerTon: 18000 },
  ];

  it('lys_g.min kısıtı LO tipinde, katsayılar aaPerKgDM.lys ile eşleşir', () => {
    const lp = buildRationLP({
      feeds: AA_FEEDS, dmi_kg: 22,
      requirements: { aminoAcids: { lys_g: { min: 140 } } },
    });
    const lysC = lp.subjectTo.find(c => c.name === 'Lys');
    expect(lysC).toBeDefined();
    expect(lysC.bnds.type).toBe(GLP.LO);
    expect(lysC.bnds.lb).toBe(140);
    expect(lysC.vars[0].coef).toBeCloseTo(aaPerKgDM(AA_FEEDS[0], 'NASEM2021').lys, 4);
    expect(lysC.vars[1].coef).toBeCloseTo(aaPerKgDM(AA_FEEDS[1], 'NASEM2021').lys, 4);
  });

  it('met_g.min kısıtı Met adıyla eklenir', () => {
    const lp = buildRationLP({
      feeds: AA_FEEDS, dmi_kg: 22,
      requirements: { aminoAcids: { met_g: { min: 48 } } },
    });
    const metC = lp.subjectTo.find(c => c.name === 'Met');
    expect(metC).toBeDefined();
    expect(metC.bnds.lb).toBe(48);
    expect(metC.vars[1].coef).toBeCloseTo(aaPerKgDM(AA_FEEDS[1], 'NASEM2021').met, 4);
  });

  it('system parametresi LP coefficient mikrobiyal AA içeriğini değiştirir', () => {
    const lpNasem = buildRationLP({
      feeds: AA_FEEDS, dmi_kg: 22, system: 'NASEM2021',
      requirements: { aminoAcids: { lys_g: { min: 140 } } },
    });
    const lpNrc = buildRationLP({
      feeds: AA_FEEDS, dmi_kg: 22, system: 'NRC2001',
      requirements: { aminoAcids: { lys_g: { min: 140 } } },
    });
    const nasemCoef = lpNasem.subjectTo.find(c => c.name === 'Lys').vars[1].coef;
    const nrcCoef = lpNrc.subjectTo.find(c => c.name === 'Lys').vars[1].coef;
    expect(nrcCoef).toBeGreaterThan(nasemCoef);  // NRC mikrobiyal Lys daha yüksek
  });

  it('aminoAcids yoksa Lys/Met kısıtı eklenmez', () => {
    const lp = buildRationLP({
      feeds: AA_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30 },
    });
    expect(lp.subjectTo.find(c => c.name === 'Lys')).toBeUndefined();
    expect(lp.subjectTo.find(c => c.name === 'Met')).toBeUndefined();
  });

  it('FAZ 18.3: his_g.min kısıtı His adıyla eklenir; aaPerKgDM his döndürür', () => {
    const aa = aaPerKgDM(AA_FEEDS[1], 'NASEM2021');
    expect(aa.his).toBeGreaterThan(0);   // His katsayısı var
    const lp = buildRationLP({
      feeds: AA_FEEDS, dmi_kg: 22,
      requirements: { aminoAcids: { his_g: { min: 50 } } },
    });
    const hisC = lp.subjectTo.find(c => c.name === 'His');
    expect(hisC).toBeDefined();
    expect(hisC.bnds.lb).toBe(50);
    expect(hisC.vars[1].coef).toBeCloseTo(aaPerKgDM(AA_FEEDS[1], 'NASEM2021').his, 4);
  });

  it('Tam EAA Katman B: aaPerKgDM 10 AA katsayısı döndürür (Lys/Met/His birebir korunur)', () => {
    const aa = aaPerKgDM(AA_FEEDS[1], 'NASEM2021');
    for (const k of ['lys', 'met', 'his', 'arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp']) {
      expect(aa[k]).toBeGreaterThan(0);
    }
    // Lys/Met geriye uyumlu (RUP_AA_DEFAULTS.lys/met = 6.5/2.0 = eski varsayılan)
    const comp = mpComponentsPerKgDM(AA_FEEDS[1]);
    expect(aa.lys).toBeCloseTo(comp.mpMicrobial * 7.30 / 100 + comp.mpRUP * 6.3 / 100, 4);
  });

  it('Tam EAA Katman B: leu_g.min override → Leu kısıtı (opt-in), katsayı aaPerKgDM.leu', () => {
    const lp = buildRationLP({
      feeds: AA_FEEDS, dmi_kg: 22,
      requirements: { aminoAcids: { leu_g: { min: 120 } } },
    });
    const leuC = lp.subjectTo.find(c => c.name === 'Leu');
    expect(leuC).toBeDefined();
    expect(leuC.bnds.type).toBe(GLP.LO);
    expect(leuC.bnds.lb).toBe(120);
    expect(leuC.vars[1].coef).toBeCloseTo(aaPerKgDM(AA_FEEDS[1], 'NASEM2021').leu, 4);
  });

  it('Tam EAA Katman B: 7 EAA override YOKKEN kısıt eklenmez (opt-in — varsayılan floor yok)', () => {
    const lp = buildRationLP({
      feeds: AA_FEEDS, dmi_kg: 22,
      requirements: { aminoAcids: { lys_g: { min: 140 } } },  // yalnız Lys override
    });
    for (const name of ['Arg', 'Thr', 'Ile', 'Leu', 'Val', 'Phe', 'Trp']) {
      expect(lp.subjectTo.find(c => c.name === name)).toBeUndefined();
    }
    expect(lp.subjectTo.find(c => c.name === 'Lys')).toBeDefined();  // Lys hâlâ var
  });
});

// ─── FAZ 14.5 — RDP min/max LP kısıtı ───────────────────────────────────────

describe('FAZ 14.5 — RDP LP kısıtı', () => {
  // rdp alanı % CP olarak: silage cp 8.2 rdp 85, soy cp 48 rdp 65
  const RDP_FEEDS = [
    { id: 'silage_r', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, rup: 15, rdp: 85,
      ndf: 44, adf: 27, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
    { id: 'soy_r', category: 'protein', dm: 89, nel: 1.99, cp: 48, rup: 35, rdp: 65,
      ndf: 10, adf: 5, ca: 0.33, p: 0.70, mg: 0.30, k: 2.20, na: 0.02, s: 0.45, cl: 0.04, pricePerTon: 18000 },
  ];

  it('rdp_pct.min → RDP kısıtı LO tipinde, katsayı = cp × rdp/100', () => {
    const lp = buildRationLP({
      feeds: RDP_FEEDS, dmi_kg: 22,
      requirements: { rdp_pct: { min: 9 } },
    });
    const rdp = lp.subjectTo.find(c => c.name === 'RDP');
    expect(rdp).toBeDefined();
    expect(rdp.bnds.type).toBe(GLP.LO);
    expect(rdp.bnds.lb).toBeCloseTo(9 * 22, 6);  // min × dmi
    // silage: 8.2 × 85/100 = 6.97 ; soy: 48 × 65/100 = 31.2
    expect(rdp.vars[0].coef).toBeCloseTo(6.97, 2);
    expect(rdp.vars[1].coef).toBeCloseTo(31.2, 2);
  });

  it('rdp_pct.min + max → DB tipinde aralık kısıtı', () => {
    const lp = buildRationLP({
      feeds: RDP_FEEDS, dmi_kg: 22,
      requirements: { rdp_pct: { min: 9, max: 12 } },
    });
    const rdp = lp.subjectTo.find(c => c.name === 'RDP');
    expect(rdp.bnds.type).toBe(GLP.DB);
    expect(rdp.bnds.lb).toBeCloseTo(9 * 22, 6);
    expect(rdp.bnds.ub).toBeCloseTo(12 * 22, 6);
  });

  it('rdp_pct yoksa RDP kısıtı eklenmez', () => {
    const lp = buildRationLP({
      feeds: RDP_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30 },
    });
    expect(lp.subjectTo.find(c => c.name === 'RDP')).toBeUndefined();
  });
});

// ─── FAZ 14.6 — Starch / Sugar / Fat max LP kısıtları ───────────────────────

describe('FAZ 14.6 — Starch/Sugar/Fat max LP kısıtları', () => {
  const NUTR_FEEDS = [
    { id: 'corn_n', category: 'grain', dm: 88, nel: 2.0, cp: 9, ndf: 10, adf: 3,
      starch: 65, sugar: 2, fat: 4, ca: 0.02, p: 0.28, na: 0.01, s: 0.10, cl: 0.05, pricePerTon: 9000 },
    { id: 'silage_n', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, ndf: 44, adf: 27,
      starch: 26, sugar: 1.5, fat: 3.2, ca: 0.24, p: 0.22, na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
  ];

  it('starch_pct.max → Starch_max kısıtı UP tipinde, katsayı = yem starch', () => {
    const lp = buildRationLP({
      feeds: NUTR_FEEDS, dmi_kg: 22,
      requirements: { starch_pct: { max: 28 } },
    });
    const c = lp.subjectTo.find(x => x.name === 'Starch_max');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.UP);
    expect(c.bnds.ub).toBeCloseTo(28 * 22, 6);
    expect(c.vars[0].coef).toBe(65);   // corn starch
    expect(c.vars[1].coef).toBe(26);   // silage starch
  });

  it('sugar_pct.max → Sugar_max kısıtı UP tipinde', () => {
    const lp = buildRationLP({
      feeds: NUTR_FEEDS, dmi_kg: 22,
      requirements: { sugar_pct: { max: 8 } },
    });
    const c = lp.subjectTo.find(x => x.name === 'Sugar_max');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.UP);
    expect(c.bnds.ub).toBeCloseTo(8 * 22, 6);
    expect(c.vars[0].coef).toBe(2);
  });

  it('fat_pct.max → Fat_max kısıtı UP tipinde', () => {
    const lp = buildRationLP({
      feeds: NUTR_FEEDS, dmi_kg: 22,
      requirements: { fat_pct: { max: 7 } },
    });
    const c = lp.subjectTo.find(x => x.name === 'Fat_max');
    expect(c).toBeDefined();
    expect(c.bnds.ub).toBeCloseTo(7 * 22, 6);
    expect(c.vars[0].coef).toBe(4);
  });

  it('starch/sugar/fat yoksa ilgili kısıtlar eklenmez', () => {
    const lp = buildRationLP({
      feeds: NUTR_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30 },
    });
    expect(lp.subjectTo.find(x => x.name === 'Starch_max')).toBeUndefined();
    expect(lp.subjectTo.find(x => x.name === 'Sugar_max')).toBeUndefined();
    expect(lp.subjectTo.find(x => x.name === 'Fat_max')).toBeUndefined();
  });
});

// ─── Çift-taraflı band düzeltmesi — arayüz min+max kutusu motor tarafından onurlandırılmalı ──
// Saha geri bildirimi: constraintRow her kısıtta min+max sunuyordu ama motor
// adf(max)/nfc(min)/peNDF(max)/starch(min)/sugar(min)/fat(min)/pufa(min) sınırlarını
// sessizce yok sayıyordu. Eksik taraf eklendi → kullanıcının girdiği band tam uygulanır.
describe('Çift-taraflı band — eksik sınır eklendi (kullanıcı override)', () => {
  const BAND_FEEDS = [
    { id: 'corn_b', category: 'grain', dm: 88, nel: 2.0, cp: 9, ndf: 10, adf: 3, nfc: 72,
      starch: 65, sugar: 2, fat: 4, pricePerTon: 9000 },
    { id: 'silage_b', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, ndf: 44, adf: 27, nfc: 38,
      starch: 26, sugar: 1.5, fat: 3.2, pricePerTon: 2500 },
  ];
  const build = (requirements) => buildRationLP({ feeds: BAND_FEEDS, dmi_kg: 22, requirements });

  it('starch_pct.min → Starch_min (LO), katsayı = yem starch', () => {
    const c = build({ starch_pct: { min: 25 } }).subjectTo.find(x => x.name === 'Starch_min');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.LO);
    expect(c.bnds.lb).toBeCloseTo(25 * 22, 6);
    expect(c.vars[0].coef).toBe(65);
  });

  it('sugar_pct.min → Sugar_min (LO)', () => {
    const c = build({ sugar_pct: { min: 3 } }).subjectTo.find(x => x.name === 'Sugar_min');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.LO);
    expect(c.bnds.lb).toBeCloseTo(3 * 22, 6);
  });

  it('fat_pct.min → Fat_min (LO)', () => {
    const c = build({ fat_pct: { min: 3.5 } }).subjectTo.find(x => x.name === 'Fat_min');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.LO);
    expect(c.bnds.lb).toBeCloseTo(3.5 * 22, 6);
    expect(c.vars[0].coef).toBe(4);
  });

  it('pufa_pct.min → PUFA_min (LO)', () => {
    const c = build({ pufa_pct: { min: 1 } }).subjectTo.find(x => x.name === 'PUFA_min');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.LO);
    expect(c.bnds.lb).toBeCloseTo(1 * 22, 6);
  });

  it('adf_pct.max → ADF_max (UP), katsayı = yem adf', () => {
    const c = build({ adf_pct: { max: 24 } }).subjectTo.find(x => x.name === 'ADF_max');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.UP);
    expect(c.bnds.ub).toBeCloseTo(24 * 22, 6);
    expect(c.vars[1].coef).toBe(27);
  });

  it('nfc_pct.min → NFC_min (LO), katsayı = yem nfc', () => {
    const c = build({ nfc_pct: { min: 35 } }).subjectTo.find(x => x.name === 'NFC_min');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.LO);
    expect(c.bnds.lb).toBeCloseTo(35 * 22, 6);
    expect(c.vars[0].coef).toBe(72);
  });

  it('peNDF_pct.max → peNDF_max (UP), katsayı = ndf × pef', () => {
    const c = build({ peNDF_pct: { max: 30 } }).subjectTo.find(x => x.name === 'peNDF_max');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.UP);
    expect(c.bnds.ub).toBeCloseTo(30 * 22, 6);
    // silage (roughage, pef=1.0) → 44 × 1.0 = 44
    expect(c.vars[1].coef).toBeCloseTo(44, 6);
  });

  it('iki-taraflı band: min+max birlikte → HER İKİ kısıt da eklenir (örn. fat)', () => {
    const st = build({ fat_pct: { min: 3, max: 7 } }).subjectTo;
    expect(st.find(x => x.name === 'Fat_min')).toBeDefined();
    expect(st.find(x => x.name === 'Fat_max')).toBeDefined();
  });

  it('geriye uyumluluk: tek-taraflı default → karşı sınır kısıtı eklenmez', () => {
    const st = build({
      starch_pct: { max: 28 }, sugar_pct: { max: 8 }, fat_pct: { max: 7 },
      pufa_pct: { max: 5 }, adf_pct: { min: 19 }, nfc_pct: { max: 42 }, peNDF_pct: { min: 22 },
    }).subjectTo;
    expect(st.find(x => x.name === 'Starch_min')).toBeUndefined();
    expect(st.find(x => x.name === 'Sugar_min')).toBeUndefined();
    expect(st.find(x => x.name === 'Fat_min')).toBeUndefined();
    expect(st.find(x => x.name === 'PUFA_min')).toBeUndefined();
    expect(st.find(x => x.name === 'ADF_max')).toBeUndefined();
    expect(st.find(x => x.name === 'NFC_min')).toBeUndefined();
    expect(st.find(x => x.name === 'peNDF_max')).toBeUndefined();
  });
});

// ─── FAZ 14.7 — Yem grup (kategori) kısıtları ───────────────────────────────

describe('FAZ 14.7 — Yem grup kısıtları (groupLimits)', () => {
  // SAMPLE_FEEDS: silage(roughage), alfalfa(roughage), grain(grain) — protein yok
  const GROUP_FEEDS = [
    { id: 'silage_g', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, ndf: 44, pricePerTon: 2500 },
    { id: 'alfalfa_g', category: 'roughage', dm: 89, nel: 1.30, cp: 18, ndf: 42, pricePerTon: 6000 },
    { id: 'grain_g', category: 'grain', dm: 88, nel: 2.0, cp: 9, ndf: 10, pricePerTon: 9000 },
    { id: 'soy_g', category: 'protein', dm: 89, nel: 1.99, cp: 48, ndf: 10, pricePerTon: 18000 },
  ];

  it('protein max → group_protein kısıtı, sadece protein yemleri coef=1', () => {
    const lp = buildRationLP({
      feeds: GROUP_FEEDS, dmi_kg: 22,
      groupLimits: { protein: { max: 8 } },
    });
    const c = lp.subjectTo.find(x => x.name === 'group_protein');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.UP);
    expect(c.bnds.ub).toBe(8);  // kg KM doğrudan
    // sadece soy_g (protein) coef 1, diğerleri 0
    expect(c.vars.map(v => v.coef)).toEqual([0, 0, 0, 1]);
  });

  it('roughage min → group_roughage LO kısıtı, roughage yemleri coef=1', () => {
    const lp = buildRationLP({
      feeds: GROUP_FEEDS, dmi_kg: 22,
      groupLimits: { roughage: { min: 12 } },
    });
    const c = lp.subjectTo.find(x => x.name === 'group_roughage');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.LO);
    expect(c.bnds.lb).toBe(12);
    expect(c.vars.map(v => v.coef)).toEqual([1, 1, 0, 0]);  // silage + alfalfa
  });

  it('birden fazla grup aynı anda ayrı kısıt oluşturur', () => {
    const lp = buildRationLP({
      feeds: GROUP_FEEDS, dmi_kg: 22,
      groupLimits: { protein: { max: 8 }, roughage: { min: 12, max: 16 }, grain: { max: 6 } },
    });
    expect(lp.subjectTo.find(x => x.name === 'group_protein')).toBeDefined();
    expect(lp.subjectTo.find(x => x.name === 'group_grain')).toBeDefined();
    const rough = lp.subjectTo.find(x => x.name === 'group_roughage');
    expect(rough.bnds.type).toBe(GLP.DB);  // min + max
    expect(rough.bnds.lb).toBe(12);
    expect(rough.bnds.ub).toBe(16);
  });

  it('groupLimits yoksa hiç grup kısıtı eklenmez', () => {
    const lp = buildRationLP({ feeds: GROUP_FEEDS, dmi_kg: 22, requirements: { nel_mcal: 30 } });
    expect(lp.subjectTo.filter(x => x.name.startsWith('group_'))).toHaveLength(0);
  });
});

// ─── FAZ 14.10 — PUFA / ω6:ω3 LP kısıtları ──────────────────────────────────

describe('FAZ 14.10 — PUFA / ω6:ω3 LP kısıtları', () => {
  // oilseed faProfile: c18_2=53 (ω6), c18_3=9 (ω3); fat yüksek
  const FA_FEEDS = [
    { id: 'silage_f', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, ndf: 44, fat: 3.3,
      ca: 0.24, p: 0.22, na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
    { id: 'oilseed_f', category: 'oilseed', dm: 90, nel: 2.5, cp: 38, ndf: 20, fat: 18,
      faProfile: { c16_0: 11, c18_0: 4, c18_1: 23, c18_2: 53, c18_3: 9 },
      ca: 0.25, p: 0.6, na: 0.02, s: 0.3, cl: 0.04, pricePerTon: 20000 },
  ];

  it('faCoefPerKgDM doğru PUFA/ω6/ω3 hesaplar (% KM)', () => {
    const fa = faCoefPerKgDM(FA_FEEDS[1]);  // fat 18, c18_2=53, c18_3=9
    expect(fa.omega6).toBeCloseTo(18 * 53 / 100, 4);  // 9.54
    expect(fa.omega3).toBeCloseTo(18 * 9 / 100, 4);   // 1.62
    expect(fa.pufa).toBeCloseTo(9.54 + 1.62, 4);      // 11.16
  });

  it('faCoefPerKgDM faProfile yoksa kategori fallback kullanır', () => {
    const fa = faCoefPerKgDM({ category: 'roughage', fat: 3.3 });  // roughage c18_2=18, c18_3=57
    expect(fa.omega6).toBeCloseTo(3.3 * 18 / 100, 4);
    expect(fa.omega3).toBeCloseTo(3.3 * 57 / 100, 4);
  });

  it('pufa_pct.max → PUFA_max kısıtı UP tipinde, katsayı faCoefPerKgDM.pufa', () => {
    const lp = buildRationLP({
      feeds: FA_FEEDS, dmi_kg: 22,
      requirements: { pufa_pct: { max: 5 } },
    });
    const c = lp.subjectTo.find(x => x.name === 'PUFA_max');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.UP);
    expect(c.bnds.ub).toBeCloseTo(5 * 22, 6);
    expect(c.vars[1].coef).toBeCloseTo(faCoefPerKgDM(FA_FEEDS[1]).pufa, 4);
  });

  it('n6n3_ratio_max → lineerleştirilmiş kısıt (ω6 − R×ω3), ub=0', () => {
    const R = 4;
    const lp = buildRationLP({
      feeds: FA_FEEDS, dmi_kg: 22,
      requirements: { n6n3_ratio_max: R },
    });
    const c = lp.subjectTo.find(x => x.name === 'n6n3_ratio');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.UP);
    expect(c.bnds.ub).toBe(0);
    // coefficient = ω6 − R×ω3
    const fa = faCoefPerKgDM(FA_FEEDS[1]);
    expect(c.vars[1].coef).toBeCloseTo(fa.omega6 - R * fa.omega3, 4);
  });

  it('pufa_pct / n6n3_ratio_max yoksa ilgili kısıtlar eklenmez', () => {
    const lp = buildRationLP({ feeds: FA_FEEDS, dmi_kg: 22, requirements: { nel_mcal: 30 } });
    expect(lp.subjectTo.find(x => x.name === 'PUFA_max')).toBeUndefined();
    expect(lp.subjectTo.find(x => x.name === 'n6n3_ratio')).toBeUndefined();
  });
});

// ─── FAZ 14.11 — MILP semi-continuous / integer değişken türleri ────────────

describe('FAZ 14.11 — MILP değişken türleri (yapı)', () => {
  it('semicontinuous → binary y + sc_max/sc_min kısıtları, standart limit yok', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      feedLimits: { grain: { min: 0.5, max: 3, type: 'semicontinuous' } },
    });
    expect(lp.binaries).toEqual(['y_grain']);
    const scMax = lp.subjectTo.find(c => c.name === 'sc_max_grain');
    const scMin = lp.subjectTo.find(c => c.name === 'sc_min_grain');
    expect(scMax).toBeDefined();
    expect(scMin).toBeDefined();
    // x − ub·y ≤ 0
    expect(scMax.vars).toEqual([{ name: 'x_grain', coef: 1 }, { name: 'y_grain', coef: -3 }]);
    expect(scMax.bnds.type).toBe(GLP.UP);
    // x − lb·y ≥ 0
    expect(scMin.vars).toEqual([{ name: 'x_grain', coef: 1 }, { name: 'y_grain', coef: -0.5 }]);
    expect(scMin.bnds.type).toBe(GLP.LO);
    // standart limit kısıtı eklenmemeli
    expect(lp.subjectTo.find(c => c.name === 'limit_grain')).toBeUndefined();
  });

  it('integer → generals dizisinde, standart limit kısıtı korunur', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      feedLimits: { grain: { max: 15, type: 'integer' } },
    });
    expect(lp.generals).toEqual(['x_grain']);
    expect(lp.subjectTo.find(c => c.name === 'limit_grain')).toBeDefined();
  });

  it('type yoksa (saf LP) binaries/generals eklenmez', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      feedLimits: { grain: { max: 10 } },
    });
    expect(lp.binaries).toBeUndefined();
    expect(lp.generals).toBeUndefined();
  });

  it('semicontinuous min yoksa (lb=0) standart davranışa düşer (binary eklenmez)', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      feedLimits: { grain: { max: 3, type: 'semicontinuous' } },  // min yok → lb undefined
    });
    expect(lp.binaries).toBeUndefined();
    // normal limit kısıtı uygulanır
    expect(lp.subjectTo.find(c => c.name === 'limit_grain')).toBeDefined();
  });
});

describe('FAZ 14.11 — MILP gerçek glpk çözümü', () => {
  const MILP_FEEDS = [
    { id: 'silage', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, ndf: 44,
      ca: 0.24, p: 0.22, na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
    { id: 'grain', category: 'grain', dm: 88, nel: 2.0, cp: 9, ndf: 10,
      ca: 0.02, p: 0.28, na: 0.01, s: 0.10, cl: 0.05, pricePerTon: 9000 },
    { id: 'premix', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0,
      ca: 15, p: 5, na: 0, s: 0, cl: 0, pricePerTon: 35000 },
  ];

  it('semi-continuous premiks: ya 0 ya ≥ min (0.2 kg)', async () => {
    const lp = buildRationLP({
      feeds: MILP_FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, ca_g: 60 },
      feedLimits: { premix: { min: 0.2, max: 0.5, type: 'semicontinuous' }, grain: { max: 12 } },
    });
    const r = await solveLP(lp);
    expect(r.optimal).toBe(true);
    const x = r.vars.x_premix ?? 0;
    // semi-continuous: x = 0 VEYA x ≥ 0.2 (0 < x < 0.2 olamaz)
    expect(x === 0 || x >= 0.2 - 1e-6).toBe(true);
  });

  it('integer yem: tamsayı kg çözüm', async () => {
    const lp = buildRationLP({
      feeds: MILP_FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 32 },
      feedLimits: { grain: { max: 15, type: 'integer' } },
      objective: 'minDM',
    });
    const r = await solveLP(lp);
    expect(r.optimal).toBe(true);
    const g = r.vars.x_grain ?? 0;
    expect(Math.abs(g - Math.round(g))).toBeLessThan(1e-6);
  });
});

// ─── FAZ 14.13 — NEL max + maliyet üst sınırı ───────────────────────────────

describe('FAZ 14.13 — NEL max + Cost_max kısıtları', () => {
  it('nel_mcal_max → NEL kısıtı DB tipinde (min + max)', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, nel_mcal_max: 33 },
    });
    const nel = lp.subjectTo.find(c => c.name === 'NEL');
    expect(nel.bnds.type).toBe(GLP.DB);
    expect(nel.bnds.lb).toBe(30);
    expect(nel.bnds.ub).toBe(33);
  });

  it('cost_max → Cost_max kısıtı UP tipinde, katsayı = cost objective coef', () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, cost_max: 150 },
    });
    const c = lp.subjectTo.find(x => x.name === 'Cost_max');
    expect(c).toBeDefined();
    expect(c.bnds.type).toBe(GLP.UP);
    expect(c.bnds.ub).toBe(150);
    // silage cost coef = (2500/1000)/0.33 ≈ 7.58 (objective cost ile aynı)
    expect(c.vars[0].coef).toBeCloseTo(7.58, 1);
  });

  it('cost_max yoksa Cost_max kısıtı eklenmez', () => {
    const lp = buildRationLP({ feeds: SAMPLE_FEEDS, dmi_kg: 22, requirements: { nel_mcal: 30 } });
    expect(lp.subjectTo.find(x => x.name === 'Cost_max')).toBeUndefined();
  });

  it('çok düşük cost_max → infeasible (bütçe tavanı)', async () => {
    const lp = buildRationLP({
      feeds: SAMPLE_FEEDS, dmi_kg: 22,
      requirements: { nel_mcal: 30, cost_max: 1 },  // 1 TL/gün imkansız
    });
    const r = await solveLP(lp);
    expect(r.optimal).toBe(false);
  });
});

describe('FAZ 10H — Yem-spesifik RUP IntD', () => {
  it('Protein kategorisi varsayılan IntD %88 (yüksek)', () => {
    const protein = { cp: 47, rup: 35, rdp: 65, tdn: 84, category: 'protein' };
    // IntD=88 → MP_RUP daha yüksek
    const mp = mpPerKgDM(protein);
    expect(mp).toBeGreaterThan(190);
  });

  it('Roughage kategorisi varsayılan IntD %65 (düşük)', () => {
    const rough = { cp: 15, rup: 25, rdp: 75, tdn: 60, category: 'roughage' };
    const mp = mpPerKgDM(rough);
    // MP_RUP düşük olur — düşük IntD nedeniyle
    expect(mp).toBeLessThan(80);
  });

  it('Yem girdisinde rupIntD varsa öncelikli', () => {
    const f1 = { cp: 47, rup: 35, rdp: 65, tdn: 84, category: 'protein', rupIntD: 50 };
    const f2 = { cp: 47, rup: 35, rdp: 65, tdn: 84, category: 'protein' };  // varsayılan 88
    // f1 daha düşük MP (IntD 50 vs 88)
    expect(mpPerKgDM(f1)).toBeLessThan(mpPerKgDM(f2));
  });

  it('Fat/mineral kategorisi IntD = 0 (protein yok)', () => {
    const mineral = { cp: 0, rup: 0, rdp: 0, category: 'mineral' };
    expect(mpPerKgDM(mineral)).toBe(0);
  });
});
