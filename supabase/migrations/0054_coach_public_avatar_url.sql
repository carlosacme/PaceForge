-- Foto del coach en la vista publica de coaches.
--
-- El coach ya sube su foto desde Configuracion -> Perfil (bucket publico
-- coach-avatars) y la URL se guarda en coach_profiles.avatar_url. El problema
-- es que el atleta no puede leer esa tabla: las unicas policies de
-- coach_profiles son "el propio coach o el admin".
--
-- La tarjeta "Tu coach" de AthleteHome ya lee el nombre de la vista
-- coach_public, que sale de profiles y corre con security_invoker = off, o sea
-- con los privilegios del owner. Ahi es donde toca anadir la foto: asi el
-- atleta la recibe en la misma consulta que ya hace, sin abrir coach_profiles
-- ni pedir una peticion extra por render.
--
-- Solo se expone la URL de una imagen de un bucket publico; el resto de
-- coach_profiles (telefono, email, suscripcion) sigue fuera de la vista.
-- coach_profiles.user_id es UNIQUE, asi que el LEFT JOIN no duplica filas.

CREATE OR REPLACE VIEW public.coach_public
  WITH (security_invoker = off) AS
  SELECT
    p.user_id,
    p.coach_id,
    p.name,
    p.role,
    cp.avatar_url
  FROM public.profiles p
  LEFT JOIN public.coach_profiles cp ON cp.user_id = p.user_id
  WHERE p.role IN ('coach', 'admin');

REVOKE ALL ON public.coach_public FROM public;
GRANT SELECT ON public.coach_public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
