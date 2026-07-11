/**
 * Rasyon Optimizer - Uçtan Uca Entegrasyon Testi
 * Gerçekçi hayvan profilleri + tipik Türkiye yemleriyle rasyon çözümü test eder.
 * 
 * Çalıştır: node --input-type=module tests/integration_test.mjs
 */

import { optimizeRation } from '../src/solver/rationOptimizer.js';

// ─── Renk kodları ───────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const YEL   = '\x1b[33m';
const CYAN  = '\x1b[36m';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';

function ok(msg)   { console.log(`  ${GREEN}✅ ${msg}${RESET}`); }
function fail(msg) { console.log(`  ${RED}❌ ${msg}${RESET}`); }
function warn(msg) { console.log(`  ${YEL}⚠️  ${msg}${RESET}`); }
function info(msg) { console.log(`  ${CYAN}ℹ  ${msg}${RESET}`); }
function header(msg){ console.log(`\n${BOLD}${msg}${RESET}`); }

let totalPass = 0, totalFail = 0;

function check(label, condition, detail = '') {
  if (condition) { ok(`${label}${detail ? ' — ' + detail : ''}`); totalPass++; }
  else           { fail(`${label}${detail ? ' — ' + detail : ''}`); totalFail++; }
}

// ─── Ortak yem seti (Türkiye tipik TMR) ─────────────────────────────────────
const FEEDS = [
  // Kaba yemler
  {
    id: 'corn_silage', name: 'Mısır Silajı', category: 'roughage',
    dm: 33, nel: 1.72, tdn: 71, cp: 8.2, rup: 15, rdp: 85, rupIntD: 62,
    ndf: 44, adf: 27, aNDF: 42, nfc: 36, starch: 27, sugar: 1.2,
    fat: 3.3, ash: 4.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05,
    na: 0.01, s: 0.11, cl: 0.09, fe: 230, zn: 20, cu: 4, mn: 25, se: 0.04,
    vitA: 0, vitD: 0, vitE: 18,
    lys: 2.7, met: 1.9, his: 1.9, pricePerTon: 800,
  },
  {
    id: 'alfalfa_hay', name: 'Yonca Kuru Otu', category: 'roughage',
    dm: 89, nel: 1.41, tdn: 60, cp: 18.5, rup: 22, rdp: 78, rupIntD: 78,
    ndf: 44, adf: 34, aNDF: 42, nfc: 21, starch: 2, sugar: 8,
    fat: 2.3, ash: 9.5, ca: 1.4, p: 0.26, mg: 0.3, k: 2.2,
    na: 0.09, s: 0.25, cl: 0.42, fe: 280, zn: 24, cu: 9, mn: 36, se: 0.1,
    vitA: 0, vitD: 0, vitE: 28,
    lys: 5.0, met: 1.6, his: 1.8, pricePerTon: 4500,
  },
  // Tahıllar
  {
    id: 'corn_grain', name: 'Mısır Tane', category: 'grain',
    dm: 88, nel: 2.01, tdn: 88, cp: 8.5, rup: 52, rdp: 48, rupIntD: 88,
    ndf: 9, adf: 4, aNDF: 8, nfc: 74, starch: 68, sugar: 2,
    fat: 3.5, ash: 1.3, ca: 0.03, p: 0.28, mg: 0.11, k: 0.37,
    na: 0.01, s: 0.11, cl: 0.05, fe: 22, zn: 22, cu: 3, mn: 7, se: 0.02,
    vitA: 0, vitD: 0, vitE: 8,
    lys: 2.7, met: 1.8, his: 2.3, pricePerTon: 9500,
  },
  // Protein kaynakları
  {
    id: 'soybean_meal', name: 'Soya Küspesi (44% HP)', category: 'protein',
    dm: 89, nel: 1.97, tdn: 84, cp: 44, rup: 35, rdp: 65, rupIntD: 92,
    ndf: 8, adf: 5, aNDF: 7, nfc: 29, starch: 1, sugar: 8,
    fat: 2.0, ash: 7.0, ca: 0.33, p: 0.65, mg: 0.28, k: 2.1,
    na: 0.04, s: 0.40, cl: 0.04, fe: 120, zn: 42, cu: 15, mn: 32, se: 0.1,
    vitA: 0, vitD: 0, vitE: 2,
    lys: 6.3, met: 1.4, his: 2.7, pricePerTon: 19000,
  },
  {
    id: 'cottonseed_meal', name: 'Pamuk Küspesi', category: 'protein',
    dm: 90, nel: 1.65, tdn: 71, cp: 41, rup: 42, rdp: 58, rupIntD: 54,
    ndf: 18, adf: 14, aNDF: 17, nfc: 21, starch: 1, sugar: 5,
    fat: 1.5, ash: 6.5, ca: 0.20, p: 1.10, mg: 0.45, k: 1.50,
    na: 0.06, s: 0.43, cl: 0.07, fe: 150, zn: 65, cu: 18, mn: 20, se: 0.05,
    vitA: 0, vitD: 0, vitE: 5,
    lys: 3.8, met: 1.5, his: 2.5, pricePerTon: 13000,
  },
  // Yağ kaynağı
  {
    id: 'palm_fat', name: 'Korumalı Yağ (Palm)', category: 'fat',
    dm: 99, nel: 4.50, tdn: 0, cp: 0, rup: 0, rdp: 0, rupIntD: 0,
    ndf: 0, adf: 0, aNDF: 0, nfc: 0, starch: 0, sugar: 0,
    fat: 99, ash: 0.5, ca: 0.5, p: 0, mg: 0, k: 0,
    na: 0, s: 0, cl: 0, fe: 0, zn: 0, cu: 0, mn: 0, se: 0,
    vitA: 0, vitD: 0, vitE: 0,
    lys: 0, met: 0, his: 0, pricePerTon: 25000,
  },
  // Mineral kaynağı
  {
    id: 'limestone', name: 'Kireçtaşı (Ca kaynağı)', category: 'mineral',
    dm: 99, nel: 0, tdn: 0, cp: 0, rup: 0, rdp: 0, rupIntD: 0,
    ndf: 0, adf: 0, aNDF: 0, nfc: 0, starch: 0, sugar: 0,
    fat: 0, ash: 98, ca: 38, p: 0, mg: 2, k: 0,
    na: 0, s: 0, cl: 0, fe: 0, zn: 0, cu: 0, mn: 0, se: 0,
    vitA: 0, vitD: 0, vitE: 0,
    lys: 0, met: 0, his: 0, pricePerTon: 800,
  },
];

// ─── Test 1: Yüksek verimli erken laktasyon ineği ───────────────────────────
async function test1_HighYieldEarlyLactation() {
  header('TEST 1: Yüksek Verimli Erken Laktasyon (40 kg süt, NASEM 2021)');

  const animal = {
    bw: 650, milkYield: 40, milkFat: 3.6, milkProtein: 3.1, milkLactose: 4.8,
    dim: 45, parity: 2, bcs: 3.0, targetBcs: 2.75,
    lactationStage: 'early', pregnant: false,
    thi: null, dailyWalkKm: 0,
  };

  const result = await optimizeRation({
    animal, feeds: FEEDS, system: 'NASEM2021', objective: 'cost',
    feedLimits: {
      corn_silage:    { min: 3, max: 12 },
      alfalfa_hay:    { min: 1, max: 5  },
      corn_grain:     { min: 0, max: 8  },
      soybean_meal:   { min: 0, max: 4  },
      cottonseed_meal:{ min: 0, max: 3  },
      palm_fat:       { min: 0, max: 0.5},
      limestone:      { min: 0, max: 0.3},
    },
  });

  printResult(result, animal, '40 kg süt — erken laktasyon');
  return result;
}

// ─── Test 2: Orta verimli mid laktasyon ────────────────────────────────────
async function test2_MidLactation() {
  header('TEST 2: Orta Verimli Mid Laktasyon (28 kg süt, NRC 2001)');

  const animal = {
    bw: 600, milkYield: 28, milkFat: 3.8, milkProtein: 3.3, milkLactose: 4.7,
    dim: 120, parity: 3, bcs: 3.25, targetBcs: 3.0,
    lactationStage: 'mid', pregnant: true, pregnancyMonth: 3,
    thi: null, dailyWalkKm: 0,
  };

  const result = await optimizeRation({
    animal, feeds: FEEDS, system: 'NRC2001', objective: 'cost',
    feedLimits: {
      corn_silage:    { min: 4 },
      alfalfa_hay:    { min: 1 },
      corn_grain:     { min: 0 },
      soybean_meal:   { min: 0 },
      cottonseed_meal:{ min: 0 },
      palm_fat:       { min: 0 },
      limestone:      { min: 0 },
    },
  });

  printResult(result, animal, '28 kg süt — mid laktasyon, 3. ay gebe');
  return result;
}

// ─── Test 3: Gebe kuru inek (close-up) ─────────────────────────────────────
async function test3_CloseUp() {
  header('TEST 3: Gebe Kuru İnek — Close-Up (doğuma 14 gün)');

  const animal = {
    bw: 700, milkYield: 0, milkFat: 0, milkProtein: 0, milkLactose: 0,
    dim: 14, parity: 3, bcs: 3.5, targetBcs: 3.25,
    lactationStage: 'close_up', pregnant: true,
    gestDays: 265,
    thi: null, dailyWalkKm: 0,
  };

  const result = await optimizeRation({
    animal, feeds: FEEDS, system: 'NASEM2021', objective: 'cost',
    feedLimits: {
      corn_silage:  { min: 2, max: 10 },
      alfalfa_hay:  { min: 2, max: 8 },
      corn_grain:   { min: 0, max: 3 },
      soybean_meal: { min: 0, max: 2 },
      cottonseed_meal:{ max: 0.001 },
      limestone:    { min: 0, max: 0.3 },
    },
  });

  printResult(result, animal, 'Close-up, gün 265, gebelik MP doğru mu?');
  return result;
}

// ─── Test 4: Isı stresi altında yüksek verim ───────────────────────────────
async function test4_HeatStress() {
  header('TEST 4: Isı Stresi (THI=78) — Yüksek Verim');

  const animal = {
    bw: 620, milkYield: 35, milkFat: 3.4, milkProtein: 3.0, milkLactose: 4.8,
    dim: 60, parity: 2, bcs: 2.9, targetBcs: 2.75,
    lactationStage: 'early', pregnant: false,
    thi: 78, dailyWalkKm: 0, ambientTemp: 30,
  };

  const result = await optimizeRation({
    animal, feeds: FEEDS, system: 'NASEM2021', objective: 'cost',
    feedLimits: {
      corn_silage:    { min: 3, max: 12 },
      alfalfa_hay:    { min: 1, max: 4  },
      corn_grain:     { min: 0, max: 5  },
      soybean_meal:   { min: 0, max: 4  },
      palm_fat:       { min: 0, max: 0.5},
      limestone:      { min: 0, max: 0.3},
    },
  });

  printResult(result, animal, 'THI=78 — DMI düşük olmalı');
  return result;
}

// ─── Sonuç yazdırıcı ────────────────────────────────────────────────────────
function printResult(result, animal, label) {
  const { feasible, statusName, dmi, composition, items, requirements, relaxation } = result;
  const { nel, mp } = requirements || {};

  console.log(`\n  [${label}]`);

  // Çözüm durumu
  if (feasible) {
    check('Çözüm durumu: optimal', true, statusName);
  } else if (relaxation?.applied) {
    warn(`Çözüm gevşetilmiş (soft constraints): ${statusName}`);
  } else {
    check('Çözüm durumu: optimal', false, statusName);
  }

  if (!items || items.length === 0) {
    fail('Yem listesi boş — rasyon kurulamadı');
    return;
  }

  // ─── Yem listesi özeti
  info(`Rasyondaki yemler (${items.length} kalem):`);
  items.forEach(it => {
    console.log(`     ${it.name.padEnd(28)} ${it.dmKg.toFixed(2).padStart(5)} kg KM  (${it.pctDm.toFixed(1).padStart(4)}% KM)`);
  });

  const achievedDmi = items.reduce((s, it) => s + it.dmKg, 0);

  // ─── KMT
  check('KMT hedef±5%',
    Math.abs(achievedDmi - dmi.target_kg) / dmi.target_kg < 0.05,
    `hedef ${dmi.target_kg.toFixed(1)} kg, gerçek ${achievedDmi.toFixed(2)} kg`
  );

  // ─── Hayvan gereksinimleri vs. rasyon
  const nelSupply = composition?.nel_mcal ?? 0;
  const mpSupply  = composition?.mp_g ?? 0;
  const nelReq    = nel?.total ?? 0;
  const mpReq     = mp?.total ?? 0;

  check('NEL yeterli (≥%98 karşılanmış)',
    nelReq > 0 && nelSupply >= nelReq * 0.98,
    `gereksinim ${nelReq.toFixed(1)} Mcal, tedarik ${nelSupply?.toFixed(1)} Mcal`
  );
  check('MP yeterli (≥%98 karşılanmış)',
    mpReq > 0 && mpSupply >= mpReq * 0.98,
    `gereksinim ${mpReq} g, tedarik ${mpSupply} g`
  );

  // ─── Kompozisyon akıl kontrolleri
  const ndf     = composition?.ndf_pct ?? 0;
  const nfc     = composition?.nfc_pct ?? 0;
  const forage  = composition?.forage_pct ?? 0;
  const cp      = composition?.cp_pct ?? 0;
  const fat     = composition?.fat_pct ?? 0;

  check('NDF %25-55 arası',       ndf >= 25 && ndf <= 55,  `NDF: ${ndf?.toFixed(1)}% KM`);
  check('NFC ≤%50',               nfc <= 50,               `NFC: ${nfc?.toFixed(1)}% KM`);
  check('Kaba yem %30-80',        forage >= 30 && forage <= 80, `Foraj: ${forage?.toFixed(1)}% KM`);
  check('CP %10-23 (biyolojik)',  cp >= 10 && cp <= 23,    `CP: ${cp?.toFixed(1)}% KM`);
  check('Ham yağ ≤%10',           fat <= 10,               `Fat: ${fat?.toFixed(1)}% KM`);

  // ─── MP gebelik (kritik test)
  if (animal.pregnant && animal.gestDays >= 190) {
    const mpPreg = mp?.pregnancy ?? 0;
    check('MP gebelik >100 g/gün (≥190. gün)',
      mpPreg > 100,
      `MP_gebelik: ${mpPreg} g/gün — 265. gün ≈ 313 g/gün beklenir`
    );
  }

  // ─── Isı stresi
  if (animal.thi >= 72) {
    check('Isı stresi: DMI düşürülmüş',
      dmi.heatAdjusted === true,
      `heatAdjusted: ${dmi.heatAdjusted}`
    );
  }

  // ─── Maliyet
  const cost = result.totalCost ?? 0;
  check('Günlük maliyet >0 TL',  cost > 0, `${cost.toFixed(2)} TL/gün`);

  // ─── Gevşetme uyarısı
  if (relaxation?.applied) {
    warn('Soft constraint ihlalleri:');
    (relaxation.messages || []).forEach(m => {
      if (typeof m === 'string') console.log(`     - ${m}`);
      else console.log(`     - [${m.type}] ${m.name || ''} : ${m.violation || ''} (detay: ${JSON.stringify(m)})`);
    });
  }

  console.log('');
}

// ─── Çalıştır ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${BOLD}=== Rasyon Programı Entegrasyon Testi ===${RESET}`);
  console.log(`Tarih: ${new Date().toLocaleString('tr-TR')}\n`);

  try {
    await test1_HighYieldEarlyLactation();
    await test2_MidLactation();
    await test3_CloseUp();
    await test4_HeatStress();
  } catch (e) {
    console.error(`${RED}HATA: ${e.message}${RESET}`);
    console.error(e.stack);
  }

  // ─── Özet
  const total = totalPass + totalFail;
  console.log(`\n${BOLD}═══════════════════════════════════════${RESET}`);
  console.log(`${BOLD}SONUÇ: ${GREEN}${totalPass}/${total} geçti${totalFail > 0 ? `, ${RED}${totalFail} başarısız` : ''}${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════${RESET}\n`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main();
