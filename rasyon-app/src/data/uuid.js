/**
 * UUID Üretimi (FAZ 16.10 — Bulut Senkronizasyon temeli)
 *
 * Küresel benzersiz kimlik üretir. Bulut senkronizasyonu için zorunlu:
 * iki cihaz autoIncrement ile aynı sayısal id'yi (1,2,3…) üretirse farklı
 * kayıtlar çakışır. UUID ile her kayıt evrensel benzersizdir.
 *
 * Tarayıcıda `crypto.randomUUID()` (modern, RFC 4122 v4). Eski ortam / bazı
 * Node sürümlerinde `crypto` yoksa Math.random tabanlı güvenli fallback.
 */

/**
 * Yeni bir UUID (v4) string döndürür.
 * @returns {string}
 */
export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (RFC 4122 v4 biçimli) — kriptografik değil ama çakışma olasılığı ihmal edilebilir
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Bir değerin UUID benzeri (string, 'undefined'/sayısal değil) olup olmadığını
 * kabaca doğrular. Göç sırasında "zaten UUID mi?" kontrolü için.
 * @param {*} v
 * @returns {boolean}
 */
export function looksLikeUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
