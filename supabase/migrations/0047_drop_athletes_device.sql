-- La columna athletes.device es legacy: pertenecia al flujo de conexion
-- directa COROS/Garmin, eliminado en favor de intervals.icu (device_connections).
-- Ya nada la escribe ni la lee (normalizeAthlete dejo de arrastrarla, commit 6b302a9).
-- Verificado: 0 filas con valor antes del drop.
ALTER TABLE athletes DROP COLUMN IF EXISTS device;
