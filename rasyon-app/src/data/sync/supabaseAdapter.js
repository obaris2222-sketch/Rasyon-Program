/**
 * Supabase Senkron Adaptörü (FAZ 16.10 — Aşama 1).
 *
 * `SyncAdapter` arayüzünü Supabase (Postgres) ile uygular. syncEngine ile
 * birlikte çalışır. Kayıt ↔ satır eşlemesi:
 *   satır: { id, owner_id, farm_id, updated_at, deleted_at, data(jsonb) }
 *   data  = kaydın TAMAMI (id/updatedAt/deletedAt/farmId dahil; _dirty hariç)
 *
 * LWW tutarlılığı: hem `updated_at` sütunu hem data.updatedAt istemcinin ISO
 * zaman damgasıdır (`toISOString`) → pull filtresi (.gt) ve yerel karşılaştırma
 * aynı zaman uzayında çalışır.
 */

/** IndexedDB store → Supabase tablo adı. */
export const TABLE_MAP = {
  animalProfiles: 'animal_profiles',
  rations: 'rations',
  herdGroups: 'herd_groups',
  feedPriceHistory: 'feed_price_history',
  fieldObservations: 'field_observations',
  farms: 'farms',
  userFeeds: 'user_feeds',   // FAZ 16.11 — advisor-global kullanıcı yemleri
};

/** Sahip-kapsamlı (farm_id taşımayan) store'lar: çiftlikler + kullanıcı yemleri. */
const OWNER_SCOPED = new Set(['farms', 'userFeeds']);

/** Yerel-yalnız alanları (_dirty) temizleyip data payload'u üretir. */
function toData(rec) {
  const { _dirty, ...rest } = rec;
  return rest;
}

/**
 * Supabase adaptörü oluştur.
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} userId — giriş yapan kullanıcının id'si (owner_id)
 * @returns {{pushChanges, pullChanges}}
 */
export function createSupabaseAdapter(client, userId) {
  return {
    async pushChanges(storeName, records) {
      const table = TABLE_MAP[storeName];
      if (!table || !records || records.length === 0) return { ok: true, count: 0 };

      const ownerScoped = OWNER_SCOPED.has(storeName);
      const rows = records.map((r) => {
        const row = {
          id: r.id,
          owner_id: userId,
          updated_at: r.updatedAt || new Date().toISOString(),
          deleted_at: r.deletedAt ?? null,
          data: toData(r),
        };
        if (!ownerScoped) row.farm_id = r.farmId ?? null;
        return row;
      });

      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
      if (error) return { ok: false, error: error.message };
      return { ok: true, count: rows.length };
    },

    async pullChanges(storeName, since) {
      const table = TABLE_MAP[storeName];
      if (!table) return [];

      let query = client.from(table).select('*');
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return (data || []).map((row) => ({
        ...(row.data || {}),
        id: row.id,
        farmId: row.farm_id ?? row.data?.farmId ?? null,
        // LWW için istemci ISO'su (data) önceliklidir; yoksa sütuna düşer
        updatedAt: row.data?.updatedAt || row.updated_at,
        deletedAt: row.deleted_at ?? row.data?.deletedAt ?? null,
      }));
    },
  };
}
