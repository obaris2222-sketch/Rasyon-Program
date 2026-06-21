/**
 * rumenDynamics.js — 24 saatlik rumen pH simülasyonu testleri
 */
import { describe, it, expect } from 'vitest';
import { simulateRumenPH24h, interpretRumenRisk } from '../src/core/rumenDynamics.js';

describe('simulateRumenPH24h', () => {
  it('Dengeli rasyon → güvenli pH profili', () => {
    const sim = simulateRumenPH24h({
      nfcPct: 38, peNDFPct: 25, starchPct: 22, sugarPct: 4, forageRatio: 55, fatPct: 3.5,
    });
    expect(sim.ph.length).toBe(24);
    expect(sim.minPH).toBeGreaterThan(5.8);
    expect(sim.saraHours).toBe(0);
    expect(sim.riskLevel).toBe('safe');
  });

  it('Yüksek konsantre + düşük peNDF → SARA riski', () => {
    const sim = simulateRumenPH24h({
      nfcPct: 48, peNDFPct: 16, starchPct: 35, sugarPct: 6, forageRatio: 30, fatPct: 3.5,
    });
    expect(sim.minPH).toBeLessThan(5.9);
    expect(['sara', 'high_sara', 'acute_acidosis']).toContain(sim.riskLevel);
    expect(sim.riskFlags.length).toBeGreaterThan(0);
  });

  it('Aşırı yüksek nişasta → akut asidoz', () => {
    const sim = simulateRumenPH24h({
      nfcPct: 55, peNDFPct: 12, starchPct: 45, sugarPct: 8, forageRatio: 20, fatPct: 2,
    });
    expect(sim.acidosisHours).toBeGreaterThanOrEqual(0);
    expect(sim.minPH).toBeLessThan(6.0);
  });

  it('Çıktı 24 saat noktası içerir', () => {
    const sim = simulateRumenPH24h({ nfcPct: 35, peNDFPct: 22, starchPct: 18, sugarPct: 3, forageRatio: 50, fatPct: 3 });
    expect(sim.hours).toHaveLength(24);
    expect(sim.ph).toHaveLength(24);
    expect(sim.hours[0]).toBe(0);
    expect(sim.hours[23]).toBe(23);
  });

  it('pH 5.0-7.0 fizyolojik aralıkta kalır', () => {
    const sim = simulateRumenPH24h({ nfcPct: 60, peNDFPct: 5, starchPct: 50, sugarPct: 10, forageRatio: 10, fatPct: 1 });
    sim.ph.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(5.0);
      expect(p).toBeLessThanOrEqual(7.0);
    });
  });

  it('Min pH ortalama pH\'tan küçük', () => {
    const sim = simulateRumenPH24h({ nfcPct: 40, peNDFPct: 22, starchPct: 25, sugarPct: 4, forageRatio: 50, fatPct: 3 });
    expect(sim.minPH).toBeLessThanOrEqual(sim.meanPH);
  });
});

describe('interpretRumenRisk', () => {
  it('Tüm risk seviyeleri için etiket döner', () => {
    ['safe', 'marginal', 'sara', 'high_sara', 'acute_acidosis'].forEach(level => {
      const r = interpretRumenRisk(level);
      expect(r.label).toBeDefined();
      expect(r.color).toBeDefined();
      expect(r.severity).toBeDefined();
    });
  });
  it('safe → severity none', () => {
    expect(interpretRumenRisk('safe').severity).toBe('none');
  });
  it('acute_acidosis → severity critical', () => {
    expect(interpretRumenRisk('acute_acidosis').severity).toBe('critical');
  });
});
