-- Sistema de logros y medallas

CREATE TABLE IF NOT EXISTS public.achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  icon text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.athlete_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes (id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES public.achievements (id) ON DELETE CASCADE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS athlete_achievements_athlete_idx
  ON public.athlete_achievements (athlete_id, awarded_at DESC);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS achievements_select_all ON public.achievements;
CREATE POLICY achievements_select_all
  ON public.achievements FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS athlete_achievements_select_participants ON public.athlete_achievements;
CREATE POLICY athlete_achievements_select_participants
  ON public.athlete_achievements FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = athlete_achievements.athlete_id
        AND (
          a.coach_id = auth.uid()
          OR a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

DROP POLICY IF EXISTS athlete_achievements_insert_participants ON public.athlete_achievements;
CREATE POLICY athlete_achievements_insert_participants
  ON public.athlete_achievements FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = athlete_achievements.athlete_id
        AND (
          a.coach_id = auth.uid()
          OR a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

INSERT INTO public.achievements (code, name, icon, description)
VALUES
  ('FIRST_KM', 'Primer Kilómetro', '🏃', 'Completar el primer workout'),
  ('KM_10', '10 Kilómetros', '⭐', 'Acumular 10km totales'),
  ('KM_50', '50 Kilómetros', '🌟', 'Acumular 50km totales'),
  ('KM_100', '100 Kilómetros', '🏅', 'Acumular 100km totales'),
  ('KM_500', '500 Kilómetros', '🥈', 'Acumular 500km totales'),
  ('KM_1000', '1000 Kilómetros', '🥇', 'Acumular 1000km totales'),
  ('FIRST_WORKOUT', 'Primer Entrenamiento', '🎯', 'Completar primer workout'),
  ('STREAK_7', 'Racha de 7 días', '🔥', '7 workouts en 7 días consecutivos'),
  ('STREAK_30', 'Racha de 30 días', '💪', '30 workouts en 30 días'),
  ('FIRST_LONG', 'Primera Tirada Larga', '🛣️', 'Completar un workout largo +15km'),
  ('SPEED_DEMON', 'Velocidad Pura', '⚡', 'Completar un intervalo'),
  ('CONSISTENT', 'Consistencia', '📅', 'Completar 10 workouts'),
  ('HALF_WARRIOR', 'Guerrero de Media', '🏆', 'Completar 21km en un workout'),
  ('MARATHON_READY', 'Listo para Maratón', '👑', 'Completar 30km en un workout'),
  ('EARLY_BIRD', 'Madrugador', '🌅', 'Completar workout antes de las 7am (campo scheduled_date)'),
  ('RPE_MASTER', 'Maestro del Esfuerzo', '📊', 'Registrar RPE en 10 workouts')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  description = EXCLUDED.description;
