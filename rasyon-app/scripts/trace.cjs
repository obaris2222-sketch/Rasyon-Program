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
    else if (c === '{') {
      depth++;
      console.log('Line', line, 'OPEN { -> depth', depth);
    }
    else if (c === '}') {
      depth--;
      console.log('Line', line, 'CLOSE } -> depth', depth);
      if (depth === 0) break;
    }
  }
}
