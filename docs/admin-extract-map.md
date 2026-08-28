# Mapeo: extracción del pack Admin (Panel + Promo + Coaches) desde App.jsx

Fecha: 2026-08-27  
HEAD de referencia: `60a025b` (`refactor: extract shared MarketplacePlanWorkoutsAccordion`)  
Archivo origen: `src/App.jsx` (~4781 líneas)  
Contexto: `docs/app-extract-map-v2.md` §3 orden #2  

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 1) Estructura: tres componentes separados (+ uno ya externo)

**No es un solo componente con secciones.** En App.jsx hay **tres funciones top-level** distintas, y un cuarto panel **ya extraído**:

| Sub-bloque | Símbolo | Líneas (1-based inclusivas) | ~Líneas |
|---|---|---|---|
| **Coaches** | `function AdminCoachesProfilesPanel` | **3773–4165** | **393** |
| **Panel** (shell de tabs) | `function AdminPanel` | **4168–4194** | **27** |
| **Promo** | `function AdminPromoCodes` | **4196–4416** | **221** |
| Marketplace (admin) | `AdminMarketplacePanel` | ya en `src/components/AdminMarketplacePanel.jsx` | lazy desde App |

**Total a mover desde App (Panel+Promo+Coaches): 3773–4416 ≈ 644 líneas** (incluye blanks entre funciones; ~641 útiles como en v2).

Orden físico en el archivo hoy: **Coaches → Panel → Promo** (Panel en el medio aunque sea el “padre” de tabs). Tras extracción conviene `Admin/AdminPanel.jsx` como entrada y los hijos al lado.

### Relación entre ellos
```
App (gate admin)
  └─ <AdminPanel notify adminUserId />
        ├─ tab "promo"        → AdminPromoCodes(notify)
        ├─ tab "marketplace"  → AdminMarketplacePanel(notify, styles)  [lazy, ya módulo]
        └─ tab "coaches"      → AdminCoachesProfilesPanel(notify, adminUserId)
```

Los tres hijos **no se importan entre sí** salvo vía `AdminPanel`. No comparten estado React.

---

## 2) Detalle por sub-bloque

### A. `AdminPanel` (tabs) — L4168–4194 (~27)

| Métrica | Valor |
|---|---|
| `useState` | **1** — `adminTab` (`"promo"` \| `"marketplace"` \| `"coaches"`) |
| `useEffect` | **1** — persiste `raf_admin_tab` en `localStorage` |
| `useMemo` / Supabase | 0 / ninguno |

**Props desde App:**
| Prop | Origen en App |
|---|---|
| `notify` | toast del shell |
| `adminUserId` | constante `PLATFORM_ADMIN_USER_ID` (appShared) |

Pasa `notify` a los tres hijos; `adminUserId` solo a Coaches; `styles` (closure App) solo a `AdminMarketplacePanel`.

**Gate en App (no se mueve con el pack, se queda en shell):**  
`view === "admin" && (profile?.role === "admin" \|\| sessionEmailLower === ADMIN_EMAIL)`.

---

### B. `AdminPromoCodes` — L4196–4416 (~221)

| Métrica | Valor |
|---|---|
| `useState` | **4** — `rows`, `loading`, `form`, `saving` |
| `useEffect` | **1** — `loadRows` al montar |
| `useCallback` | **1** — `loadRows` |

**Supabase:** tabla `promo_codes`  
- `select *` orden `created_at` desc  
- `insert` (crear código)  
- `update` `{ active }` (activar/desactivar)

**Props:** solo `notify`.  
**UI:** form crear código + lista con toggle activo.  
**Consumidor de negocio:** vista `Plans` (aún en App) aplica códigos en checkout; no hay otro `promo_codes` en `src/components/` hoy.

**Dependencias de closure App:** `styles` (`S.page`, `S.pageTitle`, `S.card`), `supabase`, React.

---

### C. `AdminCoachesProfilesPanel` — L3773–4165 (~393)

| Métrica | Valor |
|---|---|
| `useState` | **7** — `rows`, `emailByUserId`, `generationsByCoachId`, `loadingGenerations`, `loading`, `busyKey`, `activateMonthsChoice` |
| `useEffect` | **1** — `load()` |
| `useMemo` | **1** — `monthKey` vía `getCurrentMonthKey()` |
| `useCallback` | **1** — `load` |

**Supabase:**
| Tabla | Uso |
|---|---|
| `profiles` | listar `role=coach`; `update` plan_status / subscription_* / trial / validated |
| `coach_profiles` | emails de respaldo si faltan en `profiles` |
| `ai_generations` | conteo del mes; `delete` reset por coach+month |

**Props:** `notify`, `adminUserId` (escrito en `plan_validated_by` al activar).

**Helpers internos** (closures, no top-level): `planBadge`, `subscriptionDaysRemainingCol`, `validatedCol`, `chosenPlanBadge`, `subscriptionPeriodLabel`, `formatSubscriptionAmountCop`, `addCalendarMonths`, `runAction`, `activateCoachWithMonths`, `blockCoachProf`, `resetTrial`, `resetCoachGenerations`.

**Dependencias de closure App (críticas):**
| Símbolo | Dónde vive hoy | ¿Solo Admin? |
|---|---|---|
| `styles` | fin de `App.jsx` | No — shell/Dashboard/Plans también |
| `getCurrentMonthKey` | **local** App L191–195 (también export en `appShared`) | AdminCoaches + duplicado con Builder/Plan2 vía appShared |
| `coachTrialDaysRemainingFromStart` | App L353–358 | **No** — también trial banner del shell coach (~2572) |
| `supabase` | import App | — |

---

## 3) Qué comparten entre sí y con módulos ya extraídos

### Entre Panel / Promo / Coaches
| Compartido | Detalle |
|---|---|
| `notify` | mismo callback App |
| `styles` | mismo objeto local App |
| `adminUserId` | Panel → Coaches |
| Estado React | **nada** entre tabs |
| Tablas | Promo ≠ Coaches (sin overlap) |

### Con módulos ya extraídos / shared
| Módulo | ¿Usado por Admin pack? |
|---|---|
| `Athletes.jsx` | **No** |
| `WorkoutStructureTable` | **No** |
| `MarketplacePlanWorkoutsAccordion` | **No** |
| `AdminMarketplacePanel` | Sí, solo montado desde `AdminPanel` (ya archivo aparte) |
| `appShared` | Indirecto: App importa `ADMIN_EMAIL`, `PLATFORM_ADMIN_USER_ID`; Coaches **no** importa `getCurrentMonthKey` de appShared (usa copia local App) |

**Sin acoplamiento a Athletes / accordion / WST.** Pack admin es ortogonal.

---

## 4) App ↔ Admin: props y estrategia de estado

| Dirección | Qué cruza | Cantidad |
|---|---|---|
| App → `AdminPanel` | `notify`, `adminUserId` | **2 props** |
| `AdminPanel` → hijos | `notify` (± `adminUserId` / `styles`) | drilling interno corto |
| Admin → App | ningún callback de datos | 0 |

No pasa `athletes`, `view`, ni sesión completa (el gate de rol queda en App).

**Recomendación:** mantener **prop drilling** (2 props).  
Tres sub-bloques **no** justifican Context: no comparten estado entre tabs; el “padre” solo elige qué montar. Context añadiría indirección sin reducir props.

Tras extracción, App queda:

```jsx
{view === "admin" && (…) && (
  <AdminPanel notify={notify} adminUserId={PLATFORM_ADMIN_USER_ID} />
)}
```

(opcional: `styles` explícito si se deja de cerrar sobre el `styles` local, o importar `styles` desde `appShared` dentro del pack).

---

## 5) ¿Un módulo Admin o archivos separados?

**Recomendado: carpeta `src/components/Admin/` con archivos individuales + barrel.**

| Archivo | Contenido |
|---|---|
| `Admin/AdminPanel.jsx` | tabs + lazy/`import` de Marketplace + Promo + Coaches |
| `Admin/AdminPromoCodes.jsx` | CRUD `promo_codes` |
| `Admin/AdminCoachesProfilesPanel.jsx` | tabla coaches |
| `Admin/index.js` | `export { default } from "./AdminPanel"` (entrada App) |
| (ya existe) `AdminMarketplacePanel.jsx` | dejar en sitio actual **o** mover a `Admin/` en el mismo PR (opcional; no obligatorio) |

**Por qué no un solo `Admin.jsx` monolito (~644 líneas):**
- Tabs independientes; PRs/reviews más claros.
- Promo y Coaches no se benefician de vivir en el mismo archivo.
- Pattern alineado con `Athletes/` + paneles admin ya externos.

**Extraer los tres juntos en un solo commit/PR** sí tiene sentido (mismo gate, mismo `AdminPanel`), pero **como 3 archivos**, no como un blob.

---

## 6) Riesgos y casos raros

1. **`coachTrialDaysRemainingFromStart` compartido con shell** — al mover Coaches hay que **exportarlo** (p.ej. a `appShared` o `Admin/coachTrial.js`) e importarlo también desde App para el trial banner. No borrar el helper de App a ciegas.
2. **`getCurrentMonthKey` duplicado** — App local vs `appShared`. Preferir import desde `appShared` en el módulo Coaches (y opcionalmente limpiar el local App si nadie más lo usa allí).
3. **`styles` local vs `appShared.styles`** — pack debe importar `styles` (recomendado: `appShared`) para no depender del fin de `App.jsx`.
4. **`AdminMarketplacePanel` sigue recibiendo `styles`** — al extraer Panel, pasar `styles` desde appShared o prop; no romper el tab Marketplace.
5. **Código muerto en prelude no es del pack** — no mezclar limpieza FIT/`resolveCoach*` en este PR salvo que se toque al pasar helpers.
6. **RLS / rol admin** — UI gate en App; las mutations asumen políticas Supabase de admin. Smoke: solo cuenta admin.
7. **Promo ↔ Plans** — tras extraer Promo, Plans (aún en App) sigue leyendo `promo_codes` por su cuenta; no hay import cruzado. No hay riesgo de ciclo.
8. **`ai_generations`** — misma tabla que Builder/Plan2; Admin solo lista/reset. Sin conflicto de UI.
9. **Orden de definición** — hoy Coaches está *antes* de Panel en el archivo; al cortar, no dejar `AdminPanel` referenciando símbolos no movidos.
10. **No confundir** con `view === "admin-coaches"` u otras rutas legacy — el mount actual es solo `AdminPanel` bajo `view === "admin"`.

---

## 7) Conteo final

| Concepto | ~Líneas |
|---|---|
| Coaches + Panel + Promo en App | **~644** (3773–4416) |
| Helpers a **reubicar/compartir** (no solo Admin) | `coachTrialDaysRemainingFromStart` (~6 líneas) |
| Ya externo (no contar en move) | `AdminMarketplacePanel` |

App tras move: ~4781 − ~644 ≈ **~4137**, más wiring `import AdminPanel from "./components/Admin"`.

---

## 8) Plan de commits (acordado)

1. **Este documento** — commit + push ahora, sin runtime.  
2. **Paso 2** — tras OK: carpeta `Admin/` (3 archivos), App importa Panel, helpers trial/`getCurrentMonthKey`/`styles` resueltos, build + smoke tabs Promo / Marketplace / Coaches.  
3. (Opcional follow-up) mover `AdminMarketplacePanel.jsx` dentro de `Admin/`.

---

## Checklist post-extracción (Paso 2, no ahora)

- [ ] `npm run build` OK  
- [ ] App sin `function AdminPanel|AdminPromoCodes|AdminCoachesProfilesPanel`  
- [ ] Gate admin en App intacto  
- [ ] Tab Promo: listar/crear/activar código  
- [ ] Tab Marketplace: `AdminMarketplacePanel` carga  
- [ ] Tab Coaches: listar, activar 1/6/12 meses, bloquear, reset trial, reset generaciones  
- [ ] Trial banner coach (shell) sigue usando `coachTrialDaysRemainingFromStart`  
- [ ] Sin ciclos App ↔ Admin ↔ AdminMarketplacePanel  
