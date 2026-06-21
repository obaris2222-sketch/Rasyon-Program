/**
 * heatStress.js — THI ve ısı stresi düzeltmeleri
 * Mader et al. (2006) formülüne göre doğrulama
 */
import { describe, it, expect } from 'vitest';
import {
  calcTHI, classifyTHI, adjustDMIForHeat, adjustNELMaintenanceForHeat,
  heatStressRecommendations,
} from '../src/core/heatStress.js';

describe('calcTHI — Mader 2006 formülü', () => {
  it('30°C, %60 RH → ~80 (orta-şiddetli stres)', () => {
    // (1.8×30 + 32) − (0.55 − 0.0055×60) × (1.8×30 − 26)
    // = 86 − 0.22 × 28 = 86 − 6.16 = 79.84
    expect(calcTHI(30, 60)).toBeCloseTo(79.84, 1);
  });

  it('25°C, %50 RH → ~72 (eşik değeri)', () => {
    // = 77 − 0.275 × 19 = 77 − 5.225 = 71.775
    expect(calcTHI(25, 50)).toBeCloseTo(71.78, 1);
  });

  it('35°C, %70 RH → ~87 (şiddetli stres)', () => {
    // = 95 − 0.165 × 37 = 95 − 6.105 = 88.895
    expect(calcTHI(35, 70)).toBeCloseTo(88.9, 1);
  });

  it('10°C, %50 RH → düşük (stres yok)', () => {
    expect(calcTHI(10, 50)).toBeLessThan(60);
  });

  it('THI sıcaklıkla monoton artmalı', () => {
    expect(calcTHI(20, 60)).toBeLessThan(calcTHI(30, 60));
    expect(calcTHI(30, 60)).toBeLessThan(calcTHI(40, 60));
  });

  it('THI nem ile (yüksek sıcaklıkta) artmalı', () => {
    expect(calcTHI(30, 20)).toBeLessThan(calcTHI(30, 80));
  });
});

describe('classifyTHI — Süt sığırı eşikleri', () => {
  it('THI 70 → stres yok', () => {
    expect(classifyTHI(70).level).toBe('none');
  });
  it('THI 73 → hafif stres', () => {
    expect(classifyTHI(73).level).toBe('mild');
  });
  it('THI 76 → orta stres', () => {
    expect(classifyTHI(76).level).toBe('moderate');
  });
  it('THI 80 → şiddetli stres', () => {
    expect(classifyTHI(80).level).toBe('severe');
  });
  it('THI 85+ → aşırı stres', () => {
    expect(classifyTHI(85).level).toBe('extreme');
  });
});

describe('adjustDMIForHeat — KMT düzeltmesi', () => {
  it('THI ≤ 72 → düzeltme yok', () => {
    expect(adjustDMIForHeat(23, 72)).toBe(23);
    expect(adjustDMIForHeat(23, 60)).toBe(23);
  });
  it('THI > 72 → KMT azalır', () => {
    expect(adjustDMIForHeat(23, 80)).toBeLessThan(23);
  });
  it('En fazla %50 azalma sınırlanır', () => {
    expect(adjustDMIForHeat(20, 100)).toBeGreaterThanOrEqual(10);
  });
});

describe('heatStressRecommendations', () => {
  it('Stres yok → boş öneri', () => {
    expect(heatStressRecommendations(classifyTHI(60))).toEqual([]);
  });
  it('Orta stres → öneri listesi var', () => {
    const recs = heatStressRecommendations(classifyTHI(76));
    expect(recs.length).toBeGreaterThan(0);
  });
});
