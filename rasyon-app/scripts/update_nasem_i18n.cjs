/**
 * update_nasem_i18n.cjs
 * FAZ 25.3: cncps.method ve results.display_badge açıklamalarını günceller.
 * CNCPS panelinin "motor" olduğunu yansıtacak şekilde.
 */
const fs = require('fs');
const path = require('path');

const trPath = path.join(__dirname, '../src/i18n/tr.json');
const enPath = path.join(__dirname, '../src/i18n/en.json');

const tr = JSON.parse(fs.readFileSync(trPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// cncps.method — "Hesap Modu" yerine daha açıklayıcı
tr.cncps.method = 'Hesap Modu (FAZ 24-25: CNCPS iteratif motor — ölçülü yemlerde dinamik AA + pasaj hızı)';
en.cncps.method = 'Calculation Mode (FAZ 24-25: CNCPS iterative engine — dynamic AA + passage rate for calibrated feeds)';

// inra.intro — formülasyon NASEM ile yapılır; CNCPS motor FAZ 24'te eklendi
tr.inra.intro = 'INRA 2018 rapor katmanı — formülasyon NASEM 2021 + CNCPS v6.5 motoru ile yapılır; INRA değerleri ek gösterim olarak hesaplanır';
en.inra.intro = 'INRA 2018 display layer — formulation uses NASEM 2021 + CNCPS v6.5 engine; INRA values are computed as supplemental report';

// results.display_badge — CNCPS artık motor, sadece görünüm değil
tr.results.display_badge = '📊 Gösterim & Analiz — CNCPS iteratif formülasyon ile desteklenir (FAZ 24-25)';
en.results.display_badge = '📊 Display & Analysis — backed by CNCPS iterative formulation (FAZ 24-25)';

fs.writeFileSync(trPath, JSON.stringify(tr, null, 2), 'utf8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2), 'utf8');

// Validate
try { JSON.parse(fs.readFileSync(trPath,'utf8')); console.log('TR JSON: OK'); } catch(e) { console.error('TR HATA:', e.message); }
try { JSON.parse(fs.readFileSync(enPath,'utf8')); console.log('EN JSON: OK'); } catch(e) { console.error('EN HATA:', e.message); }
console.log('i18n FAZ 25.3 güncellemesi tamamlandı.');
