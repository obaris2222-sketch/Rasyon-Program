/**
 * FAZ 11B — Saha gözlem analizi testleri
 */
import { describe, it, expect } from 'vitest';
import { analyzeObservations, calcLinearTrend, performanceGrade } from '../src/core/observationAnalysis.js';

const PROFILE = {
  bw: 650, milkYield: 35, milkFat: 3.5, milkProtein: 3.1,
  parity: 2, dim: 90, bcs: 3.0, lactationStage: 'early',
};

describe('calcLinearTrend', () => {
  it('Artan değerler → pozitif eğim', () => {
    const r = calcLinearTrend([30, 31, 32, 33, 34]);
    expect(r.slope).toBeGreaterThan(0);
    expect(r.direction).toBe('up');
  });

  it('Azalan değerler → negatif eğim', () => {
    const r = calcLinearTrend([35, 33, 31, 29]);
    expect(r.slope).toBeLessThan(0);
    expect(r.direction).toBe('down');
  });

  it('Stabil değerler → eğim ≈ 0', () => {
    const r = calcLinearTrend([30, 30.1, 29.9, 30.0]);
    expect(Math.abs(r.slope)).toBeLessThan(0.2);
    expect(r.direction).toBe('stable');
  });

  it('1 ölçüm → null döner', () => {
    expect(calcLinearTrend([30])).toBeNull();
  });

  it('Boş dizi → null döner', () => {
    expect(calcLinearTrend([])).toBeNull();
  });

  it('Min/max doğru hesaplanır', () => {
    const r = calcLinearTrend([20, 35, 25, 40, 30]);
    expect(r.min).toBe(20);
    expect(r.max).toBe(40);
    expect(r.mean).toBeCloseTo(30, 1);
  });
});

describe('analyzeObservations', () => {
  it('Boş gözlem dizisi → empty:true', () => {
    const r = analyzeObservations([], PROFILE);
    expect(r.empty).toBe(true);
  });

  it('Tek gözlem: latest dönmeli, trend null', () => {
    const obs = [{ date: '2026-05-01', milkYield: 33, bcs: 3.0 }];
    const r = analyzeObservations(obs, PROFILE);
    expect(r.empty).toBe(false);
    expect(r.latest.milkYield).toBe(33);
    expect(r.trend.my).toBeNull();
  });

  it('Süt verim tahminin altında → myDelta negatif', () => {
    const obs = [{ date: '2026-05-01', milkYield: 28 }];
    const r = analyzeObservations(obs, PROFILE);
    expect(r.myDelta.diff).toBeLessThan(0);
    expect(r.myDelta.pct).toBeLessThan(0);
  });

  it('Tahmin tutuyorsa myDelta küçük', () => {
    const obs = [{ date: '2026-05-01', milkYield: 35 }];
    const r = analyzeObservations(obs, PROFILE);
    expect(Math.abs(r.myDelta.pct)).toBeLessThan(1);
  });

  it('Düşen süt verim trendi → performans skoru düşer', () => {
    const obs = [
      { date: '2026-05-20', milkYield: 28 },
      { date: '2026-05-13', milkYield: 30 },
      { date: '2026-05-06', milkYield: 33 },
      { date: '2026-04-29', milkYield: 35 },
    ];
    const r = analyzeObservations(obs, PROFILE);
    expect(r.performanceScore).toBeLessThan(85);
    expect(r.trend.my.direction).toBe('down');
  });

  it('BCS hızlı değişimi uyarı verir', () => {
    const obs = [
      { date: '2026-05-20', milkYield: 35, bcs: 2.5 },
      { date: '2026-05-13', milkYield: 35, bcs: 2.75 },
      { date: '2026-05-06', milkYield: 35, bcs: 3.0 },
      { date: '2026-04-29', milkYield: 35, bcs: 3.25 },
    ];
    const r = analyzeObservations(obs, PROFILE);
    expect(r.trend.bcs.direction).toBe('down');
    expect(r.summary).toMatch(/BCS/);
  });

  it('Performans skoru 0-100 aralığında', () => {
    const obs = [{ date: '2026-05-01', milkYield: 10 }];
    const r = analyzeObservations(obs, PROFILE);
    expect(r.performanceScore).toBeGreaterThanOrEqual(0);
    expect(r.performanceScore).toBeLessThanOrEqual(100);
  });

  it('FAZ 17.3: options.dmiMethod tahmini KMT yöntemini belirler (geriye uyumlu)', () => {
    const obs = [{ date: '2026-05-01', milkYield: 35, dmiActual: 23 }];
    const nrc     = analyzeObservations(obs, PROFILE, { dmiMethod: 'NRC2001' });
    const desouza = analyzeObservations(obs, PROFILE, { dmiMethod: 'deSouza2019' });
    const def     = analyzeObservations(obs, PROFILE);  // opsiyon yok → varsayılan
    expect(nrc.predicted.dmi).not.toBe(desouza.predicted.dmi);  // yöntem farkı yansır
    expect(def.predicted.dmi).toBe(nrc.predicted.dmi);          // opsiyonsuz = NRC2001 (geriye uyumlu)
  });
});

describe('performanceGrade', () => {
  it('Skor 90 → A (Mükemmel)', () => {
    const g = performanceGrade(90);
    expect(g.grade).toBe('A');
    expect(g.label).toBe('Mükemmel');
  });
  it('Skor 60 → C (Orta)', () => {
    expect(performanceGrade(60).grade).toBe('C');
  });
  it('Skor 30 → D (Düşük)', () => {
    expect(performanceGrade(30).grade).toBe('D');
  });
});
