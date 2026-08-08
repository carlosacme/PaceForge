-- Resolver el link de invitacion sin abrir la tabla de invitaciones.
--
-- El registro desde ?invite=<codigo> consultaba public.invitations antes de
-- crear la sesion, o sea como anon, y las unicas policies de esa tabla exigen
-- coach_id = auth.uid(). La consulta devolvia cero filas sin error, el coach
-- se quedaba en null y el atleta terminaba registrado SIN COACH y sin aviso.
--
-- La 0019 preveia una policy "invitations_public_select_pending" con
-- USING (status = 'pending') para anon, pero nunca se aplico en produccion y
-- tampoco conviene: una policy no puede exigir que el cliente filtre por
-- codigo, asi que cualquiera con la anon key podria listar TODAS las
-- invitaciones pendientes con sus emails y sus coaches.
--
-- En su lugar, dos funciones SECURITY DEFINER que solo responden al codigo
-- exacto, siguiendo el patron que ya usa find_coach_by_code. El codigo es un
-- UUID, asi que no se puede adivinar ni enumerar.

CREATE OR REPLACE FUNCTION public.find_invitation_by_code(p_code text)
RETURNS TABLE (coach_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.coach_id, i.email
  FROM public.invitations i
  WHERE i.code = p_code
    AND i.status = 'pending'
    AND COALESCE(i.type, 'athlete') = 'athlete'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_invitation_by_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.find_invitation_by_code(text) TO anon, authenticated;

-- Marcar la invitacion como usada. Tambien tiene que poder llamarse sin
-- sesion: con verificacion de email activada, el atleta no la tiene todavia
-- al terminar el registro. Lo peor que puede hacer quien acierte un UUID es
-- quemar esa invitacion concreta.
CREATE OR REPLACE FUNCTION public.accept_invitation_by_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.invitations
     SET status = 'accepted'
   WHERE code = p_code
     AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_by_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invitation_by_code(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
