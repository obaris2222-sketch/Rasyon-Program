/**
 * PDF Export — jsPDF + AutoTable
 * Profesyonel rasyon raporu (A4, Türkçe)
 * FAZ 7A: DejaVu Sans TTF → tam Türkçe karakter desteği (CDN'den yüklenir).
 *          Font yüklenemezse ASCII translit fallback otomatik devreye girer.
 */

import jsPDF from 'jspdf';
import autoTableFn from 'jspdf-autotable';
import { loadTurkishFont, loadTurkishFontBold } from './fontLoader.js';
import { getSettings } from '../data/settings.js';
import { getActiveFarm } from '../data/db.js';   // FAZ 16.11/2.3 — aktif çiftlik profili

function autoTable(doc, options) {
  if (typeof autoTableFn === 'function') return autoTableFn(doc, options);
  if (typeof doc.autoTable === 'function') return doc.autoTable(options);
  throw new Error('jspdf-autotable yüklenemedi');
}

// FAZ 22.3: dil-tutarlı export — aktif dile (TR/EN) göre etiketler + yem adları.
const STATUS_LABELS = {
  tr: { ok: 'Tamam', below: 'Düşük', above: 'Yüksek' },
  en: { ok: 'OK', below: 'Low', above: 'High' },
};

const AA_STATUS_LABELS = {
  tr: { optimal: 'Optimal', marginal: 'Marjinal', deficient: 'Eksik', excess: 'Fazla', ok: 'Tamam', below_target: 'Düşük' },
  en: { optimal: 'Optimal', marginal: 'Marginal', deficient: 'Deficient', excess: 'Excess', ok: 'OK', below_target: 'Low' },
};

const STAGE_LABELS = {
  tr: { early: 'Erken Laktasyon', mid: 'Orta Laktasyon', late: 'Geç Laktasyon', far_off: 'Kuru — Far-off', close_up: 'Yakın Kuru — Close-up (Anyonik)' },
  en: { early: 'Early Lactation', mid: 'Mid Lactation', late: 'Late Lactation', far_off: 'Dry — Far-off', close_up: 'Close-up (Anionic)' },
};

/**
 * Rasyon sonucundan profesyonel PDF rapor üretir.
 * @returns {Promise<jsPDF>}
 */
export async function generateRationPDF({ animal, result, title = 'Süt Sığırı Rasyon Raporu' }) {
  const [fontBase64, fontBoldBase64] = await Promise.all([loadTurkishFont(), loadTurkishFontBold()]);
  const hasFont = !!fontBase64;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  if (hasFont) {
    doc.addFileToVFS('DejaVuSans.ttf', fontBase64);
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
    if (fontBoldBase64) {
      doc.addFileToVFS('DejaVuSans-Bold.ttf', fontBoldBase64);
      doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
    }
  }

  const BODY_FONT  = hasFont ? 'DejaVuSans' : 'helvetica';
  const BOLD_FONT  = hasFont ? 'DejaVuSans' : 'helvetica';
  const tblBody    = hasFont ? { font: 'DejaVuSans', fontStyle: 'normal' } : {};
  const str        = hasFont ? (s) => (s ?? '') : ascii;

  // FAZ 22.3: aktif dile göre etiket + yem adı (karışık-dil önlenir).
  const lang = getSettings().language === 'en' ? 'en' : 'tr';
  const L = (tr, en) => (lang === 'en' ? en : tr);
  const feedName = (it) => (lang === 'en' && it.nameEn ? it.nameEn : it.name) || '';

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  // ─── Başlık ────────────────────────────────────────────────────────────────
  doc.setFontSize(16);
  doc.setFont(BOLD_FONT, 'bold');
  doc.setTextColor(29, 78, 216);
  doc.text(str(title), pageWidth / 2, y, { align: 'center' });
  y += 7;

  // FAZ 15.2 + 16.11/2.3: Aktif çiftliğin profili başlık altına eklenir.
  // Aktif çiftliğin alanı boşsa Ayarlar'daki genel profile (fallback) düşer →
  // çok-çiftlikte her rapor kendi çiftliğinin ad/adres/danışmanını gösterir.
  const gf = getSettings().farm || {};
  const af = (await getActiveFarm()) || {};
  const farm = {
    name:    af.name    || gf.name    || '',
    address: af.address || gf.address || '',
    advisor: af.advisor || gf.advisor || '',
  };
  if (farm.name || farm.advisor) {
    doc.setFontSize(10);
    doc.setFont(BOLD_FONT, 'bold');
    doc.setTextColor(60);
    const farmLine = [farm.name, farm.advisor ? `${L('Danışman', 'Advisor')}: ${farm.advisor}` : '']
      .filter(Boolean).join('   •   ');
    doc.text(str(farmLine), pageWidth / 2, y, { align: 'center' });
    y += 5;
    if (farm.address) {
      doc.setFontSize(8);
      doc.setFont(BODY_FONT, 'normal');
      doc.setTextColor(120);
      doc.text(str(farm.address), pageWidth / 2, y, { align: 'center' });
      y += 5;
    }
  }

  doc.setFontSize(8);
  doc.setFont(BODY_FONT, 'normal');
  doc.setTextColor(100);
  doc.text(`NRC 2001 / NASEM 2021 / CNCPS v6.5 | ${new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR')}`,
    pageWidth / 2, y, { align: 'center' });
  y += 8;

  // ─── Hayvan Profili ─────────────────────────────────────────────────────────
  y = sectionHeader(doc, str(L('Hayvan Profili', 'Animal Profile')), y, BOLD_FONT);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[str(L('Parametre', 'Parameter')), str(L('Değer', 'Value')), str(L('Parametre', 'Parameter')), str(L('Değer', 'Value'))]],
    body: [
      [str(L('Canlı Ağırlık', 'Body Weight')),  `${animal.bw} kg`,              str(L('Süt Verimi', 'Milk Yield')),     `${animal.milkYield} ${L('kg/gün', 'kg/d')}`],
      [str(L('Süt Yağı', 'Milk Fat')),       `${animal.milkFat}%`,            str(L('Süt Proteini', 'Milk Protein')),   `${animal.milkProtein}%`],
      [str(L('Parite', 'Parity')),           `${animal.parity}`,               str(L('Laktasyon Günü', 'Days in Milk')), `${animal.dim} ${L('gün', 'd')}`],
      ['BCS',                 `${animal.bcs}`,                  str(L('Dönem', 'Stage')),          str(STAGE_LABELS[lang][animal.lactationStage] || STAGE_LABELS[lang].early)],
      [str(L('Gebelik', 'Pregnancy')),        animal.pregnant ? L(`${animal.pregnancyMonth || '?'}. ay`, `month ${animal.pregnancyMonth || '?'}`) : str(L('Hayır', 'No')),
       str(L('Isı Stresi', 'Heat Stress')),     animal.thi ? `THI ${animal.thi}` : L('Yok', 'None')],
    ],
    styles: { fontSize: 8, cellPadding: 1.5, ...tblBody },
    headStyles: { fillColor: [29, 78, 216], textColor: 255, fontSize: 8 },
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } },
  });
  y = doc.lastAutoTable.finalY + 5;

  // ─── Sonuç Durumu ──────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont(BOLD_FONT, 'bold');
  doc.setTextColor(result.feasible ? 45 : 217, result.feasible ? 125 : 83, result.feasible ? 70 : 79);
  doc.text(
    result.feasible
      ? str(L('✓ UYGUN RASYON', '✓ FEASIBLE RATION'))
      : str(L(`✗ UYGUN RASYON BULUNAMADI (${result.statusName})`, `✗ NO FEASIBLE RATION (${result.statusName})`)),
    margin, y
  );
  y += 6;

  // ─── Özet Kutu ─────────────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(0);
  doc.setFont(BODY_FONT, 'normal');
  const summaryItems = [[
    str(`${L('KM', 'DM')}: ${result.dmi.achieved_kg.toFixed(1)} ${L('kg/gün', 'kg/d')}`),
    str(`NEL: ${result.composition.nel_mcal.toFixed(1)} Mcal`),
    str(`${L('HP', 'CP')}: ${result.composition.cp_pct.toFixed(1)}%`),
    str(`NDF: ${result.composition.ndf_pct.toFixed(1)}%`),
    str(`${L('Maliyet', 'Cost')}: ${result.totalCost.toFixed(2)} ${L('TL/gün', 'TL/d')}`),
  ]];
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: summaryItems,
    styles: { fontSize: 9, fontStyle: 'bold', halign: 'center', cellPadding: 2,
              fillColor: [232, 245, 236], textColor: [30, 92, 50], ...tblBody },
    theme: 'plain',
  });
  y = doc.lastAutoTable.finalY + 5;

  // ─── Rasyon Bileşenleri ────────────────────────────────────────────────────
  y = sectionHeader(doc, str(L('Rasyon Bileşenleri', 'Ration Components')), y, BOLD_FONT);
  const itemRows = result.items.map(it => [
    str(feedName(it)),
    it.dmKg.toFixed(2),
    it.asFedKg.toFixed(2),
    it.pctDm.toFixed(1),
    it.costPerDay > 0 ? it.costPerDay.toFixed(2) : '—',
  ]);
  const totalDm   = result.items.reduce((s, i) => s + i.dmKg, 0);
  const totalAsFed = result.items.reduce((s, i) => s + i.asFedKg, 0);
  const totalCost  = result.items.reduce((s, i) => s + i.costPerDay, 0);
  itemRows.push([str(L('TOPLAM', 'TOTAL')), totalDm.toFixed(2), totalAsFed.toFixed(2), '100', totalCost.toFixed(2)]);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[str(L('Yem', 'Feed')), str(L('KM (kg)', 'DM (kg)')), str(L('Yaş (kg)', 'As-fed (kg)')), L('%KM', '%DM'), L('TL/gün', 'TL/d')]],
    body: itemRows,
    styles: { fontSize: 8, cellPadding: 1.5, ...tblBody },
    headStyles: { fillColor: [29, 78, 216], textColor: 255 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    didParseCell: data => {
      if (data.row.index === itemRows.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [240, 243, 241];
      }
    },
  });
  y = doc.lastAutoTable.finalY + 5;

  // ─── TMR Karıştırma Talimatı (FAZ 6 plan) ────────────────────────────────
  // Pratik sahada kullanım için yem maddelerini önerilen karıştırma sırasına
  // göre listele (kaba yem → yan ürün → tahıl → protein → mineral/yağ → premiks)
  y = sectionHeader(doc, str(L('TMR Karıştırma Talimatı (Yaş Ağırlık, kg/gün)', 'TMR Mixing Instructions (As-fed, kg/d)')), y, BOLD_FONT);
  const MIX_ORDER = ['roughage', 'byproduct', 'grain', 'protein', 'fat', 'mineral'];
  const CATEGORY_LABELS = {
    tr: { roughage: '1. Kaba Yem', byproduct: '2. Yan Ürün', grain: '3. Tahıl/Konsantre', protein: '4. Protein Kaynağı', fat: '5. Yağ Katkısı', mineral: '6. Mineral/Premiks' },
    en: { roughage: '1. Forage', byproduct: '2. By-product', grain: '3. Grain/Concentrate', protein: '4. Protein Source', fat: '5. Fat Supplement', mineral: '6. Mineral/Premix' },
  };
  const CATEGORY_TR = CATEGORY_LABELS[lang];
  const sortedItems = [...result.items].sort((a, b) => {
    const ai = MIX_ORDER.indexOf(a.category);
    const bi = MIX_ORDER.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const tmrRows = sortedItems.map((it, idx) => [
    `${idx + 1}`,
    str(CATEGORY_TR[it.category] || it.category),
    str(feedName(it)),
    it.asFedKg.toFixed(2),
    it.dmKg.toFixed(2),
  ]);
  tmrRows.push([str(L('TOPLAM', 'TOTAL')), '', '', totalAsFed.toFixed(2), totalDm.toFixed(2)]);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[str(L('Sıra', 'No')), str(L('Kategori', 'Category')), str(L('Yem', 'Feed')), str(L('Yaş kg/gün', 'As-fed kg/d')), str(L('KM kg/gün', 'DM kg/d'))]],
    body: tmrRows,
    styles: { fontSize: 8, cellPadding: 1.5, ...tblBody },
    headStyles: { fillColor: [58, 134, 208], textColor: 255 },
    columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    didParseCell: data => {
      if (data.row.index === tmrRows.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [240, 243, 241];
      }
    },
  });
  y = doc.lastAutoTable.finalY + 3;

  // Karıştırma önerisi
  doc.setFontSize(7);
  doc.setFont(BODY_FONT, 'normal');
  doc.setTextColor(80);
  const mixTip = str(L('İpucu: Yemler yukarıdaki sırayla mikserde işlenmelidir. Kaba yemi önce ekleyin, parçalanma sonrası yan ürünler, ardından tahıl-protein-yağ-mineral. Toplam karıştırma süresi: 4-6 dakika (aşırı karıştırma parçacık boyutunu düşürür → SARA riski).', 'Tip: Process feeds in the order above. Add forage first, then by-products after chopping, followed by grain-protein-fat-mineral. Total mixing time: 4-6 minutes (over-mixing reduces particle size → SARA risk).'));
  const tipLines = doc.splitTextToSize(mixTip, pageWidth - 2 * margin);
  doc.text(tipLines, margin, y);
  y += tipLines.length * 3 + 4;

  // ─── Diagnostik ────────────────────────────────────────────────────────────
  y = sectionHeader(doc, str(L('Kısıt Uyumu (Diagnostik)', 'Constraint Compliance (Diagnostics)')), y, BOLD_FONT);
  const diagRows = result.diagnostics.map(d => [
    str(d.name),
    fmt(d.value),
    d.min !== undefined ? fmt(d.min) : '—',
    d.max !== undefined ? fmt(d.max) : '—',
    str(STATUS_LABELS[lang][d.status] || d.status),
  ]);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[str(L('Kısıt', 'Constraint')), str(L('Değer', 'Value')), 'Min', str(L('Maks', 'Max')), str(L('Durum', 'Status'))]],
    body: diagRows,
    styles: { fontSize: 8, cellPadding: 1.5, ...tblBody },
    headStyles: { fillColor: [29, 78, 216], textColor: 255 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 4) {
        const st = result.diagnostics[data.row.index]?.status;
        if (st === 'ok')    data.cell.styles.textColor = [30, 92, 50];
        if (st === 'below') data.cell.styles.textColor = [125, 88, 0];
        if (st === 'above') data.cell.styles.textColor = [125, 26, 23];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = doc.lastAutoTable.finalY + 5;

  if (y > 230) { doc.addPage(); y = margin; }

  // ─── AA Paneli ─────────────────────────────────────────────────────────────
  if (result.aminoAcids) {
    y = sectionHeader(doc, str(L('Amino Asit Dengesi (Lys/Met/His + EAA)', 'Amino Acid Balance (Lys/Met/His + EAA)')), y, BOLD_FONT);
    const aa = result.aminoAcids;
    // Tam EAA: 10 AA (Lys/Met/His sınırlayıcı + 7 EAA gösterim). assessment'te olanları yaz.
    const AA_PDF = [
      ['lys', L('Lizin (Lys)', 'Lysine (Lys)')], ['met', L('Metiyonin (Met)', 'Methionine (Met)')], ['his', L('Histidin (His)', 'Histidine (His)')],
      ['arg', L('Arginin (Arg)', 'Arginine (Arg)')], ['thr', L('Treonin (Thr)', 'Threonine (Thr)')], ['ile', L('İzolösin (Ile)', 'Isoleucine (Ile)')],
      ['leu', L('Lösin (Leu)', 'Leucine (Leu)')], ['val', L('Valin (Val)', 'Valine (Val)')], ['phe', L('Fenilalanin (Phe)', 'Phenylalanine (Phe)')], ['trp', L('Triptofan (Trp)', 'Tryptophan (Trp)')],
    ];
    const aaRows = [];
    for (const [k, name] of AA_PDF) {
      const st = aa.assessment[k];
      if (!st) continue;
      const sup = aa.supply[k];
      aaRows.push([str(name), `${sup.total_g} ${L('g/gün', 'g/d')}`, `${st.required_g ?? '-'} ${L('g/gün', 'g/d')}`,
        `${sup.pctMP}%`, `${st.targetPctMP}%`,
        str(AA_STATUS_LABELS[lang][st.status] || st.status)]);
    }
    aaRows.push([str(L('Lys : Met Oranı', 'Lys : Met Ratio')), `${aa.assessment.ratio.actual ?? '-'}`, `>= ${aa.assessment.ratio.target}`,
      '-', '-', str(AA_STATUS_LABELS[lang][aa.assessment.ratio.status] || aa.assessment.ratio.status)]);
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['AA', str(L('Tedarik', 'Supply')), str(L('Gereksinim', 'Requirement')), '%MP', L('Hedef %MP', 'Target %MP'), str(L('Durum', 'Status'))]],
      body: aaRows,
      styles: { fontSize: 8, cellPadding: 1.5, ...tblBody },
      headStyles: { fillColor: [29, 78, 216], textColor: 255 },
    });
    y = doc.lastAutoTable.finalY + 3;

    doc.setFontSize(9);
    doc.setFont(BOLD_FONT, 'bold');
    doc.text(`${L('AA Skoru', 'AA Score')}: ${aa.assessment.overallScore} / 100`, margin, y);
    y += 5;

    if (aa.recommendations.length > 0) {
      doc.setFontSize(8);
      doc.setFont(BOLD_FONT, 'bold');
      doc.text(str(L('Öneriler:', 'Recommendations:')), margin, y);
      y += 4;
      doc.setFont(BODY_FONT, 'normal');
      for (const rec of aa.recommendations) {
        doc.text(str(`• ${rec.name} — ${L('eksik', 'deficit')}: ${rec.deficitG} ${L('g/gün', 'g/d')} (${rec.note})`), margin + 3, y);
        y += 4;
      }
      y += 2;
    }
  }

  if (y > 240) { doc.addPage(); y = margin; }

  // ─── Besin Profili ─────────────────────────────────────────────────────────
  y = sectionHeader(doc, str(L('Tam Besin Profili', 'Full Nutrient Profile')), y, BOLD_FONT);
  const c = result.composition;
  const GD = L('g/gün', 'g/d'); const KM = L('%KM', '%DM'); const CP = L('HP', 'CP');
  const compRows = [
    [str(`NEL (${L('Mcal/gün', 'Mcal/d')})`), c.nel_mcal], [str(`${CP} ${GD}`), c.cp_g], [str(`${CP} ${KM}`), c.cp_pct],
    [str(`RUP ${GD}`), c.rup_g],            [str(`RDP ${GD}`), c.rdp_g],      [str(`NDF ${KM}`), c.ndf_pct],
    [str(`ADF ${KM}`), c.adf_pct],          [str(`NFC ${KM}`), c.nfc_pct],    [str(`${L('Nişasta', 'Starch')} ${KM}`), c.starch_pct],
    [str(`${L('Şeker', 'Sugar')} ${KM}`), c.sugar_pct], [str(`${L('Yağ', 'Fat')} ${KM}`), c.fat_pct], [str(`${L('Kül', 'Ash')} ${KM}`), c.ash_pct],
    [str(`peNDF ${KM}`), c.peNDF_pct],      [str(`${L('Kaba yem', 'Forage')} ${KM}`), c.forage_pct], [str('DCAD mEq/100g'), c.dcad_meq],
    [str(`Ca ${GD}`), c.ca_g],              [str(`P ${GD}`), c.p_g],          [str(`Mg ${GD}`), c.mg_g],
    [str(`K ${GD}`), c.k_g],                [str(`Na ${GD}`), c.na_g],        [str(`S ${GD}`), c.s_g],
    [str(`Cl ${GD}`), c.cl_g],
  ];
  const compTable = [];
  for (let i = 0; i < compRows.length; i += 3) {
    compTable.push([
      compRows[i]?.[0]   ?? '', fmt(compRows[i]?.[1]),
      compRows[i+1]?.[0] ?? '', fmt(compRows[i+1]?.[1]),
      compRows[i+2]?.[0] ?? '', fmt(compRows[i+2]?.[1]),
    ]);
  }
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: compTable,
    styles: { fontSize: 7, cellPadding: 1, ...tblBody },
    columnStyles: {
      0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' }, 4: { fontStyle: 'bold' },
      1: { halign: 'right' },  3: { halign: 'right' },  5: { halign: 'right' },
    },
    theme: 'grid',
  });

  // ─── Altbilgi ──────────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(
      str(L(`Süt Sığırı Rasyon Programı — Sayfa ${p}/${pageCount}`, `Dairy Cattle Ration Program — Page ${p}/${pageCount}`)),
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'center' }
    );
  }

  return doc;
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function sectionHeader(doc, text, y, boldFont = 'helvetica') {
  doc.setFontSize(11);
  doc.setFont(boldFont, 'bold');
  doc.setTextColor(29, 78, 216);
  doc.text(text, 15, y);
  doc.setDrawColor(29, 78, 216);
  doc.setLineWidth(0.3);
  doc.line(15, y + 1, doc.internal.pageSize.getWidth() - 15, y + 1);
  doc.setTextColor(0);
  doc.setFont(boldFont, 'normal');
  return y + 5;
}

function fmt(v, d = 2) {
  if (v === undefined || v === null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

function ascii(str) {
  if (str == null) return '';
  return String(str)
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C');
}

/**
 * Tarayıcıda PDF'i indirir.
 */
export async function downloadRationPDF({ animal, result, filename }) {
  const doc = await generateRationPDF({ animal, result });
  const name = filename || `rasyon_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(name);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SÜRÜ ÖZET RAPORU (FAZ 6 plan #4)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Toplu sürü optimizasyonu için PDF özet raporu üretir.
 * @param {Array} batchResults - herdBatchPanel'in optimizasyon sonuç dizisi
 *   [{ profile, result, economics, groupName, groupSize, error }]
 * @param {object} meta - { milkPrice_tl }
 * @returns {Promise<jsPDF>}
 */
export async function generateHerdSummaryPDF(batchResults, meta = {}) {
  const fontBase64 = await loadTurkishFont();
  const hasFont = !!fontBase64;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const fontBoldBase64H = await loadTurkishFontBold();
  if (hasFont) {
    doc.addFileToVFS('DejaVuSans.ttf', fontBase64);
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
    if (fontBoldBase64H) {
      doc.addFileToVFS('DejaVuSans-Bold.ttf', fontBoldBase64H);
      doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
    }
  }
  const BODY_FONT = hasFont ? 'DejaVuSans' : 'helvetica';
  const BOLD_FONT_H = hasFont ? 'DejaVuSans' : 'helvetica';
  const tblBody   = hasFont ? { font: 'DejaVuSans', fontStyle: 'normal' } : {};
  const str       = hasFont ? (s) => (s ?? '') : ascii;

  // FAZ 22.3: aktif dile göre etiketler (karışık-dil önlenir).
  const lang = getSettings().language === 'en' ? 'en' : 'tr';
  const L = (tr, en) => (lang === 'en' ? en : tr);

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  let y = margin;

  // Başlık
  doc.setFontSize(15);
  doc.setFont(BOLD_FONT_H, 'bold');
  doc.setTextColor(29, 78, 216);
  doc.text(str(L('Sürü Özet Raporu — Toplu Rasyon Optimizasyonu', 'Herd Summary Report — Batch Ration Optimization')), pageWidth / 2, y, { align: 'center' });
  y += 7;

  doc.setFontSize(8);
  doc.setFont(BODY_FONT, 'normal');
  doc.setTextColor(100);
  doc.text(`NRC 2001 / NASEM 2021 / CNCPS v6.5 | ${new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR')} | ${batchResults.length} ${L('profil', 'profiles')}`,
    pageWidth / 2, y, { align: 'center' });
  y += 8;

  // Toplam özet
  const feasibleCount = batchResults.filter(r => r.result?.feasible).length;
  const totalAnimals  = batchResults.reduce((s, r) => s + (r.groupSize || 1), 0);
  const totalDailyFeedCost = batchResults.reduce(
    (s, r) => s + (r.economics ? r.economics.daily.feedCost_tl * (r.groupSize || 1) : 0), 0
  );
  const totalDailyIOFC = batchResults.reduce(
    (s, r) => s + (r.economics?.herd?.dailyIOFC_tl ?? 0), 0
  );

  doc.setFontSize(10);
  doc.setFont(BODY_FONT, 'normal');
  doc.setTextColor(40);
  const locale = lang === 'en' ? 'en-GB' : 'tr-TR';
  const summary = [
    [str(L('Optimize Edilen Profil', 'Optimized Profiles')), `${batchResults.length}`],
    [str(L('Fizibil Çözüm', 'Feasible Solutions')),          `${feasibleCount} / ${batchResults.length}`],
    [str(L('Toplam Hayvan', 'Total Animals')),          `${totalAnimals} ${L('baş', 'head')}`],
    [str(L('Günlük Toplam Yem Mlt.', 'Total Daily Feed Cost')), `${totalDailyFeedCost.toLocaleString(locale, { maximumFractionDigits: 0 })} TL`],
    [str(L('Günlük Toplam IOFC', 'Total Daily IOFC')),     `${totalDailyIOFC.toLocaleString(locale, { maximumFractionDigits: 0 })} TL`],
    [str(L('Yıllık IOFC (305 gün)', 'Annual IOFC (305 d)')),  `${(totalDailyIOFC * 305).toLocaleString(locale, { maximumFractionDigits: 0 })} TL`],
    [str(L('Süt Fiyatı', 'Milk Price')),             `${meta.milkPrice_tl ?? 18} ${L('TL/litre', 'TL/liter')}`],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: summary,
    styles: { fontSize: 9, cellPadding: 1.8, ...tblBody },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 }, 1: { halign: 'right' } },
    theme: 'plain',
  });
  y = doc.lastAutoTable.finalY + 5;

  // Karşılaştırmalı tablo
  const STAGE_MAP = {
    tr: { early: 'Erken Lakt', mid: 'Orta Lakt', late: 'Geç Lakt', far_off: 'Kuru Far-off', close_up: 'Yakın Kuru' },
    en: { early: 'Early Lact', mid: 'Mid Lact', late: 'Late Lact', far_off: 'Dry Far-off', close_up: 'Close-up' },
  };
  const STAGE = STAGE_MAP[lang];
  const rows = batchResults.map(r => {
    if (r.error || !r.result) {
      return [
        str(r.profile.name || r.profile.id),
        str(r.groupName || '—'),
        str(STAGE[r.profile.lactationStage] || '—'),
        `${r.profile.milkYield ?? '—'}`,
        '—', '—', '—', '—', '—',
        `${r.groupSize || 1}`,
        '—',
        str(r.error ? L('Hata', 'Error') : L('Infizibil', 'Infeasible')),
      ];
    }
    return [
      str(r.profile.name || r.profile.id),
      str(r.groupName || '—'),
      str(STAGE[r.profile.lactationStage] || STAGE.early),
      `${r.profile.milkYield}`,
      r.result.dmi.achieved_kg.toFixed(1),
      r.result.composition.nel_mcal.toFixed(1),
      r.result.composition.cp_pct.toFixed(1),
      r.result.composition.ndf_pct.toFixed(1),
      r.result.totalCost.toFixed(2),
      `${r.groupSize || 1}`,
      r.economics?.herd?.dailyIOFC_tl?.toLocaleString(locale, { maximumFractionDigits: 0 }) ?? '—',
      str(r.result.feasible ? 'OK' : L('Infizibil', 'Infeasible')),
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[
      str(L('Profil', 'Profile')), str(L('Grup', 'Group')), str(L('Dönem', 'Stage')), str(L('Süt kg', 'Milk kg')),
      str(L('KMT kg', 'DMI kg')), str('NEL'), 'CP%', 'NDF%',
      str(L('Yem ₺/g', 'Feed ₺/d')), str(L('Grup boy.', 'Grp size')), str(L('Grup IOFC ₺/g', 'Grp IOFC ₺/d')), str(L('Durum', 'Status')),
    ]],
    body: rows,
    styles: { fontSize: 7, cellPadding: 1.2, ...tblBody },
    headStyles: { fillColor: [29, 78, 216], textColor: 255, fontSize: 7.5 },
    columnStyles: {
      3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
      9: { halign: 'right' }, 10: { halign: 'right' },
    },
  });
  y = doc.lastAutoTable.finalY + 5;

  // Alt bilgi
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(L(`Süt Sığırı Rasyon Programı — Sayfa ${p} / ${pageCount}`, `Dairy Cattle Ration Program — Page ${p} / ${pageCount}`),
      pageWidth / 2, doc.internal.pageSize.getHeight() - 7, { align: 'center' });
  }

  return doc;
}

export async function downloadHerdSummaryPDF(batchResults, meta = {}, filename) {
  const doc = await generateHerdSummaryPDF(batchResults, meta);
  const name = filename || `surusozet_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(name);
}
