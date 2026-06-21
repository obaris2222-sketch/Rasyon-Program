/**
 * FAZ 16.10 — Supabase adaptörü sözleşme testleri (sahte client ile, ağsız).
 * Kayıt ↔ satır eşlemesi, owner_id/farm_id, tombstone, since filtresi, hata yolu.
 */

import { describe, it, expect } from 'vitest';
import { createSupabaseAdapter, TABLE_MAP } from '../src/data/sync/supabaseAdapter.js';

/** Supabase query-builder davranışını taklit eden sahte client. */
function createFakeClient({ failUpsert = false } = {}) {
  const tables = {};
  return {
    _tables: tables,
    from(table) {
      if (!tables[table]) tables[table] = new Map();
      const store = tables[table];
      let since = null;
      const builder = {
        upsert(rows) {
          if (failUpsert) return Promise.resolve({ error: { message: 'net hata' } });
          for (const r of rows) store.set(r.id, { ...r });
          return Promise.resolve({ error: null });
        },
        select() { return builder; },
        gt(_col, val) { since = val; return builder; },
        then(res, rej) {
          let rows = [...store.values()];
          if (since) rows = rows.filter(r => (r.updated_at || '') > since);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return builder;
    },
  };
}

describe('FAZ 16.10 — Supabase adaptörü', () => {
  it('TABLE_MAP store adlarını tablo adlarına eşler', () => {
    expect(TABLE_MAP.animalProfiles).toBe('animal_profiles');
    expect(TABLE_MAP.herdGroups).toBe('herd_groups');
    expect(TABLE_MAP.farms).toBe('farms');
  });

  it('pushChanges kaydı satıra çevirir (owner_id + farm_id + data)', async () => {
    const client = createFakeClient();
    const adapter = createSupabaseAdapter(client, 'user-1');
    const rec = { id: 'p1', name: 'İnek', farmId: 'farm-1', updatedAt: '2026-06-06T10:00:00.000Z', deletedAt: null, _dirty: true };

    const res = await adapter.pushChanges('animalProfiles', [rec]);
    expect(res.ok).toBe(true);

    const row = client._tables['animal_profiles'].get('p1');
    expect(row.owner_id).toBe('user-1');
    expect(row.farm_id).toBe('farm-1');
    expect(row.updated_at).toBe('2026-06-06T10:00:00.000Z');
    expect(row.deleted_at).toBe(null);
    expect(row.data.name).toBe('İnek');
    expect(row.data._dirty).toBeUndefined();   // yerel bayrak uzağa gitmez
  });

  it('farms satırında farm_id sütunu yoktur (sahip-kapsamlı)', async () => {
    const client = createFakeClient();
    const adapter = createSupabaseAdapter(client, 'user-1');
    await adapter.pushChanges('farms', [{ id: 'f1', name: 'Çiftlik', updatedAt: '2026-06-06T10:00:00.000Z' }]);
    const row = client._tables['farms'].get('f1');
    expect(row.farm_id).toBeUndefined();
    expect(row.owner_id).toBe('user-1');
  });

  it('pullChanges satırı kayda geri çevirir', async () => {
    const client = createFakeClient();
    const adapter = createSupabaseAdapter(client, 'user-1');
    await adapter.pushChanges('animalProfiles', [
      { id: 'p2', name: 'Uzak', farmId: 'farm-9', updatedAt: '2026-06-06T11:00:00.000Z', deletedAt: null },
    ]);
    const pulled = await adapter.pullChanges('animalProfiles', null);
    expect(pulled.length).toBe(1);
    expect(pulled[0].id).toBe('p2');
    expect(pulled[0].name).toBe('Uzak');
    expect(pulled[0].farmId).toBe('farm-9');
    expect(pulled[0].updatedAt).toBe('2026-06-06T11:00:00.000Z');
  });

  it('tombstone (deletedAt) push + pull edilir', async () => {
    const client = createFakeClient();
    const adapter = createSupabaseAdapter(client, 'user-1');
    await adapter.pushChanges('rations', [
      { id: 'r1', name: 'Silindi', updatedAt: '2026-06-06T12:00:00.000Z', deletedAt: '2026-06-06T12:00:00.000Z' },
    ]);
    const row = client._tables['rations'].get('r1');
    expect(row.deleted_at).toBe('2026-06-06T12:00:00.000Z');
    const pulled = await adapter.pullChanges('rations', null);
    expect(pulled[0].deletedAt).toBe('2026-06-06T12:00:00.000Z');
  });

  it('since filtresi yalnızca sonraki kayıtları döner', async () => {
    const client = createFakeClient();
    const adapter = createSupabaseAdapter(client, 'user-1');
    await adapter.pushChanges('animalProfiles', [
      { id: 'old', name: 'Eski', updatedAt: '2026-06-01T00:00:00.000Z' },
      { id: 'new', name: 'Yeni', updatedAt: '2026-06-10T00:00:00.000Z' },
    ]);
    const pulled = await adapter.pullChanges('animalProfiles', '2026-06-05T00:00:00.000Z');
    expect(pulled.map(r => r.id)).toEqual(['new']);
  });

  it('upsert hatasında { ok:false } döner (push retry için)', async () => {
    const client = createFakeClient({ failUpsert: true });
    const adapter = createSupabaseAdapter(client, 'user-1');
    const res = await adapter.pushChanges('animalProfiles', [{ id: 'x', updatedAt: '2026-06-06T00:00:00.000Z' }]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('net hata');
  });

  it('bilinmeyen store sessizce atlanır', async () => {
    const client = createFakeClient();
    const adapter = createSupabaseAdapter(client, 'user-1');
    const res = await adapter.pushChanges('unknownStore', [{ id: 'z' }]);
    expect(res).toEqual({ ok: true, count: 0 });
    expect(await adapter.pullChanges('unknownStore', null)).toEqual([]);
  });
});
