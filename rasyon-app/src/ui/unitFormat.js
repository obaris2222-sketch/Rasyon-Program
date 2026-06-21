/**
 * Birim Biçimlendirme Yardımcıları (FAZ 15.2 Aşama 2)
 *
 * Bilimsel çekirdek HER ZAMAN metrik (kg, °C, L) çalışır. Bu modül yalnızca
 * GÖRÜNTÜ katmanında, kullanıcı tercihi 'imperial' ise dönüşüm uygular.
 * Saf fonksiyonlar — `units` parametresini alır, global state'e bağımlı değildir.
 */

export const KG_TO_LB = 2.2046226218;
export const L_TO_GAL = 0.2641720524;   // US galon

const isImperial = (units) => units === 'imperial';

// ─── Ağırlık (kg ↔ lb) ────────────────────────────────────────────────────────

/** kg değerini tercih birimine çevirir (sayı döner). */
export function weightToDisplay(kg, units) {
  const n = Number(kg);
  if (!Number.isFinite(n)) return n;
  return isImperial(units) ? n * KG_TO_LB : n;
}

/** Görüntü ağırlık birimi etiketi. */
export function weightUnit(units) {
  return isImperial(units) ? 'lb' : 'kg';
}

/** "650 kg" / "1433 lb" gibi biçimlenmiş ağırlık dizesi. (null/'' → "—"; 0 geçerli) */
export function formatWeight(kg, units, decimals = 0) {
  if (kg === null || kg === undefined || kg === '') return '—';
  const n = Number(kg);
  if (!Number.isFinite(n)) return '—';
  return `${weightToDisplay(n, units).toFixed(decimals)} ${weightUnit(units)}`;
}

// ─── Sıcaklık (°C ↔ °F) ───────────────────────────────────────────────────────

/** °C değerini tercih birimine çevirir (sayı döner). */
export function tempToDisplay(celsius, units) {
  const n = Number(celsius);
  if (!Number.isFinite(n)) return n;
  return isImperial(units) ? n * 9 / 5 + 32 : n;
}

/** Görüntü sıcaklık birimi etiketi. */
export function tempUnit(units) {
  return isImperial(units) ? '°F' : '°C';
}

/** "20 °C" / "68 °F" gibi biçimlenmiş sıcaklık dizesi. (null/'' → "—"; 0 geçerli) */
export function formatTemp(celsius, units, decimals = 0) {
  if (celsius === null || celsius === undefined || celsius === '') return '—';
  const n = Number(celsius);
  if (!Number.isFinite(n)) return '—';
  return `${tempToDisplay(n, units).toFixed(decimals)} ${tempUnit(units)}`;
}

// ─── Hacim (L ↔ gal) ──────────────────────────────────────────────────────────

/** litre değerini tercih birimine çevirir (sayı döner). */
export function volumeToDisplay(liters, units) {
  const n = Number(liters);
  if (!Number.isFinite(n)) return n;
  return isImperial(units) ? n * L_TO_GAL : n;
}

/** Görüntü hacim birimi etiketi. */
export function volumeUnit(units) {
  return isImperial(units) ? 'gal' : 'L';
}
