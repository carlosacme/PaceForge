-- 0062_workouts_generated_with_vdot.sql
--
-- Con que VDOT se calcularon los ritmos de un workout al asignarlo.
--
-- Hace falta para poder RECALCULARLOS despues. Los ritmos se guardan como
-- valores absolutos ("4:23-4:31"), y un ritmo absoluto es opaco: para llevarlo
-- al VDOT nuevo de un atleta hay que saber primero a que zona Daniels pertenece,
-- y eso solo se puede deducir sabiendo con que VDOT se escribio. Con el VDOT de
-- origen equivocado el mapeo se desplaza de zona entera y en silencio (a VDOT
-- 42.5 la zona R son 4:03, que en un plan escrito a 47.2 es la zona I).
--
-- Se queda NULL en todo lo ya asignado, y el resincronizado SALTA esas filas a
-- proposito: preferimos dejar un workout con los ritmos viejos a reescribirlo
-- adivinando su origen.

alter table public.workouts
  add column if not exists generated_with_vdot real;

comment on column public.workouts.generated_with_vdot is
  'VDOT con el que se calcularon los ritmos de la estructura al asignar el workout. '
  'Lo escriben las cuatro vias de asignacion (biblioteca, builder, plan de 2 semanas, '
  'marketplace) y lo actualiza el resincronizado tras una evaluacion nueva. '
  'NULL = origen desconocido: el resincronizado no toca esa fila.';

-- El resincronizado busca "los futuros pendientes de este atleta", que es el
-- mismo patron del envio al reloj.
create index if not exists workouts_athlete_scheduled_idx
  on public.workouts (athlete_id, scheduled_date);

-- ---------------------------------------------------------------------------
-- RELLENO OPCIONAL (comentado a proposito: decidelo tu antes de ejecutarlo)
--
-- Lo asignado por el Builder, el plan de 2 semanas y el marketplace escribio sus
-- ritmos con la evaluacion que el atleta tenia en ese momento, asi que se puede
-- deducir: la evaluacion mas reciente ANTERIOR a la fecha de creacion del
-- workout.
--
-- NO vale para lo asignado desde la BIBLIOTECA antes de bbe5875: esos workouts
-- llevan los ritmos de importacion, calibrados a VDOT 47.2, y no hay columna que
-- los distinga de los demas. Si en el ultimo mes se asignaron workouts de
-- biblioteca a estos atletas, este relleno les pondria un origen falso y el
-- recalculo los desplazaria de zona. Sin el relleno no se pierde nada: esos
-- workouts simplemente se quedan con sus ritmos actuales.
--
-- update public.workouts w
--    set generated_with_vdot = (
--          select e.vdot
--            from public.athlete_evaluations e
--           where e.athlete_id = w.athlete_id
--             and e.created_at <= w.created_at
--           order by e.test_date desc, e.created_at desc
--           limit 1
--        )
--  where w.generated_with_vdot is null
--    and w.scheduled_date >= current_date
--    and coalesce(w.done, false) = false;
