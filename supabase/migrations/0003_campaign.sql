-- Kampagnenmodus: Fortschritts-Sync + Missions-Referenz an Spielständen.

-- Ein jsonb-Blob pro Nutzer; die Vereinigung (per-Mission-Union) passiert im
-- Client (siehe packages/client/src/net/campaignRepo.ts).
create table public.campaign_progress (
  owner uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.campaign_progress enable row level security;

create policy "campaign progress all own" on public.campaign_progress
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

-- Spielstände merken sich ihre Kampagnenmission (z. B. 'allies-03'); beim
-- Laden stellt der Client daraus Ziel-HUD und Kampagnen-Kontext wieder her.
alter table public.saves add column campaign_mission text;
