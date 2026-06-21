/**
 * Tam EAA yem DB zenginleştirme — NRC 2001 Tablo 15-1 tip-profili (% CP).
 * Cerrahi metin ekleme: her yemin son AA alanından (his veya met) SONRA his(+)/arg..trp
 * eklenir; dosyanın mevcut biçimi (kompakt/expanded) korunur. Yalnız `arg` alanı OLMAYAN +
 * GÜVENLE sınıflanan yemler. Belirsiz/obscure yemler ATLANIR (motor RUP varsayılanını kullanır).
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'data');
const FILES = ['feedLibrary.json', 'feedLibraryExt.json', 'feedLibraryExt2.json',
  'feedLibraryExt3.json', 'feedLibraryExt4.json', 'feedLibraryExt5.json',
  'feedLibraryExt6.json', 'feedLibraryExt7.json'];

// NRC 2001 Tablo 15-1 esansiyel AA bileşimi (% ham protein). Tür içinde korunur
// (işleme RUP'u değiştirir, AA %'sini değil). [his, arg, thr, ile, leu, val, phe, trp]
const P = {
  corn:             { his: 2.8, arg: 4.7, thr: 3.5, ile: 3.5, leu: 12.0, val: 4.7, phe: 4.9, trp: 0.6 },
  wheat:            { his: 2.3, arg: 4.6, thr: 2.9, ile: 3.5, leu: 6.7,  val: 4.4, phe: 4.6, trp: 1.2 },
  barley:           { his: 2.3, arg: 5.0, thr: 3.4, ile: 3.6, leu: 6.8,  val: 5.0, phe: 5.1, trp: 1.2 },
  oats:             { his: 2.2, arg: 6.7, thr: 3.3, ile: 3.9, leu: 7.4,  val: 5.3, phe: 5.3, trp: 1.3 },
  sorghum:          { his: 2.1, arg: 3.6, thr: 3.3, ile: 4.1, leu: 13.5, val: 5.1, phe: 5.1, trp: 1.0 },
  rye:              { his: 2.3, arg: 4.8, thr: 3.5, ile: 3.6, leu: 6.4,  val: 4.9, phe: 4.7, trp: 1.0 },
  triticale:        { his: 2.4, arg: 4.9, thr: 3.3, ile: 3.6, leu: 6.7,  val: 4.6, phe: 4.6, trp: 1.1 },
  rice:             { his: 2.4, arg: 8.6, thr: 3.6, ile: 4.3, leu: 8.2,  val: 6.1, phe: 5.4, trp: 1.3 },
  millet:           { his: 2.2, arg: 3.6, thr: 3.7, ile: 4.4, leu: 11.0, val: 5.4, phe: 5.6, trp: 1.2 },
  soybean:          { his: 2.7, arg: 7.2, thr: 3.9, ile: 4.5, leu: 7.5,  val: 4.8, phe: 5.0, trp: 1.4 },
  canola:           { his: 2.8, arg: 6.1, thr: 4.3, ile: 3.9, leu: 7.0,  val: 5.1, phe: 4.0, trp: 1.3 },
  cottonseed:       { his: 2.8, arg: 11.1, thr: 3.3, ile: 3.2, leu: 5.9, val: 4.6, phe: 5.4, trp: 1.3 },
  sunflower:        { his: 2.5, arg: 8.2, thr: 3.7, ile: 4.3, leu: 6.4,  val: 5.1, phe: 4.6, trp: 1.2 },
  corn_ddgs:        { his: 2.7, arg: 4.5, thr: 3.7, ile: 3.7, leu: 11.7, val: 5.0, phe: 4.9, trp: 0.8 },
  corn_gluten_meal: { his: 2.1, arg: 3.2, thr: 3.4, ile: 4.2, leu: 16.8, val: 4.7, phe: 6.4, trp: 0.5 },
  peanut:           { his: 2.5, arg: 11.5, thr: 2.6, ile: 3.4, leu: 6.4, val: 4.2, phe: 5.0, trp: 1.0 },
  linseed:          { his: 2.0, arg: 9.2, thr: 3.7, ile: 4.4, leu: 5.8,  val: 5.1, phe: 4.6, trp: 1.7 },
  safflower:        { his: 2.4, arg: 8.5, thr: 3.3, ile: 3.8, leu: 6.1,  val: 5.2, phe: 4.4, trp: 1.3 },
  fish:             { his: 2.4, arg: 5.9, thr: 4.2, ile: 4.2, leu: 7.2,  val: 5.0, phe: 3.9, trp: 1.1 },
  blood:            { his: 6.2, arg: 4.0, thr: 4.6, ile: 1.0, leu: 12.5, val: 8.0, phe: 6.7, trp: 1.5 },
  meat_bone:        { his: 1.7, arg: 7.2, thr: 3.3, ile: 3.0, leu: 6.4,  val: 4.5, phe: 3.5, trp: 0.6 },
  feather:          { his: 0.9, arg: 6.3, thr: 4.3, ile: 4.4, leu: 7.6,  val: 7.0, phe: 4.3, trp: 0.6 },
  poultry:          { his: 1.9, arg: 6.6, thr: 3.9, ile: 3.9, leu: 6.7,  val: 4.9, phe: 3.9, trp: 0.9 },
  peas:             { his: 2.5, arg: 8.7, thr: 3.7, ile: 4.2, leu: 7.1,  val: 4.7, phe: 4.7, trp: 0.9 },
  faba:             { his: 2.6, arg: 9.5, thr: 3.5, ile: 4.0, leu: 7.4,  val: 4.5, phe: 4.2, trp: 0.9 },
  lupin:            { his: 2.6, arg: 11.0, thr: 3.6, ile: 4.2, leu: 7.2, val: 3.8, phe: 3.9, trp: 0.8 },
  lentil:           { his: 2.7, arg: 8.0, thr: 3.7, ile: 4.3, leu: 7.3,  val: 4.9, phe: 4.8, trp: 0.9 },
  alfalfa:          { his: 1.8, arg: 4.4, thr: 4.0, ile: 4.1, leu: 7.0,  val: 4.9, phe: 4.7, trp: 1.6 },
  grass:            { his: 1.9, arg: 4.5, thr: 4.2, ile: 4.0, leu: 7.2,  val: 5.2, phe: 4.8, trp: 1.3 },
  corn_silage:      { his: 1.9, arg: 3.0, thr: 3.6, ile: 3.7, leu: 9.5,  val: 4.8, phe: 4.4, trp: 0.6 },
  straw:            { his: 1.5, arg: 4.0, thr: 3.5, ile: 3.7, leu: 6.5,  val: 4.8, phe: 4.5, trp: 1.0 },
};

// Yem id/ad → tip. Emin değilse null (atla → motor RUP varsayılanı). Sıra: (0) fiber/özel
// byproduct ele → (1) mısır silajı → (2) FORAGE formları (baklagil→alfalfa, çayır/tahıl→grass)
// → (3) tohum/tane/meal tipleri. Forage AA profili (% CP) türden bağımsız ~korunur (alfalfa/grass).
function classify(id, name) {
  const s = (id + ' ' + (name || '')).toLowerCase();

  // 0) Fiber/şeker/özel byproduct + maya → ATLA (AA profili farklı; "küspe"=meal HARİÇ tutulmaz)
  if (/hull|kabuk|bran|kepek|midd|razmol|polish|pulp|posa|pomace|cob|koçan|husk|kavuz|molasses|melas|whey|peynir|bagasse|yeast|maya|germ|embriyo|gluten.?feed|gluten yem|tallow|leaf|leaves|yaprak|stalk|kök|root|grape|üzüm/.test(s)) {
    return null;
  }
  // 1) Mısır silajı (özel forage profili) + dehidre yonca unu (alfalfa profili)
  if (/corn_silage|mısır sila/.test(s)) return 'corn_silage';
  if (/alfalfa|yonca|lucerne/.test(s)) return 'alfalfa';
  // 2) FORAGE formları → baklagil ise alfalfa, değilse grass (forage AA ~tür-bağımsız)
  if (/hay|silage|silaj|straw|saman|stover|forage|fresh|taze|green|yeşil|otu|hasıl|haylage|pasture|mera|sap\b|vine|vetch|fiğ/.test(s)) {
    const legume = /alfalfa|yonca|lucerne|clover|üçgül|vetch|fiğ|(^|[^a-z])pea|bezelye|faba|bakla|lupin|soy|soya|cowpea|börülce|mung|maş|lentil|mercimek|sainfoin|korunga|trefoil|medic|lespedeza|chickpea|nohut|mürdümük|legume|baklagil/.test(s);
    return legume ? 'alfalfa' : 'grass';
  }

  // 3) Tohum / tane / meal tipleri
  if (/gluten/.test(s) && /meal|unu|60|40/.test(s)) return 'corn_gluten_meal';
  if (/(ddgs|ddg\b|distillers|damıtık tahıl|distillers solubles|condensed distillers)/.test(s)) {
    return /wheat|buğday/.test(s) ? null : 'corn_ddgs';   // buğday DDGS profili farklı → atla
  }
  if (/cottonseed|pamuk tohumu/.test(s) && /meal|küspe/.test(s)) return 'cottonseed';
  if (/sunflower|ayçiçek|ayciçek/.test(s) && /meal|küspe/.test(s)) return 'sunflower';
  if (/canola|rapeseed|kolza|kanola|colza|mustard|hardal/.test(s) && /meal|küspe|seed|tohum|full.?fat|tam yağ|roasted|kavrul/.test(s)) return 'canola';
  if (/(linseed|flax|keten)/.test(s) && /meal|küspe|cake|keki/.test(s)) return 'linseed';
  if (/safflower|aspir/.test(s) && /meal|küspe/.test(s)) return 'safflower';
  if (/peanut|yer fıstığı/.test(s) && /meal|küspe/.test(s)) return 'peanut';
  if (/(soy|soya)/.test(s) && /(meal|küspe|extrud|ekstrude|full.?fat|tam yağ|roasted|kavrul|protein|bypass|korumalı)/.test(s)) return 'soybean';
  if (/feather|hidrolize tüy|tüy unu/.test(s)) return 'feather';
  if (/blood|kan unu|kan tozu|plasma|plazma/.test(s)) return 'blood';
  if (/(meat.?bone|meat.?meal|et.?kemik|et unu)/.test(s)) return 'meat_bone';
  if (/(poultry|tavuk|kümes)/.test(s) && /meal|unu|byproduct|yan ürün/.test(s)) return 'poultry';
  if (/fish|balık/.test(s) && /meal|unu/.test(s)) return 'fish';
  if (/(faba|bakla)/.test(s) && !/acı bakla|lupin/.test(s)) return 'faba';
  if (/lupin|acı bakla/.test(s)) return 'lupin';
  if (/(lentil|mercimek)/.test(s)) return 'lentil';
  if (/(pea\b|peas|bezelye|chickpea|nohut|pigeon|güvercin|mung|maş|grass.?pea|mürdümük|dry.?bean|kuru fasulye|cowpea|börülce)/.test(s) && !/peanut|fıstık/.test(s)) return 'peas';

  // tahıl taneleri (forage zaten elendi)
  if (/(sorghum|sorgum|milo)/.test(s)) return 'sorghum';
  if (/triticale|tritikale/.test(s)) return 'triticale';
  if (/(^|[_ ])(rye|çavdar)/.test(s)) return 'rye';
  if (/(oat|yulaf)/.test(s)) return 'oats';
  if (/(barley|arpa)/.test(s)) return 'barley';
  if (/(millet|darı)/.test(s)) return 'millet';
  if (/rice|pirinç/.test(s) && !/protein/.test(s)) return 'rice';
  if (/(wheat|buğday|durum|spelt|kavılca|emmer|gernik)/.test(s)) return 'wheat';
  if (/(corn|mısır|maize)/.test(s)) return 'corn';
  return null;
}

const fmt = (v) => (Math.round(v * 100) / 100).toString();

const DRY = process.env.DRY === '1';
let totalEnriched = 0;
const perFile = {};
const skipped = [];
const byType = {};

for (const file of FILES) {
  const fp = path.join(DIR, file);
  let text = fs.readFileSync(fp, 'utf8');
  const data = JSON.parse(text);
  let count = 0;

  for (const feed of data.feeds) {
    if (feed.arg != null) continue;                 // zaten tam EAA var
    if (!(Number(feed.lys) > 0)) continue;          // protein-ilgili değil
    const type = classify(feed.id, feed.name);
    if (!type) { skipped.push(feed.id); continue; }
    const prof = P[type];
    (byType[type] = byType[type] || []).push(feed.id);

    // Eklenecek alanlar: his (yoksa) + arg..trp. lys/met zaten var.
    const addHis = feed.his == null;
    const fields = [];
    if (addHis) fields.push(['his', prof.his]);
    for (const k of ['arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp']) fields.push([k, prof[k]]);

    // Cerrahi ekleme: yemin id'sinden objenin kapanışına kadar span; span içinde SON
    // "met"/"his" alanından sonra ekle (biçim: anchor sonrası newline=expanded → ayrı satır;
    // değilse=kompakt → inline).
    // id formatı dosyalar arası değişir: `"id": "X"` (boşluklu) veya `"id":"X"` (kompakt) → regex
    const idRe = new RegExp('"id":\\s*"' + feed.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"');
    const idM = idRe.exec(text);
    if (!idM) { skipped.push(feed.id + '(id-not-found)'); continue; }
    const idIdx = idM.index;
    // obje kapanışını bul (brace-depth; faProfile iç içe braceleri dengelenir)
    let depth = 0, end = -1;
    for (let i = idIdx; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') { if (depth === 0) { end = i; break; } depth--; }
    }
    if (end < 0) { skipped.push(feed.id + '(span)'); continue; }
    const span = text.slice(idIdx, end);

    // span içindeki son "met"/"his" alan eşleşmesi (değer + virgül)
    const re = /"(?:met|his)":\s*-?[\d.]+\s*,/g;
    let m, last = null;
    while ((m = re.exec(span)) !== null) last = m;
    if (!last) { skipped.push(feed.id + '(no-anchor)'); continue; }
    const insAt = idIdx + last.index + last[0].length;   // anchor virgülünden sonra
    const after = text[insAt];                            // sonraki karakter

    let insertion;
    if (after === '\n') {
      // expanded: her alan kendi satırında (6-space indent)
      insertion = '\n' + fields.map(([k, v]) => `      "${k}": ${fmt(v)},`).join('\n');
    } else {
      // kompakt: aynı satıra inline ekle
      insertion = ' ' + fields.map(([k, v]) => `"${k}": ${fmt(v)},`).join(' ');
    }
    text = text.slice(0, insAt) + insertion + text.slice(insAt);
    count++;
    totalEnriched++;
  }

  JSON.parse(text);                       // doğrula: hâlâ geçerli JSON (dry + write)
  if (!DRY) fs.writeFileSync(fp, text, 'utf8'); // BOM yok (utf8)
  perFile[file] = count;
}

console.log('Zenginleştirilen yem sayısı (toplam):', totalEnriched);
console.log('Dosya bazında:', JSON.stringify(perFile, null, 2));
console.log('Atlanan (sınıflanamayan) yem sayısı:', skipped.length);
console.log(DRY ? 'DRY-RUN (yazılmadı)' : 'YAZILDI');
console.log('\nTip bazında (sınıflama doğrulaması):');
for (const [t, ids] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${t} (${ids.length}): ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ' …' : ''}`);
}
console.log('\nAtlanan örnekler:', skipped.slice(0, 50).join(', '));
