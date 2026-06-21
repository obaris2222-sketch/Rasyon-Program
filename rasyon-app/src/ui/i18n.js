import tr from '../i18n/tr.json';
import en from '../i18n/en.json';
import { getSettings } from '../data/settings.js';

const translations = { tr, en };
let currentLang = 'tr';

/**
 * FAZ 21 (Veri Terminali): Etiket/başlık değerlerindeki BAŞTAKİ dekoratif emoji'yi
 * ayıklar (ikonlar artık tutarlı SVG/Tabler). Yalnız baştaki emoji kümesi + boşluğu
 * kaldırılır; metnin tamamı emoji ise (geriye boş kalırsa) orijinal korunur.
 * JSON'a dokunmaz → i18n parite testleri etkilenmez; yalnız çalışma-zamanı çıktısı.
 */
const LEADING_EMOJI = /^\s*[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2300}-\u{23FF}\u{2460}-\u{24FF}]+\s*/u;
function stripLeadingEmoji(s) {
  const out = s.replace(LEADING_EMOJI, '');
  return out.trim().length ? out : s;
}

/**
 * Initializes the i18n module by reading the user's preferred language from settings.
 * Should be called early during application startup.
 */
export function initI18n() {
  try {
    const settings = getSettings();
    if (settings && settings.language && translations[settings.language]) {
      currentLang = settings.language;
    }
  } catch (err) {
    console.warn('[i18n] Failed to load language from settings, defaulting to tr', err);
  }
}

/**
 * Changes the current language and dispatches a 'language-changed' event.
 * @param {string} lang - Language code (e.g., 'tr' or 'en')
 */
export function setLanguage(lang) {
  if (translations[lang] && currentLang !== lang) {
    currentLang = lang;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('language-changed', { detail: lang }));
    }
  }
}

/**
 * Returns the current active language code.
 * @returns {string}
 */
export function getLanguage() {
  return currentLang;
}

/**
 * Yem görünen adı (denetim #20): İngilizce dilde `nameEn` (varsa) kullanılır,
 * aksi halde Türkçe `name`. Tüm 500 yemde `nameEn` mevcuttur.
 * @param {object} feed - { name, nameEn } içeren yem/öğe nesnesi
 * @returns {string}
 */
export function feedDisplayName(feed) {
  if (!feed) return '';
  if (currentLang === 'en' && feed.nameEn) return feed.nameEn;
  return feed.name || feed.nameEn || '';
}

/**
 * Translates a given dot-notation key into the current language.
 * If the key is not found in the current language, falls back to 'tr'.
 * If the key is missing in 'tr' as well, returns the key string itself.
 *
 * @param {string} key - Dot-notation key (e.g., 'dashboard.quick_actions')
 * @param {object} params - Optional parameters for string interpolation (e.g., { name: 'Ahmet' } for "{name}")
 * @returns {string} Translated string
 */
export function t(key, params = {}) {
  if (!key) return '';
  
  const keys = key.split('.');
  let value = translations[currentLang];
  
  for (const k of keys) {
    if (value === undefined || value === null) break;
    value = value[k];
  }
  
  // Fallback to default (tr) if translation is missing
  if (value === undefined) {
    let fallback = translations['tr'];
    for (const k of keys) {
      if (fallback === undefined || fallback === null) break;
      fallback = fallback[k];
    }
    value = fallback;
  }
  
  // If completely missing, return the key
  if (value === undefined) {
    return key;
  }
  
  let result = stripLeadingEmoji(String(value));

  // Interpolate parameters
  if (params && Object.keys(params).length > 0) {
    for (const [pKey, pVal] of Object.entries(params)) {
      result = result.replace(new RegExp(`{${pKey}}`, 'g'), pVal);
    }
  }
  
  return result;
}
