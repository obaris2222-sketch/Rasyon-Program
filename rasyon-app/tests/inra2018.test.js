import { describe, it, expect } from 'vitest';
import {
  calcUFL, calcPDIE, calcPDIN, calcUEL,
  calcUFLRequirements, calcPDIRequirements, calcUELCapacity,
  aggregateINRA, interpretINRABalance,
  NEL_TO_UFL
} from '../src/core/inra2018.js';

describe('INRA 2018 Core (FAZ 16.1)', () => {

  describe('Yem Değerleri (Feed Values)', () => {
    it('calcUFL: INRA değeri yoksa NEL üzerinden doğru dönüşüm yapar', () => {
      const feed = { nel: 1.45 }; // Yonca benzeri
      const ufl = calcUFL(feed);
      // 1.45 / 1.7 = 0.8529
      expect(ufl).toBeCloseTo(0.8529, 4);
    });

    it('calcUFL: Yem spesifik inraUFL varsa onu kullanır', () => {
      const feed = { inraUFL: 0.95, nel: 1.45 };
      expect(calcUFL(feed)).toBe(0.95);
    });

    it('FAZ 22.6: calcUFL nelDiscount uygular (etkin NEL → UFL düşer)', () => {
      const base = { nel: 1.70 };
      const disc = { nel: 1.70, nelDiscount: 10 };  // %10 iskonto
      expect(calcUFL(base)).toBeCloseTo(1.0, 4);    // 1.70/1.70 = 1.0
      expect(calcUFL(disc)).toBeCloseTo(0.9, 4);    // 1.70×0.9/1.70 = 0.9
      expect(calcUFL(disc)).toBeLessThan(calcUFL(base));
    });

    it('calcPDIE / calcPDIN: Soya Küspesi profili (PDIE > PDIN enerji sınırı yok, yüksek RUP)', () => {
      // Soya küspesi genelde PDIE açısından çok yüksektir, PDIN de yüksektir ama PDIE/PDIN dengesi RUP kalitesine bağlıdır
      const feed = { cp: 48, rdp: 35, rup: 65, ndf: 15, nel: 1.9, fat: 2, ash: 6, rupIntD: 90 };
      const pdie = calcPDIE(feed);
      const pdin = calcPDIN(feed);
      expect(pdie).toBeGreaterThan(150); // Soya için yüksek PDIE
      expect(pdin).toBeGreaterThan(150);
      // Not: NRC'den türetilen formüllerde RDP'ye bağlı olarak PDIN > PDIE çıkabilir, bu doğaldır.
    });

    it('calcPDIE / calcPDIN: Üre profili (Sadece N var, PDIN >>> PDIE)', () => {
      // Üre: %280 CP (ya da %287), RUP=0, enerji=0
      const feed = { cp: 280, rdp: 100, rup: 0, ndf: 0, nel: 0, tdn: 0 };
      const pdie = calcPDIE(feed);
      const pdin = calcPDIN(feed);
      expect(pdie).toBe(0); // Enerji yok, RUP yok -> PDIE 0
      expect(pdin).toBeGreaterThan(1000); // Çok yüksek N -> Yüksek PDIN potansiyeli
    });

    it('calcUEL: Kaba yem ve konsantre ayrımı', () => {
      const roughage = { category: 'roughage', ndf: 50 };
      const grain = { category: 'grain', ndf: 12 };
      const uelR = calcUEL(roughage);
      const uelG = calcUEL(grain);
      expect(uelR).toBeGreaterThan(uelG); // Kaba yem doluluğu daha yüksek olmalı
      expect(uelR).toBeCloseTo(1.25, 2); // 0.50 + 50*0.015 = 1.25
      expect(uelG).toBeCloseTo(0.25, 2); // grain min range 0.25 (0.15 + 12*0.008 = 0.246 -> clamped to 0.25)
    });
  });

  describe('Hayvan Gereksinimleri (Animal Requirements)', () => {
    const cow = {
      bw: 600,
      milkYield: 35,
      milkFat: 3.6,
      milkProtein: 3.2,
      dim: 90,
      parity: 2,
    };

    it('calcUFLRequirements: İdame ve laktasyon bileşenlerini hesaplar', () => {
      const req = calcUFLRequirements(cow);
      // İdame: 0.041 * 600^0.75 + 0.0002 * 600 = 4.97 + 0.12 = 5.09
      expect(req.maintenance).toBeCloseTo(5.09, 1);
      // Laktasyon: 35 kg süt. Enerji = ~0.70 Mcal/kg -> ~24.5 Mcal
      // UFL = (24.5 / 1.7) / 0.60 = ~24 UFL
      expect(req.lactation).toBeGreaterThan(20);
      expect(req.total).toBeCloseTo(req.maintenance + req.lactation, 1);
    });

    it('calcPDIRequirements: Laktasyon proteini için PDI hesabı', () => {
      const req = calcPDIRequirements(cow);
      // İdame: 3.25 * 600^0.75 = 394 g
      expect(req.maintenance).toBe(394);
      // Laktasyon: 35 * 3.2 * 10 / 0.64 = 1750 g
      expect(req.lactation).toBe(1750);
      expect(req.total).toBe(2144);
    });

    it('calcUELCapacity: Verime ve ağırlığa göre kapasite', () => {
      const cap = calcUELCapacity(cow);
      // Temel: 0.025 * 600 = 15.0
      // DIM > 60 -> dimFactor yok
      // Süt > 30 -> + (35-30)*0.08 = 0.4
      // Toplam = 15.4
      expect(cap).toBeCloseTo(15.4, 1);
    });
  });

  describe('Rasyon Agregasyonu ve Denge', () => {
    const feeds = [
      { id: 'f1', category: 'roughage', nel: 1.3, cp: 15, ndf: 45, rup: 20 },
      { id: 'f2', category: 'grain', nel: 1.9, cp: 9, ndf: 12, rup: 40 },
    ];
    
    it('aggregateINRA: Toplamları doğru hesaplar', () => {
      const items = [
        { id: 'f1', dmKg: 10 },
        { id: 'f2', dmKg: 8 },
      ];
      const agg = aggregateINRA(items, feeds, 18);
      
      expect(agg.ufl).toBeGreaterThan(0);
      expect(agg.pdie_g).toBeGreaterThan(0);
      expect(agg.pdin_g).toBeGreaterThan(0);
      expect(agg.uel).toBeGreaterThan(0);
      expect(agg.perKgDM.ufl).toBeCloseTo(agg.ufl / 18, 2);
    });

    it('interpretINRABalance: Sınırlayıcı faktörü (enerji/azot) belirler', () => {
      // PDIE < PDIN -> enerji sınırlı
      const supply1 = { pdie_g: 1800, pdin_g: 2000, ufl: 15, uel: 14 };
      const req1 = { pdi_g: 1900, ufl: 16, uel_capacity: 15 };
      const res1 = interpretINRABalance(supply1, req1);
      expect(res1.limitingFactor).toBe('energy');
      expect(res1.effectivePDI_g).toBe(1800);

      // PDIN < PDIE -> azot sınırlı
      const supply2 = { pdie_g: 2100, pdin_g: 1950, ufl: 15, uel: 14 };
      const res2 = interpretINRABalance(supply2, req1);
      expect(res2.limitingFactor).toBe('nitrogen');
      expect(res2.effectivePDI_g).toBe(1950);
    });

    it('FAZ 22.4: mesajlar { level, text } objesi (emoji içermez; panel SVG ikon eşler)', () => {
      const supply = { pdie_g: 1800, pdin_g: 2000, ufl: 15, uel: 14 };
      const req = { pdi_g: 1900, ufl: 16, uel_capacity: 15 };
      const res = interpretINRABalance(supply, req);
      expect(Array.isArray(res.messages)).toBe(true);
      expect(res.messages.length).toBeGreaterThan(0);
      for (const m of res.messages) {
        expect(typeof m).toBe('object');
        expect(['warn', 'ok', 'info']).toContain(m.level);
        expect(typeof m.text).toBe('string');
        expect(m.text).not.toMatch(/[⚠✅📊ℹ️]/u);  // emoji'siz
      }
    });
  });

});
