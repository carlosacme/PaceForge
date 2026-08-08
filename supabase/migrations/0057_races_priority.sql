-- Prioridad de la carrera: decide cuanto afinamiento merece.
--
-- A = carrera objetivo    -> afinamiento completo segun la distancia
-- B = carrera importante  -> solo los ultimos 3-4 dias suaves
-- C = carrera de entreno  -> se corre dentro de la carga normal, sin taper
--
-- Las carreras ya registradas pasan a 'A', que es el comportamiento que el
-- coach daba por supuesto cuando no habia forma de decir otra cosa.

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'A';

ALTER TABLE public.races
  DROP CONSTRAINT IF EXISTS races_priority_check;

ALTER TABLE public.races
  ADD CONSTRAINT races_priority_check CHECK (priority IN ('A', 'B', 'C'));

NOTIFY pgrst, 'reload schema';
