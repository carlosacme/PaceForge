-- Catálogo semilla (idempotente por seed_key). Generado desde library_recipes.json.
BEGIN;

-- Semillas de catálogo público (idempotente por seed_key).
-- Generado por scripts/expand-library-recipes.js — no editar a mano.
-- Ritmos escritos a VDOT 47.2 vía src/lib/vdot.js.

INSERT INTO public.workout_library (
  coach_id, title, type, workout_type, total_km, distance_km, duration_min,
  description, structure, is_fitness_test, is_system, category, seed_key
) VALUES
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    '8x400m R',
    'interval',
    'interval',
    9.4,
    9.4,
    47,
    'Calentamiento E + 8 repeticiones de 400 m a ritmo R con 90 s de trote E + enfriamiento.',
    '[{"block_type":"Calentamiento","phase":"Calentamiento","duration_min":"15","duration":"15","target_pace":"5:59-5:27","pace":"5:59-5:27","description":"WU E"},{"block_type":"Intervalo","phase":"Repetition 1 - 400m","block_label":"Repetition 1 - 400m","distance_km":"0.4","target_pace":"3:46-3:40","pace":"3:46-3:40"},{"block_type":"Recuperación","phase":"Recuperación","duration_min":"90 sec","duration":"90 sec","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Intervalo","phase":"Repetition 2 - 400m","block_label":"Repetition 2 - 400m","distance_km":"0.4","target_pace":"3:46-3:40","pace":"3:46-3:40"},{"block_type":"Recuperación","phase":"Recuperación","duration_min":"90 sec","duration":"90 sec","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Intervalo","phase":"Repetition 3 - 400m","block_label":"Repetition 3 - 400m","distance_km":"0.4","target_pace":"3:46-3:40","pace":"3:46-3:40"},{"block_type":"Recuperación","phase":"Recuperación","duration_min":"90 sec","duration":"90 sec","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Intervalo","phase":"Repetition 4 - 400m","block_label":"Repetition 4 - 400m","distance_km":"0.4","target_pace":"3:46-3:40","pace":"3:46-3:40"},{"block_type":"Recuperación","phase":"Recuperación","duration_min":"90 sec","duration":"90 sec","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Intervalo","phase":"Repetition 5 - 400m","block_label":"Repetition 5 - 400m","distance_km":"0.4","target_pace":"3:46-3:40","pace":"3:46-3:40"},{"block_type":"Recuperación","phase":"Recuperación","duration_min":"90 sec","duration":"90 sec","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Intervalo","phase":"Repetition 6 - 400m","block_label":"Repetition 6 - 400m","distance_km":"0.4","target_pace":"3:46-3:40","pace":"3:46-3:40"},{"block_type":"Recuperación","phase":"Recuperación","duration_min":"90 sec","duration":"90 sec","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Intervalo","phase":"Repetition 7 - 400m","block_label":"Repetition 7 - 400m","distance_km":"0.4","target_pace":"3:46-3:40","pace":"3:46-3:40"},{"block_type":"Recuperación","phase":"Recuperación","duration_min":"90 sec","duration":"90 sec","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Intervalo","phase":"Repetition 8 - 400m","block_label":"Repetition 8 - 400m","distance_km":"0.4","target_pace":"3:46-3:40","pace":"3:46-3:40"},{"block_type":"Enfriamiento","phase":"Enfriamiento","duration_min":"10","duration":"10","target_pace":"5:59-5:27","pace":"5:59-5:27","description":"CD E"}]'::jsonb,
    FALSE,
    TRUE,
    'Intervalos',
    'interval-8x400-r'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Largo 20 km + 5 km M',
    'long',
    'long',
    23.5,
    23.5,
    129,
    'Rodaje largo en E con los últimos 5 km a ritmo maratón.',
    '[{"block_type":"Calentamiento","phase":"Calentamiento","duration_min":"10","duration":"10","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Rodaje","phase":"Rodaje","distance_km":"15","target_pace":"5:59-5:27","pace":"5:59-5:27","description":"Largo E"},{"block_type":"Rodaje","phase":"Últimos 5 km M","block_label":"Últimos 5 km M","distance_km":"5","target_pace":"4:46-4:40","pace":"4:46-4:40","description":"Cierre M"},{"block_type":"Enfriamiento","phase":"Enfriamiento","duration_min":"10","duration":"10","target_pace":"5:59-5:27","pace":"5:59-5:27"}]'::jsonb,
    FALSE,
    TRUE,
    'Largos',
    'long-20k-m'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Tempo 20 min T',
    'tempo',
    'tempo',
    8.9,
    8.9,
    45,
    'Bloque continuo de umbral entre calentamiento y enfriamiento E.',
    '[{"block_type":"Calentamiento","phase":"Calentamiento","duration_min":"15","duration":"15","target_pace":"5:59-5:27","pace":"5:59-5:27"},{"block_type":"Intervalo","phase":"Intervalo","duration_min":"20","duration":"20","target_pace":"4:28-4:22","pace":"4:28-4:22","description":"Tempo T"},{"block_type":"Enfriamiento","phase":"Enfriamiento","duration_min":"10","duration":"10","target_pace":"5:59-5:27","pace":"5:59-5:27"}]'::jsonb,
    FALSE,
    TRUE,
    'Tempo',
    'tempo-20min-t'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'TEST 5K',
    'tempo',
    'tempo',
    8,
    8,
    45,
    'Test de esfuerzo 5K. El bloque de medición va sin ritmo objetivo.',
    '[{"block_type":"Calentamiento","phase":"Calentamiento","duration_min":"15","duration":"15","target_pace":"5:59-5:27","pace":"5:59-5:27","description":"WU E"},{"block_type":"Intervalo","phase":"5K all-out","block_label":"5K all-out","distance_km":"5","description":"5K all-out"},{"block_type":"Enfriamiento","phase":"Enfriamiento","duration_min":"10","duration":"10","target_pace":"5:59-5:27","pace":"5:59-5:27","description":"CD E"}]'::jsonb,
    TRUE,
    TRUE,
    'Tests',
    'test-5k'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Fortalecimiento A',
    'recovery',
    'recovery',
    0,
    0,
    45,
    'Fuerza general. Sin ritmos ni distancia: no se empuja al reloj.',
    '[{"block_type":"Calentamiento","phase":"Calentamiento","duration_min":"10","duration":"10","description":"Movilidad y activación"},{"block_type":"Intervalo","phase":"Intervalo","duration_min":"30","duration":"30","description":"Sentadillas, peso muerto, 3 series x 12"},{"block_type":"Enfriamiento","phase":"Enfriamiento","duration_min":"5","duration":"5","description":"Estiramientos"}]'::jsonb,
    FALSE,
    TRUE,
    'Fortalecimiento',
    'strength-gym-a'
  )
ON CONFLICT (seed_key) DO UPDATE SET
  title = EXCLUDED.title,
  type = EXCLUDED.type,
  workout_type = EXCLUDED.workout_type,
  total_km = EXCLUDED.total_km,
  distance_km = EXCLUDED.distance_km,
  duration_min = EXCLUDED.duration_min,
  description = EXCLUDED.description,
  structure = EXCLUDED.structure,
  is_fitness_test = EXCLUDED.is_fitness_test,
  is_system = TRUE,
  category = EXCLUDED.category;

COMMIT;
