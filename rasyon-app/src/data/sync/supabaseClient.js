/**
 * Supabase İstemci (FAZ 16.10 — Aşama 1) — tembel (lazy) yükleme.
 *
 * `@supabase/supabase-js` (~110 KB) yalnızca bulut gerçekten kullanıldığında
 * (giriş/senkron) indirilir → çevrimdışı-yalnız kullanıcı bu maliyeti ödemez.
 *
 * Yapılandırma `.env` üzerinden (Vite `import.meta.env`):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * Anon/publishable anahtar herkese-açık güvenlidir — koruma RLS ile DB'de.
 */

let _clientPromise = null;

/** `.env` değerlerini güvenli okur (test/Node ortamında import.meta.env yoksa boş). */
function env() {
  try {
    return import.meta.env || {};
  } catch {
    return {};
  }
}

/** Bulut yapılandırılmış mı? (URL + anahtar var ve placeholder değil) */
export function isCloudConfigured() {
  const e = env();
  const url = e.VITE_SUPABASE_URL;
  const key = e.VITE_SUPABASE_ANON_KEY;
  return !!(url && key && !String(url).includes('YOUR-') && !String(key).includes('YOUR-'));
}

/**
 * Supabase istemcisini döndürür (singleton, tembel). Yapılandırma yoksa null.
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient|null>}
 */
export function getSupabaseClient() {
  if (!isCloudConfigured()) return Promise.resolve(null);
  if (!_clientPromise) {
    const e = env();
    _clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(
        e.VITE_SUPABASE_URL,
        e.VITE_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,       // oturum localStorage'da kalır → çevrimdışı kimlik
            autoRefreshToken: true,     // çevrimiçi olunca JWT yenilenir
            detectSessionInUrl: false,  // e-posta/şifre akışı (magic-link URL'i yok)
          },
        },
      ))
      .catch((err) => {
        console.warn('[cloud] Supabase istemcisi yüklenemedi:', err);
        _clientPromise = null;
        return null;
      });
  }
  return _clientPromise;
}

/** Test/yaşam döngüsü temizliği. */
export function _resetSupabaseClient() {
  _clientPromise = null;
}
