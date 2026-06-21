const fs = require('fs');
let text = fs.readFileSync('src/i18n/tr.json', 'utf8');

let depth = 0;
let inString = false;
let escape = false;
let line = 1;

for(let i=0; i<text.length; i++) {
  let c = text[i];
  if(c === '\n') line++;
  if (inString) {
    if (escape) escape = false;
    else if (c === '\\') escape = true;
    else if (c === '"') inString = false;
  } else {
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        console.log('Depth hit 0 at line', line);
      }
    }
  }
}
