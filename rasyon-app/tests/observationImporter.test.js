import { describe, it, expect } from 'vitest';
import { parseObservationCSV, parseObservationJSON, parseObservationFile, detectDelimiter, parseCSVLine } from '../src/core/observationImporter.js';

describe('observationImporter', () => {
  describe('detectDelimiter', () => {
    it('Sütunları virgüle göre ayırır', () => {
      expect(detectDelimiter('Date,Milk Yield,Fat,Protein')).toBe(',');
    });
    it('Sütunları noktalı virgüle göre ayırır', () => {
      expect(detectDelimiter('Date;Milk Yield;Fat;Protein')).toBe(';');
    });
  });

  describe('parseCSVLine', () => {
    it('Temel ayrıştırma yapar', () => {
      expect(parseCSVLine('A,B,C', ',')).toEqual(['A', 'B', 'C']);
    });
    it('Boşlukları kırpar', () => {
      expect(parseCSVLine(' A , B , C ', ',')).toEqual(['A', 'B', 'C']);
    });
    it('Tırnak içindeki ayraçları görmezden gelir', () => {
      expect(parseCSVLine('A,"B, B",C', ',')).toEqual(['A', 'B, B', 'C']);
    });
  });

  describe('parseObservationCSV', () => {
    it('Doğru formatta veriyi ayrıştırır (virgüllü, EN başlıklar)', () => {
      const csv = `Date,Milk Yield,Fat,Protein,BCS,DMI,Notes
2026-06-01,35.5,3.8,3.2,3.0,22.0,"Test Note"
2026-06-08,36.0,3.9,3.3,3.25,23.5,"Second Note"`;

      const { results, errors } = parseObservationCSV(csv);
      
      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(2);
      
      expect(results[0].milkYield).toBe(35.5);
      expect(results[0].milkFat).toBe(3.8);
      expect(results[0].milkProtein).toBe(3.2);
      expect(results[0].bcs).toBe(3.0);
      expect(results[0].dmiActual).toBe(22.0);
      expect(results[0].notes).toBe('Test Note');
      // ISO date string
      expect(results[0].date).toContain('2026-06-01');

      expect(results[1].milkYield).toBe(36.0);
    });

    it('Türkçe başlıklar ve noktalı virgül destekler', () => {
      const csv = `Tarih;Süt;Yağ;Prot;Kondisyon;DMI;Notlar
15.05.2026;30,5;4,0;3,4;2,75;20,0;`;

      const { results, errors } = parseObservationCSV(csv);
      
      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(1);
      
      expect(results[0].milkYield).toBe(30.5); // virgül ayracı parse edildi
      expect(results[0].milkFat).toBe(4.0);
      expect(results[0].milkProtein).toBe(3.4);
      expect(results[0].bcs).toBe(2.75);
      expect(results[0].dmiActual).toBe(20.0);
      expect(results[0].date).toContain('2026-05-15');
    });

    it('Bozuk satırları hata listesine ekler', () => {
      const csv = `Date,Milk
2026-06-01,35.5
,
invalid_line_no_data
2026-06-02,36.0`;

      const { results, errors } = parseObservationCSV(csv);
      expect(results).toHaveLength(2); // 1. ve 4. satırlar geçerli veriler
      expect(errors.length).toBeGreaterThan(0);
    });

    it('Sütunları tanıyamazsa hata fırlatır', () => {
      const csv = `A,B,C
1,2,3`;
      expect(() => parseObservationCSV(csv)).toThrow('Sütun başlıkları anlaşılamadı');
    });
  });

  // FAZ 16.13 denetim düzeltmesi: JSON import (MilkoScan/Bentley/çiftlik yazılımı)
  describe('parseObservationJSON', () => {
    it('Doğrudan dizi (EN anahtarlar) ayrıştırır', () => {
      const json = JSON.stringify([
        { date: '2026-06-01', milkYield: 35.5, fat: 3.8, protein: 3.2, bcs: 3.0, dmi: 22, notes: 'Test' },
        { date: '2026-06-08', 'Milk Yield': 36.0 },
      ]);
      const { results, errors } = parseObservationJSON(json);
      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(2);
      expect(results[0].milkYield).toBe(35.5);
      expect(results[0].milkFat).toBe(3.8);
      expect(results[0].milkProtein).toBe(3.2);
      expect(results[0].bcs).toBe(3.0);
      expect(results[0].dmiActual).toBe(22);
      expect(results[0].notes).toBe('Test');
      expect(results[0].date).toContain('2026-06-01');
      expect(results[1].milkYield).toBe(36.0);
    });

    it('Sarmalı nesne ({ observations: [...] }) + Türkçe anahtar + virgül ondalık', () => {
      const json = JSON.stringify({ observations: [{ Tarih: '15.05.2026', 'Süt Verimi': '30,5', 'Yağ': '4,0' }] });
      const { results } = parseObservationJSON(json);
      expect(results).toHaveLength(1);
      expect(results[0].milkYield).toBe(30.5);
      expect(results[0].milkFat).toBe(4.0);
      expect(results[0].date).toContain('2026-05-15');
    });

    it('Zaten parse edilmiş diziyi de kabul eder', () => {
      const { results } = parseObservationJSON([{ milkYield: 28 }]);
      expect(results).toHaveLength(1);
      expect(results[0].milkYield).toBe(28);
    });

    it('Geçersiz JSON metni hata fırlatır', () => {
      expect(() => parseObservationJSON('{ not valid')).toThrow('Geçersiz JSON');
    });

    it('Gözlem dizisi yoksa hata fırlatır', () => {
      expect(() => parseObservationJSON(JSON.stringify({ foo: 'bar' }))).toThrow('gözlem dizisi bulunamadı');
    });
  });

  describe('parseObservationFile (CSV/JSON yönlendirme)', () => {
    it('.json uzantısını JSON parser\'a yönlendirir', () => {
      const { results } = parseObservationFile('[{"milkYield": 40}]', 'milk.json');
      expect(results[0].milkYield).toBe(40);
    });
    it('.csv uzantısını CSV parser\'a yönlendirir', () => {
      const { results } = parseObservationFile('Date,Milk\n2026-06-01,33', 'data.csv');
      expect(results[0].milkYield).toBe(33);
    });
    it('Uzantısız ama içerik JSON ise JSON parser kullanır', () => {
      const { results } = parseObservationFile('  [{"milkYield": 21}]');
      expect(results[0].milkYield).toBe(21);
    });
  });
});
