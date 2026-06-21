const fs = require('fs');

function fixDuplicates(filename) {
  const text = fs.readFileSync(filename, 'utf8');
  let result = '';
  const keys = new Set();
  const lines = text.split('\n');
  
  lines.forEach((line) => {
    const match = line.match(/^\s*"([^"]+)"\s*:/);
    if(match) {
      if(!keys.has(match[1])) {
        result += line + '\n';
        keys.add(match[1]);
      } else {
        console.log('Removed duplicate in ' + filename + ':', match[1]);
      }
    } else {
      result += line + '\n';
    }
  });
  
  // Remove trailing comma from last property before closing brace
  result = result.replace(/,\n(\s*)\}/g, '\n$1}');
  
  fs.writeFileSync(filename, result.trim() + '\n', 'utf8');
}

fixDuplicates('src/i18n/tr.json');
fixDuplicates('src/i18n/en.json');
console.log('Done!');
