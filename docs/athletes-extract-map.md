# Mapeo: extracción de Athletes desde App.jsx

Fecha: 2026-08-27  
HEAD de referencia al mapear: tip actual de `master`  
Archivo: `src/App.jsx` (~8973 líneas / ~8537 no vacías)

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 1) Qué es “Athletes” en App.jsx

### A. Componente principal
| Símbolo | Líneas (aprox.) | ~Líneas |
|---|---|---|
| `function Athletes(...)` | 4492–7766 | **~3276** |

Incluye (estado local + UI):
- Listado de atletas (búsqueda, avatares, badges dispositivo/unread, carga semanal)
- Detalle del atleta seleccionado (FC, PDF plan, StatusBadge)
- Calendario mensual de workouts (drag/drop, menú contextual, editar/mover/borrar)
- Chat coach↔atleta
- Carreras (CRUD + menú)
- Pagos del atleta
- Forma/fatiga + análisis IA + modal **Registro** (+ mapa ruta + comparación bloques)
- Deep link `openRegistroWorkoutId` → abre modal Registro
- Borrado por rango de fechas
- Asignación no: la asignación de workouts vive en Biblioteca/Builder; aquí se **gestiona** el calendario ya asignado

**~55 `useState` locales** (workouts, chat, races, payments, registroModal, etc.).

**Supabase (desde Athletes):** `workouts`, `athlete_evaluations`, `races`, `athletes`, `messages`, `athlete_payments`.

**API (`/api/integrations` / otras):** `activity-intervals`, `adjust`, `adjust-steps` (y patrones ya existentes de push/email vía `appShared`).

### B. Helpers / UI solo usados por Athletes (mover junto)
| Símbolo | Líneas | ~Líneas | Notas |
|---|---|---|---|
| `FormaFatigaLineChart` | 501–568 | 68 | Solo Athletes |
| `PDF_*` + `exportAthletePlanToPdf` | 570–911 | ~342 | Solo Athletes |
| `StatusBadge` | 913–917 | 5 | Solo Athletes |
| `AthleteListAvatar` | 4359–4397 | ~39 | Solo Athletes |
| `DeviceConnectionBadges` | 4400–4442 | ~43 | Solo Athletes |
| `UnreadMessagesBadge` | 4445–4474 | ~30 | Solo Athletes |
| `WeeklyLoadLine` | 4477–4490 | ~14 | Solo Athletes |

**Subtotal helpers exclusivos ~541 + Athletes ~3276 ≈ 3817 líneas a extraer.**

### C. Helpers locales de forma/fatiga duplicados
En App.jsx viven también `sessionRpeKmLoad`, `avgRpeKmInWindow`, `computeFormaFatigaWeeklyPoints`, `formaFatigaStatusFromPoint`, `getNextMonday` (~434–498).  
Athletes usa las funciones de forma. **Ya existen equivalentes en** `src/components/shared/appShared.js`.  
En la extracción: **importar desde `appShared`**, no mover duplicados ni dejar dos fuentes.

---

## 2) Dependencias cruzadas (qué depende de qué)

### App → Athletes (props; estado que se queda en App)
| Prop / dato | Dueño | Por qué no entra en Athletes |
|---|---|---|
| `athletes` / `setAthletes` | App | También Dashboard, Plans, Biblioteca, tabs, CRUD atleta |
| `selected` / `onSelect` (`selectedAthlete`) | App | Persistencia `raf_selected_athlete`, deep links push |
| `workoutsRefresh` | App | Lo incrementan Builder / Plan2Weeks / GPX / push sync |
| `openRegistroWorkoutId` / `onRegistroOpened` | App | Deep link `coach_workout_completed` en `applyCoachDeepLink` |
| `onAthleteWorkoutsDoneSync` | App | Actualiza contadores en lista global |
| `onAthleteFcSync` | App | Sincroniza FC en lista global |
| `coachDisplayName` | App | Perfil/sesión |
| `onDeleteAthlete` | App | `handleDeleteAthlete` + lista global |
| `notify` | App | Toast global |
| `onOpenInviteModal` | App | Modal invitar atleta (shell App) |

**Tabs** “Lista / Evaluación / Retos” y el shell de `view === "athletes"` **se quedan en App**; solo el cuerpo `<Athletes …/>` se extrae.

### Athletes → App / resto (lo que Athletes consume pero no posee)
| Dependencia | Origen recomendado en extracción |
|---|---|
| `styles` | Ya en `appShared` (idéntico al local de App) → importar |
| `DAYS` (acentos) | Local en Athletes o constante con acentos (appShared tiene sin acentos) |
| `normalizeWorkoutRow` | **Compartido**: Dashboard + Athletes. Preferir `appShared.normalizeWorkoutRow` o dejar definición en App y exportar/importar |
| `WorkoutStructureTable` | **Compartido**: Athletes + `MarketplacePlanWorkoutsAccordion` → `src/components/shared/WorkoutStructureTable.jsx` |
| `ProgressBar`, `getRaceMeta` | Solo Dashboard → **quedan en App** |
| WeatherWidget, PushToWatchButton, WorkoutDetailBreakdown, WorkoutRouteMap, compareBlocks, fmtPace, jsPDF, supabase | Imports del módulo Athletes |

### No confundir
- **Calendario del atleta (rol athlete)** = `AthleteHome.jsx` (ya separado). No es este split.
- **Chat / calendario / registro** del *coach* están **dentro** de `Athletes` hoy; se mueven con el módulo, no quedan en App.

---

## 3) Conteos y decisión de compartidos

| Bloque | ~Líneas | Destino propuesto |
|---|---|---|
| `Athletes` + helpers exclusivos | **~3817** | `src/components/Athletes.jsx` (archivo único, como el resto del proyecto; no hay carpeta `Athletes/` hoy) |
| `WorkoutStructureTable` | ~40 | `src/components/shared/WorkoutStructureTable.jsx` |
| Forma compute (si aún locales) | ~65 | Borrar locales; usar `appShared` |
| `normalizeWorkoutRow` | ~45 | Preferir `appShared` (Dashboard + Athletes) |
| `ProgressBar` + Dashboard/Admin/Plans | ~4700+ | Permanecen en App.jsx |
| Shell App (auth, nav, deep links, lista `athletes`) | ~2900 | Permanecen en App.jsx |

**Tras extracción estimada:** App.jsx ~8973 − ~3817 − ~40 (table) ≈ **~5100 líneas** (orden de magnitud).

### Patrón de estado compartido (propuesta)
**Prop drilling (props actuales), sin Context.**

Justificación:
- El contrato App↔Athletes ya es estable (~10 props).
- La lista `athletes` / selección / `workoutsRefresh` / deep-link de registro son del shell.
- Context añadiría indirection sin reducir props reales en este paso.
- El intento revertido (`58c59f3` / `98cbac7`) falló por rangos/imports rotos, no por falta de Context — hay que repetir con rangos verificados + build/eslint antes de push.

### Riesgos (del intento anterior)
1. Cortar mid-comentario / dejar `};` huérfano.
2. Mover `WorkoutStructureTable` sin dejar import en Marketplace accordion.
3. Importar `DAYS` sin acentos desde appShared (cambio visual en calendario).
4. Circular imports App ↔ Athletes.
5. Extraer sin pasar `openRegistroWorkoutId` (rompe deep link de push).

### Plan de commits (acordado)
1. **Este documento** (mapeo) — commit ahora, sin tocar runtime.
2. Extracción real — solo tras tu OK al mapeo.
3. Push de extracción tras build + smoke coach Atletas.

---

## Checklist de validación (post-extracción, no ahora)
- [ ] `npm run build` OK  
- [ ] ESLint sin imports rotos en Athletes / App / WorkoutStructureTable  
- [ ] Coach: lista, detalle, calendario, chat, Ver registro, deep link push  
- [ ] Marketplace “Ver plan” sigue mostrando estructura (tabla compartida)
