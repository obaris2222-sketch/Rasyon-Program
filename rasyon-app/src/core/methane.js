/**
 * Enterik Metan (CH₄) Emisyon Tahmini — FAZ 16.2
 *
 * Kaynaklar:
 *   - Moraes et al. (2014) Global Change Biology 20:2140–2148 — "Prediction of
 *     enteric methane emissions from cattle" (meta-analiz, geniş veritabanı)
 *   - Niu et al. (2018) Global Change Biology 24:3368–3389 — GLOBAL NETWORK
 *     kıtalararası süt sığırı veritabanı (CH₄ üretim/verim/yoğunluk modelleri)
 *   - Ellis et al. (2007) J. Dairy Sci. 90:3456 — DMI-bazlı lineer model
 *   - IPCC (2019 Refinement) Tier 2 — Ym (metan dönüşüm faktörü) ≈ %6 GE (süt)
 *   - Beauchemin et al. (2008) — diyet yağ (EE) ile CH₄ azaltımı
 *
 * ⚠️ Bilimsel dürüstlük notu:
 *   Enterik CH₄ üretiminin en güçlü belirleyicisi KURU MADDE TÜKETİMİDİR (DMI) —
 *   varyansın büyük kısmını tek başına açıklar. Bu modül lineer meta-analiz
 *   formunu kullanır: DMI birincil sürücü; NDF (lif → asetat/H₂ → CH₄) artırıcı,
 *   diyet yağ (EE) azaltıcı, kaba yem oranı artırıcı yönde sekonder düzeltmelerdir.
 *   Düzeltme katsayılarının YÖNÜ ve BÜYÜKLÜĞÜ yayınlanmış literatürle (Moraes 2014,
 *   Niu 2018, Beauchemin 2008) uyumludur; mutlak değerler IPCC Tier 2 referansına
 *   (~20 g CH₄/kg KMT, Ym≈%6) kalibre edilmiştir. Bireysel hayvan tahmini değil,
 *   rasyon-düzeyi karşılaştırma ve çevresel etki göstergesi amaçlıdır.
 */

// ─── Sabitler ────────────────────────────────────────────────────────────────

/**
 * CH₄ brüt enerji içeriği — IPCC değeri 55.65 MJ/kg.
 * 1 Mcal = 4.184 MJ → 55.65 / 4.184 = 13.30 Mcal/kg CH₄.
 * Metan olarak kaybedilen yem enerjisini (GE kaybı) hesaplamak için.
 */
export const CH4_ENERGY_MJ_PER_KG = 55.65;
export const CH4_ENERGY_MCAL_PER_KG = 13.30;

/** MJ → gram CH₄ dönüşümü: 1000 / 55.65 = 17.97 g CH₄ / MJ */
const G_PER_MJ = 1000 / CH4_ENERGY_MJ_PER_KG;

/**
 * CH₄ küresel ısınma potansiyeli (100 yıl) — IPCC AR5 (2014) değeri 28
 * (iklim-karbon geri beslemesi hariç). AR6 (2021) aralığı 27–30.
 * CO₂ eşdeğeri = CH₄ × METHANE_GWP100.
 */
export const METHANE_GWP100 = 28;

// ─── Tahmin modelleri ──────────────────────────────────────────────────────

/**
 * Moraes et al. (2014) tabanlı birincil model — DMI + NDF + CP.
 *
 * Lineer baz (Ellis 2007 / Moraes 2014 meta-analiz konsensüsü):
 *   CH₄ (MJ/gün) = 3.23 + 0.80 × DMI
 * Kompozisyon düzeltmeleri (çarpımsal, literatür yönünde):
 *   NDF: +%0.9 / NDF puanı (35% KM referans üstü) — lif fermentasyonu → asetat/H₂ → CH₄
 *   CP:  −%0.4 / CP puanı (16% KM referans üstü) — yüksek protein hafif düşürür
 *
 * @param {number} dmi  - Kuru madde tüketimi (kg/gün)
 * @param {number} ndf  - Rasyon NDF (% KM)
 * @param {number} cp   - Rasyon ham protein (% KM)
 * @returns {number} Tahmini enterik CH₄ üretimi (g/gün)
 */
export function methaneMoraes2014(dmi, ndf = 35, cp = 16) {
  const d = Number.isFinite(dmi) && dmi > 0 ? dmi : 0;
  if (d === 0) return 0;
  const ndfPct = Number.isFinite(ndf) ? ndf : 35;
  const cpPct = Number.isFinite(cp) ? cp : 16;

  const baseMJ = 3.23 + 0.80 * d;
  let ch4 = baseMJ * G_PER_MJ;
  ch4 *= 1 + 0.009 * (ndfPct - 35);   // NDF artırıcı
  ch4 *= 1 - 0.004 * (cpPct - 16);    // CP hafif azaltıcı
  return round1(Math.max(0, ch4));
}

/**
 * Niu et al. (2018) tabanlı alternatif model — DMI + yağ (EE) + kaba yem oranı.
 *
 * Lineer baz (aynı konsensüs): CH₄ (MJ/gün) = 3.23 + 0.80 × DMI
 * Kompozisyon düzeltmeleri (çarpımsal):
 *   Yağ (EE): −%4 / yağ puanı (3% KM referans üstü) — Beauchemin 2008; rumen
 *             biyohidrojenasyonu H₂ tüketir + protozoa baskılanır → CH₄ düşer
 *   Kaba yem oranı: +%0.5 / 10 puan (50% referans üstü) — daha çok lif → CH₄
 *
 * @param {number} dmi          - Kuru madde tüketimi (kg/gün)
 * @param {number} fat          - Rasyon yağ / eter ekstraktı (% KM)
 * @param {number} forageRatio  - Kaba yem oranı (% KM, 0–100)
 * @returns {number} Tahmini enterik CH₄ üretimi (g/gün)
 */
export function methaneNiu2018(dmi, fat = 3, forageRatio = 50) {
  const d = Number.isFinite(dmi) && dmi > 0 ? dmi : 0;
  if (d === 0) return 0;
  const fatPct = Number.isFinite(fat) ? fat : 3;
  const forage = Number.isFinite(forageRatio) ? forageRatio : 50;

  const baseMJ = 3.23 + 0.80 * d;
  let ch4 = baseMJ * G_PER_MJ;
  // Yağ azaltıcı (3% üstü); etki ~%6-8 yağda doygunlaşır (Beauchemin 2008) →
  // faktör 0.55'te tabanlanır (aşırı yağda gerçekçi olmayan ~0 CH₄ önlenir).
  const fatFactor = Math.max(0.55, 1 - 0.04 * Math.max(0, fatPct - 3));
  ch4 *= fatFactor;
  ch4 *= 1 + 0.005 * (forage - 50);            // kaba yem artırıcı
  return round1(Math.max(0, ch4));
}

/**
 * Metan yoğunluğu (emisyon intensity) — birim ürün başına CH₄.
 *
 * @param {number} ch4_g_per_day - Günlük CH₄ üretimi (g/gün)
 * @param {number} milk_kg       - Süt verimi (kg/gün); ≤0 ise (kuru inek) null
 * @returns {number|null} g CH₄ / kg süt (kuru inekte tanımsız → null)
 */
export function methaneIntensity(ch4_g_per_day, milk_kg) {
  if (!Number.isFinite(milk_kg) || milk_kg <= 0) return null;
  if (!Number.isFinite(ch4_g_per_day) || ch4_g_per_day <= 0) return 0;
  return round(ch4_g_per_day / milk_kg, 2);
}

/**
 * CH₄ → CO₂ eşdeğeri (kg CO₂eq/gün) — GWP100 = 28 (IPCC AR5).
 * @param {number} ch4_g_per_day - Günlük CH₄ üretimi (g/gün)
 * @returns {number} kg CO₂ eşdeğeri / gün
 */
export function methaneCO2eq(ch4_g_per_day) {
  const c = Number.isFinite(ch4_g_per_day) && ch4_g_per_day > 0 ? ch4_g_per_day : 0;
  return round((c * METHANE_GWP100) / 1000, 2);  // g → kg
}

/**
 * Metan yoğunluğu yorumu (g CH₄ / kg süt).
 *
 * Tipik süt sığırı CH₄ yoğunluğu ~12–18 g/kg süt (Niu 2018 ECM-bazlı ortalama
 * ~13.6 g/kg ECM). Düşük yoğunluk = besinsel verimliliğin yüksek olduğunu gösterir
 * (birim süt başına daha az emisyon — "dilution of maintenance" etkisi).
 *
 * @param {number|null} intensity - methaneIntensity() çıktısı (g/kg süt) veya null
 * @returns {object} { level, label, message, recommendations }
 */
export function interpretMethane(intensity) {
  if (intensity === null || intensity === undefined) {
    return {
      level: 'na',
      label: 'Tanımsız (kuru dönem)',
      message: 'Süt üretimi olmadığı için yoğunluk hesaplanmaz; günlük CH₄ üretimi gösterilir.',
      recommendations: [],
    };
  }

  if (intensity < 12) {
    return {
      level: 'low',
      label: 'Düşük (verimli)',
      message: 'Birim süt başına emisyon düşük — yüksek besinsel verimlilik göstergesi.',
      recommendations: [],
    };
  }
  if (intensity < 17) {
    return {
      level: 'normal',
      label: 'Tipik',
      message: 'Süt sığırı için tipik aralık (~12–18 g CH₄/kg süt).',
      recommendations: [
        'Verimliliği korumak için yeterli enerji yoğunluğu ve sindirilebilirliği sürdürün',
      ],
    };
  }
  if (intensity < 22) {
    return {
      level: 'high',
      label: 'Yüksek',
      message: 'Birim süt başına emisyon yüksek — verim ve/veya rasyon verimliliği iyileştirilebilir.',
      recommendations: [
        'Yem sindirilebilirliğini artırın (kaliteli kaba yem, uygun NDF)',
        'Diyet yağını değerlendirin (toplam yağ ≤ %5-6; rumen-korumalı yağ → CH₄ azaltır)',
        'Verim başına idame payını azaltın (üretim arttıkça yoğunluk düşer)',
      ],
    };
  }
  return {
    level: 'very_high',
    label: 'Çok Yüksek',
    message: 'Birim süt başına emisyon çok yüksek — rasyon ve sürü verimliliği gözden geçirilmeli.',
    recommendations: [
      'Düşük verimli/geç laktasyon hayvanlarda gruplama ve rasyon ayarı yapın',
      'Aşırı kaba yem oranını ve düşük sindirilebilir lifi azaltın',
      'Enerji yoğunluğunu ve yem verimliliğini (ECM/KMT) artırın',
      'Yağ takviyesi, iyonofor (monensin) veya 3-NOP gibi azaltıcı stratejileri değerlendirin',
    ],
  };
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function round(v, d = 2) {
  const m = Math.pow(10, d);
  return Math.round(v * m) / m;
}
function round1(v) { return Math.round(v * 10) / 10; }
