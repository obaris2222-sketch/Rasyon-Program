/**
 * Saha gözlemleri CSV/JSON import modülü (FAZ 16.13)
 * Milkoscan, Bentley veya farm management software çıktılarını parse eder.
 */

// Sütun başlıklarını yakalamak için fuzzy regex.
// Başlıklar test edilmeden önce normalizeHeader ile birim parantezi (kg/%/L) ve
// fazla boşluk temizlenir → "Milk Yield (kg)" / "Süt Verimi (kg/gün)" gibi gerçek
// MilkoScan/çiftlik yazılımı başlıkları da tanınır (FAZ 16.13 denetim düzeltmesi).
const DICTIONARY = {
  date: /^(date|tarih|zaman|ölçüm|olcum|time|gün|gun)$/i,
  milkYield: /^(milk(\s|_)?yield|süt(\s|_)?verim[i]?|sut(\s|_)?verim[i]?|süt|sut|yield|verim|milk)$/i,
  milkFat: /^(milk(\s|_)?fat|süt(\s|_)?yağ[ıi]?|sut(\s|_)?yag[i]?|fat(\s|_)?pct|fat|yağ|yag)$/i,
  milkProtein: /^(milk(\s|_)?protein|milk(\s|_)?prot|süt(\s|_)?protein[i]?|sut(\s|_)?protein[i]?|protein(\s|_)?pct|protein|prot)$/i,
  bcs: /^(bcs|vks|kondisyon|vücut(\s|_)?kondisyon[u]?|vucut(\s|_)?kondisyon[u]?|skor|body(\s|_)?condition|condition|body)$/i,
  dmiActual: /^(dmi|kmt|intake|tüketim|tuketim|kuru(\s|_)?madde|dry(\s|_)?matter(\s|_)?intake|dry(\s|_)?matter|feed(\s|_)?intake)$/i,
  methane: /^(methane|metan|ch4)$/i,
  rumenPh: /^(rumen(\s|_)?ph|ph)$/i,
  mun: /^(mun|süt(\s|_)?üre(\s|_)?azotu|sut(\s|_)?ure|milk(\s|_)?urea(\s|_)?nitrogen|urea)$/i,
  manureScore: /^(dışkı(\s|_)?skoru|diski(\s|_)?skoru|manure(\s|_)?score|feces|manure)$/i,
  notes: /^(note|notes|not|notlar|açıklama|aciklama|remark|comment|yorum)$/i
};

/**
 * Başlığı eşleme için sadeleştir: tırnak + parantez içi birim (kg/%/L) + % işareti
 * + fazla boşluk atılır. "Milk Yield (kg)" → "milk yield", "Fat (%)" → "fat".
 */
function normalizeHeader(h) {
  return String(h ?? '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/\([^)]*\)/g, ' ')   // birim parantezi
    .replace(/[%]/g, ' ')          // yüzde işareti
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCSVLine(line, delimiter) {
  const values = [];
  let inQuotes = false;
  let curr = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === delimiter && !inQuotes) {
      values.push(curr.trim());
      curr = '';
    } else {
      curr += c;
    }
  }
  values.push(curr.trim());
  return values;
}

export function detectDelimiter(headerLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const char of headerLine) {
    if (counts[char] !== undefined) counts[char]++;
  }
  return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

export function parseObservationCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('Geçersiz dosya: En az başlık ve 1 satır veri içermelidir.');

  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);
  const headers = parseCSVLine(headerLine, delimiter).map(normalizeHeader);

  // Eşleştirme (hangi kolon indexi hangi field?)
  const colMap = {};
  headers.forEach((h, i) => {
    for (const [key, regex] of Object.entries(DICTIONARY)) {
      if (regex.test(h)) {
        colMap[key] = i;
        break;
      }
    }
  });

  if (colMap.milkYield === undefined && colMap.date === undefined) {
    throw new Error('Sütun başlıkları anlaşılamadı. Lütfen Tarih, Süt, Yağ gibi başlıklar kullanın.');
  }

  const results = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i], delimiter);
    if (vals.length < 2) continue; // Boş veya eksik satır

    const row = {};
    let hasData = false;
    
    // Tarih ayrıştırması
    if (colMap.date !== undefined && vals[colMap.date]) {
      // Çok temel JS Date parser. (YYYY-MM-DD veya DD.MM.YYYY)
      let dStr = vals[colMap.date];
      // DD.MM.YYYY veya DD/MM/YYYY ise YYYY-MM-DD'ye çevirmeye çalış
      const parts = dStr.split(/[.\/]/);
      if (parts.length === 3 && parts[0].length <= 2) {
        dStr = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      }
      const d = new Date(dStr);
      if (!isNaN(d)) {
        row.date = d.toISOString();
        hasData = true;
      }
    }
    if (!row.date) row.date = new Date().toISOString(); // fallback

    // Rakamlı alanlar (virgülü noktaya çevir)
    const numFields = ['milkYield', 'milkFat', 'milkProtein', 'bcs', 'dmiActual', 'methane', 'rumenPh', 'mun', 'manureScore'];
    for (const f of numFields) {
      if (colMap[f] !== undefined && vals[colMap[f]]) {
        const parsed = parseFloat(vals[colMap[f]].replace(',', '.'));
        if (!isNaN(parsed)) {
          row[f] = parsed;
          hasData = true;
        } else {
          row[f] = null;
        }
      } else {
        row[f] = null;
      }
    }

    // Notlar
    if (colMap.notes !== undefined && vals[colMap.notes]) {
      row.notes = vals[colMap.notes].replace(/['"]/g, '');
    } else {
      row.notes = 'CSV Import';
    }

    if (hasData) {
      results.push(row);
    } else {
      errors.push(`Satır ${i+1}: Geçerli veri bulunamadı.`);
    }
  }

  return { results, errors };
}

/**
 * Bir gözlem satırını (alan→ham değer) normalize eder: tarih + sayısal alanlar + notlar.
 * JSON yolu kullanır (CSV satır-içi mantığıyla birebir aynı kurallar).
 * @param {object} raw - { date?, milkYield?, milkFat?, milkProtein?, bcs?, dmiActual?, notes? }
 * @param {string} [defaultNote='Import']
 * @returns {object|null} normalize satır; geçerli veri yoksa null
 */
function normalizeObservationRow(raw, defaultNote = 'Import') {
  const row = {};
  let hasData = false;

  // Tarih (YYYY-MM-DD veya DD.MM.YYYY / DD/MM/YYYY)
  if (raw.date !== undefined && raw.date !== null && String(raw.date).trim() !== '') {
    let dStr = String(raw.date).trim();
    const parts = dStr.split(/[.\/]/);
    if (parts.length === 3 && parts[0].length <= 2) {
      dStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    const d = new Date(dStr);
    if (!isNaN(d)) { row.date = d.toISOString(); hasData = true; }
  }
  if (!row.date) row.date = new Date().toISOString();

  const numFields = ['milkYield', 'milkFat', 'milkProtein', 'bcs', 'dmiActual', 'methane', 'rumenPh'];
  for (const f of numFields) {
    const v = raw[f];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      const parsed = parseFloat(String(v).replace(',', '.'));
      if (!isNaN(parsed)) { row[f] = parsed; hasData = true; }
      else row[f] = null;
    } else {
      row[f] = null;
    }
  }

  if (raw.notes !== undefined && raw.notes !== null && String(raw.notes).trim() !== '') {
    row.notes = String(raw.notes).replace(/['"]/g, '');
  } else {
    row.notes = defaultNote;
  }

  return hasData ? row : null;
}

/**
 * Saha gözlemlerini JSON'dan parse eder (FAZ 16.13).
 * MilkoScan / Bentley / çiftlik yazılımı JSON çıktıları: ya doğrudan dizi
 * ya da { observations|data|results|rows|records: [...] } sarmalı. Nesne anahtarları
 * CSV ile AYNI fuzzy DICTIONARY ile eşlenir (Süt/Milk/Fat/Yağ vb.).
 * @param {string|object|Array} jsonInput - JSON metni veya parse edilmiş veri
 * @returns {{ results: object[], errors: string[] }}
 */
export function parseObservationJSON(jsonInput) {
  let data;
  if (typeof jsonInput === 'string') {
    try {
      data = JSON.parse(jsonInput);
    } catch {
      throw new Error('Geçersiz JSON dosyası: ayrıştırılamadı.');
    }
  } else {
    data = jsonInput;
  }

  const arr = Array.isArray(data) ? data
    : (data && typeof data === 'object'
        ? (data.observations || data.data || data.results || data.rows || data.records)
        : null);
  if (!Array.isArray(arr)) {
    throw new Error('Geçersiz JSON: gözlem dizisi bulunamadı (dizi ya da { observations: [...] } bekleniyor).');
  }
  if (arr.length === 0) throw new Error('Geçersiz JSON: gözlem dizisi boş.');

  const results = [];
  const errors = [];
  arr.forEach((obj, idx) => {
    if (!obj || typeof obj !== 'object') {
      errors.push(`Kayıt ${idx + 1}: nesne değil, atlandı.`);
      return;
    }
    // Anahtarları field'a eşle (CSV ile aynı sözlük, fuzzy)
    const raw = {};
    for (const [k, v] of Object.entries(obj)) {
      const nk = normalizeHeader(k);
      for (const [field, regex] of Object.entries(DICTIONARY)) {
        if (raw[field] === undefined && regex.test(nk)) {
          raw[field] = v;
          break;
        }
      }
    }
    const row = normalizeObservationRow(raw, 'JSON Import');
    if (row) results.push(row);
    else errors.push(`Kayıt ${idx + 1}: Geçerli veri bulunamadı.`);
  });

  return { results, errors };
}

/**
 * Uzantı/içeriğe göre CSV veya JSON parser'a yönlendiren yardımcı (FAZ 16.13).
 * @param {string} text - dosya içeriği
 * @param {string} [filename=''] - uzantı ipucu (.json → JSON)
 * @returns {{ results: object[], errors: string[] }}
 */
export function parseObservationFile(text, filename = '') {
  const isJson = /\.json$/i.test(filename) || /^\s*[[{]/.test(text);
  return isJson ? parseObservationJSON(text) : parseObservationCSV(text);
}
