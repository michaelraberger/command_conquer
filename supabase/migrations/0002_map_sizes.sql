-- CAC: Größere Karten (128/144/192) für den Editor und die Cloud-Galerie.
-- ⚠️ WICHTIG: Diese Migration muss manuell im Supabase-Dashboard unter
-- "SQL Editor" ausgeführt werden (oder: supabase db push). Bis dahin schlägt
-- das Cloud-Speichern von Karten größer als 96×96 mit einer Check-Verletzung fehl.

alter table public.maps drop constraint maps_width_check;
alter table public.maps add constraint maps_width_check check (width in (48, 64, 96, 128, 144, 192));

alter table public.maps drop constraint maps_height_check;
alter table public.maps add constraint maps_height_check check (height in (48, 64, 96, 128, 144, 192));
