/**
 * softConstraints.js — Soft constraint / slack relaxation testleri (FAZ 14.8)
 */

import { describe, it, expect } from 'vitest';
import { buildRationLP, GLP } from '../src/solver/lpBuilder.js';
import { solveLP } from '../src/solver/glpkSolver.js';
import { relaxLP, extractViolations, describeViolations, RELAX_PRIORITY } from '../src/solver/softConstraints.js';
import { optimizeRation } from '../src/solver/rationOptimizer.js';

const FEEDS = [
  { id: 'silage', category: 'roughage', dm: 33, nel: 1.72, cp: 8.2, rup: 15, rdp: 85, ndf: 44, adf: 27,
    aNDF: 42, nfc: 36, starch: 26, sugar: 1.5, fat: 3.3, ash: 4.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05,
    na: 0.01, s: 0.11, cl: 0.09, lys: 4.5, met: 1.5, pricePerTon: 2500 },
  { id: 'grain', category: 'grain', dm: 88, nel: 2.0, cp: 9, rup: 50, rdp: 50, ndf: 10, adf: 3,
    aNDF: 8, nfc: 74, starch: 65, sugar: 2, fat: 4, ash: 1.4, ca: 0.02, p: 0.28, mg: 0.10, k: 0.38,
    na: 0.01, s: 0.10, cl: 0.05, lys: 2.8, met: 2.0, pricePerTon: 9000 },
];

describe('FAZ 14.8 — relaxLP slack yapısı', () => {
  it('RELAX_PRIORITY DCAD ilk (en yüksek öncelik); TMR nem en düşük (trace_ sonrası)', () => {
    expect(RELAX_PRIORITY[0]).toBe('DCAD');
    expect(RELAX_PRIORITY).toContain('trace_');
    // #4: TMR nem/DM hedefi yönetimsel tercih → trace minerallerden bile düşük öncelik (sonra gelir)
    expect(RELAX_PRIORITY.indexOf('TMR_DM_max')).toBeGreaterThan(RELAX_PRIORITY.indexOf('trace_'));
    expect(RELAX_PRIORITY[RELAX_PRIORITY.length - 1]).toBe('TMR_DM_max');
  });

  it('SAHA-DENETİM C: vit_/trace_ CHO ince-ayar + AA kısıtlarından YÜKSEK öncelikli (kaynak varsa karşılanır)', () => {
    const idx = (n) => RELAX_PRIORITY.indexOf(n);
    // vit/trace yem setinde KAYNAK varsa karşılanmalı → fine-tuning + AA'dan ÖNCE (daha geç gevşer)
    for (const lower of ['Starch_max', 'Sugar_max', 'NFC_max', 'NDF', 'ADF_min', 'Lys', 'Met', 'His']) {
      expect(idx('vit_')).toBeLessThan(idx(lower));
      expect(idx('trace_')).toBeLessThan(idx(lower));
    }
    // ama süt humması (DCAD) hâlâ en yüksek öncelik (vit/trace ondan SONRA)
    expect(idx('DCAD')).toBeLessThan(idx('vit_'));
    expect(idx('DCAD')).toBeLessThan(idx('trace_'));
  });

  it('LO kısıtına +1 slack ekler, objective\'e penalty', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, peNDF_pct: { min: 22 } },
    });
    const { relaxedLP, slackMeta } = relaxLP(lp);
    // peNDF_min gevşetilebilir (RELAX_PRIORITY'de)
    const pe = relaxedLP.subjectTo.find(c => c.name === 'peNDF_min');
    const slackVar = pe.vars.find(v => v.name.startsWith('slk_'));
    expect(slackVar).toBeDefined();
    expect(slackVar.coef).toBe(1);  // LO → +1
    // objective'de aynı slack penalty ile
    const objSlack = relaxedLP.objective.vars.find(v => v.name === slackVar.name);
    expect(objSlack.coef).toBeGreaterThan(0);
    // slackMeta kaydı
    expect(slackMeta.find(m => m.slack === slackVar.name).side).toBe('lo');
  });

  it('FAZ 22.1: özel priorityList gevşetme önceliğini (penalty) değiştirir', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, peNDF_pct: { min: 22 }, starch_pct: { max: 20 } },
    });
    const penOf = (meta, name) => meta.find(m => m.constraint === name)?.penalty;
    // Varsayılan: peNDF_min, Starch_max'tan YÜKSEK öncelik → daha yüksek penalty (daha geç gevşer)
    const def = relaxLP(lp);
    expect(penOf(def.slackMeta, 'peNDF_min')).toBeGreaterThan(penOf(def.slackMeta, 'Starch_max'));
    // Özel sıra: Starch_max üstte → artık Starch_max daha yüksek penalty (peNDF önce gevşer)
    const cust = relaxLP(lp, { priorityList: ['Starch_max', 'peNDF_min'] });
    expect(penOf(cust.slackMeta, 'Starch_max')).toBeGreaterThan(penOf(cust.slackMeta, 'peNDF_min'));
  });

  it('FAZ 22.1: priorityList verilmezse RELAX_PRIORITY default ile birebir', () => {
    const lp = buildRationLP({ feeds: FEEDS, dmi_kg: 20, requirements: { nel_mcal: 30, peNDF_pct: { min: 22 } } });
    const a = relaxLP(lp);                                    // default (undefined)
    const b = relaxLP(lp, { priorityList: RELAX_PRIORITY });  // açık default
    const penA = a.slackMeta.find(m => m.constraint === 'peNDF_min')?.penalty;
    const penB = b.slackMeta.find(m => m.constraint === 'peNDF_min')?.penalty;
    expect(penA).toBe(penB);
  });

  it('#2: hardConstraints içindeki kısıt slack ALMAZ (zorunlu kalır)', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, peNDF_pct: { min: 22 }, forage_pct: { min: 40, max: 70 } },
    });
    // peNDF + Forage normalde gevşetilebilir; hard yapınca slack almamalı
    const { relaxedLP } = relaxLP(lp, { hardConstraints: ['peNDF_min', 'Forage'] });
    const pe = relaxedLP.subjectTo.find(c => c.name === 'peNDF_min');
    const forage = relaxedLP.subjectTo.find(c => c.name === 'Forage');
    expect(pe.vars.some(v => v.name.startsWith('slk_'))).toBe(false);   // hard → slack yok
    expect(forage.vars.some(v => v.name.startsWith('slk_'))).toBe(false);
    // hardConstraints boşken aynı kısıt slack ALIR (karşılaştırma)
    const { relaxedLP: relaxedSoft } = relaxLP(lp);
    expect(relaxedSoft.subjectTo.find(c => c.name === 'peNDF_min').vars.some(v => v.name.startsWith('slk_'))).toBe(true);
  });

  it('PROBLEMLER #5: hardConstraints içinde NDF → min+max (DB) birlikte hard kalır, slack ALMAZ', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, ndf_pct: { min: 28, max: 40 } },
    });
    // Kilitli: NDF (DB) bütün hard kopyalanır → tek 'NDF' adıyla kalır, slack yok
    const { relaxedLP } = relaxLP(lp, { hardConstraints: ['NDF'] });
    const ndfHard = relaxedLP.subjectTo.find(c => c.name === 'NDF');
    expect(ndfHard).toBeDefined();
    expect(ndfHard.vars.some(v => v.name.startsWith('slk_'))).toBe(false);
    // Kilitsiz (karşılaştırma): NDF (DB) → NDF_lo + NDF_up'a bölünür, ikisi de slack alır (gevşetilebilir)
    const { relaxedLP: soft } = relaxLP(lp);
    const ndfLo = soft.subjectTo.find(c => c.name === 'NDF_lo');
    const ndfUp = soft.subjectTo.find(c => c.name === 'NDF_up');
    expect(ndfLo?.vars.some(v => v.name.startsWith('slk_'))).toBe(true);
    expect(ndfUp?.vars.some(v => v.name.startsWith('slk_'))).toBe(true);
  });

  it('UP kısıtına −1 slack ekler', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, nfc_pct: { max: 42 } },
    });
    const { relaxedLP } = relaxLP(lp);
    const nfc = relaxedLP.subjectTo.find(c => c.name === 'NFC_max');
    const slackVar = nfc.vars.find(v => v.name.startsWith('slk_'));
    expect(slackVar.coef).toBe(-1);  // UP → −1
  });

  it('DB kısıtı iki kısıta bölünür (_lo + _up), 2 slack', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, dcad_meq: { min: 25, max: 50 } },
    });
    const { relaxedLP, slackMeta } = relaxLP(lp);
    const lo = relaxedLP.subjectTo.find(c => c.name === 'DCAD_lo');
    const up = relaxedLP.subjectTo.find(c => c.name === 'DCAD_up');
    expect(lo).toBeDefined();
    expect(up).toBeDefined();
    expect(lo.bnds.type).toBe(GLP.LO);
    expect(up.bnds.type).toBe(GLP.UP);
    // orijinal DCAD (DB) artık yok
    expect(relaxedLP.subjectTo.find(c => c.name === 'DCAD')).toBeUndefined();
    // 2 DCAD slack
    expect(slackMeta.filter(m => m.constraint === 'DCAD')).toHaveLength(2);
  });

  it('HARD kısıtlar (DMI/NEL/MP/Ca) gevşetilmez — slack eklenmez', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, mp_g: 1500, ca_g: 80, peNDF_pct: { min: 22 } },
    });
    const { relaxedLP, slackMeta } = relaxLP(lp);
    // NEL, MP, Ca, DMI slack içermemeli
    for (const name of ['DMI', 'NEL', 'MP', 'Ca']) {
      const c = relaxedLP.subjectTo.find(x => x.name === name);
      if (c) expect(c.vars.some(v => v.name.startsWith('slk_'))).toBe(false);
    }
    // slackMeta'da bu kısıtlar yok
    expect(slackMeta.some(m => ['DMI', 'NEL', 'MP', 'Ca'].includes(m.constraint))).toBe(false);
  });

  it('yüksek öncelik (DCAD) penalty, düşük öncelikten (trace) belirgin büyük', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: {
        nel_mcal: 30, dcad_meq: { min: 25, max: 50 },
        traceMinerals: { zn: { min: 800 } },
      },
    });
    const { slackMeta } = relaxLP(lp);
    const dcadPenalty = slackMeta.find(m => m.constraint === 'DCAD').penalty;
    const tracePenalty = slackMeta.find(m => m.constraint === 'trace_zn').penalty;
    expect(dcadPenalty).toBeGreaterThan(tracePenalty);
  });

  it('FAZ 14.11 uyum: relaxLP MILP binaries/generals dizilerini korur', () => {
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, dcad_meq: { min: 25, max: 50 } },
      feedLimits: { silage: { min: 0.5, max: 5, type: 'semicontinuous' }, grain: { max: 8, type: 'integer' } },
    });
    expect(lp.binaries).toContain('y_silage');
    expect(lp.generals).toContain('x_grain');
    const { relaxedLP } = relaxLP(lp);
    // relax slack eklerken MILP dizileri kaybolmamalı (semi-continuous/integer mantığı korunur)
    expect(relaxedLP.binaries).toEqual(lp.binaries);
    expect(relaxedLP.generals).toEqual(lp.generals);
  });
});

describe('FAZ 14.8 — extractViolations + describeViolations', () => {
  it('infeasible LP relax sonrası slack > 0 olan kısıtı tespit eder', async () => {
    // DCAD min 60 bu yemlerle imkansız → relax sonrası DCAD slack > 0
    const lp = buildRationLP({
      feeds: FEEDS, dmi_kg: 20,
      requirements: { nel_mcal: 30, dcad_meq: { min: 60, max: 80 } },
    });
    const hard = await solveLP(lp);
    expect(hard.optimal).toBe(false);  // infeasible

    const { relaxedLP, slackMeta } = relaxLP(lp);
    const soft = await solveLP(relaxedLP);
    expect(soft.optimal).toBe(true);   // slack ile feasible

    const violations = extractViolations(soft, slackMeta);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.constraint === 'DCAD' && v.side === 'lo')).toBe(true);
  });

  it('describeViolations Türkçe mesaj üretir (etiket + yön)', () => {
    const msgs = describeViolations([
      { constraint: 'DCAD', side: 'lo', amount: 100 },
      { constraint: 'trace_zn', side: 'lo', amount: 5 },
    ]);
    expect(msgs[0].message).toContain('DCAD');
    expect(msgs[0].message).toContain('minimum');
    expect(msgs[1].message).toContain('İz mineral');
  });
});

describe('FAZ 14.8 — optimizeRation entegrasyon', () => {
  // Zengin yem seti — MP/Ca/P (HARD) karşılanabilir, böylece yalnızca soft kısıtlar test edilir
  const RICH_FEEDS = [
    ...FEEDS,
    { id: 'soy', category: 'protein', dm: 89, nel: 1.99, cp: 48, rup: 35, rdp: 65, ndf: 10, adf: 5,
      aNDF: 8, nfc: 28, starch: 1, sugar: 8, fat: 1.5, ash: 7, ca: 0.33, p: 0.70, mg: 0.30, k: 2.20,
      na: 0.02, s: 0.45, cl: 0.04, lys: 6.3, met: 1.4, pricePerTon: 18000 },
    { id: 'lime', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0,
      ash: 100, ca: 38, p: 0, mg: 0.35, k: 0, na: 0, s: 0, cl: 0, pricePerTon: 3000 },
    { id: 'dcp', category: 'mineral', dm: 97, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0,
      ash: 100, ca: 22, p: 18, mg: 0.6, k: 0, na: 0.10, s: 0.80, cl: 0, pricePerTon: 15000 },
    { id: 'salt', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0,
      ash: 100, ca: 0, p: 0, mg: 0, k: 0, na: 39, s: 0, cl: 60, pricePerTon: 2000 },
  ];
  const LACT = { bw: 600, parity: 2, dim: 90, milkYield: 30, milkFat: 3.7, milkProtein: 3.2, bcs: 3.0, lactationStage: 'mid' };
  const RICH_LIMITS = { silage: { maxPct: 50, minPct: 15 }, grain: { maxPct: 40 }, soy: { maxPct: 25 }, salt: { maxPct: 1 } };

  it('feasible rasyonda relaxation null kalır', async () => {
    const r = await optimizeRation({
      animal: { ...LACT, milkYield: 22 }, feeds: RICH_FEEDS, feedLimits: RICH_LIMITS,
    });
    if (r.feasible) {
      expect(r.relaxation).toBeNull();
    }
  });

  it('imkansız DCAD → relaxation.applied + DCAD ihlali raporlanır, items dolu', async () => {
    const r = await optimizeRation({
      animal: LACT, feeds: RICH_FEEDS, feedLimits: RICH_LIMITS,
      composition: { dcad_meq: { min: 80, max: 120 } },  // imkansız yüksek
    });
    expect(r.feasible).toBe(false);          // gevşetildi → ideal değil
    expect(r.relaxation?.applied).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);  // gevşetilmiş çözüm yem içerir
    // DCAD ihlali raporda (en yüksek öncelik → ilk sırada)
    expect(r.relaxation.violations.some(v => v.constraint === 'DCAD')).toBe(true);
    expect(r.relaxation.messages.length).toBeGreaterThan(0);
  });

  it('HARD kısıt infeasible (imkansız NEL) → relax çözemez, relaxation uygulanmaz', async () => {
    // NEL HARD'dır (RELAX_PRIORITY'de yok) → gevşetilmez. İmkansız NEL min 500
    // (yemlerle max ~2.0×20=40 Mcal) → relax bile feasible yapamaz.
    const r = await optimizeRation({
      animal: LACT, feeds: RICH_FEEDS, feedLimits: RICH_LIMITS,
      composition: { nel_mcal: { min: 500 } },
    });
    expect(r.feasible).toBe(false);
    expect(r.relaxation?.applied).not.toBe(true);  // HARD kısıt gevşetilemez
  });

  it('SAHA-DENETİM C: premiks kaynağı varken aşırı-kısıtlı rasyonda vitamin/iz mineral KARŞILANIR (feda edilmez)', async () => {
    // Dengeli vitamin/iz mineral premiksi (gerçekçi seviyeler — Se/Co toksisite sınırını aşmaz)
    const PREMIX = { id: 'premix', category: 'mineral', dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0,
      nfc: 0, fat: 0, ash: 100, ca: 15, p: 5, mg: 1, na: 5, cl: 8,
      vitA: 800000, vitD: 150000, vitE: 5000, zn: 8000, cu: 1500, mn: 5000, se: 50, co: 20, i: 100, fe: 4000,
      pricePerTon: 60000 };
    const feeds = [...RICH_FEEDS, PREMIX];
    // erken laktasyon + yüksek verim + sınırlı kaba yem → aşırı-kısıtlı (relaxation tetiklenir)
    const r = await optimizeRation({
      animal: { ...LACT, milkYield: 32, lactationStage: 'early' }, feeds, feedLimits: RICH_LIMITS,
    });
    expect(r.relaxation?.applied).toBe(true);  // rasyon gerçekten gevşetildi (over-constrained)
    // ESKİ davranış: vit/trace en düşük öncelik → premiks listede olsa bile feda edilirdi (vitA=0 vb.).
    // YENİ (SAHA-DENETİM C): vit/trace yüksek öncelik → premiks KULLANILIR, mikro-besinler karşılanır.
    const viol = (r.relaxation?.violations || []).map(v => v.constraint);
    expect(viol.some(c => c.startsWith('vit_'))).toBe(false);
    expect(viol.some(c => c.startsWith('trace_'))).toBe(false);
    expect(r.items.find(i => i.id === 'premix')?.dmKg).toBeGreaterThan(0);  // premiks gerçekten kullanıldı
  });
});
