/**
 * Su Tüketimi Tahmini — FAZ 13.11
 *
 * Kaynak: Murphy et al. (1992) J. Dairy Sci. 75:213 (NRC 2001 Bölüm 8 referansı)
 * Laktasyondaki süt inekleri için serbest su tüketimi (free water intake) denklemi.
 *
 * Su, laktasyon performansını sınırlayan en kritik besindir; her zaman serbest
 * (ad libitum), temiz ve serin sunulmalıdır. Bu modül tahmini günlük su
 * tüketimini hesaplar (içme suyu yönetimi ve sıcak hava planlaması için).
 */

/**
 * Murphy (1992) serbest su tüketimi denklemi
 *
 *   WI (kg/gün) = 15.99 + 1.58×DMI + 0.90×Süt + 0.05×Na + 1.20×T
 *
 * @param {number} dmi_kg      - Kuru madde tüketimi (kg/gün)
 * @param {number} milkYield   - Süt verimi (kg/gün)
 * @param {number} naIntakeG   - Sodyum tüketimi (g/gün) — rasyon Na gereksinimi yaklaşımı
 * @param {number} tempC       - Ortam sıcaklığı (°C) — minimum/ortalama günlük
 * @returns {number} Tahmini serbest su tüketimi (litre/gün ≈ kg/gün)
 */
export function waterIntakeMurphy(dmi_kg, milkYield = 0, naIntakeG = 0, tempC = 20) {
  const dmi = Number.isFinite(dmi_kg) && dmi_kg > 0 ? dmi_kg : 0;
  const my = Number.isFinite(milkYield) && milkYield > 0 ? milkYield : 0;
  const na = Number.isFinite(naIntakeG) && naIntakeG > 0 ? naIntakeG : 0;
  const t = Number.isFinite(tempC) ? tempC : 20;

  const wi = 15.99 + 1.58 * dmi + 0.90 * my + 0.05 * na + 1.20 * t;
  return Math.round(Math.max(0, wi) * 10) / 10;
}

/**
 * Su tüketimi yeterlilik yorumu ve yönetim önerileri.
 *
 * Su her zaman ad libitum sunulmalı; bu fonksiyon tahmini tüketimi yorumlar
 * ve sıcak hava / yüksek verim koşullarında ek uyarılar üretir.
 *
 * @param {number} waterL    - Tahmini su tüketimi (litre/gün, waterIntakeMurphy çıktısı)
 * @param {object} [options]
 *   @param {number} [options.tempC]      - Ortam sıcaklığı (°C)
 *   @param {number} [options.milkYield]  - Süt verimi (kg/gün)
 *   @param {number} [options.dmi_kg]     - KMT (kg/gün) — su:KM oranı için
 * @returns {object} { waterL, waterPerKgDM, level, label, notes }
 */
export function interpretWaterAdequacy(waterL, options = {}) {
  const { tempC = null, milkYield = 0, dmi_kg = 0 } = options;
  const notes = [];

  // Su : KM oranı (tipik laktasyon 4-6 L/kg KM; ısı stresinde artar)
  const waterPerKgDM = dmi_kg > 0 ? Math.round((waterL / dmi_kg) * 10) / 10 : null;

  let level = 'normal';
  let label = 'Normal talep';

  if (Number.isFinite(tempC) && tempC > 25) {
    level = 'high_demand';
    label = 'Yüksek talep (sıcak hava)';
    notes.push('Sıcak hava: su tüketimi belirgin artar — gölgeli, serin (<20°C) ve bol içme suyu sağlayın');
  } else if (Number.isFinite(tempC) && tempC < 0) {
    notes.push('Donma riski: su kaynaklarının donmadığından emin olun (ısıtıcılı suluk)');
  }

  if (milkYield >= 35) {
    if (level === 'normal') { level = 'high_demand'; label = 'Yüksek talep (yüksek verim)'; }
    notes.push('Yüksek verimli inek: su kısıtı süt verimini hızla düşürür (ilk sınırlayıcı besin)');
  }

  notes.push('Su serbest (ad libitum), temiz ve günlük yenilenmiş olmalı; suluk başına ≤ 15-20 hayvan');

  return { waterL, waterPerKgDM, level, label, notes };
}
