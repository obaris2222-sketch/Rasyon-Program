/**
 * FAZ 15.2 — Ayarlar veri katmanı testleri
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  updateSetting,
  resetSettings,
  deepMerge,
  migrateDmiMethodToAuto,
  _resetSettingsMemory,
} from '../src/data/settings.js';

// jsdom localStorage varsa onu, yoksa settings.js memory fallback'ini kullanırız.
// Her test öncesi temizle.
beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  _resetSettingsMemory();
});

describe('FAZ 15.2 — DEFAULT_SETTINGS', () => {
  it('beklenen kategorileri içerir', () => {
    expect(DEFAULT_SETTINGS.science.system).toBe('NASEM2021');
    expect(DEFAULT_SETTINGS.science.dmiMethod).toBe('auto');  // FAZ 17.3: bilim sistemine göre otomatik
    expect(DEFAULT_SETTINGS.farm).toHaveProperty('name');
    expect(DEFAULT_SETTINGS.defaults.parity).toBe(2);
    expect(DEFAULT_SETTINGS.defaults.milkPrice_tl).toBe(18);
    expect(DEFAULT_SETTINGS.units).toBe('metric');
    expect(DEFAULT_SETTINGS.language).toBe('tr');
    expect(DEFAULT_SETTINGS.theme).toBe('light');   // FAZ 15.10
  });

  it('dondurulmuştur (immutable) — yanlışlıkla mutasyona kapalı', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });
});

describe('FAZ 15.2 — getSettings', () => {
  it('kayıt yokken default döndürür', () => {
    const s = getSettings();
    expect(s.science.system).toBe('NASEM2021');
    expect(s.defaults.ambientTemp).toBe(20);
  });

  it('döndürülen nesne DEFAULT_SETTINGS referansı değildir (kopyadır)', () => {
    const s = getSettings();
    s.science.system = 'NRC2001';
    // Default bozulmamalı
    expect(DEFAULT_SETTINGS.science.system).toBe('NASEM2021');
  });

  it('bozuk JSON varsa default\'a düşer', () => {
    try { localStorage.setItem('rasyon_settings_v1', '{bozuk'); }
    catch { /* memory fallback testte localStorage var */ }
    const s = getSettings();
    expect(s.science.system).toBe('NASEM2021');
  });
});

describe('FAZ 15.2 — saveSettings + persist', () => {
  it('kısmi nesneyi kaydeder ve diğer alanları korur (deep merge)', () => {
    saveSettings({ science: { system: 'NRC2001' } });
    const s = getSettings();
    expect(s.science.system).toBe('NRC2001');
    // dmiMethod default korunmalı (FAZ 17.3: 'auto')
    expect(s.science.dmiMethod).toBe('auto');
    // farm/defaults dokunulmadan kalmalı
    expect(s.defaults.parity).toBe(2);
  });

  it('updatedAt timestamp ekler', () => {
    const saved = saveSettings({ farm: { name: 'Test Çiftliği' } });
    expect(saved.updatedAt).toBeTruthy();
    expect(new Date(saved.updatedAt).getTime()).not.toBeNaN();
  });

  it('art arda kaydetmeler birikir (önceki değerler kaybolmaz)', () => {
    saveSettings({ farm: { name: 'A Çiftliği' } });
    saveSettings({ defaults: { milkPrice_tl: 22 } });
    const s = getSettings();
    expect(s.farm.name).toBe('A Çiftliği');
    expect(s.defaults.milkPrice_tl).toBe(22);
  });

  // FAZ 15.10 — tema kalıcılığı + forward-compat
  it('theme alanını kaydeder ve diğer alanları korumakla birlikte geri getirir', () => {
    saveSettings({ theme: 'dark', farm: { name: 'Tema Çiftliği' } });
    const s = getSettings();
    expect(s.theme).toBe('dark');
    expect(s.farm.name).toBe('Tema Çiftliği');
    expect(s.science.system).toBe('NASEM2021');   // dokunulmadan kalmalı
  });

  it('eski kayıt (theme alanı yok) DEFAULT ile birleşince light kazanır (forward-compat)', () => {
    // FAZ 15.10 öncesi kayıt simülasyonu — deepMerge forward-compat'ı garanti eder
    // (getSettings her zaman DEFAULT_SETTINGS ile birleştirir; localStorage'dan bağımsız test).
    const merged = deepMerge(DEFAULT_SETTINGS, { science: { system: 'NRC2001' } });
    expect(merged.theme).toBe('light');             // DEFAULT'tan kazanıldı
    expect(merged.science.system).toBe('NRC2001');  // eski kayıttan korundu
  });
});

describe('FAZ 15.2 — updateSetting', () => {
  it('tek alanı günceller', () => {
    updateSetting('defaults', 'ambientTemp', 32);
    expect(getSettings().defaults.ambientTemp).toBe(32);
  });

  it('aynı kategorinin diğer alanlarını bozmaz', () => {
    updateSetting('defaults', 'humidity', 70);
    const s = getSettings();
    expect(s.defaults.humidity).toBe(70);
    expect(s.defaults.parity).toBe(2);   // default korundu
  });
});

describe('FAZ 15.2 — resetSettings', () => {
  it('kaydı temizler ve default döner', () => {
    saveSettings({ science: { system: 'NRC2001' }, farm: { name: 'X' } });
    resetSettings();
    const s = getSettings();
    expect(s.science.system).toBe('NASEM2021');
    expect(s.farm.name).toBe('');
  });
});

describe('FAZ 15.2 — deepMerge yardımcısı', () => {
  it('iç içe nesneleri birleştirir', () => {
    const base = { a: { x: 1, y: 2 }, b: 3 };
    const out = deepMerge(base, { a: { y: 20 } });
    expect(out).toEqual({ a: { x: 1, y: 20 }, b: 3 });
  });

  it('base nesnesini mutasyona uğratmaz', () => {
    const base = { a: { x: 1 } };
    deepMerge(base, { a: { x: 99 } });
    expect(base.a.x).toBe(1);
  });

  it('undefined değerleri yok sayar, dizileri üzerine yazar', () => {
    const out = deepMerge({ a: 1, list: [1, 2] }, { a: undefined, list: [9] });
    expect(out.a).toBe(1);          // undefined yazılmadı
    expect(out.list).toEqual([9]);  // dizi üzerine yazıldı
  });
});

describe('FAZ 17.3 — migrateDmiMethodToAuto (tek seferlik KMT göçü)', () => {
  it('kayıtlı NRC2001 → auto taşır ve migrated:true döner', () => {
    saveSettings({ science: { dmiMethod: 'NRC2001' } });
    const res = migrateDmiMethodToAuto();
    expect(res.migrated).toBe(true);
    expect(getSettings().science.dmiMethod).toBe('auto');
  });

  it('yalnızca BİR KEZ çalışır (ikinci çağrı no-op)', () => {
    saveSettings({ science: { dmiMethod: 'NRC2001' } });
    expect(migrateDmiMethodToAuto().migrated).toBe(true);
    // göç sonrası kullanıcı bilinçli olarak NRC2001'e dönerse korunur
    saveSettings({ science: { dmiMethod: 'NRC2001' } });
    expect(migrateDmiMethodToAuto().migrated).toBe(false);
    expect(getSettings().science.dmiMethod).toBe('NRC2001');
  });

  it('açık deSouza2019 seçimine dokunmaz (migrated:false)', () => {
    saveSettings({ science: { dmiMethod: 'deSouza2019' } });
    expect(migrateDmiMethodToAuto().migrated).toBe(false);
    expect(getSettings().science.dmiMethod).toBe('deSouza2019');
  });

  it('hiç kayıt yoksa (yeni kullanıcı) no-op', () => {
    expect(migrateDmiMethodToAuto().migrated).toBe(false);
    expect(getSettings().science.dmiMethod).toBe('auto');  // default
  });
});
