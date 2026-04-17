-- Reemplaza helper admin y políticas SELECT de profiles para evitar recursión.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Reemplazar política SELECT de profiles sin depender de is_admin()
DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_role_select_all ON public.profiles;
DROP POLICY IF EXISTS "Usuario lee su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;

CREATE POLICY "Usuario lee su propio perfil"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admin lee todos los perfiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT user_id
      FROM public.profiles
      WHERE role = 'admin' AND user_id = auth.uid()
    )
  );
