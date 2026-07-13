/**
 * Uygulama Ayarları Veri Katmanı (FAZ 15.2)
 *
 * localStorage tabanlı kalıcı ayar deposu. Tarayıcı yoksa (Node test ortamı)
 * bellek-içi Map'e düşer (feedService.js paterni).
 *
 * Ayarlar kategorileri:
 *   - science:  bilim sistemi (NRC 2001 / NASEM 2021) + KMT yöntemi
 *   - farm:     çiftlik profili (ad, adres, danışman) — PDF rapor başlığı için
 *   - defaults: yeni hayvan profili / rasyon varsayılanları
 *   - units:    birim sistemi (metrik / imperyal) — Aşama 2'de tam uygulanır
 *   - language: arayüz dili (tr aktif; en FAZ 16'da)
 */

const STORAGE_KEY = 'rasyon_settings_v1';

// Test/Node ortamı için bellek fallback'i
const _memory = new Map();

/**
 * Varsayılan ayarlar. getSettings her zaman bunlarla deep-merge eder →
 * ileride yeni alan eklenince eski kayıtlar bozulmadan default kazanır.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  science: {
    system: 'NASEM2021',      // 'NRC2001' | 'NASEM2021' | 'INRA2018' — gereksinim sistemi
    dmiMethod: 'auto',        // FAZ 17.3: 'auto' → bilim sistemine göre (NASEM/INRA→deSouza2019, NRC→NRC2001); 'NRC2001'/'deSouza2019' açık seçim
    autoEnergyDiscount: true, // FAZ 18.4: tüketim-düzeyi enerji iskontosu (NRC 2001 — yüksek tüketimde TDN/NEL düşer); varsayılan açık
    calcMode: 'nrc',          // FAZ 19.1: 'nrc' (tek-geçiş, varsayılan) | 'cncps' (iteratif — pasaj-bağımlı protein yıkımı)
  },
  farm: {
    name: '',
    address: '',
    advisor: '',              // danışman / besleme uzmanı adı (rapor altbilgisi)
    latitude: null,           // FAZ 16.9: Çiftlik konumu (Hava durumu için)
    longitude: null,
  },
  defaults: {
    ambientTemp: 20,          // °C — çevre sıcaklığı (ısı stresi)
    humidity: 50,             // % — bağıl nem
    parity: 2,                // varsayılan parite
    bcs: 3.0,                 // varsayılan vücut kondisyon skoru
    milkPrice_tl: 18,         // ₺/litre — ekonomi varsayılanı
  },
  units: 'metric',            // 'metric' | 'imperial' (Aşama 2)
  language: 'tr',             // 'tr' | 'en' (FAZ 16)
  theme: 'light',             // 'light' | 'dark' (FAZ 15.10 — koyu tema)
  activeFarmId: null,         // FAZ 16.11 — aktif çiftlik (çoklu-çiftlik/danışman)
  cloud: {                    // FAZ 16.10 — bulut senkronizasyon tercihleri
    autoSync: true,           // çevrimiçi olunca otomatik senkronize et
  },
  updatedAt: null,
});

// ─── localStorage Erişimi (fallback'li) ──────────────────────────────────────

function readRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return _memory.get(STORAGE_KEY) ?? null;
  }
}

function writeRaw(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    _memory.set(STORAGE_KEY, value);
  }
}

function removeRaw() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    _memory.delete(STORAGE_KEY);
  }
}

// ─── Deep Merge (sadece düz nesneler) ────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Düz veri (nesne/dizi/ilkel) için derin kopya — referans paylaşımını keser. */
function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone);
  if (isPlainObject(v)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = deepClone(v[k]);
    return o;
  }
  return v;
}

/**
 * `source`'u `base` üzerine derinlemesine birleştirir.
 * `base` mutasyona uğramaz ve dönen nesne `base`/`source` ile referans paylaşmaz
 * (nested objeler de klonlanır → donmuş DEFAULT_SETTINGS güvenle birleştirilebilir).
 * Yalnızca düz nesneler iç içe birleşir; ilkel/dizi değerler üzerine yazılır.
 */
export function deepMerge(base, source) {
  const out = deepClone(base);
  if (!isPlainObject(source)) return out;
  for (const key of Object.keys(source)) {
    const sv = source[key];
    if (isPlainObject(sv) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], sv);
    } else if (sv !== undefined) {
      out[key] = deepClone(sv);
    }
  }
  return out;
}

// ─── Genel API ────────────────────────────────────────────────────────────────

/**
 * Kayıtlı ayarları döndürür (her zaman DEFAULT_SETTINGS ile birleştirilmiş).
 * Bozuk JSON varsa default'a düşer.
 * @returns {object} tam ayar nesnesi
 */
export function getSettings() {
  const raw = readRaw();
  if (!raw) return deepMerge(DEFAULT_SETTINGS, {});
  try {
    const parsed = JSON.parse(raw);
    return deepMerge(DEFAULT_SETTINGS, parsed);
  } catch {
    return deepMerge(DEFAULT_SETTINGS, {});
  }
}

/**
 * Tam ayar nesnesini kaydeder (mevcut ile derin birleştirir).
 * @param {object} partial — değişen alanlar (kısmi nesne kabul edilir)
 * @returns {object} kaydedilen tam ayar nesnesi
 */
export function saveSettings(partial, { silent = false } = {}) {
  const current = getSettings();
  const merged = deepMerge(current, partial || {});
  merged.updatedAt = new Date().toISOString();
  if (!silent) merged._dirty = true;
  writeRaw(JSON.stringify(merged));
  if (!silent && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rasyon:settings-changed'));
  }
  return merged;
}

/**
 * Belirli bir kategorinin tek alanını günceller.
 * @param {string} category — 'science' | 'farm' | 'defaults' | ...
 * @param {string} key
 * @param {*} value
 * @returns {object} kaydedilen tam ayar nesnesi
 */
export function updateSetting(category, key, value) {
  return saveSettings({ [category]: { [key]: value } });
}

/**
 * FAZ 17.3: Tek seferlik KMT (DMI) yöntemi göçü.
 *
 * Eski global varsayılan `dmiMethod:'NRC2001'`, çoğu kullanıcıda bilinçli bir
 * seçim değil sessiz varsayılan olarak kalıcı olmuştu. Bu göç, kayıtlı 'NRC2001'
 * değerini bilim sistemiyle tutarlı **'auto'**ya taşır (NASEM/INRA kullanıcıları
 * artık de Souza 2019 KMT alır; NRC 2001 sistemi yine NRC 2001 KMT'de kalır).
 *
 * - YALNIZCA BİR KEZ çalışır (`_dmiAutoMigrated` bayrağı). Kullanıcı sonradan
 *   açıkça 'NRC2001' seçerse bayrak set olduğundan korunur (tekrar taşınmaz).
 * - Yalnız değer tam olarak 'NRC2001' ise değiştirir; 'deSouza2019'/'auto' dokunulmaz.
 * - Hiç kayıt yoksa (yeni kullanıcı) zaten 'auto' default → no-op.
 *
 * @returns {{ migrated: boolean }} bu çağrıda 'NRC2001'→'auto' uygulandıysa true
 */
export function migrateDmiMethodToAuto() {
  const raw = readRaw();
  if (!raw) return { migrated: false };           // yeni kullanıcı → zaten 'auto'
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { migrated: false }; }
  if (parsed._dmiAutoMigrated) return { migrated: false };  // daha önce yapıldı

  const wasNrc = parsed.science && parsed.science.dmiMethod === 'NRC2001';
  if (wasNrc) parsed.science.dmiMethod = 'auto';
  parsed._dmiAutoMigrated = true;                 // bir daha denemesin (her durumda set)
  parsed.updatedAt = new Date().toISOString();
  writeRaw(JSON.stringify(parsed));
  return { migrated: wasNrc };
}

/**
 * Tüm ayarları varsayılana döndürür (storage'ı temizler).
 * @returns {object} default ayarlar
 */
export function resetSettings() {
  removeRaw();
  return deepMerge(DEFAULT_SETTINGS, {});
}

/**
 * Senkronizasyon başarılı olduğunda dirty bayrağını temizler.
 */
export function clearSettingsDirty() {
  const current = getSettings();
  if (current._dirty) {
    current._dirty = false;
    writeRaw(JSON.stringify(current));
  }
}

/**
 * Uzaktan gelen ayarları yerele uygular (LWW).
 */
export function applyRemoteSettings(remote) {
  if (!remote) return false;
  const local = getSettings();
  const remoteTs = remote.updatedAt || '';
  const localTs = local.updatedAt || '';
  
  if (!local.updatedAt || remoteTs > localTs) {
    const merged = deepMerge(local, remote);
    merged._dirty = false;
    writeRaw(JSON.stringify(merged));
    return true;
  }
  return false;
}

/**
 * Yalnızca test temizliği için bellek fallback'ini sıfırlar.
 */
export function _resetSettingsMemory() {
  _memory.clear();
}
