# Desglose interno de Athletes.jsx

Fecha: 2026-08-30  
HEAD de referencia: tip de `master` al mapear  
Archivo: `src/components/Athletes/Athletes.jsx`  
**3898** líneas físicas (**~3739** no vacías)

**Estado:** solo análisis. Sin extracción de código. Esperando validación antes de trocear.

**Contexto:** nació en el split de App (`docs/athletes-extract-map.md`, 2026-08-27). Esa mudanza dejó **un solo módulo** con la ficha del coach. No se ha partido más. Este doc es el equivalente de `docs/shell-breakdown-map.md`, pero **dentro** de Athletes.

**No confundir**

| Qué | Dónde | ¿Es este archivo? |
|---|---|---|
| Lista + ficha del coach | `Athletes.jsx` | Sí |
| Tabs Evaluación / Retos | `CoachChrome` → `EvaluationView` / `ChallengesHub` | No |
| Calendario del *atleta* | `AthleteHome.jsx` | No |
| Lista canónica `athletes` / `selected` | `useCoachAthletes` + App | No (entran por props) |

---

## 0) Foto actual

| Métrica | Valor | Nota |
|---|---|---|
| Líneas totales / no vacías | **3898 / ~3739** | El “~3738” del brief era el orden de magnitud; el archivo creció un poco |
| `function Athletes` | L621–3896 | **~3276** líneas |
| Helpers de módulo (antes de `function`) | L1–619 | **~619** |
| `useState` en `Athletes()` | **55** | Coincide con el extract-map de 2026-08-27 |
| `useState` extra (hijo) | 1 | `AthleteListAvatar.failed` — no cuenta en los 55 |
| `useRef` en `Athletes()` | **7** | Ver §0.2 |
| `useEffect` / `useCallback` / `useMemo` | **~22 / 4 / ~14** | Orden de magnitud |
| Tablas Supabase que toca | `workouts`, `races`, `messages`, `athlete_payments`, `athletes` (FC + `workouts_done`), `athlete_evaluations` | — |
| APIs | `/api/integrations` (`activity-intervals`), `/api/analyze-workout` (`analyze` / `adjust` / `adjust-steps`) | — |

`appShared` **ya** aporta la mayoría de dominio: `normalizeWorkoutRow`, `computeFormaFatigaWeeklyPoints`, `formaFatigaStatusFromPoint`, `computeGarminLoadMetricsFromWorkouts`, races/payments helpers, chat push, achievements snapshot, device/unread/weekly fetches, `deleteIntervalsEvents`, `WorkoutStructureTable` (archivo compartido).

### 0.1) Los 55 estados, por dueño

Asignación de **propiedad**. `workouts` / `loadingWorkouts` / `coachId` / `coachAthleteEvaluations` son **columna vertebral**: los consume más de una sección.

| # | Estado | Sección dueña |
|---|---|---|
| 1 | `searchQuery` | Lista |
| 2–3 | `workouts`, `loadingWorkouts` | **Spine** (calendario, forma, registro, IA, medallas, rango) |
| 4–6 | `fcMaxInput`, `fcReposoInput`, `fcSaving` | Ficha / zonas FC |
| 7 | `coachId` | **Spine** (chat, carreras, pagos, unread) |
| 8–10 | `chatMessages`, `chatDraft`, `chatSending` | Chat |
| 11 | `coachAthleteEvaluations` | **Spine** (VDOT registro + progress de medallas) |
| 12 | `earnedAchievements` | Medallas (toast al marcar hecho; UI de grilla **no se pinta**) |
| 13 | `dragWorkoutId` | Calendario |
| 14 | `calendarCtxMenu` | Calendario |
| 15–16 | `workoutPanel`, `workoutFormSaving` | Calendario (panel editar/mover) |
| 17–18 | `workoutEditForm`, `moveDateInput` | Calendario |
| 19–24 | `athletePayments`, `loadingPayments`, `paymentSaving`, `paymentActionBusyId`, `paymentModalOpen`, `paymentForm` | Pagos |
| 25–26 | `deviceConnections`, `deviceConnectionsReady` | Badges lista (+ `mayHaveIntervals` al borrar) |
| 27–28 | `weekLoadByAthlete`, `weekLoadReady` | Badges lista |
| 29–30 | `unreadByAthlete`, `unreadRefresh` | Badges lista (el chat los apaga) |
| 31 | `calendarViewMonth` | Calendario (también precarga el modal de rango) |
| 32–40 | `races`, `raceModalOpen`, `raceSaving`, `raceForm`, `raceCtxMenu`, `racePanel`, `raceEditForm`, `raceMoveDate`, `raceActionBusy` | Carreras |
| 41–44 | `rangeDeleteOpen`, `rangeDeleteFrom`, `rangeDeleteTo`, `rangeDeleteBusy` | Calendario (borrar rango) |
| 45 | `chatClearing` | Chat |
| 46 | `expandedWorkoutLogs` | **Muerto** — declarado, nunca leído ni escrito salvo el `useState` |
| 47 | `coachAnalysisModal` | Registro / IA |
| 48–51 | `registroModal`, `registroLaps`, `registroLapsLoading`, `registroLapsError` | Registro / mapa |
| 52–53 | `adjustProposalModal`, `adjustLoading` | IA adjust |
| 54–55 | `coachWorkoutAnalysis`, `coachWorkoutAnalysisLoading` | IA analyze |

**Conteo por sección (solo los 55):**

| Sección | Estados | De ellos muertos |
|---|---|---|
| Spine compartido | 4 | 0 |
| Lista + badges | 7 | 0 |
| Ficha / FC | 3 | 0 |
| Calendario + paneles + rango | 11 | 0 |
| Chat | 4 | 0 |
| Carreras | 9 | 0 |
| Pagos | 6 | 0 |
| Registro / mapa | 4 | 0 |
| IA analyze / adjust | 6 | 1 (`expandedWorkoutLogs`) |
| Medallas | 1 | 0 (el estado vive; la grilla no) |
| Forma / fatiga | **0** | Todo derivado de `workouts` |
| **Total** | **55** | **1** |

### 0.2) Refs (no son de los 55)

| Ref | Uso |
|---|---|
| `pushWarnedAthletesRef` | Chat: un aviso de “atleta sin push” por atleta |
| `calendarDragRef` | Evitar abrir menú al soltar un drag |
| `calendarCtxMenuRef` / `raceCtxMenuRef` | Cerrar menú al click fuera |
| `chatScrollRef` | Autoscroll |
| `shownAthleteIdRef` | Descartar `refreshWorkouts` stale si cambió el atleta |
| `calendarLoadedAthleteRef` | Primera carga con spinner; resume/`workoutsRefresh` en silencio |

---

## 1) Secciones / responsabilidades

Los estados están **declarados en bloque** (y un segundo bloque más abajo: mes, carreras, registro, IA). La lógica y el JSX viven en franjas distintas. Los rangos de “archivo” de abajo son la partición **casi no solapada** del fichero; la columna de líneas suma **~3872** + ~26 blancos/huecos = **3898**.

### A. Prelude / imports — L1–62 — **~62 líneas — 0 estados**

`supabase`, `jsPDF`, `WeatherWidget`, `PushToWatchButton`, `WorkoutDetailBreakdown`, `WorkoutStructureTable`, `readStructure`, `compareBlocks`, `fmtPace`, `setResumeUiBusy`, y el bloque grande de `appShared`.

`WorkoutRouteMap` es `React.lazy` (L59). `DAYS` con acentos (L62) — `appShared` tiene otra lista **sin** acentos; no mezclar.

| Aislamiento | Alto (estático). Viaja con el consumidor. |

---

### B. FormaFatigaLineChart — L64–132 — **~69 — 0 estados**

SVG inline. Solo props: `chronological`.

| Aislamiento | **Muy alto.** Extraíble tal cual a `Athletes/FormaFatigaLineChart.jsx`. |
| appShared | El *cálculo* ya está en `computeFormaFatigaWeeklyPoints` / `formaFatigaStatusFromPoint`. El chart es solo vista. |

---

### C. PDF del plan mensual — L134–475 — **~342 — 0 estados**

`PDF_WEEKDAY_SHORT`, `pdfWeekdayFromYmd`, `getCurrentMonthYmdRange`, `sanitizePdfFilenamePart`, `exportAthletePlanToPdf`.

Función pura: `{ athlete, workouts, coachDisplayName }`. Usa `jsPDF`, `WORKOUT_TYPES`, `computeHrZones`, `formatLocalYMD`, `BRAND_NAME`.

Botón en la ficha (L2152–2180).

| Aislamiento | **Muy alto.** Candidato #1. No lee estado de React. |
| Duplicación | Colores de tipo de workout locales (`TYPE_COLORS`) — no están en appShared. Aceptable dejarlos junto al PDF. |

---

### D. StatusBadge — L477–481 — **~5 — 0 estados**

Pinta `athlete.status` (`on-track` / `behind` / `ahead`).

| Aislamiento | Alto como componente. |
| Riesgo | No hay escrituras a `athletes.status` en este archivo. Si nadie más lo actualiza, el badge es decorativo/stale. Confirmar antes de “arreglarlo”. |

---

### E. Badges de lista (componentes) — L483–619 — **~137 — 0 estados del padre**

| Componente | Líneas | Notas |
|---|---|---|
| `AthleteListAvatar` | 488–521 | 1 `useState` interno (`failed`) |
| `DeviceConnectionBadges` | 529–567 | `providerLabel`, `formatDeviceSyncDate` (appShared) |
| `UnreadMessagesBadge` | 574–599 | Puro |
| `WeeklyLoadLine` | 606–619 | Puro; sustituye `athletes.weekly_km` declarado |

| Aislamiento | **Muy alto.** Ya son componentes. Mudanza mecánica. |

---

### F. Spine de `Athletes()` — L621–670 + L770–888 + L1805–1821 — **~4 estados**

Props (se quedan en el padre al extraer hijos):

`athletes`, `selected`, `onSelect`, `workoutsRefresh`, `openRegistroWorkoutId`, `onRegistroOpened`, `onAthleteWorkoutsDoneSync`, `onAthleteFcSync`, `coachDisplayName`, `onDeleteAthlete`, `notify`, `onOpenInviteModal`.

`athlete` se resuelve así (L623):

```text
(selected ? athletes.find(id) : athletes[0]) || null
```

**Dueño de la verdad de workouts del atleta seleccionado:** `refreshWorkouts` (L785–806) + efecto L809–820. Primera visita con spinner; mismo atleta + `workoutsRefresh` en silencio (resume).

`coachId` sale de `supabase.auth.getUser()` (L1805–1811).

Evaluaciones: `athlete_evaluations` solo `vdot, created_at` (L827–846) → `athleteVdot` (L978–986).

| Aislamiento | **Muy bajo.** Es el esqueleto. Último en extraer (o se queda como `Athletes.jsx` fino). |

---

### G. Lista + badges (datos + JSX) — L671–768 + L2035–2132 — **~196 — 7 estados**

Tres fetches **por toda la lista** (no por ficha), clave `athleteIdsKey`:

1. `fetchActiveDeviceConnections` (+ `workoutsRefresh`)
2. `fetchWeeklyKmByAthlete` (+ `workoutsRefresh`)
3. `fetchUnreadMessageCounts` (+ `unreadRefresh`, `coachId`)

Realtime L751–768: INSERT en `messages` incrementa unread **salvo** el atleta de la ficha abierta.

JSX: búsqueda, filas, avatar, unread, weekly load, device badges, Eliminar → `onDeleteAthlete`. Empty state L2035–2051 (invite).

| Aislamiento | **Alto** respecto a calendario/pagos. Cruza con **chat** (marcar leído pone unread a 0) y con **calendario** (`mayHaveIntervals` lee `deviceConnections` al borrar). |
| appShared | Los tres `fetch*` ya viven ahí. No duplicar. |

---

### H. Ficha header + Weather + zonas FC — L2133–2275 + save L1873–1901 + sync L1813–1821 — **~3 estados + PDF/Status**

Header: avatar/nombre/objetivo, countdown de carrera (`nextRaceCountdown` ← carreras), Exportar PDF, `PushToWatchButton`, `StatusBadge`, métricas ritmo / km / adherencia.

`WeatherWidget compact` (order 2).

Zonas FC (order 5): inputs + `computeHrZones` (appShared). `saveAthleteFc` → `athletes.fc_*` + `onAthleteFcSync`.

| Aislamiento | **Medio.** Header es layout. FC es un bloque extraíble (`AthleteHrZones`). PDF ya es función suelta. Countdown **lee carreras**. |

---

### I. Pagos — lógica L1713–1732 + L1903–1978; JSX L2277–2356 + L3812–3892 — **~257 — 6 estados**

CRUD `athlete_payments`. Confirmar dispara `sendAppEmail` (`payment_confirmed`). Helpers de monto/plan/status: **appShared**.

| Aislamiento | **Alto.** Solo necesita `athlete.id`, `athlete.email/name`, `coachId`, `notify`. No lee `workouts`. |
| Extraer | Hook `useAthletePayments` + `AthletePaymentsPanel` + modal. |

---

### J. Forma y fatiga — memos L1326–1330; JSX L2358–2530; chart L64–132 — **~247 — 0 estados**

Dos sistemas en el mismo recuadro:

1. **Garmin-like** (`computeGarminLoadMetricsFromWorkouts`): ratio aguda/crónica, barras de km.
2. **RPE × km** (`computeFormaFatigaWeeklyPoints` + `FormaFatigaLineChart` + tabla 4 semanas).

Ambos solo leen `workouts` (+ `loadingWorkouts` para el spinner).

| Aislamiento | **Alto** como vista. No escribir. Extraer `AthleteFormaFatiga` con prop `workouts`. |
| Duplicación | Cero cálculo local — ya está en appShared. |

---

### K. Calendario + menú + panel workout + borrar rango — **~11 estados + spine**

| Trozo | Líneas | ~Líneas |
|---|---|---|
| Load + grid month | 770–888 | 119 |
| Handlers (menú, move/edit/delete, rango, intervals) | 1395–1684 | 290 |
| JSX mes + celdas | 2532–2767 | 236 |
| Menú contextual workout | 2884–3027 | 144 |
| Panel editar/mover + `WorkoutStructureTable` | 3194–3420 | 227 |
| Modal eliminar rango | 3520–3611 | 92 |
| **Subtotal atribuible** | | **~1108** |

Celdas pintan **workouts y carreras** (`racesByDate`). Drag-and-drop → `moveWorkoutToDate`. Menú: hecho/pendiente, detalle (`WorkoutDetailBreakdown`), registro, analizar IA, editar/mover/borrar.

`toggleWorkoutDone` (L1363–1393) actualiza `workouts`, `athletes.workouts_done`, `onAthleteWorkoutsDoneSync`, y **evalúa medallas**.

`forgetIntervalsEvents` / `mayHaveIntervals`: borrar workout intenta quitar el evento del reloj si hay intervals.

`setResumeUiBusy` (L822–825): chat draft **o** panel de workout abierto — acopla chat ↔ calendario para no recargar la app a mitad de edición.

| Aislamiento | **Bajo.** Es el núcleo. Depende de carreras (pintado), registro/IA (acciones del menú), devices (reloj), medallas (toggle done), `workoutsRefresh`. |
| Extraer tarde | Primero sacar overlays (registro, IA, carreras); dejar grid + handlers juntos. |

---

### L. Chat — lógica L1686–1711, L1787–1803, L1823–1870, L1980–2033; JSX L2769–2879 — **~4 estados**

`messages` por `athlete_id` + `coach_id`. Optimistic send, realtime INSERT, poll 60s, `markConversationRead`, push `sendChatPushNotification`.

Cruza: unread de la lista; `resumeUiBusy(chatDraft)`.

| Aislamiento | **Medio-alto.** Extraíble como `AthleteChat` + `useCoachAthleteChat`. Dejar callbacks `onMarkedRead` / `isDraftDirty`. |
| appShared | `formatMessageTimestamp`, push, `markConversationRead`, `PUSH_INACTIVE_REASONS`. |

---

### M. Carreras — estado L890–913; lógica L1146–1324 + L1734–1785; JSX en celdas + overlays L3029–3519 — **~9 estados**

CRUD `races` + `normalizeRaceRow` / presets (appShared). Menú contextual propio (z-index 305). Modal alta + panel editar/mover.

`refreshRacesList` **duplica** el `useEffect` de carga (L1146–1183): mismo `select` dos veces. Al extraer, un solo loader.

Pintado **dentro** del calendario. Countdown en el header de ficha.

Modal de rango **avisa** que las carreras no se borran (`rangeDeleteRaces`) — acoplamiento de lectura, no de escritura.

| Aislamiento | **Medio.** Lógica/overlays extraíbles; los chips del día se quedan en el grid o reciben `racesByDate` + `onRaceClick`. |

---

### N. Registro / mapa / compareBlocks — L918–997 + L3709–3811 + deep link L926–933 — **~4 estados**

Modal “📋 Registro”: notas (`Cómo me sentí`), manual vs reloj, `WorkoutRouteMap` lazy, laps vía `/api/integrations` `activity-intervals`, `compareBlocks({ structure, laps, vdot: athleteVdot })`.

Deep link: `openRegistroWorkoutId` (App / push) abre el mismo modal.

Menú del calendario: “Ver registro”.

| Aislamiento | **Medio.** Extraíble como `WorkoutRegistroModal`. Props: `workout`, `vdot`, `onClose`. El fetch de laps puede ir dentro. |
| Ya tocado | Rescale / `compareBlocks` en `lib/blockComparison`. No reabrir ese cálculo al extraer UI. |

---

### O. IA analyze + adjust — L848–861, L1000–1144, L3612–3708 + entradas del menú — **~5 estados vivos + 1 muerto**

- `analyzeWorkoutAsCoach` → `/api/analyze-workout` (pasa `laps` si el registro abierto es el mismo workout). Cache `localStorage` `raf_analysis_${id}`.
- Modal texto `coachAnalysisModal`.
- `adjustPlanWithAI` → `action: "adjust"`; `applyAdjustment` + `adjust-steps`.

`expandedWorkoutLogs`: **muerto**.

| Aislamiento | **Medio-bajo.** Necesita `workouts` futuros/recientes y opcionalmente laps del registro. Extraer **después** del modal Registro (o junto, un módulo `Athletes/coachAi`). |

---

### P. Medallas — L1332–1393 — **~1 estado**

`loadAthleteAchievementSnapshot` al cambiar atleta/`workouts`. `evaluateAndAwardAthleteAchievements` al marcar hecho.

`coachAchievementDisplayProgress` y `coachEarnedAchievementDateByCode` se **calculan y no se renderizan**. Grilla de medallas ausente (sí existe en AthleteHome).

| Aislamiento | La carga+award está pegada a `toggleWorkoutDone`. La grilla muerta no bloquea extracciones. |
| Riesgo | Código muerto de *presentación*. No mover a appShared. Borrar o pintar en un paso aparte, no en el primer split. |

---

## 2) ¿Qué tan aislada está cada sección?

| Sección | Aislamiento | ¿Depende de otras *dentro* del archivo? | ¿appShared / libs vs lógica propia? |
|---|---|---|---|
| PDF | Muy alto | Solo `workouts` + `athlete` + nombre coach | Propia (jsPDF). Zonas FC vía appShared |
| FormaFatigaLineChart | Muy alto | Prop `chronological` | Vista propia; números en appShared |
| Badges (componentes) | Muy alto | Props | appShared labels/fechas |
| Pagos | Alto | `athlete`, `coachId`, `notify` | CRUD propio; montos/status en appShared |
| Forma panel | Alto | `workouts` | 100% appShared + chart local |
| Lista + fetches badges | Alto | Chat (unread); delete workout (intervals) | `fetch*` en appShared |
| Chat | Medio-alto | Unread; `resumeUiBusy` | Push/read en appShared; send/optimistic propio |
| Ficha / FC | Medio | Header lee `nextRaceCountdown` | `computeHrZones` appShared |
| Carreras | Medio | Celdas del calendario; aviso en rango | Helpers race en appShared; overlays propios |
| Registro | Medio | Menú calendario; VDOT evals; laps→IA | `compareBlocks` + `readStructure` ya extraídos |
| IA | Medio-bajo | `workouts` + registro laps | Fetch propio; no hay helper en appShared |
| Calendario | Bajo | Carreras, registro, IA, devices, medallas, chat (busy) | Fechas/grid en appShared; DnD/menú propios |
| Spine Athletes | Muy bajo | Todo | Props del shell |

---

## 3) Orden de sub-extracciones recomendado

Misma disciplina que App: **un módulo (o hook) por PR**, build, Preview, y no fusionar hasta validar.

Empezar por lo que **no** desmonta el calendario.

| # | Extraer | Por qué primero / después | Destino tentativo |
|---|---|---|---|
| 1 | PDF (`exportAthletePlanToPdf` + helpers) | Cero React state. Riesgo mínimo | `src/lib/exportAthletePlanPdf.js` o `Athletes/exportAthletePlanToPdf.js` |
| 2 | `FormaFatigaLineChart` + `StatusBadge` | Presentacionales | `Athletes/FormaFatigaLineChart.jsx`, `StatusBadge.jsx` |
| 3 | Badges de lista (4 componentes) | Ya son componentes | `Athletes/listBadges.jsx` |
| 4 | Pagos (hook + panel + modal) | 6 estados; 0 workouts | `useAthletePayments.js` + `AthletePaymentsPanel.jsx` |
| 5 | Forma/fatiga panel | 0 estados; solo `workouts` | `AthleteFormaFatiga.jsx` |
| 6 | Chat (hook + UI) | 4 estados; cruce acotado (unread + busy) | `useCoachAthleteChat.js` + `AthleteChat.jsx` |
| 7 | Carreras (hook + overlays); chips se quedan o reciben props | 9 estados; el grid solo necesita `racesByDate` + open menu | `useAthleteRaces.js` + `RaceOverlays.jsx` |
| 8 | Registro modal (+ laps / compareBlocks / mapa) | 4 estados; deep link se queda en spine | `WorkoutRegistroModal.jsx` |
| 9 | IA analyze/adjust | Después del registro (laps) | `useCoachWorkoutAi.js` + modales |
| 10 | Calendario (grid + menú + panel estructura + rango) | Lo más entrelazado | `AthleteCalendar.jsx` + hook de workouts |
| 11 | Spine `Athletes.jsx` | Lista, ficha, wiring de props | Se queda fino (~lista + header + composición) |

**No hacer en el primer tren:** Context, fusionar con AthleteHome, “limpiar medallas” salvo borrar dead code explícitamente acordado.

---

## 4) Riesgos transversales

### Código muerto / no usado en UI

| Qué | Dónde | Acción sugerida (cuando toque) |
|---|---|---|
| `expandedWorkoutLogs` | L919 | Borrar el `useState` |
| `coachAchievementDisplayProgress` | L1332–1334 | No se pinta. Borrar memo **o** montar grilla (decisión de producto) |
| `coachEarnedAchievementDateByCode` | L1336–1344 | Igual |
| `sendAppEmail` | Solo pagos confirmados | No es muerto |

### Usado fuera de este archivo (no extraer “con todo”)

| Símbolo | Consumidores |
|---|---|
| Props `athletes` / `selected` / `workoutsRefresh` / `openRegistroWorkoutId` | App + `useCoachAthletes` + deep links |
| `WorkoutStructureTable` | También marketplace accordion |
| `compareBlocks` / `readStructure` | AthleteHome / analyze API (ya compartidos) |
| `normalizeWorkoutRow` | Dashboard, AthleteHome, etc. |

### Cosas que **no** deben ir a appShared

- JSX de menús/modales
- `exportAthletePlanToPdf` (pesado, un solo caller) — lib dedicada, no el barrel de appShared
- Optimistic chat / adjust IA

### Duplicación / olores

| Qué | Detalle |
|---|---|
| `refreshRacesList` vs efecto L1160 | Mismo `select` dos veces |
| `DAYS` | Acentos aquí; appShared sin acentos |
| `toggleWorkoutDone` vs AthleteHome | Dos caminos “marcar hecho”. No unificar en este troceo |
| VDOT fallback `42.5` | `WorkoutDetailBreakdown` en el menú (L2927) si no hay evaluación |
| `setResumeUiBusy` | Chat + panel workout; al extraer hay que **orquestar** en el spine (OR de flags) |
| Borrar workout ↔ intervals | Calendario lee badges de dispositivo. Al extraer, pasar `mayHaveIntervals` o `deviceConnections` |

### Deep link / resume

- `openRegistroWorkoutId` debe seguir abriendo el modal **después** de extraerlo.
- `workoutsRefresh` no debe volver a poner spinner en el calendario (ya está el `silent` path).
- No romper `setResumeUiBusy` o un resume recargará a mitad de un mensaje o un edit.

---

## 5) Conteo final de líneas por sección

Partición del archivo (rangos físicos; huecos en blanco no listados). Suma de bloques ≈ **3872**; archivo = **3898**.

| Sección | Rangos principales | ~Líneas | Estados (de 55) |
|---|---|---|---|
| Imports + `DAYS` | 1–62 | 62 | 0 |
| FormaFatigaLineChart | 64–132 | 69 | 0 |
| PDF plan | 134–475 | 342 | 0 |
| StatusBadge | 477–481 | 5 | 0 |
| Badges lista (componentes) | 483–619 | 137 | 0 |
| Spine (firma, search, athlete, workouts load, evals, month grid, coachId) | 621–670, 770–888, 1805–1821 | ~186 | 4 + `searchQuery` |
| Lista badges (datos) | 671–768 | 98 | 6 (devices/week/unread) |
| Registro + IA (estado + fetch laps + analyze/adjust) | 918–1144 | 227 | 4 + 5 vivos + 1 muerto |
| Carreras (estado + lógica) | 890–917 (parcial), 1146–1324, 1734–1785 | ~240 | 9 |
| Forma memos + medallas + toggleDone | 1326–1393 | 68 | 1 (`earnedAchievements`) |
| Calendario handlers + rango | 1395–1684 | 290 | 11 (con month/rango/panel) |
| Chat + FC save + pagos handlers + effects | 1686–2033 | 348 | chat 4 + FC 3 + pagos 6 |
| JSX empty + lista | 2035–2132 | 98 | — |
| JSX ficha header | 2133–2193 | 61 | — |
| JSX weather | 2194–2196 | 3 | 0 |
| JSX zonas FC | 2197–2275 | 79 | — |
| JSX pagos | 2277–2356 | 80 | — |
| JSX forma/fatiga | 2358–2530 | 173 | 0 |
| JSX calendario | 2532–2767 | 236 | — |
| JSX chat | 2769–2879 | 111 | — |
| Overlay menú workout | 2884–3027 | 144 | — |
| Overlay menú + panel + modal carreras | 3029–3519 | 491 | — |
| Overlay panel workout | 3194–3420 | (ya en 491/calendario) | ver calendario |
| Overlay rango | 3520–3611 | 92 | — |
| Overlay adjust IA | 3612–3682 | 71 | — |
| Overlay análisis IA | 3683–3708 | 26 | — |
| Overlay registro | 3709–3811 | 103 | — |
| Overlay pago | 3812–3892 | 81 | — |
| Cierre + export | 3894–3898 | 5 | 0 |
| **Archivo** | | **3898** | **55** |

Agrupado por responsabilidad (lógica + JSX, con overlap consciente del spine/`workouts`):

| Responsabilidad | ~Líneas (orden) | Estados |
|---|---|---|
| PDF + StatusBadge + chart forma | 416 | 0 |
| Lista + badges | ~330 | 7 |
| Ficha / FC / weather | ~200 | 3 |
| Pagos | ~257 | 6 |
| Forma panel (sin el chart ya contado) | ~173 | 0 |
| Chat | ~280 | 4 |
| Carreras | ~440 | 9 |
| Registro / mapa | ~200 | 4 |
| IA | ~220 | 5+1 muerto |
| Calendario (grid, menú, panel, rango) | ~1100 | 11 |
| Spine + medallas leftover | ~250 | 5 |
| Imports | 62 | 0 |

---

## 6) Cómo validar este mapa (antes de extraer)

- [ ] Los 55 nombres de estado coinciden con un grep de `useState` en `Athletes()`.
- [ ] Pagos y chat se sienten extraíbles sin tocar el grid.
- [ ] El calendario es el último bloque grande — de acuerdo.
- [ ] Dead code (`expandedWorkoutLogs`, memos de medallas sin UI) se trata en un PR aparte o se ignora en el primer split.
- [ ] No mezclar este archivo con AthleteHome / Evaluation / Challenges.

Cuando este doc esté OK, el primer PR de código debería ser **solo el PDF** (paso 1).
