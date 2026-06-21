/**
 * restore_missing_i18n.cjs
 * Tüm eksik i18n anahtarlarını hem tr.json hem en.json'a ekler.
 * Her anahtar için değeri UI kaynak kodundan veya mantıksal çıkarımdan türetir.
 */
const fs = require('fs');
const path = require('path');

const trPath = path.join(__dirname, '../src/i18n/tr.json');
const enPath = path.join(__dirname, '../src/i18n/en.json');

const tr = JSON.parse(fs.readFileSync(trPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// Helper: set nested key
function setKey(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (cur[last] === undefined) {
    cur[last] = value;
  }
}

// Missing keys: [tr_value, en_value]
const missing = {
  'animal.title': ['Hayvan Profili', 'Animal Profile'],
  'animal.delete': ['Profili Sil', 'Delete Profile'],
  'feeds.title': ['Yem Veritabanı', 'Feed Database'],
  'feeds.delete': ['Sil', 'Delete'],
  'feeds.detail': ['Detay', 'Detail'],
  'feeds.edit': ['Düzenle', 'Edit'],
  'feeds.loading': ['Yükleniyor...', 'Loading...'],
  'feeds.no_results': ['Sonuç bulunamadı', 'No results'],
  'herd.title': ['Toplu Sürü', 'Herd Batch'],
  'herd.milk_price': ['Süt Fiyatı (TL/kg)', 'Milk Price (TL/kg)'],
  'herd.col_dmi': ['KMT (kg)', 'DMI (kg)'],
  'herd.col_nel': ['NEL (Mcal)', 'NEL (Mcal)'],
  'herd.col_cp': ['HP (%)', 'CP (%)'],
  'herd.col_status': ['Durum', 'Status'],
  'herd.herd_co2': ['Sürü CO₂ eşdeğeri', 'Herd CO₂ equiv.'],
  'herd.pdf_done': ['PDF hazır!', 'PDF ready!'],
  'herd.pdf_err': ['PDF oluşturma hatası', 'PDF generation error'],
  'herd.pdf_prep': ['PDF hazırlanıyor...', 'Preparing PDF...'],
  'ration.optimize': ['Rasyonu Optimize Et', 'Optimize Ration'],
  'ration.fat': ['Yağ', 'Fat'],
  'results.no_ration': ['Henüz rasyon yok', 'No ration yet'],
  'results.go_optimize': ['Rasyon Kurucu\'dan optimizasyon yapın', 'Go to Ration Builder to optimize'],
  'results.close': ['Kapat', 'Close'],
  'aa.no_data': ['Amino asit verisi yok', 'No amino acid data'],
  'aa.st_below': ['Yetersiz', 'Below req.'],
  'aa.st_ok': ['Yeterli', 'Adequate'],
  'aa.st_optimal': ['Optimal', 'Optimal'],
  'acalc.col_max': ['Maks.', 'Max.'],
  'acalc.col_min': ['Min.', 'Min.'],
  'acalc.col_mineral': ['Mineral', 'Mineral'],
  'acalc.del_err': ['Silme hatası', 'Delete error'],
  'acalc.dmi_method': ['KMT Yöntemi', 'DMI Method'],
  'acalc.err': ['Hesaplama hatası', 'Calculation error'],
  'acalc.save_err': ['Kaydetme hatası', 'Save error'],
  'acalc.sum_dmi': ['Toplam KMT', 'Total DMI'],
  'acalc.sum_mp': ['Toplam MP', 'Total MP'],
  'acalc.sum_nel': ['Toplam NEL', 'Total NEL'],
  'acalc.unit_dm': ['KM bazında', 'on DM basis'],
  'cloud.aria': ['Bulut Hesabı', 'Cloud Account'],
  'cloud.close': ['Kapat', 'Close'],
  'cncps.col_value': ['Değer', 'Value'],
  'cncps.method': ['Yöntem', 'Method'],
  'cncps.no_data': ['CNCPS verisi yok', 'No CNCPS data'],
  'cncps.unit_dm': ['% KM', '% DM'],
  'dcad.col_status': ['Durum', 'Status'],
  'dcad.col_value': ['Değer', 'Value'],
  'dcad.no_data': ['DCAD verisi yok', 'No DCAD data'],
  'dcad.st_above': ['Yüksek', 'Above'],
  'dcad.st_below': ['Düşük', 'Below'],
  'dcad.st_optimal': ['Optimal', 'Optimal'],
  'econ.iofc_note': ['Yem maliyeti düşüldükten sonra süt geliri', 'Income over feed cost'],
  'econ.iofc_per_cow': ['İnek başına IOFC', 'IOFC per cow'],
  'env.no_data': ['Çevresel veri yok', 'No environmental data'],
  'env.unit_g_day': ['g/gün', 'g/day'],
  'env.unit_mcal_day': ['Mcal/gün', 'Mcal/day'],
  'fa.col_meaning': ['Anlam', 'Meaning'],
  'fa.col_param': ['Parametre', 'Parameter'],
  'fa.col_value': ['Değer', 'Value'],
  'fa.recommendations': ['Öneriler', 'Recommendations'],
  'fa.warnings': ['Uyarılar', 'Warnings'],
  'farm.aria': ['Çiftlik', 'Farm'],
  'farm.back': ['Geri', 'Back'],
  'farm.close': ['Kapat', 'Close'],
  'farm.delete': ['Çiftliği Sil', 'Delete Farm'],
  'farm.deleted': ['Çiftlik silindi', 'Farm deleted'],
  'farm.new': ['Yeni Çiftlik', 'New Farm'],
  'farm.save': ['Kaydet', 'Save'],
  'farm.saved': ['Çiftlik kaydedildi', 'Farm saved'],
  'farm.title': ['Çiftlik Yönetimi', 'Farm Management'],
  'fe.cancel': ['İptal', 'Cancel'],
  'fe.close': ['Kapat', 'Close'],
  'fe.confirm_del': ['Bu yemi silmek istediğinize emin misiniz?', 'Are you sure you want to delete this feed?'],
  'fe.deleted': ['Yem silindi', 'Feed deleted'],
  'fe.save': ['Kaydet', 'Save'],
  'fe.save_err': ['Kaydetme hatası', 'Save error'],
  'fq.col_status': ['Durum', 'Status'],
  'fq.no_data': ['Yem kalite verisi yok', 'No feed quality data'],
  'fq.st_ok': ['İyi', 'Good'],
  'heat.footer': ['Isı stresi düzeltmesi aktif', 'Heat stress adjustment active'],
  'history.col_name': ['Ad', 'Name'],
  'history.detail': ['Detay', 'Detail'],
  'history.footer': ['Geçmiş rasyonlar', 'Saved rations'],
  'history.loading': ['Yükleniyor...', 'Loading...'],
  'imp.cancel': ['İptal', 'Cancel'],
  'imp.close': ['Kapat', 'Close'],
  'imp.col_cp': ['HP (%)', 'CP (%)'],
  'imp.col_name': ['Ad', 'Name'],
  'imp.col_nel': ['NEL', 'NEL'],
  'imp.title': ['Yem İçe Aktar', 'Import Feed'],
  'inra.col_desc': ['Açıklama', 'Description'],
  'inra.col_value': ['Değer', 'Value'],
  'inra.intro': ['INRA 2018 rapor katmanı — formülasyon NASEM ile yapılır', 'INRA 2018 display layer — formulation uses NASEM'],
  'inra.protein': ['Protein', 'Protein'],
  'inra.title': ['INRA 2018 Raporu', 'INRA 2018 Report'],
  'obs.add_obs': ['Gözlem Ekle', 'Add Observation'],
  'obs.add_profile_first': ['Önce hayvan profili seçin', 'Select an animal profile first'],
  'obs.bcs': ['BCS', 'BCS'],
  'obs.chart_milk': ['Süt Verimi Trendi', 'Milk Yield Trend'],
  'obs.col_date': ['Tarih', 'Date'],
  'obs.col_dmi': ['KMT (kg)', 'DMI (kg)'],
  'obs.col_metric': ['Metrik', 'Metric'],
  'obs.col_milk': ['Süt (kg)', 'Milk (kg)'],
  'obs.col_param': ['Parametre', 'Parameter'],
  'obs.col_status': ['Durum', 'Status'],
  'obs.confirm_del': ['Bu gözlemi silmek istediğinize emin misiniz?', 'Are you sure you want to delete this observation?'],
  'obs.deleted': ['Gözlem silindi', 'Observation deleted'],
  'obs.dmi': ['KMT (kg/gün)', 'DMI (kg/day)'],
  'obs.empty_no_profile': ['Henüz gözlem yok', 'No observations yet'],
  'obs.fat': ['Yağ (%)', 'Fat (%)'],
  'obs.info': ['Saha gözlemleri, rasyon modelini gerçek verilerle karşılaştırır', 'Field observations compare ration model to real data'],
  'obs.loading': ['Yükleniyor...', 'Loading...'],
  'obs.methane': ['Metan (g/gün)', 'Methane (g/day)'],
  'obs.n_profiles': ['{n} profil', '{n} profiles'],
  'obs.protein': ['Protein (%)', 'Protein (%)'],
  'obs.save_err': ['Kaydetme hatası', 'Save error'],
  'obs.saved': ['Gözlem kaydedildi', 'Observation saved'],
  'obs.summary': ['Özet', 'Summary'],
  'obs.title': ['Saha Gözlemleri', 'Field Observations'],
  'obs.total_records': ['Toplam kayıt: {n}', 'Total records: {n}'],
  'pm.close': ['Kapat', 'Close'],
  'pm.col_cat': ['Kategori', 'Category'],
  'pm.col_cp': ['HP (%)', 'CP (%)'],
  'pm.col_dm': ['KM (%)', 'DM (%)'],
  'pm.col_name': ['Yem Adı', 'Feed Name'],
  'pm.col_nel': ['NEL (Mcal/kg)', 'NEL (Mcal/kg)'],
  'pm.hist_empty': ['Fiyat geçmişi yok', 'No price history'],
  'pm.intro': ['Yem fiyatlarını girin ve geçmişi takip edin', 'Enter feed prices and track history'],
  'pm.load_err': ['Yükleme hatası', 'Load error'],
  'pm.loading': ['Yükleniyor...', 'Loading...'],
  'pm.reset': ['Sıfırla', 'Reset'],
  'pm.save': ['Kaydet', 'Save'],
  'pm.save_err': ['Kaydetme hatası', 'Save error'],
  'pm.search_ph': ['Yem ara...', 'Search feed...'],
  'pm.title': ['Fiyat Yöneticisi', 'Price Manager'],
  'rumen.col_param': ['Parametre', 'Parameter'],
  'rumen.col_status': ['Durum', 'Status'],
  'rumen.col_value': ['Değer', 'Value'],
  'rumen.score': ['Rumen Sağlık Skoru', 'Rumen Health Score'],
  'scen.infeasible': ['Çözümsüz', 'Infeasible'],
  'scen.intro': ['Aynı profil için farklı optimizasyon stratejilerini karşılaştırın', 'Compare different optimization strategies for the same profile'],
  'scen.metric': ['Metrik', 'Metric'],
  'scen.note': ['Not', 'Note'],
  'scen.relaxed': ['Gevşetilmiş', 'Relaxed'],
  'scen.title': ['Senaryo Karşılaştırma', 'Scenario Comparison'],
  'sens.col_feed': ['Yem', 'Feed'],
  'sens.col_target': ['Hedef Fiyat (TL/ton)', 'Target Price (TL/ton)'],
  'sens.col_unit': ['Birim', 'Unit'],
  'sens.intro': ['LP gölge fiyatları — kısıtların değerini ve yem giriş eşiklerini gösterir', 'LP shadow prices — shows constraint values and feed entry thresholds'],
  'sens.title': ['Hassasiyet / Gölge Fiyat', 'Sensitivity / Shadow Price'],
  'settings.ambient_temp': ['Ortam Sıcaklığı (°C)', 'Ambient Temp (°C)'],
  'settings.dmi_method': ['KMT Hesap Yöntemi', 'DMI Method'],
  'settings.humidity': ['Bağıl Nem (%)', 'Humidity (%)'],
  'settings.milk_price': ['Süt Fiyatı (TL/kg)', 'Milk Price (TL/kg)'],
  'settings.save': ['Kaydet', 'Save'],
  'settings.title': ['Ayarlar', 'Settings'],
  'starch.method': ['Yöntem', 'Method'],
  'starch.no_data': ['Nişasta verisi yok', 'No starch data'],
  'starch.unit_dm': ['% KM', '% DM'],
  'starch.unit_g_day': ['g/gün', 'g/day'],
  'vm.col_max': ['Maks.', 'Max.'],
  'vm.col_min': ['Min.', 'Min.'],
  'vm.col_requirement': ['Gereksinim', 'Requirement'],
  'vm.col_status': ['Durum', 'Status'],
  'vm.footer': ['Vitamin ve mineral dengesi', 'Vitamin and mineral balance'],
  'vm.no_data': ['Veri yok', 'No data'],
  'vm.st_excess': ['Fazla', 'Excess'],
  'vm.st_ok': ['Yeterli', 'Adequate'],
};

let addedTr = 0;
let addedEn = 0;

for (const [key, [trVal, enVal]] of Object.entries(missing)) {
  const parts = key.split('.');
  let curTr = tr, curEn = en;
  // traverse to parent
  for (let i = 0; i < parts.length - 1; i++) {
    if (!curTr[parts[i]]) curTr[parts[i]] = {};
    if (!curEn[parts[i]]) curEn[parts[i]] = {};
    curTr = curTr[parts[i]];
    curEn = curEn[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (curTr[last] === undefined) { curTr[last] = trVal; addedTr++; }
  if (curEn[last] === undefined) { curEn[last] = enVal; addedEn++; }
}

fs.writeFileSync(trPath, JSON.stringify(tr, null, 2), 'utf8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2), 'utf8');

console.log(`TR: ${addedTr} anahtar eklendi`);
console.log(`EN: ${addedEn} anahtar eklendi`);

// Validate
try {
  JSON.parse(fs.readFileSync(trPath, 'utf8'));
  console.log('TR JSON: OK');
} catch(e) { console.error('TR JSON HATA:', e.message); }
try {
  JSON.parse(fs.readFileSync(enPath, 'utf8'));
  console.log('EN JSON: OK');
} catch(e) { console.error('EN JSON HATA:', e.message); }
