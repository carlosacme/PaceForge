-- =============================================================
-- 0045_profiles_policies_and_views.sql
-- -------------------------------------------------------------
-- REGISTRO HISTORICO de cambios de RLS aplicados directo en
-- produccion (Supabase). El repo no reflejaba el estado real de
-- la base; esta migracion lo versiona. Es idempotente
-- (CREATE OR REPLACE / IF EXISTS): correrla de nuevo no rompe nada.
--
-- POR QUE estos cambios:
--
--  1) Una policy SELECT sobre profiles con rol {public} exponia
--     email, fcm_token y subscription_* de TODOS los coaches a
--     cualquiera que tuviera la anon key. Fuga de datos personales
--     y de credenciales de push.
--
--  2) No existia una policy que dejara a un coach leer los perfiles
--     de SUS atletas: el unico acceso amplio era el admin por UUID
--     hardcodeado. Por eso las notificaciones push de los otros 6
--     coaches fallaban en silencio (no podian resolver el token del
--     destinatario).
--
--  3) Se resolvio moviendo los accesos legitimos fuera de la tabla:
--     - Los nombres cross-user se leen desde dos VISTAS acotadas
--       (coach_public, user_names) con security_invoker = off, que
--       exponen solo columnas no sensibles.
--     - El fcm_token YA NO SALE de la base: lo resuelve el backend
--       con service_role (api/send-push.js + lib/apiAuth.js), tras
--       validar la relacion coach<->atleta.
--     Con eso, la policy de profiles se puede cerrar a "solo el
--     propio perfil + admin" sin romper ninguna funcionalidad.
-- =============================================================

-- -------------------------------------------------------------
-- 1) VISTAS ACOTADAS (security_invoker = off => corren con los
--    privilegios del owner de la vista, no del usuario que consulta,
--    de modo que no dependen de la policy de profiles).
-- -------------------------------------------------------------

-- Directorio publico de coaches: solo columnas no sensibles.
CREATE OR REPLACE VIEW public.coach_public
  WITH (security_invoker = off) AS
  SELECT user_id, coach_id, name, role
  FROM public.profiles
  WHERE role IN ('coach', 'admin');

REVOKE ALL ON public.coach_public FROM public;
GRANT SELECT ON public.coach_public TO anon, authenticated;

-- Nombres de cualquier usuario (para etiquetas de participantes,
-- autores de biblioteca, etc.). Nunca email ni datos sensibles.
CREATE OR REPLACE VIEW public.user_names
  WITH (security_invoker = off) AS
  SELECT user_id, name
  FROM public.profiles;

REVOKE ALL ON public.user_names FROM public;
GRANT SELECT ON public.user_names TO authenticated;

-- -------------------------------------------------------------
-- 2) HELPER is_admin() basado en ROL (no en UUID hardcodeado).
--    SECURITY DEFINER + search_path fijo para que consulte profiles
--    sin recursion de RLS (el definer bypassa las policies).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- -------------------------------------------------------------
-- 3) POLICIES DE profiles: limpiar las viejas y dejar 4 claras.
-- -------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Politicas antiguas (varias generaciones de nombres en este repo).
DROP POLICY IF EXISTS "Leer propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Actualizar propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Crear perfil" ON public.profiles;
DROP POLICY IF EXISTS "Eliminar perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuario lee su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin lee todos los perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Usuario actualiza su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin actualiza todos los perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Usuario crea su perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin elimina perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_role_select_all ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_role_update_all ON public.profiles;
DROP POLICY IF EXISTS profiles_platform_admin_select ON public.profiles;
DROP POLICY IF EXISTS profiles_platform_admin_update ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

-- Nombres nuevos (por si se re-ejecuta la migracion).
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_admin ON public.profiles;

-- SELECT: cada quien su perfil; el admin ve todo.
CREATE POLICY profiles_select_own_or_admin
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- INSERT: solo tu propio perfil.
CREATE POLICY profiles_insert_own
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: tu propio perfil o el admin.
CREATE POLICY profiles_update_own_or_admin
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- DELETE: solo admin.
CREATE POLICY profiles_delete_admin
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.is_admin());

NOTIFY pgrst, 'reload schema';
