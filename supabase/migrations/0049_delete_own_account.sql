-- Eliminación de cuenta (requisito Google Play).
-- RPC SECURITY DEFINER: el cliente no puede borrar auth.users ni cruzar RLS
-- de tablas ajenas; solo auth.uid() puede invocarlo sobre sí mismo.
--
-- Orden (dependientes → raíz):
--   1) challenge_participants, oauth_states, device_connections
--   2) athlete_achievements, athlete_evaluations, races, messages, workouts
--   3) plan_drafts, training_plans, coach_requests, staff_athletes, coach_staff
--   4) invitations, ai_generations, workout_library
--   5) Anonimizar athlete_payments / conservar subscription_payments + plan_purchases
--   6) Desvincular atletas ajenos (coach_id = null)
--   7) Borrar atletas propios (user_id = uid) y huérfanos del coach (user_id null)
--   8) plan_marketplace sin compras; challenges.created_by = null
--   9) coach_profiles, coaches, profiles
--  10) auth.users

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

  -- 1) Participación / OAuth / dispositivos
  -- Cast athlete_id::bigint: algunas tablas usan integer y athletes.id es bigint.
  DELETE FROM public.challenge_participants
  WHERE user_id = uid
     OR athlete_id::bigint = ANY (all_delete_athlete_ids);

  DELETE FROM public.oauth_states
  WHERE user_id = uid
     OR athlete_id::bigint = ANY (all_delete_athlete_ids);

  DELETE FROM public.device_connections
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids);

  -- 2) Rendimiento y actividad del atleta
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

  -- 3) Planes / solicitudes / staff
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

  -- 4) Contenido del coach
  DELETE FROM public.invitations WHERE coach_id = uid;
  DELETE FROM public.ai_generations WHERE coach_id = uid;
  DELETE FROM public.workout_library WHERE coach_id = uid;

  -- 5) Facturación: conservar filas; anonimizar FKs cuando se pueda
  UPDATE public.athlete_payments
  SET athlete_id = NULL,
      coach_id = CASE WHEN coach_id = uid THEN NULL ELSE coach_id END
  WHERE athlete_id::bigint = ANY (all_delete_athlete_ids)
     OR coach_id = uid;

  -- subscription_payments.payer_user_id y plan_purchases.* se conservan
  -- (obligación legal; sin PII adicional más allá del UUID histórico).

  UPDATE public.plan_purchases
  SET buyer_athlete_id = NULL,
      review = NULL
  WHERE buyer_user_id = uid
     OR buyer_athlete_id::bigint = ANY (all_delete_athlete_ids);

  -- 6) Atletas ajenos que este coach entrenaba: solo desvincular
  UPDATE public.athletes
  SET coach_id = NULL
  WHERE coach_id = uid
    AND user_id IS DISTINCT FROM uid
    AND user_id IS NOT NULL;

  -- 7) Borrar atletas propios y huérfanos del coach
  DELETE FROM public.athletes
  WHERE id = ANY (all_delete_athlete_ids);

  -- 8) Marketplace / retos (no borrar retos globales; soltar created_by)
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

  -- 9) Perfiles de coach / app
  DELETE FROM public.coach_profiles WHERE user_id = uid;
  DELETE FROM public.coaches WHERE user_id = uid;
  DELETE FROM public.profiles WHERE user_id = uid;

  -- 10) Auth (impide volver a iniciar sesión)
  DELETE FROM auth.users WHERE id = uid;

  RETURN jsonb_build_object('ok', true, 'user_id', uid);
END;
$$;

COMMENT ON FUNCTION public.delete_own_account() IS
  'Borra la cuenta del usuario autenticado (datos app + auth.users). Conserva pagos anonimizados.';

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
