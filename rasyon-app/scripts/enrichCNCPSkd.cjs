/**
 * Ölçülü CNCPS Parçalanma Hızları (kd) zenginleştirme betiği
 * Mısır, soya, yonca gibi temel yemlere tipik CNCPS v6.5 kd değerlerini ekler.
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'data');
const FILES = ['feedLibrary.json', 'feedLibraryExt.json', 'feedLibraryExt2.json',
  'feedLibraryExt3.json', 'feedLibraryExt4.json', 'feedLibraryExt5.json',
  'feedLibraryExt6.json', 'feedLibraryExt7.json'];

// CNCPS v6.5 tipik kd (%/saat) kütüphanesi
const KD = {
  corn:             { choKdB1: 14, choKdB2: 5,  protKdB1: 12, protKdB2: 3,  protKdB3: 0.5 },
  soybean:          { choKdB1: 15, choKdB2: 6,  protKdB1: 16, protKdB2: 5,  protKdB3: 0.5 },
  alfalfa:          { choKdB1: 35, choKdB2: 6,  protKdB1: 20, protKdB2: 6,  protKdB3: 1.0 },
  grass:            { choKdB1: 25, choKdB2: 4,  protKdB1: 15, protKdB2: 4,  protKdB3: 0.8 },
  corn_silage:      { choKdB1: 22, choKdB2: 4,  protKdB1: 18, protKdB2: 4,  protKdB3: 0.8 },
  barley:           { choKdB1: 35, choKdB2: 6,  protKdB1: 25, protKdB2: 5,  protKdB3: 0.5 },
  wheat:            { choKdB1: 40, choKdB2: 6,  protKdB1: 22, protKdB2: 6,  protKdB3: 0.5 },
  canola:           { choKdB1: 15, choKdB2: 5,  protKdB1: 12, protKdB2: 4,  protKdB3: 0.5 },
  cottonseed:       { choKdB1: 15, choKdB2: 4,  protKdB1: 10, protKdB2: 3,  protKdB3: 0.4 },
  sunflower:        { choKdB1: 15, choKdB2: 5,  protKdB1: 14, protKdB2: 4,  protKdB3: 0.5 },
  corn_ddgs:        { choKdB1: 12, choKdB2: 4,  protKdB1: 10, protKdB2: 3,  protKdB3: 0.5 },
  corn_gluten_meal: { choKdB1: 10, choKdB2: 4,  protKdB1: 5,  protKdB2: 2,  protKdB3: 0.4 },
  oats:             { choKdB1: 30, choKdB2: 5,  protKdB1: 20, protKdB2: 5,  protKdB3: 0.5 },
  sorghum:          { choKdB1: 10, choKdB2: 5,  protKdB1: 8,  protKdB2: 2,  protKdB3: 0.5 },
};

function classify(id, name) {
  const s = (id + ' ' + (name || '')).toLowerCase();
  
  if (/corn_silage|mısır sila/.test(s)) return 'corn_silage';
  if (/alfalfa|yonca|lucerne/.test(s)) return 'alfalfa';
  if (/hay|silage|silaj|straw|saman|stover|forage|fresh|taze|green|yeşil|otu|hasıl|haylage|pasture|mera|sap\b/.test(s)) {
    const legume = /alfalfa|yonca|lucerne|clover|üçgül|vetch|fiğ/.test(s);
    return legume ? 'alfalfa' : 'grass';
  }

  if (/gluten/.test(s) && /meal|unu|60|40/.test(s)) return 'corn_gluten_meal';
  if (/(ddgs|ddg\b|distillers)/.test(s)) return 'corn_ddgs';
  if (/cottonseed|pamuk tohumu/.test(s) && /meal|küspe/.test(s)) return 'cottonseed';
  if (/sunflower|ayçiçek/.test(s) && /meal|küspe/.test(s)) return 'sunflower';
  if (/canola|rapeseed|kolza|kanola/.test(s) && /meal|küspe/.test(s)) return 'canola';
  if (/(soy|soya)/.test(s) && /(meal|küspe|extrud|full|roasted)/.test(s)) return 'soybean';
  
  if (/(sorghum|sorgum|milo)/.test(s)) return 'sorghum';
  if (/(oat|yulaf)/.test(s)) return 'oats';
  if (/(barley|arpa)/.test(s)) return 'barley';
  if (/(wheat|buğday)/.test(s)) return 'wheat';
  if (/(corn|mısır|maize)/.test(s)) return 'corn';
  
  return null;
}

const fmt = (v) => (Math.round(v * 100) / 100).toString();

const DRY = process.env.DRY === '1';
let totalEnriched = 0;
const perFile = {};

for (const file of FILES) {
  const fp = path.join(DIR, file);
  if (!fs.existsSync(fp)) continue;
  let text = fs.readFileSync(fp, 'utf8');
  const data = JSON.parse(text);
  let count = 0;

  for (const feed of data.feeds) {
    if (feed.protKdB1 != null) continue; // Zaten zenginleştirilmiş
    const type = classify(feed.id, feed.name);
    if (!type) continue;
    const prof = KD[type];

    const fields = [
      ['choKdB1', prof.choKdB1],
      ['choKdB2', prof.choKdB2],
      ['protKdB1', prof.protKdB1],
      ['protKdB2', prof.protKdB2],
      ['protKdB3', prof.protKdB3],
    ];

    const idRe = new RegExp('"id":\\s*"' + feed.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"');
    const idM = idRe.exec(text);
    if (!idM) continue;
    const idIdx = idM.index;
    
    let depth = 0, end = -1;
    for (let i = idIdx; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') { if (depth === 0) { end = i; break; } depth--; }
    }
    if (end < 0) continue;
    const span = text.slice(idIdx, end);

    // virgülle biten son property'yi bul (kapanış süslü parantezden hemen öncesi)
    const re = /"(?:[a-zA-Z0-9_]+)":\s*(?:"[^"]*"|-?[\d.]+)\s*,/g;
    let m, last = null;
    while ((m = re.exec(span)) !== null) last = m;
    if (!last) continue;
    
    const insAt = idIdx + last.index + last[0].length;
    const after = text[insAt];

    let insertion;
    if (after === '\n') {
      insertion = '\n' + fields.map(([k, v]) => `      "${k}": ${fmt(v)},`).join('\n');
    } else {
      insertion = ' ' + fields.map(([k, v]) => `"${k}": ${fmt(v)},`).join(' ');
    }
    
    text = text.slice(0, insAt) + insertion + text.slice(insAt);
    count++;
    totalEnriched++;
  }

  JSON.parse(text); // geçerli JSON kontrolü
  if (!DRY) fs.writeFileSync(fp, text, 'utf8');
  perFile[file] = count;
}

console.log('Zenginleştirilen yem sayısı (CNCPS kd):', totalEnriched);
console.log('Dosya bazında:', JSON.stringify(perFile, null, 2));
console.log(DRY ? 'DRY-RUN (yazılmadı)' : 'YAZILDI');
