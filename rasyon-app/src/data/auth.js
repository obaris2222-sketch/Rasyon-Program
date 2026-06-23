/**
 * Kimlik Doğrulama (FAZ 16.10 — Aşama 1) — Supabase Auth sarmalayıcı.
 *
 * E-posta + şifre. Oturum SDK tarafından localStorage'da kalıcıdır →
 * bir kez giriş yapınca çevrimdışı bile kimlik bilinir; çevrimiçi olunca
 * JWT otomatik yenilenir.
 *
 * Giriş ZORUNLU değildir — program girişsiz de tam çalışır (yalnız yerel).
 */

import { getSupabaseClient, isCloudConfigured } from './sync/supabaseClient.js';

export { isCloudConfigured };

/**
 * E-posta + şifre ile yeni hesap oluştur.
 * @returns {Promise<{user:object|null, needsConfirmation:boolean}>}
 */
export async function signUp(email, password) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Bulut yapılandırılmamış.');
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  // "Confirm email" açıksa session null döner (onay beklenir)
  return { user: data.user ?? null, needsConfirmation: !data.session };
}

/**
 * E-posta + şifre ile giriş yap.
 * @returns {Promise<object>} kullanıcı
 */
export async function signIn(email, password) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Bulut yapılandırılmamış.');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/** Çıkış yap (yerel veri korunur). */
export async function signOut() {
  const client = await getSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

/** Hesabı tamamen sil (veritabanında delete_user RPC fonksiyonu gerektirir). */
export async function deleteAccount() {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Bulut yapılandırılmamış.');
  
  // Veritabanında 'delete_user' adlı bir Postgres fonksiyonunun (RPC) tanımlı olduğu varsayılır.
  // Çoğu Supabase kurulumunda istemciden hesap silmek için bu yöntem kullanılır.
  const { error } = await client.rpc('delete_user');
  if (error) throw new Error('Hesap silinemedi. Supabase panelinden "delete_user" RPC fonksiyonunu tanımladığınıza emin olun. Hata: ' + error.message);
  
  await client.auth.signOut();
}

/** Kullanıcıya ait tüm verileri buluttan siler (Hesap silinmez). */
export async function clearCloudData() {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Bulut yapılandırılmamış.');
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Oturum bulunamadı.');

  // Silinecek tablolar
  const tables = [
    'animal_profiles', 'rations', 'herd_groups', 'feed_price_history', 
    'field_observations', 'farms', 'user_feeds'
  ];

  // RLS (Row Level Security) kuralları gereği, kendi 'owner_id' olanları silebilir.
  for (const table of tables) {
    try {
      await client.from(table).delete().eq('owner_id', user.id);
    } catch (err) {
      console.warn(`[cloud] ${table} tablosu silinirken hata:`, err);
    }
  }
}

/** Şifre sıfırlama e-postası gönder. */
export async function resetPassword(email) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Bulut yapılandırılmamış.');
  const { error } = await client.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

/**
 * Şu an giriş yapmış kullanıcıyı döndürür (yoksa null).
 * @returns {Promise<object|null>}
 */
export async function getCurrentUser() {
  const client = await getSupabaseClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getUser();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Kalıcı oturumu (varsa) döndürür — hızlı açılış kontrolü için (ağ gerektirmez).
 * @returns {Promise<object|null>} session
 */
export async function getSession() {
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data?.session ?? null;
}

/**
 * Oturum durumu değişimlerini dinler (giriş/çıkış/yenileme).
 * @param {(event:string, session:object|null)=>void} cb
 * @returns {Promise<() => void>} aboneliği iptal eden fonksiyon
 */
export async function onAuthChange(cb) {
  const client = await getSupabaseClient();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((event, session) => cb(event, session));
  return () => data?.subscription?.unsubscribe?.();
}
