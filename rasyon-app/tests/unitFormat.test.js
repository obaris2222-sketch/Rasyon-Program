/**
 * FAZ 15.2 Aşama 2 — Birim biçimlendirme testleri
 */

import { describe, it, expect } from 'vitest';
import {
  KG_TO_LB,
  weightToDisplay, weightUnit, formatWeight,
  tempToDisplay, tempUnit, formatTemp,
  volumeToDisplay, volumeUnit,
} from '../src/ui/unitFormat.js';

describe('FAZ 15.2 — Ağırlık dönüşümü', () => {
  it('metric: kg değişmeden döner', () => {
    expect(weightToDisplay(650, 'metric')).toBe(650);
    expect(weightUnit('metric')).toBe('kg');
  });

  it('imperial: kg → lb (×2.2046)', () => {
    expect(weightToDisplay(100, 'imperial')).toBeCloseTo(220.462, 2);
    expect(weightUnit('imperial')).toBe('lb');
  });

  it('formatWeight metric/imperial', () => {
    expect(formatWeight(650, 'metric')).toBe('650 kg');
    expect(formatWeight(650, 'imperial')).toBe('1433 lb');  // 650×2.2046=1433.0
  });

  it('geçersiz girdi için — döner', () => {
    expect(formatWeight(null, 'metric')).toBe('—');
    expect(formatWeight(undefined, 'imperial')).toBe('—');
  });

  it('KG_TO_LB sabiti doğru', () => {
    expect(KG_TO_LB).toBeCloseTo(2.20462, 4);
  });
});

describe('FAZ 15.2 — Sıcaklık dönüşümü', () => {
  it('metric: °C değişmeden döner', () => {
    expect(tempToDisplay(20, 'metric')).toBe(20);
    expect(tempUnit('metric')).toBe('°C');
  });

  it('imperial: °C → °F (×9/5+32)', () => {
    expect(tempToDisplay(20, 'imperial')).toBe(68);
    expect(tempToDisplay(0, 'imperial')).toBe(32);
    expect(tempToDisplay(37, 'imperial')).toBeCloseTo(98.6, 1);
    expect(tempUnit('imperial')).toBe('°F');
  });

  it('formatTemp', () => {
    expect(formatTemp(20, 'metric')).toBe('20 °C');
    expect(formatTemp(20, 'imperial')).toBe('68 °F');
    expect(formatTemp(null, 'metric')).toBe('—');
  });
});

describe('FAZ 15.2 — Hacim dönüşümü', () => {
  it('metric: L değişmeden döner', () => {
    expect(volumeToDisplay(100, 'metric')).toBe(100);
    expect(volumeUnit('metric')).toBe('L');
  });

  it('imperial: L → gal (×0.2642)', () => {
    expect(volumeToDisplay(100, 'imperial')).toBeCloseTo(26.417, 2);
    expect(volumeUnit('imperial')).toBe('gal');
  });
});

describe('FAZ 15.2 — Bilinmeyen units metric varsayar', () => {
  it('units undefined → metric davranışı', () => {
    expect(weightToDisplay(50, undefined)).toBe(50);
    expect(tempToDisplay(20, '')).toBe(20);
    expect(weightUnit(null)).toBe('kg');
  });
});
