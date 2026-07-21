-- Karriere-Summen pro Konto: eine Zeile je Nutzer, feldweise addierte
-- Partie-Totale (Client macht Read-Modify-Write nach jedem Spielende).
-- Manuell im Supabase-Dashboard ausführen (wie 0002/0003).

create table if not exists public.career_stats (
  owner uuid primary key references public.profiles (id) on delete cascade,
  games integer not null default 0,
  wins integer not null default 0,
  playtime_ticks bigint not null default 0,
  totals jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.career_stats enable row level security;

create policy "career_stats sind privat"
  on public.career_stats for all
  using ((select auth.uid()) = owner)
  with check ((select auth.uid()) = owner);
