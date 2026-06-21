/**
 * Türkiye Bölge Bazlı Fiyat Şablonları (FAZ 11A)
 *
 * 7 coğrafi bölge için ortalama fiyat çarpanları (Mayıs 2026 referansı).
 * Her bölgenin yerel pazar dinamiklerine göre baz fiyatlara uygulanır:
 *   final_price = base_price × region.priceMultiplier × feedCategoryAdjust
 *
 * Kaynak: TÜİK 2025 hayvansal yem fiyat istatistikleri, TZOB bölge raporları
 */

export const TR_REGIONS = {
  marmara: {
    id: 'marmara',
    name: 'Marmara',
    description: 'İstanbul, Bursa, Kocaeli, Edirne, Tekirdağ ve çevresi',
    priceMultiplier: 1.10,  // Yüksek nakliye + arazi maliyeti
    categoryAdj: {
      roughage:  1.15,       // Kaba yem ithal/uzak nakliye → pahalı
      grain:     1.05,
      protein:   1.05,
      byproduct: 0.95,       // Endüstri yan ürünleri bol
      mineral:   1.00,
      fat:       1.00,
    },
    notes: 'Sanayi yan ürünleri (DDGS, kepek, melas) ucuz; kaba yem pahalı.',
    flagship: ['nrc_corn_ddgs', 'tr_wheat_bran', 'tr_molasses_beet'],
  },
  ege: {
    id: 'ege',
    name: 'Ege',
    description: 'İzmir, Manisa, Aydın, Denizli, Muğla ve çevresi',
    priceMultiplier: 1.00,   // Ortalama
    categoryAdj: {
      roughage:  0.95,       // Yerel mısır silajı bol
      grain:     1.00,
      protein:   1.05,
      byproduct: 1.00,
      mineral:   1.00,
      fat:       1.00,
    },
    notes: 'Mısır silajı verimli üretim bölgesi. Süt sığırcılığı yoğun.',
    flagship: ['tr_corn_silage_mid', 'nrc_corn_grain_coarse'],
  },
  ic_anadolu: {
    id: 'ic_anadolu',
    name: 'İç Anadolu',
    description: 'Ankara, Konya, Eskişehir, Kayseri, Sivas ve çevresi',
    priceMultiplier: 0.95,
    categoryAdj: {
      roughage:  1.10,       // Yonca kuru ot ucuz ama silaj uzak (su sınırlı)
      grain:     0.90,       // Tahıl üretim bölgesi → ucuz
      protein:   1.05,
      byproduct: 1.00,
      mineral:   1.00,
      fat:       1.00,
    },
    notes: 'Tahıl ve yonca üretim bölgesi. Selenyum-fakir topraklar (Se premiks önerilir).',
    flagship: ['nrc_alfalfa_hay_2cut', 'nrc_corn_grain_coarse', 'tr_barley_grain', 'min_premix_se_enriched'],
  },
  karadeniz: {
    id: 'karadeniz',
    name: 'Karadeniz',
    description: 'Samsun, Trabzon, Ordu, Giresun, Zonguldak ve çevresi',
    priceMultiplier: 1.05,
    categoryAdj: {
      roughage:  0.90,       // Çayır otu bol
      grain:     1.10,       // Tahıl ithal
      protein:   1.10,
      byproduct: 1.00,
      mineral:   1.05,       // Se premiks gerekli (fakir bölge)
      fat:       1.05,
    },
    notes: 'Çayır otu ve mera bol. Tahıl ithal. Se-fakir topraklar → Se premiks önemli.',
    flagship: ['nrc_grass_hay', 'min_premix_se_enriched'],
  },
  akdeniz: {
    id: 'akdeniz',
    name: 'Akdeniz',
    description: 'Antalya, Adana, Mersin, Hatay ve çevresi',
    priceMultiplier: 1.00,
    categoryAdj: {
      roughage:  1.00,
      grain:     1.05,
      protein:   1.00,       // Pamuk tohumu küspesi yerel → ucuz
      byproduct: 1.10,
      mineral:   1.00,
      fat:       1.00,
    },
    notes: 'Pamuk yan ürünleri (küspe, tohum) bol. Yaz ısı stresi yüksek (THI>80 sık).',
    flagship: ['tr_cottonseed_meal', 'tr_whole_cottonseed'],
  },
  dogu_anadolu: {
    id: 'dogu_anadolu',
    name: 'Doğu Anadolu',
    description: 'Erzurum, Van, Kars, Erzincan, Ağrı ve çevresi',
    priceMultiplier: 0.90,
    categoryAdj: {
      roughage:  0.85,       // Mera + yonca bol
      grain:     1.15,       // Tahıl ithal/uzak nakliye
      protein:   1.20,       // Protein konsantreleri pahalı
      byproduct: 1.10,
      mineral:   1.05,
      fat:       1.10,
    },
    notes: 'Geniş mera ve kaba yem üretimi. Protein konsantreleri pahalı. Kış uzun.',
    flagship: ['nrc_alfalfa_hay_1cut', 'nrc_grass_hay'],
  },
  guneydogu_anadolu: {
    id: 'guneydogu_anadolu',
    name: 'Güneydoğu Anadolu',
    description: 'Gaziantep, Şanlıurfa, Diyarbakır, Mardin ve çevresi',
    priceMultiplier: 0.95,
    categoryAdj: {
      roughage:  0.95,
      grain:     0.95,
      protein:   1.00,
      byproduct: 1.05,
      mineral:   1.00,
      fat:       1.00,
    },
    notes: 'GAP sulanan tarım. Mısır silajı ve buğday üretimi artıyor.',
    flagship: ['tr_corn_silage_mid', 'nrc_wheat_grain', 'tr_cottonseed_meal'],
  },
};

/**
 * Bölge ID listesi (UI dropdown için)
 */
export const TR_REGION_IDS = Object.keys(TR_REGIONS);

/**
 * Bir yemin bölgeye göre tahmini fiyatını hesaplar
 * (referans/baz fiyat üzerinden)
 *
 * @param {number} basePrice    - Referans fiyat (TL/ton)
 * @param {string} regionId     - Bölge ID
 * @param {string} category     - Yem kategorisi (roughage, grain, vb.)
 * @returns {number} Bölgeye uyarlanmış fiyat (TL/ton)
 */
export function adjustPriceForRegion(basePrice, regionId, category) {
  const region = TR_REGIONS[regionId];
  if (!region || !basePrice) return basePrice;
  const catAdj = region.categoryAdj[category] || 1.0;
  return Math.round(basePrice * region.priceMultiplier * catAdj);
}

/**
 * Bir bölgenin önerdiği yem ID'lerini döndürür (flagship items)
 */
export function regionFlagshipFeeds(regionId) {
  return TR_REGIONS[regionId]?.flagship ?? [];
}
