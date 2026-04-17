-- Eliminar políticas de profiles y recrearlas de forma limpia.

DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Usuario crea su perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuario elimina su perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuario lee su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin lee todos los perfiles" ON public.profiles;

-- Limpieza adicional de políticas legacy en este repo
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_role_select_all ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_role_update_all ON public.profiles;
DROP POLICY IF EXISTS profiles_platform_admin_select ON public.profiles;
DROP POLICY IF EXISTS profiles_platform_admin_update ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

-- Política simple: cada usuario lee su propio perfil
CREATE POLICY "Usuario lee su propio perfil"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admin lee todos (sin recursión - usa user_id directo)
CREATE POLICY "Admin lee todos los perfiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

-- Update
CREATE POLICY "Usuario actualiza su propio perfil"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admin actualiza todos los perfiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

-- Insert
CREATE POLICY "Usuario crea su perfil"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Delete
CREATE POLICY "Admin elimina perfiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

NOTIFY pgrst, 'reload schema';
