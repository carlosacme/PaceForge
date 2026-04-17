-- =============================================
-- RUNNINGAPEXFLOW — DATOS DE PRUEBA (adaptado al esquema del repo)
-- Ejecutar en Supabase SQL Editor (o como seed manual).
--
-- Coach: acostamerlano87@gmail.com (debe existir en auth.users)
-- Atleta: acostamerlano87+atleta@gmail.com (debe existir en auth.users)
--
-- IDs de referencia
-- COACH user_id:   b5c9e44a-6695-4800-99bd-f19b05d2f66f
-- ATLETA user_id:  51a67609-f23f-4744-b987-426763709211
-- ATLETA athletes.id (fijo para seed): 00000000-0000-4000-8008-000000000008
--
-- Notas vs script original:
-- - athletes.id es UUID (no entero 8).
-- - athlete_evaluations usa method, input_data, vdot, paces, hr_zones, predicted_times (no evaluation_type ni easy_pace_*).
-- - achievements usa code/name/…; athlete_achievements usa achievement_code + value.
-- - races.distance es text (no distance_km / goal_time en migración base).
-- - messages no tiene columna read.
-- - plan_marketplace: columnas según migraciones 0031 + 0032 (+ coach_id).
-- - No existe tabla training_plans en este repo → sección omitida.
-- - challenge_participants.athlete_id es bigint en 0028; si choca con UUID de athletes,
--   dejamos athlete_id NULL y basta user_id para muchos flujos de la app.
-- =============================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_plan text;

-- =============================================
-- 1. Perfiles
-- =============================================
UPDATE public.profiles SET
  name = 'Laura Atleta',
  role = 'athlete',
  plan_status = 'active',
  subscription_plan = 'basico'
WHERE user_id = '51a67609-f23f-4744-b987-426763709211';

UPDATE public.profiles SET
  name = 'Carlos Coach',
  role = 'coach',
  plan_status = 'active',
  subscription_plan = 'pro'
WHERE user_id = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f';

-- =============================================
-- 2. Atleta Laura (UUID fijo de seed)
-- =============================================
DELETE FROM public.challenge_participants
WHERE user_id = '51a67609-f23f-4744-b987-426763709211';

DELETE FROM public.messages
WHERE athlete_id = '00000000-0000-4000-8008-000000000008'::uuid;

DELETE FROM public.athlete_achievements
WHERE athlete_id = '00000000-0000-4000-8008-000000000008'::uuid;

DELETE FROM public.athlete_payments
WHERE athlete_id = '00000000-0000-4000-8008-000000000008'::uuid;

DELETE FROM public.athlete_evaluations
WHERE athlete_id = '00000000-0000-4000-8008-000000000008'::uuid;

DELETE FROM public.races
WHERE athlete_id = '00000000-0000-4000-8008-000000000008'::uuid;

DELETE FROM public.workouts
WHERE athlete_id = '00000000-0000-4000-8008-000000000008'::uuid;

DELETE FROM public.athletes
WHERE user_id = '51a67609-f23f-4744-b987-426763709211';

INSERT INTO public.athletes (
  id,
  user_id,
  coach_id,
  name,
  email,
  weekly_km,
  goal,
  pace
) VALUES (
  '00000000-0000-4000-8008-000000000008',
  '51a67609-f23f-4744-b987-426763709211',
  'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
  'Laura Atleta',
  'acostamerlano87+atleta@gmail.com',
  40,
  'Terminar maratón en menos de 4 horas',
  '6:00-6:45 min/km'
);

-- =============================================
-- 3. Workouts (últimas 2 semanas + actual)
-- =============================================
INSERT INTO public.workouts (
  athlete_id,
  coach_id,
  title,
  description,
  type,
  total_km,
  duration_min,
  scheduled_date,
  done,
  rpe
) VALUES
  (
    '00000000-0000-4000-8008-000000000008',
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Rodaje suave',
    'Trote fácil de recuperación a 6:30 min/km',
    'easy',
    7,
    45,
    (CURRENT_DATE - 7),
    true,
    5
  ),
  (
    '00000000-0000-4000-8008-000000000008',
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Tempo run',
    'Ritmo umbral a 5:00-5:30 min/km',
    'tempo',
    9,
    50,
    (CURRENT_DATE - 5),
    true,
    7
  ),
  (
    '00000000-0000-4000-8008-000000000008',
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Long run',
    'Rodaje largo a 6:00 min/km',
    'long',
    15,
    90,
    (CURRENT_DATE - 3),
    true,
    6
  ),
  (
    '00000000-0000-4000-8008-000000000008',
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Intervalos 400m',
    '8x400m a 4:30 min/km con 90s descanso',
    'interval',
    8,
    55,
    (CURRENT_DATE - 1),
    true,
    8
  ),
  (
    '00000000-0000-4000-8008-000000000008',
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Recuperación activa',
    'Trote muy suave 30 min + estiramientos',
    'easy',
    5,
    35,
    CURRENT_DATE,
    false,
    NULL
  ),
  (
    '00000000-0000-4000-8008-000000000008',
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Fartlek 6x3 min',
    'Cambios de ritmo 3 min rápido / 2 min lento',
    'interval',
    9,
    50,
    (CURRENT_DATE + 2),
    false,
    NULL
  ),
  (
    '00000000-0000-4000-8008-000000000008',
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Long run domingo',
    'Rodaje largo 18km a ritmo conversacional',
    'long',
    18,
    105,
    (CURRENT_DATE + 4),
    false,
    NULL
  );

-- =============================================
-- 4. Evaluación VDOT (esquema 0009)
-- =============================================
INSERT INTO public.athlete_evaluations (
  athlete_id,
  coach_id,
  method,
  input_data,
  vdot,
  paces,
  hr_zones,
  predicted_times,
  fc_max,
  fc_reposo
) VALUES (
  '00000000-0000-4000-8008-000000000008',
  'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
  'race',
  jsonb_build_object('notes', '10K en 50:30. Buena base aeróbica, mejorar velocidad en intervalos.', 'vdot', 42.5),
  42.5,
  jsonb_build_array(
    jsonb_build_object('key', 'easy', 'label', 'Rodaje', 'min', '6:00', 'max', '6:45'),
    jsonb_build_object('key', 'tempo', 'label', 'Tempo', 'pace', '5:10'),
    jsonb_build_object('key', 'interval', 'label', 'Intervalos', 'pace', '4:40'),
    jsonb_build_object('key', 'long', 'label', 'Largo', 'pace', '6:15')
  ),
  '[]'::jsonb,
  '[]'::jsonb,
  175,
  55
);

-- =============================================
-- 5. Carrera meta
-- =============================================
INSERT INTO public.races (athlete_id, coach_id, name, date, distance, city)
VALUES (
  '00000000-0000-4000-8008-000000000008',
  'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
  'Maratón de Bogotá 2026',
  (CURRENT_DATE + 70),
  '42.195 km · objetivo 3:55:00',
  'Bogotá'
);

-- =============================================
-- 6. Biblioteca del coach
-- =============================================
DELETE FROM public.workout_library
WHERE coach_id = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f';

INSERT INTO public.workout_library (
  coach_id, title, type, total_km, duration_min, description, structure, workout_type, distance_km, intensity, notes
) VALUES
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Rodaje base 45 min',
    'easy',
    7,
    45,
    'Trote continuo a ritmo fácil 6:30-7:00 min/km',
    '[]'::jsonb,
    'easy',
    7,
    'low',
    'Ideal para días de recuperación'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Tempo 50 min',
    'tempo',
    9,
    50,
    'Calentamiento 10 min + 30 min tempo a 5:00-5:30 + vuelta calma 10 min',
    '[]'::jsonb,
    'tempo',
    9,
    'medium',
    'Mejorar umbral de lactato'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Intervalos 800m x6',
    'interval',
    10,
    60,
    '6 repeticiones de 800m a 4:30 min/km con 2 min descanso',
    '[]'::jsonb,
    'interval',
    10,
    'high',
    'Mejorar VO2max'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Long run 20km',
    'long',
    20,
    120,
    'Rodaje largo a 6:15 min/km, último 5km a ritmo maratón',
    '[]'::jsonb,
    'long',
    20,
    'medium',
    'Construcción de base aeróbica'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    'Fartlek 40 min',
    'interval',
    8,
    40,
    '5 min calentamiento + 5x(3 min rápido/2 min lento) + 5 min vuelta calma',
    '[]'::jsonb,
    'interval',
    8,
    'medium',
    'Variedad de velocidades'
  );

-- =============================================
-- 7. Reto activo + participación (user_id; athlete_id NULL si bigint ≠ uuid)
-- =============================================
DELETE FROM public.challenge_participants
WHERE challenge_id IN (SELECT id FROM public.challenges WHERE created_by = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f');

DELETE FROM public.challenges
WHERE created_by = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f';

INSERT INTO public.challenges (
  created_by,
  title,
  description,
  challenge_type,
  target_value,
  unit,
  start_date,
  end_date,
  is_active,
  emoji,
  color
) VALUES (
  'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
  'Reto 100km en Abril',
  'Acumula 100km de entrenamiento durante el mes de abril. ¡Tú puedes!',
  'distancia',
  100,
  'km',
  DATE '2026-04-01',
  DATE '2026-04-30',
  true,
  '🏆',
  '#a855f7'
);

INSERT INTO public.challenge_participants (challenge_id, user_id, athlete_id)
SELECT c.id, '51a67609-f23f-4744-b987-426763709211'::uuid, NULL
FROM public.challenges c
WHERE c.title = 'Reto 100km en Abril'
  AND c.created_by = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'
LIMIT 1;

-- =============================================
-- 8. Plan marketplace
-- =============================================
DELETE FROM public.plan_marketplace
WHERE coach_user_id = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f';

INSERT INTO public.plan_marketplace (
  coach_user_id,
  coach_id,
  coach_name,
  title,
  description,
  level,
  duration_weeks,
  sessions_per_week,
  price_cop,
  preview_workouts,
  is_active,
  is_approved
) VALUES (
  'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
  'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
  'Carlos Coach',
  'Plan 10K Para Principiantes — De 0 a Tu Primera Carrera',
  'Plan de 8 semanas diseñado para corredores que quieren completar su primer 10K. Incluye progresión gradual, días de descanso y workouts de fuerza complementaria.',
  'principiante',
  8,
  3,
  89000,
  '[
    {"week":1,"day":"Martes","type":"easy","title":"Rodaje suave 20 min","description":"Trote continuo a 7:30-8:00 min/km","pace_range":"7:30-8:00","duration_min":20,"distance_km":2.5},
    {"week":1,"day":"Jueves","type":"easy","title":"Run/Walk 25 min","description":"Alterna 3 min trotando / 1 min caminando a 7:00-8:00 min/km","pace_range":"7:00-8:00","duration_min":25,"distance_km":3},
    {"week":1,"day":"Sábado","type":"long","title":"Rodaje largo 30 min","description":"Trote muy suave sin parar a 7:30-8:00 min/km","pace_range":"7:30-8:00","duration_min":30,"distance_km":4},
    {"week":2,"day":"Martes","type":"easy","title":"Rodaje suave 25 min","description":"Trote continuo a 7:00-7:30 min/km","pace_range":"7:00-7:30","duration_min":25,"distance_km":3.5},
    {"week":2,"day":"Jueves","type":"interval","title":"Intervalos caminata","description":"5x(4 min trote / 1 min caminar) a 7:00-8:00 min/km","pace_range":"7:00-8:00","duration_min":30,"distance_km":4},
    {"week":2,"day":"Sábado","type":"long","title":"Rodaje largo 35 min","description":"Trote suave sin parar a 7:30 min/km","pace_range":"7:00-7:30","duration_min":35,"distance_km":5}
  ]'::jsonb,
  true,
  true
);

-- =============================================
-- 9. Chat (sin columna read)
-- =============================================
INSERT INTO public.messages (coach_id, athlete_id, sender_role, body, created_at)
VALUES
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    '00000000-0000-4000-8008-000000000008',
    'coach',
    '¡Hola Laura! Esta semana tenemos una sesión de intervalos el miércoles. Recuerda calentar bien antes de los 400m. 💪',
    now() - interval '2 hours'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    '00000000-0000-4000-8008-000000000008',
    'athlete',
    'Hola coach! Listo, me preparo bien. ¿Cuánto descanso entre cada 400?',
    now() - interval '1 hour'
  ),
  (
    'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
    '00000000-0000-4000-8008-000000000008',
    'coach',
    '90 segundos trotando suave entre cada repetición. Si sientes que no puedes mantener el ritmo, descansa 2 min. Lo importante es la calidad.',
    now() - interval '30 minutes'
  );

-- =============================================
-- 10. Logros del atleta (por achievement_code)
-- =============================================
INSERT INTO public.athlete_achievements (athlete_id, achievement_code, value, awarded_at)
VALUES
  ('00000000-0000-4000-8008-000000000008', 'FIRST_WORKOUT', 1, now() - interval '10 days'),
  ('00000000-0000-4000-8008-000000000008', 'STREAK_7', 1, now() - interval '5 days'),
  ('00000000-0000-4000-8008-000000000008', 'KM_50', 1, now() - interval '2 days')
ON CONFLICT (athlete_id, achievement_code) DO UPDATE SET
  value = EXCLUDED.value,
  awarded_at = EXCLUDED.awarded_at;

-- =============================================
-- 11. Pago pendiente
-- =============================================
INSERT INTO public.athlete_payments (
  athlete_id,
  coach_id,
  amount,
  currency,
  payment_method,
  plan,
  status,
  notes,
  payment_date
) VALUES (
  '00000000-0000-4000-8008-000000000008',
  'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
  129000,
  'COP',
  'Nequi',
  'basico',
  'pending',
  'Pago enviado por Nequi al 3001234567',
  CURRENT_DATE
);

COMMIT;

-- =============================================
-- Verificación
-- =============================================
SELECT 'profiles' AS tabla, COUNT(*)::bigint AS registros
FROM public.profiles
WHERE user_id IN (
  'b5c9e44a-6695-4800-99bd-f19b05d2f66f',
  '51a67609-f23f-4744-b987-426763709211'
)
UNION ALL
SELECT 'athletes', COUNT(*) FROM public.athletes WHERE id = '00000000-0000-4000-8008-000000000008'
UNION ALL
SELECT 'workouts', COUNT(*) FROM public.workouts WHERE athlete_id = '00000000-0000-4000-8008-000000000008'
UNION ALL
SELECT 'athlete_evaluations', COUNT(*) FROM public.athlete_evaluations WHERE athlete_id = '00000000-0000-4000-8008-000000000008'
UNION ALL
SELECT 'races', COUNT(*) FROM public.races WHERE athlete_id = '00000000-0000-4000-8008-000000000008'
UNION ALL
SELECT 'workout_library', COUNT(*) FROM public.workout_library WHERE coach_id = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'
UNION ALL
SELECT 'challenges', COUNT(*) FROM public.challenges WHERE created_by = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'
UNION ALL
SELECT 'plan_marketplace', COUNT(*) FROM public.plan_marketplace WHERE coach_user_id = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'
UNION ALL
SELECT 'messages', COUNT(*) FROM public.messages WHERE coach_id = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'
UNION ALL
SELECT 'athlete_achievements', COUNT(*) FROM public.athlete_achievements WHERE athlete_id = '00000000-0000-4000-8008-000000000008'
UNION ALL
SELECT 'athlete_payments', COUNT(*) FROM public.athlete_payments WHERE coach_id = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f';
