-- Renovación automática diaria de retos recurrentes (pg_cron).
-- Replica la lógica de renewChallengeForNextPeriod en ChallengesHub.jsx:
--   - weekly  -> próximo lunes..domingo (desde CURRENT_DATE)
--   - monthly -> primer..último día del próximo mes calendario
-- Crea fila nueva, no copia participantes, archiva la vieja (is_active=false).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

CREATE OR REPLACE FUNCTION public.renew_recurring_challenges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.challenges%ROWTYPE;
  v_start date;
  v_end date;
  v_dow integer;
  v_days_to_monday integer;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT *
    FROM public.challenges
    WHERE COALESCE(is_active, false) = true
      AND COALESCE(is_recurring, false) = true
      AND end_date < CURRENT_DATE
    ORDER BY end_date ASC, id ASC
  LOOP
    IF lower(coalesce(r.recurrence, 'monthly')) = 'weekly' THEN
      -- Misma lógica que nextWeekMondayToSundayYmd() (DOW: 0=dom .. 6=sáb).
      v_dow := EXTRACT(DOW FROM CURRENT_DATE)::integer;
      IF v_dow = 0 THEN
        v_days_to_monday := 1;
      ELSIF v_dow = 1 THEN
        v_days_to_monday := 7;
      ELSE
        v_days_to_monday := 8 - v_dow;
      END IF;
      v_start := CURRENT_DATE + v_days_to_monday;
      v_end := v_start + 6;
    ELSE
      -- monthly (o cualquier otro valor): primer y último día del próximo mes.
      v_start := (date_trunc('month', CURRENT_DATE) + interval '1 month')::date;
      v_end := (date_trunc('month', CURRENT_DATE) + interval '2 month' - interval '1 day')::date;
    END IF;

    INSERT INTO public.challenges (
      title,
      description,
      type,
      goal_value,
      goal_unit,
      challenge_type,
      target_value,
      unit,
      target_unit,
      badge_emoji,
      badge_color,
      emoji,
      color,
      created_by,
      duration_days,
      start_date,
      end_date,
      is_active,
      participants_count,
      is_recurring,
      recurrence
    ) VALUES (
      r.title,
      r.description,
      r.type,
      r.goal_value,
      r.goal_unit,
      r.challenge_type,
      r.target_value,
      r.unit,
      r.target_unit,
      r.badge_emoji,
      r.badge_color,
      r.emoji,
      r.color,
      r.created_by,
      r.duration_days,
      v_start,
      v_end,
      true,
      0,
      true,
      CASE
        WHEN lower(coalesce(r.recurrence, 'monthly')) = 'weekly' THEN 'weekly'
        ELSE 'monthly'
      END
    );

    UPDATE public.challenges
    SET is_active = false
    WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.renew_recurring_challenges() IS
  'Renueva retos is_recurring vencidos: inserta periodo nuevo y desactiva el anterior. Programada vía pg_cron.';

-- Idempotente: quita el job previo si existe y lo vuelve a crear.
DO $$
BEGIN
  PERFORM cron.unschedule('renew-recurring-challenges');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'renew-recurring-challenges',
  '0 5 * * *',
  $$SELECT public.renew_recurring_challenges()$$
);
