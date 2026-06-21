import { describe, it, expect } from 'vitest';
import { waterIntakeMurphy, interpretWaterAdequacy } from '../src/core/water.js';

describe('waterIntakeMurphy — Murphy 1992 serbest su tüketimi', () => {
  it('bilinen girdi: DMI 22, süt 35, Na 50 g, 20°C → ~108.8 L/gün', () => {
    // 15.99 + 1.58×22 + 0.90×35 + 0.05×50 + 1.20×20 = 108.75
    expect(waterIntakeMurphy(22, 35, 50, 20)).toBeCloseTo(108.75, 1);
  });

  it('sıcaklık arttıkça su tüketimi artar', () => {
    const cool = waterIntakeMurphy(22, 35, 50, 15);
    const hot = waterIntakeMurphy(22, 35, 50, 30);
    expect(hot).toBeGreaterThan(cool);
    expect(hot - cool).toBeCloseTo(1.20 * 15, 1);  // ΔT=15 → +18 L
  });

  it('süt verimi arttıkça su tüketimi artar', () => {
    const low = waterIntakeMurphy(20, 20, 40, 20);
    const high = waterIntakeMurphy(20, 45, 40, 20);
    expect(high).toBeGreaterThan(low);
  });

  it('kuru inek (süt 0) bile baz su tüketimi pozitif', () => {
    const dry = waterIntakeMurphy(12, 0, 30, 18);
    expect(dry).toBeGreaterThan(0);
  });

  it('geçersiz/eksik girdiler güvenli (NaN → 0 katkı)', () => {
    const wi = waterIntakeMurphy(NaN, NaN, NaN, NaN);
    expect(wi).toBeCloseTo(15.99 + 1.20 * 20, 1);  // default T=20
  });
});

describe('interpretWaterAdequacy — yeterlilik yorumu', () => {
  it('sıcak hava (>25°C) → yüksek talep seviyesi', () => {
    const r = interpretWaterAdequacy(120, { tempC: 32, milkYield: 30, dmi_kg: 23 });
    expect(r.level).toBe('high_demand');
    expect(r.notes.some(n => /sıcak/i.test(n))).toBe(true);
  });

  it('yüksek verim (≥35 kg) → yüksek talep + uyarı', () => {
    const r = interpretWaterAdequacy(130, { tempC: 18, milkYield: 42, dmi_kg: 25 });
    expect(r.level).toBe('high_demand');
    expect(r.notes.some(n => /verim/i.test(n))).toBe(true);
  });

  it('normal koşul → normal seviye + su:KM oranı', () => {
    const r = interpretWaterAdequacy(100, { tempC: 18, milkYield: 25, dmi_kg: 22 });
    expect(r.level).toBe('normal');
    expect(r.waterPerKgDM).toBeCloseTo(100 / 22, 1);
  });

  it('her durumda ad libitum su önerisi notu var', () => {
    const r = interpretWaterAdequacy(100, { tempC: 18, milkYield: 25, dmi_kg: 22 });
    expect(r.notes.some(n => /ad libitum|serbest/i.test(n))).toBe(true);
  });
});
