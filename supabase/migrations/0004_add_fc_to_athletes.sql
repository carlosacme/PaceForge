-- Frecuencia cardíaca para zonas de entrenamiento
alter table public.athletes
  add column if not exists fc_max integer,
  add column if not exists fc_reposo integer;

comment on column public.athletes.fc_max is 'FC máxima estimada (lpm), para calcular zonas';
comment on column public.athletes.fc_reposo is 'FC en reposo (lpm), referencia opcional';
