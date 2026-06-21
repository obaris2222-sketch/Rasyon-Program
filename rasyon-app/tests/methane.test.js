import { describe, it, expect } from 'vitest';
import {
  methaneMoraes2014,
  methaneNiu2018,
  methaneIntensity,
  methaneCO2eq,
  interpretMethane,
  METHANE_GWP100,
  CH4_ENERGY_MCAL_PER_KG,
} from '../src/core/methane.js';

describe('methaneMoraes2014 — DMI + NDF + CP', () => {
  it('tipik laktasyon rasyonu gerçekçi aralıkta (~300-420 g/gün)', () => {
    const ch4 = methaneMoraes2014(22, 32, 17);
    expect(ch4).toBeGreaterThan(300);
    expect(ch4).toBeLessThan(420);
  });

  it('verim (KMT) arttıkça CH₄ artar — birincil sürücü', () => {
    const low = methaneMoraes2014(15, 35, 16);
    const high = methaneMoraes2014(25, 35, 16);
    expect(high).toBeGreaterThan(low);
  });

  it('yüksek NDF (lif) CH₄ artırır', () => {
    const lowNdf = methaneMoraes2014(22, 28, 16);
    const highNdf = methaneMoraes2014(22, 45, 16);
    expect(highNdf).toBeGreaterThan(lowNdf);
  });

  it('yüksek CP CH₄ hafif azaltır', () => {
    const lowCp = methaneMoraes2014(22, 35, 14);
    const highCp = methaneMoraes2014(22, 35, 20);
    expect(highCp).toBeLessThan(lowCp);
  });

  it('yield IPCC Tier 2 aralığında (~15-22 g CH₄/kg KMT)', () => {
    const ch4 = methaneMoraes2014(22, 35, 16);
    const yieldGperKg = ch4 / 22;
    expect(yieldGperKg).toBeGreaterThan(15);
    expect(yieldGperKg).toBeLessThan(22);
  });

  it('DMI=0 veya geçersiz → 0', () => {
    expect(methaneMoraes2014(0, 35, 16)).toBe(0);
    expect(methaneMoraes2014(NaN, 35, 16)).toBe(0);
  });

  it('NDF/CP eksikse default referans (35/16) kullanır', () => {
    const withDefaults = methaneMoraes2014(20);
    const explicit = methaneMoraes2014(20, 35, 16);
    expect(withDefaults).toBeCloseTo(explicit, 1);
  });
});

describe('methaneNiu2018 — DMI + yağ + kaba yem oranı', () => {
  it('tipik rasyon gerçekçi aralıkta', () => {
    const ch4 = methaneNiu2018(22, 4, 55);
    expect(ch4).toBeGreaterThan(300);
    expect(ch4).toBeLessThan(420);
  });

  it('diyet yağı (EE) arttıkça CH₄ azalır (Beauchemin 2008)', () => {
    const lowFat = methaneNiu2018(22, 3, 50);
    const highFat = methaneNiu2018(22, 6, 50);
    expect(highFat).toBeLessThan(lowFat);
  });

  it('+1% yağ ~%4 CH₄ azaltır (büyüklük kontrolü)', () => {
    const base = methaneNiu2018(22, 3, 50);
    const plus1 = methaneNiu2018(22, 4, 50);
    const reduction = (base - plus1) / base;
    expect(reduction).toBeCloseTo(0.04, 2);
  });

  it('kaba yem oranı arttıkça CH₄ artar', () => {
    const lowForage = methaneNiu2018(22, 4, 40);
    const highForage = methaneNiu2018(22, 4, 70);
    expect(highForage).toBeGreaterThan(lowForage);
  });

  it('iki model benzer büyüklükte sonuç verir (tutarlılık)', () => {
    const moraes = methaneMoraes2014(22, 32, 17);
    const niu = methaneNiu2018(22, 3.5, 55);
    // İki bağımsız model %25 içinde olmalı (aynı DMI bazı)
    expect(Math.abs(moraes - niu) / moraes).toBeLessThan(0.25);
  });

  it('DMI=0 → 0', () => {
    expect(methaneNiu2018(0, 4, 50)).toBe(0);
  });

  it('aşırı yağda azaltım doygunlaşır (taban 0.55, ~0 CH₄ olmaz)', () => {
    const realistic = methaneNiu2018(22, 7, 50);   // LP üst sınırı civarı
    const extreme = methaneNiu2018(22, 40, 50);     // patolojik (taban devreye girer)
    const base = methaneNiu2018(22, 3, 50);
    expect(realistic).toBeLessThan(base);            // gerçekçi yağ azaltıyor
    expect(extreme).toBeGreaterThan(base * 0.5);     // taban → makul minimum korunur
  });
});

describe('methaneIntensity — g CH₄ / kg süt', () => {
  it('üretim / süt oranını döndürür', () => {
    expect(methaneIntensity(360, 30)).toBeCloseTo(12.0, 1);
  });

  it('kuru inek (süt 0 veya geçersiz) → null', () => {
    expect(methaneIntensity(360, 0)).toBe(null);
    expect(methaneIntensity(360, NaN)).toBe(null);
  });

  it('yüksek verimde yoğunluk düşer (idame payı seyrelir)', () => {
    const ch4 = 380;
    const lowMilk = methaneIntensity(ch4, 20);
    const highMilk = methaneIntensity(ch4, 45);
    expect(highMilk).toBeLessThan(lowMilk);
  });
});

describe('methaneCO2eq — CO₂ eşdeğeri (GWP100=28)', () => {
  it('GWP100 sabiti 28 (IPCC AR5)', () => {
    expect(METHANE_GWP100).toBe(28);
  });

  it('360 g CH₄ → 10.08 kg CO₂eq/gün', () => {
    // 360 × 28 / 1000 = 10.08
    expect(methaneCO2eq(360)).toBeCloseTo(10.08, 2);
  });

  it('0 veya geçersiz → 0', () => {
    expect(methaneCO2eq(0)).toBe(0);
    expect(methaneCO2eq(NaN)).toBe(0);
  });
});

describe('interpretMethane — yoğunluk yorumu', () => {
  it('null (kuru dönem) → na seviyesi', () => {
    const r = interpretMethane(null);
    expect(r.level).toBe('na');
  });

  it('< 12 g/kg → düşük (verimli)', () => {
    expect(interpretMethane(10).level).toBe('low');
  });

  it('12-17 g/kg → tipik', () => {
    expect(interpretMethane(14).level).toBe('normal');
  });

  it('17-22 g/kg → yüksek + öneri', () => {
    const r = interpretMethane(19);
    expect(r.level).toBe('high');
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('> 22 g/kg → çok yüksek + öneriler', () => {
    const r = interpretMethane(25);
    expect(r.level).toBe('very_high');
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('her seviye label ve message içerir', () => {
    for (const v of [null, 10, 14, 19, 25]) {
      const r = interpretMethane(v);
      expect(typeof r.label).toBe('string');
      expect(typeof r.message).toBe('string');
    }
  });
});

describe('CH₄ enerji kaybı sabiti', () => {
  it('CH4_ENERGY_MCAL_PER_KG ~13.30 (55.65 MJ/kg ÷ 4.184)', () => {
    expect(CH4_ENERGY_MCAL_PER_KG).toBeCloseTo(13.30, 1);
  });
});
