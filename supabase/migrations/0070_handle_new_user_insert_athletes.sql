-- Extiende handle_new_user: si el alta es atleta, crea también la fila en
-- athletes en el INSERT de auth.users (antes de confirmar el correo).
--
-- coach_id va SIEMPRE en el INSERT: la columna tiene default gen_random_uuid()
-- y omitirla asignaría un UUID basura como entrenador.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role text;
  v_name text;
  v_coach_raw text;
  v_coach_id uuid;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'coach');
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));

  RAISE LOG 'handle_new_user: id=%, email=%, role=%, name=%', NEW.id, NEW.email, v_role, v_name;

  INSERT INTO public.profiles (user_id, email, name, role)
  VALUES (NEW.id, NEW.email, v_name, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  IF lower(trim(v_role)) = 'athlete' THEN
    v_coach_raw := NULLIF(trim(NEW.raw_user_meta_data->>'coach_id'), '');
    IF v_coach_raw IS NULL
       OR v_coach_raw IN ('undefined', 'null')
       OR v_coach_raw = NEW.id::text THEN
      v_coach_id := NULL;
    ELSE
      BEGIN
        v_coach_id := v_coach_raw::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_coach_id := NULL;
      END;
      IF v_coach_id = NEW.id THEN
        v_coach_id := NULL;
      END IF;
    END IF;

    INSERT INTO public.athletes (
      user_id,
      name,
      email,
      goal,
      pace,
      weekly_km,
      coach_id
    ) VALUES (
      NEW.id,
      v_name,
      lower(NEW.email),
      'Objetivo pendiente',
      'Pendiente',
      0,
      v_coach_id
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RAISE LOG 'handle_new_user: INSERT completado para %', NEW.email;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user ERROR: % - %', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;
