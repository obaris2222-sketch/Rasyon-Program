/**
 * Yağ Asidi Profili ve Süt Yağ Kompozisyon Tahmini
 *
 * Modeller:
 *   - Glasser et al. (2008) JDS: süt yağ asidi tahmin denklemleri
 *   - Chilliard et al. (2007): trans-FA, CLA biohidrojenasyon
 *   - Palmquist (2009): omega-3/6 oranı süt kalitesi
 *
 * Önemli yağ asitleri:
 *   C16:0  - Palmitik (en yaygın doymuş)
 *   C18:0  - Stearik (doymuş)
 *   C18:1  - Oleik (cis-9, MUFA)
 *   C18:2  - Linoleik (n-6 PUFA, kritik)
 *   C18:3  - α-Linolenik (n-3 PUFA, kritik)
 *
 * Süt yağ asidi kategorileri:
 *   Kısa zincirli (C4-C10): %15-25 — rumen de novo sentezi
 *   Orta zincirli (C12-C16): %35-45 — karışık
 *   Uzun zincirli (C18+): %30-45 — diyet kökenli + adipoz mobilizasyonu
 */

/**
 * Yem yağı içinde tipik yağ asidi dağılımı (% toplam yağ)
 * Yem kategorilerine göre referans değerler (Palmquist 2009, NRC 2001)
 */
export const TYPICAL_FA_PROFILES = {
  // Tahıllar — yüksek C18:2 (linoleik)
  grain:     { c16_0: 14, c18_0: 2,  c18_1: 28, c18_2: 53, c18_3: 3 },
  // Yağlı tohumlar
  oilseed:   { c16_0: 11, c18_0: 4,  c18_1: 23, c18_2: 53, c18_3: 9 },
  // Kaba yemler — yüksek C18:3 (α-linolenik)
  roughage:  { c16_0: 18, c18_0: 3,  c18_1: 4,  c18_2: 18, c18_3: 57 },
  // Protein konsantreleri (soya küspesi vb.)
  protein:   { c16_0: 13, c18_0: 4,  c18_1: 22, c18_2: 53, c18_3: 8 },
  // By-product (DDGS, kepek vb.)
  byproduct: { c16_0: 16, c18_0: 2,  c18_1: 24, c18_2: 53, c18_3: 5 },
  // Hayvansal yağ / koruyucu yağ
  fat:       { c16_0: 25, c18_0: 18, c18_1: 38, c18_2: 15, c18_3: 4 },
  // Mineral premix
  mineral:   { c16_0: 0,  c18_0: 0,  c18_1: 0,  c18_2: 0,  c18_3: 0 },
};

/**
 * Bir yemin PUFA / ω6 / ω3 katsayıları (% KM) — FAZ 14.10 (LP kısıtları için)
 *
 * Yem yağ asidi profili `feed.faProfile` (varsa) veya kategori fallback'ten alınır
 * (estimateRationFA ile aynı kaynak → tutarlı). Sonuç % KM bazında:
 *   PUFA%KM   = fat[%KM] × (c18_2 + c18_3)[% toplam yağ] / 100
 *   ω6%KM     = fat[%KM] × c18_2 / 100   (linoleik)
 *   ω3%KM     = fat[%KM] × c18_3 / 100   (α-linolenik)
 *
 * LP kullanımı:
 *   PUFA max:   Σ(xi × pufa_i) ≤ pufa_max[%KM] × dmi
 *   ω6:ω3 ≤ R:  Σ(xi × (ω6_i − R×ω3_i)) ≤ 0  (oran kısıtı lineerleştirilmiş)
 *
 * @param {object} feed
 * @returns {{ pufa: number, omega6: number, omega3: number }} % KM
 */
export function faCoefPerKgDM(feed) {
  const fatPct = Number(feed?.fat) || 0;
  const profile = feed?.faProfile || TYPICAL_FA_PROFILES[feed?.category] || TYPICAL_FA_PROFILES.grain;
  const omega6 = fatPct * (Number(profile.c18_2) || 0) / 100;  // %KM
  const omega3 = fatPct * (Number(profile.c18_3) || 0) / 100;  // %KM
  return { pufa: omega6 + omega3, omega6, omega3 };
}

/**
 * Rasyondan toplam yağ asidi profili tahmini
 * Her yemin fat içeriği + kategorisi → toplam FA tahmini
 *
 * @param {object[]} items - { dmKg, category, fat? } items array
 * @param {object[]} feeds - feed library detayları
 * @returns {object} Toplam ve % bazında FA profili
 */
export function estimateRationFA(items, feeds) {
  const byId = new Map(feeds.map(f => [f.id, f]));
  const totals = { c16_0: 0, c18_0: 0, c18_1: 0, c18_2: 0, c18_3: 0, totalFat_g: 0 };

  for (const it of items) {
    const f = byId.get(it.id);
    if (!f) continue;
    const fatPct = Number(f.fat) || 0;
    const fatG = it.dmKg * fatPct * 10; // % → g/gün
    totals.totalFat_g += fatG;

    // Yem profilini önce override (varsa), sonra kategoriye düş
    const profile = f.faProfile || TYPICAL_FA_PROFILES[f.category] || TYPICAL_FA_PROFILES.grain;
    totals.c16_0 += fatG * (profile.c16_0 || 0) / 100;
    totals.c18_0 += fatG * (profile.c18_0 || 0) / 100;
    totals.c18_1 += fatG * (profile.c18_1 || 0) / 100;
    totals.c18_2 += fatG * (profile.c18_2 || 0) / 100;
    totals.c18_3 += fatG * (profile.c18_3 || 0) / 100;
  }

  const tf = totals.totalFat_g || 1;  // sıfır divizyondan kaçınma
  // Doymuş/doymamış toplam
  const sfa  = totals.c16_0 + totals.c18_0;
  const mufa = totals.c18_1;
  const pufa = totals.c18_2 + totals.c18_3;

  // Omega-6/Omega-3 oranı (linoleik / α-linolenik)
  const n6n3_ratio = totals.c18_3 > 0
    ? Math.round((totals.c18_2 / totals.c18_3) * 100) / 100
    : null;

  return {
    totalFat_g:     Math.round(totals.totalFat_g),
    c16_0_g:        Math.round(totals.c16_0 * 10) / 10,
    c18_0_g:        Math.round(totals.c18_0 * 10) / 10,
    c18_1_g:        Math.round(totals.c18_1 * 10) / 10,
    c18_2_g:        Math.round(totals.c18_2 * 10) / 10,  // omega-6
    c18_3_g:        Math.round(totals.c18_3 * 10) / 10,  // omega-3
    sfa_g:          Math.round(sfa * 10) / 10,
    mufa_g:         Math.round(mufa * 10) / 10,
    pufa_g:         Math.round(pufa * 10) / 10,
    omega6_g:       Math.round(totals.c18_2 * 10) / 10,
    omega3_g:       Math.round(totals.c18_3 * 10) / 10,
    n6n3_ratio,
    sfa_pct:        Math.round(sfa / tf * 1000) / 10,
    mufa_pct:       Math.round(mufa / tf * 1000) / 10,
    pufa_pct:       Math.round(pufa / tf * 1000) / 10,
  };
}

/**
 * Süt yağı kompozisyonu tahmini (Glasser et al. 2008)
 *
 * Süt yağ asitlerinin kabaca %50'si rumen de novo sentezi (C4-C16),
 * %50'si diyet+mobilizasyon kökenli (C18+).
 *
 * Diyet C18:2 → süt C18:2 (kısmen biohidrojenize)
 * Diyet C18:3 → süt C18:3
 * Yüksek konsantre + düşük peNDF → biohidrojenasyon aksar → trans-FA artar → süt yağ düşer (MFD)
 *
 * @param {object} dietFA - estimateRationFA() çıktısı
 * @param {object} rationParams - { peNDFPct, nfcPct, dmi_kg }
 * @returns {object} Tahmini süt yağ asidi dağılımı + CLA tahmini + MFD riski
 */
export function estimateMilkFA(dietFA, rationParams) {
  // Girdiler
  const dmi = rationParams.dmi_kg || 20;
  const my = rationParams.milkYield_kg || 30; // Litre/gün olarak kabul et
  const peNDF = rationParams.peNDFPct || 22;
  const nfc = rationParams.nfcPct || 40;

  // 1. Rumen Biohidrojenasyonu (BH) katsayıları (NRC 2001 / Glasser 2008)
  // Çoğunlukla PUFA'lar doymuş hale geçer (hidrojenlenir)
  const bh_c18_2 = 0.80; // Linoleik asidin ~%80'i hidrojenlenir
  const bh_c18_3 = 0.92; // Linolenik asidin ~%92'si hidrojenlenir
  const bh_c18_1 = 0.70; // Oleik asidin ~%70'i

  // İnce bağırsağa (duodenum) akan (Pre-formed) Yağ Asitleri (g/gün)
  const duod_c18_2 = dietFA.c18_2_g * (1 - bh_c18_2);
  const duod_c18_3 = dietFA.c18_3_g * (1 - bh_c18_3);
  const duod_c18_1 = dietFA.c18_1_g * (1 - bh_c18_1);
  
  // Biohidrojenasyondan gelen C18:0 (Stearik Asit) - %85 tam dönüşüm varsayımıyla (kalanlar trans vb)
  const bh_to_c18_0 = ((dietFA.c18_2_g * bh_c18_2) + (dietFA.c18_3_g * bh_c18_3) + (dietFA.c18_1_g * bh_c18_1)) * 0.85; 
  const duod_c18_0 = dietFA.c18_0_g + bh_to_c18_0;
  const duod_c16_0 = dietFA.c16_0_g; 

  // 2. İntestinal Sindirilebilirlik & Meme Bezine Transfer Katsayısı
  // Sindirim: ~%75, Meme bezine geçiş: ~%50 -> Total Transfer = 0.375
  const transfer_coef = 0.375; 

  let mammary_c16_0 = duod_c16_0 * transfer_coef;
  let mammary_c18_0 = duod_c18_0 * transfer_coef;
  let mammary_c18_1 = duod_c18_1 * transfer_coef;
  let mammary_c18_2 = duod_c18_2 * transfer_coef;
  let mammary_c18_3 = duod_c18_3 * transfer_coef;

  // 3. Mammary Desaturation (Bauman & Griinari 2003)
  // Stearoyl-CoA desaturase ile memede C18:0'ın ~%45'i C18:1 cis-9'a (Oleik asit) döner.
  const desaturation_rate = 0.45;
  const converted_to_c18_1 = mammary_c18_0 * desaturation_rate;
  mammary_c18_0 -= converted_to_c18_1;
  mammary_c18_1 += converted_to_c18_1;

  // Toplam Pre-formed (Diyet kökenli uzun zincirli) Süt Yağı (g/gün)
  const preformed_g = mammary_c16_0 + mammary_c18_0 + mammary_c18_1 + mammary_c18_2 + mammary_c18_3;

  // 4. De Novo Sentezi (C4 - C14 ve C16'nın bir kısmı)
  // Sağlıklı rumen ortamında 1 kg süt başına yaklaşık 17.5 g de novo asit sentezlenir.
  const basal_denovo_per_kg_milk = 17.5; 
  
  // Rumen sağlığı faktörü (NFC yüksek, peNDF düşükse Milk Fat Depression - MFD başlar)
  const rumen_health_factor = Math.max(0.4, Math.min(1.0, 
    1.0 - Math.max(0, 22 - peNDF) * 0.05 - Math.max(0, nfc - 42) * 0.03
  ));

  let deNovo_g = my * basal_denovo_per_kg_milk * rumen_health_factor;

  // Rasyondaki aşırı yağ yükü (PUFA fazlalığı) de novo sentezini baskılar (MFD trans-10 pathway)
  const fat_pct_dm = (dietFA.totalFat_g / (dmi * 1000)) * 100;
  let fat_depression = 0;
  if (fat_pct_dm > 4.5) {
     fat_depression = Math.min(0.20, (fat_pct_dm - 4.5) * 0.1);
     deNovo_g *= (1 - fat_depression);
  }

  // 5. Süt yağı yüzdesi — KALİBRE tahmin (denetim düzeltmesi).
  //    Saf kütle-dengesi (preformed + deNovo) vücut yağ MOBİLİZASYONUNU kapsamadığı için
  //    mutlak süt yağını ~%40 düşük tahmin eder (sağlıklı/Grade-A rasyonda bile ~%2.3 çıkıp
  //    "MFD var" gibi yanıltıcı görünüyordu). Bunun yerine süt yağı yüzdesi genetik taban ×
  //    rumen sağlığı × yağ baskısı ile kalibre edilir — bu, Bauman & Griinari MFD modelinin
  //    pratik (ampirik) formu; düşük peNDF + yüksek NFC + PUFA fazlasının GÖRECELİ etkisini
  //    doğru yansıtır, mutlak değer gerçekçi kalır. deNovo_g/preformed_g diyet-kökenli
  //    mekanistik bileşen olarak (FA kırılımı için) korunur.
  const BASELINE_MILK_FAT_PCT = 3.9;  // iyi beslenen Holstein genetik potansiyel proxy'si
  let estimatedMilkFatPct = BASELINE_MILK_FAT_PCT * rumen_health_factor * (1 - fat_depression);
  estimatedMilkFatPct = Math.max(2.0, Math.min(6.0, estimatedMilkFatPct));

  // Tahmini toplam süt yağı kalibre yüzdeyle tutarlı (kütle-dengesi bileşenleri + örtük mobilizasyon)
  const totalMilkFat_g = Math.round(estimatedMilkFatPct / 100 * my * 1000);

  // Risk & Göstergeler
  const mfdRisk = rumen_health_factor < 0.70 ? 'high'
                : rumen_health_factor < 0.85 ? 'moderate' : 'low';
                
  const cla_mg_per_g_fat = (dietFA.pufa_pct * 0.3); // Ampirik CLA proxy'si
  const transFA_g_per_kgmilk = (dietFA.pufa_g * 0.1) / my;

  return {
    deNovo_g: Math.round(deNovo_g),
    preformed_g: Math.round(preformed_g),
    totalMilkFat_g: Math.round(totalMilkFat_g),
    estimatedMilkFatPct: Math.round(estimatedMilkFatPct * 100) / 100,
    mfdRisk,
    milk_c18_0_g: Math.round(mammary_c18_0),
    milk_c18_1_g: Math.round(mammary_c18_1),
    milk_c18_2_g: Math.round(mammary_c18_2),
    milk_c18_3_g: Math.round(mammary_c18_3),
    cla_mg_per_g_fat: Math.round(cla_mg_per_g_fat * 10) / 10,
    transFA_g_per_kgmilk: Math.round(transFA_g_per_kgmilk * 10) / 10,
    n6n3_ratio: dietFA.n6n3_ratio,
    n6n3_status: (!dietFA.n6n3_ratio) ? 'na' 
                 : (dietFA.n6n3_ratio <= 4) ? 'optimal' 
                 : (dietFA.n6n3_ratio <= 8) ? 'acceptable' : 'high_n6',
    
    // Geriye dönük modül uyumluluğu için legacy property'ler:
    deNovoSuppression: Math.round((1 - rumen_health_factor) * 100) / 100,
    bhEfficiency: 0.80, 
    milkFatChange_pct: Math.round((estimatedMilkFatPct - 3.7) * 100) / 100,
    milk_c18_2_frac: Math.round((mammary_c18_2 / totalMilkFat_g) * 1000)/1000,
    milk_c18_3_frac: Math.round((mammary_c18_3 / totalMilkFat_g) * 1000)/1000,
  };
}

/**
 * Yağ asidi değerlendirmesi — TR yorum etiketleri
 * @param {object} dietFA - estimateRationFA çıktısı
 * @param {object} milkFA - estimateMilkFA çıktısı
 * @returns {object} { warnings, recommendations, score }
 */
export function assessFAProfile(dietFA, milkFA) {
  const warnings = [];
  const recommendations = [];
  let score = 100;

  // 1. Toplam yağ — çok yüksekse rumen baskı
  const fatLoadPct = dietFA.totalFat_g / 1000;  // ~%KM cinsinden
  if (dietFA.totalFat_g > 1200) {
    warnings.push({ type: 'fat_high', message: 'Toplam diyet yağı yüksek — rumen fonksiyonu baskılanabilir', severity: 'medium' });
    score -= 10;
  }

  // 2. Omega-6/Omega-3 oranı
  if (milkFA.n6n3_status === 'high_n6') {
    warnings.push({ type: 'n6_high', message: `n-6/n-3 oranı yüksek (${milkFA.n6n3_ratio}) — pro-inflamatuvar süt`, severity: 'medium' });
    recommendations.push('Keten tohumu, balık unu veya çayır kaba yemi ekleyin (n-3 artırır)');
    score -= 15;
  } else if (milkFA.n6n3_status === 'optimal') {
    recommendations.push('n-6/n-3 oranı optimal süt kalitesi için ideal');
  }

  // 3. Süt yağı depresyonu (MFD)
  if (milkFA.mfdRisk === 'high') {
    warnings.push({ type: 'mfd', message: `Süt yağı depresyonu riski yüksek — tahmini düşüş %${(-milkFA.milkFatChange_pct).toFixed(1)}`, severity: 'high' });
    recommendations.push('peNDF\'i %22 üzerine çıkarın veya NFC\'i %42 altına indirin');
    score -= 25;
  } else if (milkFA.mfdRisk === 'moderate') {
    warnings.push({ type: 'mfd', message: 'Süt yağı orta riski — biohidrojenasyon kısmen aksıyor', severity: 'medium' });
    score -= 10;
  }

  // 4. Biohidrojenasyon verimliliği
  if (milkFA.bhEfficiency < 0.6) {
    warnings.push({ type: 'low_bh', message: 'Düşük biohidrojenasyon — trans-FA artışı + MFD riski', severity: 'high' });
    score -= 15;
  }

  // 5. PUFA toplamı (omega-3 + omega-6) — yetersizse süt kalitesi düşük
  if (dietFA.pufa_pct < 30 && dietFA.totalFat_g > 0) {
    recommendations.push('PUFA içeriği düşük — yağlı tohum veya bitkisel yağ ile zenginleştirin');
  }

  return {
    score: Math.max(0, score),
    grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D',
    warnings,
    recommendations,
  };
}
