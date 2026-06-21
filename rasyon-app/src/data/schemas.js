/**
 * Hayvan Profili Şeması
 * NRC 2001 / NASEM 2021 giriş parametreleri
 */
export const AnimalProfileSchema = {
  id: 'string',
  name: 'string',
  breed: 'string',            // 'Holstein' | 'Jersey' | 'Simental' | 'Montofon' | 'Brown Swiss' | 'Diğer' (FAZ 12 M1 — idrar pH yorumu için Jersey/Holstein ayrımı)
  parity: 'number',           // laktasyon sayısı (1, 2, 3+)
  dim: 'number',              // Days In Milk - laktasyondaki gün sayısı
  bw: 'number',               // Canlı ağırlık (kg)
  bcs: 'number',              // Vücut kondisyon skoru (1.0 - 5.0)
  milkYield: 'number',        // Süt verimi (kg/gün)
  milkFat: 'number',          // Süt yağı (%)
  milkProtein: 'number',      // Süt proteini (%)
  milkLactose: 'number',      // Süt laktozu (%) - bilinmiyorsa null
  pregnant: 'boolean',        // Gebe mi?
  gestDays: 'number',         // Gebelik günü (0-280) — pregnancyMonth × 30 ile türetilir
  pregnancyMonth: 'number',   // Gebelik ayı (1-9) — UI girişi
  targetBcs: 'number',        // Hedef vücut kondisyon skoru
  targetADG: 'number',        // Hedef günlük canlı ağırlık artışı (kg/gün) — primipar büyüme (FAZ 13.10)
  matureBW: 'number',         // Olgun canlı ağırlık (kg) — büyüme hesabı (varsayılan 680 Holstein)
  activityLevel: 'string',    // 'low' | 'medium' | 'high'
  lactationStage: 'string',   // 'early' | 'mid' | 'late' | 'far_off' | 'close_up'
  thi: 'number',              // Isı-nem indeksi (calcTHI ile otomatik hesaplanır)
  ambientTemp: 'number',      // Ortam sıcaklığı (°C) — opsiyonel, THI için
  humidity: 'number',         // Bağıl nem (%) — opsiyonel, THI için
  urinePH: 'number',          // Saha ölçümlü idrar pH — opsiyonel, DCAD doğrulama
  housingType: 'string',      // 'freestall' | 'tiestall' | 'pasture'
  dailyWalkKm: 'number',      // Günlük yürüyüş mesafesi (km)
  groupId: 'string',          // Sürü grubu ID
  createdAt: 'string',        // ISO date string
  updatedAt: 'string',
};

/**
 * Yem Maddesi Şeması
 * NRC 2001 Tablo 15-1/15-2a formatı + Türkiye eklentileri
 */
export const FeedIngredientSchema = {
  id: 'string',
  name: 'string',
  nameEn: 'string',
  category: 'string',         // 'roughage' | 'grain' | 'protein' | 'mineral' | 'vitamin' | 'byproduct'
  dm: 'number',               // Kuru madde (%)
  source: 'string',           // 'NRC2001' | 'NASEM2021' | 'INRA2018' | 'CVB' | 'user'

  // Enerji
  nel: 'number',              // Net Enerji Laktasyon (Mcal/kg KM)
  nelDiscount: 'number',      // 3x faktörü NEL indirimi (%)
  tdn: 'number',              // Total Digestible Nutrients (%)

  // Protein
  cp: 'number',               // Ham Protein (% KM)
  rup: 'number',              // Rumen By-pass Protein (% CP)
  rdp: 'number',              // Rumen Parçalanabilen Protein (% CP)
  rupIntD: 'number',          // RUP intestinal sindirilebilirlik (%)

  // Karbonhidrat / Fiber
  ndf: 'number',              // Nötral Deterjan Fiber (% KM)
  adf: 'number',              // Asit Deterjan Fiber (% KM)
  lignin: 'number',           // Lignin (% KM) — opsiyonel, yoksa ADF×0.127 fallback (FAZ 10I)
  aNDF: 'number',             // Parçacık boyutu düzeltmeli NDF (% KM)
  nfc: 'number',              // Non-Fiber Carbohydrate (% KM)
  starch: 'number',           // Nişasta (% KM)
  sugar: 'number',            // Şeker (% KM)
  fat: 'number',              // Ham yağ (% KM)
  ash: 'number',              // Kül (% KM)

  // CNCPS v6.5 Karbonhidrat Fraksiyonları (% KM)
  choA: 'number',             // Şeker, organik asitler, fermente KM
  choB1: 'number',            // Nişasta, pektinler
  choB2: 'number',            // Çözünen/orta hızlı NDF
  choC: 'number',             // Lignin bağlı indigestible NDF

  // CNCPS v6.5 Protein Fraksiyonları (% CP)
  // FAZ 19.2: ölçülü protein degradasyon girdileri (opsiyonel). Varsa CNCPS hesap modu
  // calcRDPandRUP ile gerçek pasaj-bağımlı RDP/RUP hesaplar; yoksa kitap rdp'ye sabitlenir
  // (cncpsProteinDataSource → 'measured' | 'derived'; UI'da veri-kaynağı göstergesi).
  solCP: 'number',            // Çözünür CP (% CP) — tampon-çözünür protein
  ndicp: 'number',            // NDF-çözünmez CP (% CP)
  adicp: 'number',            // ADF-çözünmez CP (% CP) — ısı hasarı
  pa: 'number',               // NPN (üre, amonyum tuzları)
  pb1: 'number',              // Hızlı çözünen gerçek protein
  pb2: 'number',              // Orta hızlı protein
  pb3: 'number',              // Yavaş çözünen (bitki depolama)
  pc: 'number',               // Isıyla hasar görmüş bağlı protein

  // Parçalanma hızları (%/saat) - FAZ 24.1 Ölçülü CNCPS Parçalanma Hızları
  kdB1: 'number',             // Geriye uyumluluk: CHO-B1 fallback
  kdB2: 'number',             // Geriye uyumluluk: CHO-B2 fallback
  kdB3: 'number',             // Geriye uyumluluk: CHO-C fallback
  choKdB1: 'number',          // Nişasta / Pektin (%/saat)
  choKdB2: 'number',          // Fermente NDF (%/saat)
  protKdB1: 'number',         // Orta-hızlı gerçek protein (%/saat)
  protKdB2: 'number',         // Yavaş gerçek protein (%/saat)
  protKdB3: 'number',         // Lif-bağlı protein (%/saat)

  // FAZ 16.4: Nişasta işleme tipi (rumen sindirilebilirliği) — opsiyonel
  // 'whole'|'cracked'|'dryGround'|'dryGroundFine'|'highMoisture'|'steamFlaked'
  starchProcessing: 'string',

  // Makromineraller (% KM)
  ca: 'number',
  p: 'number',
  mg: 'number',
  k: 'number',
  na: 'number',
  s: 'number',
  cl: 'number',

  // İz Mineraller (mg/kg KM)
  fe: 'number',
  zn: 'number',
  cu: 'number',
  mn: 'number',
  se: 'number',
  i: 'number',
  co: 'number',

  // Yağda çözünen vitaminler (IU/kg KM)
  vitA: 'number',
  vitD: 'number',
  vitE: 'number',             // IU/kg KM (genellikle 1 IU ≈ 1 mg α-tokoferol)

  // FAZ 9 — Ek vitaminler ve fonksiyonel besinler
  bcarotene: 'number',        // β-karoten (mg/kg KM) — fertilite, A vit. öncüsü (1 mg ≈ 150-400 IU vitA)
  niacin: 'number',           // Niacin/B3 (mg/kg KM) — ketozis önleme, ısı stresi
  biotin: 'number',           // Biotin/B7 (mg/kg KM) — tırnak sağlığı, beyaz çizgi hastalığı
  choline: 'number',          // Kolin (rumen-korumalı form, g/kg KM) — karaciğer yağlanması önleme

  // FAZ 8C / 10G — Yağ Asidi Profili (yem-spesifik) — opsiyonel
  faProfile: 'object',        // { c16_0, c18_0, c18_1, c18_2, c18_3 } (% toplam FA)
                              // yoksa kategori-bazlı TYPICAL_FA_PROFILES fallback (fattyAcids.js)

  // Amino asitler (% ham protein)
  lys: 'number',
  met: 'number',
  his: 'number',
  arg: 'number',
  thr: 'number',
  ile: 'number',
  leu: 'number',
  val: 'number',
  phe: 'number',
  trp: 'number',

  // FAZ 16.1 — INRA 2018 yem değerleri — opsiyonel (yoksa NRC değerlerinden türetilir)
  inraUFL: 'number',            // UFL/kg KM (Unité Fourragère Lait — INRA enerji birimi)
  inraPDIE: 'number',           // PDIE g/kg KM (enerji-sınırlı sindirilebilir protein)
  inraPDIN: 'number',           // PDIN g/kg KM (azot-sınırlı sindirilebilir protein)
  inraUEL: 'number',            // UEL /kg KM (Unité d'Encombrement Lait — doluluk birimi)

  // FAZ 16.6 — Mikotoksin içerikleri (μg/kg KM = ppb) — opsiyonel, lab analizi
  aflatoxinB1: 'number',      // Aflatoksin B1 (süte AFM1 olarak geçer; en kritik)
  don: 'number',              // Deoksinivalenol / vomitoksin
  zearalenone: 'number',      // Zearalenon (östrojenik)
  fumonisin: 'number',        // Fumonisin (FB1+FB2)
  t2toxin: 'number',          // T-2 toksini
  ochratoxin: 'number',       // Okratoksin A

  // FAZ 16.6 — Silaj fermentasyon kalitesi — opsiyonel, lab analizi (yalnız silajlar)
  silagePH: 'number',         // Silaj pH
  silageLacticAcid: 'number', // Laktik asit (% KM)
  silageAceticAcid: 'number', // Asetik asit (% KM)
  silageButyricAcid: 'number',// Butirik asit (% KM) — klostridyal gösterge
  silageNH3N: 'number',       // Amonyak-N (toplam N'nin %'si) — proteoliz göstergesi

  // Ekonomi
  pricePerTon: 'number',      // TL/ton (YAŞ AĞIRLIK / as-fed bazında — LP costPerDay formülü buna göre)
  comment: 'string',
  createdAt: 'string',
  updatedAt: 'string',
};

/**
 * Rasyon Şeması
 */
export const RationSchema = {
  id: 'string',
  name: 'string',
  animalGroupId: 'string',
  date: 'string',
  ingredients: [
    {
      feedId: 'string',
      asFedKg: 'number',      // Yaş ağırlık (kg/gün)
      dmKg: 'number',         // Kuru madde (kg/gün)
      locked: 'boolean',      // LP optimizasyonunda sabit tut
      minKg: 'number',        // LP alt sınır (kg KM/gün)
      maxKg: 'number',        // LP üst sınır (kg KM/gün)
    },
  ],
  totalDmKg: 'number',
  totalCostTl: 'number',
  costPerKgMilk: 'number',
  nutrients: 'object',        // Hesaplanmış besin madde toplamları
  warnings: 'array',
  createdAt: 'string',
  updatedAt: 'string',
};

/**
 * Sürü Grubu Şeması
 */
export const HerdGroupSchema = {
  id: 'string',
  name: 'string',             // 'Yüksek Verimli', 'Orta Verimli', 'Kuru', 'Geçiş' vb.
  description: 'string',
  animalCount: 'number',
  rationId: 'string',
  createdAt: 'string',
  updatedAt: 'string',
};

// Varsayılan değerler - boş form oluştururken kullanılır
export const defaultAnimalProfile = {
  id: '',
  name: '',
  breed: 'Holstein',
  parity: 2,
  dim: 60,
  bw: 600,
  bcs: 3.0,
  milkYield: 30,
  milkFat: 3.6,
  milkProtein: 3.2,
  milkLactose: 4.8,
  pregnant: false,
  gestDays: 0,
  targetBcs: 3.25,
  activityLevel: 'low',
  thi: 55,
  housingType: 'freestall',
  dailyWalkKm: 0,
  groupId: '',
};
