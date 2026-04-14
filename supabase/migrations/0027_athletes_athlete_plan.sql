-- Plan comercial del atleta (p. ej. premium de evaluación / análisis).
alter table public.athletes
add column if not exists athlete_plan text;
