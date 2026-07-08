/**
 * FAZ 15.9 — Form validasyon modülü
 *
 * Pure çekirdek (validateField, validateForm, formatRangeError) DOM gerektirmez → Node test edilebilir.
 * DOM yardımcıları (validateFormElement, attachLiveValidation) tarayıcı tarafı kullanım.
 *
 * Kullanım:
 *   import { validateForm, FIELD_RULES } from '../validation.js';
 *   const { ok, errors } = validateForm(values, ['bw','milkYield','bcs']);
 *   if (!ok) { showToast(errors[0].message, 'warn'); return; }
 */

// ─── Alan kuralları sözlüğü ────────────────────────────────────────────────
// Her alan: { label, type, min?, max?, unit?, required?, integer? }
// HTML5 input attribute'larıyla birebir aynı aralıklar (tutarlılık).

export const FIELD_RULES = {
  // ─── Hayvan profili (animalForm.js) ────────────────────────────────────
  name: {
    label: 'Profil adı', type: 'string', required: true, minLength: 1, maxLength: 80,
  },
  // PROBLEMLER #2: limitler çok genişletildi (pratikte sınırsız; yalnız NaN/garbage'a karşı
  // dış güvenlik). Skala-tabanlılar korunur: BCS 1-5, idrar pH 0-14 (tam pH skalası), nem 0-100.
  bw: {
    label: 'Canlı ağırlık', type: 'number', min: 50, max: 1500, unit: 'kg', required: true,
  },
  milkYield: {
    label: 'Süt verimi', type: 'number', min: 0, max: 150, unit: 'kg/gün', required: true,
  },
  milkFat: {
    label: 'Süt yağı', type: 'number', min: 0, max: 15, unit: '%', required: true,
  },
  milkProtein: {
    label: 'Süt proteini', type: 'number', min: 0, max: 10, unit: '%', required: true,
  },
  milkLactose: {
    label: 'Süt laktozu', type: 'number', min: 0, max: 10, unit: '%',
  },
  targetADG: {
    label: 'Hedef günlük canlı ağırlık artışı', type: 'number', min: 0, max: 3, unit: 'kg/gün',
  },
  dim: {
    label: 'Laktasyon günü (DIM)', type: 'number', min: 1, max: 1000, unit: 'gün', required: true,
  },
  bcs: {
    label: 'Vücut kondisyon skoru', type: 'number', min: 1, max: 5, required: true,
  },
  ambientTemp: {
    label: 'Ortam sıcaklığı', type: 'number', min: -40, max: 60, unit: '°C',
  },
  humidity: {
    label: 'Bağıl nem', type: 'number', min: 0, max: 100, unit: '%',
  },
  urinePH: {
    label: 'İdrar pH', type: 'number', min: 0, max: 14,
  },
  pregnancyMonth: {
    label: 'Gebelik ayı', type: 'number', min: 0, max: 12, integer: true,   // 0 = gebe değil (sentinel)
  },
  parity: {
    label: 'Parite', type: 'number', min: 1, max: 20, integer: true, required: true,
  },
  matureBW: {
    label: 'Olgun canlı ağırlık', type: 'number', min: 50, max: 1500, unit: 'kg',
  },

  // ─── Gözlem (observationsPanel.js) ─────────────────────────────────────
  obs_milkYield: {
    label: 'Süt verimi', type: 'number', min: 0, max: 150, unit: 'kg/gün', required: true,
  },
  obs_milkFat: {
    label: 'Süt yağı', type: 'number', min: 0, max: 15, unit: '%',
  },
  obs_milkProtein: {
    label: 'Süt proteini', type: 'number', min: 0, max: 10, unit: '%',
  },
  obs_bcs: {
    label: 'BCS', type: 'number', min: 1.0, max: 5.0, unit: 'puan',
  },
  obs_dmiActual: {
    label: 'Ölçülen KMT', type: 'number', min: 5, max: 40, unit: 'kg/gün',
  },
  obs_methane: {
    label: 'Metan', type: 'number', min: 0, max: 1000, unit: 'g/gün',
  },
  obs_rumenPh: {
    label: 'Rumen pH', type: 'number', min: 4.0, max: 7.5, unit: '',
  },
  obs_mun: {
    label: 'MUN (Süt Üre Azotu)', type: 'number', min: 0, max: 40, unit: 'mg/dL',
  },
  obs_manureScore: {
    label: 'Dışkı Skoru', type: 'number', min: 1.0, max: 5.0, unit: 'puan',
  },

  // ─── Yem (feedEditor.js) ───────────────────────────────────────────────
  feed_name: {
    label: 'Yem adı', type: 'string', required: true, minLength: 1, maxLength: 120,
  },
  feed_category: {
    label: 'Kategori', type: 'string', required: true,
  },
  feed_dm: {
    label: 'Kuru madde', type: 'number', min: 5, max: 100, unit: '%', required: true,
  },
  feed_nel: {
    label: 'Net Enerji Laktasyon', type: 'number', min: 0, max: 3, unit: 'Mcal/kg KM', required: true,
  },
  feed_cp: {
    label: 'Ham protein', type: 'number', min: 0, max: 100, unit: '% KM', required: true,
  },
  feed_pct: {
    label: '%KM değer', type: 'number', min: 0, max: 100, unit: '% KM',
  },
  feed_mineral_pct: {
    label: 'Makro mineral', type: 'number', min: 0, max: 50, unit: '% KM',
  },
  feed_trace_mg: {
    label: 'İz mineral', type: 'number', min: 0, max: 100000, unit: 'mg/kg KM',
  },
  feed_vit_iu: {
    label: 'Vitamin', type: 'number', min: 0, max: 10000000, unit: 'IU/kg KM',
  },
  feed_price: {
    label: 'Fiyat', type: 'number', min: 0, max: 200000, unit: 'TL/ton',
  },

  // ─── Rasyon Kurucu (rationBuilder.js) ──────────────────────────────────
  ration_costMax: {
    label: 'Maliyet tavanı', type: 'number', min: 0, max: 100000, unit: 'TL/gün',
  },
  ration_limit_kg: {
    label: 'Yem limit', type: 'number', min: 0, max: 100, unit: 'kg KM/gün',
  },
  ration_group_kg: {
    label: 'Grup limit', type: 'number', min: 0, max: 100, unit: 'kg KM/gün',
  },
};

// ─── Türkçe mesaj formatlayıcılar ─────────────────────────────────────────

/**
 * "X 800 kg geçersiz — 300-900 arasında olmalı."
 */
export function formatRangeError(label, value, min, max, unit) {
  const v = formatVal(value, unit);
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);
  if (hasMin && hasMax) return `${label} ${v} geçersiz — ${min}-${max}${unitSuffix(unit)} arasında olmalı.`;
  if (hasMin)           return `${label} ${v} geçersiz — en az ${min}${unitSuffix(unit)} olmalı.`;
  if (hasMax)           return `${label} ${v} geçersiz — en fazla ${max}${unitSuffix(unit)} olmalı.`;
  return `${label} değeri geçersiz.`;
}

export function formatRequiredError(label) {
  return `${label} alanı boş bırakılamaz.`;
}

export function formatTypeError(label, expected) {
  return `${label} ${expected === 'number' ? 'sayısal' : 'metin'} bir değer olmalı.`;
}

export function formatIntegerError(label, value) {
  return `${label} tam sayı olmalı (girilen: ${value}).`;
}

export function formatLengthError(label, value, minLength, maxLength) {
  const len = String(value ?? '').length;
  if (Number.isFinite(minLength) && len < minLength) return `${label} en az ${minLength} karakter olmalı.`;
  if (Number.isFinite(maxLength) && len > maxLength) return `${label} en fazla ${maxLength} karakter olmalı.`;
  return `${label} uzunluğu geçersiz.`;
}

function formatVal(v, unit) {
  if (v === '' || v === null || v === undefined || Number.isNaN(v)) return '"boş"';
  return `${v}${unitSuffix(unit, false)}`;
}

function unitSuffix(unit, withSpace = true) {
  if (!unit) return '';
  return (withSpace ? ' ' : ' ') + unit;
}

// ─── Pure validate fonksiyonları ──────────────────────────────────────────

/**
 * Tek alan validasyonu.
 * @param {string} name — FIELD_RULES anahtarı
 * @param {*} value — ham değer (string/number/null/undefined)
 * @param {object} [rules] — default FIELD_RULES; test/özelleştirme için override
 * @returns {{ok:boolean, error?:string}}
 */
export function validateField(name, value, rules = FIELD_RULES) {
  const rule = rules[name];
  if (!rule) return { ok: true };

  const isEmpty = value === undefined || value === null || value === '';

  if (rule.required && isEmpty) {
    return { ok: false, error: formatRequiredError(rule.label) };
  }
  if (isEmpty) return { ok: true };

  if (rule.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return { ok: false, error: formatTypeError(rule.label, 'number') };
    }
    if (rule.integer && !Number.isInteger(n)) {
      return { ok: false, error: formatIntegerError(rule.label, n) };
    }
    if (Number.isFinite(rule.min) && n < rule.min) {
      return { ok: false, error: formatRangeError(rule.label, n, rule.min, rule.max, rule.unit) };
    }
    if (Number.isFinite(rule.max) && n > rule.max) {
      return { ok: false, error: formatRangeError(rule.label, n, rule.min, rule.max, rule.unit) };
    }
    return { ok: true, value: n };
  }

  // string
  const s = String(value);
  if (Number.isFinite(rule.minLength) && s.length < rule.minLength) {
    return { ok: false, error: formatLengthError(rule.label, s, rule.minLength, rule.maxLength) };
  }
  if (Number.isFinite(rule.maxLength) && s.length > rule.maxLength) {
    return { ok: false, error: formatLengthError(rule.label, s, rule.minLength, rule.maxLength) };
  }
  return { ok: true, value: s };
}

/**
 * Toplu form validasyonu — değer haritasından.
 * @param {object} values — { fieldName: rawValue }
 * @param {string[]} fieldNames — kontrol edilecek alanlar (FIELD_RULES anahtarları)
 * @param {object} [rules] — default FIELD_RULES
 * @returns {{ok:boolean, errors:Array<{field, message}>}}
 */
export function validateForm(values, fieldNames, rules = FIELD_RULES) {
  const errors = [];
  for (const field of fieldNames) {
    const res = validateField(field, values?.[field], rules);
    if (!res.ok) errors.push({ field, message: res.error });
  }
  return { ok: errors.length === 0, errors };
}

// ─── DOM yardımcıları (tarayıcı tarafı) ──────────────────────────────────

/**
 * Form elementinden FormData oku, validateForm çalıştır, ilk hatalı input'a focus + invalid class.
 * @param {HTMLFormElement} formEl
 * @param {Array<{name:string, rule:string}>} fieldBindings — [{name:'bw', rule:'bw'}, ...]
 *        name = input'un DOM name attribute'u; rule = FIELD_RULES anahtarı (genellikle aynı)
 * @returns {{ok:boolean, errors:Array, values:object}}
 */
export function validateFormElement(formEl, fieldBindings) {
  if (!formEl) return { ok: true, errors: [], values: {} };
  const fd = new FormData(formEl);
  const values = {};
  for (const { name, rule } of fieldBindings) {
    values[rule] = fd.get(name);
  }
  const ruleNames = fieldBindings.map(b => b.rule);
  const { ok, errors } = validateForm(values, ruleNames);

  // DOM tarafı: önce tüm invalid class'ları temizle, sonra hatalı olanları işaretle
  for (const { name } of fieldBindings) {
    const input = formEl.querySelector(`[name="${name}"]`);
    if (input) {
      input.classList.remove('input-invalid');
      input.removeAttribute('data-error');
    }
  }
  if (!ok) {
    const ruleToName = new Map(fieldBindings.map(b => [b.rule, b.name]));
    for (const err of errors) {
      const name = ruleToName.get(err.field);
      if (!name) continue;
      const input = formEl.querySelector(`[name="${name}"]`);
      if (input) {
        input.classList.add('input-invalid');
        input.setAttribute('data-error', err.message);
        input.setAttribute('title', err.message);
      }
    }
    // İlk hatalı alana focus
    const firstName = ruleToName.get(errors[0].field);
    if (firstName) {
      const firstInput = formEl.querySelector(`[name="${firstName}"]`);
      if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
    }
  }
  return { ok, errors, values };
}

/**
 * Canlı validasyon: input'a blur/change listener bağlar.
 * Kullanıcı alandan çıkınca ihlal varsa kırmızı border + tooltip.
 * @param {HTMLFormElement} formEl
 * @param {Array<{name:string, rule:string}>} fieldBindings
 */
export function attachLiveValidation(formEl, fieldBindings) {
  if (!formEl) return;
  for (const { name, rule } of fieldBindings) {
    const input = formEl.querySelector(`[name="${name}"]`);
    if (!input) continue;
    const handler = () => {
      const res = validateField(rule, input.value);
      if (res.ok) {
        input.classList.remove('input-invalid');
        input.removeAttribute('data-error');
        input.removeAttribute('title');
      } else {
        input.classList.add('input-invalid');
        input.setAttribute('data-error', res.error);
        input.setAttribute('title', res.error);
      }
    };
    input.addEventListener('blur', handler);
    input.addEventListener('change', handler);
  }
}

/**
 * İhlal listesinden tek-satır özet (toast için).
 * Çoklu hatada "ve N hata daha" eklenir.
 */
export function summarizeErrors(errors) {
  if (!errors || errors.length === 0) return '';
  if (errors.length === 1) return errors[0].message;
  return `${errors[0].message} (ve ${errors.length - 1} hata daha)`;
}
