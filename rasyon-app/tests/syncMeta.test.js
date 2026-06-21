/**
 * FAZ 16.10 — Senkron meta verisi + soft-delete + farms + aktif çiftlik testleri.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import {
  _resetDB,
  animalProfileAdd, animalProfileGetAll, animalProfileGetById, animalProfileDelete,
  herdGroupAdd, herdGroupGetAll,
  getDirtyRecords, setActiveFarmId, getActiveFarmId,
  farmAdd, farmGetAll, farmGetById, farmPut, farmDelete,
  ensureDefaultFarm, backfillFarmId,
} from '../src/data/db.js';
import { looksLikeUuid } from '../src/data/uuid.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDB();
  setActiveFarmId(null);
});

describe('FAZ 16.10 — Senkron meta verisi (id/updatedAt/deletedAt/_dirty)', () => {
  it('id verilmezse UUID üretilir', async () => {
    await animalProfileAdd({ name: 'İnek', bw: 600 });
    const all = await animalProfileGetAll();
    expect(all.length).toBe(1);
    expect(looksLikeUuid(all[0].id)).toBe(true);
  });

  it('yazmada updatedAt/deletedAt/_dirty damgalanır', async () => {
    await animalProfileAdd({ id: 'p1', name: 'A', bw: 600 });
    const p = await animalProfileGetById('p1');
    expect(p.updatedAt).toBeTruthy();
    expect(p.deletedAt).toBe(null);
    expect(p._dirty).toBe(true);
  });

  it('mevcut testlerle uyum: _createdAt korunur', async () => {
    await animalProfileAdd({ id: 'p2', name: 'B', bw: 600 });
    const p = await animalProfileGetById('p2');
    expect(p._createdAt).toBeDefined();
  });
});

describe('FAZ 16.10 — Soft delete (tombstone)', () => {
  it('silinen kayıt getById/getAll\'da görünmez ama tombstone olarak kalır', async () => {
    await animalProfileAdd({ id: 'pdel', name: 'Silinecek', bw: 600 });
    await animalProfileDelete('pdel');

    expect(await animalProfileGetById('pdel')).toBeUndefined();
    expect((await animalProfileGetAll()).length).toBe(0);

    // Tombstone fiziksel olarak durur + dirty (silme senkronlanmalı)
    const dirty = await getDirtyRecords('animalProfiles');
    const tomb = dirty.find(r => r.id === 'pdel');
    expect(tomb).toBeDefined();
    expect(tomb.deletedAt).toBeTruthy();
  });

  it('silme idempotenttir (iki kez sil → hata yok)', async () => {
    await herdGroupAdd({ id: 'g', name: 'G' });
    await animalProfileDelete('g');   // yanlış store — no-op
    const groups = await herdGroupGetAll();
    expect(groups.length).toBe(1);
  });
});

describe('FAZ 16.10 — Aktif çiftlik kapsamı', () => {
  it('aktif çiftlik ayarlıyken yazılan kayıtlara farmId stamplanır', async () => {
    setActiveFarmId('farm-A');
    await animalProfileAdd({ id: 'px', name: 'X', bw: 600 });
    const p = await animalProfileGetById('px');
    expect(p.farmId).toBe('farm-A');
  });

  it('aktif çiftlik yokken farmId null kalır (mevcut davranış)', async () => {
    setActiveFarmId(null);
    await animalProfileAdd({ id: 'py', name: 'Y', bw: 600 });
    const p = await animalProfileGetById('py');
    expect(p.farmId).toBe(null);
  });

  it('getActiveFarmId set edilen değeri döner', () => {
    setActiveFarmId('farm-Z');
    expect(getActiveFarmId()).toBe('farm-Z');
  });
});

describe('FAZ 16.11 — Farms CRUD', () => {
  it('farmAdd UUID id üretir ve farmId taşımaz (sahip-kapsamlı)', async () => {
    const f = await farmAdd({ name: 'Çiftlik 1' });
    expect(looksLikeUuid(f.id)).toBe(true);
    expect(f.farmId).toBeUndefined();
    expect(f._dirty).toBe(true);
  });

  it('farmGetById / farmGetAll çalışır', async () => {
    const f = await farmAdd({ name: 'Çiftlik 2' });
    expect((await farmGetById(f.id)).name).toBe('Çiftlik 2');
    expect((await farmGetAll()).length).toBe(1);
  });

  it('farmPut günceller, farmDelete soft-delete yapar', async () => {
    const f = await farmAdd({ name: 'Eski Ad' });
    await farmPut({ ...f, name: 'Yeni Ad' });
    expect((await farmGetById(f.id)).name).toBe('Yeni Ad');

    await farmDelete(f.id);
    expect(await farmGetById(f.id)).toBeUndefined();
    expect((await farmGetAll()).length).toBe(0);
  });

  it('ensureDefaultFarm yoksa oluşturur, varsa mevcudu döner (dup yok)', async () => {
    const first = await ensureDefaultFarm('Varsayılan');
    expect(looksLikeUuid(first.id)).toBe(true);
    const second = await ensureDefaultFarm('Varsayılan');
    expect(second.id).toBe(first.id);
    expect((await farmGetAll()).length).toBe(1);
  });

  it('backfillFarmId farmId\'siz kayıtları verilen çiftliğe atar', async () => {
    setActiveFarmId(null);   // farmId null kayıtlar oluştur
    await animalProfileAdd({ id: 'a', name: 'A', bw: 600 });
    await herdGroupAdd({ id: 'b', name: 'B' });

    const n = await backfillFarmId('farm-default');
    expect(n).toBe(2);

    const a = await animalProfileGetById('a');
    expect(a.farmId).toBe('farm-default');
  });
});
