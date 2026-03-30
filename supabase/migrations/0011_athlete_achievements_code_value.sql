-- athlete_achievements: insert con achievement_code (text) y value (real = float4).
-- athlete_id sigue siendo uuid (FK a public.athletes.id); en este proyecto athletes.id no es integer.

ALTER TABLE public.athlete_achievements
  ADD COLUMN IF NOT EXISTS achievement_code text,
  ADD COLUMN IF NOT EXISTS value real;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'athlete_achievements'
      AND column_name = 'achievement_id'
  ) THEN
    UPDATE public.athlete_achievements aa
    SET
      achievement_code = ach.code,
      value = COALESCE(aa.value, 1::real)
    FROM public.achievements ach
    WHERE aa.achievement_id = ach.id
      AND (aa.achievement_code IS NULL OR btrim(aa.achievement_code) = '');
  END IF;
END $$;

DELETE FROM public.athlete_achievements
WHERE achievement_code IS NULL OR btrim(achievement_code) = '';

UPDATE public.athlete_achievements SET value = 1::real WHERE value IS NULL;

ALTER TABLE public.athlete_achievements ALTER COLUMN achievement_code SET NOT NULL;
ALTER TABLE public.athlete_achievements ALTER COLUMN value SET NOT NULL;

ALTER TABLE public.athlete_achievements DROP CONSTRAINT IF EXISTS athlete_achievements_athlete_id_achievement_id_key;
ALTER TABLE public.athlete_achievements DROP CONSTRAINT IF EXISTS athlete_achievements_achievement_id_fkey;

ALTER TABLE public.athlete_achievements DROP COLUMN IF EXISTS achievement_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'athlete_achievements_achievement_code_fkey'
  ) THEN
    ALTER TABLE public.athlete_achievements
      ADD CONSTRAINT athlete_achievements_achievement_code_fkey
      FOREIGN KEY (achievement_code) REFERENCES public.achievements (code) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS athlete_achievements_athlete_code_uq
  ON public.athlete_achievements (athlete_id, achievement_code);
