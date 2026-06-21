/**
 * FAZ 19.1a — CNCPS Formülasyon Motoru Arz API'si (saf birim testler)
 *
 * cncpsFeedSupply / cncpsRationInputs: CNCPS makinesini LP'nin per-feed MP havuz
 * katsayılarına çeviren saf fonksiyonlar. Bu adımda LP'ye HİÇ dokunulmaz; yalnız
 * pasaj-bağımlı arz hesabının doğruluğu + yönsel davranışı + geriye uyumluluk test edilir.
 * Tasarım: FAZ_17-20_Son_Kontrol_Uygulama_Plani.md → "📐 19.1 DETAYLI TASARIM".
 */
import { describe, it, expect } from 'vitest';
import {
  cncpsFeedSupply, cncpsRationInputs, calcPassageRates, cncpsProteinDataSource,
} from '../src/core/cncps.js';
import { buildRationLP, mpComponentsPerKgDM } from '../src/solver/lpBuilder.js';
import { optimizeRation } from '../src/solver/rationOptimizer.js';  // FAZ 19.1c: uçtan uca iteratif motor
import { feedIntakeDiscountFactor } from '../src/core/nrc2001.js';

// ─── Test yemleri (gerçekçi analiz değerleri) ───────────────────────────────
const corn = {
  id: 'corn', category: 'grain',
  cp: 9, ndf: 9, adf: 3, starch: 72, sugar: 2, nfc: 80, nel: 2.0, rdp: 50, rup: 50,
};
const sbm = {
  id: 'sbm', category: 'protein',
  cp: 48, ndf: 14, adf: 9, starch: 2, sugar: 8, nfc: 30, rdp: 65, rup: 35,
  solCP: 20, ndicp: 10, adicp: 3, pa: 5, nel: 1.9,
};
const cornSilage = {
  id: 'cs', category: 'roughage',
  cp: 8, ndf: 42, aNDF: 40, adf: 25, starch: 25, sugar: 2, nfc: 35, dm: 35, nel: 1.5,
};
const matureHay = {
  id: 'hay', category: 'roughage',
  cp: 7, ndf: 65, aNDF: 62, adf: 42, starch: 1, sugar: 3, nfc: 10, dm: 90, nel: 1.0,
};
const fat = {
  id: 'fat', category: 'fat',
  cp: 0, ndf: 0, adf: 0, starch: 0, sugar: 0, nfc: 0, nel: 5.5,
};

const kpTypical = { liquid: 8, concentrate: 3, roughage: 3 };

describe('FAZ 19.1a — cncpsFeedSupply (CNCPS arz katsayıları)', () => {
  it('Tüm beklenen alanları döndürür; tipik yemde havuzlar pozitif', () => {
    const s = cncpsFeedSupply(corn, kpTypical);
    for (const k of ['mpEnergyPool', 'mpRdpPool', 'mpRUP', 'mpMicrobial', 'mpTotal',
                     'rdpPct', 'rupPct', 'kpSolid']) {
      expect(s).toHaveProperty(k);
      expect(Number.isFinite(s[k])).toBe(true);
    }
    expect(s.mpEnergyPool).toBeGreaterThan(0);
    expect(s.mpRdpPool).toBeGreaterThan(0);
    expect(s.mpRUP).toBeGreaterThanOrEqual(0);
    expect(s.rdpPct + s.rupPct).toBeCloseTo(100, 4);  // RDP + RUP = %100 CP
  });

  it('Rasyon-düzeyi tutarlılık: mpMicrobial = min(enerji, RDP); mpTotal = mikrobiyal + RUP', () => {
    const s = cncpsFeedSupply(sbm, kpTypical);
    expect(s.mpMicrobial).toBeCloseTo(Math.min(s.mpEnergyPool, s.mpRdpPool), 6);
    expect(s.mpTotal).toBeCloseTo(Math.min(s.mpEnergyPool, s.mpRdpPool) + s.mpRUP, 6);
  });

  it('Enerji-yolu NRC TDN temelliyle BİREBİR (v1: enerji pasaj-bağımsız)', () => {
    // v1 kapsam kararı: enerji-MCP NRC TDN temelinde kalır (pasaj-bağımlılık yalnız proteinde)
    // → cncpsFeedSupply.mpEnergyPool, lpBuilder.mpComponentsPerKgDM ile birebir olmalı.
    const s = cncpsFeedSupply(corn, kpTypical);
    const nrc = mpComponentsPerKgDM(corn);
    expect(s.mpEnergyPool).toBeCloseTo(nrc.mpEnergyPool, 6);
  });

  it('Pasaj duyarlılığı (protein): yüksek kp → RDP↓ / RUP↑ / mpRUP↑ / mpRdpPool↓', () => {
    const lowKp = { liquid: 6, concentrate: 2, roughage: 2 };
    const highKp = { liquid: 10, concentrate: 6, roughage: 6 };
    const sLow = cncpsFeedSupply(sbm, lowKp);
    const sHigh = cncpsFeedSupply(sbm, highKp);
    expect(sHigh.rdpPct).toBeLessThan(sLow.rdpPct);
    expect(sHigh.rupPct).toBeGreaterThan(sLow.rupPct);
    expect(sHigh.mpRUP).toBeGreaterThan(sLow.mpRUP);
    expect(sHigh.mpRdpPool).toBeLessThan(sLow.mpRdpPool);
  });

  it('Enerji havuzu pasajdan BAĞIMSIZ (v1: enerji-MCP NRC TDN temelinde)', () => {
    const lowKp = { liquid: 6, concentrate: 2, roughage: 2 };
    const highKp = { liquid: 10, concentrate: 6, roughage: 6 };
    expect(cncpsFeedSupply(corn, highKp).mpEnergyPool).toBeCloseTo(cncpsFeedSupply(corn, lowKp).mpEnergyPool, 6);
  });

  it('Enerji havuzu enerji yoğunluğunu yansıtır: yüksek-NEL tahıl > düşük-NEL kuru ot', () => {
    const sCorn = cncpsFeedSupply(corn, kpTypical);
    const sHay = cncpsFeedSupply(matureHay, kpTypical);
    expect(sCorn.mpEnergyPool).toBeGreaterThan(sHay.mpEnergyPool);  // corn nel 2.0 > hay nel 1.0
  });

  it('kpSolid seçimi: roughage → kp.roughage, konsantre → kp.concentrate', () => {
    const kp = { liquid: 8, concentrate: 3, roughage: 5 };
    expect(cncpsFeedSupply(cornSilage, kp).kpSolid).toBeCloseTo(5, 2);  // roughage
    expect(cncpsFeedSupply(corn, kp).kpSolid).toBeCloseTo(3, 2);        // concentrate
  });

  it('Kenar durum: yağ/protein-sız yem → mikrobiyal/RUP ≈ 0, NaN yok', () => {
    const s = cncpsFeedSupply(fat, kpTypical);
    expect(Number.isFinite(s.mpEnergyPool)).toBe(true);
    expect(s.mpRdpPool).toBeCloseTo(0, 6);   // cp 0 → rdp 0
    expect(s.mpRUP).toBeCloseTo(0, 6);
    expect(s.mpTotal).toBeCloseTo(0, 6);
  });

  it('Guard: feed veya kp eksikse sıfır katsayılar (çökme yok)', () => {
    expect(cncpsFeedSupply(null, kpTypical).mpTotal).toBe(0);
    expect(cncpsFeedSupply(corn, null).mpTotal).toBe(0);
  });
});

describe('FAZ 19.1a — cncpsRationInputs (pasaj-hızı girdileri)', () => {
  const ration = [
    { feed: corn, dmKg: 8 },
    { feed: cornSilage, dmKg: 10 },
    { feed: sbm, dmKg: 2 },
  ];

  it('NDF% KM-ağırlıklı; konsantre oranı; ME alımı (NEL×1.64) doğru', () => {
    const inp = cncpsRationInputs(ration, 20);
    // ndfPct = (9×8 + 42×10 + 14×2)/20 = 520/20 = 26
    expect(inp.ndfPct).toBeCloseTo(26, 1);
    // concentrateRatio = (8 + 2)/20 = 0.5 (cornSilage roughage; corn+sbm konsantre)
    expect(inp.concentrateRatio).toBeCloseTo(0.5, 3);
    // meIntake = (2.0×8 + 1.5×10 + 1.9×2) × 1.64 = 34.8 × 1.64 = 57.07
    expect(inp.meIntake).toBeCloseTo(57.07, 1);
  });

  it('Kenar durum: boş/0 → tüm girdiler 0', () => {
    expect(cncpsRationInputs([], 0)).toEqual({ ndfPct: 0, concentrateRatio: 0, meIntake: 0 });
    expect(cncpsRationInputs(null, 20)).toEqual({ ndfPct: 0, concentrateRatio: 0, meIntake: 0 });
  });

  it('Uçtan uca (saf): rasyon girdileri → calcPassageRates → cncpsFeedSupply makul', () => {
    const inp = cncpsRationInputs(ration, 20);
    const kp = calcPassageRates({
      dmi: 20, bw: 600, ndfPct: inp.ndfPct, meIntake: inp.meIntake, concentrateRatio: inp.concentrateRatio,
    });
    expect(kp.concentrate).toBeGreaterThan(0);
    const s = cncpsFeedSupply(corn, kp);
    expect(s.mpTotal).toBeGreaterThan(0);
    expect(Number.isFinite(s.mpTotal)).toBe(true);
  });
});

describe('FAZ 19.1b — buildRationLP cncpsCoef kablajı', () => {
  const lpFeeds = [
    { id: 'f_grain', category: 'grain', dm: 88, tdn: 88, nel: 2.0, cp: 9, ndf: 10, rdp: 60, rup: 40, pricePerTon: 9000 },
    { id: 'f_prot', category: 'protein', dm: 90, tdn: 84, nel: 1.9, cp: 48, ndf: 14, rdp: 65, rup: 35, pricePerTon: 18000 },
  ];
  const reqMP = { mp_g: 1500 };
  const coefFull = {
    f_grain: { mpEnergyPool: 50, mpRdpPool: 30, mpRUP: 10, mpTotal: 40 },
    f_prot:  { mpEnergyPool: 40, mpRdpPool: 60, mpRUP: 25, mpTotal: 65 },
  };

  it('cncpsCoef verilince MP (enerji) ve MP_RDP katsayıları CNCPS havuzlarını yansıtır', () => {
    const lp = buildRationLP({ feeds: lpFeeds, dmi_kg: 20, requirements: reqMP, cncpsCoef: coefFull });
    const mp = lp.subjectTo.find(c => c.name === 'MP');
    const mpRdp = lp.subjectTo.find(c => c.name === 'MP_RDP');
    // MP (enerji yolu) = mpRUP + mpEnergyPool
    expect(mp.vars[0].coef).toBeCloseTo(10 + 50, 6);
    expect(mp.vars[1].coef).toBeCloseTo(25 + 40, 6);
    // MP_RDP (RDP yolu) = mpRUP + mpRdpPool
    expect(mpRdp.vars[0].coef).toBeCloseTo(10 + 30, 6);
    expect(mpRdp.vars[1].coef).toBeCloseTo(25 + 60, 6);
  });

  it('cncpsCoef yoksa (default) katsayılar NRC mpComponentsPerKgDM ile birebir (geriye uyumlu)', () => {
    const lp = buildRationLP({ feeds: lpFeeds, dmi_kg: 20, requirements: reqMP });
    const mp = lp.subjectTo.find(c => c.name === 'MP');
    const c0 = mpComponentsPerKgDM(lpFeeds[0]);
    expect(mp.vars[0].coef).toBeCloseTo(c0.mpRUP + c0.mpEnergyPool, 6);  // energyDiscount=1
  });

  it('feedIntakeDiscountFactor enerji havuzuna her iki modda uygulanır (CNCPS enerji = NRC TDN temelli)', () => {
    // FAZ 19.1c: CNCPS modunda da enerji havuzu NRC TDN temellidir (pasaj-bağımlılık yalnız
    // proteinde) → tüketim-düzeyi iskonto her iki modda enerji havuzuna uygulanır.
    const lpC = buildRationLP({ feeds: lpFeeds, dmi_kg: 20, requirements: reqMP, cncpsCoef: coefFull, intakeMultiple: 3 });
    const mpC = lpC.subjectTo.find(c => c.name === 'MP');
    const feedDisc = feedIntakeDiscountFactor(lpFeeds[0], 3);
    expect(mpC.vars[0].coef).toBeCloseTo(10 + 50 * feedDisc, 6);  // CNCPS havuzuna da iskonto
    const lpN = buildRationLP({ feeds: lpFeeds, dmi_kg: 20, requirements: reqMP, intakeMultiple: 3 });
    const mpN = lpN.subjectTo.find(c => c.name === 'MP');
    const c0 = mpComponentsPerKgDM(lpFeeds[0]);
    expect(mpN.vars[0].coef).toBeCloseTo(c0.mpRUP + c0.mpEnergyPool * feedDisc, 6);
  });

  it('Kısmi cncpsCoef: kapsanmayan yem NRC fallback alır', () => {
    const partial = { f_grain: { mpEnergyPool: 50, mpRdpPool: 30, mpRUP: 10, mpTotal: 40 } };
    const lp = buildRationLP({ feeds: lpFeeds, dmi_kg: 20, requirements: reqMP, cncpsCoef: partial });
    const mpRdp = lp.subjectTo.find(c => c.name === 'MP_RDP');
    const cProt = mpComponentsPerKgDM(lpFeeds[1]);  // f_prot cncpsCoef'te yok
    expect(mpRdp.vars[1].coef).toBeCloseTo(cProt.mpRUP + cProt.mpRdpPool, 6);
  });

  it('mp_g_max CNCPS modunda İKİ havuz üst kısıtı (CNCPS havuz katsayıları)', () => {
    // SAHA-DENETİM A: dual-havuz üst sınırı CNCPS modunda da cncpsCoef havuzlarını kullanır.
    const lp = buildRationLP({ feeds: lpFeeds, dmi_kg: 20, requirements: { mp_g: 1500, mp_g_max: 2500 }, cncpsCoef: coefFull });
    const mpMax = lp.subjectTo.find(c => c.name === 'MP_max');          // enerji-havuz: mpRUP+mpEnergyPool
    const mpRdpMax = lp.subjectTo.find(c => c.name === 'MP_RDP_max');   // RDP-havuz: mpRUP+mpRdpPool
    expect(mpMax.vars[0].coef).toBeCloseTo(10 + 50, 6);    // f_grain: mpRUP+mpEnergyPool
    expect(mpMax.vars[1].coef).toBeCloseTo(25 + 40, 6);    // f_prot
    expect(mpRdpMax.vars[0].coef).toBeCloseTo(10 + 30, 6); // f_grain: mpRUP+mpRdpPool
    expect(mpRdpMax.vars[1].coef).toBeCloseTo(25 + 60, 6); // f_prot
  });
});

describe('FAZ 19.1c — optimizeRation iteratif CNCPS motoru (uçtan uca)', () => {
  const ENGINE_FEEDS = [
    { id: 'corn_silage', name: 'Mısır Silajı', category: 'roughage',
      dm: 33, nel: 1.72, cp: 8.2, rup: 15, rdp: 85, ndf: 44, adf: 27, aNDF: 42, nfc: 36, starch: 28, sugar: 1,
      fat: 3.3, ash: 4.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09, pricePerTon: 2500 },
    { id: 'alfalfa_hay', name: 'Yonca', category: 'roughage',
      dm: 89, nel: 1.30, cp: 18, rup: 20, rdp: 80, ndf: 42, adf: 32, aNDF: 39, nfc: 25, starch: 2, sugar: 4,
      fat: 2, ash: 11, ca: 1.45, p: 0.30, mg: 0.32, k: 2.50, na: 0.10, s: 0.27, cl: 0.40, pricePerTon: 6000 },
    { id: 'corn_grain', name: 'Mısır Tane', category: 'grain',
      dm: 88, nel: 2.0, cp: 9, rup: 50, rdp: 50, ndf: 10, adf: 3, aNDF: 8, nfc: 74, starch: 72, sugar: 2,
      fat: 4, ash: 1.4, ca: 0.02, p: 0.28, mg: 0.10, k: 0.38, na: 0.01, s: 0.10, cl: 0.05, pricePerTon: 9000 },
    { id: 'soybean_meal', name: 'Soya Küspesi', category: 'protein',
      dm: 89, nel: 1.99, cp: 48, rup: 35, rdp: 65, ndf: 10, adf: 5, aNDF: 8, nfc: 28, starch: 2, sugar: 8,
      fat: 1.5, ash: 7, ca: 0.33, p: 0.70, mg: 0.30, k: 2.20, na: 0.02, s: 0.45, cl: 0.04, pricePerTon: 18000 },
    { id: 'limestone', name: 'Kireçtaşı', category: 'mineral',
      dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
      ca: 38, p: 0, mg: 0.35, k: 0, na: 0, s: 0, cl: 0, pricePerTon: 3000 },
    { id: 'dcp', name: 'DCP', category: 'mineral',
      dm: 97, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
      ca: 22, p: 18, mg: 0.6, k: 0, na: 0.10, s: 0.80, cl: 0, pricePerTon: 15000 },
    { id: 'salt', name: 'Tuz', category: 'mineral',
      dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
      ca: 0, p: 0, mg: 0, k: 0, na: 39, s: 0, cl: 60, pricePerTon: 2000 },
  ];
  const ANIMAL = {
    bw: 600, parity: 2, dim: 60, milkYield: 35, milkFat: 3.7, milkProtein: 3.2, milkLactose: 4.8,
    bcs: 3.0, targetBcs: 3.0, pregnant: false, gestDays: 0, dailyWalkKm: 0,
  };
  const LIMITS = {
    alfalfa_hay: { maxPct: 40 }, corn_silage: { maxPct: 40, minPct: 15 },
    corn_grain: { maxPct: 35 }, soybean_meal: { maxPct: 25 }, salt: { maxPct: 1 },
  };

  it('CNCPS modu fizibil çözüm + motor meta (yakınsar, pasaj hızları) üretir', async () => {
    const r = await optimizeRation({ animal: ANIMAL, feeds: ENGINE_FEEDS, feedLimits: LIMITS, calcMode: 'cncps' });
    expect(r.feasible).toBe(true);
    expect(r.cncps).toBeTruthy();
    expect(r.cncps.mode).toBe('cncps');
    expect(r.cncps.iterations).toBeGreaterThanOrEqual(1);
    expect(r.cncps.iterations).toBeLessThanOrEqual(5);
    expect(r.cncps.converged).toBe(true);
    expect(r.cncps.passageRates.liquid).toBeGreaterThan(0);
    expect(r.cncps.passageRates.concentrate).toBeGreaterThan(0);
    expect(r.cncps.passageRates.roughage).toBeGreaterThan(0);
  });

  it('NRC modu (varsayılan) motor meta üretmez → geriye uyumlu', async () => {
    const r = await optimizeRation({ animal: ANIMAL, feeds: ENGINE_FEEDS, feedLimits: LIMITS });
    expect(r.feasible).toBe(true);
    expect(r.cncps == null).toBe(true);  // null veya undefined
  });

  it('CNCPS modu MP gereksinimini karşılar (composition.mp_g ≥ gereksinim)', async () => {
    const r = await optimizeRation({ animal: ANIMAL, feeds: ENGINE_FEEDS, feedLimits: LIMITS, calcMode: 'cncps' });
    expect(r.composition.mp_g).toBeGreaterThan(0);
    expect(r.composition.mp_g).toBeGreaterThanOrEqual(r.requirements.mp.total * 0.97);
  });

  it('CNCPS modu raporu (composition.mp_g) yakınsamış CNCPS arzıyla tutarlı (NRC değil)', async () => {
    const r = await optimizeRation({ animal: ANIMAL, feeds: ENGINE_FEEDS, feedLimits: LIMITS, calcMode: 'cncps' });
    const kp = r.cncps.passageRates;
    const byId = new Map(ENGINE_FEEDS.map(f => [f.id, f]));
    let mpRUP = 0, ePool = 0, rPool = 0;
    for (const it of r.items) {
      const f = byId.get(it.id); if (!f) continue;
      const s = cncpsFeedSupply(f, kp);
      mpRUP += it.dmKg * s.mpRUP; ePool += it.dmKg * s.mpEnergyPool; rPool += it.dmKg * s.mpRdpPool;
    }
    const cncpsMp = mpRUP + Math.min(ePool, rPool);
    // Damping nedeniyle birebir değil; yakınsamada CNCPS-recompute'a yakın (±%10) → rapor CNCPS'i yansıtır
    expect(Math.abs(r.composition.mp_g - cncpsMp) / cncpsMp).toBeLessThan(0.10);
  });

  it('Her iki mod da fizibil; CNCPS motoru rasyonu bozmaz', async () => {
    const nrc = await optimizeRation({ animal: ANIMAL, feeds: ENGINE_FEEDS, feedLimits: LIMITS });
    const cnc = await optimizeRation({ animal: ANIMAL, feeds: ENGINE_FEEDS, feedLimits: LIMITS, calcMode: 'cncps' });
    expect(nrc.feasible).toBe(true);
    expect(cnc.feasible).toBe(true);
    expect(cnc.composition.mp_g).toBeGreaterThan(0);
  });
});

describe('FAZ 24.1 — Ölçülü CNCPS kd ve Protein Veri Kaynağı', () => {
  const kp = { liquid: 8, concentrate: 3, roughage: 3 };

  it("cncpsProteinDataSource: solCP+ndicp+adicp ve (protKdB1/2) varsa 'measured'", () => {
    // Sadece fraksiyonlar yetmez, kd de lazım
    expect(cncpsProteinDataSource({ cp: 48, solCP: 16, ndicp: 3, adicp: 1 })).toBe('derived');
    // kd eklenince measured
    expect(cncpsProteinDataSource({ cp: 48, solCP: 16, ndicp: 3, adicp: 1, protKdB1: 15 })).toBe('measured');
  });

  it("cncpsProteinDataSource: eksik girdi → 'derived'", () => {
    expect(cncpsProteinDataSource({ cp: 48, solCP: 16 })).toBe('derived');
    expect(cncpsProteinDataSource({ cp: 9, rdp: 50 })).toBe('derived');
    expect(cncpsProteinDataSource(null)).toBe('derived');
  });

  it('cncpsFeedSupply dönüşünde dataSource alanı doğru', () => {
    expect(cncpsFeedSupply({ category: 'protein', cp: 48, rdp: 65, solCP: 16, ndicp: 3, adicp: 1, protKdB1: 15 }, kp).dataSource).toBe('measured');
    expect(cncpsFeedSupply({ category: 'protein', cp: 48, rdp: 65 }, kp).dataSource).toBe('derived');
  });

  it('FAZ 24.1: Ölçülü kd VARSA motor gerçek RDP hesaplar (derived moddan farklı)', () => {
    // Soya: kitap rdp 65. Derived modda kp=3 ile passageRDPFraction(65, 3) döner.
    const base = { category: 'protein', cp: 48, rdp: 65, rup: 35 };
    const withFractions = { ...base, solCP: 16, ndicp: 3, adicp: 1, protKdB1: 99, protKdB2: 50 }; // Çok hızlı kd'ler → yüksek RDP
    
    const a = cncpsFeedSupply(base, kp);
    const b = cncpsFeedSupply(withFractions, kp);
    
    expect(a.dataSource).toBe('derived');
    expect(b.dataSource).toBe('measured');
    
    // b.rdpPct, a.rdpPct'den farklı olmalı çünkü a kitap rdp'den (65) türetilirken b gerçek formülle hesaplanır.
    expect(b.rdpPct).not.toBeCloseTo(a.rdpPct, 1);
  });

  it('FAZ 24.1: Kalibrasyon uyarısı (ölçülü RDP ile kitap değeri arasında >%15 fark)', () => {
    // Kitap değeri rdp: 30 (yani düşük). Ama biz ölçülü olarak çok hızlı kd verdik, RDP > 80 çıkacak.
    const feed = { category: 'protein', cp: 48, rdp: 30, rup: 70, solCP: 20, ndicp: 5, adicp: 2, protKdB1: 150, protKdB2: 20 };
    const s = cncpsFeedSupply(feed, kp);
    expect(s.dataSource).toBe('measured');
    expect(s.calibrationWarning).toBeDefined();
    expect(s.calibrationWarning).toContain('yüksek sapma');
  });
});

describe('FAZ 19 denetim — tutarlılık regresyon kilitleri (audit)', () => {
  const AUDIT_FEEDS = [
    { id:'cs', name:'Mısır Silajı', category:'roughage', dm:33, nel:1.72, tdn:70, cp:8.2, rup:15, rdp:85, ndf:44, adf:27, aNDF:42, nfc:36, starch:28, sugar:1, fat:3.3, ash:4.3, ca:0.24, p:0.22, mg:0.15, k:1.05, na:0.01, s:0.11, cl:0.09, pricePerTon:2500 },
    { id:'alf', name:'Yonca', category:'roughage', dm:89, nel:1.30, tdn:58, cp:18, rup:20, rdp:80, ndf:42, adf:32, aNDF:39, nfc:25, starch:2, sugar:4, fat:2, ash:11, ca:1.45, p:0.30, mg:0.32, k:2.50, na:0.10, s:0.27, cl:0.40, pricePerTon:6000 },
    { id:'corn', name:'Mısır', category:'grain', dm:88, nel:2.0, tdn:87, cp:9, rup:50, rdp:50, ndf:10, adf:3, aNDF:8, nfc:74, starch:72, sugar:2, fat:4, ash:1.4, ca:0.02, p:0.28, mg:0.10, k:0.38, na:0.01, s:0.10, cl:0.05, pricePerTon:9000 },
    { id:'sbm', name:'Soya', category:'protein', dm:89, nel:1.99, tdn:84, cp:48, rup:35, rdp:65, ndf:10, adf:5, aNDF:8, nfc:28, starch:2, sugar:8, fat:1.5, ash:7, ca:0.33, p:0.70, mg:0.30, k:2.20, na:0.02, s:0.45, cl:0.04, pricePerTon:18000 },
    { id:'lime', name:'Kireç', category:'mineral', dm:99, nel:0, cp:0, ndf:0, adf:0, aNDF:0, nfc:0, fat:0, ash:100, ca:38, p:0, mg:0.35, k:0, na:0, s:0, cl:0, pricePerTon:3000 },
    { id:'dcp', name:'DCP', category:'mineral', dm:97, nel:0, cp:0, ndf:0, adf:0, aNDF:0, nfc:0, fat:0, ash:100, ca:22, p:18, mg:0.6, k:0, na:0.1, s:0.8, cl:0, pricePerTon:15000 },
    { id:'salt', name:'Tuz', category:'mineral', dm:99, nel:0, cp:0, ndf:0, adf:0, aNDF:0, nfc:0, fat:0, ash:100, ca:0, p:0, mg:0, k:0, na:39, s:0, cl:60, pricePerTon:2000 },
  ];
  const ANIMAL = { bw:600, parity:2, dim:60, milkYield:35, milkFat:3.7, milkProtein:3.2, milkLactose:4.8, bcs:3.0, targetBcs:3.0, pregnant:false, gestDays:0, dailyWalkKm:0 };
  const LIMITS = { alf:{maxPct:40}, cs:{maxPct:40,minPct:15}, corn:{maxPct:35}, sbm:{maxPct:25}, salt:{maxPct:1} };

  it('CNCPS modu ENERJİYİ değiştirmez: nel_mcal NRC ile birebir (v1 kapsam kilidi)', async () => {
    const nrc = await optimizeRation({ animal: ANIMAL, feeds: AUDIT_FEEDS, feedLimits: LIMITS });
    const cnc = await optimizeRation({ animal: ANIMAL, feeds: AUDIT_FEEDS, feedLimits: LIMITS, calcMode: 'cncps' });
    // Enerji-MCP NRC TDN temelinde kalır → iki modda nel_mcal aynı olmalı (yalnız protein pasajı değişir).
    expect(cnc.composition.nel_mcal).toBeCloseTo(nrc.composition.nel_mcal, 2);
  });

  it('CNCPS modu: composition.mp_g LP ile tutarlı (gereksinimi karşılar, fizibil, yakınsar)', async () => {
    const cnc = await optimizeRation({ animal: ANIMAL, feeds: AUDIT_FEEDS, feedLimits: LIMITS, calcMode: 'cncps' });
    expect(cnc.feasible).toBe(true);
    expect(cnc.cncps.converged).toBe(true);
    // LP↔rapor: ulaşılan MP gereksinimi karşılar (aggregateComposition LP ile aynı cncpsCoef'i kullanır)
    expect(cnc.composition.mp_g).toBeGreaterThanOrEqual(cnc.requirements.mp.total * 0.999);
  });
});

describe('FAZ 24.2 — CNCPS-ME Fermente-CHO Enerji Havuzu', () => {
  const kp = { liquid: 10, concentrate: 5, roughage: 3 };

  it('Ölçülü kd OLAN yemde mpEnergyPool fermente-CHO tabanlı hesaplanır (isCncpsEnergy=true)', () => {
    const measuredFeed = {
      category: 'protein', cp: 48, rdp: 65, rup: 35,
      ndf: 10, adf: 5, nfc: 28, starch: 2, sugar: 8, fat: 1.5, ash: 7,
      solCP: 16, ndicp: 3, adicp: 1, protKdB1: 15, choKdB1: 200, choKdB2: 20
    };
    const s = cncpsFeedSupply(measuredFeed, kp);
    expect(s.isCncpsEnergy).toBe(true);
    expect(s.mpEnergyPool).toBeGreaterThan(0);
    
    const derivedFeed = { category: 'protein', cp: 48, rdp: 65, tdn: 84 };
    const s2 = cncpsFeedSupply(derivedFeed, kp);
    expect(s2.isCncpsEnergy).toBe(false);
    expect(s.mpEnergyPool).not.toBeCloseTo(s2.mpEnergyPool, 0);
  });

  it('feedIntakeDiscountFactor çifte sayımı önlenir (lpBuilder.js)', () => {
    const lpFeeds = [
      { id: 'f_measured', category: 'roughage', dm: 33, cp: 8, tdn: 70 },
      { id: 'f_derived', category: 'grain', dm: 88, cp: 9, tdn: 87 }
    ];
    const reqMP = { mp_g: 1000 };
    const coefFull = {
      f_measured: { mpEnergyPool: 50, mpRdpPool: 30, mpRUP: 10, mpTotal: 40, isCncpsEnergy: true },
      f_derived:  { mpEnergyPool: 40, mpRdpPool: 60, mpRUP: 25, mpTotal: 65, isCncpsEnergy: false },
    };
    
    // intakeMultiple: 3
    const lp = buildRationLP({ feeds: lpFeeds, dmi_kg: 20, requirements: reqMP, cncpsCoef: coefFull, intakeMultiple: 3 });
    const mp = lp.subjectTo.find(c => c.name === 'MP');
    
    // isCncpsEnergy: true olan f_measured -> feedIntakeDiscountFactor uygulanmaz (× 1.0)
    expect(mp.vars[0].coef).toBeCloseTo(10 + 50 * 1.0, 6);
    
    // isCncpsEnergy: false olan f_derived -> feedIntakeDiscountFactor uygulanır
    const feedDisc = feedIntakeDiscountFactor(lpFeeds[1], 3);
    expect(mp.vars[1].coef).toBeCloseTo(25 + 40 * feedDisc, 6);
  });
});
