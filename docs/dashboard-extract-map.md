# Mapeo: extracción de Dashboard desde App.jsx

Fecha: 2026-08-27  
HEAD de referencia: `7cb4797` (`fix: retry auth lock contention when loading profile and athletes`)  
Archivo origen: `src/App.jsx` (~3995 líneas / ~3824 no vacías)  
Contexto: `docs/app-extract-map-v2.md` §3 orden **#4** (Plans #3 quedó supersedido)

**Estado:** **EXTRAÍDO** → `src/components/Dashboard.jsx` (atletas consolidados desde shell; workouts propios + auth-lock retry).

---

## 1) Estructura y rangos exactos

### A. Componente principal
| Símbolo | Líneas (1-based inclusivas) | ~Líneas |
|---|---|---|
| `function Dashboard(...)` | **3512–3962** | **451** |

Un solo componente top-level (no pack multi-archivo como Admin). Inmediatamente después: `const styles = { … }` (chrome del shell) — **no** forma parte de Dashboard.

### B. Auxiliares fuera del rango de Dashboard
`ProgressBar` y `getRaceMeta` **no** están dentro de `function Dashboard`. Son helpers top-level en el prelude de App:

| Símbolo | Líneas | ~Líneas | ¿Quién lo usa en App? |
|---|---|---|---|
| `MONTH_INDEX` | **132–135** | 4 | Solo `getRaceMeta` / `getRaceCountdownText` locales |
| `getRaceMeta` | **164–182** | 19 | **Solo Dashboard** (`athleteRows`) |
| `ProgressBar` | **338–342** | 5 | **Solo Dashboard** (columna adherencia) |
| `getRaceCountdownText` (local App) | **137–161** | ~25 | **Nadie** en App (muerto; AthleteHome importa el de `appShared`) |

**Recomendación de extracción:** mover `ProgressBar` + `getRaceMeta` (+ `MONTH_INDEX` si no se importa de otro lado) **junto con** Dashboard (mismo archivo o `Dashboard/` helpers). No dejarlos en App “por si acaso”.

### C. Relación con el shell
```
App (view === "dashboard")
  └─ <Dashboard
        coachUserId
        onSelect / onRequestAddAthlete
        showAddAthleteForm / newAthlete + handlers
        planLimitWarning / onGoToPlans / onDismissPlanLimitWarning
     />
```

`onGoToPlans` **hoy** (post-fix Plans → picker canónico):

```jsx
onGoToPlans={() => setCoachPlanPickerVoluntary(true)}
```

**No** navega a `view === "plans"` (esa vista ya no existe). El botón “Ver Planes” del banner de límite de atletas abre el overlay de suscripción del shell. El mapeo refleja este estado, no el previo a `54107ea`.

---

## 2) Estado local, efectos, Supabase y props

### Hooks dentro de Dashboard
| Hook | Cantidad | Detalle |
|---|---|---|
| `useState` | **3** | `dashAthletes`, `weekWorkouts`, `dashLoading` |
| `useMemo` | **6** | `weekStart`, `weekEnd`, `weekRangeLabel`, métricas RPE/adherencia, `athleteRows`, `maxWeeklyKm` |
| `useCallback` | **1** | `loadDashboardData` |
| `useEffect` | **1** | monta / refresca al cambiar `loadDashboardData` |
| `useAppResumeRefresh` | **1** | reload silencioso al volver a la app |

Coincide con el inventario v2 (3 `useState`).

### Queries Supabase (propias del Dashboard)
| Tabla | Uso |
|---|---|
| `coach_staff` | `staff_id` del coach → incluir atletas/workouts del staff en el panel |
| `athletes` | `.in("coach_id", allCoachIds)` → `dashAthletes` (via `normalizeAthlete`) |
| `workouts` | semana actual (`scheduled_date` entre lunes–domingo) → `weekWorkouts` (via `normalizeWorkoutRow` **local de App**) |

**No** usa el array `athletes` del shell para la tabla semanal: carga propia → **doble fuente de verdad** vs lista global de App (ya anotado en v2).

Sin RPCs. Sin `/api/*`. Sin Wompi.

### Props desde App (App → Dashboard)
| Prop | Dirección | Rol |
|---|---|---|
| `coachUserId` | ↓ | Filtro Supabase / resume |
| `onSelect` | ↓ (callback ↑ efecto) | Click fila → `setSelectedAthlete` + `setView("athletes")` |
| `onRequestAddAthlete` | ↓ | Abre modal invitación del shell (`inviteModalOpen`) |
| `showAddAthleteForm` | ↓ | Muestra form embebido |
| `planLimitWarning` | ↓ | Banner límite plan Básico |
| `onGoToPlans` | ↓ | **Picker canónico** (`setCoachPlanPickerVoluntary(true)`) |
| `onDismissPlanLimitWarning` | ↓ | Limpia `planLimitWarning` |
| `newAthlete` | ↓ | Campos del form |
| `onChangeNewAthleteField` | ↓ | |
| `onSaveNewAthlete` | ↓ | `saveNewAthlete` en App (límite 15 + insert) |
| `onCancelAddAthlete` | ↓ | |

**11 props**, todas App → Dashboard (callbacks incluidos). Dashboard no expone estado hacia arriba salvo vía esos callbacks.

**Form “Nuevo Atleta”:** UI en Dashboard; estado (`newAthlete`, `showAddAthleteForm`) y persistencia (`saveNewAthlete`) en App. Prop drilling sigue siendo razonable para Paso 2 (mismo patrón Athletes).

---

## 3) Compartido con módulos extraídos / appShared

| Dependencia | ¿Dashboard la usa? | Notas para extracción |
|---|---|---|
| `Athletes.jsx` | **No** (código) | Solo navega vía `onSelect` |
| `WorkoutStructureTable` | **No** | — |
| `MarketplacePlanWorkoutsAccordion` | **No** | — |
| Admin pack | **No** | — |
| `appShared.normalizeAthlete` | **Sí** (ya importado en App) | Seguir importando desde appShared |
| `appShared.sumWeekKm` / `formatLocalYMD` / `startOfWeekMonday` / `addDays` | **Sí** | Idem |
| `appShared.normalizeWorkoutRow` | **No hoy** | Dashboard usa el **`normalizeWorkoutRow` local de App** (L249–287). Athletes / AthleteHome / ChallengesHub ya usan **appShared**. En extracción: **importar appShared**, no mover el duplicado local con Dashboard |
| `appShared.styles` | Hoy **no** | Cierra sobre `styles` local de App → en extract: `import { styles } from …appShared` |
| `appShared.getRaceCountdownText` | **No** | Existe en appShared; Dashboard usa `getRaceMeta` (solo App). Opcional: añadir `getRaceMeta` a appShared en el extract o dejarlo junto a Dashboard |
| `useAppResumeRefresh` | **Sí** | El módulo extraído debe importar el hook |
| `coachTrialDaysRemainingFromStart` | **No** | — |

**Función usada también fuera de Dashboard (lección Admin):**  
`normalizeWorkoutRow` local de App también se pasa a `ChallengesHub` desde el shell (`normalizeWorkoutRow={normalizeWorkoutRow}` ~L3030). **No mover ese helper “solo con Dashboard”** ni borrarlo de App sin actualizar ChallengesHub → preferir **unificar a `appShared.normalizeWorkoutRow`** (Athletes ya lo hace).

`ProgressBar` / `getRaceMeta`: **exclusivos** de Dashboard → seguros de mover.

---

## 4) Cambio reciente Plans → picker (confirmado)

| Antes (pre-`54107ea`) | Ahora (HEAD mapeado) |
|---|---|
| `onGoToPlans={() => setView("plans")}` | `onGoToPlans={() => setCoachPlanPickerVoluntary(true)}` |
| Vista `Plans` + checkout legacy | Vista eliminada; promo/Wompi en picker canónico |

El prop **sigue llamándose** `onGoToPlans` (nombre legacy); el comportamiento es abrir el picker. En Paso 2 se puede renombrar a `onOpenPlanPicker` (opcional, cosmético) o dejar el nombre para diff mínimo.

Este documento **no** describe un mount a `view === "plans"`.

---

## 5) Dependencias App ↔ Dashboard y prop drilling

| Métrica | Valor |
|---|---|
| Props que cruzan | **11** (todas App → Dashboard) |
| Estado de formulario atleta | App |
| Datos métricas semana | Dashboard (local Supabase) |
| Toast / sesión / invite modal | App |

**Conviene seguir con prop drilling** en el extract: el formulario y el límite de plan están acoplados a handlers del shell; un Context solo para Dashboard no aporta. Mismo criterio que Athletes / Admin.

---

## 6) Riesgos y casos raros

1. **Doble lista de atletas:** shell `athletes` vs `dashAthletes`. Tras alta/borrado, el panel solo se alinea al remount, cambio de `coachUserId`/semana, o resume — no escucha `athletes` del padre.
2. **`normalizeWorkoutRow` duplicado:** local App vs appShared; ChallengesHub aún recibe el local. Unificar en extract.
3. **`getRaceCountdownText` local muerto** (L137–161): AthleteHome usa appShared. Candidato a borrar en limpieza prelude (no bloquea Dashboard).
4. **`MONTH_INDEX` duplicado** en App y appShared.
5. **Sin retry de auth-lock** en `loadDashboardData` (a diferencia de `loadAthletes` / perfil). Contención multi-tab podría fallar en silencio (`console.error` alone). Opcional en Paso 2: reutilizar `withAuthLockRetry`.
6. **`styles` local** vs `appShared.styles` — no acoplar extract al objeto local de App.
7. Código FIT (`mapFitWorkoutType`, etc.) en prelude: **no** lo usa Dashboard; no mover con él.
8. `rpeBandMeta` local: **no** referenciado por Dashboard (ni por grep en App salvo definición).

---

## 7) Conteo final a extraer

| Pieza | ~Líneas |
|---|---|
| `Dashboard` (3512–3962) | **451** |
| `ProgressBar` | **5** |
| `getRaceMeta` | **19** |
| `MONTH_INDEX` (si viaja con getRaceMeta y no se reutiliza appShared) | **4** |
| **Total recomendado** | **~475–479** |

Alineado con v2 (“Dashboard + ProgressBar/getRaceMeta ≈ 460+”).  
**No** incluir en el paquete Dashboard: `normalizeWorkoutRow` local, `getRaceCountdownText` muerto, `styles` del shell, helpers FIT.

### Archivo destino sugerido (Paso 2)
`src/components/Dashboard.jsx` (o `src/components/Dashboard/index.jsx` + helpers locales).  
Wire: `import Dashboard from "./components/Dashboard"`; mount en `view === "dashboard"` sin cambiar el contrato de props (salvo unificar `normalizeWorkoutRow` vía appShared **dentro** del módulo).

---

## Checklist Paso 2 (cuando se valide)

- [ ] Extraer Dashboard + ProgressBar + getRaceMeta
- [ ] Importar `styles`, fechas, `normalizeAthlete`, `sumWeekKm`, `normalizeWorkoutRow` desde appShared
- [ ] Confirmar “Ver Planes” sigue abriendo el picker canónico
- [ ] Smoke: métricas semana, click atleta → vista Athletes, form nuevo atleta, banner límite
- [ ] Build limpio; opcional: `withAuthLockRetry` en `loadDashboardData`
