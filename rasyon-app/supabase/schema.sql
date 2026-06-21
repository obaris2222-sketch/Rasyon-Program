-- ════════════════════════════════════════════════════════════════════════════
-- Süt Sığırı Rasyon Programı — Supabase Şeması (FAZ 16.10 / 16.11)
-- ════════════════════════════════════════════════════════════════════════════
-- Bu dosyanın TAMAMINI Supabase Dashboard → SQL Editor → "New query" alanına
-- yapıştırıp "Run" deyin. Tekrar çalıştırmak güvenlidir (idempotent).
--
-- Tasarım:
--   • Her tablo bir IndexedDB store'una karşılık gelir.
--   • Ortak sütunlar: id (istemci UUID'si), owner_id (giriş yapan kullanıcı),
--     farm_id (çiftlik kapsamı), updated_at (LWW), deleted_at (tombstone),
--     data (kaydın tamamı JSON olarak — şema değişince migration gerekmez).
--   • Row-Level Security (RLS): kullanıcı YALNIZCA kendi (owner_id = auth.uid())
--     satırlarını görür/yazar → çoklu-çiftlik izolasyonu veritabanı düzeyinde.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Ortak tablo oluşturucu (farms hariç hepsi farm_id taşır) ─────────────────

create table if not exists public.farms (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  data        jsonb not null default '{}'::jsonb
);

create table if not exists public.animal_profiles (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  farm_id     uuid,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  data        jsonb not null default '{}'::jsonb
);

create table if not exists public.rations (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  farm_id     uuid,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  data        jsonb not null default '{}'::jsonb
);

create table if not exists public.herd_groups (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  farm_id     uuid,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  data        jsonb not null default '{}'::jsonb
);

create table if not exists public.feed_price_history (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  farm_id     uuid,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  data        jsonb not null default '{}'::jsonb
);

create table if not exists public.field_observations (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  farm_id     uuid,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  data        jsonb not null default '{}'::jsonb
);

-- Kullanıcı yemleri (FAZ 16.11 — danışman-global; farm_id NULL = tüm çiftlikler)
-- NOT: id TEXT'tir (uuid değil) — kullanıcı yemi id'leri "user_"/"custom_" önekli string.
create table if not exists public.user_feeds (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  farm_id     uuid,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  data        jsonb not null default '{}'::jsonb
);

-- ── Pull sorguları için indeks (owner + son güncelleme) ──────────────────────

create index if not exists idx_farms_owner_upd              on public.farms (owner_id, updated_at);
create index if not exists idx_animal_profiles_owner_upd    on public.animal_profiles (owner_id, updated_at);
create index if not exists idx_rations_owner_upd            on public.rations (owner_id, updated_at);
create index if not exists idx_herd_groups_owner_upd        on public.herd_groups (owner_id, updated_at);
create index if not exists idx_feed_price_history_owner_upd on public.feed_price_history (owner_id, updated_at);
create index if not exists idx_field_observations_owner_upd on public.field_observations (owner_id, updated_at);
create index if not exists idx_user_feeds_owner_upd         on public.user_feeds (owner_id, updated_at);

-- ── Row-Level Security: herkes yalnızca kendi verisini görür/yazar ───────────

do $$
declare t text;
begin
  foreach t in array array[
    'farms','animal_profiles','rations','herd_groups',
    'feed_price_history','field_observations','user_feeds'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists own_rows_select on public.%I;', t);
    execute format('drop policy if exists own_rows_insert on public.%I;', t);
    execute format('drop policy if exists own_rows_update on public.%I;', t);
    execute format('drop policy if exists own_rows_delete on public.%I;', t);
    execute format('create policy own_rows_select on public.%I for select using (owner_id = auth.uid());', t);
    execute format('create policy own_rows_insert on public.%I for insert with check (owner_id = auth.uid());', t);
    execute format('create policy own_rows_update on public.%I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());', t);
    execute format('create policy own_rows_delete on public.%I for delete using (owner_id = auth.uid());', t);
  end loop;
end $$;

-- ✅ Tamamlandı. "Success. No rows returned" görmelisiniz.
