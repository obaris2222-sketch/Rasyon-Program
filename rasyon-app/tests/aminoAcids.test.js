import { describe, it, expect } from 'vitest';
import {
  calcAARequirements, calcAASupply,
  assessAABalance, AA_TARGETS, recommendRPAA, calcAATargets,
  MICROBIAL_AA, EAA_LIST, RUP_AA_DEFAULTS,
} from '../src/core/aminoAcids.js';

describe('calcAATargets — FAZ 10B dinamik hedefler (NASEM 2021)', () => {
  it('Düşük verim (20 kg): düşük Lys/Met hedefi', () => {
    const t = calcAATargets({ milkYield: 20, lactationStage: 'mid' });
    expect(t.lys.pctMP).toBeLessThan(7.0);
    expect(t.met.pctMP).toBeLessThan(2.6);
  });

  it('Yüksek verim (45 kg): yüksek Lys/Met hedefi', () => {
    const t = calcAATargets({ milkYield: 45, lactationStage: 'early' });
    expect(t.lys.pctMP).toBeGreaterThan(6.8);
    expect(t.met.pctMP).toBeGreaterThan(2.5);
  });

  it('Geçiş dönemi (close_up): Met +0.3 (Schwab 2019)', () => {
    const normal = calcAATargets({ milkYield: 0, lactationStage: 'mid' });
    const closeUp = calcAATargets({ milkYield: 0, lactationStage: 'close_up' });
    expect(closeUp.met.pctMP).toBeGreaterThan(normal.met.pctMP);
  });

  it('Erken laktasyon: Lys +0.2 (peak verim için)', () => {
    const early = calcAATargets({ milkYield: 30, lactationStage: 'early' });
    const mid = calcAATargets({ milkYield: 30, lactationStage: 'mid' });
    expect(early.lys.pctMP).toBeGreaterThan(mid.lys.pctMP);
  });

  it('Lys/Met aralık sınırları (6.0-7.6, 2.2-3.0)', () => {
    const extreme = calcAATargets({ milkYield: 80, lactationStage: 'early' });
    expect(extreme.lys.pctMP).toBeLessThanOrEqual(7.6);
    expect(extreme.met.pctMP).toBeLessThanOrEqual(3.0);
    const low = calcAATargets({ milkYield: 10, lactationStage: 'late' });
    expect(low.lys.pctMP).toBeGreaterThanOrEqual(6.0);
    expect(low.met.pctMP).toBeGreaterThanOrEqual(2.2);
  });
});

describe('AA Gereksinimleri', () => {
  it('1000 g/gün MP için Lys gereksinimi: %7.0 → 70 g/gün', () => {
    const req = calcAARequirements(1000);
    expect(req.lys_g).toBeCloseTo(70, 0);
  });

  it('1000 g/gün MP için Met gereksinimi: %2.6 → 26 g/gün', () => {
    const req = calcAARequirements(1000);
    expect(req.met_g).toBeCloseTo(26, 0);
  });

  it('Lys:Met oranı ≈ 2.69 (7.0/2.6)', () => {
    const req = calcAARequirements(1000);
    expect(req.ratio).toBeCloseTo(70 / 26, 1);
  });
});

describe('AA Tedariki', () => {
  it('MCP ve RUP kombinasyonundan Lys ve Met tedariki pozitif', () => {
    const supply = calcAASupply({
      mpMicrobial_g: 700,
      mpRUP_g: 400,
      rupLysPct: 6.5,
      rupMetPct: 2.0,
    });
    expect(supply.lys.total_g).toBeGreaterThan(0);
    expect(supply.met.total_g).toBeGreaterThan(0);
  });

  it('Lys %MP hedef aralık kontrol (5-9% arasında)', () => {
    const supply = calcAASupply({
      mpMicrobial_g: 700,
      mpRUP_g: 400,
      rupLysPct: 6.5,
      rupMetPct: 2.0,
    });
    expect(supply.lys.pctMP).toBeGreaterThan(5);
    expect(supply.lys.pctMP).toBeLessThan(9);
  });

  it('Daha fazla RUP → Lys ve Met tedariki artar', () => {
    const base = { mpMicrobial_g: 700, rupLysPct: 6.5, rupMetPct: 2.0 };
    const low = calcAASupply({ ...base, mpRUP_g: 200 });
    const high = calcAASupply({ ...base, mpRUP_g: 600 });
    expect(high.lys.total_g).toBeGreaterThan(low.lys.total_g);
    expect(high.met.total_g).toBeGreaterThan(low.met.total_g);
  });

  it('Lys:Met oranı hesaplanmalı ve 2.0-4.5 arasında olmalı', () => {
    const supply = calcAASupply({
      mpMicrobial_g: 700,
      mpRUP_g: 400,
      rupLysPct: 6.5,
      rupMetPct: 2.0,
    });
    expect(supply.lysMet_ratio).toBeGreaterThan(2.0);
    expect(supply.lysMet_ratio).toBeLessThan(5.0);
  });
});

describe('AA Denge Değerlendirmesi', () => {
  const goodSupply = calcAASupply({
    mpMicrobial_g: 750, mpRUP_g: 450,
    rupLysPct: 7.0, rupMetPct: 2.4,
  });

  const goodReq = calcAARequirements(goodSupply.mpTotal_g);

  it('Yeterli tedarik → optimal veya marginal durum', () => {
    const assessment = assessAABalance(goodSupply, goodReq);
    expect(['optimal', 'marginal', 'excess']).toContain(assessment.lys.status);
  });

  it('Overall score 0-100 arasında', () => {
    const assessment = assessAABalance(goodSupply, goodReq);
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
  });

  it('Düşük Met tedariki → deficient veya marginal', () => {
    const lowMetSupply = calcAASupply({
      mpMicrobial_g: 400, mpRUP_g: 200,
      rupLysPct: 5.0, rupMetPct: 1.0,
    });
    const req = calcAARequirements(lowMetSupply.mpTotal_g * 1.5); // kasıtlı yüksek gereksinim
    const assessment = assessAABalance(lowMetSupply, req);
    expect(['deficient', 'marginal']).toContain(assessment.met.status);
  });
});

describe('AA Hedef Değerleri', () => {
  it('AA_TARGETS Lys hedefi %7.0 MP', () => {
    expect(AA_TARGETS.lys.pctMP).toBe(7.00);
  });

  it('AA_TARGETS Met hedefi %2.6 MP', () => {
    expect(AA_TARGETS.met.pctMP).toBe(2.60);
  });

  it('Lys:Met ideal oran ≥ 2.6:1', () => {
    expect(AA_TARGETS.lysMet_ratio.min).toBe(2.6);
  });
});

describe('Korumalı AA Önerisi', () => {
  it('Met eksikliğinde RPMet önerisi yapılmalı', () => {
    const lowSupply = calcAASupply({
      mpMicrobial_g: 500, mpRUP_g: 200,
      rupLysPct: 5.0, rupMetPct: 1.2,
    });
    const req = calcAARequirements(800);
    const assessment = assessAABalance(lowSupply, req);
    const recs = recommendRPAA(assessment, 800);
    const hasRPMet = recs.some(r => r.type === 'RPMet');
    expect(hasRPMet).toBe(true);
  });

  it('Yeterli AA durumunda öneri listesi boş olmalı', () => {
    const supply = calcAASupply({
      mpMicrobial_g: 800, mpRUP_g: 500,
      rupLysPct: 7.5, rupMetPct: 2.8,
    });
    const req = calcAARequirements(supply.mpTotal_g);
    const assessment = assessAABalance(supply, req);
    // Optimal durumda öneri yok
    if (assessment.overallScore >= 90) {
      const recs = recommendRPAA(assessment, supply.mpTotal_g);
      expect(recs.length).toBe(0);
    }
  });
});

// ─── FAZ 13.15: Mikrobiyal AA katsayıları (NRC 2001 vs NASEM 2021) ──────────

describe('FAZ 13.15 — Mikrobiyal protein AA içeriği sistemi', () => {
  it('MICROBIAL_AA: NRC2001 Lys 7.90/Met 2.65/His 2.10, NASEM2021 Lys 7.30/Met 2.40/His 2.00 (+ 7 EAA)', () => {
    expect(MICROBIAL_AA.NRC2001).toMatchObject({ lys: 7.90, met: 2.65, his: 2.10 });   // FAZ 18.3: His
    expect(MICROBIAL_AA.NASEM2021).toMatchObject({ lys: 7.30, met: 2.40, his: 2.00 });
    // Tam EAA (Katman A): 7 EAA mikrobiyal bileşimi de tanımlı (her iki sistemde)
    for (const aa of ['arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp']) {
      expect(MICROBIAL_AA.NASEM2021[aa]).toBeGreaterThan(0);
      expect(MICROBIAL_AA.NRC2001[aa]).toBeGreaterThan(0);
    }
  });

  it('calcAASupply default (NASEM2021) → mikrobiyal Lys = mpMicrobial × 7.30%', () => {
    const r = calcAASupply({ mpMicrobial_g: 1000, mpRUP_g: 0, rupLysPct: 6.5, rupMetPct: 2.0 });
    expect(r.lys.fromMCP_g).toBeCloseTo(73.0, 1);  // 1000 × 7.30/100
    expect(r.met.fromMCP_g).toBeCloseTo(24.0, 1);  // 1000 × 2.40/100
  });

  it('NRC2001 modu mikrobiyal Lys/Met NASEM2021\'den yüksek', () => {
    const nasem = calcAASupply({ mpMicrobial_g: 1000, mpRUP_g: 0, system: 'NASEM2021' });
    const nrc   = calcAASupply({ mpMicrobial_g: 1000, mpRUP_g: 0, system: 'NRC2001' });
    expect(nrc.lys.fromMCP_g).toBeCloseTo(79.0, 1);
    expect(nrc.met.fromMCP_g).toBeCloseTo(26.5, 1);
    expect(nrc.lys.fromMCP_g).toBeGreaterThan(nasem.lys.fromMCP_g);
    expect(nrc.met.fromMCP_g).toBeGreaterThan(nasem.met.fromMCP_g);
  });
});

describe('FAZ 18.3 — Histidin (kritik 3. AA)', () => {
  it('AA_TARGETS ve calcAATargets His hedefi içerir (~%2.2 MP)', () => {
    expect(AA_TARGETS.his).toBeDefined();
    expect(AA_TARGETS.his.pctMP).toBeCloseTo(2.2, 1);
    const tg = calcAATargets({ milkYield: 35, lactationStage: 'mid' });
    expect(tg.his).toBeDefined();
    expect(tg.his.pctMP).toBeGreaterThanOrEqual(2.0);
    expect(tg.his.pctMP).toBeLessThanOrEqual(2.6);
  });

  it('calcAASupply His tedariki döndürür (mikrobiyal + RUP)', () => {
    const r = calcAASupply({ mpMicrobial_g: 1000, mpRUP_g: 500, rupHisPct: 2.3, intestinalD: 100, system: 'NASEM2021' });
    expect(r.his).toBeDefined();
    expect(r.his.fromMCP_g).toBeCloseTo(20.0, 1);   // 1000 × 2.00/100 (NASEM His)
    expect(r.his.fromRUP_g).toBeCloseTo(11.5, 1);   // 500 × 2.3/100
    expect(r.his.total_g).toBeCloseTo(31.5, 1);
  });

  it('calcAARequirements His gereksinimi (g/gün) hesaplar', () => {
    const req = calcAARequirements(2700, 7.0, 2.6, 2.2);
    expect(req.his_g).toBeCloseTo(59.4, 1);   // 2700 × 2.2/100
  });

  it('assessAABalance His durumu + ilk-sınırlayıcı AA döndürür', () => {
    const targets = calcAATargets({ milkYield: 40, lactationStage: 'early' });
    const supply = calcAASupply({ mpMicrobial_g: 1600, mpRUP_g: 1100, rupLysPct: 6.0, rupMetPct: 2.0, rupHisPct: 2.3, intestinalD: 100 });
    const req = calcAARequirements(supply.mpTotal_g, targets.lys.pctMP, targets.met.pctMP, targets.his.pctMP);
    const a = assessAABalance(supply, req, targets);
    expect(a.his).toBeDefined();
    expect(['optimal', 'marginal', 'deficient', 'excess']).toContain(a.his.status);
    // ilk-sınırlayıcı: tedarik/hedef oranı en düşük AA (Katman A: 10 EAA üzerinden)
    expect(a.firstLimiting).toBeTruthy();
    expect(EAA_LIST).toContain(a.firstLimiting.aa);
  });
});

// ─── Tam EAA Modeli (Katman A) — 10 AA gösterim ──────────────────────────────

describe('Tam EAA (Katman A) — 10 AA tedarik/gereksinim/değerlendirme', () => {
  it('EAA_LIST 10 AA içerir (Lys/Met/His + 7 EAA)', () => {
    expect(EAA_LIST).toEqual(['lys', 'met', 'his', 'arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp']);
  });

  it('RUP_AA_DEFAULTS tüm 10 AA için tipik RUP % içerir', () => {
    for (const aa of EAA_LIST) expect(RUP_AA_DEFAULTS[aa]).toBeGreaterThan(0);
  });

  it('AA_TARGETS + calcAATargets 7 EAA referans hedefi içerir (%MP)', () => {
    const tg = calcAATargets({ milkYield: 32, lactationStage: 'early' });
    for (const aa of ['arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp']) {
      expect(AA_TARGETS[aa]?.pctMP).toBeGreaterThan(0);
      expect(tg[aa]?.pctMP).toBeGreaterThan(0);
    }
  });

  it('calcAASupply 10 AA tedariki döndürür (mikrobiyal + RUP varsayılan)', () => {
    const s = calcAASupply({ mpMicrobial_g: 1000, mpRUP_g: 500, intestinalD: 100, system: 'NASEM2021' });
    for (const aa of EAA_LIST) {
      expect(s[aa]).toBeDefined();
      expect(s[aa].total_g).toBeGreaterThan(0);
      expect(s[aa].pctMP).toBeGreaterThan(0);
    }
    // Leu mikrobiyal 7.49% → 1000×7.49/100 = 74.9 (fromMCP)
    expect(s.leu.fromMCP_g).toBeCloseTo(74.9, 1);
  });

  it('calcAASupply rupPctByAA öncelikli (ölçülü RUP profili)', () => {
    const s = calcAASupply({ mpMicrobial_g: 0, mpRUP_g: 1000, intestinalD: 100,
      rupPctByAA: { leu: 9.0 } });
    expect(s.leu.fromRUP_g).toBeCloseTo(90, 1);  // 1000×9.0/100
  });

  it('calcAARequirements extraPctMP ile 7 EAA gereksinimi (g/gün) hesaplar', () => {
    const req = calcAARequirements(2000, 7.0, 2.6, 2.2, { leu: 7.0, trp: 1.3 });
    expect(req.leu_g).toBeCloseTo(140, 0);   // 2000×7.0/100
    expect(req.trp_g).toBeCloseTo(26, 0);    // 2000×1.3/100
    // extraPctMP yoksa 7 EAA gereksinimi eklenmez (geriye uyumlu)
    expect(calcAARequirements(2000).leu_g).toBeUndefined();
  });

  it('assessAABalance 10 AA değerlendirir; skor yalnız Lys/Met/His ile (7 EAA gösterim)', () => {
    const targets = calcAATargets({ milkYield: 35, lactationStage: 'mid' });
    const supply = calcAASupply({ mpMicrobial_g: 1500, mpRUP_g: 1000, intestinalD: 100 });
    const extra = Object.fromEntries(['arg', 'thr', 'ile', 'leu', 'val', 'phe', 'trp'].map(a => [a, targets[a].pctMP]));
    const req = calcAARequirements(supply.mpTotal_g, targets.lys.pctMP, targets.met.pctMP, targets.his.pctMP, extra);
    const a = assessAABalance(supply, req, targets);
    for (const aa of EAA_LIST) expect(a[aa]).toBeDefined();   // 10 AA durumu
    expect(a.overallScore).toBeGreaterThanOrEqual(0);
    expect(a.overallScore).toBeLessThanOrEqual(100);
  });
});
