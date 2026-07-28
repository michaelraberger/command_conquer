-- Multiplayer-Zugangs-Härtung: private Realtime-Kanäle + Partien-Registry.
-- Hintergrund: Join-Codes zirkulieren öffentlich — der Kanalzugang selbst
-- muss autorisiert sein, nicht nur das Erraten des Codes schwer.

-- Partien-Registry: eine Zeile pro Lobby-Code, angelegt vom Host bei
-- Lobby-Erstellung (Code ist da noch geheim → kein Vorab-Besetzen möglich).
create table public.matches (
  code text primary key check (char_length(code) = 6),
  host uuid not null references auth.users (id) on delete cascade,
  participants uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.matches enable row level security;

-- RLS erzwingt: Das host-Feld ist authentisch (nur auth.uid() selbst).
create policy "matches insert own" on public.matches
  for insert to authenticated
  with check (host = auth.uid());

create policy "matches update own" on public.matches
  for update to authenticated
  using (host = auth.uid());

create policy "matches delete own" on public.matches
  for delete to authenticated
  using (host = auth.uid());

-- Lesen: jeder Angemeldete (Joiner müssen die Zeile zur Start-Verifikation
-- lesen können, BEVOR sie in participants stehen; der Code bleibt das
-- Zugangsgeheimnis der Lobby-Phase).
create policy "matches read authenticated" on public.matches
  for select to authenticated
  using (true);

-- Realtime-Authorization (private channels): der Client verbindet mit
-- config.private = true; ohne passende Policy verweigert Realtime den Kanal.
-- Lobby-Kanäle: alle Angemeldeten (Zutritt regelt der geheime Code).
create policy "realtime lobby recv" on realtime.messages
  for select to authenticated
  using (realtime.topic() like 'cac:lobby:%');

create policy "realtime lobby send" on realtime.messages
  for insert to authenticated
  with check (realtime.topic() like 'cac:lobby:%');

-- Spiel-Kanäle: NUR registrierte Teilnehmer der Partie.
create policy "realtime game recv" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'cac:game:%'
    and exists (
      select 1 from public.matches m
      where realtime.topic() = 'cac:game:' || m.code
        and auth.uid() = any (m.participants)
    )
  );

create policy "realtime game send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() like 'cac:game:%'
    and exists (
      select 1 from public.matches m
      where realtime.topic() = 'cac:game:' || m.code
        and auth.uid() = any (m.participants)
    )
  );
