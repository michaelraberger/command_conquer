-- Härtung nach Security-Review (2026-07-28).

-- 1) Galerie-Karten: Größendeckel auf dem JSON-Blob. Die Client-Validierung
--    (validateCustomMap) ist per direktem REST-Call umgehbar; ohne Limit kann
--    jeder angemeldete Nutzer beliebig große Zeilen anlegen, die die Galerie
--    beim Betrachter ungefragt lädt (Speicher-/CPU-DoS). 2 MB reichen für
--    jede legale 192²-Karte mit großzügigem Polster.
alter table public.maps
  add constraint maps_data_size check (octet_length(data::text) < 2 * 1024 * 1024);

-- 2) Hinweis (kein SQL): Die Realtime-Kanäle (cac:lobby:<CODE>, cac:game:<CODE>)
--    laufen als öffentliche Broadcast-Kanäle — jeder mit Anon-Key und Code kann
--    mitsenden. Die Client-Seite validiert seit dem Review jede eingehende
--    Nachricht strukturell (net/validate.ts), aber ABSENDER-Authentizität
--    (wer ist wirklich Sitz N / Host?) erfordert Supabase "private channels"
--    mit einer Policy auf realtime.messages plus channel.config.private=true
--    im Client. Das ist ein bewusst separater Schritt, weil er ein Dashboard-
--    Setting + Client-Umbau verlangt und falsch konfiguriert alle Partien
--    blockiert. Siehe supabase/README.md, Abschnitt "Multiplayer-Härtung".
