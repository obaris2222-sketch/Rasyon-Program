const fs = require('fs');
let text = fs.readFileSync('src/i18n/tr.json', 'utf8');
let lines = text.split('\n');

for(let i=0; i<lines.length; i++) {
  if (lines[i].includes('"presets": {')) console.log('ration starts around line', i);
  if (lines[i].includes('"quick_actions":')) console.log('dashboard starts around line', i);
  if (lines[i].includes('"profile_mgmt":')) console.log('animal starts around line', i);
  if (lines[i].includes('"add_custom":')) console.log('feeds starts around line', i);
  if (lines[i].includes('"summary":')) console.log('results starts around line', i);
  if (lines[i].includes('"herd_co2":')) console.log('herd starts around line', i);
  if (lines[i].includes('"science":')) console.log('settings starts around line', i);
}
