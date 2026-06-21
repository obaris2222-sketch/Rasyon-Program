const fs = require('fs');

function repairJSON(filename) {
  let lines = fs.readFileSync(filename, 'utf8').split('\n');
  
  // Clean up any manually inserted headers from previous attempts
  lines = lines.filter(l => 
    !l.includes('"animal": {') &&
    !l.includes('"animal_profile": {') && 
    !l.includes('"dashboard": {') &&
    !l.includes('"ration": {') &&
    !l.includes('"results": {') &&
    !l.includes('"dcad": {') &&
    !l.includes('"feeds": {') &&
    !l.includes('"herd": {') &&
    !l.includes('"settings": {') &&
    !l.includes('"starch": {')
  );

  const blocks = [
    { key: '"quick_actions":', header: '  "dashboard": {' },
    { key: '"profile_mgmt":', header: '  "animal": {' },
    { key: '"feed_selection":', header: '  "ration": {' },
    { key: '"badge_feasible":', header: '  "results": {' },
    { key: '"mf_low":', header: '  "dcad": {' },
    { key: '"search_ph":', header: '  "feeds": {' },
    { key: '"description":', header: '  "settings": {' },
    { key: '"empty_no_profile":', header: '  "herd": {' },
    { key: '"rumen_ferm":', header: '  "starch": {' }
  ];

  for (let b of blocks) {
    let idx = lines.findIndex(l => l.includes(b.key));
    if (idx !== -1) {
      lines.splice(idx, 0, b.header);
    } else {
      console.log('WARNING: Key ' + b.key + ' not found in ' + filename);
    }
  }

  fs.writeFileSync(filename, lines.join('\n'));
}

repairJSON('src/i18n/tr.json');
repairJSON('src/i18n/en.json');

try { JSON.parse(fs.readFileSync('src/i18n/tr.json', 'utf8')); console.log('TR OK'); } catch(e) { console.log('TR Error:', e.message); }
try { JSON.parse(fs.readFileSync('src/i18n/en.json', 'utf8')); console.log('EN OK'); } catch(e) { console.log('EN Error:', e.message); }
