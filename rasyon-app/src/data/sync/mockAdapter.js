/**
 * Mock Senkron Adaptörü (FAZ 16.10) — bellek-içi "bulut".
 *
 * syncEngine'i Supabase olmadan test etmek için. Gerçek bir uzak depo gibi
 * davranır: pushChanges yazar (uzak LWW ile), pullChanges sinceTimestamp'tan
 * sonra değişenleri döner. Birden çok engine aynı adaptör örneğini paylaşarak
 * "çok cihazlı" senaryo simüle edebilir.
 */

/**
 * @param {object} [opts]
 *   @param {object} [opts.seed] — { storeName: record[] } başlangıç uzak veri
 * @returns {{pushChanges, pullChanges, _remote, _calls, snapshot}}
 */
export function createMockAdapter({ seed = {} } = {}) {
  /** @type {Record<string, Map<string,object>>} */
  const remote = {};
  const calls = { push: 0, pull: 0 };

  function store(name) {
    if (!remote[name]) remote[name] = new Map();
    return remote[name];
  }

  // Başlangıç verisini yükle
  for (const [name, recs] of Object.entries(seed)) {
    const m = store(name);
    for (const r of recs) if (r && r.id) m.set(r.id, { ...r });
  }

  return {
    _remote: remote,
    _calls: calls,

    async pushChanges(storeName, records) {
      calls.push++;
      const m = store(storeName);
      for (const r of records || []) {
        if (!r || !r.id) continue;
        const existing = m.get(r.id);
        // Uzak da LWW uygular: yalnızca gelen ≥ mevcut ise üzerine yaz
        if (!existing || (r.updatedAt || '') >= (existing.updatedAt || '')) {
          const { _dirty, ...clean } = r;       // _dirty yereldir, uzağa gitmez
          m.set(r.id, { ...clean });
        }
      }
      return { ok: true, count: (records || []).length };
    },

    async pullChanges(storeName, since) {
      calls.pull++;
      const m = store(storeName);
      const out = [];
      for (const r of m.values()) {
        if (!since || (r.updatedAt || '') > since) out.push({ ...r });
      }
      return out;
    },

    /** Test yardımcı: bir store'un uzak içeriğini dizi olarak döndür. */
    snapshot(storeName) {
      return [...store(storeName).values()].map(r => ({ ...r }));
    },
  };
}
