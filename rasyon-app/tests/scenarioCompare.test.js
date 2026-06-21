/**
 * FAZ 20.3 — Senaryo karşılaştırma çekirdeği (preset uygulama + metrik çıkarımı).
 * Optimizasyon optimizeFn ile enjekte edilir (mock) → DOM/worker gerekmez.
 */
import { describe, it, expect } from 'vitest';
import { SCENARIO_PRESETS, runScenarioComparison, scenarioMetrics } from '../src/ui/components/scenarioCompare.js';

describe('FAZ 20.3 — senaryo presetleri', () => {
  it('3 senaryo: cost / balanced / cncps', () => {
    expect(SCENARIO_PRESETS).toHaveLength(3);
    expect(SCENARIO_PRESETS.map(p => p.id)).toEqual(['cost', 'balanced', 'cncps']);
  });

  it('preset overrides doğru (cost tek-amaç, balanced çok-amaçlı, cncps hesap modu)', () => {
    const base = { animal: { milkYield: 30 }, feeds: [{ id: 'x' }], objective: 'zzz', objectives: [{ type: 'q' }], calcMode: 'zz' };
    const [cost, bal, cncps] = SCENARIO_PRESETS.map(p => p.apply({ ...base }));
    expect(cost.objective).toBe('cost'); expect(cost.objectives).toBeNull(); expect(cost.calcMode).toBe('nrc');
    expect(bal.objectives).toHaveLength(3);
    expect(bal.objectives.map(o => o.type)).toEqual(['cost', 'mfd_risk', 'aa_balance']);
    expect(cncps.calcMode).toBe('cncps'); expect(cncps.objective).toBe('cost');
    // taban korunur (animal/feeds taşınır)
    expect(cost.animal).toBe(base.animal);
    expect(cost.feeds).toBe(base.feeds);
  });
});

describe('FAZ 20.3 — runScenarioComparison', () => {
  it('her senaryoyu optimizeFn ile çözer + sonuçları toplar', async () => {
    const calls = [];
    const mockOpt = async (input) => {
      calls.push(input);
      return { feasible: true, totalCost: input.calcMode === 'cncps' ? 105 : 100,
               composition: { nel_mcal: 30, mp_g: 1500, ndf_pct: 32 }, dmi: { achieved_kg: 22 }, items: [], methane: { production_g: 400 } };
    };
    const res = await runScenarioComparison({ animal: { milkYield: 30 }, feeds: [] }, mockOpt);
    expect(res).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(res.every(r => r.result?.feasible)).toBe(true);
    expect(calls[2].calcMode).toBe('cncps');   // cncps senaryosu hesap modunu taşıdı
    expect(Array.isArray(calls[1].objectives)).toBe(true);  // balanced çok-amaçlı
  });

  it('optimizeFn hata fırlatırsa o senaryo error taşır (result null), diğerleri etkilenmez', async () => {
    const mockOpt = async (input) => { if (input.calcMode === 'cncps') throw new Error('boom'); return { feasible: true, totalCost: 100, composition: {}, items: [] }; };
    const res = await runScenarioComparison({ animal: {}, feeds: [] }, mockOpt);
    const cncps = res.find(r => r.id === 'cncps');
    expect(cncps.result).toBeNull();
    expect(cncps.error).toBe('boom');
    expect(res.find(r => r.id === 'cost').result.feasible).toBe(true);  // diğerleri sağlam
  });
});

describe('FAZ 20.3 — scenarioMetrics', () => {
  const result = {
    feasible: true, totalCost: 120,
    composition: { nel_mcal: 35, mp_g: 1600, ndf_pct: 33, peNDF_pct: 21, lys_g: 160, met_g: 55 },
    dmi: { achieved_kg: 23 }, methane: { production_g: 420 },
  };

  it('metrik çıkarımı + IOFC (milkPrice varsa süt geliri − yem maliyeti)', () => {
    const m = scenarioMetrics(result, { milkYield: 35, milkPrice: 18 });
    expect(m.feasible).toBe(true);
    expect(m.cost).toBe(120);
    expect(m.nel).toBe(35); expect(m.mp).toBe(1600); expect(m.ndf).toBe(33); expect(m.methane).toBe(420);
    expect(m.dmi).toBe(23);
    expect(m.iofc).toBeCloseTo(35 * 18 - 120, 6);
  });

  it('milkPrice yoksa IOFC null; result null → null', () => {
    expect(scenarioMetrics(result, { milkYield: 35 }).iofc).toBeNull();
    expect(scenarioMetrics(result).iofc).toBeNull();
    expect(scenarioMetrics(null)).toBeNull();
  });

  it('FAZ 23.4: 7 EAA tedariği result.aminoAcids.supply\'den çıkarılır (gösterim detayı)', () => {
    const withAA = { ...result, aminoAcids: { supply: { arg: { total_g: 140 }, leu: { total_g: 220 }, trp: { total_g: 30 } } } };
    const m = scenarioMetrics(withAA);
    expect(m.eaa.arg).toBe(140);
    expect(m.eaa.leu).toBe(220);
    expect(m.eaa.trp).toBe(30);
    expect(m.eaa.val).toBe(0);                    // veri yoksa 0
    expect(scenarioMetrics(result).eaa.arg).toBe(0);  // aminoAcids hiç yoksa hepsi 0
  });

  it('relaxed çözüm: feasible=false ama relaxed=true', () => {
    const relaxedRes = { feasible: false, relaxation: { applied: true }, totalCost: 130, composition: {}, dmi: {} };
    const m = scenarioMetrics(relaxedRes);
    expect(m.feasible).toBe(false);
    expect(m.relaxed).toBe(true);
  });
});
