-- Flag OFF por defecto. ADD COLUMN no toca filas existentes (PG 11+:
-- DEFAULT false es catalog-only). El push tolera que esta columna aún no exista.

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS watch_step_labels boolean NOT NULL DEFAULT false;
