-- Versiona handle_new_user() tal como está en producción hoy.
-- El trigger existía solo en la base (on_auth_user_created); no estaba en
-- migraciones. Este archivo no cambia el comportamiento: profiles sí,
-- athletes no. La extensión a athletes va en 0070.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role text;
  v_name text;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'coach');
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));

  RAISE LOG 'handle_new_user: id=%, email=%, role=%, name=%', NEW.id, NEW.email, v_role, v_name;

  INSERT INTO public.profiles (user_id, email, name, role)
  VALUES (NEW.id, NEW.email, v_name, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  RAISE LOG 'handle_new_user: INSERT completado para %', NEW.email;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user ERROR: % - %', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
