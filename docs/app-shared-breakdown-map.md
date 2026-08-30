# Desglose interno de appShared.js

Fecha: 2026-08-30  
HEAD de referencia: `2a6ae49` (`master` / `test/athlete-home-breakdown-map` ya fusionado o coincidente)  
Archivo: `src/components/shared/appShared.js`  
**3035** líneas físicas · **158** exports con nombre

**Estado:** solo análisis. Sin extracción de código. Esperando validación antes de decidir si se parte.

**Contexto:** no es un componente de página. Es la librería de utilidades/constantes que importan Athletes, AthleteHome, App, auth, Builder, Plan2, Marketplace, ChallengeHub, Evaluation, PDF, push nativo, etc. El criterio de partición **no** es “sección de UI”; es dominio + grafo de dependencias + tamaño de chunk.

**No confundir**

| Qué | Dónde | ¿Es este archivo? |
|---|---|---|
| Utilidades transversales del cliente | `src/components/shared/appShared.js` | Sí |
| Fórmulas Daniels / ritmos | `src/lib/vdot.js` | No — appShared **importa** de aquí |
| Lectura de `structure` vs `workout_structure` | `src/lib/workoutStructure.js` | No — appShared llama `readStructure` |
| Texto de workout para el reloj | `src/lib/intervals.js` | No |
| Precios de checkout Wompi | `src/lib/planPrices.js` | No — hay **otro** catálogo de montos aquí (registro manual del coach) |
| Rutas `/auth/confirm` | `src/lib/authRoutes.js` | No |
| Push Capacitor | `src/lib/nativePush.js` | No — pero **importa** FCM helpers **desde** este archivo (dependencia invertida) |
| Vista atleta / vista coach | `AthleteHome.jsx` / `Athletes.jsx` | No |

**Regla dura (misma que el split de páginas):** no unificar `toggleDone` del atleta con `toggleWorkoutDone` del coach, ni el modal RPE con `WorkoutRegistroModal`. Esos flujos **no** viven aquí; aquí solo están los helpers que ambos (u otros) reutilizan (`normalizeWorkoutRow`, `clampWorkoutRpe`, `markConversationRead`, `evaluateAndAwardAthleteAchievements`, etc.).

---

## 0) Foto actual

| Métrica | Valor | Nota |
|---|---|---|
| Líneas | **3035** | El “~2808” del brief era el orden de magnitud; el archivo creció |
| Exports | **158** | Contados por `export function` / `export const` |
| Consumidores en `src/` + `api/` | **~50 archivos** | Cualquier rename de export toca muchos imports |
| Chunk de build (Vite) | `appShared-*.js` **~236 kB** / gzip ~66 kB | Se emite como chunk propio porque casi toda la SPA lo importa |
| Dependencia pesada en la cabecera | `import FitParser from "fit-file-parser"` | Cualquier import de este módulo **puede** arrastrar el parser FIT al grafo |
| Dependencia invertida | `src/lib/nativePush.js` → este archivo | `lib/` no debería depender de `components/shared/` |
| Otra inversión | `src/lib/exportAthletePlanPdf.js` → este archivo | PDF de plan usa `BRAND_NAME`, `WORKOUT_TYPES`, `formatLocalYMD`, `computeHrZones` |

Ya extraído **fuera** (hermanos reales en `src/lib/`):

- `vdot.js` — ritmos / VDOT (fuente única; appShared solo **envuelve**)
- `workoutStructure.js` — `readStructure`
- `intervals.js` — push de texto al reloj
- `planPrices.js` — checkout coach/atleta
- `blockComparison.js` — plan vs laps
- `gpxRacePlan.js`, `enrichPace.js`, `exportAthletePlanPdf.js`
- `authRoutes.js`, `resumeGuard.js`, `nativePush.js`, `firebaseMessaging.js`, `supabase.js`

`FormaFatigaLineChart.jsx` es un **componente** hermano en `shared/`, no vive en este JS.

---

## 1) Dominios identificables (rangos)

El archivo **no** está agrupado de forma limpia: chat aparece en L1044 y otra vez en L2794; carreras en L559 y L2284; fechas por todo el medio. Los rangos son el bloque **principal** de cada dominio, no “todo lo que toca esa idea”.

### A. Auth lock + errores de UI — L14–109

`BRAND_NAME`, `isAuthLockContentionError`, `withAuthLockRetry`, `userFacingError`.

Usado en boot crítico: `App.jsx`, `AuthLanding.jsx`, `Dashboard.jsx`, `useCoachAthletes.js`. `userFacingError` también en IntervalsConnect, ChallengesHub, Plan2Weeks.

### B. Catálogo de tipos de sesión + marketplace / preview de plan — L111–243

`WORKOUT_TYPES`, `EVAL_DISTANCES`, `PLAN_PREVIEW_FULL_DAYS`, `PLAN_SESSION_TYPE_OPTIONS`, reexport `MARKETPLACE_AI_PACE_RANGES_BY_LEVEL` (= `PACE_RANGES_BY_LEVEL` de `vdot.js`), helpers de preview/IA de marketplace, `getMarketplacePlanWorkoutRows`, km de arranque/pico del plan.

Casi todo el bloque marketplace lo consume **solo** `AdminMarketplacePanel` / `MarketplaceHub`.

### C. Normalización de atleta — L245–267

`normalizeAthlete`. Transversal (lista coach, eval, PDF, AthleteHome).

### D. Pagos **manuales** del coach (no Wompi) — L269–296

`PAYMENT_METHOD_OPTIONS`, `PAYMENT_PLAN_OPTIONS`, `PAYMENT_PLAN_AMOUNT_COP` `{ Basico: 129000, Pro: 199000 }`, `defaultPaymentAmountStringForPlan`, `ATHLETE_SUBSCRIPTION_PLAN_CATALOG` (**muerto**).

**No** es `src/lib/planPrices.js`. Checkout Wompi usa `COACH_LIST_COP` / `ATHLETE_SOLO_COP`. Este bloque es el monto por defecto al **registrar un pago a mano** en la ficha del coach.

### E. Bloques de estructura + import FIT (parte 1) — L298–371

`WORKOUT_BLOCK_TYPES` / `COLORS`, `FIT_IMPORT_STEP_TYPES`, `emptyFitImportStructureRow`, `normalizeStructureForFitImportModal`, `structureRowsForFitImportInsert`.

Editor de estructura + modal FIT de `WorkoutLibrary`.

### F. Fechas / calendario + carga Garmin (ACR) — L376–557

`formatLocalYMD`, `calendarCellToIsoYmd`, `normalizeScheduledDateYmd`, `startOfWeekMonday`, `addDays`, `getMonthGrid`, `cellIsInViewMonth`, rangos “próxima semana / próximo mes”, `formatDurationMinutesTotal`.

En medio del bloque de fechas: `computeGarminLoadMetricsFromWorkouts` (L421) — ratio aguda/crónica a 7d vs 4 semanas. Lo leen **ambos** paneles Forma/Fatiga (coach y atleta). No es lo mismo que `computeFormaFatigaWeeklyPoints` (L2866).

`formatLocalYMD` es el helper más usado del archivo después de `styles` (**~15** archivos).

### G. Carreras — L559–612 y L2284–2310

Presets, prioridad, `normalizeRaceRow`, `getNextRaceCountdown` (lista de `races` + `todayYmd`).  
Más abajo: `getRaceCountdownText` (string crudo `athlete.next_race`). Dos APIs; AthleteHome calcula **ambas** y **no pinta ninguna**.

### H. Parseo de respuestas Anthropic — L614–666

`extractAnthropicTextContent`, `extractJsonFromAnthropicText`. Builder, Plan2, AdminMarketplace, ChallengesHub. AthleteHome **importa** el JSON helper y **no lo usa**.

### I. Estructura de workout (capa UI) — L668–815

`normalizeWorkoutStructure`, `blockDurationToMinutes`, `sumStructureRows`, `emptyWorkoutStructureRow`, `workoutStructureToEditableRows`, `editableRowsToWorkoutStructure`.

Capa **por encima** de `readStructure` (`src/lib/workoutStructure.js`). El lib solo elige columna; esto normaliza filas para tabla/editor.

### J. Reconciliar km ↔ duración con ritmos (envuelve VDOT) — L817–965

`EASY_SHARE_BY_TYPE`, `PACE_ZONE_BY_TYPE`, `sessionMeanPaceSeconds`, `reconcileWorkoutKmDuration`, `reconcileWorkoutList`.

Usa `fmtPace` / rangos de `vdot.js`. **No** duplica las fórmulas Daniels. Consumidores: Builder, Plan2, AdminMarketplace.

### K. Km semanales (query) — L967–1035

`currentWeekRangeYmd`, `workoutActualKm`, `sumWeekKm`, `fetchWeeklyKmByAthlete`. Dashboard / lista coach / Builder.

### L. Chat / mensajería (queries) — L1044–1088 y L2794–2821

`fetchUnreadMessageCounts`, `markConversationRead`.  
Más abajo: `parseUtcTimestamp`, `formatMessageTimestamp` (sin `Intl`, a propósito del WebView).

Los **hooks** de chat (`useAthleteChat`, `useAthleteSideChat`) viven fuera; de aquí solo salen mark-read, unread counts, timestamps y el push (`sendChatPushNotification`, dominio P).

### M. Biblioteca + parser FIT/JSON — L1090–1549 (~460 líneas)

`normalizeLibraryRow`, `libraryRowToBuilderWorkout`, `parseFitFileToLibraryDraft`, `parseJsonFileToLibraryDrafts`, `mapFitWorkoutType`, etc.

Único consumidor de verdad: `WorkoutLibrary.jsx` (+ puente `useBuilderLibraryBridge`). Es el bloque más largo y el que justifica el `import FitParser` de la cabecera.

### N. Admin / trial + **estilos del chrome coach** — L1551–1644

`PLATFORM_ADMIN_USER_ID` (UUID hardcodeado), `COACH_PROFILE_TRIAL_DAYS`, `coachTrialDaysRemainingFromStart`, objeto `styles` (sidebar, nav, card, notification…).

`styles` es el export **más importado** (~40 archivos). AthleteHome **ya no lo usa** para su página (tiene `styles` local); lo sigue pasando a Marketplace/Challenges/Eval.

### O. Plan 12 semanas / Plan2 — L1646–1726

Tabs, niveles, slots, `validatePlan2Distribution`, `getNextMonday`. Casi todo **solo** `Plan2Weeks.jsx`.

### P. Zonas de FC (Karvonen unificado) — L1728–1820

Único bloque con banner de sección en el archivo. `computeHrZones`, `isValidRestingHr`, `buildAthleteHrZonesPromptText`. Evaluación + prompts de IA + PDF. Comentario interno: había dos cálculos distintos; **no** volver a copiar esto en App.jsx.

### Q. Dispositivos / integraciones (cliente) — L1822–1922

`providerLabel`, `formatDeviceSyncDate`, `fetchActiveDeviceConnections` (vista `athlete_device_status`, **no** la tabla con tokens), `deleteIntervalsEvents` (best-effort vía `/api/integrations`).

Hermanos: `src/lib/intervals.js` (texto del workout para el reloj, server-ish) **no** es este bloque. Este es badge/tooltip/lista + borrar eventos.

### R. Cliente `/api/*` + correo + perfil + invite + password — L1924–2185

`getAccessToken` (export muerto hacia fuera; lo usa `authApiFetch`), `authApiFetch`, `sendAppEmail`, `ensureOwnProfile`, invite stash/accept, `resendSignupConfirmation`, `validateNewPassword`, `passwordUpdateErrorText`. AuthLanding, ConfirmEmail, ResetPassword, ChangePassword, InviteModal.

### S. Asignar workouts + resync de ritmos + push de asignación — L2187–2278

`insertAssignedWorkouts`, `resyncPacesAfterEvaluation` (también `api/integrations.js`), `sendPaceUpdatePushToAthlete`, `sendWorkoutAssignmentPushToAthlete`.

### T. Push / FCM (cliente) — L2312–2604

`registerFcmToken`, `registerFcmTokenDetailed`, `readOwnFcmToken`, `readOwnDeviceTokens`, `unregisterOwnDeviceToken`, `sendChatPushNotification`, `notifyCoachWorkoutCompletedFromClient`, `PUSH_INACTIVE_REASONS`.

`src/lib/firebaseMessaging.js` = SDK Firebase.  
`src/lib/nativePush.js` = Capacitor, y **llama a este bloque**.  
`lib/fcmPush.js` (server) = envío FCM; **no** importa appShared (el hit de `getAccessToken` en el recuento automático era `client.getAccessToken()` de GoogleAuth).

### U. Logros + clamp RPE — L2606–2792

`clampWorkoutRpe`, `computeAchievementProgress`, `ATHLETE_ACHIEVEMENT_DISPLAY_LIST`, `evaluateAndAwardAthleteAchievements`, `loadAthleteAchievementSnapshot`. Award lo disparan **ambos** “marcar hecho” (triggers distintos; la función es la misma).

### V. `normalizeWorkoutRow` — L2823–2852

Hot path (**~11** archivos). Sintetiza `distance_km` desde `row.distance_km` **o** `total_km`. Eso **no** autoriza a pedir `distance_km` en el `select` de PostgREST (columna inexistente → 400 y lista vacía). AthleteHome ya documenta las columnas reales.

### W. Forma / fatiga (puntos semanales) — L2854–2889

`computeFormaFatigaWeeklyPoints`, `formaFatigaStatusFromPoint`. Solo los dos paneles Forma. Distinto de `computeGarminLoadMetricsFromWorkouts` (F).

### X. Resolver coach (código / default) — L2891–2921

`resolveCoachUserIdFromPublicCode`, `resolveDefaultCoachUserId`. AthleteHome (vincular) + fallback al UUID admin.

### Y. Retos — L2923–3035

`CHALLENGE_TYPE_OPTIONS`, labels/progress, `computeChallengeProgressForAthlete`. Consumidor vivo: `ChallengesHub`. AthleteHome **importa el paquete entero y no lo usa** (residuo del archivo monolito).

### Z. Días cortos + COP — L2280, L2925

`DAYS` = `["Lun","Mar","Mie",…]` **sin acentos** (AthleteOwnCalendar / Plan2).  
`AthleteCalendarSection` (coach) tiene **otra** lista local **con** acentos (`Mié`, `Sáb`). No unificar a ciegas.  
`formatCopInt` — PlanPicker / montos.

---

## 2) ¿Ya hay un hermano en `src/lib/`?

| Dominio | ¿Hermano? | ¿Mover ahí? |
|---|---|---|
| A Auth lock / `userFacingError` | `authRoutes.js` solo sabe de pathname | **No.** `authRoutes` es de rutas. Esto es gotrue-lock + copy de error. Candidato a `src/lib/authLock.js` **nuevo**, no a mezclar con rutas |
| B Marketplace / tipos | `vdot.js` (rangos); no hay `marketplace.js` | Marketplace puede ser módulo propio. `WORKOUT_TYPES` es transversal: o se queda shared o un `src/lib/workoutTypes.js` mínimo |
| C `normalizeAthlete` | No | Shared o `src/lib/normalizeAthlete.js`. Transversal de verdad |
| D Pagos manuales coach | `planPrices.js` es **otro producto** (checkout) | **No fusionar** con `planPrices`. Si se mueve: `Athletes` payments helpers, no el catálogo Wompi |
| E–I Estructura | `workoutStructure.js` = `readStructure` | Ampliar el lib **solo** con normalización de filas sería coherente; el editor UI puede quedarse cerca de los componentes `WorkoutStructure*` |
| J Reconcile km/ritmo | `vdot.js` | **No meter fórmulas en vdot.** Estos wrappers pueden vivir junto a Plan2/Builder o un `src/lib/reconcileWorkoutPace.js` que **importe** vdot |
| K Km semanales | No | Shared o queries de dashboard. Toca Supabase |
| L Chat timestamps / mark-read | No (los hooks están en cada lado) | Shared está bien: dos hooks distintos, misma tabla `messages` |
| M FIT/JSON library | No | **El mejor candidato a salir.** Un `src/lib/fitLibraryImport.js` (o `WorkoutLibrary/`) saca `FitParser` del grafo común |
| N `styles` | No | No es “lib de dominio”. Es chrome del coach. Mover a `CoachChrome` / CSS duele por ~40 imports |
| O Plan2 | No | Casi todo puede vivir **dentro** de `Plan2Weeks` o `Plan2Weeks/plan2Shared.js` |
| P HR zones | No | Candidato limpio a `src/lib/hrZones.js` (PDF y eval ya lo compartirían) |
| Q Device labels / status | `intervals.js` es **otro contrato** (texto Garmin) | **No meter labels en intervals.js.** Candidato: `src/lib/deviceStatus.js` |
| R authApiFetch / email / password | `authRoutes.js` no | `src/lib/authApi.js` nuevo, o dejar shared. Toca sesión |
| S assign / resync | `api/integrations.js` ya llama `resyncPacesAfterEvaluation` | Cuidado: mover implica import desde `/api` (el patrón ya existe con `workoutStructure.js`) |
| T FCM cliente | `firebaseMessaging.js`, `nativePush.js` | Los registros de token **deberían** bajar a `src/lib/` para enderezar `nativePush → appShared` |
| U Logros | No | Shared razonable (award desde dos triggers) |
| V `normalizeWorkoutRow` | No | Shared / `src/lib/normalizeWorkoutRow.js`. Muy usado; mover = actualizar ~11 imports y no romper el `select` sin `distance_km` |
| W Forma/fatiga | No (el chart sí está extraído) | Puede ir junto al chart: `shared/formaFatiga.js` |
| X Coach code | No | Shared o Config del atleta |
| Y Retos | No | `ChallengesHub` + helpers locales; AthleteHome no debería importarlos |
| Fechas F | No | Transversal genuino. Un `src/lib/ymd.js` sería el split “aburrido y seguro” si algún día se parte |

**Qué es genuinamente transversal y puede quedarse en un “shared”:** fechas YMD, `WORKOUT_TYPES`, `normalizeWorkoutRow`, `normalizeAthlete`, `styles` (mientras el chrome coach las pida), mark-read/timestamps de chat, `evaluateAndAward*`, `clampWorkoutRpe`, `userFacingError`.

**Qué no es transversal:** parser FIT (~460 líneas, 1 pantalla), constantes Plan2 (1 pantalla), catálogo muerto de suscripción atleta, helpers marketplace de preview.

---

## 3) Seguridad de cada movimiento

Escala: **alto** = muchos imports + auth/datos; **medio** = 2–8 consumidores o dos productos (coach/atleta); **bajo** = 1 consumidor o export ya muerto.

| Movimiento | Riesgo | Por qué |
|---|---|---|
| `withAuthLockRetry` / `isAuthLockContentionError` | **Alto** | App boot, login, carga de atletas. Un import olvidado = sesión rota o loop de AbortError. Hay que actualizar `App`, `AuthLanding`, `Dashboard`, `useCoachAthletes` **y** los tests mentales de pestaña doble |
| `styles` | **Alto** (regresión visual) | ~40 archivos. Un barrel que reexporte mitiga el rename; el riesgo es mover el objeto y que un admin/promo/invite deje de recibir la misma referencia |
| `normalizeWorkoutRow` | **Alto** | ~11 consumidores. Cualquier campo de más/menos cambia calendarios. **No** añadir `distance_km` al SELECT |
| `formatLocalYMD` / grid de mes | **Alto-medio** | 15 archivos; off-by-one de lunes vs domingo rompe coach **y** atleta |
| `evaluateAndAwardAthleteAchievements` | **Medio-alto** | Dos triggers (no unificar). Olvidar un import = medallas que no se otorgan |
| `markConversationRead` / unread / timestamps | **Medio** | Dos hooks de chat ya extraídos; la función es compartida a propósito |
| `providerLabel` / `formatDeviceSyncDate` / `fetchActiveDeviceConnections` | **Medio** | Pocos archivos, pero la vista `athlete_device_status` es el arreglo de no filtrar tokens. Un move que “simplifique” a `device_connections` reabre el leak |
| `deleteIntervalsEvents` | **Medio** | Best-effort post-delete. Si se pierde el call, quedan huérfanos en el reloj (aceptable); si se hace sync y falla, peor |
| `computeHrZones` | **Medio** | Ya unificaron Karvonen. Duplicar otra vez (como pasó en App.jsx) es el riesgo, no el rename |
| `authApiFetch` / `sendAppEmail` / password helpers | **Medio** | Auth + correo transaccional. Menos sitios que el lock |
| FCM `registerFcmToken*` | **Medio-alto** | Web + APK. `nativePush` ya depende de aquí; mover **bien** (hacia `src/lib/`) reduce riesgo a largo plazo; mover mal deja la APK sin token |
| Reconcile km/ritmo | **Medio** | Plan2 / Builder / marketplace IA. Depende de vdot |
| FIT/JSON library | **Bajo-medio** | 1 pantalla, pero `FitParser` es binario. Extraer **baja** riesgo de bundle; hay que no romper el import de `.fit` |
| Plan2 constants | **Bajo** | Un solo archivo |
| Marketplace preview helpers | **Bajo** | AdminMarketplace |
| Retos helpers | **Bajo** si se dejan en ChallengesHub | AthleteHome ya no los usa de verdad |
| `ATHLETE_SUBSCRIPTION_PLAN_CATALOG` / `readMyLastPushDelivery` | **Nulo** (muertos) | Borrar no es “partir”; es limpieza. No mezclar con un split grande |

Un barrel `appShared/index.js` que **reexporte** los mismos nombres reduce el riesgo de imports, **pero no** el de chunk: si el barrel reexporta FIT, FitParser sigue en el grafo salvo entrypoints separados (`import { x } from "./appShared/dates"`).

---

## 4) Recomendación: ¿partir ahora?

**No como el split de Athletes / AthleteHome.** Ahí el archivo era un componente de página: estado, JSX, z-index y bugs de producto mezclados. Aquí el dolor es otro.

| Pregunta | Respuesta |
|---|---|
| ¿Es un cuello de mantenibilidad tipo “no encuentro el modal RPE”? | **No.** Las funciones ya tienen nombre. El mapa de arriba basta para navegar |
| ¿Es un cuello de **bundle / capas**? | **Sí, puntual.** 236 kB de chunk + `FitParser` en la cabecera + `lib/nativePush` importando `components/shared` |
| ¿Conviene un big-bang `appShared/formaFatiga.js` + barrel? | **No ahora.** ~50 imports, riesgo alto en auth/normalize/styles, beneficio de lectura bajo |
| ¿Qué sí justificaría un PR pequeño más adelante? | 1) Sacar FIT/JSON + `FitParser` a un módulo que **solo** importe WorkoutLibrary. 2) Bajar FCM client a `src/lib/` para enderezar nativePush. 3) Borrar exports muertos y los imports zombi de AthleteHome. 4) Opcional: `src/lib/hrZones.js`, `src/lib/ymd.js` **con** reexport temporal desde appShared |

Criterio distinto al de las páginas:

- Página: partir por **superficie de UI** cuando el archivo impide tocar un flujo sin romper otro.
- Librería: partir cuando hay **dependencia pesada**, **inversión de capas**, o un dominio con **un solo dueño** (FIT, Plan2). No partir “porque tiene 3000 líneas”.

Si se parte algún día: **un dominio por PR**, barrel de compatibilidad, build, y no tocar `withAuthLockRetry` en el mismo PR que el parser FIT.

---

## 5) Muerto, duplicado, residuos

### Exports muertos hacia fuera (nadie en `src/` los importa)

Usados **solo dentro** del archivo (export de más, no lógica muerta):  
`marketplacePreviewSessionType`, `marketplaceAiPaceBandKey`, `newFitImportStepKey`, `startOfMonthWeekMonday`, `daysBetweenYmd`, `blockDurationToMinutes`, `KM_DURATION_TOLERANCE`, `sessionMeanPaceSeconds`, `currentWeekRangeYmd`, `workoutActualKm`, `DEVICE_PROVIDER_LABELS`, `RAF_PENDING_INVITE_CODE_KEY`, `currentPushPlatform`, `parseUtcTimestamp`, `getAccessToken`.

Muertos de verdad (cuerpo sin caller):

| Símbolo | Nota |
|---|---|
| `ATHLETE_SUBSCRIPTION_PLAN_CATALOG` | Catálogo Perfil→Pagos sustituido por Wompi / `planPrices.js` (`ATHLETE_SOLO_COP`) |
| `readMyLastPushDelivery` | Definido, cero callers |

### Duplicados / dos fuentes a propósito (no unificar)

| Par | Qué pasa |
|---|---|
| `PAYMENT_PLAN_AMOUNT_COP` vs `src/lib/planPrices.js` | Manual coach (129k/199k) vs checkout (100k/160k coach, 25k atleta). Productos distintos |
| `DAYS` (appShared, sin acento) vs `DAYS` local en `AthleteCalendarSection` (con acento) | Documentado en el calendario del atleta. Unificar cambia UI |
| `PLAN_PREVIEW_FULL_DAYS` (nombres largos) vs `DAYS` | Otro consumidor (marketplace) |
| `getNextRaceCountdown` vs `getRaceCountdownText` | Lista `races` vs string `next_race` |
| `computeFormaFatigaWeeklyPoints` vs `computeGarminLoadMetricsFromWorkouts` | Dos métricas; ambos paneles usan **las dos** |
| `EFFORT_TO_ZONE` en `intervals.js` vs `blockComparison.js` | Ya documentado: no unificar (reloj vs score) |
| Feeling “Cómo me sentí” | **No está aquí.** Write-side en `useAthleteWorkoutRpe.js` (último match). Read-side en `WorkoutRegistroModal` (primer match). El mapa de AthleteHome decía subir helpers a appShared en el PR del RPE; **no se hizo** (correcto: no mezclar writer/reader) |
| `normalizeWorkoutRow.distance_km` | Campo **sintetizado**. La columna SQL no existe |

### Residuos en consumidores (no son de appShared, pero salen al auditar imports)

`AthleteHome.jsx` sigue importando y no usa: estructura editable, library, **todo** el paquete de retos, `extractJsonFromAnthropicText`, presets de carrera / `raceDistanceToFormFields`, `TAB_KEY_LIBRARY`. También calcula `racesByDate`, `nextRaceCountdownAthlete`, `nextRaceText` y **no los pinta**. `saveWorkoutRpe` sigue muerto en el padre. Eso es deuda del split de páginas, no motivo para trocear appShared.

---

## 6) Inventario de consumidores (para estimar un split)

Archivos que importan `./shared/appShared` o `../components/shared/appShared` (fuente, sin `dist/` ni assets Android):

`App.jsx`, `AuthLanding`, `ConfirmEmailScreen`, `ResetPasswordScreen`, `ChangePasswordSection`, `InviteModal`, `CoachChrome`, `CoachSettings`, `Dashboard`, `Athletes.jsx` + hooks/paneles Athletes, `AthleteHome.jsx` + módulos AthleteHome, `Builder`, `Plan2Weeks`, `PlanPicker`, `WorkoutLibrary`, `MarketplaceHub`, `AdminMarketplacePanel`, `ChallengesHub`, `EvaluationView`, `GpxRacePlan`, `WeatherWidget`, `IntervalsConnect`, `Admin/{Panel,Promo,Coaches}`, `hooks/useCoachAthletes`, `useCoachPushDeepLinks`, `useBuilderLibraryBridge`, `src/lib/nativePush.js`, `src/lib/exportAthletePlanPdf.js`, `api/integrations.js` (`resyncPacesAfterEvaluation`).

Cualquier extracción “limpia” sin barrel obliga a tocar esa lista.

---

## 7) Qué no hacer

- No copiar `appShared.js` a `src/lib/appShared.js` de un plumazo.
- No meter `withAuthLockRetry` en `authRoutes.js`.
- No fusionar `PAYMENT_PLAN_AMOUNT_COP` con `planPrices.js`.
- No fusionar device labels con `intervals.js`.
- No meter feeling helpers del RPE y del registro coach en el mismo export “genérico” sin revisar last-match vs first-match.
- No “limpiar” `normalizeWorkoutRow` quitando `distance_km` sintético en el mismo PR que un split: hoy lo leen progress/forma (`w.distance_km`).

---

**Siguiente paso (humano):** validar este mapa. Si el criterio es “¿el archivo estorba como Athletes.jsx?”, la respuesta es **no**. Si más adelante duele el chunk o la dependencia `nativePush → appShared`, el primer PR útil es FIT/FCM, no un barrel de 15 archivos.
