-- CAC: Nutzerprofile, eigene Karten, Spielstände.
-- Im Supabase-Dashboard unter "SQL Editor" ausführen (oder: supabase db push).

-- ---------------------------------------------------------------------------
-- Profile: 1:1 zu auth.users, wird beim Signup automatisch angelegt.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Eigene Karten (Editor). `data` ist das CustomMapData-JSON (~100 KB max).
-- owner referenziert profiles (nicht auth.users), damit die Galerie den
-- Autorennamen per Embed mitladen kann.
-- ---------------------------------------------------------------------------
create table public.maps (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  is_public boolean not null default false,
  data jsonb not null,
  width int not null check (width in (48, 64, 96)),
  height int not null check (height in (48, 64, 96)),
  max_players int not null check (max_players between 2 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Spielstände. `data` ist der gzip+base64-komprimierte GameState (Präfix
-- "gz:"), `balance` der Balance-Snapshot der Partie (muss beim Fortsetzen
-- wieder angewendet werden). Harte Obergrenze als Backstop gegen Riesenblobs.
-- ---------------------------------------------------------------------------
create table public.saves (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  tick int not null,
  map_label text,
  balance jsonb,
  data text not null check (octet_length(data) < 8000000),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profil automatisch beim Signup anlegen (Username kommt aus den
-- Signup-Metadaten, Fallback: "Spieler-<id-prefix>").
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), 'Spieler-' || left(new.id::text, 8))
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.maps enable row level security;
alter table public.saves enable row level security;

create policy "profiles readable by all" on public.profiles
  for select using (true);
create policy "profiles update own" on public.profiles
  for update using ((select auth.uid()) = id);

-- Öffentliche Karten sieht jeder (auch anon/Gäste), private nur der Besitzer.
create policy "maps read public or own" on public.maps
  for select using (is_public or (select auth.uid()) = owner);
create policy "maps insert own" on public.maps
  for insert with check ((select auth.uid()) = owner);
create policy "maps update own" on public.maps
  for update using ((select auth.uid()) = owner);
create policy "maps delete own" on public.maps
  for delete using ((select auth.uid()) = owner);

-- Spielstände sind strikt privat.
create policy "saves all own" on public.saves
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

create index maps_public_idx on public.maps (is_public, updated_at desc);
create index maps_owner_idx on public.maps (owner, updated_at desc);
create index saves_owner_idx on public.saves (owner, created_at desc);
