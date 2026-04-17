-- Limpiar y recrear políticas de profiles sin subqueries a profiles.

DROP POLICY IF EXISTS "Usuario lee su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin lee todos los perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Usuario actualiza su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin actualiza todos los perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Usuario crea su perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin elimina perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can update all profiles" ON public.profiles;

-- Limpieza extra de políticas legacy del repo
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_role_select_all ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_role_update_all ON public.profiles;
DROP POLICY IF EXISTS profiles_platform_admin_select ON public.profiles;
DROP POLICY IF EXISTS profiles_platform_admin_update ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY "Leer propio perfil"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

CREATE POLICY "Actualizar propio perfil"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

CREATE POLICY "Crear perfil"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Eliminar perfil"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

NOTIFY pgrst, 'reload schema';
