const fs = require('fs');

function fixJSON(filename) {
  let lines = fs.readFileSync(filename, 'utf8').split('\n');
  
  // Clean up any previously manually inserted wrong headers
  lines = lines.filter(l => !l.includes('"animal_profile": {') && !l.includes('"dashboard": {'));
  
  const insertions = [
    { search: '"quick_actions":', insert: '  "dashboard": {' },
    { search: '"profile_mgmt":', insert: '  "animal": {' },
    { search: '"feed_selection":', insert: '  "ration": {' },
    { search: '"badge_feasible":', insert: '  "results": {' },
    { search: '"search_ph":', insert: '  "feeds": {' },
    { search: '"hw_title":', insert: '  "herd": {' },
    { search: '"lang":', insert: '  "settings": {' }
  ];
  
  insertions.forEach(item => {
    let found = false;
    for(let i=0; i<lines.length; i++) {
      if(lines[i].includes(item.search)) {
        // Only insert if not already there (we just removed dashboard and animal, but let's be safe)
        if(i > 0 && lines[i-1].includes(item.insert.trim())) {
           found = true;
           break;
        }
        lines.splice(i, 0, item.insert);
        found = true;
        break;
      }
    }
  });

  fs.writeFileSync(filename, lines.join('\n'));
}

fixJSON('src/i18n/tr.json');
fixJSON('src/i18n/en.json');

try { JSON.parse(fs.readFileSync('src/i18n/tr.json', 'utf8')); console.log('TR OK'); } catch(e) { console.log('TR Error:', e.message); }
try { JSON.parse(fs.readFileSync('src/i18n/en.json', 'utf8')); console.log('EN OK'); } catch(e) { console.log('EN Error:', e.message); }
