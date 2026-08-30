# Mapa detallado del calendario (Athletes.jsx)

Fecha: 2026-08-30  
Rama: `test/athletes-breakdown-map`  
HEAD de referencia: tip de esa rama al mapear (después de extraer PDF, chart/badge, list badges, pagos, forma/fatiga, chat, carreras, registro)  
Archivo: `src/components/Athletes/Athletes.jsx` — **~2022** líneas  
Padre: `docs/athletes-breakdown-map.md` §K (líneas de aquel mapa eran del fichero de 3898; **aquí las líneas son las actuales**)

**Estado:** solo análisis. Sin mover código. Esperando validación: ¿una pieza o varias?

**Contexto:** el breakdown original lo dejó para el final a propósito (aislamiento **bajo**). Las 8 extracciones ya hechas le pasan props/callbacks; el grid sigue pintando chips de carrera y abre Registro/IA desde el menú.

---

## 0) Qué es (y qué no es) este calendario

Es el **calendario del coach** en la ficha del atleta: mes, celdas, chips de workout, chips de carrera, DnD, menú contextual, panel editar/mover estructura, borrar rango.

| Qué | ¿Este bloque? |
|---|---|
| Calendario del *atleta* (`AthleteHome`) | No |
| `toggleDone` del atleta (modal RPE / resumen) | No — ver §3 |
| Workout `type: race` / GPX (`grade_pct`) | No — eso es `workouts.structure` |
| Tabla `races` (chips 🏁) | Solo **pinta** y abre el menú de carreras ya extraído |
| Carga de `workouts` (`refreshWorkouts`) | Spine: la consume forma/fatiga, medallas, IA, PDF |

---

## 1) Sub-secciones internas (líneas actuales)

Totales atribuibles **~1060** (el “~1100” del breakdown sigue siendo el orden de magnitud). `workouts` / `loadingWorkouts` / `coachId` / `deviceConnections` **no** se cuentan como estados del calendario: son spine.

### 1.1) Estados y refs propios

| # | Símbolo | Líneas | Dueño |
|---|---|---|---|
| 1 | `dragWorkoutId` | 60 | DnD |
| — | `calendarDragRef` | 61 | DnD ↔ menú (no es useState) |
| 2 | `calendarCtxMenu` | 62 | Menú contextual |
| — | `calendarCtxMenuRef` | 63 | Cierre por click-outside |
| 3–4 | `workoutPanel`, `workoutFormSaving` | 64–65 | Panel editar/mover |
| 5–6 | `workoutEditForm`, `moveDateInput` | 66–74 | Panel estructura |
| 7 | `calendarViewMonth` | 303–306 | Grid mes |
| 8–11 | `rangeDeleteOpen/From/To/Busy` | 326–329 | Borrar rango |

Derivados: `workoutsByDate` 293–301; `calendarCells` / `calendarMonthLabel` 307–318; `ctxMenuWorkout` 575–577; `panelWorkout` 580–582; `rangeDeleteWorkouts/Races/DoneCount` 779–800.

### 1.2) Lógica (handlers)

| Trozo | Líneas | ~Líneas | Notas |
|---|---|---|---|
| `toggleWorkoutDone` | 541–571 | 31 | Coach: `workouts` + `athletes.workouts_done` + medallas. **No** unificar con AthleteHome |
| Abrir/cerrar menú + detalle + paneles | 573–658 | 86 | Incluye click-outside con `setTimeout(0)` |
| `moveWorkoutToDate` | 660–673 | 14 | Optimistic; lo usan DnD **y** el panel “Mover” |
| `saveWorkoutEdits` | 675–699 | 25 | `editableRowsToWorkoutStructure` |
| `mayHaveIntervals` / `forgetIntervalsEvents` | 700–728 | 29 | Lee `deviceConnections` (badges de lista) |
| `deleteCalendarWorkout` | 730–758 | 29 | DELETE + `.select("id")` por RLS silenciosa |
| Rango (label, open, filter, delete) | 760–862 | 103 | Aviso de carreras: solo lectura |
| **Subtotal lógica** | | **~317** | |

`setResumeUiBusy` (252–255) **no** es del calendario solo: OR de `athleteChat.chatDraft` y `workoutPanel`. Si el calendario se extrae, el efecto debe quedarse en Athletes (igual que con el chat) o recibir `isCalendarBusy` + draft.

Carga de workouts (`refreshWorkouts` ~216–250, `calendarLoadedAthleteRef`) es **spine**, no del grid.

### 1.3) JSX

| Trozo | Líneas | ~Líneas | z-index |
|---|---|---|---|
| Toolbar + grid 7×N + chips | 1164–1399 | 236 | — (en flujo) |
| Menú contextual workout | 1415–1558 | 144 | **300** |
| Panel editar/mover + `WorkoutStructureTable` | 1585–1811 | 227 | **280** |
| Modal eliminar rango | 1813–1904 | 92 | **215** |
| **Subtotal JSX** | | **~699** | |

Toolbar (1164–1239): mes anterior/siguiente, **Agregar Carrera** (hook de races), **Eliminar rango**.

Celdas (1246–1396): color de borde/fondo por carrera o workout; drop target; chips 🏁; chips de workout `draggable` (máx. 3 + “+N”).

### 1.4) Suma

| | ~Líneas |
|---|---|
| Estados/derivados de mes | ~45 |
| Lógica | ~317 |
| JSX | ~699 |
| **Atribuible** | **~1060** |

IA analyze/adjust **sigue en Athletes** (no es una de las 8 piezas). El menú del calendario es su entrada; no está en esta suma.

---

## 2) Conexiones con las 8 piezas ya extraídas

Lista explícita de cada invocación **desde el calendario** (o que el calendario obliga a mantener en el padre).

| Pieza extraída | ¿El calendario la toca? | Dónde (líneas actuales) | Cómo |
|---|---|---|---|
| 1. PDF (`exportAthletePlanToPdf`) | **No** | Header de ficha ~1034 | Independiente del grid |
| 2. `FormaFatigaLineChart` / `StatusBadge` | **No** | Header `StatusBadge`; chart dentro de `FormaFatigaPanel` | Comparten spine `workouts`, no UI |
| 3. Badges de lista | **Sí, lectura** | 709–713 `mayHaveIntervals` | Al borrar workout/rango consulta `deviceConnections` para decidir si llamar `deleteIntervalsEvents`. El fetch de badges se queda en Athletes |
| 4. Pagos | **No** | Panel order 7; modal al final | Cero |
| 5. `FormaFatigaPanel` | **No** (solo spine) | 1162, justo **antes** del grid | Mismos `workouts` / `loadingWorkouts` |
| 6. Chat | **Sí, `resumeUiBusy`** | 252–255 | `workoutPanel` abierto cuenta como UI ocupada **OR** draft del chat. Dos efectos separados se pisan (ya documentado en el extract de chat) |
| 7. Carreras | **Sí, pintura + 2 opens** | Toolbar 1206 `openRaceModal`; celdas 1249 / 1252–1267 / 1298 `racesByDate` + `openRaceCalendarMenu`; rango 789–795 y 1866–1868 aviso “NO se eliminarán” | Overlays de carrera (`AthleteRaceOverlays`, z 305) **no** son JSX del calendario; conviven al lado. z-index carrera **305** > menú workout **300**: el menú de carrera gana si ambos existieran (no deberían) |
| 8. Registro | **Sí, open** | Menú 1477–1481 `setRegistroModal(ctxMenuWorkout)` | Modal z **10010**. Deep link (354–361) **no** es del calendario: spine |

**No extraído aún (sigue colgando del menú):**

| Pieza | Líneas menú | Qué hace |
|---|---|---|
| IA analyze / “Ver análisis” / adjust | 1483–1502, overlays 1905+ | `analyzeWorkoutAsCoach`, `setCoachAnalysisModal`. Laps del registro si el mismo workout está abierto |
| Medallas (award) | Dentro de `toggleWorkoutDone` 563–569 | `evaluateAndAwardAthleteAchievements` — no hay grilla en coach |

Al extraer el calendario, IA y Registro deben entrar como **callbacks** (`onOpenRegistro`, `onAnalyze`, `onOpenAnalysis`), no importar esos módulos dentro del grid.

---

## 3) `toggleWorkoutDone` (coach) ≠ `toggleDone` (AthleteHome)

**No unificar. No “arreglar” el del atleta desde este extract.**

| | Coach (`Athletes.jsx` 541–571) | Atleta (`AthleteHome.jsx` `toggleDone` ~748+) |
|---|---|---|
| Quién | Coach, menú del calendario | Atleta, su propio calendario |
| Al marcar hecho | UPDATE `{ done: true }` | UPDATE `{ done: true }` **y** abre modal RPE / “Cómo me sentí” |
| Al desmarcar | `{ done: false, rpe: null }` | Igual en payload, **más** cierra el modal de resumen |
| Contador | Escribe `athletes.workouts_done` + `onAthleteWorkoutsDoneSync` | Camino distinto (home del atleta) |
| Medallas | `evaluateAndAwardAthleteAchievements` + toast | Flujo propio del atleta |
| Reloj / notas | No pide RPE ni notas | Ahí vive el fix de RPE |

El menú del coach solo conmuta hecho/pendiente. El registro (notas, reloj, compareBlocks) es **otro** modal, ya extraído.

---

## 4) Riesgos al mover (DnD y menú)

Estas interacciones son las más fáciles de romper con un “split limpio” de componentes.

### 4.1) Drag & drop

1. **`calendarDragRef` vs `onClick`.** `onDragStart` pone el ref a `true`; `openCalendarWorkoutMenu` **sale** si el ref está true; `onDragEnd` lo baja en `setTimeout(0)`. Si el chip y el handler de menú viven en árboles distintos y el ref no es el mismo, un drag abre el menú (o un click no abre).
2. **El drop no lee `dataTransfer`.** La celda usa `dragWorkoutId` de React (`onDrop` → `moveWorkoutToDate(dragWorkoutId, ymd)`). El `setData("text/plain")` es por HTML5; el `catch` vacío es a propósito (algunos WebViews). Extraer la celda sin levantar `dragWorkoutId` al padre deja drops en no-op.
3. **`onDragOver` + `preventDefault`** en la celda: sin eso el drop no dispara.
4. **Optimistic `moveWorkoutToDate`.** Si falla, restaura el array `prev` **cerrado**. Un hijo que reciba `workouts` stale puede “ganar” un setState y devolver el chip al día viejo.
5. **No envolver el chip** en otro `button`/`div` draggable al extraer. El nodo que tiene `draggable` es el que abre el menú.

### 4.2) Menú contextual

1. **`setTimeout(0)` antes de escuchar `mousedown`.** El click que abre el menú no debe cerrarlo. Quitar el delay o registrar el listener en el mismo tick cierra al instante.
2. **`onMouseDown={preventDefault}`** en cada ítem: evita que el mousedown del ítem se interprete como outside-click según el orden de eventos.
3. **Cierre por `contains(ref)`.** El ref tiene que estar en el **mismo** nodo del menú. Portal a `document.body` obliga a revisar el listener (hoy no hay portal; `position: fixed` dentro del árbol de Athletes).
4. **z-index.** Menú workout **300**, panel edit **280**, rango **215**, carrera **305**, Registro **10010**, IA **10010/10011**. Bajar el menú por debajo de 280 lo tapa el panel; subirlo por encima de 305 pelea con carreras.
5. **`view: "detail"`** recoloca x/y al tamaño del breakdown. Perder `calendarCtxMenu.view` parte el submenú “← Menú”.
6. **Ítem “📋 Ver detalle” tiene `onClick: null`.** El click se maneja aparte (`openCalendarWorkoutDetail`). Un `.map` genérico que llame `item.onClick()` a ciegas rompe ese ítem (hoy el map ya distingue).

### 4.3) Otros

- RLS: delete usa `.select("id")` porque un 200 con 0 filas no es éxito.
- Panel edit z 280 < menú 300: se cierra el menú **antes** de abrir el panel (`closeCalendarCtxMenu` en `openWorkoutEditPanel`). Invertir ese orden deja el menú encima del modal.

---

## 5) ¿Una pieza o varias?

**Recomendación: primera extracción = una sola pieza** (hook + un componente que incluya toolbar, grid, menú, panel de estructura y modal de rango).

Razones:

- DnD y menú **comparten un ref y un estado** (`calendarDragRef`, `dragWorkoutId`, `calendarCtxMenu`). Partir grid vs menú en el primer PR es exactamente el corte frágil de §4.
- El panel de estructura y “Mover fecha” reutilizan `populateEditFormFromWorkout` + `moveWorkoutToDate`. Separarlos ahora duplica o crea un tercer objeto de props.
- El mapa original (§K) ya decía: *“dejar grid + handlers juntos”* y sacar antes los overlays ajenos (registro, IA, carreras). Carreras y registro **ya** salieron; IA aún no.

**Qué no meter en esa pieza:**

- `refreshWorkouts` / `calendarLoadedAthleteRef` (spine).
- El efecto `resumeUiBusy` completo: Athletes sigue haciendo el OR chat ∨ panel.
- JSX de `AthleteRaceOverlays`, `WorkoutRegistroModal`, pagos, chat, forma/fatiga.
- IA (callbacks).

**Partir después (opcional, segundo PR), solo si la pieza única está validada en Preview:**

| Corte posterior | ¿Vale la pena? |
|---|---|
| Modal rango | Sí: z 215, 4 estados, poco DnD |
| Panel editar/mover | Sí, si el hook ya posee `workoutPanel` / form |
| Menú vs grid | **No** hasta que DnD+click se hayan visto estables un ciclo en Preview |

No extraer el grid “tonto” (solo celdas) en el primer paso: las celdas **son** el DnD.

Contrato tentativo de la pieza única:

```text
useAthleteCalendar({ workouts, setWorkouts, athlete, notify, deviceConnections, deviceConnectionsReady })
  + callbacks: onOpenRegistro, onAnalyze, onOpenAnalysis, onOpenRaceModal, onOpenRaceMenu
  + datos carrera: racesByDate, races (aviso de rango)

AthleteCalendar  →  toolbar + grid + menú 300 + panel 280 + rango 215
```

`toggleWorkoutDone` viaja **dentro** de esa pieza (es del menú del coach), llamando `evaluateAndAwardAthleteAchievements` como hoy. No se fusiona con AthleteHome.

---

## 6) Checklist de validación (cuando se extraiga)

- [ ] Drag de un chip a otro día: se mueve, toast, y un click posterior **sí** abre el menú (el ref se limpió).
- [ ] Click (sin drag) abre menú; click fuera lo cierra; no se cierra en el mismo click de abrir.
- [ ] “Ver detalle” ↔ “← Menú”; “Ver registro” abre el modal 10010 por encima.
- [ ] Editar estructura y Mover fecha; Eliminar un workout y un rango (carreras intactas; aviso visible).
- [ ] Marcar hecho/pendiente (coach): contador `workouts_done` y toast de medalla si aplica. El atleta en AthleteHome sigue con su modal RPE.
- [ ] Agregar Carrera + chips 🏁 + menú de carrera (z 305) igual que ahora.
- [ ] Con draft de chat o panel de edit abierto, un resume de APK **no** recarga a mitad.

---

## 7) Decisión pendiente

Esperando validación:

1. **Una pieza** (recomendado para el Paso 2), o  
2. Varias (grid / menú / panel / rango) en el primer movimiento — **no recomendado** por §4 y §5.

Cuando se valide, se extrae en ese modo y se sigue el mismo ciclo: build, Preview, commit y push en `test/athletes-breakdown-map`.
