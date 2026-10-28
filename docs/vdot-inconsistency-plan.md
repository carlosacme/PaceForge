# VDOT inconsistente dentro de un mismo entreno

Diagnóstico y plan. **Sin cambios de producción** hasta que Carlos apruebe.

Hoy un atleta puede ver dos ritmos distintos para el mismo bloque: la
descripción del workout (VDOT de biblioteca / Garmin ~47.2) y los
`target_pace` de los pasos (VDOT del atleta, a veces mezclados entre sí).

---

## 1) Dónde se llama `rescaleStructureToVdot` y si puede aplicarse dos veces

Solo hay **tres** llamadas en código. El push al reloj **no** rescale.

| # | Sitio | Cuándo | Calibración (origen) | Target | ¿Toca `description`? |
|---|---|---|---|---|---|
| 1 | `WorkoutLibrary.buildAssignedRow` | Asignar desde biblioteca (y FIT importado a biblioteca) | Default **47.2** (`PLAN_CALIBRATION_VDOT`) | `vdot + progressionDelta` | No. Copia `row.description` y solo quita el “objetivo mm:ss” de TEST. |
| 2 | `Builder.jsx` al asignar | Asignar un workout suelto del builder a uno o más atletas | Default **47.2** | Última eval del atleta (**sin** `progressionDelta`) | No. Igual: copia y strip de TEST. |
| 3 | `api/integrations.js` → `resyncPacesAfterEvaluation` | Tras guardar una evaluación (`action: vdot-resync`). Lo dispara `EvaluationView` vía `resyncPacesAfterEvaluation` en `appShared.js` | `generated_with_vdot` de la fila | `resolveTargetVdotAfterTest` | No. Solo `structure` + `generated_with_vdot`. |

### Lo que parece rescale y no lo es

- **Plan2Weeks**: `enrichStructureWithPaces` (rellena ritmos vacíos desde FC / etiqueta). No rescale. La IA debería haber escrito ritmos al VDOT del atleta. `description` se copia.
- **MarketplaceHub**: igual, solo enrich. Si el plan trae ritmos numéricos a 47.2, **se quedan**. `generated_with_vdot` se guarda como el VDOT del atleta (la etiqueta miente).
- **GpxRacePlan**: construye ritmos con Minetti al VDOT del atleta. No pasa por `rescaleStructureToVdot`.
- **Push / re-push** (`push-workout`, `push-range`, `resyncFutureWorkouts` por `SPORT_SETTINGS_UPDATED`): `buildIntervalsEvent` → `toIntervalsText` → `normalizeBlock`. Si el paso ya tiene `m:ss`, **ese número va al reloj**. El VDOT que se pasa es `getLatestVdot` (eval vigente), no `generated_with_vdot`. Solo afecta bloques cualitativos (“easy jog”) sin ritmo numérico.
- **Edición del coach** en el calendario: guarda `description` y `structure` a mano. No rescale.

### ¿Puede aplicarse más de una vez al mismo entreno?

Sí.

1. **Asignación** (biblioteca/builder) con calibración fija 47.2. Los pasos que mapean se reescriben al target y se les pone `target_zone`. Los que **no** mapean (tolerancia 15 s/km) se dejan intactos. Luego se sella `generated_with_vdot = target`.
2. **vdot-resync** (eval nueva): vuelve a llamar `rescaleStructureToVdot(antes, targetNuevo, generated_with_vdot)`. El comentario dice “idempotente” porque actualiza el origen al target. Eso solo es cierto si **todos** los pasos mapearon en el primer pase. Un paso que falló sigue con el ritmo viejo, pero el origen de la fila ya es el target nuevo. El siguiente resync interpreta ese ritmo viejo **con el VDOT nuevo** → riesgo de cambio de zona (el propio `0062` lo documenta: a 42.5 la R es 4:03, que en el plan a 47.2 es I).
3. **Reasignar** un workout ya rescalado (builder: estructura del primer atleta; o biblioteca sucia). La calibración vuelve a ser **47.2**, no el VDOT con el que están escritos los ritmos. Un WU ya a 6:24-5:49 (E @ 43.37) **no mapea** a 47.2 y se queda; un M que siga en 4:39 sí mapea y se reescribe al target nuevo (~41.3). Mezcla dentro de `structure`.
4. El **re-push** no suma un rescale, pero puede mandar al reloj ritmos viejos con un VDOT “de contexto” distinto.

`target_zone` se escribe en el rescale con éxito, pero **nunca se lee** en el siguiente rescale: siempre se vuelve a deducir el ritmo con `paceToZone`. Las recetas de biblioteca conocen la zona al expandir (`libraryRecipes.js`) y **no la guardan**.

---

## 2) Cuántos entrenos reales tienen VDOTs mezclados

No se ejecutó nada contra producción. El inventario está en:

- `scripts/diagnose-mixed-vdot-workouts.sql` — conteos SELECT
- `scripts/diagnose-mixed-vdot-workouts.mjs` — infiere VDOT por paso (SELECT, dry-run, escribe JSON local)

Correr el SQL en el SQL editor de Supabase (o `psql`). El `.mjs` solo si quieres el desglose por paso; default dry-run, sin UPDATE.

Criterio de “mezclado” en el script:

- cada paso con ritmo `m:ss` obtiene el VDOT cuya zona (E/M/T/I/R) mejor encaja;
- el entreno es sospechoso si el spread entre esos VDOTs es ≥ 0.5, o si la `description` tiene `/km` que no coincide con ningún `target_pace` (±3 s).

---

## 3) Propuesta de arreglo (tras aprobación)

### a) Rescale por zona guardada, idempotente

Orden de zona por paso:

1. `target_zone` / `zone` ya guardado (E/M/T/I/R; HM/T10 → T para comparar).
2. Texto del paso (`E pace`, easy, rodaje, long, `M pace`, …).
3. `paceToZone(ritmo, calibrationVdot)` solo como fallback.

Luego `paceRangeForZone(zona, targetVdot)` y se **persiste** `target_zone`.

Idempotencia: misma zona + mismo target → mismo string. Aplicar 2 veces = 1 vez.

En asignación, pasar el origen de verdad:

- biblioteca / recetas / FIT importado → 47.2 (o el VDOT del archivo si algún día se guarda);
- resync → `generated_with_vdot`;
- nunca el default 47.2 sobre ritmos ya reescritos.

Al expandir recetas, guardar `zone` en el JSON (hoy se tira). Al importar FIT, si el `stepName` trae `E pace`, persistirlo.

Pasos sin zona (TEST all-out, recovery más lento que E a propósito) se dejan.

### b) Una sola fuente de verdad para el atleta

`rescaleStructureToVdot` **no** debe reescribir la prosa del workout: el comentario actual es correcto (rompería “MARATON 3:15” o splits `4:40→4:37`).

Recomendación:

- **Fuente de verdad = `structure[].target_pace`** (y el desglose de pasos).
- En la UI del atleta (`WorkoutDetailBreakdown` y equivalentes): pasar `description` por `stripEmbeddedPaceFromText`. El atleta no ve un segundo ritmo.
- En asignaciones nuevas: mismo strip al guardar, para que el campo deje de mentir.
- No regenerar la descripción con ritmos nuevos (la prosa del coach/FIT se pierde o se inventa).

### c) Hechos vs pendientes

| Estado | Qué hacer |
|---|---|
| `done = true` o `scheduled_date` pasada | **No reescribir** `structure` ni `description`. El registro / IA / compareBlocks siguen leyendo lo que se corrió. |
| Pendiente futuro, aún no enviado al reloj | Candidato a backfill. |
| Pendiente ya upsertado en intervals.icu | Backfill de `structure` y, si se aprueba, re-push (mismo `external_id`, como `vdot-resync`). |
| `generated_with_vdot` NULL | No adivinar origen (regla de `0062`). Listar aparte. |

Backfill al estilo `achieved_on`:

1. Dry-run: lista `id, title, scheduled_date, generated_with_vdot, done`, ritmos antes/después por paso, VDOT implícito, flag “description tiene /km”.
2. Carlos aprueba el JSON.
3. Apply solo de pendientes futuros, con snapshot `before` para rollback.
4. Re-push solo de los que ya estaban en el reloj.

Ningún apply en este PR.

---

## 4) Tests propuestos (cuando se implemente)

1. `rescale(rescale(s, T), T) === rescale(s, T)` (string-equal por paso).
2. Entrada mezclada: WU 6:24-5:49 (E @ 43.37, con `target_zone: E`) + M 4:39 (sin zona, calib 47.2) → los dos a E/M del **mismo** target; segunda pasada idéntica.
3. TEST 3K: all-out sigue sin ritmo; WU/CD/R al mismo VDOT; no inventar zona I por el texto “3K”.
4. Long Progresivo: 6:38-6:03 y 5:18-5:12 coherentes con un solo VDOT (~41.3); descripción en UI sin `/km` o con esos mismos números.
5. Recovery más lento que E, sin zona, intacto.
6. `toIntervalsText` / `getWorkoutDetailGroups` leen los ritmos guardados; el VDOT del push no los pisa.
7. Fixture de backfill dry-run: hechos no salen; pendientes sí; `--execute` no existe o está muerto hasta flag.

---

## 5) Riesgos y rollback

**Riesgos**

- `target_zone` mal grabado en un rescale viejo se “clava” si pasamos a confiar en él. Mitigación: dry-run compara zona guardada vs texto vs `paceToZone`; discrepancias a revisión manual.
- Quitar ritmos de la descripción: el atleta deja de ver un número duplicado; el coach que editaba la prosa pierde el `/km` embebido. Mitigación: strip solo en vista atleta primero; persistir después.
- Re-push masivo: rate limit de intervals.icu. Mitigación: mismo bulk upsert que hoy; lotes.
- Marketplace / Plan2Weeks nunca rescalaron: `generated_with_vdot` puede no coincidir con los ritmos. El dry-run los va a marcar.
- Builder usa VDOT crudo y biblioteca usa VDOT+delta: no es este bug, pero el backfill debe usar el `generated_with_vdot` de la fila, no recalcular el delta.

**Rollback**

- El apply guarda `scripts/output/vdot-backfill-before.json` (id → structure, description, generated_with_vdot).
- Rollback = PATCH de ese snapshot, solo esas filas; re-push si se había reenviado.
- Flag / early return en el rescale nuevo para volver al `paceToZone(..., 47.2)`.
- Hechos no se tocan: no hay rollback de historial.

---

## Fuera de alcance (hasta que se pida)

- Unificar Builder (VDOT crudo) vs biblioteca (`+ progressionDelta`).
- Rescale en MarketplaceHub / Plan2Weeks (hoy ni se llama).
- Cambiar `PLAN_CALIBRATION_VDOT`.
- Merge / código encima de #25 (comparación Garmin).
