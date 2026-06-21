/**
 * FAZ 16.11 — Kullanıcı yemi senkronu (advisor-global) testleri.
 * Kullanıcı yemleri buluta senkronlanır; paketli 500-yem seed kütüphanesi YEREL kalır.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import {
  _resetDB, setActiveFarmId,
  feedAdd, feedGetAll, feedGetById, feedDelete, getDirtyRecords,
} from '../src/data/db.js';
import { syncAll, resetSyncState } from '../src/data/sync/syncEngine.js';
import { createMockAdapter } from '../src/data/sync/mockAdapter.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDB();
  setActiveFarmId(null);
  resetSyncState();
});

describe('FAZ 16.11 — Kullanıcı yemi senkronu', () => {
  it('kullanıcı yemi senkron meta\'sı + dirty alır; seed yem almaz', async () => {
    await feedAdd({ id: 'user_x', name: 'Özel Yem', category: 'grain', dm: 88, source: 'user' });
    await feedAdd({ id: 'nrc_corn', name: 'Mısır', category: 'grain', dm: 88 });   // seed
    const dirty = await getDirtyRecords('userFeeds');
    expect(dirty.map(f => f.id)).toEqual(['user_x']);   // yalnız kullanıcı yemi
  });

  it('seed kütüphanesi senkronlanmaz', async () => {
    await feedAdd({ id: 'nrc_corn', name: 'Mısır', category: 'grain', dm: 88 });
    const adapter = createMockAdapter();
    await syncAll(adapter);
    expect(adapter.snapshot('userFeeds').length).toBe(0);   // seed itilmedi
  });

  it('kullanıcı yemi buluta push edilir + dirty temizlenir', async () => {
    await feedAdd({ id: 'user_y', name: 'Yöresel Silaj', category: 'roughage', dm: 30, source: 'user' });
    const adapter = createMockAdapter();
    await syncAll(adapter);
    expect(adapter.snapshot('userFeeds').some(f => f.id === 'user_y')).toBe(true);
    expect((await getDirtyRecords('userFeeds')).length).toBe(0);   // synced
  });

  it('uzaktaki kullanıcı yemi yerel feeds store\'una pull edilir', async () => {
    const adapter = createMockAdapter({
      seed: { userFeeds: [
        { id: 'user_remote', name: 'Uzak Yem', category: 'protein', dm: 90, source: 'user', updatedAt: '2026-06-06T00:00:00.000Z', deletedAt: null },
      ] },
    });
    await syncAll(adapter);
    const f = await feedGetById('user_remote');
    expect(f?.name).toBe('Uzak Yem');
  });

  it('kullanıcı yemi silme soft (tombstone) + yayılır', async () => {
    await feedAdd({ id: 'user_del', name: 'Silinecek', category: 'grain', dm: 88, source: 'user' });
    await feedDelete('user_del');
    expect(await feedGetById('user_del')).toBeUndefined();                  // gizli
    expect((await feedGetAll()).some(f => f.id === 'user_del')).toBe(false);
    const dirty = await getDirtyRecords('userFeeds');
    expect(dirty.find(f => f.id === 'user_del')?.deletedAt).toBeTruthy();   // tombstone dirty
  });
});
