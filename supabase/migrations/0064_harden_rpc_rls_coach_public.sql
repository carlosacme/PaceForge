-- =============================================================
-- 0064_harden_rpc_rls_coach_public.sql
-- -------------------------------------------------------------
-- SOLO LECTURA / BORRADOR PARA REVISION: NO APLICAR hasta probar
-- el plan de cada seccion (ver comentarios "QUE SE ROMPE").
--
-- Corrige hallazgos de advisors / auditoria:
--   1) upsert_profile ejecutable sin ownership check
--   2) accept_invitation_by_code sin binding de email
--   3) expire_stale_purchases / renew_recurring_challenges abiertos a anon
--   4) coach_public sin filtrar is_public (fuga de directorio)
--   5) policies de workouts INSERT/UPDATE por email en vez de user_id
--
-- Idempotente en lo posible (CREATE OR REPLACE / REVOKE / DROP POLICY IF EXISTS).
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1) upsert_profile — solo service_role + defensa en profundidad
-- -------------------------------------------------------------
-- Contexto: api/create-profile.js ya llama con SUPABASE_SERVICE_ROLE_KEY.
-- El cliente NO debe poder invocar /rest/v1/rpc/upsert_profile.
--
-- Hay DOS firmas en produccion; hay que cerrar ambas.

CREATE OR REPLACE FUNCTION public.upsert_profile(
  p_user_id uuid,
  p_email text,
  p_name text,
  p_role text,
  p_coach_id text DEFAULT NULL
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result public.profiles;
  v_role text;
BEGIN
  -- Si alguien recupera EXECUTE con JWT, no puede tocar otro user_id.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'upsert_profile: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Nunca promover a admin por esta RPC (ni siquiera via service_role).
  v_role := lower(coalesce(nullif(trim(p_role), ''), 'athlete'));
  IF v_role NOT IN ('coach', 'athlete') THEN
    RAISE EXCEPTION 'upsert_profile: role invalido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET email    = COALESCE(p_email, email),
         name     = COALESCE(p_name, name),
         role     = v_role,
         coach_id = COALESCE(p_coach_id, coach_id)
   WHERE user_id = p_user_id
   RETURNING * INTO result;

  IF FOUND THEN
    RETURN result;
  END IF;

  INSERT INTO public.profiles (user_id, email, name, role, coach_id, created_at)
  VALUES (p_user_id, p_email, p_name, v_role, p_coach_id, NOW())
  RETURNING * INTO result;

  RETURN result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO result FROM public.profiles WHERE user_id = p_user_id;
    RETURN result;
END;
$$;

-- Overload legado (p_full_name). Misma politica de acceso.
CREATE OR REPLACE FUNCTION public.upsert_profile(
  p_user_id uuid,
  p_email text,
  p_full_name text DEFAULT NULL,
  p_role text DEFAULT 'athlete'
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result public.profiles;
  v_role text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'upsert_profile: forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := lower(coalesce(nullif(trim(p_role), ''), 'athlete'));
  IF v_role NOT IN ('coach', 'athlete') THEN
    RAISE EXCEPTION 'upsert_profile: role invalido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET email     = COALESCE(p_email, email),
         full_name = COALESCE(p_full_name, full_name),
         role      = v_role,
         updated_at = NOW()
   WHERE user_id = p_user_id
   RETURNING * INTO result;

  IF FOUND THEN
    RETURN result;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name, role, created_at, updated_at)
  VALUES (p_user_id, p_email, p_full_name, v_role, NOW(), NOW())
  RETURNING * INTO result;

  RETURN result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO result FROM public.profiles WHERE user_id = p_user_id;
    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_profile(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_profile(uuid, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_profile(uuid, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_profile(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_profile(uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_profile(uuid, text, text, text) TO service_role;

-- QUE SE ROMPE SI SALE MAL:
--   - Cualquier llamada cliente directa a rpc('upsert_profile') (hoy no deberia
--     haber ninguna; el front usa /api/create-profile).
--   - Si create-profile.js perdiera SERVICE_ROLE_KEY y usara anon, fallaria 401/42501.
--   - Intentar crear role='admin' via esta RPC falla a proposito.
-- PROBAR ANTES:
--   1) POST /api/create-profile con JWT valido (flujo registro/confirm) -> 200.
--   2) Como authenticated: POST /rest/v1/rpc/upsert_profile -> debe fallar (sin EXECUTE).
--   3) Como anon: igual.


-- -------------------------------------------------------------
-- 2) accept_invitation_by_code — binding auth.email() = invitations.email
-- -------------------------------------------------------------
-- NOTA DE APP (obligatoria tras aplicar):
--   Hoy App.jsx llama esta RPC justo despues de signUp, a menudo SIN sesion
--   (confirmacion de correo activa). Tras este cambio eso devolvera false /
--   forbidden. Mover el accept a cuando haya sesion (ConfirmEmailScreen /
--   primer login) guardando el invite code en localStorage, O pasar a llamar
--   solo si data.session existe y el email de la sesion ya coincide.
--
-- Se revoca anon: el codigo UUID ya no basta para quemar invitaciones.

CREATE OR REPLACE FUNCTION public.accept_invitation_by_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated integer;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  v_email := lower(trim(coalesce(auth.email(), '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'accept_invitation_by_code: sesion sin email' USING ERRCODE = '28000';
  END IF;

  UPDATE public.invitations
     SET status = 'accepted'
   WHERE code = p_code
     AND status = 'pending'
     AND lower(trim(email)) = v_email;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_invitation_by_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation_by_code(text) TO authenticated;

-- QUE SE ROMPE SI SALE MAL:
--   - Registro con ?invite=CODE sin sesion: la invitacion queda pending
--     (el atleta SI puede quedar con coach_id via metadata/create-profile,
--     pero el link aparece "sin usar" al coach hasta que se acepte con sesion).
--   - Abrir el invite link con OTRO email autenticado: no acepta (correcto).
--   - Staff invites que compartan esta misma RPC: tambien exigen email match.
-- PROBAR ANTES:
--   1) Crear invitacion pending a email X, login como X, rpc(code) -> true.
--   2) Login como Y != X, mismo code -> false / 0 filas.
--   3) anon sin JWT -> error not_authenticated.


-- -------------------------------------------------------------
-- 3) Cron RPCs — solo service_role (pg_cron sigue siendo owner/DB)
-- -------------------------------------------------------------
-- pg_cron en Supabase ejecuta como rol privilegiado de la base, no como anon.
-- Revocar EXECUTE a anon/authenticated cierra el abuso por PostgREST.

REVOKE ALL ON FUNCTION public.expire_stale_purchases() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_purchases() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_purchases() TO service_role;

REVOKE ALL ON FUNCTION public.renew_recurring_challenges() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_recurring_challenges() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_recurring_challenges() TO service_role;

-- QUE SE ROMPE SI SALE MAL:
--   - Llamadas manuales desde el SQL editor con rol authenticated fallan
--     (usar service_role o postgres).
--   - Si algun job externo llamaba la RPC via REST con anon key, deja de
--     funcionar (hoy solo pg_cron interno esta cableado en 0048/0050).
-- PROBAR ANTES:
--   1) SELECT cron.job WHERE jobname IN ('expire-stale-purchases','renew-recurring-challenges');
--   2) Tras aplicar, esperar el cron o: SET ROLE postgres; SELECT expire_stale_purchases();
--   3) Como anon: POST /rest/v1/rpc/expire_stale_purchases -> 401/403.


-- -------------------------------------------------------------
-- 4) coach_public — no listar coaches privados en el directorio
-- -------------------------------------------------------------
-- El directorio (AthleteHome) ya filtra .eq('is_public', true), pero la vista
-- devolvía TODAS las filas a quien omitiera el filtro.
--
-- OJO: AthleteHome también lee el coach ASIGNADO sin filtrar is_public
-- (nombre/avatar). Por eso NO basta con "WHERE is_public": hay que permitir
-- ver al coach vinculado al atleta autenticado (y al propio usuario).

CREATE OR REPLACE VIEW public.coach_public
  WITH (security_invoker = off) AS
  SELECT
    p.user_id,
    p.coach_id,
    p.name,
    p.role,
    cp.avatar_url,
    COALESCE(cp.is_public, false) AS is_public,
    cp.city,
    cp.country,
    cp.full_name
  FROM public.profiles p
  LEFT JOIN public.coach_profiles cp ON cp.user_id = p.user_id
  WHERE p.role IN ('coach', 'admin')
    AND (
      COALESCE(cp.is_public, false) = true
      OR p.user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.athletes a
        WHERE a.coach_id = p.user_id
          AND a.user_id = auth.uid()
      )
    );

REVOKE ALL ON public.coach_public FROM PUBLIC;
GRANT SELECT ON public.coach_public TO anon, authenticated;

-- QUE SE ROMPE SI SALE MAL:
--   - Un SELECT * sin filtro ya no lista coaches con is_public=false (deseado).
--   - Atleta cuyo coach es privado: SIGUE viendo nombre/avatar si athletes.coach_id
--     apunta a ese coach; si coach_id esta mal / null, deja de ver la tarjeta.
--   - anon sin sesion: solo ve is_public=true (auth.uid() null).
-- PROBAR ANTES:
--   1) Directorio atleta: solo publicos.
--   2) Atleta ligado a coach is_public=false: banner con nombre/foto OK.
--   3) Como anon: count de filas = solo publicos.


-- -------------------------------------------------------------
-- 5) workouts INSERT/UPDATE atleta — por user_id, no por email
-- -------------------------------------------------------------
-- Hoy: athletes.email = auth.email(). Fragil si cambia el correo en Auth y
-- no se sincroniza athletes.email. En prod actual: 0 mismatches y 0 atletas
-- sin user_id (verificado en auditoria), asi que el cambio es seguro.

DROP POLICY IF EXISTS "athletes can insert own workouts from marketplace" ON public.workouts;
CREATE POLICY "athletes can insert own workouts from marketplace"
  ON public.workouts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    athlete_id IN (
      SELECT a.id
      FROM public.athletes a
      WHERE a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "athletes can update own workouts" ON public.workouts;
CREATE POLICY "athletes can update own workouts"
  ON public.workouts
  FOR UPDATE
  TO authenticated
  USING (
    athlete_id IN (
      SELECT a.id
      FROM public.athletes a
      WHERE a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    athlete_id IN (
      SELECT a.id
      FROM public.athletes a
      WHERE a.user_id = auth.uid()
    )
  );

-- QUE SE ROMPE SI SALE MAL:
--   - Atletas legacy SIN user_id (filas solo-email creadas por el coach):
--     no podrian autocompletar / cargar marketplace a su calendario.
--     Hoy en paceforge: 0 filas con user_id null; si reaparecen, hay que
--     backfillear user_id antes de aplicar.
--   - Si el atleta opera con un athletes.id que no es el suyo (bug de cliente),
--     el INSERT/UPDATE falla (correcto).
-- PROBAR ANTES:
--   1) SELECT count(*) FROM athletes WHERE user_id IS NULL;  -- debe ser 0
--   2) Atleta marca workout hecho / edita RPE / notas -> OK
--   3) Atleta carga plan marketplace a su calendario -> OK
--   4) Intentar UPDATE de workout de otro athlete_id -> 0 filas

NOTIFY pgrst, 'reload schema';

COMMIT;
