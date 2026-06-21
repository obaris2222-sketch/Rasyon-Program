const fs = require('fs');

function repairJSON(filename) {
  let lines = fs.readFileSync(filename, 'utf8').split('\n');
  
  // Remove my manual insertions
  lines = lines.filter(l => 
    !l.includes('"animal": {') &&
    !l.includes('"animal_profile": {') && 
    !l.includes('"dashboard": {') &&
    !l.includes('"ration": {') &&
    !l.includes('"results": {') &&
    !l.includes('"feeds": {') &&
    !l.includes('"herd": {') &&
    !l.includes('"settings": {')
  );

  // Re-insert them correctly at the right keys
  const blocks = [
    { key: '"quick_actions":', header: '  "dashboard": {' },
    { key: '"profile_mgmt":', header: '  "animal": {' },
    { key: '"feed_selection":', header: '  "ration": {' },
    { key: '"badge_feasible":', header: '  "results": {' },
    { key: '"description":', header: '  "settings": {' },
    { key: '"empty_no_profile":', header: '  "herd": {' }
  ];

  for (let b of blocks) {
    let idx = lines.findIndex(l => l.includes(b.key));
    if (idx !== -1) {
      lines.splice(idx, 0, b.header);
    }
  }

  // But wait! What about 'feeds'?
  // feeds started at 'search_ph' maybe? But 'search_ph' is inside feeds.
  // Actually, wait, let's look at the keys to find where feeds starts.
  let searchPhIdx = lines.findIndex(l => l.includes('"search_ph":'));
  if (searchPhIdx !== -1) {
    lines.splice(searchPhIdx, 0, '  "feeds": {');
  }

  fs.writeFileSync(filename, lines.join('\n'));
}

repairJSON('src/i18n/tr.json');
repairJSON('src/i18n/en.json');

try { JSON.parse(fs.readFileSync('src/i18n/tr.json', 'utf8')); console.log('TR OK'); } catch(e) { console.log('TR Error:', e.message); }
try { JSON.parse(fs.readFileSync('src/i18n/en.json', 'utf8')); console.log('EN OK'); } catch(e) { console.log('EN Error:', e.message); }
