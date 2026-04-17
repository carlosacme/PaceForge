-- Reemplazar is_admin() sin consultar profiles.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

NOTIFY pgrst, 'reload schema';
