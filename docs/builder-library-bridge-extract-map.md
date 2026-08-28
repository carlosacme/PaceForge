# Mapeo: Builder / Library bridge en App.jsx

Fecha: 2026-08-28  
HEAD de referencia: `968a8ed` (`refactor: extract coach push/FCM and deep links into hook`)  
Archivo: `src/App.jsx` (~1367 líneas)  
Contexto: `docs/shell-breakdown-map.md` §3 paso **#4** (Builder/Library bridge)

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 1) ¿Qué es el “puente”?

**No es un componente ni una query.** Es **estado levantado en App** + **callbacks de cableado** entre dos módulos ya extraídos:

| Dirección | Qué ocurre |
|---|---|
| **Library → Builder** | `onUseWorkout(row)` → `libraryRowToBuilderWorkout(row)` → `setAiWorkout(…)` + `setView("builder")` + toast |
| **Builder → Library** | Tras guardar en biblioteca: `onSavedToLibrary` → `setLibraryRefresh(r => r+1)` (invalida listas en `WorkoutLibrary`) |
| **GpxRacePlan → Library** | Mismo tick `onSavedToLibrary` → `libraryRefresh` (no usa `ai*`) |

También es **ligeramente navegación**: saltar a la vista `builder` al “usar” un workout de la library. El resto del routing (tabs Entrenamientos / nav) **no** pertenece a este bridge: es chrome (`view` / `selectTrainingTab`).

**No** hay JSX propio del bridge (sin overlay). Solo declaraciones de estado (~L115–118) y props en el `return` (~L1260–1315).

---

## 2) Estado, efectos, Supabase

### Los 4 estados (dueños del bridge)

| Estado | Línea | Tipo | Rol |
|---|---|---|---|
| `aiPrompt` | 115 | `usePersistedState("raf_gen_prompt", "")` | Texto del generador IA (sobrevive refresh) |
| `aiWorkout` | 116 | `useState(null)` | Draft del workout (IA, manual, o cargado desde library) |
| `aiLoading` | 117 | `useState(false)` | Busy generación IA |
| `libraryRefresh` | 118 | `useState(0)` | Contador para forzar reload en Library |

### Efectos en App sobre estos 4

**Ninguno.** No hay `useEffect` que lea/escriba `ai*` o `libraryRefresh` en App.

Los efectos de carga viven **dentro** de `WorkoutLibrary` (`useEffect` deps incluyen `libraryRefresh`) y la generación IA vive **dentro** de `Builder`.

### Queries Supabase en el bridge (App)

**Ninguna.** App solo pasa setters/callbacks. Las queries (workouts library, generate, insert) están en Builder / WorkoutLibrary / GpxRacePlan / appShared.

Helper usado en el cableado: `libraryRowToBuilderWorkout` desde **appShared** (también lo importa Builder e AthleteHome).

---

## 3) Relación con módulos ya extraídos

| Módulo | Relación con el bridge |
|---|---|
| **Builder.jsx** | Consume los 3 `ai*` (+ setters) y llama `onSavedToLibrary` / `onWorkoutAssigned`. Ya tiene WST consolidado; **no** hay que re-extraer Builder. |
| **WorkoutLibrary.jsx** | Consume `libraryRefresh`; emite `onUseWorkout`, `onCopiedGlobalToLibrary`, `onAfterLibraryImportSuccess` (también bumpea refresh). Incluye accordion marketplace **interno** — no es estado App. |
| **GpxRacePlan.jsx** | Solo `onSavedToLibrary` → mismo `libraryRefresh` (puente Library, no Builder). |
| **MarketplaceHub / accordion** | Independientes del bridge App; Market admin draft se abre con `setView("admin")` (nav shell). |
| **appShared** | `libraryRowToBuilderWorkout` — no duplicar. |

---

## 4) Builder vs Library vs Plan2Weeks

```
Nav "Entrenamientos" (chrome)
├── tabs: Plan 2 Semanas | Crear Workout IA | Carrera GPX   ← UI compartida de sección
│   ├── Plan2Weeks     → onPlanAssigned → workoutsRefresh (lista atletas / badges)
│   ├── Builder        → ai* + onSavedToLibrary → libraryRefresh
│   └── GpxRacePlan    → onSavedToLibrary → libraryRefresh
└── (nav aparte) Library → libraryRefresh + onUseWorkout → aiWorkout + view=builder
```

| Pieza | ¿Parte del bridge Builder↔Library? |
|---|---|
| **Builder** | **Sí** (estado `ai*`) |
| **Library** | **Sí** (`libraryRefresh` + `onUseWorkout`) |
| **GpxRacePlan** | **Parcial** (escribe el mismo tick Library; no toca `ai*`) |
| **Plan2Weeks** | **No.** Solo comparte la **sección de tabs** de entrenamiento y el tick **`workoutsRefresh`** (otro estado, dueño Athletes/shell). No lee ni escribe `ai*` / `libraryRefresh`. |

Al extraer el bridge: **no mover Plan2Weeks** ni su `onPlanAssigned`. Opcional: incluir el callback `onSavedToLibrary` de Gpx en el mismo hook porque comparte `libraryRefresh`.

---

## 5) Dependencias App ↔ bridge

### Diseño recomendado: hook `useBuilderLibraryBridge`

**App → hook:** nada de sesión (o solo `notify` / `setView` para `onUseWorkout`).

**Hook → App (API sugerida):**

| Retorno | Uso |
|---|---|
| `aiPrompt`, `setAiPrompt`, `aiWorkout`, `setAiWorkout`, `aiLoading`, `setAiLoading` | Props Builder |
| `libraryRefresh` | Prop Library |
| `bumpLibraryRefresh` | `onSavedToLibrary`, copy/import |
| `useLibraryWorkout(row)` | `onUseWorkout` (convierte + `setView("builder")` + notify) |

**Props que cruzan hoy (solo el bridge, no el resto de Builder):**

| Dirección | Qué |
|---|---|
| App → Builder | 6: `aiPrompt` / setters / `aiWorkout` / `aiLoading` + `onSavedToLibrary` |
| App → Library | 2: `libraryRefresh` + `onUseWorkout` (+ bumps en copy/import) |
| App → Gpx | 1: `onSavedToLibrary` |
| Builder/Library → App | Solo vía esos callbacks (sin Context) |

El resto de props de Builder/Library (`athletes`, `notify`, `coachUserId`, `onGoToPlans`, …) son **shell**, no del bridge.

Prop drilling sigue siendo adecuado (~handlers en un hook).

---

## 6) Riesgos

| Riesgo | Detalle |
|---|---|
| Confundir con `workoutsRefresh` | Tick distinto: invalidar workouts de atletas / Dashboard / Athletes. Plan2Weeks y Builder `onWorkoutAssigned` lo usan. **No** meterlo en este extract. |
| `aiPrompt` persistido | Clave `raf_gen_prompt`; al mover el hook, seguir con `usePersistedState` igual. |
| `onUseWorkout` cambia `view` | El hook necesita `setView` + `notify` del shell. |
| Código muerto | Ninguno claro en estos 4 estados: los tres `ai*` los usa Builder; `libraryRefresh` lo leen Library (+ bumps desde Builder/Gpx/import). |
| Duplicación | `libraryRowToBuilderWorkout` ya en appShared — el bridge solo lo llama. |
| AthleteHome | Importa el helper por su cuenta; **no** depende del estado App del bridge. |
| Extraer “TrainingViews” entero | Alcance mayor (tabs + Plan2Weeks + Gpx JSX). El paso 4 del shell era solo el **estado puente**; no mezclar con chrome completo. |

---

## 7) Conteo final a extraer

| Pieza | ~Líneas |
|---|---|
| 4× estado (`ai*` + `libraryRefresh`) | 4 |
| Callbacks inline (`onSavedToLibrary`, `onUseWorkout`, bumps) | ~15–20 |
| **Total orientativo** | **~20–30** (hook pequeño) |

No se mueven Builder.jsx / WorkoutLibrary.jsx / Plan2Weeks.jsx (ya módulos).

**Destino sugerido:** `src/hooks/useBuilderLibraryBridge.js`

Wire mínimo en App:

```jsx
const {
  aiPrompt, setAiPrompt, aiWorkout, setAiWorkout, aiLoading, setAiLoading,
  libraryRefresh, bumpLibraryRefresh, useLibraryWorkout,
} = useBuilderLibraryBridge({ setView, notify });

// Builder: ai* + onSavedToLibrary={bumpLibraryRefresh}
// Library: libraryRefresh + onUseWorkout={useLibraryWorkout}
// Gpx: onSavedToLibrary={bumpLibraryRefresh}
```

---

## Checklist Paso 2 (cuando se valide)

- [ ] Crear hook con los 4 estados + bump + useLibraryWorkout
- [ ] Cablear Builder / Library / Gpx; dejar Plan2Weeks con `workoutsRefresh`
- [ ] Smoke: generar IA → guardar a library → lista refresca; “Usar” en library → abre Builder con draft; Gpx save refresca library
- [ ] Build limpio; `raf_gen_prompt` sigue persistiendo
