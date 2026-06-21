const fs = require('fs');
const path = require('path');

// Collect all t('...') calls from UI files
const uiDir = path.join(__dirname, '../src/ui');
const keys = new Set();

function scanDir(dir) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) { scanDir(fp); continue; }
    if (!f.endsWith('.js')) continue;
    const txt = fs.readFileSync(fp, 'utf8');
    // Match t('key') or t("key") patterns
    const re = /\bt\(\s*['"]([a-zA-Z][a-zA-Z0-9_.]+)['"]\s*[,)]/g;
    let m;
    while ((m = re.exec(txt)) !== null) keys.add(m[1]);
  }
}
scanDir(uiDir);

const trRaw = fs.readFileSync(path.join(__dirname, '../src/i18n/tr.json'), 'utf8');
const enRaw = fs.readFileSync(path.join(__dirname, '../src/i18n/en.json'), 'utf8');
const tr = JSON.parse(trRaw);
const en = JSON.parse(enRaw);

function getKey(obj, key) {
  const parts = key.split('.');
  let val = obj;
  for (const p of parts) { val = val && val[p]; }
  return val;
}

const missingTr = [];
const missingEn = [];
for (const k of [...keys].sort()) {
  if (getKey(tr, k) === undefined) missingTr.push(k);
  if (getKey(en, k) === undefined) missingEn.push(k);
}

console.log('=== MISSING IN TR (' + missingTr.length + ') ===');
missingTr.forEach(k => console.log(k));
console.log('');
console.log('=== MISSING IN EN (' + missingEn.length + ') ===');
missingEn.forEach(k => console.log(k));
