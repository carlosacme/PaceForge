-- ai_generations: reparar el tope de generaciones IA.
--
-- 0013 declaraba UNIQUE (coach_id, month) y una policy UPDATE, pero corrió como
-- CREATE TABLE IF NOT EXISTS sobre una tabla que ya existía: fue un no-op.
-- Prod quedó con `id bigint identity` (no uuid), columnas nullable, sin UNIQUE,
-- sin índice (coach_id, month) y con solo dos policies (SELECT, INSERT).
--
-- Sin policy UPDATE, el .update() del cliente afecta 0 filas y PostgREST
-- responde 204 sin error: Builder/Plan2Weeks creían haber incrementado y el
-- contador mensual quedó congelado en 1 desde 2026-08-04.
--
-- El conteo pasa al servidor con increment_ai_generation() (service_role, que
-- no pasa por RLS). NO se añade policy UPDATE para el coach: con ella cualquiera
-- podría poner su count en 0 desde el navegador y saltarse el tope que este
-- contador existe para aplicar (ya lo advertía docs/rate-limit-map.md).

-- 1) Deduplicar antes de poder añadir el UNIQUE. Se conserva la fila más
--    reciente y se le suma el count de sus duplicadas: cada fila se incrementó
--    por separado, así que la suma es el uso real. Hoy no hay duplicadas en
--    prod; esto corre por si aparecen antes de aplicar la migración.
--
--    El lock evita que un INSERT concurrente entre en medio y sobreviva a la
--    deduplicación justo para chocar contra el UNIQUE de más abajo.
LOCK TABLE public.ai_generations IN SHARE ROW EXCLUSIVE MODE;

-- El UPDATE deja updated_at intacto a propósito: el DELETE de abajo vuelve a
-- elegir superviviente con el mismo ORDER BY, así que si esta fila cambiara de
-- fecha podría dejar de ser la elegida y se borraría la fila con el total.
WITH grouped AS (
  SELECT
    coach_id,
    month,
    sum(count)::int AS total,
    (array_agg(id ORDER BY updated_at DESC, id DESC))[1] AS keep_id
  FROM public.ai_generations
  GROUP BY coach_id, month
  HAVING count(*) > 1
)
UPDATE public.ai_generations a
   SET count = g.total
  FROM grouped g
 WHERE a.id = g.keep_id;

WITH grouped AS (
  SELECT
    coach_id,
    month,
    (array_agg(id ORDER BY updated_at DESC, id DESC))[1] AS keep_id
  FROM public.ai_generations
  GROUP BY coach_id, month
)
DELETE FROM public.ai_generations a
 USING grouped g
 WHERE a.coach_id = g.coach_id
   AND a.month = g.month
   AND a.id <> g.keep_id;

-- 2) Un UNIQUE con NULLs no sirve: los NULL cuentan como distintos y volverían
--    a colarse filas duplicadas por coach/mes.
ALTER TABLE public.ai_generations
  ALTER COLUMN coach_id SET NOT NULL,
  ALTER COLUMN month SET NOT NULL,
  ALTER COLUMN count SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_generations'::regclass
       AND conname = 'ai_generations_coach_month_key'
  ) THEN
    ALTER TABLE public.ai_generations
      ADD CONSTRAINT ai_generations_coach_month_key UNIQUE (coach_id, month);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_generations'::regclass
       AND conname = 'ai_generations_count_non_negative'
  ) THEN
    ALTER TABLE public.ai_generations
      ADD CONSTRAINT ai_generations_count_non_negative CHECK (count >= 0);
  END IF;
END $$;

-- 3) Incremento atómico. Un read-modify-write desde el API pierde cuentas si
--    dos generaciones caen a la vez; ON CONFLICT resuelve la carrera en la fila.
CREATE OR REPLACE FUNCTION public.increment_ai_generation(p_coach_id uuid, p_month text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.ai_generations (coach_id, month, count, updated_at)
  VALUES (p_coach_id, p_month, 1, now())
  ON CONFLICT (coach_id, month)
  DO UPDATE SET count = ai_generations.count + 1,
                updated_at = now()
  RETURNING count;
$$;

-- CREATE FUNCTION concede EXECUTE a PUBLIC por defecto. Solo el servidor puede
-- mover el contador: desde el browser esto sería un incremento gratis a cualquier coach.
REVOKE ALL ON FUNCTION public.increment_ai_generation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_ai_generation(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.increment_ai_generation(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ai_generation(uuid, text) TO service_role;

-- 4) El botón "Resetear generaciones" del panel Admin hace un DELETE con el JWT
--    del admin. Sin policy DELETE afectaba 0 filas y aun así decía "reseteadas ✓".
DROP POLICY IF EXISTS ai_generations_delete_admin ON public.ai_generations;
CREATE POLICY ai_generations_delete_admin
  ON public.ai_generations FOR DELETE
  TO authenticated
  USING (is_admin());
