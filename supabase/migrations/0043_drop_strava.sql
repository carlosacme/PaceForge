-- Deprecacion de Strava: intervals.icu cubre lo mismo (empujar planes al reloj
-- y traer las actividades ejecutadas a los campos actual_* de workouts).
--
-- Ya eliminados en fases previas:
--   - UI de conexion (atleta y coach)
--   - api/strava-callback.js y api/strava-webhook.js
--   - la push subscription en el panel de Strava
--   - copy de marketing que prometia Strava
--
-- Datos que se pierden (respaldados en backup_2026-07-22_1617.json):
--   strava_activities   12 filas
--   strava_connections   3 filas
--   strava_tokens        1 fila
-- Ninguna alimenta ya la app: lo ejecutado vive en workouts.actual_*

DROP TABLE IF EXISTS public.strava_activities;
DROP TABLE IF EXISTS public.strava_connections;
DROP TABLE IF EXISTS public.strava_tokens;

NOTIFY pgrst, 'reload schema';
