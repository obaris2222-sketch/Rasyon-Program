const fs = require('fs');
let text = fs.readFileSync('src/i18n/tr.json', 'utf8');

let depth = 0;
let inString = false;
let escape = false;

for(let i=0; i<29794; i++) {
  let c = text[i];
  if (inString) {
    if (escape) escape = false;
    else if (c === '\\') escape = true;
    else if (c === '"') inString = false;
  } else {
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
  }
}
console.log('Real depth at pos 29794:', depth);
