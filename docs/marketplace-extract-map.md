# Mapeo: extracción de MarketplacePlanWorkoutsAccordion desde App.jsx

Fecha: 2026-08-27  
HEAD de referencia: `d2e0c2f` (`docs: mapeo v2 de lo que queda por extraer de App.jsx`)  
Archivo origen: `src/App.jsx`  
Contexto: `docs/app-extract-map-v2.md` §3 orden #1  

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 1) Qué es el bloque

### A. Componente principal
| Símbolo | Líneas (1-based, inclusivas) | ~Líneas |
|---|---|---|
| Comentario JSDoc + `function MarketplacePlanWorkoutsAccordion(...)` | **4170–4366** | **197** |
| Solo la función (sin JSDoc) | 4171–4366 | 196 |

Incluye (todo **dentro** de la misma función; no hay helpers top-level hermanos):
- Agrupación de `previewWorkouts` por `week` (`useMemo` → `weekGroups`, `week1Groups`, `lockedWeekGroups`)
- Acordeón interactivo (una semana abierta a la vez)
- Modo **`lockAfterWeek1`**: semana 1 editable/visible; resto blur + overlay 🔒 (“Muestra gratuita”)
- Cards de sesión: día, título, descripción, meta (pace / km / min)
- Estructura de pasos vía `readStructure(w)` + **`WorkoutStructureTable` shared**
- Empty state: “No hay muestra de workouts.”

**No hay** funciones/componentes auxiliares top-level en App.jsx exclusivos de este bloque.  
`renderSessionCard`, `renderInteractiveWeek`, `renderLockedWeek` son closures internas.

### B. Estado local
| Hook | Cantidad | Detalle |
|---|---|---|
| `useState` | **1** | `openWeeks` (`Set` de week keys; init `{1}`) |
| `useEffect` | **1** | Reset de `openWeeks` cuando cambian `resetKey` / `previewWorkouts` / `lockAfterWeek1` |
| `useMemo` | **3** | `weekGroups`, `week1Groups`, `lockedWeekGroups` |
| `useCallback` / `useRef` | 0 | — |

**Sin** Supabase, **sin** `fetch`, **sin** queries. Datos 100% vía props.

### C. Props del componente (API pública)
| Prop | Tipo | Default | Quién la pasa |
|---|---|---|---|
| `previewWorkouts` | array (filas de workout de plan) | — (tratado como `[]`) | `WorkoutLibrary` / `MarketplaceHub` (tras `getMarketplacePlanWorkoutRows(plan)`) |
| `resetKey` | any (típicamente `plan.id`) | — | Idem; fuerza re-apertura de semana al cambiar de plan |
| `lockAfterWeek1` | boolean | `false` | Solo MarketplaceHub (preview compra); Library y plan comprado usan `false` |

**App.jsx no pasa estas props.** App solo **inyecta el constructor** del componente:

```jsx
<WorkoutLibrary … MarketplacePlanWorkoutsAccordion={MarketplacePlanWorkoutsAccordion} />
<MarketplaceHub … MarketplacePlanWorkoutsAccordion={MarketplacePlanWorkoutsAccordion} />
```

No hay lista de planes, coach id, ni callbacks hacia App desde el accordion.

---

## 2) Dependencias compartidas

| Dependencia | Origen | ¿Athletes? | Notas |
|---|---|---|---|
| `WorkoutStructureTable` | `src/components/shared/WorkoutStructureTable.jsx` | No (Athletes también lo importa; mismo módulo) | Ya consolidado |
| `readStructure` | `src/lib/workoutStructure` | No | También usado en App `normalizeWorkoutRow` y en MarketplaceHub |
| React hooks | `react` | — | — |
| `appShared` | — | **No** | El accordion **no** importa `appShared` |
| `Athletes.jsx` | — | **No** | Cero acoplamiento |
| `getMarketplacePlanWorkoutRows` | `appShared` | — | Lo usan **Library/Hub**, no el accordion |

Tras mover el accordion, App podría **dejar de importar** `WorkoutStructureTable` (hoy solo se usa aquí). `readStructure` **sigue** haciendo falta en App por `normalizeWorkoutRow`.

---

## 3) Quién monta el accordion (call sites)

| Sitio | Archivo | Uso | `lockAfterWeek1` |
|---|---|---|---|
| Coach Biblioteca → modal plan marketplace | `WorkoutLibrary.jsx` ~982 | Preview “Entrenos de muestra” | omitido → `false` |
| Coach/Admin Marketplace → modal plan | `MarketplaceHub.jsx` ~607 | “Contenido del plan” pre-compra | `true` si no admin/owner |
| Marketplace → plan ya comprado | `MarketplaceHub.jsx` ~638 | Acceso completo | `false` |
| **Atleta** Marketplace | `AthleteHome.jsx` ~1919 | Pasa **otra copia local** del componente a `MarketplaceHub` | según Hub |

### Copia divergente en AthleteHome (riesgo / deuda)
`AthleteHome.jsx` L151–248 (~98 líneas) define **otro** `MarketplacePlanWorkoutsAccordion`:
- **No** usa `WorkoutStructureTable` ni `readStructure` (no muestra estructura de bloques)
- Lock UX distinto (botón disabled + 🔒; no blur overlay ni sección “Muestra gratuita · Semana 1”)
- Empty copy distinta (“No hay workouts en este plan.”)
- `useEffect` de reset más simple (no recalcula default week desde la lista)

**No es idéntica** a la de App. El Paso 2 de *esta* extracción puede:
- **Mínimo:** sacar la de App → shared; Library + Hub (vía App) importan shared; AthleteHome sigue con su copia hasta un follow-up.
- **Recomendado en el mismo PR o inmediato después:** AthleteHome también importa shared (aceptando el look App: cards + estructura + blur). Unificar evita dos UIs de “Ver plan”.

---

## 4) Qué se mueve vs qué queda en App

### Se mueve
| Pieza | Destino propuesto |
|---|---|
| JSDoc + `MarketplacePlanWorkoutsAccordion` (4170–4366) | p.ej. `src/components/shared/MarketplacePlanWorkoutsAccordion.jsx` (o `src/components/Marketplace/…`) |
| Imports propios | `react`, `readStructure`, `WorkoutStructureTable` |

### Se actualiza (wiring, sin lógica de negocio)
| Archivo | Cambio |
|---|---|
| `App.jsx` | Borrar función; quitar prop `MarketplacePlanWorkoutsAccordion={…}` a Library/Hub; quitar import `WorkoutStructureTable` si queda huérfano |
| `WorkoutLibrary.jsx` | `import MarketplacePlanWorkoutsAccordion from "./shared/…"`, quitar prop del signature |
| `MarketplaceHub.jsx` | Idem |
| (Opcional) `AthleteHome.jsx` | Borrar copia local; import shared; dejar de pasar el componente como prop |

### Se queda en App
- Shell auth/nav/tabs, `athletes`, deep links, etc.
- Resto de Admin/Dashboard/Plans
- `readStructure` (por `normalizeWorkoutRow`)
- Lazy mount de `WorkoutLibrary` / `MarketplaceHub` **sin** inyectar el accordion

---

## 5) App ↔ accordion: props y patrón de estado

| Dirección | Qué cruza hoy | Tras extracción |
|---|---|---|
| App → Library/Hub | **1 prop:** el componente mismo | **0** (import directo) |
| App → Accordion | **0** datos | 0 |
| Accordion → App | nada | nada |
| Library/Hub → Accordion | `previewWorkouts`, `resetKey`, `lockAfterWeek1` | igual (prop drilling **corto**, 3 props) |

**Conclusión:** seguir con **prop drilling** en los call sites reales (Library/Hub).  
**No** hace falta Context: el accordion no comparte estado con Athletes/Builder; no lee coaches ni atletas.  
El antipatrón actual es inyectar el **tipo** componente desde App; la extracción lo elimina.

---

## 6) Conteo final y riesgos

### Líneas a extraer
| Concepto | ~Líneas |
|---|---|
| Bloque App (JSDoc + función) | **197** |
| Auxiliares top-level exclusivos | **0** |
| **Total move desde App** | **~197** |
| (Follow-up) copia AthleteHome a eliminar | ~98 |

App.jsx tras el move: ~4981 − 197 ≈ **~4784** (orden de magnitud), más limpieza de 1–2 líneas de wiring/`WorkoutStructureTable` import.

### Riesgos / casos raros
1. **Doble implementación AthleteHome** — si solo se mueve App, coach y atleta ven UIs distintas en Marketplace “Ver plan” (estructura sí/no). Documentar en PR; preferible unificar.
2. **`lockAfterWeek1`** — lógica de blur/semana 1 es la diferencia vs Library; smoke coach: plan ajeno (locked) vs propio/admin (unlocked) vs comprado (unlocked).
3. **`resetKey`** — al cambiar de plan en el modal debe colapsar/reabrir semana correcta; no olvidar en smoke.
4. **Semana `0`** (“Sin número de semana”) — workouts sin `week` válido; el sort los manda al final.
5. **No hay queries compartidas** con Athletes/Builder — cero riesgo de RLS/doble fetch.
6. **No usar** el accordion de AthleteHome como “fuente de verdad” al consolidar: es más pobre (sin estructura). Shared = versión **App**.
7. Cortar mal el rango (dejar `function AdminPanel` roto) — validar que L4368 sigue siendo `AdminPanel`.

---

## 7) Plan de commits (acordado)

1. **Este documento** — commit + push ahora, sin runtime.  
2. **Paso 2 extracción** — tras tu OK: módulo shared + imports en Library/Hub (+ opcional AthleteHome) + quitar de App.  
3. Build + smoke Marketplace/Library (y atleta Marketplace si se unifica).

---

## Checklist post-extracción (Paso 2, no ahora)

- [ ] `npm run build` OK  
- [ ] App ya no define ni pasa `MarketplacePlanWorkoutsAccordion`  
- [ ] App ya no importa `WorkoutStructureTable` (si no hay otros usos)  
- [ ] Coach Library: modal plan muestra acordeón + **estructura** (pills)  
- [ ] Coach Marketplace: preview con `lockAfterWeek1` (semana 1 libre, resto blur)  
- [ ] Plan comprado / owner / admin: sin lock  
- [ ] (Si unificado) Athlete Marketplace: mismo componente shared  
- [ ] Sin imports circulares App ↔ shared ↔ Hub  
