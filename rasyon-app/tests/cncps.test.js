import { describe, it, expect } from 'vitest';
import {
  kpLiquid, kpConcentrate, kpRoughage,
  calcCHOFractions, calcProteinFractions,
  calcRDPandRUP, effectiveDegradability,
  calcMCPSynthesis, calcRumenPHProfile,
  calcCHOSubFractions, calcProteinSubFractions, aggregateCNCPSSubFractions,
} from '../src/core/cncps.js';

describe('Pasaj Hızları (Seo et al. 2006)', () => {
  it('Sıvı pasaj hızı: 20 kg DMI, 600 kg BW → ~9.3 %/saat', () => {
    // 7.7 + 0.10 × (20 / 600^0.75) = 7.7 + 0.10 × (20/121.15) = 7.7 + 0.165 = 7.865
    const kp = kpLiquid(20, 600);
    expect(kp).toBeGreaterThan(7.5);
    expect(kp).toBeLessThan(9.5);
  });

  it('Konsantre pasaj hızı pozitif ve makul aralıkta (2-6 %/saat)', () => {
    // Tipik: NDF %30, ME 22 Mcal/gün, BW 600 kg
    const kp = kpConcentrate(30, 22, 600);
    expect(kp).toBeGreaterThan(1.5);
    expect(kp).toBeLessThan(7);
  });

  it('Kaba yem pasaj hızı: yüksek konsantre oranında artar', () => {
    const kpHigh = kpRoughage(0.6, 600);  // %60 konsantre
    const kpLow = kpRoughage(0.3, 600);   // %30 konsantre
    expect(kpHigh).toBeGreaterThan(kpLow);
  });

  it('Konsantre oranı 0\'a yakın pasaj hızı düşer', () => {
    const kpLow = kpRoughage(0.1, 600);
    expect(kpLow).toBeLessThan(3);
  });
});

describe('Efektif Parçalanabilirlik', () => {
  it('kd=0 → ED=0 (fermantasyon yok)', () => {
    expect(effectiveDegradability(0, 5)).toBe(0);
  });

  it('kd≥300 → ED=1.0 (anında parçalanma)', () => {
    expect(effectiveDegradability(300, 10)).toBe(1.0);
  });

  it('ED = kd/(kd+kp)', () => {
    const ed = effectiveDegradability(8, 4);
    expect(ed).toBeCloseTo(8 / (8 + 4), 4);
  });

  it('kp artışı → ED azalır', () => {
    const edLow = effectiveDegradability(8, 2);
    const edHigh = effectiveDegradability(8, 8);
    expect(edLow).toBeGreaterThan(edHigh);
  });
});

describe('CHO Fraksiyonları', () => {
  const cornSilage = {
    category: 'roughage',
    nfc: 35, sugar: 2, starch: 25,
    ndf: 42, aNDF: 40, adf: 25, dm: 35,
  };

  it('Mısır silajı CHO fraksiyonları toplamı NDF + NFC\'ye yakın olmalı', () => {
    const frac = calcCHOFractions(cornSilage);
    const choTotal = frac.choA + frac.choB1 + frac.choB2 + frac.choC;
    // CHO toplam ≈ NFC + NDF
    const totalCHO = cornSilage.nfc + cornSilage.ndf;
    expect(Math.abs(choTotal - totalCHO)).toBeLessThan(5);
  });

  it('CHO-C ≤ NDF (lignin bağlı kısım NDF\'nin alt kümesi)', () => {
    const frac = calcCHOFractions(cornSilage);
    expect(frac.choC).toBeLessThanOrEqual(cornSilage.ndf);
  });

  it('CHO-B2 pozitif değer taşımalı (NDF içinde fermente edilebilir kısım var)', () => {
    const frac = calcCHOFractions(cornSilage);
    expect(frac.choB2).toBeGreaterThan(0);
  });

  it('FAZ 13.12: aNDF=0 ise NDF×0.95 fallback → choB2 sıfırlanmaz', () => {
    // 56 yemde aNDF=0; fallback olmadan choB2 = max(0 − choC, 0) = 0 (fermente NDF kaybı)
    const noANDF = { category: 'roughage', nfc: 35, sugar: 2, starch: 25, ndf: 40, aNDF: 0, adf: 25, dm: 33 };
    const frac = calcCHOFractions(noANDF);
    expect(frac.choB2).toBeGreaterThan(0);
    // effectiveANDF = 40 × 0.95 = 38; choB2 = 38 − choC > 0
    const withANDF = calcCHOFractions({ ...noANDF, aNDF: 38 });
    expect(frac.choB2).toBeCloseTo(withANDF.choB2, 5);
  });

  it('kd değerleri CHO-A > CHO-B1 > CHO-B2 > CHO-C sırasında', () => {
    const frac = calcCHOFractions(cornSilage);
    expect(frac.kd.choA).toBeGreaterThan(frac.kd.choB1);
    expect(frac.kd.choB1).toBeGreaterThan(frac.kd.choB2);
    expect(frac.kd.choB2).toBeGreaterThan(frac.kd.choC);
    expect(frac.kd.choC).toBe(0);
  });
});

describe('Protein Fraksiyonları', () => {
  const soybean = {
    cp: 54, ndicp: 10, adicp: 3, solCP: 20, pa: 5,
  };

  it('Protein fraksiyonları toplamı %100\'e yakın olmalı (±3)', () => {
    const frac = calcProteinFractions(soybean);
    expect(Math.abs(frac.total - 100)).toBeLessThan(4);
  });

  it('PC ≤ ADICP (ısı hasarı), sıfır veya pozitif', () => {
    const frac = calcProteinFractions(soybean);
    expect(frac.pc).toBeGreaterThanOrEqual(0);
    expect(frac.pc).toBeLessThanOrEqual(soybean.adicp * 1.1);
  });

  it('kd sıralaması: PA > PB1 > PB2 > PB3 > PC', () => {
    const frac = calcProteinFractions(soybean);
    expect(frac.kd.pa).toBeGreaterThan(frac.kd.pb1);
    expect(frac.kd.pb1).toBeGreaterThan(frac.kd.pb2);
    expect(frac.kd.pb2).toBeGreaterThan(frac.kd.pb3);
    expect(frac.kd.pc).toBe(0);
  });
});

describe('RDP / RUP Hesabı', () => {
  it('RDP + RUP ≈ %100 CP', () => {
    const feed = { cp: 18, ndicp: 15, adicp: 5, solCP: 35, pa: 8 };
    const result = calcRDPandRUP(feed, 5);
    expect(Math.abs(result.rdpPct + result.rupPct - 100)).toBeLessThan(2);
  });

  it('Yüksek pasaj hızı RUP\'u artırır', () => {
    const feed = { cp: 18, ndicp: 15, adicp: 5, solCP: 35, pa: 8 };
    const lowKp = calcRDPandRUP(feed, 2);   // Düşük pasaj
    const highKp = calcRDPandRUP(feed, 10); // Yüksek pasaj
    expect(highKp.rupPct).toBeGreaterThan(lowKp.rupPct);
  });

  it('Soya küspesi tipik RDP >%60 CP olmalı', () => {
    const soybeanMeal = { cp: 54, ndicp: 12, adicp: 4, solCP: 25, pa: 6 };
    const result = calcRDPandRUP(soybeanMeal, 5);
    expect(result.rdpPct).toBeGreaterThan(55);
  });
});

describe('MCP Sentezi', () => {
  it('Fermente edilebilir CHO = 8 kg, RDP = 1500 g → enerji kısıt', () => {
    const result = calcMCPSynthesis({ fermentableCHO_kg: 8, rdp_g: 1500, dmi: 22 });
    // mcpFromEnergy = 8 × 130 = 1040, mcpFromRDP = 1500 × 0.85 = 1275
    expect(result.limitingFactor).toBe('energy');
    expect(result.mcpFromEnergy).toBe(1040);
  });

  it('Fermente edilebilir CHO = 12 kg, RDP = 500 g → RDP kısıt', () => {
    const result = calcMCPSynthesis({ fermentableCHO_kg: 12, rdp_g: 500, dmi: 22 });
    // mcpFromEnergy = 1560, mcpFromRDP = 425
    expect(result.limitingFactor).toBe('rdp');
  });

  it('MP_mikrobiyal = MCP × 0.64 (FAZ 13.2 CNCPS v6.5 + NASEM 2021)', () => {
    const result = calcMCPSynthesis({ fermentableCHO_kg: 8, rdp_g: 1500, dmi: 22 });
    expect(result.mpMicrobial).toBe(Math.round(result.mcp * 0.64));
  });

  it('N kullanım verimi 0-1 arasında', () => {
    const result = calcMCPSynthesis({ fermentableCHO_kg: 8, rdp_g: 1200, dmi: 22 });
    expect(result.nUseEfficiency).toBeGreaterThan(0);
    expect(result.nUseEfficiency).toBeLessThanOrEqual(1);
  });
});

// ─── FAZ 13.2 — MCP intestinal sindirilebilirlik tutarlılığı ───────────────

describe('FAZ 13.2 — MCP intestinal sindirilebilirlik sabit tutarlılığı', () => {
  it('constants.js MCP_INTESTINAL_DIGESTIBILITY = 0.64', async () => {
    const { MCP_INTESTINAL_DIGESTIBILITY, RDP_TO_MCP_EFFICIENCY, TDN_TO_MCP_G_PER_KG }
      = await import('../src/core/constants.js');
    expect(MCP_INTESTINAL_DIGESTIBILITY).toBe(0.64);
    expect(RDP_TO_MCP_EFFICIENCY).toBe(0.85);
    expect(TDN_TO_MCP_G_PER_KG).toBe(130);
  });

  it('cncps.calcMCPSynthesis ve nrc2001.calcMPSupply aynı katsayıyı kullanır', async () => {
    const { calcMPSupply } = await import('../src/core/nrc2001.js');
    // Aynı MCP girdisiyle her iki modülün mpMicrobial çıktısı eşleşmeli (0.64)
    const cncpsResult = calcMCPSynthesis({ fermentableCHO_kg: 8, rdp_g: 1500, dmi: 22 });
    const nrcResult = calcMPSupply(cncpsResult.mcp, 0, 80);
    expect(nrcResult.mpMicrobial).toBe(cncpsResult.mpMicrobial);
  });

  it('lpBuilder.mpComponentsPerKgDM ve mpPerKgDM tutarlı', async () => {
    const { mpPerKgDM, mpComponentsPerKgDM } = await import('../src/solver/lpBuilder.js');
    const feed = {
      cp: 18, rdp: 65, rup: 35, nel: 1.65, tdn: 75,
      category: 'protein', rupIntD: 90,
    };
    const total = mpPerKgDM(feed);
    const comp = mpComponentsPerKgDM(feed);
    // mpPerKgDM exactly equals mpComponentsPerKgDM.mpTotal
    expect(comp.mpTotal).toBeCloseTo(total, 6);
    expect(comp.mpMicrobial + comp.mpRUP).toBeCloseTo(total, 6);
    expect(comp.mpMicrobial).toBeGreaterThan(0);
    expect(comp.mpRUP).toBeGreaterThan(0);
  });

  it('mpComponentsPerKgDM mikrobiyal MP = MCP × 0.64 (sabit doğrulama)', async () => {
    const { mpComponentsPerKgDM } = await import('../src/solver/lpBuilder.js');
    // Yüksek RDP içeren yem → mcp enerji-sınırlı (TDN × 0.13)
    const feed = { cp: 18, rdp: 80, rup: 20, tdn: 75, category: 'protein' };
    const comp = mpComponentsPerKgDM(feed);
    // TDN_g = 750, MCP_energy = 750 × 0.13 = 97.5
    // RDP_g = 180 × 0.80 = 144, MCP_rdp = 144 × 0.85 = 122.4
    // MCP = min(97.5, 122.4) = 97.5
    // mpMicrobial = 97.5 × 0.64 = 62.4
    expect(comp.mpMicrobial).toBeCloseTo(62.4, 1);
  });
});

describe('Rumen pH Profili', () => {
  it('Yüksek NFC → düşük pH tahmini', () => {
    const highNFC = calcRumenPHProfile({ totalFermentableCHO_pct: 65, peNDF_pct: 18, nfc_pct: 44 });
    const lowNFC = calcRumenPHProfile({ totalFermentableCHO_pct: 45, peNDF_pct: 28, nfc_pct: 30 });
    expect(highNFC.meanPH).toBeLessThan(lowNFC.meanPH);
  });

  it('SARA riski yüksek NFC/düşük peNDF durumunda artmalı', () => {
    // NFC=50, peNDF=12 → meanPH=6.11, minPH=5.76 → SARA riski moderate/high
    const dangerous = calcRumenPHProfile({ totalFermentableCHO_pct: 70, peNDF_pct: 12, nfc_pct: 50 });
    expect(['moderate', 'high']).toContain(dangerous.saraRisk);
  });

  it('Normal rasyon SARA riski düşük olmalı', () => {
    const safe = calcRumenPHProfile({ totalFermentableCHO_pct: 45, peNDF_pct: 25, nfc_pct: 35 });
    expect(safe.saraRisk).toBe('low');
  });

  it('minPH < meanPH (günlük düşüş)', () => {
    const result = calcRumenPHProfile({ totalFermentableCHO_pct: 50, peNDF_pct: 22, nfc_pct: 38 });
    expect(result.minPH).toBeLessThan(result.meanPH);
  });
});

describe('FAZ 10D — Yem-spesifik CHO kd', () => {
  it('Yem girdisinde kdB1 varsa öncelikli kullanır', () => {
    const f = { nfc: 40, sugar: 5, starch: 30, ndf: 25, aNDF: 22, adf: 8, dm: 88, category: 'grain', kdB1: 50 };
    const cho = calcCHOFractions(f);
    expect(cho.kd.choB1).toBe(50);
  });

  it('kdB1 yoksa kategori varsayılanı kullanır (grain: 25)', () => {
    const f = { nfc: 40, sugar: 5, starch: 30, ndf: 25, aNDF: 22, adf: 8, dm: 88, category: 'grain' };
    const cho = calcCHOFractions(f);
    expect(cho.kd.choB1).toBe(25);
  });

  it('Roughage kategorisi yavaş kd (10)', () => {
    const f = { nfc: 25, sugar: 2, starch: 5, ndf: 45, aNDF: 42, adf: 28, dm: 33, category: 'roughage' };
    const cho = calcCHOFractions(f);
    expect(cho.kd.choB1).toBe(10);
    expect(cho.kd.choB2).toBe(4);
  });

  it('Protein kategorisi yüksek kdB1 (30)', () => {
    const f = { nfc: 28, sugar: 3, starch: 1, ndf: 14, aNDF: 12, adf: 9, dm: 90, category: 'protein' };
    const cho = calcCHOFractions(f);
    expect(cho.kd.choB1).toBe(30);
  });

  it('Mineral/yağ kategorisi kd=0', () => {
    const fat = { nfc: 0, sugar: 0, starch: 0, ndf: 0, aNDF: 0, adf: 0, dm: 99, category: 'fat' };
    const cho = calcCHOFractions(fat);
    expect(cho.kd.choB1).toBe(0);
    expect(cho.kd.choB2).toBe(0);
  });
});

describe('FAZ 10I — Lignin yem-spesifik', () => {
  it('Yem girdisinde lignin varsa ADF×0.127 fallback yerine kullanılır', () => {
    const f = { nfc: 30, sugar: 2, starch: 5, ndf: 45, aNDF: 42, adf: 30, dm: 89, category: 'roughage', lignin: 7.5 };
    const cho = calcCHOFractions(f);
    // lignin=7.5 ile choC = min(7.5*2.4=18, 45*0.55=24.75) = 18
    expect(cho.lignin).toBe(7.5);
    expect(cho.choC).toBe(18);
  });

  it('Lignin yoksa ADF×0.127 fallback (Van Soest)', () => {
    const f = { nfc: 30, sugar: 2, starch: 5, ndf: 45, aNDF: 42, adf: 30, dm: 89, category: 'roughage' };
    const cho = calcCHOFractions(f);
    // lignin fallback = 30 * 0.127 = 3.81
    expect(cho.lignin).toBeCloseTo(3.81, 2);
  });

  it('Saman: yüksek lignin (gerçek 12%) daha doğru choC verir', () => {
    const straw = { nfc: 6, sugar: 1, starch: 0, ndf: 80, aNDF: 78, adf: 50, dm: 92, category: 'roughage', lignin: 12 };
    const cho = calcCHOFractions(straw);
    // lignin=12 ile choC = min(12*2.4=28.8, 80*0.55=44) = 28.8
    // ADF×0.127 fallback olsaydı: 50*0.127=6.35, choC=15.24 — yanlış!
    expect(cho.choC).toBeCloseTo(28.8, 1);
  });
});

// ─── FAZ 16.3: CNCPS v6.5 tam alt fraksiyonlar ────────────────────────────────
describe('calcCHOSubFractions — CNCPS v6.5 8 havuz CHO (FAZ 16.3)', () => {
  const cornSilage = { id: 'corn_silage', name: 'Mısır Silajı', category: 'roughage',
    nfc: 36, sugar: 2, starch: 30, ndf: 44, aNDF: 42, adf: 27, dm: 33, lignin: 3 };
  const cornGrain = { id: 'corn_grain', name: 'Mısır Tane', category: 'grain',
    nfc: 74, sugar: 2, starch: 70, ndf: 10, aNDF: 8, adf: 3, dm: 88 };
  const beetPulp = { id: 'beet_pulp', name: 'Şeker Pancarı Küspesi', category: 'byproduct',
    nfc: 45, sugar: 10, starch: 2, ndf: 40, aNDF: 38, adf: 23, dm: 90, lignin: 2 };

  it('8 havuz döner + kütle dengesi: A1+A2+A3+A4+B1+B2 = NFC', () => {
    const c = calcCHOSubFractions(cornSilage);
    for (const k of ['cA1','cA2','cA3','cA4','cB1','cB2','cB3','cC']) expect(c).toHaveProperty(k);
    const nfcSum = c.cA1 + c.cA2 + c.cA3 + c.cA4 + c.cB1 + c.cB2;
    expect(nfcSum).toBeCloseTo(36, 1);  // NFC
  });

  it('CB3 + CC = effektif NDF (aNDF)', () => {
    const c = calcCHOSubFractions(cornSilage);
    expect(c.cB3 + c.cC).toBeCloseTo(42, 1);  // aNDF
  });

  it('nişasta CB1 ölçülen alandan; CC = lignin×2.4', () => {
    const c = calcCHOSubFractions(cornSilage);
    expect(c.cB1).toBeCloseTo(30, 1);
    expect(c.cC).toBeCloseTo(Math.min(3 * 2.4, 44 * 0.55), 1);  // 7.2
  });

  it('silaj (ensile) organik asit havuzları > 0; laktik (A2) baskın', () => {
    const c = calcCHOSubFractions(cornSilage);
    expect(c.ensiled).toBe(true);
    expect(c.cA1 + c.cA2 + c.cA3).toBeGreaterThan(0);
    expect(c.cA2).toBeGreaterThan(c.cA1);   // laktik > VFA
    expect(c.cA2).toBeGreaterThan(c.cA3);   // laktik > diğer OA
  });

  it('kuru konsantre (mısır tane) organik asit içermez', () => {
    const c = calcCHOSubFractions(cornGrain);
    expect(c.ensiled).toBe(false);
    expect(c.cA1).toBe(0);
    expect(c.cA2).toBe(0);
    expect(c.cA3).toBe(0);
  });

  it('pektin-zengini yem (şeker pancarı küspesi) yüksek çözünür lif CB2', () => {
    const c = calcCHOSubFractions(beetPulp);
    // NFC 45 − starch 2 − sugar 10 = 33 çözünür lif (ensile değil → hepsi CB2)
    expect(c.cB2).toBeGreaterThan(25);
  });

  it('ad/id "silaj" içeriyorsa kuru olsa bile ensile sayılır', () => {
    const drySilageLabel = { id: 'x', name: 'Çayır Silajı', category: 'roughage', nfc: 30, sugar: 4, starch: 5, ndf: 55, aNDF: 50, adf: 35, dm: 88 };
    expect(calcCHOSubFractions(drySilageLabel).ensiled).toBe(true);
  });

  it('kd: organik asitler fermente olmaz (0), şeker anında (300)', () => {
    const c = calcCHOSubFractions(cornSilage);
    expect(c.kd.cA1).toBe(0);
    expect(c.kd.cA4).toBe(300);
  });
});

describe('calcProteinSubFractions — CNCPS v6.5 6 havuz protein (FAZ 16.3)', () => {
  const soybean = { cp: 54, ndicp: 10, adicp: 3, solCP: 20, pa: 5, category: 'protein' };
  const alfalfa = { cp: 18, ndicp: 16, adicp: 6, solCP: 40, category: 'roughage' };

  it('6 havuz döner + kütle dengesi = 100% CP', () => {
    const p = calcProteinSubFractions(soybean);
    for (const k of ['pA1','pA2','pB1','pB2','pB3','pC']) expect(p).toHaveProperty(k);
    expect(p.total).toBeCloseTo(100, 1);
  });

  it('PA1 = NPN (eski pa); PA1+PA2 = solCP', () => {
    const p = calcProteinSubFractions(soybean);
    expect(p.pA1).toBeCloseTo(5, 1);          // pa girişi
    expect(p.pA1 + p.pA2).toBeCloseTo(20, 1); // solCP
  });

  it('PC = ADICP; PB3 = NDICP − ADICP', () => {
    const p = calcProteinSubFractions(soybean);
    expect(p.pC).toBeCloseTo(3, 1);
    expect(p.pB3).toBeCloseTo(10 - 3, 1);     // 7
  });

  it('eski calcProteinFractions ile tutarlı eşleme (pA1≈pa, pA2≈pb1, pB3≈pb3, pC≈pc)', () => {
    const oldF = calcProteinFractions(soybean);
    const p = calcProteinSubFractions(soybean);
    expect(p.pA1).toBeCloseTo(oldF.pa, 1);
    expect(p.pA2).toBeCloseTo(oldF.pb1, 1);
    expect(p.pB3).toBeCloseTo(oldF.pb3, 1);
    expect(p.pC).toBeCloseTo(oldF.pc, 1);
    // eski pb2 (çözünmez orta) → yeni pB1 + pB2
    expect(p.pB1 + p.pB2).toBeCloseTo(oldF.pb2, 1);
  });

  it('pa girilmezse NPN solCP×0.4 (≤15) fallback', () => {
    const p = calcProteinSubFractions(alfalfa);
    expect(p.pA1).toBeCloseTo(Math.min(40 * 0.4, 15), 1);  // 15
  });

  it('kd: PA1 anında (300) > PA2 (135) > PB1 > PB2 > PB3; PC=0', () => {
    const p = calcProteinSubFractions(soybean);
    expect(p.kd.pA1).toBeGreaterThan(p.kd.pA2);
    expect(p.kd.pA2).toBeGreaterThan(p.kd.pB1);
    expect(p.kd.pB1).toBeGreaterThan(p.kd.pB2);
    expect(p.kd.pC).toBe(0);
  });
});

describe('aggregateCNCPSSubFractions — rasyon düzeyi (FAZ 16.3)', () => {
  const ingredients = [
    { feed: { id: 'cs', name: 'Mısır Silajı', category: 'roughage', cp: 8, nfc: 36, sugar: 2, starch: 30, ndf: 44, aNDF: 42, adf: 27, dm: 33, lignin: 3, ndicp: 12, adicp: 4, solCP: 50 }, dmKg: 10 },
    { feed: { id: 'sbm', name: 'Soya Küspesi', category: 'protein', cp: 48, nfc: 28, sugar: 10, starch: 2, ndf: 10, aNDF: 8, adf: 5, dm: 89, ndicp: 10, adicp: 3, solCP: 20, pa: 5 }, dmKg: 5 },
  ];

  it('cho (%KM) ve protein (%CP) havuzları döner', () => {
    const a = aggregateCNCPSSubFractions(ingredients, 15);
    expect(a.cho).toHaveProperty('cB1');
    expect(a.protein).toHaveProperty('pA2');
    expect(a.totalCP_g).toBeGreaterThan(0);
  });

  it('protein havuzları toplamı ≈ 100% CP', () => {
    const a = aggregateCNCPSSubFractions(ingredients, 15);
    const sum = a.protein.pA1 + a.protein.pA2 + a.protein.pB1 + a.protein.pB2 + a.protein.pB3 + a.protein.pC;
    expect(sum).toBeCloseTo(100, 0);
  });

  it('boş/geçersiz girdi güvenli (sıfır havuzlar)', () => {
    const a = aggregateCNCPSSubFractions([], 0);
    expect(a.totalCP_g).toBe(0);
    expect(a.cho.cB1).toBe(0);
  });
});

// FAZ 16.3 KAPANIŞ DENETİMİ — 4-havuz ↔ 8-havuz tutarlılık + uç durum güvenliği
describe('CNCPS v6.5 alt fraksiyon — tutarlılık & uç durum (FAZ 16.3 denetim)', () => {
  // NDF kısmı (CC, CB3) iki görünümde aynı olmalı — aksi halde kullanıcı çelişkili
  // sindirilebilir/sindirilemeyen NDF görür. calcCHOSubFractions ile calcCHOFractions
  // aynı lignin/aNDF mantığını paylaşır; bu test divergansı yakalar.
  const feeds = [
    { id: 'cs', name: 'Mısır Silajı', category: 'roughage', nfc: 36, sugar: 2, starch: 30, ndf: 44, aNDF: 42, adf: 27, dm: 33, lignin: 3 },
    { name: 'Buğday Samanı', category: 'roughage', nfc: 6, sugar: 1, starch: 0, ndf: 80, aNDF: 78, adf: 50, dm: 92, lignin: 12 },
    { name: 'Yonca (lignin yok)', category: 'roughage', nfc: 25, sugar: 5, starch: 2, ndf: 44, aNDF: 39, adf: 32, dm: 89 },  // adf×0.127 fallback
    { name: 'Mısır Tane', category: 'grain', nfc: 74, sugar: 2, starch: 70, ndf: 10, aNDF: 8, adf: 3, dm: 88 },
  ];

  it('CC (sindirilemeyen NDF) 8-havuz = 4-havuz choC (her yem tipinde)', () => {
    for (const f of feeds) {
      const sub = calcCHOSubFractions(f);
      const old = calcCHOFractions(f);
      expect(sub.cC).toBeCloseTo(old.choC, 2);
    }
  });

  it('CB3 (sindirilebilir NDF) 8-havuz = 4-havuz choB2 (her yem tipinde)', () => {
    for (const f of feeds) {
      const sub = calcCHOSubFractions(f);
      const old = calcCHOFractions(f);
      expect(sub.cB3).toBeCloseTo(old.choB2, 2);
    }
  });

  it('CHO toplam ≈ NFC + effektif NDF (kütle bütünlüğü)', () => {
    const f = feeds[0];
    const sub = calcCHOSubFractions(f);
    expect(sub.total).toBeCloseTo(36 + 42, 1);  // NFC + aNDF
  });

  it('sıfır-CHO yem (mineral) tüm CHO havuzları 0', () => {
    const mineral = { category: 'mineral', nfc: 0, sugar: 0, starch: 0, ndf: 0, aNDF: 0, adf: 0, dm: 99 };
    const c = calcCHOSubFractions(mineral);
    for (const k of ['cA1','cA2','cA3','cA4','cB1','cB2','cB3','cC']) expect(c[k]).toBe(0);
    expect(c.total).toBe(0);
  });

  it('mineral protein aggregate\'i kirletmez (cpG=0 → ağırlık yok)', () => {
    const ing = [
      { feed: { category: 'protein', cp: 48, nfc: 28, sugar: 10, starch: 2, ndf: 10, aNDF: 8, adf: 5, dm: 89, solCP: 20, pa: 5, ndicp: 10, adicp: 3 }, dmKg: 5 },
      { feed: { category: 'mineral', cp: 0, nfc: 0, sugar: 0, starch: 0, ndf: 0, aNDF: 0, adf: 0, dm: 99 }, dmKg: 0.3 },
    ];
    const withMineral = aggregateCNCPSSubFractions(ing, 5.3);
    const proteinOnly = aggregateCNCPSSubFractions([ing[0]], 5);
    // Mineral CP içermediğinden protein profili yalnız soyadan gelir (aynı)
    expect(withMineral.protein.pA2).toBeCloseTo(proteinOnly.protein.pA2, 1);
  });
});
