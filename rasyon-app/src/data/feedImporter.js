/**
 * Yem İçe Aktarma — CSV / Excel toplu yem girişi (FAZ 16.7)
 *
 * Saf çekirdek modül — XLSX/IndexedDB içe ALMAZ → Node test edilebilir.
 *   - CSV ayrıştırma (delimiter otomatik tespit: ',' / ';' / TAB; tırnak/kaçış desteği)
 *   - Başlık → şema alanı eşleme (Türkçe + İngilizce takma adlar, birim parantezleri yok sayılır)
 *   - Kategori değer normalleştirme (Türkçe kategori adları → kanonik)
 *   - Yem başına validasyon (zorunlu alanlar + değer aralıkları)
 *   - Standart şablon CSV üretimi
 *
 * UI katmanı (feedImportModal.js) Excel için XLSX'i DİNAMİK import eder ve
 * `XLSX.utils.sheet_to_json` çıktısını (başlık-anahtarlı satır nesneleri) doğrudan
 * `processImportRows`'a verir — CSV ile aynı satır şekli.
 */

import { normalizeTr, FEED_CATEGORIES } from './feedService.js';

// ─── İçe aktarılabilir sütun tanımları ───────────────────────────────────────
// type: 'string' | 'number' | 'category' | 'enum'
// Her sütunun kanonik `field` adı otomatik takma ad sayılır; ek TR/EN adlar `aliases`.
// min/max: değer aralığı (number); required: zorunlu (boşsa satır reddedilir).

const VALID_STARCH_PROC = ['', 'whole', 'cracked', 'dryGround', 'dryGroundFine', 'highMoisture', 'steamFlaked'];

export const IMPORT_COLUMNS = [
  // Temel bilgi
  { field: 'id',       label: 'ID',           type: 'string',   aliases: ['kod', 'code'] },
  { field: 'name',     label: 'Yem Adı',      type: 'string',   required: true, aliases: ['ad', 'isim', 'yem', 'yem adi', 'feed name'] },
  { field: 'nameEn',   label: 'Yem Adı (EN)', type: 'string',   aliases: ['name en', 'english name', 'ingilizce ad', 'ingilizce'] },
  { field: 'category', label: 'Kategori',     type: 'category', required: true, aliases: ['kategori', 'tur', 'sinif', 'class'] },
  { field: 'dm',       label: 'KM (%)',       type: 'number',   required: true, min: 5, max: 100, aliases: ['km', 'kuru madde', 'dry matter'] },

  // Enerji
  { field: 'nel',         label: 'NEL (Mcal/kg)', type: 'number', min: 0, max: 7, aliases: ['net enerji', 'net energy laktasyon'] },
  { field: 'nelDiscount', label: 'NEL İskontosu (%)', type: 'number', min: 0, max: 30, aliases: ['nel iskontosu', 'nel discount', 'nel indirimi', 'nel 3 indirimi', 'nel 3x indirimi'] },
  { field: 'me',          label: 'ME (Mcal/kg)',  type: 'number', min: 0, max: 7, aliases: ['metabolik enerji', 'metabolizable energy'] },
  { field: 'tdn',         label: 'TDN (%)',       type: 'number', min: 0, max: 100, aliases: ['toplam sindirilebilir besin'] },

  // Protein
  { field: 'cp',      label: 'HP/CP (%)',     type: 'number', min: 0, max: 350, aliases: ['hp', 'ham protein', 'crude protein', 'protein'] },
  { field: 'rdp',     label: 'RDP (%CP)',     type: 'number', min: 0, max: 100, aliases: ['rumen parcalanabilen protein'] },
  { field: 'rup',     label: 'RUP (%CP)',     type: 'number', min: 0, max: 100, aliases: ['by-pass protein', 'bypass protein'] },
  { field: 'rupIntD', label: 'RUP Int. Sind. (%)', type: 'number', min: 0, max: 100, aliases: ['rup intestinal', 'rup int sind'] },
  { field: 'ndicp',   label: 'NDICP (%KM)',   type: 'number', min: 0, max: 100, aliases: [] },

  // Karbonhidrat & Lif
  { field: 'ndf',    label: 'NDF (%KM)',     type: 'number', min: 0, max: 100, aliases: ['notr deterjan fiber'] },
  { field: 'adf',    label: 'ADF (%KM)',     type: 'number', min: 0, max: 100, aliases: ['asit deterjan fiber'] },
  { field: 'lignin', label: 'Lignin (%KM)',  type: 'number', min: 0, max: 50, aliases: [] },
  { field: 'aNDF',   label: 'aNDF (%KM)',    type: 'number', min: 0, max: 100, aliases: ['andf', 'a ndf'] },
  { field: 'nfc',    label: 'NFC (%KM)',     type: 'number', min: 0, max: 100, aliases: ['non fiber karbonhidrat'] },
  { field: 'starch', label: 'Nişasta (%KM)', type: 'number', min: 0, max: 100, aliases: ['nisasta', 'starch'] },
  { field: 'starchProcessing', label: 'Nişasta İşleme', type: 'enum', values: VALID_STARCH_PROC, aliases: ['nisasta isleme', 'starch processing'] },
  { field: 'sugar',  label: 'Şeker (%KM)',   type: 'number', min: 0, max: 100, aliases: ['seker', 'sugar', 'wsc'] },
  { field: 'fat',    label: 'Yağ (%KM)',     type: 'number', min: 0, max: 100, aliases: ['yag', 'ham yag', 'ether extract', 'ee'] },
  { field: 'ash',    label: 'Kül (%KM)',     type: 'number', min: 0, max: 100, aliases: ['kul', 'ash'] },

  // Makro mineraller (%KM)
  { field: 'ca', label: 'Ca (%KM)', type: 'number', min: 0, max: 40, aliases: ['kalsiyum', 'calcium'] },
  { field: 'p',  label: 'P (%KM)',  type: 'number', min: 0, max: 40, aliases: ['fosfor', 'phosphorus'] },
  { field: 'mg', label: 'Mg (%KM)', type: 'number', min: 0, max: 40, aliases: ['magnezyum', 'magnesium'] },
  { field: 'k',  label: 'K (%KM)',  type: 'number', min: 0, max: 40, aliases: ['potasyum', 'potassium'] },
  { field: 'na', label: 'Na (%KM)', type: 'number', min: 0, max: 40, aliases: ['sodyum', 'sodium'] },
  { field: 'cl', label: 'Cl (%KM)', type: 'number', min: 0, max: 40, aliases: ['klor', 'chloride', 'chlorine'] },
  { field: 's',  label: 'S (%KM)',  type: 'number', min: 0, max: 40, aliases: ['kukurt', 'sulfur'] },

  // İz mineraller (mg/kg KM)
  { field: 'fe', label: 'Fe (mg/kg)', type: 'number', min: 0, max: 100000, aliases: ['demir', 'iron'] },
  { field: 'zn', label: 'Zn (mg/kg)', type: 'number', min: 0, max: 100000, aliases: ['cinko', 'zinc'] },
  { field: 'cu', label: 'Cu (mg/kg)', type: 'number', min: 0, max: 100000, aliases: ['bakir', 'copper'] },
  { field: 'mn', label: 'Mn (mg/kg)', type: 'number', min: 0, max: 100000, aliases: ['manganez', 'manganese'] },
  { field: 'se', label: 'Se (mg/kg)', type: 'number', min: 0, max: 1000, aliases: ['selenyum', 'selenium'] },
  { field: 'i',  label: 'I (mg/kg)',  type: 'number', min: 0, max: 10000, aliases: ['iyot', 'iodine'] },
  { field: 'co', label: 'Co (mg/kg)', type: 'number', min: 0, max: 1000, aliases: ['kobalt', 'cobalt'] },

  // Vitaminler & fonksiyonel
  { field: 'vitA',      label: 'Vit A (IU/kg)', type: 'number', min: 0, max: 20000000, aliases: ['vitamin a', 'a vitamini'] },
  { field: 'vitD',      label: 'Vit D (IU/kg)', type: 'number', min: 0, max: 10000000, aliases: ['vitamin d', 'd vitamini'] },
  { field: 'vitE',      label: 'Vit E (IU/kg)', type: 'number', min: 0, max: 200000, aliases: ['vitamin e', 'e vitamini'] },
  { field: 'bcarotene', label: 'β-karoten (mg/kg)', type: 'number', min: 0, max: 5000, aliases: ['beta karoten', 'bcarotene', 'b karoten'] },
  { field: 'niacin',    label: 'Niacin (mg/kg)', type: 'number', min: 0, max: 100000, aliases: ['niasin', 'b3'] },
  { field: 'biotin',    label: 'Biotin (mg/kg)', type: 'number', min: 0, max: 5000, aliases: ['b7'] },
  { field: 'choline',   label: 'Kolin (g/kg)',   type: 'number', min: 0, max: 1000, aliases: ['kolin', 'choline'] },

  // Amino asitler (% HP)
  { field: 'lys', label: 'Lys (%HP)', type: 'number', min: 0, max: 15, aliases: ['lizin', 'lysine'] },
  { field: 'met', label: 'Met (%HP)', type: 'number', min: 0, max: 10, aliases: ['metiyonin', 'methionine'] },
  { field: 'his', label: 'His (%HP)', type: 'number', min: 0, max: 10, aliases: ['histidin', 'histidine'] },
  { field: 'arg', label: 'Arg (%HP)', type: 'number', min: 0, max: 15, aliases: ['arginin', 'arginine'] },
  { field: 'thr', label: 'Thr (%HP)', type: 'number', min: 0, max: 10, aliases: ['treonin', 'threonine'] },
  { field: 'ile', label: 'Ile (%HP)', type: 'number', min: 0, max: 10, aliases: ['izolosin', 'isoleucine'] },
  { field: 'leu', label: 'Leu (%HP)', type: 'number', min: 0, max: 20, aliases: ['losin', 'leucine'] },
  { field: 'val', label: 'Val (%HP)', type: 'number', min: 0, max: 10, aliases: ['valin', 'valine'] },
  { field: 'phe', label: 'Phe (%HP)', type: 'number', min: 0, max: 10, aliases: ['fenilalanin', 'phenylalanine'] },
  { field: 'trp', label: 'Trp (%HP)', type: 'number', min: 0, max: 5, aliases: ['triptofan', 'tryptophan'] },

  // CNCPS parçalanma hızları
  { field: 'kdB1', label: 'kd-B1 (%/saat)', type: 'number', min: 0, max: 500, aliases: ['kdb1'] },
  { field: 'kdB2', label: 'kd-B2 (%/saat)', type: 'number', min: 0, max: 500, aliases: ['kdb2'] },
  { field: 'kdB3', label: 'kd-B3 (%/saat)', type: 'number', min: 0, max: 500, aliases: ['kdb3'] },
  { field: 'choKdB1', label: 'CHO kd-B1 (%/saat)', type: 'number', min: 0, max: 500, aliases: ['chokdb1', 'nisasta kd'] },
  { field: 'choKdB2', label: 'CHO kd-B2 (%/saat)', type: 'number', min: 0, max: 500, aliases: ['chokdb2', 'ndf kd'] },
  { field: 'protKdB1', label: 'Prot kd-B1 (%/saat)', type: 'number', min: 0, max: 500, aliases: ['protkdb1'] },
  { field: 'protKdB2', label: 'Prot kd-B2 (%/saat)', type: 'number', min: 0, max: 500, aliases: ['protkdb2'] },
  { field: 'protKdB3', label: 'Prot kd-B3 (%/saat)', type: 'number', min: 0, max: 500, aliases: ['protkdb3'] },

  // Mikotoksin (μg/kg KM)
  { field: 'aflatoxinB1', label: 'Aflatoksin B1 (μg/kg)', type: 'number', min: 0, max: 100000, aliases: ['aflatoxin b1', 'aflatoksin'] },
  { field: 'don',         label: 'DON (μg/kg)',           type: 'number', min: 0, max: 1000000, aliases: ['vomitoksin', 'deoksinivalenol'] },
  { field: 'zearalenone', label: 'Zearalenon (μg/kg)',    type: 'number', min: 0, max: 1000000, aliases: ['zearalenon'] },
  { field: 'fumonisin',   label: 'Fumonisin (μg/kg)',     type: 'number', min: 0, max: 10000000, aliases: [] },
  { field: 't2toxin',     label: 'T-2 (μg/kg)',           type: 'number', min: 0, max: 1000000, aliases: ['t2', 't-2 toksini'] },
  { field: 'ochratoxin',  label: 'Okratoksin A (μg/kg)',  type: 'number', min: 0, max: 1000000, aliases: ['okratoksin'] },

  // Silaj fermentasyon
  { field: 'silagePH',         label: 'Silaj pH',          type: 'number', min: 3, max: 7, aliases: ['silaj ph', 'silage ph'] },
  { field: 'silageLacticAcid', label: 'Laktik Asit (%KM)', type: 'number', min: 0, max: 20, aliases: ['laktik asit', 'lactic acid'] },
  { field: 'silageAceticAcid', label: 'Asetik Asit (%KM)', type: 'number', min: 0, max: 15, aliases: ['asetik asit', 'acetic acid'] },
  { field: 'silageButyricAcid',label: 'Butirik Asit (%KM)',type: 'number', min: 0, max: 10, aliases: ['butirik asit', 'butyric acid'] },
  { field: 'silageNH3N',       label: 'NH3-N (% toplam N)',type: 'number', min: 0, max: 50, aliases: ['nh3 n', 'amonyak n'] },

  // Ekonomi & not
  { field: 'pricePerTon', label: 'Fiyat (₺/ton)', type: 'number', min: 0, max: 500000, aliases: ['fiyat', 'price', 'fiyat ton', 'price per ton', 'tl ton'] },
  { field: 'comment',     label: 'Açıklama',      type: 'string', aliases: ['yorum', 'not', 'notlar', 'aciklama', 'note', 'notes', 'kaynak'] },
];

// ─── Kategori takma adları ───────────────────────────────────────────────────

const CATEGORY_ALIASES = {
  roughage:  ['roughage', 'kaba', 'kaba yem', 'kaba yemler', 'forage', 'kabayem'],
  grain:     ['grain', 'tahil', 'tane', 'enerji', 'enerji yemi', 'cereal', 'tahillar'],
  protein:   ['protein', 'protein kaynagi', 'protein yemi', 'protein kaynaklari'],
  byproduct: ['byproduct', 'by product', 'yan urun', 'yan urunler', 'yan'],
  fat:       ['fat', 'yag', 'yag kaynagi', 'lipid', 'oil', 'yaglar'],
  mineral:   ['mineral', 'katki', 'mineral katki', 'vitamin', 'additive', 'premiks', 'premix', 'supplement', 'mineraller'],
};

// ─── Başlık normalleştirme & eşleme ──────────────────────────────────────────

/**
 * Başlığı eşleme için sadeleştir: Türkçe-duyarsız küçük harf + parantez içeriği
 * (birim) atılır + alfanümerik-dışı boşluğa indirgenir.
 * "NEL (Mcal/kg KM)" → "nel", "Süt Yağı %" → "sut yagi".
 */
export function normalizeHeader(h) {
  return normalizeTr(h)
    .replace(/\([^)]*\)/g, ' ')      // parantez içi birimleri at
    .replace(/[^a-z0-9]+/g, ' ')     // noktalama/sembol → boşluk
    .replace(/\s+/g, ' ')
    .trim();
}

// Takma ad → sütun haritası (modül yüklenince bir kez kurulur)
const ALIAS_INDEX = (() => {
  const idx = new Map();
  for (const col of IMPORT_COLUMNS) {
    const names = new Set([col.field, ...(col.aliases || [])]);
    for (const a of names) {
      const key = normalizeHeader(a);
      if (key && !idx.has(key)) idx.set(key, col);
    }
  }
  return idx;
})();

const CATEGORY_INDEX = (() => {
  const idx = new Map();
  for (const [canon, aliases] of Object.entries(CATEGORY_ALIASES)) {
    for (const a of aliases) idx.set(normalizeHeader(a), canon);
  }
  return idx;
})();

/**
 * Bir CSV/Excel başlığını şema sütununa eşle (yoksa null).
 * @param {string} header
 * @returns {object|null} IMPORT_COLUMNS girdisi
 */
export function matchColumn(header) {
  return ALIAS_INDEX.get(normalizeHeader(header)) || null;
}

/**
 * Serbest kategori değerini kanonik kategoriye çevir (yoksa null).
 * @param {string} value
 * @returns {string|null}
 */
export function normalizeCategory(value) {
  if (value == null || value === '') return null;
  return CATEGORY_INDEX.get(normalizeHeader(value)) || null;
}

// ─── Sayı ayrıştırma ─────────────────────────────────────────────────────────

/**
 * Yerel-ayar toleranslı sayı ayrıştırma.
 * - Sadece virgül → ondalık virgül (Türkçe): "1,25" → 1.25
 * - Hem virgül hem nokta → son ayraç ondalık kabul edilir ("1.250,5"→1250.5, "1,250.5"→1250.5)
 * - Boş → NaN (validasyon yakalar)
 * @param {string|number} raw
 * @returns {number}
 */
export function parseNumber(raw) {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').trim();
  if (s === '') return NaN;
  s = s.replace(/\s+/g, '').replace(/%/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')   // Avrupa: nokta=binlik, virgül=ondalık
      : s.replace(/,/g, '');                       // ABD: virgül=binlik
  } else if (hasComma) {
    s = s.replace(',', '.');                        // tek virgül → ondalık (Türkçe)
  }
  return Number(s);
}

// ─── CSV ayrıştırma ──────────────────────────────────────────────────────────

/** İlk satıra bakarak en olası ayracı tespit et (',' / ';' / TAB). */
function detectDelimiter(s) {
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const counts = { ';': 0, '\t': 0, ',': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ && ch in counts) counts[ch]++;
  }
  let best = ',', bestN = -1;
  for (const [d, n] of Object.entries(counts)) if (n > bestN) { best = d; bestN = n; }
  return best;
}

/** RFC4180-benzeri ayrıştırma → hücre dizilerinden oluşan satır dizisi. */
function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\r') { /* yok say */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field);
  rows.push(row);
  // Tamamen boş satırları at
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

/**
 * CSV metnini başlık + satır nesnelerine ayrıştır.
 * Her satır nesnesi başlık-anahtarlı ham string değerler içerir (Excel sheet_to_json ile aynı şekil).
 * @param {string} text
 * @param {object} [opts] @param {string} [opts.delimiter] — override
 * @returns {{headers:string[], rows:object[], delimiter:string}}
 */
export function parseCSV(text, opts = {}) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);   // BOM at
  if (!s.trim()) return { headers: [], rows: [], delimiter: opts.delimiter || ',' };

  const delimiter = opts.delimiter || detectDelimiter(s);
  const cells = parseDelimited(s, delimiter);
  const headers = (cells[0] || []).map(h => h.trim());

  const rows = [];
  for (let r = 1; r < cells.length; r++) {
    const rowCells = cells[r];
    const obj = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const val = (rowCells[c] ?? '').trim();
      obj[key] = val;
      if (val !== '') hasValue = true;
    }
    if (hasValue) rows.push(obj);
  }
  return { headers, rows, delimiter };
}

// ─── Satır → yem eşleme ──────────────────────────────────────────────────────

/**
 * Bir ham satır nesnesini (başlık-anahtarlı) yem nesnesine dönüştür.
 * Sayılar ayrıştırılır; ayrıştırılamayan değerler ham string olarak kalır
 * (validasyon tip hatası olarak raporlar). Eşleşmeyen başlıklar `unmapped`'e gider.
 * @param {object} row
 * @returns {{feed:object, unmapped:string[]}}
 */
export function mapRowToFeed(row) {
  const feed = {};
  const unmapped = [];
  for (const [header, rawVal] of Object.entries(row || {})) {
    const col = matchColumn(header);
    const val = String(rawVal ?? '').trim();
    if (!col) { if (val !== '') unmapped.push(header); continue; }
    if (val === '') continue;
    if (col.type === 'number') {
      const n = parseNumber(val);
      feed[col.field] = Number.isFinite(n) ? n : val;   // string kalırsa validasyon yakalar
    } else if (col.type === 'category') {
      feed[col.field] = normalizeCategory(val) ?? val;  // bilinmeyen → ham kalır → validasyon yakalar
    } else {
      feed[col.field] = val;
    }
  }
  return { feed, unmapped };
}

/**
 * Eşlenmiş bir yemi doğrula: zorunlu alanlar + tip + değer aralıkları (hata),
 * eksik enerji/protein + yapısal tutarsızlık (uyarı).
 * @param {object} feed
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateImportedFeed(feed) {
  const errors = [];
  const warnings = [];

  for (const col of IMPORT_COLUMNS) {
    const v = feed[col.field];
    const empty = v === undefined || v === null || v === '';
    if (col.required && empty) { errors.push(`${col.label}: zorunlu alan boş`); continue; }
    if (empty) continue;

    if (col.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`${col.label}: sayısal değer bekleniyor (girilen: "${v}")`);
        continue;
      }
      if (Number.isFinite(col.min) && v < col.min) errors.push(`${col.label}: ${v} çok düşük (min ${col.min})`);
      if (Number.isFinite(col.max) && v > col.max) errors.push(`${col.label}: ${v} çok yüksek (max ${col.max})`);
    } else if (col.type === 'category') {
      if (!FEED_CATEGORIES.includes(v)) {
        errors.push(`Kategori: "${v}" geçersiz (geçerli: ${FEED_CATEGORIES.join(', ')})`);
      }
    } else if (col.type === 'enum') {
      if (Array.isArray(col.values) && !col.values.includes(v)) {
        errors.push(`${col.label}: "${v}" geçersiz`);
      }
    }
  }

  // Yumuşak uyarılar — eksik enerji/protein (mineral/yağ dışı)
  if (feed.category && !['mineral', 'fat'].includes(feed.category)) {
    if (feed.nel == null) warnings.push('NEL değeri yok — enerji eksik kabul edilir');
    if (feed.cp == null)  warnings.push('HP/CP değeri yok — protein eksik kabul edilir');
  }
  // Yapısal: ADF ≤ NDF
  if (Number.isFinite(feed.adf) && Number.isFinite(feed.ndf) && feed.adf > feed.ndf + 0.5) {
    warnings.push(`ADF (${feed.adf}) > NDF (${feed.ndf}) — beklenmedik`);
  }
  // Yapısal: RDP + RUP ≈ 100
  if (Number.isFinite(feed.rdp) && Number.isFinite(feed.rup) && Math.abs(feed.rdp + feed.rup - 100) > 2) {
    warnings.push(`RDP + RUP = ${feed.rdp + feed.rup} (≈100 bekleniyor)`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ─── ID üretimi ──────────────────────────────────────────────────────────────

/** ID karakter sadeleştirme (alfanümerik + alt çizgi). */
function sanitizeId(id) {
  return String(id).replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/**
 * İçe aktarılan yeme `user_` önekli güvenli ID üret.
 * Sağlanan ID kullanılırsa bile `user_` öneki zorlanır → paketli yemlerin
 * (nrc_/tr_/min_) üzerine yazma engellenir. ID yoksa zaman+indeks bazlı üretilir.
 */
export function coerceUserId(rawId, ts, index) {
  const slug = sanitizeId(rawId ?? '');
  if (!slug) return `user_imp_${ts}_${index}`;
  const lower = slug.toLowerCase();
  return lower.startsWith('user_') ? slug : `user_${slug}`;
}

// ─── Toplu işleme ────────────────────────────────────────────────────────────

/**
 * Ham satır nesnelerini işle: eşle → doğrula → geçerli yemleri ID + source ile hazırla.
 * Batch içi ID çakışmaları benzersizleştirilir (uyarı eklenir).
 * @param {object[]} rows — başlık-anahtarlı satır nesneleri (CSV veya Excel)
 * @returns {{feeds:object[], rowResults:object[], summary:{total:number,valid:number,invalid:number,warnings:number}}}
 */
export function processImportRows(rows) {
  const feeds = [];
  const rowResults = [];
  const seenIds = new Set();
  const ts = Date.now();
  let validCount = 0;
  let warnCount = 0;

  (rows || []).forEach((row, i) => {
    const { feed, unmapped } = mapRowToFeed(row);
    const { ok, errors, warnings } = validateImportedFeed(feed);
    const rowNum = i + 2;   // +1 başlık satırı, +1 1-tabanlı

    if (ok) {
      let id = coerceUserId(feed.id, ts, i);
      if (seenIds.has(id)) { id = `${id}_${i}`; warnings.push('Yinelenen ID — benzersizleştirildi'); }
      seenIds.add(id);
      feed.id = id;
      feed.source = 'user';
      feeds.push(feed);
      validCount++;
    }
    if (warnings.length) warnCount++;
    rowResults.push({ row: rowNum, name: feed.name || '(adsız)', ok, errors, warnings, unmapped });
  });

  return {
    feeds,
    rowResults,
    summary: {
      total: (rows || []).length,
      valid: validCount,
      invalid: ((rows || []).length) - validCount,
      warnings: warnCount,
    },
  };
}

// ─── Şablon üretimi ──────────────────────────────────────────────────────────

/** Şablonda yer alan sütunlar (kanonik adlar → kayıpsız re-import). */
export const TEMPLATE_COLUMNS = [
  'id', 'name', 'nameEn', 'category', 'dm',
  'nel', 'cp', 'rdp', 'rup',
  'ndf', 'adf', 'lignin', 'nfc', 'starch', 'sugar', 'fat', 'ash',
  'ca', 'p', 'mg', 'k', 'na', 'cl', 's',
  'fe', 'zn', 'cu', 'mn', 'se', 'i', 'co',
  'vitA', 'vitD', 'vitE', 'lys', 'met',
  'pricePerTon', 'comment',
];

/** Bir CSV hücresini kaçışla (virgül/tırnak/yeni satır varsa tırnakla). */
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function getTemplateObjects() {
  const ex1 = {
    id: '', name: 'Örnek Yonca Kuru Ot', nameEn: 'Alfalfa Hay', category: 'roughage', dm: 88,
    nel: 1.25, cp: 18, rdp: 75, rup: 25,
    ndf: 42, adf: 32, lignin: 7, nfc: 28, starch: 2, sugar: 5, fat: 2.5, ash: 10,
    ca: 1.4, p: 0.25, mg: 0.3, k: 2.4, na: 0.06, cl: 0.5, s: 0.27,
    fe: 200, zn: 25, cu: 9, mn: 35, se: 0.3, i: 0.2, co: 0.15,
    vitA: 0, vitD: 0, vitE: 30, lys: 5.2, met: 1.5,
    pricePerTon: 6000, comment: 'Örnek satır — silebilirsiniz',
  };
  const ex2 = {
    id: '', name: 'Örnek Mısır Tane', nameEn: 'Corn Grain', category: 'grain', dm: 88,
    nel: 2.0, cp: 9, rdp: 55, rup: 45,
    ndf: 9, adf: 3, lignin: 1, nfc: 73, starch: 70, sugar: 2, fat: 4, ash: 1.5,
    ca: 0.03, p: 0.3, mg: 0.12, k: 0.4, na: 0.02, cl: 0.05, s: 0.12,
    fe: 30, zn: 24, cu: 3, mn: 7, se: 0.07, i: 0.05, co: 0.05,
    vitA: 0, vitD: 0, vitE: 22, lys: 2.8, met: 2.1,
    pricePerTon: 9000, comment: '',
  };
  return [ex1, ex2];
}

/**
 * Standart içe aktarma şablonu CSV'si (başlıklar + 2 örnek satır).
 * Örnekler kanonik kategori + '.' ondalık + ',' ayraç ile kayıpsız.
 * @returns {string}
 */
export function buildTemplateCSV() {
  const lines = [TEMPLATE_COLUMNS.join(',')];
  for (const ex of getTemplateObjects()) {
    lines.push(TEMPLATE_COLUMNS.map(c => csvCell(ex[c])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
