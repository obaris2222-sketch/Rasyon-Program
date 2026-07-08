/**
 * Excel Export — SheetJS (xlsx)
 * Çok-sheet'li rasyon raporu
 * FAZ 22.3: dil-tutarlı export — aktif dile (TR/EN) göre etiketler + yem adları
 * (karışık-dil riski olmadan). Dil-nötr kısaltmalar (NEL/NDF/Ca/DCAD…) korunur.
 */

import * as XLSX from 'xlsx-js-style';
import { getSettings } from '../data/settings.js';

const STAGE_LABELS = {
  tr: { early: 'Erken Laktasyon', mid: 'Orta Laktasyon', late: 'Geç Laktasyon', far_off: 'Kuru — Far-off', close_up: 'Yakın Kuru — Close-up (Anyonik)' },
  en: { early: 'Early Lactation', mid: 'Mid Lactation', late: 'Late Lactation', far_off: 'Dry — Far-off', close_up: 'Close-up (Anionic)' },
};

const STATUS_LABELS = {
  tr: { ok: 'Tamam', below: 'Düşük', above: 'Yüksek', optimal: 'Optimal', marginal: 'Marjinal', deficient: 'Eksik', excess: 'Fazla', below_target: 'Hedef Altı' },
  en: { ok: 'OK', below: 'Low', above: 'High', optimal: 'Optimal', marginal: 'Marginal', deficient: 'Deficient', excess: 'Excess', below_target: 'Below Target' },
};

// FAZ 22.3 denetim: yem kategorisi de dil-tutarlı (eskiden ham 'roughage' anahtarı görünüyordu).
const CATEGORY_LABELS = {
  tr: { roughage: 'Kaba Yem', grain: 'Tahıl/Konsantre', protein: 'Protein', byproduct: 'Yan Ürün', fat: 'Yağ', mineral: 'Mineral/Katkı' },
  en: { roughage: 'Forage', grain: 'Grain/Concentrate', protein: 'Protein', byproduct: 'By-product', fat: 'Fat', mineral: 'Mineral/Additive' },
};

/**
 * Rasyon sonucundan çok-sheet'li Excel workbook üretir.
 * @returns {XLSX.WorkBook}
 */
export function generateRationExcel({ animal, result }) {
  const lang = getSettings().language === 'en' ? 'en' : 'tr';
  const L = (tr, en) => (lang === 'en' ? en : tr);
  const feedName = (it) => (lang === 'en' && it.nameEn ? it.nameEn : it.name) || '';
  const stageLabel = STAGE_LABELS[lang][animal.lactationStage] || STAGE_LABELS[lang].early;
  const statusLabel = (s) => STATUS_LABELS[lang][s] || s;
  const catLabel = (c) => CATEGORY_LABELS[lang][c] || c;

  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: Özet ─────────────────────────────────────────────────────────
  const summaryData = [
    [L('SÜT SIĞIRI RASYON RAPORU', 'DAIRY CATTLE RATION REPORT')],
    [L('Tarih', 'Date'), new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR')],
    [L('Kaynak', 'Source'), 'NRC 2001 / NASEM 2021 / CNCPS v6.5'],
    [],
    [L('HAYVAN PROFİLİ', 'ANIMAL PROFILE')],
    [L('Canlı Ağırlık (kg)', 'Body Weight (kg)'),  animal.bw],
    [L('Süt Verimi (kg/gün)', 'Milk Yield (kg/d)'), animal.milkYield],
    [L('Süt Yağı (%)', 'Milk Fat (%)'),        animal.milkFat],
    [L('Süt Proteini (%)', 'Milk Protein (%)'),    animal.milkProtein],
    [L('Parite', 'Parity'),              animal.parity],
    [L('Laktasyon Günü (DIM)', 'Days in Milk (DIM)'), animal.dim],
    ['BCS',                 animal.bcs],
    [L('Dönem', 'Stage'),               stageLabel],
    [L('Gebe mi?', 'Pregnant?'),            animal.pregnant ? L(`Evet (${animal.pregnancyMonth}. ay)`, `Yes (month ${animal.pregnancyMonth})`) : L('Hayır', 'No')],
    ['THI',                 animal.thi ?? L('Belirtilmedi', 'Not specified')],
    [],
    [L('SONUÇ DURUMU', 'RESULT STATUS')],
    [L('Fizibil mi?', 'Feasible?'),         result.feasible ? L('EVET', 'YES') : L('HAYIR', 'NO')],
    ['LP Status',           result.statusName],
    [],
    [L('ÖZET METRİKLER', 'SUMMARY METRICS')],
    [L('KM (kg/gün)', 'DM (kg/d)'),         result.dmi.achieved_kg],
    [L('Hedef KMT (kg/gün)', 'Target DMI (kg/d)'),  result.dmi.target_kg],
    [L('KMT Yöntemi', 'DMI Method'),         result.dmi.method],
    [L('NEL (Mcal/gün)', 'NEL (Mcal/d)'),      result.composition.nel_mcal],
    [L('HP (%KM)', 'CP (%DM)'),            result.composition.cp_pct],
    [L('MP (g/gün)', 'MP (g/d)'),          Math.round(result.composition.mp_g || 0)],
    [L('NDF (%KM)', 'NDF (%DM)'),           result.composition.ndf_pct],
    [L('Maliyet (₺/gün)', 'Cost (₺/d)'),     result.totalCost],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 35 }, { wch: 30 }];
  
  // Özet tablosunda başlıkları renklendir
  const summaryRange = XLSX.utils.decode_range(wsSummary['!ref']);
  for (let R = summaryRange.s.r; R <= summaryRange.e.r; ++R) {
    for (let C = summaryRange.s.c; C <= summaryRange.e.c; ++C) {
      const cell = wsSummary[XLSX.utils.encode_cell({c: C, r: R})];
      if (!cell) continue;
      
      // İlk satır ana başlık
      if (R === 0 && C === 0) {
        cell.s = { font: { bold: true, sz: 14, color: { rgb: "000000" } } };
      }
      
      // Bölüm Başlıkları (Tamamı büyük harf ve altı boşsa genelde başlık olur)
      if (typeof cell.v === 'string' && cell.v === cell.v.toUpperCase() && cell.v.length > 5) {
        cell.s = {
          fill: { fgColor: { rgb: "D9D9D9" } },
          font: { bold: true },
          border: { bottom: { style: "thin", color: { rgb: "000000" } } }
        };
      }
      
      // Sol Sütun Kalın
      if (C === 0 && (!cell.s || !cell.s.font)) {
        cell.s = { font: { bold: true } };
      }
    }
  }
  
  XLSX.utils.book_append_sheet(wb, wsSummary, L('Özet', 'Summary'));

  // ─── Sheet 2: Rasyon Bileşenleri ───────────────────────────────────────────
  const itemsHeader = [L('Yem', 'Feed'), L('Kategori', 'Category'), L('KM (kg/gün)', 'DM (kg/d)'), L('Yaş (kg/gün)', 'As-fed (kg/d)'), L('% KM', '% DM'), '₺/' + L('gün', 'd')];
  const itemsRows = result.items.map(it => [
    feedName(it), catLabel(it.category), it.dmKg, it.asFedKg, it.pctDm, it.costPerDay,
  ]);
  const totalDm = result.items.reduce((s, i) => s + i.dmKg, 0);
  const totalAsFed = result.items.reduce((s, i) => s + i.asFedKg, 0);
  const totalCost = result.items.reduce((s, i) => s + i.costPerDay, 0);
  itemsRows.push([L('TOPLAM', 'TOTAL'), '', totalDm, totalAsFed, 100, totalCost]);
  
  const wsItems = XLSX.utils.aoa_to_sheet([
    [L('RASYON BİLEŞENLERİ', 'RATION COMPONENTS')],
    itemsHeader, 
    ...itemsRows
  ]);
  
  wsItems['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  wsItems['!cols'] = [{ wch: 35 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 }];
  wsItems['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft' }];
  
  const rangeItems = XLSX.utils.decode_range(wsItems['!ref']);
  wsItems['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: rangeItems.e }) };

  for (let R = rangeItems.s.r; R <= rangeItems.e.r; ++R) {
    for (let C = rangeItems.s.c; C <= rangeItems.e.c; ++C) {
      const cell = wsItems[XLSX.utils.encode_cell({c: C, r: R})];
      if (!cell) continue;
      
      const borderStyle = {
        top: { style: "thin", color: { rgb: "BFBFBF" } }, bottom: { style: "thin", color: { rgb: "BFBFBF" } },
        left: { style: "thin", color: { rgb: "BFBFBF" } }, right: { style: "thin", color: { rgb: "BFBFBF" } }
      };

      if (R === 0) {
        cell.s = { fill: { fgColor: { rgb: "1F497D" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 }, alignment: { horizontal: "center", vertical: "center" } };
      } else if (R === 1) {
        cell.s = { fill: { fgColor: { rgb: "4F81BD" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center" }, border: { bottom: { style: "medium", color: { rgb: "000000" } }, ...borderStyle } };
      } else {
        const isEven = (R % 2 === 0);
        cell.s = { fill: { fgColor: { rgb: isEven ? "F2F2F2" : "FFFFFF" } }, border: borderStyle, alignment: { vertical: "center" } };
        if (C === 5 && cell.t === 'n') cell.z = '#,##0.00_"₺"'; // Fiyat formatı
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, wsItems, L('Rasyon', 'Ration'));

  // ─── Sheet 3: Diagnostik ───────────────────────────────────────────────────
  const diagHeader = [L('Kısıt', 'Constraint'), L('Değer', 'Value'), 'Min', L('Maks', 'Max'), L('Durum', 'Status')];
  const diagRows = result.diagnostics.map(d => [
    d.name, d.value,
    d.min ?? '—',
    d.max ?? '—',
    statusLabel(d.status),
  ]);
  const wsDiag = XLSX.utils.aoa_to_sheet([
    [L('DİAGNOSTİK (KISITLAR)', 'DIAGNOSTICS (CONSTRAINTS)')],
    diagHeader, 
    ...diagRows
  ]);
  
  wsDiag['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  wsDiag['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 18 }];
  wsDiag['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft' }];
  
  const rangeDiag = XLSX.utils.decode_range(wsDiag['!ref']);
  wsDiag['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: rangeDiag.e }) };
  
  for (let R = rangeDiag.s.r; R <= rangeDiag.e.r; ++R) {
    for (let C = rangeDiag.s.c; C <= rangeDiag.e.c; ++C) {
      const cell = wsDiag[XLSX.utils.encode_cell({c: C, r: R})];
      if (!cell) continue;
      
      const borderStyle = {
        top: { style: "thin", color: { rgb: "BFBFBF" } }, bottom: { style: "thin", color: { rgb: "BFBFBF" } },
        left: { style: "thin", color: { rgb: "BFBFBF" } }, right: { style: "thin", color: { rgb: "BFBFBF" } }
      };

      if (R === 0) {
        cell.s = { fill: { fgColor: { rgb: "1F497D" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 }, alignment: { horizontal: "center", vertical: "center" } };
      } else if (R === 1) {
        cell.s = { fill: { fgColor: { rgb: "4F81BD" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center" }, border: { bottom: { style: "medium", color: { rgb: "000000" } }, ...borderStyle } };
      } else {
        const isEven = (R % 2 === 0);
        cell.s = { fill: { fgColor: { rgb: isEven ? "F2F2F2" : "FFFFFF" } }, border: borderStyle, alignment: { vertical: "center" } };
      }
    }
  }
  
  XLSX.utils.book_append_sheet(wb, wsDiag, L('Diagnostik', 'Diagnostics'));

  // ─── Sheet 4: Tam Besin Profili ────────────────────────────────────────────
  const c = result.composition;
  const UDM = L('% KM', '% DM'); const UGD = L('g/gün', 'g/d');
  const profile = [
    [L('Besin Maddesi', 'Nutrient'), L('Değer', 'Value'), L('Birim', 'Unit')],
    ['NEL',          c.nel_mcal,   L('Mcal/gün', 'Mcal/d')],
    [L('HP', 'CP'),  c.cp_g,       UGD],
    [L('HP', 'CP'),  c.cp_pct,     UDM],
    ['MP',           c.mp_g || 0,  UGD],
    ['RUP',          c.rup_g,      UGD],
    ['RDP',          c.rdp_g,      UGD],
    ['NDF',          c.ndf_pct,    UDM],
    ['ADF',          c.adf_pct,    UDM],
    ['aNDF',         c.aNDF_pct,   UDM],
    ['NFC',          c.nfc_pct,    UDM],
    [L('Nişasta', 'Starch'),  c.starch_pct, UDM],
    [L('Şeker', 'Sugar'),     c.sugar_pct,  UDM],
    [L('Yağ', 'Fat'),         c.fat_pct,    UDM],
    [L('Kül', 'Ash'),         c.ash_pct,    UDM],
    ['peNDF',        c.peNDF_pct,  UDM],
    [L('Kaba yem', 'Forage'), c.forage_pct, UDM],
    ['DCAD',         c.dcad_meq,   L('mEq/100g KM', 'mEq/100g DM')],
    ['Ca',           c.ca_g,       UGD],
    ['P',            c.p_g,        UGD],
    ['Mg',           c.mg_g,       UGD],
    ['K',            c.k_g,        UGD],
    ['Na',           c.na_g,       UGD],
    ['S',            c.s_g,        UGD],
    ['Cl',           c.cl_g,       UGD],
  ];
  const wsProfile = XLSX.utils.aoa_to_sheet([
    [L('TAM BESİN PROFİLİ', 'FULL NUTRIENT PROFILE')],
    ...profile
  ]);
  
  wsProfile['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  wsProfile['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 18 }];
  wsProfile['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft' }];
  
  const rangeProf = XLSX.utils.decode_range(wsProfile['!ref']);
  wsProfile['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: rangeProf.e }) };
  
  for (let R = rangeProf.s.r; R <= rangeProf.e.r; ++R) {
    for (let C = rangeProf.s.c; C <= rangeProf.e.c; ++C) {
      const cell = wsProfile[XLSX.utils.encode_cell({c: C, r: R})];
      if (!cell) continue;
      
      const borderStyle = {
        top: { style: "thin", color: { rgb: "BFBFBF" } }, bottom: { style: "thin", color: { rgb: "BFBFBF" } },
        left: { style: "thin", color: { rgb: "BFBFBF" } }, right: { style: "thin", color: { rgb: "BFBFBF" } }
      };

      if (R === 0) {
        cell.s = { fill: { fgColor: { rgb: "1F497D" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 }, alignment: { horizontal: "center", vertical: "center" } };
      } else if (R === 1) {
        cell.s = { fill: { fgColor: { rgb: "4F81BD" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center" }, border: { bottom: { style: "medium", color: { rgb: "000000" } }, ...borderStyle } };
      } else {
        const isEven = (R % 2 === 0);
        cell.s = { fill: { fgColor: { rgb: isEven ? "F2F2F2" : "FFFFFF" } }, border: borderStyle, alignment: { vertical: "center" } };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, wsProfile, L('Besin Profili', 'Nutrient Profile'));

  // ─── Sheet 5: AA Paneli ────────────────────────────────────────────────────
  if (result.aminoAcids) {
    const aa = result.aminoAcids;
    // Tam EAA: 10 AA tablosu (Lys/Met/His sınırlayıcı + 7 EAA gösterim)
    const AA_XL = [
      ['lys', L('Lizin (Lys)', 'Lysine (Lys)')], ['met', L('Metiyonin (Met)', 'Methionine (Met)')], ['his', L('Histidin (His)', 'Histidine (His)')],
      ['arg', L('Arginin (Arg)', 'Arginine (Arg)')], ['thr', L('Treonin (Thr)', 'Threonine (Thr)')], ['ile', L('İzolösin (Ile)', 'Isoleucine (Ile)')],
      ['leu', L('Lösin (Leu)', 'Leucine (Leu)')], ['val', L('Valin (Val)', 'Valine (Val)')], ['phe', L('Fenilalanin (Phe)', 'Phenylalanine (Phe)')], ['trp', L('Triptofan (Trp)', 'Tryptophan (Trp)')],
    ];
    const aaTableRows = [];
    for (const [k, name] of AA_XL) {
      const st = aa.assessment[k];
      if (!st) continue;
      const sup = aa.supply[k];
      aaTableRows.push([name, sup.total_g, st.required_g ?? '—', sup.pctMP, st.targetPctMP,
        statusLabel(st.status)]);
    }
    const fl = aa.assessment.firstLimiting;
    const aaData = [
      [L('AMİNO ASİT DENGESİ', 'AMINO ACID BALANCE')],
      [],
      [L('Genel Skor', 'Overall Score'), aa.assessment.overallScore, '/ 100'],
      [L('Lys : Met Oranı', 'Lys : Met Ratio'), aa.assessment.ratio.actual ?? '—', L(`Hedef ≥ ${aa.assessment.ratio.target}`, `Target ≥ ${aa.assessment.ratio.target}`)],
      fl ? [L('İlk sınırlayıcı AA', 'First-limiting AA'), (fl.aa || '').toUpperCase(), L(`%${fl.pctOfTarget} hedef`, `${fl.pctOfTarget}% of target`)] : [],
      [],
      ['AA', L('Tedarik (g/gün)', 'Supply (g/d)'), L('Gereksinim (g/gün)', 'Requirement (g/d)'), L('% MP', '% MP'), L('Hedef % MP', 'Target % MP'), L('Durum', 'Status')],
      ...aaTableRows,
      [],
      [L('DETAYLI TEDARİK KIRILIMI (Lys/Met/His)', 'DETAILED SUPPLY BREAKDOWN (Lys/Met/His)')],
      [L('Lys mikrobiyal (g)', 'Lys microbial (g)'), aa.supply.lys.fromMCP_g],
      [L('Lys RUP (g)', 'Lys RUP (g)'),        aa.supply.lys.fromRUP_g],
      [L('Met mikrobiyal (g)', 'Met microbial (g)'), aa.supply.met.fromMCP_g],
      [L('Met RUP (g)', 'Met RUP (g)'),        aa.supply.met.fromRUP_g],
      [L('His mikrobiyal (g)', 'His microbial (g)'), aa.supply.his?.fromMCP_g ?? '—'],
      [L('His RUP (g)', 'His RUP (g)'),        aa.supply.his?.fromRUP_g ?? '—'],
      [L('RUP profili Lys %', 'RUP profile Lys %'),  aa.rupProfile.lysPct],
      [L('RUP profili Met %', 'RUP profile Met %'),  aa.rupProfile.metPct],
      [],
      [L('Not', 'Note'), L('Arg/Thr/Ile/Leu/Val/Phe/Trp gösterim amaçlıdır (nadiren sınırlayıcı); formülasyon Lys/Met/His ile yönetilir. EAA değerleri başlıca türlerde NRC 2001 Tablo 15-1 tip-profili.', 'Arg/Thr/Ile/Leu/Val/Phe/Trp are display-only (rarely limiting); formulation is driven by Lys/Met/His. EAA values are NRC 2001 Table 15-1 type-profiles for major species.')],
    ];

    if (aa.recommendations.length > 0) {
      aaData.push([], [L('ÖNERİLER', 'RECOMMENDATIONS')]);
      for (const rec of aa.recommendations) {
        aaData.push([rec.name, L(`Eksik: ${rec.deficitG} g/gün`, `Deficit: ${rec.deficitG} g/d`), rec.note]);
      }
    }

    const wsAA = XLSX.utils.aoa_to_sheet(aaData);
    wsAA['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
    wsAA['!cols'] = [{ wch: 35 }, { wch: 22 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    wsAA['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 7, topLeftCell: 'A8', activePane: 'bottomLeft' }]; // AA tablosu başlığı 7. satırda (indeks 6)
    
    // Tasarım
    const rangeAA = XLSX.utils.decode_range(wsAA['!ref']);
    for (let R = rangeAA.s.r; R <= rangeAA.e.r; ++R) {
      for (let C = rangeAA.s.c; C <= rangeAA.e.c; ++C) {
        const cell = wsAA[XLSX.utils.encode_cell({c: C, r: R})];
        if (!cell) continue;

        if (R === 0 && C === 0) {
          // Ana Başlık
          cell.s = { fill: { fgColor: { rgb: "1F497D" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 }, alignment: { horizontal: "center", vertical: "center" } };
        } else if (R === 6) {
          // AA Tablosu Ana Başlıkları
          cell.s = { fill: { fgColor: { rgb: "4F81BD" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center" }, border: { bottom: { style: "medium", color: { rgb: "000000" } } } };
        } else if (R > 6 && R < 6 + aaTableRows.length + 1) {
          // AA Tablosu Zebra
          const isEven = (R % 2 === 0);
          cell.s = { fill: { fgColor: { rgb: isEven ? "F2F2F2" : "FFFFFF" } } };
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, wsAA, L('AA Paneli', 'AA Panel'));
  }

  return wb;
}

/**
 * Tarayıcıda Excel dosyasını indirir.
 */
export function downloadRationExcel({ animal, result, filename }) {
  const wb = generateRationExcel({ animal, result });
  const name = filename || `rasyon_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}
