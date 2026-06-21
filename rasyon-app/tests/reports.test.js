/**
 * FAZ 6 — PDF/Excel raporlama testleri
 * Sadece üretim/yapı testleri; içerik validation
 */

import { describe, it, expect } from 'vitest';
import { generateRationPDF, generateHerdSummaryPDF } from '../src/reports/pdfExport.js';
import { generateRationExcel } from '../src/reports/excelExport.js';

const ANIMAL = {
  bw: 650, milkYield: 35, milkFat: 3.5, milkProtein: 3.1,
  parity: 2, dim: 90, bcs: 3.0, pregnant: false,
  lactationStage: 'early',
};

const SAMPLE_RESULT = {
  feasible: true,
  status: 5,
  statusName: 'optimal',
  totalCost: 87.50,
  dmi: { target_kg: 23.48, achieved_kg: 23.48, method: 'NRC2001', heatAdjusted: false },
  items: [
    { id: 'silage', name: 'Mısır Silajı', category: 'roughage',
      dmKg: 12.0, asFedKg: 36.4, pctDm: 51.1, costPerDay: 30.0 },
    { id: 'hay', name: 'Yonca Kuru Otu', category: 'roughage',
      dmKg: 4.5, asFedKg: 5.1, pctDm: 19.2, costPerDay: 30.6 },
    { id: 'corn', name: 'Mısır Tane', category: 'grain',
      dmKg: 2.5, asFedKg: 2.8, pctDm: 10.6, costPerDay: 25.2 },
    { id: 'soy', name: 'Soya Küspesi', category: 'protein',
      dmKg: 4.4, asFedKg: 4.9, pctDm: 18.7, costPerDay: 88.2 },
  ],
  composition: {
    nel_mcal: 39.7, cp_g: 4467, cp_pct: 19.0, rup_g: 1340, rdp_g: 3127,
    ndf_pct: 35.3, adf_pct: 22.1, aNDF_pct: 33.5, nfc_pct: 33.5,
    starch_pct: 22.0, sugar_pct: 4.0, fat_pct: 3.5, ash_pct: 7.5,
    peNDF_pct: 32.0, forage_pct: 70.0, dcad_meq: 21.7,
    ca_g: 122.9, p_g: 80.0, mg_g: 60.0, k_g: 327.0, na_g: 30.0, s_g: 47.0, cl_g: 35.0,
  },
  diagnostics: [
    { name: 'NEL (Mcal/gün)', value: 39.7, min: 34.3, max: undefined, status: 'ok' },
    { name: 'CP (%KM)',       value: 19.0, min: 15.5, max: 19.0,      status: 'ok' },
    { name: 'NDF (%KM)',      value: 35.3, min: 28,   max: 38,        status: 'ok' },
  ],
  requirements: {
    nel: { total: 34.3 },
    mp:  { total: 2109 },
    minerals: {},
    compositionTargets: {
      cp_pct: { min: 15.5, max: 19.0 },
      ndf_pct: { min: 28, max: 38 },
      forage_pct: { min: 40, max: 70 },
    },
  },
  aminoAcids: {
    supply: {
      lys: { total_g: 136.5, fromMCP_g: 100, fromRUP_g: 36.5, pctMP: 6.47 },
      met: { total_g: 43.7,  fromMCP_g: 33.5, fromRUP_g: 10.1, pctMP: 2.07 },
      lysMet_ratio: 3.13, mpTotal_g: 2109,
    },
    requirement: { lys_g: 147.6, met_g: 54.8, ratio: 2.69 },
    assessment: {
      lys: { supplied_g: 136.5, required_g: 147.6, deficit_g: 11.1, pctMP: 6.47, targetPctMP: 7, status: 'marginal' },
      met: { supplied_g: 43.7,  required_g: 54.8,  deficit_g: 11.1, pctMP: 2.07, targetPctMP: 2.6, status: 'deficient' },
      ratio: { actual: 3.13, target: 2.6, status: 'ok' },
      overallScore: 55,
    },
    rupProfile: { lysPct: 5.41, metPct: 1.5 },
    recommendations: [
      { type: 'RPMet', name: 'Rumen korumalı metiyonin', deficitG: 11.1, note: 'HMBi veya Smartamine M' },
      { type: 'RPLys', name: 'Rumen korumalı lizin',     deficitG: 11.1, note: 'AjiPro-L' },
    ],
  },
};

describe('PDF rapor üretimi (FAZ 6)', () => {
  it('generateRationPDF → jsPDF nesnesi döner', async () => {
    const doc = await generateRationPDF({ animal: ANIMAL, result: SAMPLE_RESULT });
    expect(doc).toBeDefined();
    expect(typeof doc.save).toBe('function');
    expect(typeof doc.output).toBe('function');
  });

  it('PDF en az 1 sayfa üretir', async () => {
    const doc = await generateRationPDF({ animal: ANIMAL, result: SAMPLE_RESULT });
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('PDF arraybuffer çıkışı verir', async () => {
    const doc = await generateRationPDF({ animal: ANIMAL, result: SAMPLE_RESULT });
    const buf = doc.output('arraybuffer');
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('AA paneli olmadan da çalışır', async () => {
    const r = { ...SAMPLE_RESULT, aminoAcids: null };
    const doc = await generateRationPDF({ animal: ANIMAL, result: r });
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('infizibil rasyon için de PDF üretebilir', async () => {
    const r = { ...SAMPLE_RESULT, feasible: false, statusName: 'no_feasible' };
    const doc = await generateRationPDF({ animal: ANIMAL, result: r });
    expect(doc).toBeDefined();
  });

  it('Özel başlık geçilebilir', async () => {
    const doc = await generateRationPDF({
      animal: ANIMAL, result: SAMPLE_RESULT,
      title: 'Test Çiftliği Rasyonu',
    });
    expect(doc).toBeDefined();
  });
});

describe('Excel rapor üretimi (FAZ 6)', () => {
  it('generateRationExcel → workbook döner', () => {
    const wb = generateRationExcel({ animal: ANIMAL, result: SAMPLE_RESULT });
    expect(wb).toBeDefined();
    expect(wb.SheetNames).toBeDefined();
  });

  it('5 sheet üretir (AA dahil)', () => {
    const wb = generateRationExcel({ animal: ANIMAL, result: SAMPLE_RESULT });
    expect(wb.SheetNames).toEqual(['Özet', 'Rasyon', 'Diagnostik', 'Besin Profili', 'AA Paneli']);
  });

  it('AA yoksa 4 sheet üretir', () => {
    const r = { ...SAMPLE_RESULT, aminoAcids: null };
    const wb = generateRationExcel({ animal: ANIMAL, result: r });
    expect(wb.SheetNames).toEqual(['Özet', 'Rasyon', 'Diagnostik', 'Besin Profili']);
  });

  it('Rasyon sheet\'i yem sayısı + 2 satır içerir (başlık + toplam)', () => {
    const wb = generateRationExcel({ animal: ANIMAL, result: SAMPLE_RESULT });
    const sheet = wb.Sheets['Rasyon'];
    const aoa = require('xlsx').utils.sheet_to_json(sheet, { header: 1 });
    expect(aoa.length).toBe(SAMPLE_RESULT.items.length + 2);
  });

  it('Diagnostik sheet\'i kısıt sayısı + 1 satır içerir', () => {
    const wb = generateRationExcel({ animal: ANIMAL, result: SAMPLE_RESULT });
    const sheet = wb.Sheets['Diagnostik'];
    const aoa = require('xlsx').utils.sheet_to_json(sheet, { header: 1 });
    expect(aoa.length).toBe(SAMPLE_RESULT.diagnostics.length + 1);
  });
});

describe('Sürü Özet PDF (FAZ 6 plan #4)', () => {
  const BATCH_RESULTS = [
    {
      profile: { id: 'p1', name: 'İnek-1', lactationStage: 'early', milkYield: 40, bw: 650 },
      result: SAMPLE_RESULT,
      economics: {
        daily: { feedCost_tl: 87, revenue_tl: 720, iofc_tl: 633, feedCostPerLiter_tl: 2.18, feedEfficiency: 1.7 },
        herd:  { dailyIOFC_tl: 6330, monthlyIOFC_tl: 189900, annualIOFC_tl: 1930650 },
        annual: { milkRevenue_tl: 219600, iofc_tl: 193065 },
        status: { level: 'good', label: 'İyi', message: 'OK' },
      },
      groupName: 'Yüksek Verim', groupSize: 10, error: null,
    },
    {
      profile: { id: 'p2', name: 'İnek-2', lactationStage: 'mid', milkYield: 25, bw: 600 },
      result: SAMPLE_RESULT,
      economics: {
        daily: { feedCost_tl: 65, revenue_tl: 450, iofc_tl: 385, feedCostPerLiter_tl: 2.6, feedEfficiency: 1.4 },
        herd:  { dailyIOFC_tl: 1925, monthlyIOFC_tl: 57750, annualIOFC_tl: 587125 },
        annual: { milkRevenue_tl: 137250, iofc_tl: 117425 },
        status: { level: 'good', label: 'İyi', message: 'OK' },
      },
      groupName: 'Orta Lakt', groupSize: 5, error: null,
    },
  ];

  it('generateHerdSummaryPDF → jsPDF nesnesi döner', async () => {
    const doc = await generateHerdSummaryPDF(BATCH_RESULTS, { milkPrice_tl: 18 });
    expect(doc).toBeDefined();
    expect(typeof doc.save).toBe('function');
  });

  it('Sürü PDF en az 1 sayfa üretir', async () => {
    const doc = await generateHerdSummaryPDF(BATCH_RESULTS, { milkPrice_tl: 18 });
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('Boş sonuç dizisi için bile hata vermez', async () => {
    const doc = await generateHerdSummaryPDF([], { milkPrice_tl: 18 });
    expect(doc).toBeDefined();
  });

  it('Hatalı profil olan karma dizide de çalışır', async () => {
    const mixed = [...BATCH_RESULTS, {
      profile: { id: 'p3', name: 'Hatalı', lactationStage: 'late', milkYield: 18 },
      result: null, economics: null, groupName: 'Geç', groupSize: 3,
      error: 'Infizibil çözüm bulunamadı',
    }];
    const doc = await generateHerdSummaryPDF(mixed, { milkPrice_tl: 18 });
    expect(doc).toBeDefined();
  });
});

describe('TMR Karıştırma Talimatı (FAZ 6 plan #2)', () => {
  it('PDF üretiminde hata vermez (kategori bazlı sıralama)', async () => {
    const result = {
      ...SAMPLE_RESULT,
      items: [
        { id: 'min', name: 'Premiks', category: 'mineral',  dmKg: 0.5, asFedKg: 0.5, pctDm: 2, costPerDay: 5 },
        { id: 'pro', name: 'Soya',    category: 'protein',  dmKg: 4,   asFedKg: 4.4, pctDm: 17, costPerDay: 80 },
        { id: 'gra', name: 'Mısır',   category: 'grain',    dmKg: 6,   asFedKg: 6.8, pctDm: 27, costPerDay: 60 },
        { id: 'rou', name: 'Silaj',   category: 'roughage', dmKg: 12,  asFedKg: 36, pctDm: 54, costPerDay: 30 },
      ],
    };
    const doc = await generateRationPDF({ animal: ANIMAL, result });
    expect(doc).toBeDefined();
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
