# Desglose interno de AthleteHome.jsx

Fecha: 2026-08-30  
HEAD de referencia: `5991237` (`master`)  
Archivo: `src/components/AthleteHome.jsx`  
**2377** líneas físicas (**2265** no vacías)

**Estado:** solo análisis. Sin extracción de código. Esperando validación antes de trocear.

**Contexto:** es la vista del propio atleta. Nunca se ha partido. El split de Athletes (coach) de hoy **no** tocó este archivo salvo `FormaFatigaLineChart` compartido.

**No confundir**

| Qué | Dónde | ¿Es este archivo? |
|---|---|---|
| Vista del atleta (login, calendario propio, RPE, perfil) | `AthleteHome.jsx` | Sí |
| Ficha del coach + calendario del *coach* | `Athletes.jsx` + `Athletes/*` | No |
| Modal 📋 Registro (coach, z 10010) | `Athletes/WorkoutRegistroModal.jsx` | No — **otro flujo** |
| Marcar hecho del coach (`toggleWorkoutDone`) | `Athletes/useAthleteCalendar.js` | No — **no unificar** |
| Marcar hecho del atleta (`toggleDone` + modal RPE) | Este archivo | Sí |

**Regla dura (confirmada varias veces el 2026-08-30):** el flujo de “marcar hecho” de AthleteHome (modal RPE, z-index 10050, notas partidas, `select` **sin** `distance_km`) es **completamente distinto** del de Athletes. No se unifican. No se extraen a un único `toggleDone` compartido. No se reutiliza `WorkoutRegistroModal` para este modal.

---

## 0) Foto actual

| Métrica | Valor | Nota |
|---|---|---|
| Líneas totales / no vacías | **2377 / 2265** | El “~2238” del brief era el orden de magnitud; el archivo creció con RPE/notas/z-index |
| Helpers de módulo (antes de `function`) | L1–251 | Imports, `ATHLETE_HOME_WORKOUT_COLUMNS`, feeling helpers, `CoachLinkActions`, nav keys, `styles` |
| `export default function AthleteHome` | L252–2377 | **~2126** líneas |
| `useState` en `AthleteHome()` | **56** | Ver §0.1. Varios **muertos** |
| `useRef` | **6** | Ver §0.2 |
| `useEffect` / `useCallback` / `useMemo` | **~24 / ~11 / ~20** | Orden de magnitud |
| Tablas Supabase que toca | `athletes`, `workouts`, `messages`, `races`, `athlete_payments`, `athlete_evaluations`, `coach_public`, `coach_requests`, `profiles`, storage `athlete-avatars` | — |
| APIs | `/api/integrations` (`status`, `pull-activity`), `/api/analyze-workout` (`mode: "briefing"`), `/api/wompi-create-checkout` | — |

Ya extraído **fuera** de este archivo (solo se monta):

- `ChallengesHub`, `MarketplaceHub`, `EvaluationView` — `React.lazy`
- `FormaFatigaLineChart` — `./shared/FormaFatigaLineChart` (mismo que el coach)
- `IntervalsConnect`, `InstallAppButton`, `ChangePasswordSection`, `DeleteAccountSection`, `WeatherWidget`, `WorkoutDetailBreakdown`

`WorkoutStructureTable` **no** se usa aquí. El menú del atleta pinta detalle con `WorkoutDetailBreakdown`. El coach sí usa `WorkoutStructureTable` en el panel de editar.

`FormaFatigaPanel` (coach) **no** se usa aquí. AthleteHome recalcula los mismos memos de appShared y pinta una **subvista** (premium-gated, sin tabla de 4 semanas ni barra de ratio).

### 0.1) Los 56 estados, por dueño

`workouts` / `loading` / `athleteInfo` / `athleteEvaluations` son **columna vertebral**.

| # | Estado | Sección dueña | Vivo en UI? |
|---|---|---|---|
| 1–5 | `athleteInfo`, `authFullName`, `coachName`, `coachAvatarUrl`, `coachAvatarFailedUrl` | Spine / banner coach | Sí |
| 6–7 | `coachCodeInput`, `coachCodeSaving` | Coach-link (legado) | **Muerto** — el input vivo es `findCoachCodeInput` / `findCoachCodeBusy` |
| 8 | `coachCodeMsg` | Coach-link | Sí (compartido con `findCoach*`) |
| 9–10 | `coachDirectory`, `coachDirLoading` | Config / directorio | Sí |
| 11–13 | `workouts`, `loading`, `message` | **Spine** | Sí |
| 14–16 | `athleteChatMessages`, `athleteChatDraft`, `athleteChatSending` | Chat | Sí |
| 17–18 | `showPlanModal`, `soloPayInstructions` | Pagos (legado) | **Muerto** — el checkout vivo es Wompi (`trySoloIndependentCheckout`) |
| 19 | `athleteNotRegistered` | Empty / ficha | Sí |
| 20 | `showEvaluation` | Nav legado | **Casi muerto** — persiste `raf_athlete_eval_open`; la pestaña viva es `athleteActiveTab === "eval"` |
| 21–22 | `athleteActiveTab`, `athleteProfileTab` | Chrome / perfil | Sí |
| 23 | `athleteChatOpen` | Chat | Sí |
| 24 | `athleteTabRestored` | Nav persist | Sí (interno) |
| 25 | `achievementsCatalog` | Logros | **Escrito, no leído** — la grilla usa `ATHLETE_ACHIEVEMENT_DISPLAY_LIST` + `earnedAchievements` |
| 26 | `earnedAchievements` | Logros | Sí (fechas en la grilla) |
| 27 | `achProgress` | Logros | **Escrito, no leído** — el progreso visual es `achievementDisplayProgress` |
| 28 | `athleteEvaluations` | **Spine** (VDOT menú + medallas + gate eval) | Sí (datos); no pinta la eval (eso es `EvaluationView`) |
| 29 | `medalToast` | Logros | **Escrito, nunca pintado** |
| 30–31 | `athletePayments`, `loadingAthletePayments` | Pagos (lista read-only) | Sí |
| 32 | `pushInviteDismissed` | Push | **Muerto** — se inicializa de localStorage y no se lee ni se pinta |
| 33 | `athleteCalendarCtxMenu` | Calendario | Sí |
| 34–37 | `not100Modal`, `not100Form`, `not100Sending` + `avatarUploading` | Overlay no-100% / config avatar | Sí (avatar es Config) |
| 38–40 | `briefingModal`, `briefingText`, `briefingLoading` | Overlay briefing | Sí |
| 41 | `athleteChatClearing` | Chat | **Muerto** — solo lo toca `clearAthleteChat`, que no tiene botón |
| 42–44 | `intervalsConnected`, `intervalsRefreshNonce`, `forceManualFields` | RPE + Config (IntervalsConnect) | Sí |
| 45–49 | `findCoachCodeInput`, `findCoachCodeBusy`, `coachRequestBusy`, `coachRequestPending`, `coachRequestMsg` | Coach-link | Sí |
| 50–52 | `workoutSummaryModal`, `manualSummaryForm`, `manualSummarySaving` | **Modal RPE** | Sí |
| 53 | `athleteProgressTab` | Progreso (home) | Sí |
| 54 | `calendarViewMonth` | Calendario | Sí |
| 55 | `races` | Carreras (carga) | **Cargado y no pintado** — ver §1.R |
| 56 | `nativeDeepLinkTick` | Deep links nativos | Sí (interno) |

**Conteo por sección (solo los 56):**

| Sección | Estados | De ellos muertos / no pintados |
|---|---|---|
| Spine (`athleteInfo`, workouts, evals, message, loading, not-registered) | 6 | 0 |
| Nav / chrome / deep link | 6 | 1 (`showEvaluation`) |
| Coach-link + directorio | 10 | 2 (`coachCodeInput`, `coachCodeSaving`) |
| Calendario (mes + menú) | 2 | 0 |
| RPE / marcar hecho | 6 | 0 (`intervals*` se comparte con Config) |
| Briefing + no-100% | 6 | 0 (avatarUploading cuenta en Config) |
| Chat | 5 | 1 (`athleteChatClearing`) |
| Logros | 4 | 3 (`achievementsCatalog`, `achProgress`, `medalToast`) |
| Forma / fatiga | **0** | Todo derivado de `workouts` |
| Pagos + plan | 4 | 2 (`showPlanModal`, `soloPayInstructions`) |
| Carreras | 1 | 1 (`races` no se pinta) |
| Push invite | 1 | 1 |
| Progress tab | 1 | 0 |
| **Total** | **56** | **~11** |

`avatarUploading` está en el bloque de not-100 por declaración, pero es de Config.

### 0.2) Refs (no son de los 56)

| Ref | Uso |
|---|---|
| `coachDirLoadedRef` | Directorio: una sola carga al abrir Config |
| `athleteChatScrollRef` | Autoscroll del chat |
| `coachPushWarnedRef` | Un aviso de “coach sin push” por sesión |
| `athleteCalendarCtxMenuRef` | Cerrar menú al click fuera |
| `toggleDoneBusyIdRef` | Reentrada de `toggleDone` (RPE) |
| `prevProfileUserIdRef` | Evitar recargar ficha si el `profile.user_id` no cambió; resume silencioso |

---

## 1) Secciones / responsabilidades

Los estados están **declarados en bloque** (y un segundo bloque más abajo: mes calendario, carreras, deep link). La lógica y el JSX viven en franjas distintas.

### A. Prelude / imports / helpers de módulo — L1–251 — **~251 — 0 estados**

- `ATHLETE_HOME_WORKOUT_COLUMNS` (L67–98): lista **explícita**. Comentario: **no incluir `distance_km`** (esa columna no existe en `public.workouts`; PostgREST 400 vacía el calendario). Arreglo de hoy.
- Feeling (L100–116): `FEELING_CHOICES`, `stripFeelingLines`, `feelingFromNotes` (último match), `composeAthleteNotes`. Parte “Cómo me sentí” de las notas para no duplicar en el textarea.
- `CoachLinkActions` (L142–197): componente **ya extraíble**; se pinta en el aviso del home y en Config.
- Nav persist: `raf_athlete_tab`, `raf_athlete_eval_open`, `raf_athlete_profile_tab`, `raf_athlete_progress_tab`.
- `styles` local (L238–250): overflow-X del grid 7-col. Distinto del `styles` de appShared que usa `FormaFatigaPanel`.

Imports **nunca usados en el cuerpo** (solo aparecen en el `import` de appShared): `emptyWorkoutStructureRow`, `workoutStructureToEditableRows`, `editableRowsToWorkoutStructure`, `normalizeLibraryRow`, `libraryRowToBuilderWorkout`, `challengeHasOpenTarget`, `challengeValueLabel`, `challengeProgressLabel`, `challengeProgressOpenText`, `formatChallengeMetricValue`, `challengeUnitByType`, `computeWorkoutDayStreak`, `computeChallengeProgressForAthlete`, `extractJsonFromAnthropicText`, `RACE_DISTANCE_PRESETS`, `raceDistanceToFormFields`, `TAB_KEY_LIBRARY`, `CHALLENGE_TYPE_OPTIONS`, `normalizeChallengeType`, `normalizeWorkoutStructure`.

Copia residual del split de App / de cuando Challenges/Marketplace/eval vivían inline. Los hubs lazy ya traen lo que necesitan.

| Aislamiento | Alto (estático). Viaja con el consumidor. |

---

### B. Spine de `AthleteHome()` — L252–527 + resume L1048–1073 — **~6 estados**

Prop: `profile` (de App).

`refreshWorkouts` (L419–433): `select(ATHLETE_HOME_WORKOUT_COLUMNS)` + `normalizeWorkoutRow`. **Silenciosa** a propósito (no `setLoading`) para el resume. Si falla, **no vacía** la lista.

Carga inicial (L435–527): email de auth → `athletes` por `ilike email` → link `user_id` → FCM / native push → workouts + `athlete_evaluations` (`vdot, created_at`). Si hay workouts `done`, `evaluateAndAwardAthleteAchievements` en `setTimeout(0)`.

`useAppResumeRefresh`: workouts + intervals status + fila `athletes`. El perfil (`profiles`) lo refresca App.

`setResumeUiBusy`: chat abierto **o** draft no vacío. **No** incluye el modal RPE (si el atleta está rellenando RPE y la app vuelve al frente, el resume **sí** puede refrescar). Flag de riesgo.

| Aislamiento | **Muy bajo.** Esqueleto. Último en extraer. |

---

### C. Chrome: nav inferior + sheets + persistencia — L209–236, L339–403, L956–1004, JSX L1832–1888 — **~6 estados**

Tabs: `home | marketplace | challenges | eval | profile`.  
Perfil: `logros | forma | mes | config | pagos`.

Bottom nav **z-index 9999**. Sheets de tab **z 9988**. El modal RPE (**10050**) y briefing/not-100 (**10003**) deben quedar **por encima** del nav. Eso es el arreglo de z-index de hoy: no bajar el RPE por debajo de 9999.

Deep links `athlete_calendar` / `athlete_chat` (URL `?open=` y Capacitor). Query `?tab=profile&profile_tab=config` para volver de OAuth de Intervals.

`showEvaluation` + `raf_athlete_eval_open`: legado. La eval se abre con `athleteActiveTab === "eval"`. El efecto L865 cierra `showEvaluation` si no hay premium y ya hay ≥1 eval; **no** cierra el tab `eval`.

| Aislamiento | **Medio.** Extraíble como `AthleteChrome` (nav + sheet wrapper) **después** de sacar el contenido de cada tab. No primero. |

---

### D. Marketplace — JSX L1850–1854 — **0 estados propios**

`lazy(MarketplaceHub)`. AthleteHome solo pasa `profileRole="athlete"`, `currentUserId`, `notify`, `styles`.

| Aislamiento | **Ya extraído.** No volver a partir. |
| vs Athletes | El coach monta marketplace desde `CoachChrome`, no desde Athletes.jsx. Cero overlap de estado. |

---

### E. Retos / Challenges — JSX L1856–1860 — **0 estados propios**

`lazy(ChallengesHub)` con `workouts` + `normalizeWorkoutRow` + `coachAthletes={EMPTY_ARRAY}`.

Los helpers de challenge importados en L47–54 / L60–62 **no se usan aquí**. Viven dentro del hub.

| Aislamiento | **Ya extraído.** |
| vs Athletes | El coach también monta `ChallengesHub` desde chrome. Misma pieza, otro padre. |

---

### F. Evaluación VDOT — JSX L1862–1878 + gate L860–869 + evals en spine — **0 estados de UI; lee spine**

`lazy(EvaluationView)` detrás de `hasPremiumAccess`.

`hasPremiumAccess` (L860–863): `athlete_plan === "premium"` **o** `coach_id === "b5c9e44a-6695-4800-99bd-f19b05d2f66f"` (UUID de admin **hardcodeado**).

Banner “1 evaluación gratis” (L1865–1868) está **dentro** de `hasPremiumAccess ? …`, así que `{!hasPremiumAccess && …}` **nunca pinta**. Código muerto de presentación.

`athleteLatestVdot` (L589–595) alimenta `WorkoutDetailBreakdown` en el menú del calendario (default 42.5).

| Aislamiento | Hub ya extraído. El gate premium + UUID se quedan en el padre hasta que se extraiga chrome. |
| vs Athletes | El coach no pinta EvaluationView en Athletes.jsx. |

---

### G. Logros / medallas — memos L530–539, load L1092–1104, award en `toggleDone` L805–816, JSX L1890–1929 — **~4 estados**

**Esta grilla SÍ se pinta** (Perfil → Logros). En Athletes la grilla era memo muerto y se borró (`3f17579`).

Fuente de verdad visual: `ATHLETE_ACHIEVEMENT_DISPLAY_LIST` + `computeAthleteAchievementVisualProgress(workouts, athleteEvaluations)` + fechas de `earnedAchievements`.

`achievementsCatalog` y `achProgress` se actualizan en load/award y **no se leen**.

`medalToast` se setea al desbloquear y **no hay JSX** que lo muestre.

| Aislamiento | **Alto** como vista. El *award* está pegado a `toggleDone` (y a la carga inicial). Extraer la grilla con props `{ progress, earnedByCode }`; dejar `evaluateAndAward…` en el flujo RPE. |
| appShared | Snapshot / award / display list ya están ahí. No duplicar. |
| vs Athletes | Mismo `evaluateAndAwardAthleteAchievements` al marcar hecho. UI solo aquí. **No** unificar el trigger (el trigger del coach es `toggleWorkoutDone`, el del atleta es `toggleDone`). |

---

### H. Forma / fatiga — memos L871–875, JSX L1931–1963 — **0 estados**

Mismos cálculos que `FormaFatigaPanel` del coach:

1. Garmin-like: `computeGarminLoadMetricsFromWorkouts`
2. RPE × km: `computeFormaFatigaWeeklyPoints` + `FormaFatigaLineChart`

AthleteHome **no** pinta: tabla 4 semanas (`athleteFormaFatigaTableRows` se calcula y **no se usa**), ni la barra de ratio aguda/crónica del panel del coach.

Gate premium: sin plan, CTA a Pagos.

| Aislamiento | **Alto** como vista. |
| ¿Reusar `FormaFatigaPanel`? | **No en el primer paso.** Layout distinto (sin `order: 6`, sin tabla, sin ratio, con paywall). Extraer `AthleteFormaFatiga.jsx` o añadir `variant` después, con Preview. |
| vs Athletes | Chart ya compartido. Panel del coach **no** está montado aquí. |

---

### I. Calendario propio + menú — estado L552–630, JSX L1557–1727 — **~2 estados + spine**

Grid mensual `getMonthGrid` / `DAYS` de **appShared** (`["Lun","Mar","Mie",…]` **sin** acentos). El calendario del coach usa `DAYS` **locales con acentos** en `AthleteCalendarSection.jsx`. No mezclar.

**No hay drag-and-drop.** El atleta no mueve ni edita entrenos.

Chips: solo workouts (máx. 2 por día). Click → `openAthleteWorkoutMenu`. Menú **z 10002**. Cierre: `setTimeout(0)` + `mousedown` fuera — **el mismo patrón frágil** que el menú del coach.

Acciones del menú:

| Acción | Handler | ¿Existe en el coach? |
|---|---|---|
| Marcar hecho / pendiente | `toggleDone` → modal RPE | **No.** Coach: `toggleWorkoutDone` instantáneo |
| No estoy al 100% | `not100Modal` | No |
| Ver detalle | `WorkoutDetailBreakdown` | Coach tiene detalle + editar estructura |
| Briefing IA | `generateBriefing` | No (el coach tiene analyze/adjust) |

`WorkoutStructureTable`: no. No hay panel de editar.

Menú cierra con el mismo `setTimeout(0)` que en Athletes: el click que abre el menú no debe disparar el listener de cierre.

| Aislamiento | **Bajo.** Núcleo del home. Depende de RPE, briefing, not-100, VDOT, medallas. Extraer **tarde**, y **junto** con el modal RPE o justo antes, no fusionado con el calendario del coach. |
| vs Athletes | Misma geometría de mes + `normalizeWorkoutRow` + `WORKOUT_TYPES`. Comportamiento y overlays **distintos**. No reusar `AthleteCalendarSection`. |

---

### J. Modal RPE / `toggleDone` — **mapeo preciso (no mover todavía)**

Ver **§3**.

---

### K. Briefing IA + “No estoy al 100%” — L1372–1430, JSX L1765–1830 — **~6 estados** (not-100 3 + briefing 3; avatar no cuenta aquí)

Briefing: `POST /api/analyze-workout` `{ prompt, mode: "briefing" }`. z **10003**.

Not-100: escribe **todo** `athlete_notes` del workout con `[No estoy al 100% · Nivel: …]` y push al coach. Solo se ofrece si el workout **no** está `done`. Riesgo: pisa notas previas de ese row (poco probable si nunca se completó). **No** usa `composeAthleteNotes`.

| Aislamiento | **Medio.** Entran por el menú del calendario. Extraíbles como overlays junto al calendario, o un paso antes del grid. |
| vs Athletes | No existen en el coach. No unificar con analyze/adjust. |

---

### L. Chat atleta→coach — L1008–1226, L1075–1121, JSX L1446–1500 + L2223–2248 — **~5 estados**

Misma tabla `messages`, mismo patrón optimistic + realtime INSERT + poll 60s + `markConversationRead` + `sendChatPushNotification` que `Athletes/useAthleteChat.js`.

Diferencias que impiden reusar el hook del coach tal cual:

| | Coach `useAthleteChat` | AthleteHome |
|---|---|---|
| `sender_role` al enviar | `coach` | `athlete` |
| Push | atleta | coach (`type: "coach_chat"`) |
| Burbujas | atleta a un lado | **invertidas** (coach a la derecha en este JSX) |
| Unread lista | apaga badge de lista | no hay lista |
| `clearChat` | hay UI | función **muerta** (`clearAthleteChat`) |
| Sheet z | — | **9989** (bajo el nav 9999; el paddingBottom 94 evita que el input quede detrás) |

| Aislamiento | **Medio-alto.** Extraer `useAthleteSideChat` + `AthleteChatSheet` **sin** importar el hook del coach. Un `senderRole` compartido puede ser un refactor **posterior**, no el primer PR. |
| appShared | timestamps, push, mark-read. |

---

### M. Coach-link + directorio — L1165–1309, JSX L1502–1527 + Config L1989–2048 — **~10 estados**

Código público (`resolveCoachUserIdFromPublicCode`) o solicitud (`coach_requests` + `resolveDefaultCoachUserId`). `linkAthleteToCoach` escribe `athletes.coach_id` y `profiles.coach_id`, luego recarga workouts.

Directorio: `coach_public` `is_public`, mínimo `MIN_COACHES_FOR_DIRECTORY` (3) para pintar. Una carga al abrir Config.

`CoachLinkActions` ya es un componente de módulo.

| Aislamiento | **Alto.** No lee el calendario salvo recargar workouts al vincular. |
| vs Athletes | El coach tiene el panel de *aceptar* solicitudes; este archivo las *crea*. No unificar. |

---

### N. Config / perfil atleta — JSX L1965–2216 + `uploadAthleteAvatar` L1341–1370 — avatar + intervals + logout

Bloques vivos **dentro** de `athleteProfileTab === "config"`: foto, mi coach, directorio, `IntervalsConnect`.

**Fuera** de los `if` de sub-tab, todavía dentro de `athleteActiveTab === "profile"`:

- `ChangePasswordSection`
- `DeleteAccountSection`
- botón Cerrar sesión (limpia localStorage de tabs, FCM, `signOut`)

Eso significa que contraseña / borrar cuenta / logout se pintan en **Logros, Forma, Mes, Config y Pagos**. Hallazgo de layout (preexistente). Al extraer Config, decidir si el logout es chrome de perfil o solo Config.

`IntervalsConnect` usa `intervalsRefreshNonce` (resume). El mismo `intervalsConnected` lo lee el modal RPE.

| Aislamiento | **Medio.** Intervals cruza con RPE. Logout es de sesión. |
| vs Athletes | El coach no tiene este Config. |

---

### O. Pagos del atleta + Wompi solo — L908–940, L1024–1031, JSX L2127–2174 — **~4 estados (2 muertos)**

Dos productos **distintos** en la misma pestaña:

1. **Read-only** `athlete_payments` (`loadMyPayments`) — lo que el coach registró a mano. **No** reusar `useAthletePayments` del coach (ese hook es CRUD + email de confirmación + `PAYMENT_PLAN_AMOUNT_COP`).
2. **Checkout Wompi** atleta independiente (`trySoloIndependentCheckout` → `/api/wompi-create-checkout`, `ATHLETE_SOLO_COP`). `hasCoachPremiumIncluded` oculta el checkout si hay `coach_id`.

`openAthletePremiumWa` (WhatsApp) está **definido y no se llama**. `showPlanModal` / `soloPayInstructions` muertos.

| Aislamiento | **Alto** respecto al calendario. |
| vs Athletes | Misma tabla, **otra** UX. No compartir el hook del coach. |

---

### P. Progreso home + “Mes” — L632–675, `renderAthleteProgressCard` L1311–1334, JSX L1555 + L1729–1763 + L2056–2125 — **1 estado** (`athleteProgressTab`)

Home: card Semana/Mes/Año (`athleteProgressStats`) + tira “Progreso semanal” 4 semanas (`last4WeeksSummary`).

Perfil → Mes: IIFE que compara mes actual vs anterior (`total_km`).

Inconsistencia de km:

| Sitio | Campo |
|---|---|
| `athleteProgressStats` (L652) | `w.distance_km` |
| `last4WeeksSummary` (L669) | `w.total_km` (**todos** los de la semana, no solo `done`) |
| Tab Mes | `w.total_km` de `done` |

Tras `normalizeWorkoutRow`, `distance_km` cliente se rellena desde `total_km` porque el `select` **no** pide `distance_km`. Hoy coinciden. Es frágil: no añadir `distance_km` al select.

`last4WeeksSummary` suma km de entrenos **pendientes y hechos**. El card de progreso solo suma `done`. Producto, no bug de columnas.

| Aislamiento | **Alto** (solo lee `workouts`). Extraíble como `AthleteProgressCards`. |

---

### Q. Clima + PWA — L313, JSX L1443, L1538–1553 — **0 estados propios** (`useWeather`)

`WeatherWidget` + aviso si hay workout hoy no hecho. `InstallAppButton` en el home (también hay acceso en Config vía… no: solo home).

| Aislamiento | Alto. Dejar en el spine del home o extraer con el header. |

---

### R. Carreras (carga muerta en UI) — L559–584

`select *` de `races`, `normalizeRaceRow`, `racesByDate`, `getNextRaceCountdown`, `nextRaceText` (`athletes.next_race`).

**Ninguno se pinta.** El calendario del atleta **no** dibuja chips de carrera. El countdown no está en el header.

El calendario del **coach** sí pinta `racesByDate` en las celdas.

| Aislamiento | Datos listos, UI ausente. No extraer un overlay de carreras hasta decidir si se pintan. No copiar CRUD del coach (el atleta no crea carreras aquí). |

---

### S. Header / empty states — JSX L1432–1537

Hola + logo, banner coach + botón Chat, aviso “Aún no tienes entrenador”, “Estamos preparando tu ficha”.

| Aislamiento | Medio. El banner abre el chat. El aviso monta `CoachLinkActions`. |

---

## 2) ¿Qué tan aislada está cada sección?

| Sección | Aislamiento | ¿Depende de otras *dentro* del archivo? | ¿appShared / libs vs lógica propia? | ¿Comparte con Athletes.jsx más allá de FormaFatigaLineChart / WorkoutStructureTable? |
|---|---|---|---|---|
| Marketplace / Retos / Eval hubs | Ya extraídos | Sheet chrome + premium gate | Hubs propios | Mismos hubs desde CoachChrome, no desde Athletes.jsx |
| `CoachLinkActions` | Muy alto | Código/solicitud | `resolveCoachUserIdFromPublicCode` appShared | No |
| Grilla Logros | Alto | Award en `toggleDone` | Display/award en appShared | Award sí (otro trigger). Grilla **no** en Athletes |
| Forma panel atleta | Alto | `workouts` + premium | Cálculo appShared; chart compartido | Chart sí. `FormaFatigaPanel` no montado aquí |
| Progreso + Mes | Alto | `workouts` | Fechas appShared | No |
| Pagos read-only + Wompi | Alto | `athleteInfo` / plan | Fetch propio; precios `planPrices` | Misma tabla; **hook del coach no sirve** |
| Chat | Medio-alto | Banner; `resumeUiBusy` | Push/read appShared; send propio | Mismo patrón que `useAthleteChat`, **otro rol** — no unificar en el 1er PR |
| Config (foto, intervals, logout) | Medio | Intervals ↔ RPE | `IntervalsConnect` ya extraído | No |
| Briefing + not-100 | Medio | Menú calendario | Fetch briefing propio | No existen en el coach |
| Chrome nav/sheets | Medio | Todas las tabs | Persist localStorage | No |
| Calendario grid+menú | Bajo | RPE, briefing, not-100, VDOT | Grid/fechas appShared | Geometría similar; **sin DnD, sin razas pintadas, sin registro coach** |
| Modal RPE + `toggleDone` | Bajo | Intervals, medallas, chat push, pull-activity, columnas select | Feeling helpers **locales**; `clampWorkoutRpe` / `normalizeWorkoutRow` appShared | **No unificar** con `toggleWorkoutDone` ni con `WorkoutRegistroModal` |
| Spine AthleteHome | Muy bajo | Todo | — | — |
| Carreras | N/A (sin UI) | — | `normalizeRaceRow` appShared | Coach sí pinta chips |

`WorkoutStructureTable`: **cero uso** en este archivo. El overlap real extra con Athletes es `WorkoutDetailBreakdown` (menú detalle) + helpers de appShared (`normalizeWorkoutRow`, achievements, chat push, forma/garmin, calendar grid).

---

## 3) Modal RPE / `toggleDone` — dependencias (no mover)

Pieza que se arregló hoy (z-index, notas duplicadas, `select` sin `distance_km`). Cualquier extracción posterior tiene que salir con **el mismo contrato**. No mezclar con el registro del coach.

### 3.1) Estados y refs que viajan juntos

| Símbolo | Rol |
|---|---|
| `workoutSummaryModal` | `{ workout }` o `null`. Abrir = pintar overlay. |
| `manualSummaryForm` | Campos **locales**: `distanceKm`, `durationMin`, `rpe`, `avgHr`, `maxHr`, `calories`, `feeling`, `notes`. `distanceKm` **no** es columna SQL. |
| `manualSummarySaving` | Botón Guardar |
| `intervalsConnected` | Oculta km/min/FC/kcal si el reloj está linkeado |
| `forceManualFields` | “¿No llegaron los datos? Escríbelos a mano”. Se resetea en `closeWorkoutModal` |
| `toggleDoneBusyIdRef` | Evita doble tap del mismo id |
| `workouts` / `setWorkouts` | Optimistic `done` **antes** de que el modal guarde RPE |
| `athleteInfo` | id, coach_id, name — push, pull-activity, achievements |
| `setMessage` | Errores de update |

### 3.2) Helpers locales que el modal necesita

```
FEELING_CHOICES
stripFeelingLines          // quita líneas /^Cómo me sentí:/
feelingFromNotes           // último match, default "😐 Normal"
composeAthleteNotes        // "Cómo me sentí: …\n" + body
ATHLETE_HOME_WORKOUT_COLUMNS
openWorkoutSummaryModal
closeWorkoutModal
saveManualWorkoutSummary
toggleDone
loadIntervalsConnected     // se llama al abrir; **sin await**
```

`saveWorkoutRpe` (L835–858): **muerto**. El RPE de la UI solo se persiste en `saveManualWorkoutSummary`. No hay slider suelto en el calendario.

Feeling vs `WorkoutRegistroModal` (coach): el registro **solo lee** (primer match `/m`, no `compose`). AthleteHome **escribe**. Misma convención de prefijo `Cómo me sentí:`. Candidatos a un helper único en appShared **cuando** se extraiga el modal, no antes, y **sin** unificar los dos modales.

### 3.3) Flujo `toggleDone` (L748–833)

1. Guard: sin `id` → return. Si `toggleDoneBusyIdRef` ya es ese id → return.
2. `next = !w.done`.
3. Optimistic: `setWorkouts` (`done` + limpia `rpe` si desmarca).
4. Si `next`: `openWorkoutSummaryModal({ ...w, done: true })`. Si no: `setWorkoutSummaryModal(null)`.
5. `supabase.from("workouts").update(payload).eq("id")`  
   - hecho: `{ done: true }` **solo** (RPE/notas van después en el modal).  
   - pendiente: `{ done: false, rpe: null }`.
6. Error → revert optimistic, cierra modal si se estaba abriendo, `setMessage`.
7. Si `next` y hay `athleteInfo.id`:
   - `notifyCoachWorkoutCompletedFromClient` si hay `coach_id` (**aquí**, no en `saveManualWorkoutSummary` — comentario L728–729: repetirlo reclamaba 0 filas).
   - `POST /api/integrations` `{ action: "pull-activity", athlete_id, workout_id }` fire-and-forget.
   - `evaluateAndAwardAthleteAchievements` → catalog / earned / progress / `medalToast` (toast no se pinta).
8. Si `!next` y hay coach: push “Sesion no completada”.
9. `finally`: limpia busy ref.

**Implicación:** si el atleta cierra el modal sin Guardar, el workout **ya está `done: true`** sin RPE/notas. Es el contrato actual (marcar hecho abre el resumen; no es transaccional con Guardar). No “arreglarlo” en el mismo PR que la extracción.

### 3.4) `openWorkoutSummaryModal` (L679–702)

- Log `[rpe-modal] open`.
- `void loadIntervalsConnected()` **no esperado**: el prefill usa el `intervalsConnected` **actual**. Si el status aún es `false`, rellena `distanceKm`/`durationMin` desde `total_km` / `duration_min`; un tick después el status puede pasar a `true` y ocultar esos campos. Riesgo preexistente; no “arreglar” al extraer salvo test explícito.
- Prefill feeling/notes vía helpers locales.

### 3.5) `saveManualWorkoutSummary` (L704–746)

Payload SQL:

- `manual_distance_km`, `manual_duration_min`, `manual_avg_hr`, `manual_max_hr`, `manual_calories`
- `athlete_notes` = `composeAthleteNotes(feeling, notes)`
- `total_km` / `duration_min` si el número parseado es > 0; si no, deja el del row
- `rpe`, `completed_at` now, `done: true`

**No** escribe `distance_km`.  
**No** `.single()` / `.maybeSingle()` (0 filas no debe ser 406).  
**No** vuelve a notificar al coach.  
**No** vuelve a evaluar medallas (el efecto L1092 recarga snapshot cuando cambia `workoutsAchSyncKey` que incluye `rpe`; **no** llama `evaluateAndAward` otra vez). Medallas que dependan de RPE pueden quedar para la próxima carga inicial o el próximo `toggleDone`. Flag.

Select de verificación: `.select("id")` solamente.

Optimistic local: `normalizeWorkoutRow({ ...w, ...payload })`.

### 3.6) JSX del modal — L2250–2374

- Overlay `position: fixed; inset: 0; zIndex: **10050**`. Debe quedar por encima de nav 9999, menú 10002, briefing/not-100 10003. **No bajar.**
- Comentario L2250 dice “+ análisis Claude”: **mentira**. No hay análisis en este modal (eso es briefing, otro overlay).
- Grid PROGRAMADO (`total_km`) vs LO QUE HICISTE (`manualSummaryForm.distanceKm`).
- Inputs de distancia usan el key de formulario `distanceKm`, no un input atado a columna `distance_km`.
- Botón: “Guardar notas” si intervals conectado; “Guardar registro” si no.
- Cerrar: `closeWorkoutModal` (no desmarca el `done`).

### 3.7) Entrada desde el menú

L1703–1705: el click de “Marcar hecho / pendiente” cierra el menú y `void toggleDone(row)`. `onMouseDown preventDefault` para no disparar el listener de cierre.

### 3.8) Columnas / PostgREST

`refreshWorkouts` y el reload post-`linkAthleteToCoach` usan `ATHLETE_HOME_WORKOUT_COLUMNS`. Si alguien añade `distance_km` al string, el calendario del atleta se **vacía** (el síntoma de hoy). La columna de distancia real en esta tabla es `total_km` + `manual_distance_km` + `actual_distance_km`.

`normalizeWorkoutRow` **inventa** `distance_km` en el cliente a partir de `total_km`. Por eso `athleteProgressStats` puede leer `w.distance_km` sin haberla seleccionado.

### 3.9) Qué **no** es dependencia

- `WorkoutRegistroModal` / laps / mapa / `compareBlocks`
- `toggleWorkoutDone` / `athletes.workouts_done` / `onAthleteWorkoutsDoneSync`
- `WorkoutStructureTable` / panel editar / DnD
- `saveWorkoutRpe` (muerto)

### 3.10) Extraer más adelante (cuando se valide)

Destino tentativo: `src/components/AthleteHome/useAthleteToggleDone.js` + `WorkoutRpeModal.jsx` (nombre a convenir). Feeling helpers → `appShared` **en ese PR** si el registro del coach puede importarlos. El calendario del atleta **no** se fusiona con `Athletes/AthleteCalendarSection`.

---

## 4) Orden de sub-extracciones recomendado

Misma disciplina que Athletes: **un módulo (o hook) por PR**, build, Preview, no fusionar hasta validar. Empezar por lo que **no** toca `toggleDone`.

Carpeta: `src/components/AthleteHome/` (espejo de `Athletes/`). **No** meter piezas exclusivas del atleta en `Athletes/`.

| # | Extraer | Por qué primero / después | Destino tentativo |
|---|---|---|---|
| — | Marketplace / Retos / Eval | Ya son lazy. No re-extraer | — |
| 1 | `CoachLinkActions` | Ya es componente; 0 hooks | `AthleteHome/CoachLinkActions.jsx` |
| 2 | Grilla Logros (solo JSX + memos de display) | 0 escritura; award se queda en `toggleDone` | `AthleteAchievementsGrid.jsx` |
| 3 | Forma/fatiga atleta | 0 estados; no usar `FormaFatigaPanel` tal cual | `AthleteFormaFatiga.jsx` |
| 4 | Progreso home + tab Mes | Solo lee `workouts` | `AthleteProgressSection.jsx` |
| 5 | Pagos read-only + Wompi | 0 calendario; **nuevo** hook, no `useAthletePayments` | `useAthleteSoloPayments.js` + panel |
| 6 | Chat atleta | 4 estados vivos; cruce `resumeUiBusy` | `useAthleteSideChat.js` + sheet. **No** importar el hook del coach |
| 7 | Config (foto, directorio, intervals UI, password/delete/logout) | Intervals status se queda accesible al RPE | `AthleteConfigPanel.jsx` |
| 8 | Briefing + not-100 overlays | Salen del menú; z 10003 | `AthleteWorkoutOverlays.jsx` |
| 9 | Calendario grid + menú (sin RPE) | Aún llama `onToggleDone` por callback | `AthleteOwnCalendar.jsx` — **no** `AthleteCalendarSection` |
| 10 | Modal RPE + `toggleDone` + columnas + feeling helpers | Lo más delicado; último | `WorkoutRpeModal.jsx` + hook. Feeling → appShared en **este** PR |
| 11 | Spine `AthleteHome.jsx` | Header, chrome, wiring | Se queda fino |

**No hacer en el primer tren:** unificar done-toggle con el coach; montar `FormaFatigaPanel` sin Preview; pintar carreras “de paso”; borrar dead code salvo el que estorbe a una extracción concreta (acordar).

Limpieza de imports muertos de appShared: puede ir en el PR #1 o en un chore aparte, **sin** cambiar comportamiento.

---

## 5) Riesgos y hallazgos (estilo Athletes)

### Código muerto / no pintado

| Qué | Dónde | Acción sugerida (cuando toque) |
|---|---|---|
| ~20 imports de appShared (structure/library/challenge/races presets) | L41–62 | Borrar del import |
| `coachCodeInput`, `coachCodeSaving` | L270–271 | Borrar; el flujo vivo es `findCoach*` |
| `showPlanModal`, `soloPayInstructions` | L282–283 | Borrar |
| `openAthletePremiumWa` | L918–921 | Borrar o volver a cablear; hoy gana Wompi |
| `pushInviteDismissed` | L297–299 | Borrar estado (el invite UI no está) |
| `showEvaluation` + 3 efectos + `raf_athlete_eval_open` | L285, L339–374, L865 | Confirmar que el tab `eval` basta; entonces retirar |
| `achievementsCatalog`, `achProgress` | L290, L292 | Dejar de setear o usar; la grilla no los lee |
| `medalToast` | L294, set en award | Pintar toast **o** dejar de setear (en Athletes se pintaba el toast; aquí no) |
| `saveWorkoutRpe` | L835–858 | Borrar o cablear; la UI no lo llama |
| `clearAthleteChat` + `athleteChatClearing` | L1217–1226, L314 | No hay botón |
| `athleteFormaFatigaTableRows` | L874 | Memo huérfano (el panel del coach sí usa la tabla) |
| `races` / `racesByDate` / `nextRaceCountdownAthlete` / `nextRaceText` | L559–584, L1005 | Carga sin UI. Decisión de producto: chips en el calendario del atleta, o no cargar |
| Banner “1 eval gratis” | L1865–1868 | Condición imposible (`hasPremiumAccess && !hasPremiumAccess`) |
| Comentario “análisis Claude” en el modal RPE | L2250 | Mentira; quitar al extraer |

### Duplicación que **sí** debería ir a appShared (más adelante)

| Qué | Dónde | Por qué no ahora |
|---|---|---|
| Feeling parse/compose | AthleteHome L100–116 vs `WorkoutRegistroModal` L19–23 | El registro solo lee; el RPE escribe. Extraer helpers **con** el modal RPE, y luego hacer que el registro los importe. No unificar modales. |
| Memos forma/fatiga | AthleteHome L871–875 vs `FormaFatigaPanel` | El panel del coach es un componente; aquí es un subset. Extraer vista atleta primero. |

### Duplicación que **no** debe ir a appShared ni unificarse

- `toggleDone` vs `toggleWorkoutDone`
- Modal RPE vs `WorkoutRegistroModal`
- Chat atleta vs `useAthleteChat` (mismo patrón, otro `sender_role`) — un hook genérico sería opt-in **después**
- Pagos atleta vs `useAthletePayments` (Wompi + lista vs CRUD coach). **No** tocar `PAYMENT_PLAN_AMOUNT_COP`
- Calendario atleta vs `AthleteCalendarSection` (sin DnD, sin razas, sin editar, otro z-index stack)

### Bugs / rarezas preexistentes (no “arreglar” en el mapping)

| Hallazgo | Detalle |
|---|---|
| `distance_km` en el select | Rompe el calendario. El fix de hoy es la lista de columnas. Extraer `ATHLETE_HOME_WORKOUT_COLUMNS` **con** el fetch, no perder el comentario. |
| Modal RPE z 10050 vs nav 9999 | Si al extraer se reusa un z de overlay “genérico” (p.ej. 10010 del registro coach), el nav tapa el modal otra vez. |
| `loadIntervalsConnected` sin await al abrir RPE | Prefill puede usar status stale. |
| `done: true` antes de Guardar | Cerrar el modal deja el entreno hecho sin RPE. Contrato actual. |
| Award de medallas antes de persistir RPE | `evaluateAndAward` corre en `toggleDone`, no en `saveManualWorkoutSummary`. |
| `resumeUiBusy` ignora el modal RPE | Resume puede refrescar workouts a mitad de rellenar el resumen. |
| Not-100 pisa `athlete_notes` entero | No usa `composeAthleteNotes`. |
| UUID admin en `hasPremiumAccess` | Hardcode `b5c9e44a-…`. Moverlo sería producto, no extracción. |
| Password/delete/logout en todos los sub-tabs de Perfil | Anidación JSX; al extraer Config, no “arreglar” de paso sin Preview. |
| `DAYS` sin acentos | appShared. El coach calendar tiene acentos locales. No “igualar” al extraer. |
| `last4WeeksSummary` km de **todos** los entrenos de la semana | El card de progreso solo cuenta `done`. |
| Chat sheet z 9989 < nav 9999 | Aceptable por `paddingBottom: 94`. No subir por encima del RPE. |
| Console `[rpe-modal]` | Dejarlos hasta que el flujo esté extraído y validado; no son dead code. |

### Z-index del atleta (contrato)

| Capa | z-index |
|---|---|
| Sheets Market/Retos/Eval/Perfil | 9988 |
| Chat sheet | 9989 |
| Bottom nav | **9999** |
| Menú contextual calendario | 10002 |
| Briefing / not-100 | 10003 |
| **Modal RPE** | **10050** |

El registro del coach vive en **10010** (otro árbol). No reutilizar ese número aquí.

---

## 6) Qué no es este documento

No mueve código. No unifica done-toggles. No monta `FormaFatigaPanel` en el atleta. No pinta carreras. No borra dead code todavía.

Cuando se valide, el primer PR de extracción es `CoachLinkActions` (o la grilla de logros si se prefiere una pieza más visible), con el mismo rigor de hoy: un trozo, Preview, validar, siguiente.
