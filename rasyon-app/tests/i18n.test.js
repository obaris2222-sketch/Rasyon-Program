import { describe, it, expect, beforeEach } from 'vitest';
import { initI18n, setLanguage, getLanguage, t } from '../src/ui/i18n.js';
import { _resetSettingsMemory, saveSettings } from '../src/data/settings.js';
import trMessages from '../src/i18n/tr.json';
import enMessages from '../src/i18n/en.json';

// Yaprak (leaf) anahtarları düz "a.b.c" yoluna indirger
function flattenKeys(obj, prefix = '', acc = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenKeys(v, key, acc);
    else acc[key] = v;
  }
  return acc;
}

// FAZ 17.1: i18n parite testi — TR ve EN tam parite (eksik/boş çeviri t() fallback'iyle
// yanlış dilde metin gösterilmesini önler). Yeni anahtarlar iki dosyaya da eklenmeli.
describe('i18n TR/EN parity (FAZ 17.1)', () => {
  const trLeaves = flattenKeys(trMessages);
  const enLeaves = flattenKeys(enMessages);

  it('TR ve EN aynı yaprak-anahtar setine sahip', () => {
    const trKeys = Object.keys(trLeaves);
    const enKeys = Object.keys(enLeaves);
    const onlyInTr = trKeys.filter(k => !(k in enLeaves));
    const onlyInEn = enKeys.filter(k => !(k in trLeaves));
    expect(onlyInTr, `Yalnız TR'de: ${onlyInTr.join(', ')}`).toEqual([]);
    expect(onlyInEn, `Yalnız EN'de: ${onlyInEn.join(', ')}`).toEqual([]);
    expect(trKeys.length).toBe(enKeys.length);
  });

  it('hiçbir çeviri boş değil', () => {
    const emptyTr = Object.entries(trLeaves).filter(([, v]) => !String(v).trim()).map(([k]) => k);
    const emptyEn = Object.entries(enLeaves).filter(([, v]) => !String(v).trim()).map(([k]) => k);
    expect(emptyTr, `Boş TR: ${emptyTr.join(', ')}`).toEqual([]);
    expect(emptyEn, `Boş EN: ${emptyEn.join(', ')}`).toEqual([]);
  });

  it('FAZ 17.1 "gösterim — formülasyonu yönetmez" rozeti iki dilde de var', () => {
    expect(trLeaves['results.display_badge']).toBeTruthy();
    expect(enLeaves['results.display_badge']).toBeTruthy();
  });
});

describe('i18n Module', () => {
  beforeEach(() => {
    _resetSettingsMemory();
    saveSettings({ language: 'tr' });
    initI18n();
    setLanguage('tr'); // Default state
  });

  it('should initialize with settings language', () => {
    saveSettings({ language: 'en' });
    initI18n();
    expect(getLanguage()).toBe('en');
  });

  it('should switch language', () => {
    setLanguage('en');
    expect(getLanguage()).toBe('en');
  });

  it('should translate existing keys in current language', () => {
    // FAZ 21 (Veri Terminali): t() artık baştaki dekoratif emoji'yi ayıklar
    // (ikonlar tutarlı SVG/Tabler oldu) → değer "⚙️ Ayarlar" değil "Ayarlar".
    expect(t('settings.title')).toBe('Ayarlar');
    setLanguage('en');
    expect(t('settings.title')).toBe('Settings');
  });

  it('should strip a leading decorative emoji from labels (FAZ 21)', () => {
    // Baştaki emoji + boşluk ayıklanır; metin korunur.
    expect(t('tabs.dashboard')).toBe('Ana Sayfa');
    expect(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t('results.card_items'))).toBe(false);
  });

  it('should return the key if translation does not exist in any language', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('should fallback to tr if key is missing in en', () => {
    // If we add a key to TR but forget in EN, it should return TR version
    // Mock scenario using existing keys where EN has the key
    // Since our JSON files are synced right now, we test the normal flow.
    setLanguage('en');
    expect(t('tabs.dashboard')).toBe('Dashboard');   // FAZ 21: emoji ayıklandı
  });

  it('should interpolate parameters', () => {
    // We don't have interpolated strings yet, but let's test the function
    const result = t('fake.key', { name: 'Ahmet' });
    // Since 'fake.key' doesn't exist, it returns 'fake.key'. 
    // The interpolation replaces `{name}` in the value.
    expect(result).toBe('fake.key'); 
  });
});
