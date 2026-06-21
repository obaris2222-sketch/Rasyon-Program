/**
 * Paylaşılan Bilimsel Sabitler — FAZ 13.2
 *
 * Pipeline boyunca aynı katsayıların kullanıldığından emin olmak için tek
 * kaynak. Önceden nrc2001.js, cncps.js, lpBuilder.js ve rationOptimizer.js
 * birbirinden farklı değerlerle çalışıyordu (0.80 / 0.64 / 0.60 karışıklığı).
 *
 * Kaynaklar:
 *   - CNCPS v6.5 (Van Amburgh et al., 2015)
 *   - NASEM 2021 (8. Baskı, Bölüm 3 — Protein)
 *   - NRC 2001 (7. Baskı, geri uyumluluk için kaynak referansı)
 */

// ─── MİKROBİYAL PROTEİN ───────────────────────────────────────────────────

/**
 * Mikrobiyal Ham Protein (MCP) intestinal sindirilebilirlik katsayısı.
 *
 * MP_microbial = MCP × MCP_INTESTINAL_DIGESTIBILITY
 *
 * - NRC 2001'de tipik değer 0.80 idi (eski varsayım).
 * - CNCPS v6.5 ve NASEM 2021: gerçek mikrobiyal AA sindirilebilirliği ~%64
 *   (true microbial AA-N digestibility). Mikrobiyal CP içinde ~%80 gerçek
 *   protein × ~%80 sindirilebilirlik ≈ %64.
 *
 * FAZ 13.2 sonrası pipeline boyunca tek sabit.
 */
export const MCP_INTESTINAL_DIGESTIBILITY = 0.64;

/**
 * RDP'den MCP'ye dönüşüm verimliliği (N geri kazanımı).
 * MCP_from_RDP_g = RDP_g × RDP_TO_MCP_EFFICIENCY
 * Hem NRC 2001 hem NASEM 2021'de aynı: 0.85
 */
export const RDP_TO_MCP_EFFICIENCY = 0.85;

/**
 * TDN'den MCP'ye dönüşüm (enerji-sınırlı MCP).
 * MCP_from_energy_g = TDN_kg × TDN_TO_MCP_G_PER_KG
 * NRC 2001 / NASEM 2021: 130 g MCP / kg TDN
 *
 * Birim notu: TDN g/kg KM cinsinden geçirilirse katsayı 0.13 olur
 * (130 g/kg = 0.13 g/g). lpBuilder.js mpPerKgDM bu birimde çalışır.
 */
export const TDN_TO_MCP_G_PER_KG = 130;
export const TDN_TO_MCP_FRACTION = 0.13;

// ─── PROTEİN VERİMLİLİKLERİ ────────────────────────────────────────────────

/**
 * Süt protein verimliliği — MP'den süt proteinine dönüşüm.
 * NRC 2001 ve NASEM 2021'de korunmuş: 0.67
 * MP_lactation_g_required = (milkYield_kg × milkProtein_pct × 10) / MILK_PROTEIN_EFFICIENCY
 */
export const MILK_PROTEIN_EFFICIENCY = 0.67;

// ─── SİSTEM SEÇİM KATSAYILARI (NRC 2001 — geri uyumluluk) ─────────────────

/**
 * NRC 2001 (eski) MCP intestinal sindirilebilirlik — yalnızca geri uyumluluk
 * gerektiren testler/raporlar için. Yeni kod MCP_INTESTINAL_DIGESTIBILITY
 * sabitini kullanmalıdır.
 *
 * @deprecated FAZ 13.2 — yeni pipeline'da kullanılmaz.
 */
export const MCP_INTESTINAL_DIGESTIBILITY_NRC2001 = 0.80;
