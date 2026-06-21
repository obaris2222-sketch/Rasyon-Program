/**
 * FAZ 16.10 — Senkron motoru testleri (mockAdapter ile, çevrimdışı).
 * push (yerel→uzak), pull (uzak→yerel), LWW çakışma çözümü, tombstone yayılımı.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import {
  _resetDB, setActiveFarmId,
  animalProfileAdd, animalProfilePut, animalProfileGetAll, animalProfileGetById,
  getDirtyRecords,
} from '../src/data/db.js';
import {
  pushStore, pullStore, syncStore, syncAll, countPendingChanges, resetSyncState,
} from '../src/data/sync/syncEngine.js';
import { createMockAdapter } from '../src/data/sync/mockAdapter.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDB();
  setActiveFarmId(null);
  resetSyncState();
});

describe('FAZ 16.10 — push (yerel → uzak)', () => {
  it('kirli kayıtları uzağa iter ve _dirty temizler', async () => {
    const adapter = createMockAdapter();
    await animalProfileAdd({ id: 'p1', name: 'A', bw: 600 });

    const { pushed } = await pushStore(adapter, 'animalProfiles');
    expect(pushed).toBe(1);

    // Uzakta var
    expect(adapter.snapshot('animalProfiles').map(r => r.id)).toContain('p1');
    // Yerelde artık kirli değil
    expect((await getDirtyRecords('animalProfiles')).length).toBe(0);
  });

  it('kirli kayıt yoksa push no-op', async () => {
    const adapter = createMockAdapter();
    const { pushed } = await pushStore(adapter, 'animalProfiles');
    expect(pushed).toBe(0);
    expect(adapter._calls.push).toBe(0);
  });

  it('push başarısız olursa _dirty korunur (yeniden denenir)', async () => {
    const failing = {
      async pushChanges() { return { ok: false, error: 'net' }; },
      async pullChanges() { return []; },
    };
    await animalProfileAdd({ id: 'p2', name: 'B', bw: 600 });
    await expect(pushStore(failing, 'animalProfiles')).rejects.toThrow();
    expect((await getDirtyRecords('animalProfiles')).length).toBe(1);  // hâlâ kirli
  });
});

describe('FAZ 16.10 — pull (uzak → yerel)', () => {
  it('uzaktaki kaydı yerele uygular', async () => {
    const adapter = createMockAdapter({
      seed: {
        animalProfiles: [
          { id: 'remote1', name: 'Uzak İnek', bw: 700, updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: null },
        ],
      },
    });
    const { applied } = await pullStore(adapter, 'animalProfiles');
    expect(applied).toBe(1);
    const p = await animalProfileGetById('remote1');
    expect(p.name).toBe('Uzak İnek');
    expect(p._dirty).toBe(false);   // uzaktan gelen kayıt kirli değil
  });

  it('ikinci pull yalnızca lastPull sonrası değişenleri çeker', async () => {
    const adapter = createMockAdapter({
      seed: { animalProfiles: [{ id: 'r1', name: 'X', updatedAt: '2026-06-01T00:00:00.000Z' }] },
    });
    await pullStore(adapter, 'animalProfiles');
    const second = await pullStore(adapter, 'animalProfiles');
    expect(second.fetched).toBe(0);   // değişiklik yok → boş
  });
});

describe('FAZ 16.10 — LWW çakışma çözümü', () => {
  it('uzak daha yeniyse yerel üzerine yazılır', async () => {
    const adapter = createMockAdapter({
      seed: { animalProfiles: [{ id: 'c1', name: 'Uzak-Yeni', updatedAt: '2099-01-01T00:00:00.000Z', deletedAt: null }] },
    });
    await animalProfileAdd({ id: 'c1', name: 'Yerel-Eski', bw: 600 });  // updatedAt ~ now < 2099

    await pullStore(adapter, 'animalProfiles');
    expect((await animalProfileGetById('c1')).name).toBe('Uzak-Yeni');
  });

  it('yerel daha yeniyse uzak yok sayılır', async () => {
    const adapter = createMockAdapter({
      seed: { animalProfiles: [{ id: 'c2', name: 'Uzak-Eski', updatedAt: '2000-01-01T00:00:00.000Z', deletedAt: null }] },
    });
    await animalProfileAdd({ id: 'c2', name: 'Yerel-Yeni', bw: 600 });  // now > 2000

    await pullStore(adapter, 'animalProfiles');
    expect((await animalProfileGetById('c2')).name).toBe('Yerel-Yeni');
  });
});

describe('FAZ 16.10 — Tombstone (silme) yayılımı', () => {
  it('uzaktan gelen tombstone yerel kaydı (filtreli) gizler', async () => {
    await animalProfileAdd({ id: 't1', name: 'Var', bw: 600 });
    expect((await animalProfileGetAll()).length).toBe(1);

    const adapter = createMockAdapter({
      seed: { animalProfiles: [
        { id: 't1', name: 'Var', deletedAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z' },
      ] },
    });
    await pullStore(adapter, 'animalProfiles');

    expect(await animalProfileGetById('t1')).toBeUndefined();
    expect((await animalProfileGetAll()).length).toBe(0);
  });

  it('yerel silme push edilince uzakta tombstone olur', async () => {
    const adapter = createMockAdapter();
    await animalProfileAdd({ id: 't2', name: 'Silinecek', bw: 600 });
    await pushStore(adapter, 'animalProfiles');           // önce ekle
    const { animalProfileDelete } = await import('../src/data/db.js');
    await animalProfileDelete('t2');                      // soft-delete
    await pushStore(adapter, 'animalProfiles');           // tombstone'u it

    const remote = adapter.snapshot('animalProfiles').find(r => r.id === 't2');
    expect(remote.deletedAt).toBeTruthy();
  });
});

describe('FAZ 16.10 — syncAll + pending count', () => {
  it('syncAll push+pull birleşik çalışır', async () => {
    const adapter = createMockAdapter({
      seed: { rations: [{ id: 'rr', name: 'Uzak Rasyon', updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: null }] },
    });
    await animalProfileAdd({ id: 'local1', name: 'Yerel', bw: 600 });

    const res = await syncAll(adapter);
    expect(res.ok).toBe(true);
    expect(res.pushed).toBeGreaterThanOrEqual(1);    // yerel profil itildi
    expect(res.applied).toBeGreaterThanOrEqual(1);   // uzak rasyon çekildi

    expect(adapter.snapshot('animalProfiles').map(r => r.id)).toContain('local1');
    const { rationGetById } = await import('../src/data/db.js');
    expect((await rationGetById('rr')).name).toBe('Uzak Rasyon');
  });

  it('countPendingChanges kirli kayıt sayısını döner', async () => {
    await animalProfileAdd({ id: 'a', name: 'A', bw: 600 });
    await animalProfileAdd({ id: 'b', name: 'B', bw: 600 });
    expect(await countPendingChanges()).toBe(2);

    const adapter = createMockAdapter();
    await syncAll(adapter);
    expect(await countPendingChanges()).toBe(0);   // hepsi senkronlandı
  });
});
