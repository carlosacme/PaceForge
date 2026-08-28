# Mapeo: Athletes list / CRUD shell en App.jsx

Fecha: 2026-08-28  
HEAD de referencia: `bb0add4` (`refactor: extract Builder/Library bridge into useBuilderLibraryBridge`)  
Archivo: `src/App.jsx` (~1369 líneas)  
Contexto: `docs/shell-breakdown-map.md` §C / orden paso **#5** (Athletes list hook)

**Estado:** Paso 2 aplicado — hook `useCoachAthletes.js` en App.

---

## 1) ¿Qué es este bloque? ¿Dónde empieza y termina?

**No es `Athletes.jsx`.** Es la **lista canónica de atletas del coach en App** + load/CRUD/select + ticks/auxiliares que alimentan vistas ya extraídas.

| Capa | Dónde vive | Qué hace |
|---|---|---|
| **Shell (este bloque)** | `App.jsx` | Fuente de `athletes[]`, load (staff/coach), alta/borrado de fila atleta, `selectedAthlete` + LS, form Dashboard, `workoutsRefresh`, `pendingRegistroWorkoutId`, `staffParentCoachId` |
| **Athletes.jsx** | `src/components/Athletes/` | UI ficha: workouts, chat, pagos, races, FC, PDF, sync badges → callbacks hacia App |

### Rangos exactos en App.jsx (hoy)

| Pieza | Líneas ~ | Notas |
|---|---|---|
| Const `RAF_SELECTED_ATHLETE_STORAGE_KEY` | 52–53 | Persistencia id seleccionado |
| Declaraciones de los 9 estados | 110–113, 115–119, 144 | Mezcladas con otros `useState` del shell |
| `updateNewAthleteField` | 230–232 | Form Dashboard |
| `loadAthletes` + `withAuthLockRetry` | 583–655 | Query canónica |
| `useEffect` → `loadAthletes` | 657–659 | Mount / deps |
| Trozo athletes en `useAppResumeRefresh` | 663–668 | `loadAthletes({ silent })` + bump `workoutsRefresh` |
| Persist / restore `selectedAthlete` | 721–741 | LS ↔ lista |
| Limpieza en `handleSignOut` | 776, 792 | `removeItem` + `setSelectedAthlete(null)` — **bootstrap/sign-out**, no mover entero |
| `saveNewAthlete` / `cancelAddAthleteForm` / `handleDeleteAthlete` | 831–916 | CRUD shell |
| `goCoachView` cierra form | 996, 1002, 1006 | Acoplamiento chrome |
| Gate `loadingAthletes` | 1151–1155 | Bloquea main hasta primera carga |
| Wire Dashboard + Athletes (+ syncs) | 1157–1213 | Props + callbacks |
| Props `athletes` a otras vistas | 1217–1303 | Evaluation, Challenges, Settings, Plan2Weeks, Builder, Gpx, Library |
| Sidebar contador | 1065 | `athletes.length` + Σ `weekly_km` |

*Los rangos no son un único intervalo continuo (estado arriba, lógica medio, JSX abajo), igual que en el shell-breakdown.*

### Shell vs Athletes.jsx (separación clara)

**En App (shell):**

- Lista raíz `athletes` / `loadingAthletes`
- `loadAthletes` (coach_id **o** staff vía `coach_staff` + `staff_athletes`)
- Insert atleta (`saveNewAthlete`) y delete atleta + cascada messages/workouts (`handleDeleteAthlete`)
- `selectedAthlete` + key LS
- Form alta Dashboard (`newAthlete`, `showAddAthleteForm`, `planLimitWarning`)
- `workoutsRefresh` (invalidar workouts/badges en Athletes y asignaciones Plan/Builder/Gpx)
- `pendingRegistroWorkoutId` (deep link → modal Registro; **escrito** por `useCoachPushDeepLinks`)
- `staffParentCoachId` (**escrito** dentro de `loadAthletes`)

**Ya dentro de Athletes.jsx (no mover al hook como lógica de ficha):**

- Queries propias: workouts, messages, races, payments, achievements, devices, etc.
- Update parcial `athletes.fc_*` → notifica App vía `onAthleteFcSync`
- Sync `workouts_done` → `onAthleteWorkoutsDoneSync`
- Delete de **workouts/races/messages** de la ficha (no del atleta raíz)
- UI lista/detalle; llama `onDeleteAthlete` para el borrado raíz

---

## 2) Los 9 useState (propósito)

| # | Estado | Línea ~ | Propósito |
|---|---|---|---|
| 1 | `athletes` | 115 | Lista canónica coach/staff |
| 2 | `loadingAthletes` | 116 | Primera carga (gate UI “Cargando atletas…”) |
| 3 | `selectedAthlete` | 110 | Ficha activa en vista Atletas; LS `raf_selected_athlete` |
| 4 | `workoutsRefresh` | 111 | Tick: Athletes refetch workouts/km; también Plan2Weeks/Builder/Gpx al asignar; resume; post-delete |
| 5 | `pendingRegistroWorkoutId` | 113 | Deep link `coach_*` → abrir modal Registro en Athletes |
| 6 | `showAddAthleteForm` | 117 | Mostrar form “Nuevo Atleta” en Dashboard |
| 7 | `newAthlete` | 119 | Campos del form (`name`, `email`, `goal`, `pace`, `weekly_km`) |
| 8 | `planLimitWarning` | 118 | Aviso límite plan Básico (15) al intentar alta |
| 9 | `staffParentCoachId` | 144 | Si el user es staff: `coach_id` padre (Settings `isStaff`, Library `parentCoachId`) |

---

## 3) Queries Supabase y CRUD en el shell

### `loadAthletes` (App ~583–655)

- Gate: si `authLoading` o no `session` → lista vacía, `loadingAthletes=false`
- Dentro de `withAuthLockRetry` (mismo patrón auth-lock que bootstrap):
  1. `supabase.auth.getUser()`
  2. `coach_staff` → ¿es staff?
  3. **Staff:** `staff_athletes` → ids → `athletes.select('*').in('id', …)`
  4. **Coach:** `athletes.select('*').eq('coach_id', coachId)`
  5. Side-effect: `setStaffParentCoachId` si hay fila staff
- Normaliza con `normalizeAthlete` (appShared)
- `silent: true` en resume (no flip loading / toast)

### CRUD en shell (no en Athletes.jsx)

| Acción | Función | Tablas | ¿En Athletes.jsx? |
|---|---|---|---|
| **Create** | `saveNewAthlete` | `athletes.insert` | No (UI form en Dashboard; lógica App) |
| **Delete** | `handleDeleteAthlete` | `messages` → `workouts` → `athletes` | Solo dispara `onDeleteAthlete` |
| **Update lista** | syncs JSX | — | Athletes actualiza FC/`workouts_done` en DB y pide a App parchear `athletes`/`selected` |
| **Update coach_id** | CoachSettings | — | Settings usa `setAthletes` pasado desde App |

**InviteModal** no hace CRUD de fila `athletes` aquí: invita por link/código; **no recibe** la lista `athletes`.

---

## 4) Consumidores de la lista canónica (ninguno debe romperse)

| Consumidor | Qué usa | Notas |
|---|---|---|
| **Dashboard** | `athletes`, form props, `onSelect` → set selected + view | Alta UI / empty state |
| **Athletes** | `athletes`, `selected`, `workoutsRefresh`, registro pending, syncs, `onDeleteAthlete` | Dueño de la ficha |
| **EvaluationView** | `athletes` | Tabs Atletas |
| **ChallengesHub** | `coachAthletes={athletes}` | Tabs Atletas |
| **CoachSettings** | `athletes`, `setAthletes`, `isStaff` vía `staffParentCoachId` | Mutación lista (reassign) |
| **Plan2Weeks** | `athletes`; escribe `workoutsRefresh` vía `onPlanAssigned` | No es dueño de la lista |
| **Builder** | `athletes`; `onWorkoutAssigned` → `workoutsRefresh` | |
| **GpxRacePlan** | `athletes`; mismo tick assign | |
| **WorkoutLibrary** | `athletes` + `parentCoachId={staffParentCoachId}` | |
| **Sidebar** | `athletes.length`, Σ `weekly_km` | Chrome |
| **useCoachPushDeepLinks** | lee `athletes`; escribe `setSelectedAthlete` + `setPendingRegistroWorkoutId` | Deep link espera lista cargada |
| **Gate main** | `loadingAthletes` | Sin lista lista, no pinta vistas |
| **InviteModal** | — | **No** consume `athletes` (solo abre desde Dashboard/Athletes) |
| **AthleteHome** | — | Rol athlete; lista propia, **no** esta fuente |

Extraer a hook **sin Context** y seguir pasando las mismas props desde App **no cambia** el contrato de estos módulos.

---

## 5) Por qué el aislamiento es “medio-bajo”

No es que el código esté “mezclado ilegible”; es que **casi todo el shell coach es consumidor o escritor** de este bus:

1. **Salida masiva:** 9+ superficies UI + sidebar + push deep links leen `athletes` / `selectedAthlete` / ticks.
2. **Entrada de sesión:** `loadAthletes` depende de `session` / `authLoading` / `notify` y del mismo `withAuthLockRetry` que el bootstrap.
3. **Side-effects cruzados:** `loadAthletes` setea `staffParentCoachId` (Library/Settings); delete/resume/assign bump `workoutsRefresh` (Athletes + training).
4. **Escritura externa:** push hook setea selección + `pendingRegistroWorkoutId`; CoachSettings llama `setAthletes`.
5. **Chrome acoplado:** `goCoachView` cierra form; sign-out limpia LS de selected; gate `loadingAthletes` envuelve el main.

Por eso el desglose lo dejó **después** de overlays (invite, picker, push, builder bridge): primero se sacó lo aislado; esto es el hub de datos coach restante antes del corazón auth.

---

## 6) Impacto real: módulos que reciben props desde App

### Reciben `athletes` (o alias)

| Módulo | Prop |
|---|---|
| Dashboard | `athletes` |
| Athletes | `athletes` |
| EvaluationView | `athletes` |
| ChallengesHub | `coachAthletes` |
| CoachSettings | `athletes` (+ `setAthletes`) |
| Plan2Weeks | `athletes` |
| Builder | `athletes` |
| GpxRacePlan | `athletes` |
| WorkoutLibrary | `athletes` |
| Sidebar (inline) | lectura directa |

### Reciben `selectedAthlete` / setters relacionados

| Módulo / sitio | Prop / uso |
|---|---|
| Athletes | `selected={selectedAthlete}`, `onSelect={setSelectedAthlete}` |
| Dashboard | `onSelect` → `setSelectedAthlete` + `setView("athletes")` |
| useCoachPushDeepLinks | `setSelectedAthlete` (no recibe el valor) |

### Otros del bloque C pasados como props

| Prop | Destino |
|---|---|
| `workoutsRefresh` | Athletes |
| `openRegistroWorkoutId` / `onRegistroOpened` | Athletes (`pendingRegistro*`) |
| Form alta (`showAddAthleteForm`, `newAthlete`, …) | Dashboard |
| `staffParentCoachId` | CoachSettings (`isStaff`), WorkoutLibrary (`parentCoachId`) |
| `onDeleteAthlete` | Athletes |
| Sync patches `setAthletes` / `setSelectedAthlete` | Callbacks inline → Athletes |

**Conteo de superficies afectadas por un move a hook:** ~10 destinos de props + 1 hook push + chrome sidebar/gate. El hook **no** reduce props; solo cambia **dónde se declaran**.

---

## 7) Recomendación: ¿hook ahora o diferir?

### Veredicto: **sí conviene extraer ahora a un hook** (`useCoachAthletes` / `useCoachAthletesList`), **antes** de CoachChrome y del bootstrap.

**Por qué no “dejarlo en App porque todos dependen”:**

- La dependencia es de **datos**, no de que el código viva en `App.jsx`. Un hook que App llama y re-exporta vía las mismas props **no rompe** Dashboard/Athletes/etc.
- Diferir no simplifica CoachChrome: el chrome seguiría con `loadAthletes` + CRUD inline (~250–300 líneas) dentro del mismo archivo.
- Encaja el orden del shell-breakdown (paso 5 → luego chrome → AuthGate).

**Cómo acotar el Paso 2 (si se valida):**

1. Hook con los **9 estados** + `loadAthletes` + effects selected + CRUD + `updateNewAthleteField` + helpers de sync (`patchAthleteWorkoutsDone`, `patchAthleteFc`) + `bumpWorkoutsRefresh`.
2. Inputs del hook: `session`, `authLoading`, `notify`, `profile` (límite plan en save).
3. App sigue orquestando: destructuring → mismas props; `useCoachPushDeepLinks` recibe `athletes` / setters del hook.
4. **No** Context. **No** mover Athletes.jsx / Dashboard form UI.
5. Preservar **byte-for-byte** `withAuthLockRetry` + rama staff.
6. Sign-out / `goCoachView`: App llama APIs del hook (`clearSelectedAthlete`, `closeAddForm`) — no meter `handleSignOut` entero en el hook.

**Cuándo diferir (única razón fuerte):** si se quiere un freeze de riesgo total y solo docs; no hay ganancia técnica en “dejar la fuente en App”.

---

## 8) Conteo final a extraer (si se procede)

| Pieza | ~Líneas |
|---|---|
| Const LS + 9 estados | ~15 |
| `updateNewAthleteField` | ~3 |
| `loadAthletes` + effect mount | ~75 |
| Effects selectedAthlete | ~20 |
| Trozo resume (athletes + bump refresh) — o exponer `reloadSilent` y dejar resume en App | ~5–10 |
| `saveNewAthlete` / cancel / `handleDeleteAthlete` | ~85 |
| Helpers sync (hoy inline en JSX) | ~15–25 |
| **Total orientativo** | **~220–300** → `src/hooks/useCoachAthletes.js` |

JSX de vistas **no** se mueve (sigue en App / CoachChrome futuro). Gate `loadingAthletes` puede quedar en App leyendo el flag del hook.

**Destino sugerido:** `src/hooks/useCoachAthletes.js`

```js
const {
  athletes, setAthletes, loadingAthletes,
  selectedAthlete, setSelectedAthlete,
  workoutsRefresh, bumpWorkoutsRefresh, // o setWorkoutsRefresh
  pendingRegistroWorkoutId, setPendingRegistroWorkoutId,
  showAddAthleteForm, setShowAddAthleteForm,
  newAthlete, updateNewAthleteField, planLimitWarning, setPlanLimitWarning,
  staffParentCoachId,
  saveNewAthlete, cancelAddAthleteForm, handleDeleteAthlete,
  onAthleteWorkoutsDoneSync, onAthleteFcSync,
  clearSelectedOnSignOut,
} = useCoachAthletes({ session, authLoading, notify, profile });
```

---

## Riesgos / hallazgos

| Riesgo | Detalle |
|---|---|
| Auth-lock en `loadAthletes` | No “simplificar”; mismo `withAuthLockRetry` / mensajes |
| Staff path | `staffParentCoachId` nace en load — debe quedar en el mismo hook |
| `workoutsRefresh` compartido | Training views solo bumpean; Athletes lee — incluir en el hook o devolver setter |
| `pendingRegistro*` | Estado “de Athletes shell” pero **escrito** por push ya extraído — pasar setter al push hook |
| Form Dashboard vs Invite | **`setShowAddAthleteForm(true)` no existe en el repo.** “＋ Nuevo Atleta” / “Agregar” abren **InviteModal**. El form + `saveNewAthlete` quedan **cableados pero inalcanzables** en UI. Al extraer: **mover igual** (sin cambiar comportamiento); no purgar en este paso salvo decisión explícita |
| Sign-out | Debe seguir limpiando `raf_selected_athlete` y selected |
| Duplicar lista | AthleteHome **no** usa esta lista — no unificar |

---

## Checklist Paso 2

- [x] Crear `useCoachAthletes` con 9 estados + load + CRUD + selected LS + sync helpers
- [x] App: mismo prop drilling; push hook recibe athletes/setters del nuevo hook
- [x] No tocar Plan2Weeks/Builder/Gpx salvo props; no mezclar con `libraryRefresh`
- [ ] Smoke staging: load; delete; deep link registro; assign → Athletes; Settings setAthletes
- [x] Build limpio; auth-lock retry intacto en el hook
- [ ] (Opcional, otro PR) form muerto vs InviteModal
- [x] Fix colateral: `setNativePushPermission` expuesto desde push hook (sign-out lo usaba)
