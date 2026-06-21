/**
 * FAZ 15.9 — Form validasyon modülü testleri
 *
 * Pure çekirdek (FIELD_RULES + validateField + validateForm + formatters)
 * DOM gerektirmez → Node ortamında doğrudan test edilebilir.
 */

import { describe, it, expect } from 'vitest';
import {
  FIELD_RULES,
  validateField,
  validateForm,
  formatRangeError,
  formatRequiredError,
  formatTypeError,
  formatIntegerError,
  formatLengthError,
  summarizeErrors,
} from '../src/ui/validation.js';

describe('FAZ 15.9 — FIELD_RULES yapısı', () => {
  it('zorunlu hayvan alanlarını tanımlar', () => {
    expect(FIELD_RULES.bw).toBeDefined();
    expect(FIELD_RULES.bw.required).toBe(true);
    expect(FIELD_RULES.bw.min).toBe(50);     // PROBLEMLER #2: genişletildi
    expect(FIELD_RULES.bw.max).toBe(1500);
    expect(FIELD_RULES.bw.unit).toBe('kg');
  });

  it('gözlem alanlarını obs_ prefix ile ayrı tutar', () => {
    expect(FIELD_RULES.obs_milkYield).toBeDefined();
    expect(FIELD_RULES.obs_milkYield.required).toBe(true);
    // Hayvan formundaki milkYield ve gözlem milkYield farklı aralıklar olabilir
    expect(FIELD_RULES.milkYield.min).toBe(0);
    expect(FIELD_RULES.obs_milkYield.min).toBe(0);
  });

  it('parite tam sayı kuralı içerir', () => {
    expect(FIELD_RULES.parity.integer).toBe(true);
    expect(FIELD_RULES.pregnancyMonth.integer).toBe(true);
  });
});

describe('FAZ 15.9 — validateField', () => {
  it('range içindeki sayıyı kabul eder', () => {
    const res = validateField('bw', 650);
    expect(res.ok).toBe(true);
  });

  it('string olarak gelen sayıyı parse edip kabul eder', () => {
    const res = validateField('bw', '650');
    expect(res.ok).toBe(true);
  });

  it('min altındaki değeri reddeder', () => {
    const res = validateField('bw', 30);   // PROBLEMLER #2: yeni alt sınır 50
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Canlı ağırlık');
    expect(res.error).toContain('50-1500');
    expect(res.error).toContain('kg');
  });

  it('max üstündeki değeri reddeder', () => {
    const res = validateField('bw', 2000);   // PROBLEMLER #2: yeni üst sınır 1500
    expect(res.ok).toBe(false);
    expect(res.error).toContain('50-1500');
  });

  it('required alan boş ise reddeder', () => {
    const res = validateField('bw', '');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('boş bırakılamaz');
  });

  it('opsiyonel alan boş ise kabul eder', () => {
    const res = validateField('targetADG', '');
    expect(res.ok).toBe(true);
  });

  it('sayısal olmayan değeri tip hatası ile reddeder', () => {
    const res = validateField('bw', 'abc');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('sayısal');
  });

  it('integer kuralında ondalık reddeder', () => {
    const res = validateField('parity', 2.5);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('tam sayı');
  });

  it('integer kuralında tam sayıyı kabul eder', () => {
    const res = validateField('parity', 3);
    expect(res.ok).toBe(true);
  });

  it('tanımsız field için ok=true döner (sessiz geçer)', () => {
    const res = validateField('nonexistent_field', 999);
    expect(res.ok).toBe(true);
  });

  it('string alanı uzunluk limitiyle doğrular', () => {
    const okRes = validateField('name', 'Holstein 35 DIM');
    expect(okRes.ok).toBe(true);
    const longName = 'a'.repeat(150);
    const longRes = validateField('name', longName);
    expect(longRes.ok).toBe(false);
    expect(longRes.error).toContain('80 karakter');
  });
});

describe('FAZ 15.9 — validateForm (toplu)', () => {
  it('tüm alanlar geçerliyse ok=true ve errors=[]', () => {
    const values = { bw: 650, milkYield: 35, bcs: 3.0 };
    const { ok, errors } = validateForm(values, ['bw', 'milkYield', 'bcs']);
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });

  it('birden çok ihlal varsa hepsi raporlanır', () => {
    const values = { bw: 30, milkYield: 200, bcs: 7 };   // PROBLEMLER #2: bw<50, milkYield>150, bcs>5
    const { ok, errors } = validateForm(values, ['bw', 'milkYield', 'bcs']);
    expect(ok).toBe(false);
    expect(errors.length).toBe(3);
    expect(errors[0].field).toBe('bw');
    expect(errors[1].field).toBe('milkYield');
    expect(errors[2].field).toBe('bcs');
  });

  it('alan eksikse (required false) ihlal saymaz', () => {
    const values = { bw: 650 }; // sadece bw, milkYield ve bcs opsiyonel kabul edilmesin
    const fields = ['bw', 'milkLactose']; // milkLactose opsiyonel
    const { ok } = validateForm(values, fields);
    expect(ok).toBe(true);
  });

  it('required alan eksikse ihlal döner', () => {
    const values = { milkYield: 35 }; // bw eksik
    const { ok, errors } = validateForm(values, ['bw', 'milkYield']);
    expect(ok).toBe(false);
    expect(errors[0].field).toBe('bw');
    expect(errors[0].message).toContain('boş bırakılamaz');
  });
});

describe('FAZ 15.9 — formatRangeError', () => {
  it('min+max ile birlikte tam mesaj üretir', () => {
    const msg = formatRangeError('Canlı ağırlık', 1500, 300, 900, 'kg');
    expect(msg).toBe('Canlı ağırlık 1500 kg geçersiz — 300-900 kg arasında olmalı.');
  });

  it('sadece min ile mesaj üretir', () => {
    const msg = formatRangeError('Süt verimi', -5, 0, undefined, 'kg/gün');
    expect(msg).toContain('en az 0');
    expect(msg).toContain('kg/gün');
  });

  it('sadece max ile mesaj üretir', () => {
    const msg = formatRangeError('Yağ', 99, undefined, 50);
    expect(msg).toContain('en fazla 50');
  });

  it('birim olmadan da düzgün çalışır', () => {
    const msg = formatRangeError('BCS', 7, 1, 5);
    expect(msg).toContain('1-5');
    expect(msg).not.toContain('undefined');
  });
});

describe('FAZ 15.9 — Diğer formatlayıcılar', () => {
  it('formatRequiredError', () => {
    expect(formatRequiredError('Canlı ağırlık')).toBe('Canlı ağırlık alanı boş bırakılamaz.');
  });

  it('formatTypeError number', () => {
    expect(formatTypeError('BCS', 'number')).toContain('sayısal');
  });

  it('formatIntegerError', () => {
    expect(formatIntegerError('Parite', 2.5)).toContain('tam sayı');
    expect(formatIntegerError('Parite', 2.5)).toContain('2.5');
  });

  it('formatLengthError max', () => {
    expect(formatLengthError('Yem adı', 'a'.repeat(150), 1, 120)).toContain('120');
  });
});

describe('FAZ 15.9 — summarizeErrors', () => {
  it('tek hata: mesajın kendisi', () => {
    const errors = [{ field: 'bw', message: 'Canlı ağırlık geçersiz.' }];
    expect(summarizeErrors(errors)).toBe('Canlı ağırlık geçersiz.');
  });

  it('çoklu hata: ilk + sayım', () => {
    const errors = [
      { field: 'bw', message: 'A' },
      { field: 'milkYield', message: 'B' },
      { field: 'bcs', message: 'C' },
    ];
    expect(summarizeErrors(errors)).toBe('A (ve 2 hata daha)');
  });

  it('boş liste: empty string', () => {
    expect(summarizeErrors([])).toBe('');
    expect(summarizeErrors(null)).toBe('');
  });
});
