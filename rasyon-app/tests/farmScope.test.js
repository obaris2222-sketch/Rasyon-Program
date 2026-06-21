/**
 * FAZ 16.11 — Çiftlik kapsamı (farm-scoped reads) + kademeli silme testleri.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import {
  _resetDB, setActiveFarmId,
  animalProfileAdd, animalProfileGetAll,
  farmAdd, farmGetById, farmPut, farmDeleteCascade, getDirtyRecords, getActiveFarm,
} from '../src/data/db.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDB();
  setActiveFarmId(null);
});

describe('FAZ 16.11 — Çiftlik kapsamı', () => {
  it('kayıtlar aktif çiftliğe göre kapsamlanır', async () => {
    setActiveFarmId('farm-A');
    await animalProfileAdd({ name: 'A-inek', bw: 600 });
    setActiveFarmId('farm-B');
    await animalProfileAdd({ name: 'B-inek', bw: 600 });

    setActiveFarmId('farm-A');
    expect((await animalProfileGetAll()).map(p => p.name)).toEqual(['A-inek']);

    setActiveFarmId('farm-B');
    expect((await animalProfileGetAll()).map(p => p.name)).toEqual(['B-inek']);
  });

  it('aktif çiftlik yokken tüm kayıtlar görünür (test/legacy)', async () => {
    setActiveFarmId('farm-A'); await animalProfileAdd({ name: 'A', bw: 600 });
    setActiveFarmId('farm-B'); await animalProfileAdd({ name: 'B', bw: 600 });
    setActiveFarmId(null);
    expect((await animalProfileGetAll()).length).toBe(2);
  });

  it('farmId\'siz (null) eski kayıtlar her çiftlikte görünür (backfill güvenliği)', async () => {
    setActiveFarmId(null);
    await animalProfileAdd({ name: 'legacy', bw: 600 });   // farmId null
    setActiveFarmId('farm-X');
    expect((await animalProfileGetAll()).some(p => p.name === 'legacy')).toBe(true);
  });
});

describe('FAZ 16.11 — farmDeleteCascade', () => {
  it('çiftliği + ona ait tüm kayıtları soft-delete eder', async () => {
    const f = await farmAdd({ name: 'Çiftlik1' });
    setActiveFarmId(f.id);
    await animalProfileAdd({ name: 'c1', bw: 600 });
    await animalProfileAdd({ name: 'c2', bw: 600 });

    const n = await farmDeleteCascade(f.id);
    expect(n).toBe(2);                                       // 2 profil tombstone
    expect((await animalProfileGetAll()).length).toBe(0);   // hepsi gizli
    expect(await farmGetById(f.id)).toBeUndefined();         // çiftlik gitti
  });

  it('silinen çiftlik + kayıtlar dirty (senkronla yayılır)', async () => {
    const f = await farmAdd({ name: 'Çiftlik2' });
    setActiveFarmId(f.id);
    await animalProfileAdd({ name: 'x', bw: 600 });
    await farmDeleteCascade(f.id);

    const dirtyProfiles = await getDirtyRecords('animalProfiles');
    const dirtyFarms = await getDirtyRecords('farms');
    expect(dirtyProfiles.find(r => r.deletedAt)).toBeTruthy();   // profil tombstone dirty
    expect(dirtyFarms.find(r => r.id === f.id && r.deletedAt)).toBeTruthy();  // çiftlik tombstone dirty
  });
});

describe('FAZ 16.11/2.3 — getActiveFarm + çiftlik profili', () => {
  it('getActiveFarm aktif çiftliği döner, yoksa null', async () => {
    setActiveFarmId(null);
    expect(await getActiveFarm()).toBe(null);
    const f = await farmAdd({ name: 'Aktif Çiftlik' });
    setActiveFarmId(f.id);
    expect((await getActiveFarm())?.id).toBe(f.id);
  });

  it('çiftlik profil alanları (adres/danışman/bilim sistemi) saklanır', async () => {
    const f = await farmAdd({ name: 'Profil Çiftliği' });
    await farmPut({ ...f, address: 'Konya Yolu 5', advisor: 'Dr. Vet', science: 'NRC2001' });
    const got = await farmGetById(f.id);
    expect(got.address).toBe('Konya Yolu 5');
    expect(got.advisor).toBe('Dr. Vet');
    expect(got.science).toBe('NRC2001');
  });
});
