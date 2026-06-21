/**
 * clean_faz_refs.cjs
 * i18n dosyalarındaki kullanıcıya görünen "FAZ XX" ibarelerini kaldırır.
 */
const fs = require('fs');
const path = require('path');

const trPath = path.join(__dirname, '../src/i18n/tr.json');
const enPath = path.join(__dirname, '../src/i18n/en.json');

const tr = JSON.parse(fs.readFileSync(trPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// === Düzeltmeler ===

// results.display_badge
tr.results.display_badge = '📊 Gösterim & Analiz — CNCPS iteratif formülasyon ile desteklenir';
en.results.display_badge = '📊 Display & Analysis — backed by CNCPS iterative formulation';

// results.dmi_fill_card_title — "(FAZ 18.2)" kaldır
tr.results.dmi_fill_card_title = 'Hayvan-bazlı KMT {base} kg; rasyon NDF doluluğu nedeniyle düşürüldü';
en.results.dmi_fill_card_title = 'Animal-based DMI {base} kg; reduced due to ration NDF fill';

// cncps.method
tr.cncps.method = 'Hesap Modu (CNCPS iteratif motor — ölçülü yemlerde dinamik AA + pasaj hızı)';
en.cncps.method = 'Calculation Mode (CNCPS iterative engine — dynamic AA + passage rate for calibrated feeds)';

// inra.intro
tr.inra.intro = 'INRA 2018 rapor katmanı — formülasyon NASEM 2021 + CNCPS v6.5 motoru ile yapılır; INRA değerleri ek gösterim olarak hesaplanır';
en.inra.intro = 'INRA 2018 display layer — formulation uses NASEM 2021 + CNCPS v6.5 engine; INRA values are computed as supplemental report';

fs.writeFileSync(trPath, JSON.stringify(tr, null, 2), 'utf8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2), 'utf8');

// Validate
try { JSON.parse(fs.readFileSync(trPath, 'utf8')); console.log('TR JSON: OK'); } catch(e) { console.error('TR HATA:', e.message); }
try { JSON.parse(fs.readFileSync(enPath, 'utf8')); console.log('EN JSON: OK'); } catch(e) { console.error('EN HATA:', e.message); }
console.log('FAZ referansları temizlendi.');
