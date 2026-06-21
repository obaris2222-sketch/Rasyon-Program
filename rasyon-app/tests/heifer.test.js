import { describe, it, expect } from 'vitest';
import { nelGrowth, mpGrowth } from '../src/core/nrc2001.js';
import { dmiHeifer } from '../src/core/dmi.js';
import { calcAllRequirements } from '../src/core/animalRequirements.js';

// ─── FAZ 13.10: Primipar (1. laktasyon) / düve büyüme hesabı ────────────────

describe('nelGrowth — NRC 2001 Bölüm 11 büyüme net enerjisi', () => {
  it('ADG ≤ 0 ise 0 döner (büyüme yok)', () => {
    expect(nelGrowth(550, 0)).toBe(0);
    expect(nelGrowth(550, -0.2)).toBe(0);
  });

  it('550 kg, ADG 0.4, MW 680 → makul retained energy (~1.5-2.5 Mcal)', () => {
    const re = nelGrowth(550, 0.4, 680);
    expect(re).toBeGreaterThan(1);
    expect(re).toBeLessThan(3);
  });

  it('ADG arttıkça büyüme enerjisi monoton artar', () => {
    expect(nelGrowth(550, 0.7, 680)).toBeGreaterThan(nelGrowth(550, 0.4, 680));
  });

  it('Olgun ağırlık küçükse (göreli daha olgun) RE artar', () => {
    // EQSBW = SBW × 478/MW → MW küçük → EQSBW büyük → RE büyük
    expect(nelGrowth(550, 0.5, 600)).toBeGreaterThan(nelGrowth(550, 0.5, 750));
  });

  it('geçersiz bw → 0', () => {
    expect(nelGrowth(NaN, 0.5)).toBe(0);
  });
});

describe('mpGrowth — NRC 2001 Bölüm 11 büyüme proteini', () => {
  it('ADG ≤ 0 ise 0', () => {
    expect(mpGrowth(0, 1.7)).toBe(0);
    expect(mpGrowth(-0.3, 1.7)).toBe(0);
  });

  it('pozitif ADG → pozitif MP (makul 50-250 g aralığı)', () => {
    const re = nelGrowth(550, 0.4, 680);
    const mp = mpGrowth(0.4, re);
    expect(mp).toBeGreaterThan(50);
    expect(mp).toBeLessThan(250);
  });

  it('re = 0 → 0 (guard)', () => {
    expect(mpGrowth(0.4, 0)).toBe(0);
  });
});

describe('dmiHeifer — büyüyen düve KMT (NRC 2001 Tablo 11-4)', () => {
  it('400 kg düve ≈ %2.3 BW ≈ 9.2 kg/gün', () => {
    expect(dmiHeifer(400)).toBeCloseTo(9.2, 1);
  });

  it('küçük düve göreli olarak daha yüksek % tüketir', () => {
    expect(dmiHeifer(150) / 150).toBeGreaterThan(dmiHeifer(550) / 550);
  });

  it('geçersiz bw → 0', () => {
    expect(dmiHeifer(0)).toBe(0);
    expect(dmiHeifer(NaN)).toBe(0);
  });
});

describe('calcAllRequirements — primipar büyüme entegrasyonu (FAZ 13.10)', () => {
  const primi = {
    bw: 550, milkYield: 28, milkFat: 3.8, milkProtein: 3.1,
    parity: 1, dim: 60, bcs: 2.9, lactationStage: 'early', targetADG: 0.4,
  };

  it('parity 1 + laktasyon + targetADG → nel.growth & mp.growth eklenir', () => {
    const r = calcAllRequirements(primi);
    expect(r.nel.growth).toBeGreaterThan(0);
    expect(r.mp.growth).toBeGreaterThan(0);
  });

  it('büyüme bileşeni total NEL/MP\'ye dahil edilir', () => {
    const withGrowth = calcAllRequirements(primi);
    const noGrowth = calcAllRequirements({ ...primi, targetADG: 0 });
    expect(withGrowth.nel.total).toBeGreaterThan(noGrowth.nel.total);
    expect(withGrowth.mp.total).toBeGreaterThan(noGrowth.mp.total);
    // Fark ≈ growth bileşeni kadar
    expect(withGrowth.nel.total - noGrowth.nel.total).toBeCloseTo(withGrowth.nel.growth, 1);
  });

  it('parity 2 (multipar) → büyüme bileşeni yok', () => {
    const r = calcAllRequirements({ ...primi, parity: 2 });
    expect(r.nel.growth).toBeUndefined();
    expect(r.mp.growth).toBeUndefined();
  });

  it('targetADG 0 → büyüme eklenmez (geriye uyumlu)', () => {
    const r = calcAllRequirements({ ...primi, targetADG: 0 });
    expect(r.nel.growth).toBeUndefined();
  });

  it('kuru dönem (far_off, laktasyon değil) → büyüme yok', () => {
    const r = calcAllRequirements({ ...primi, lactationStage: 'far_off', milkYield: 0 });
    expect(r.nel.growth).toBeUndefined();
  });

  it('NRC 2001 modunda da büyüme eklenir (sistemden bağımsız)', () => {
    const r = calcAllRequirements(primi, { system: 'NRC2001' });
    expect(r.nel.growth).toBeGreaterThan(0);
  });
});
