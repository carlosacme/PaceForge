-- Carpetas por coach + catálogo público de semillas.
--
-- workout_library.id es bigint en producción (ver 20260905200750).
-- folder_id / copied_from_id siguen ese tipo.
-- ON DELETE SET NULL: borrar carpeta o semilla no borra workouts/copias.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Carpetas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.library_folders (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coach_id   uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT library_folders_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS library_folders_coach_name_uid
  ON public.library_folders (coach_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS library_folders_coach_sort_idx
  ON public.library_folders (coach_id, sort_order, id);

COMMENT ON TABLE public.library_folders IS
  'Carpetas de la biblioteca de cada coach. Borrar una carpeta deja los workouts en Sin carpeta.';

ALTER TABLE public.library_folders ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_folders TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.library_folders_id_seq TO authenticated;

DROP POLICY IF EXISTS library_folders_select ON public.library_folders;
CREATE POLICY library_folders_select
  ON public.library_folders FOR SELECT TO authenticated
  USING (
    auth.uid() = coach_id
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.coach_staff cs
      WHERE cs.staff_id = auth.uid() AND cs.coach_id = library_folders.coach_id
    )
  );

DROP POLICY IF EXISTS library_folders_insert_own ON public.library_folders;
CREATE POLICY library_folders_insert_own
  ON public.library_folders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = coach_id);

DROP POLICY IF EXISTS library_folders_update_own ON public.library_folders;
CREATE POLICY library_folders_update_own
  ON public.library_folders FOR UPDATE TO authenticated
  USING (auth.uid() = coach_id)
  WITH CHECK (auth.uid() = coach_id);

DROP POLICY IF EXISTS library_folders_delete_own ON public.library_folders;
CREATE POLICY library_folders_delete_own
  ON public.library_folders FOR DELETE TO authenticated
  USING (auth.uid() = coach_id);

-- ---------------------------------------------------------------------------
-- 2) Columnas de biblioteca
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_library
  ADD COLUMN IF NOT EXISTS folder_id bigint REFERENCES public.library_folders (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS seed_key text,
  ADD COLUMN IF NOT EXISTS copied_from_id bigint REFERENCES public.workout_library (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workout_library_folder_id_idx
  ON public.workout_library (folder_id)
  WHERE folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workout_library_is_system_idx
  ON public.workout_library (is_system)
  WHERE is_system = true;

CREATE INDEX IF NOT EXISTS workout_library_copied_from_idx
  ON public.workout_library (copied_from_id)
  WHERE copied_from_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workout_library_seed_key_key'
  ) THEN
    ALTER TABLE public.workout_library
      ADD CONSTRAINT workout_library_seed_key_key UNIQUE (seed_key);
  END IF;
END $$;

COMMENT ON COLUMN public.workout_library.folder_id IS
  'Carpeta del coach. NULL = Sin carpeta. ON DELETE SET NULL.';
COMMENT ON COLUMN public.workout_library.is_system IS
  'Semilla de catálogo público (solo lectura para coaches; copiar crea una fila propia).';
COMMENT ON COLUMN public.workout_library.category IS
  'Categoría de catálogo; al copiar se usa como nombre de carpeta destino.';
COMMENT ON COLUMN public.workout_library.seed_key IS
  'Clave estable de siembra. UNIQUE; NULL en filas de coaches.';
COMMENT ON COLUMN public.workout_library.copied_from_id IS
  'Origen de una copia de catálogo. ON DELETE SET NULL.';

-- ---------------------------------------------------------------------------
-- 3) RLS workout_library
--    Dueño, staff del dueño, catálogo is_system, admin (policy ya existente).
--    Mutar: dueño sobre filas NO sistema. Semillas: solo admin.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS workout_library_select_staff_parent ON public.workout_library;
CREATE POLICY workout_library_select_staff_parent
  ON public.workout_library FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.coach_staff cs
      WHERE cs.staff_id = auth.uid() AND cs.coach_id = workout_library.coach_id
    )
  );

DROP POLICY IF EXISTS workout_library_select_system ON public.workout_library;
CREATE POLICY workout_library_select_system
  ON public.workout_library FOR SELECT TO authenticated
  USING (is_system = true);

DROP POLICY IF EXISTS workout_library_insert_own ON public.workout_library;
CREATE POLICY workout_library_insert_own
  ON public.workout_library FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = coach_id
    AND (is_system = false OR public.is_admin())
  );

DROP POLICY IF EXISTS workout_library_update_own ON public.workout_library;
CREATE POLICY workout_library_update_own
  ON public.workout_library FOR UPDATE TO authenticated
  USING (auth.uid() = coach_id AND is_system = false)
  WITH CHECK (auth.uid() = coach_id AND is_system = false);

DROP POLICY IF EXISTS workout_library_delete_own ON public.workout_library;
CREATE POLICY workout_library_delete_own
  ON public.workout_library FOR DELETE TO authenticated
  USING (auth.uid() = coach_id AND is_system = false);

DROP POLICY IF EXISTS workout_library_admin_update_system ON public.workout_library;
CREATE POLICY workout_library_admin_update_system
  ON public.workout_library FOR UPDATE TO authenticated
  USING (public.is_admin() AND is_system = true)
  WITH CHECK (public.is_admin() AND is_system = true);

DROP POLICY IF EXISTS workout_library_admin_delete_system ON public.workout_library;
CREATE POLICY workout_library_admin_delete_system
  ON public.workout_library FOR DELETE TO authenticated
  USING (public.is_admin() AND is_system = true);

-- ---------------------------------------------------------------------------
-- 4) Borrar cuenta: carpetas del coach
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  own_athlete_ids bigint[];
  orphan_athlete_ids bigint[];
  all_delete_athlete_ids bigint[];
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT coalesce(array_agg(id), ARRAY[]::bigint[])
  INTO own_athlete_ids
  FROM public.athletes
  WHERE user_id = uid;

  SELECT coalesce(array_agg(id), ARRAY[]::bigint[])
  INTO orphan_athlete_ids
  FROM public.athletes
  WHERE coach_id = uid AND user_id IS NULL;

  all_delete_athlete_ids := own_athlete_ids || orphan_athlete_ids;

  DELETE FROM public.challenge_participants
  WHERE user_id = uid
     OR athlete_id::bigint = ANY (all_delete_athlete_ids);

  DELETE FROM public.oauth_states
  WHERE user_id = uid
     OR athlete_id::bigint = ANY (all_delete_athlete_ids);

  DELETE FROM public.device_connections
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids);

  DELETE FROM public.athlete_achievements
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids);

  DELETE FROM public.athlete_evaluations
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR coach_id = uid;

  DELETE FROM public.races
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR coach_id = uid;

  DELETE FROM public.messages
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR coach_id = uid;

  DELETE FROM public.workouts
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids);

  DELETE FROM public.plan_drafts
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR coach_id = uid;

  DELETE FROM public.training_plans
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR coach_id = uid;

  DELETE FROM public.coach_requests
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR coach_id = uid;

  DELETE FROM public.staff_athletes
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR staff_id = uid
     OR coach_id = uid;

  DELETE FROM public.coach_staff
  WHERE staff_id = uid
     OR coach_id = uid;

  DELETE FROM public.invitations WHERE coach_id = uid;
  DELETE FROM public.ai_generations WHERE coach_id = uid;
  DELETE FROM public.workout_library WHERE coach_id = uid;
  DELETE FROM public.library_folders WHERE coach_id = uid;

  UPDATE public.athlete_payments
  SET athlete_id = NULL,
      coach_id = CASE WHEN coach_id = uid THEN NULL ELSE coach_id END
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR coach_id = uid;

  UPDATE public.plan_purchases
  SET buyer_athlete_id = NULL,
      review = NULL
  WHERE buyer_user_id = uid
     OR buyer_athlete_id::bigint = ANY (all_delete_athlete_ids);

  UPDATE public.athletes
  SET coach_id = NULL
  WHERE coach_id = uid
    AND user_id IS DISTINCT FROM uid
    AND user_id IS NOT NULL;

  DELETE FROM public.athletes
  WHERE id = ANY (all_delete_athlete_ids);

  DELETE FROM public.plan_marketplace p
  WHERE p.coach_id = uid
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_purchases pp WHERE pp.plan_id = p.id
    );

  UPDATE public.challenges
  SET created_by = NULL
  WHERE created_by = uid;

  UPDATE public.promo_codes
  SET created_by = NULL
  WHERE created_by = uid;

  UPDATE public.profiles
  SET parent_coach_id = NULL
  WHERE parent_coach_id = uid;

  DELETE FROM public.coach_profiles WHERE user_id = uid;
  DELETE FROM public.coaches WHERE user_id = uid;
  DELETE FROM public.profiles WHERE user_id = uid;

  DELETE FROM auth.users WHERE id = uid;

  RETURN jsonb_build_object('ok', true, 'user_id', uid);
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
