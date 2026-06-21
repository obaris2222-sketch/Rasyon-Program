/**
 * FAZ 5B+C — Hayvan profili ve Sürü grubu CRUD testleri
 * IndexedDB üzerinden (fake-indexeddb polyfill)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  animalProfileGetAll, animalProfileGetById,
  animalProfileAdd, animalProfilePut, animalProfileDelete,
  herdGroupGetAll, herdGroupGetById,
  herdGroupAdd, herdGroupPut, herdGroupDelete,
} from '../src/data/db.js';

// Test izolasyonu: her test öncesi tüm profile/herd kayıtlarını sil
async function clearProfilesAndGroups() {
  const profs = await animalProfileGetAll();
  for (const p of profs) await animalProfileDelete(p.id);
  const grps = await herdGroupGetAll();
  for (const g of grps) await herdGroupDelete(g.id);
}

describe('Hayvan Profili CRUD (FAZ 5B)', () => {
  beforeEach(async () => {
    await clearProfilesAndGroups();
  });

  it('boş veritabanı animalProfileGetAll → []', async () => {
    const all = await animalProfileGetAll();
    expect(all).toEqual([]);
  });

  it('animalProfileAdd → kaydeder ve getById ile alınır', async () => {
    const profile = {
      id: 'prof_1',
      name: 'Yüksek-Verim-Erken-DIM',
      bw: 650, milkYield: 40, milkFat: 3.6, milkProtein: 3.1,
      parity: 2, dim: 60, bcs: 3.0,
      pregnant: false, lactationStage: 'early',
    };
    await animalProfileAdd(profile);
    const got = await animalProfileGetById('prof_1');
    expect(got).not.toBeUndefined();
    expect(got.name).toBe('Yüksek-Verim-Erken-DIM');
    expect(got.milkYield).toBe(40);
    expect(got._createdAt).toBeDefined();
  });

  it('animalProfilePut → günceller (upsert)', async () => {
    const p = { id: 'prof_2', name: 'A', bw: 600, milkYield: 30 };
    await animalProfileAdd(p);
    await animalProfilePut({ ...p, milkYield: 35 });
    const got = await animalProfileGetById('prof_2');
    expect(got.milkYield).toBe(35);
    expect(got._updatedAt).toBeDefined();
  });

  it('animalProfileDelete → kayıt silinir', async () => {
    await animalProfileAdd({ id: 'prof_3', name: 'X', bw: 600 });
    await animalProfileDelete('prof_3');
    const got = await animalProfileGetById('prof_3');
    expect(got).toBeUndefined();
  });

  it('animalProfileGetAll → tüm kayıtları döner', async () => {
    await animalProfileAdd({ id: 'p1', name: 'A', bw: 600 });
    await animalProfileAdd({ id: 'p2', name: 'B', bw: 700 });
    await animalProfileAdd({ id: 'p3', name: 'C', bw: 550 });
    const all = await animalProfileGetAll();
    expect(all.length).toBe(3);
    expect(all.map(p => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('lactationStage alanı korunur (FAZ 5D)', async () => {
    await animalProfileAdd({
      id: 'pclose', name: 'Close-up', bw: 700,
      pregnant: true, pregnancyMonth: 9, lactationStage: 'close_up',
    });
    const got = await animalProfileGetById('pclose');
    expect(got.lactationStage).toBe('close_up');
    expect(got.pregnancyMonth).toBe(9);
  });

  it('groupId ile sürü grubu bağlantısı korunur (FAZ 5C)', async () => {
    await animalProfileAdd({
      id: 'plinked', name: 'Linked', bw: 650, groupId: 'grp_high',
    });
    const got = await animalProfileGetById('plinked');
    expect(got.groupId).toBe('grp_high');
  });
});

describe('Sürü Grubu CRUD (FAZ 5C)', () => {
  beforeEach(async () => {
    await clearProfilesAndGroups();
  });

  it('boş veritabanı herdGroupGetAll → []', async () => {
    const all = await herdGroupGetAll();
    expect(all).toEqual([]);
  });

  it('herdGroupAdd → kaydeder', async () => {
    await herdGroupAdd({
      id: 'grp_high', name: 'Yüksek Verimli',
      description: 'DIM 0-100, >30 kg/gün', animalCount: 25,
    });
    const got = await herdGroupGetById('grp_high');
    expect(got.name).toBe('Yüksek Verimli');
    expect(got.animalCount).toBe(25);
  });

  it('herdGroupPut → günceller', async () => {
    await herdGroupAdd({ id: 'g', name: 'Test', animalCount: 10 });
    await herdGroupPut({ id: 'g', name: 'Test', animalCount: 15 });
    const got = await herdGroupGetById('g');
    expect(got.animalCount).toBe(15);
  });

  it('herdGroupDelete → kayıt silinir', async () => {
    await herdGroupAdd({ id: 'gdel', name: 'Del' });
    await herdGroupDelete('gdel');
    const got = await herdGroupGetById('gdel');
    expect(got).toBeUndefined();
  });

  it('Çoklu grup desteği', async () => {
    await herdGroupAdd({ id: 'g1', name: 'Yüksek',  animalCount: 20 });
    await herdGroupAdd({ id: 'g2', name: 'Orta',    animalCount: 30 });
    await herdGroupAdd({ id: 'g3', name: 'Kuru',    animalCount: 15 });
    await herdGroupAdd({ id: 'g4', name: 'Geçiş',   animalCount: 10 });
    const all = await herdGroupGetAll();
    expect(all.length).toBe(4);
    const totalAnimals = all.reduce((s, g) => s + (g.animalCount || 0), 0);
    expect(totalAnimals).toBe(75);
  });
});
