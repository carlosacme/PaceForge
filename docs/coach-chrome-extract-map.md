# Mapeo: Nav / tabs / chrome coach en App.jsx

Fecha: 2026-08-28  
HEAD de referencia: `2dff578` (`refactor: extract coach athletes list/CRUD into useCoachAthletes`)  
Archivo: `src/App.jsx` (~1181 líneas)  
Contexto: `docs/shell-breakdown-map.md` §D (nav/tabs) + §K (chrome + wire de vistas) — paso **#6** del orden

**Estado:** solo mapeo. Sin extracción. Esperando validación: Paso 2 separado **o** fusión con bootstrap final.

---

## 1) ¿Qué es este bloque? Rangos exactos

Son **dos capas** que el shell-breakdown separó, pero en la práctica son un solo “shell visual” del coach:

| Capa | Qué es | Estados propios |
|---|---|---|
| **D — Nav/tabs** | Dueño de `view` + persistencia + handlers de navegación | **2** (`view`, `viewRestored`) |
| **K — Chrome + wire** | Sidebar, main, banners, `view === "…"`, bottom nav | **0** (solo consume `view`) |

### Los 2 useState

| Estado | Línea ~ | Rol |
|---|---|---|
| `view` | 106 | Id de vista coach activa (`"dashboard"`, `"athletes"`, `"builder"`, …). Default `"dashboard"`. |
| `viewRestored` | 133 | Flag: ya se aplicó `raf_lastView` tras login; evita pisar / bucles al montar. Se resetea a `false` cuando cambia `session.user.id` (~L332–334). |

**No hay un tercer useState de “tab”.** Los tabs de Atletas / Entrenamientos viven en **localStorage** (`raf_tab_atletas`, `raf_tab_entrenamientos`) y se mapean **a** `view` (p. ej. tab `evaluacion` → `view === "evaluation"`).

### Helpers / consts de navegación (sin useState)

| Pieza | Líneas ~ |
|---|---|
| `COACH_NAV_BASE_ITEMS` | 94–100 |
| `TAB_KEY_ATHLETES` / `TAB_KEY_TRAINING` | 102–103 |
| `readStoredTab` / `writeStoredTab` | 136–144 |
| `getAthletesViewFromTab` / `getAthletesTabFromView` | 145–154 |
| `getTrainingViewFromTab` / `getTrainingTabFromView` | 155–164 |
| `coachNavItems` (base + settings + admin condicional) | 227–236 |
| `allowedCoachViews` (nav ids + hiddenViews) | 237–240 |

### Effects de navegación / persistencia

| Effect | Líneas ~ | Qué hace |
|---|---|---|
| Reset `viewRestored` | 332–334 | Nuevo user → re-aplicar lastView |
| Restore `raf_lastView` | 603–611 | Si coach y aún no restored → `setView(saved)` |
| Gate admin / legacy | 613–622 | No-admin en `"admin"` → dashboard; `"admin-coaches"` → dashboard |
| Persist `raf_lastView` | 624–628 | Tras restored, cada cambio de `view` |
| Visibility → re-leer lastView | 630–642 | Al volver a la pestaña |
| Sync tabs LS desde `view` | 644–651 | Escribe `TAB_KEY_*` según vista |

### Handlers de navegación

| Handler | Líneas ~ | Rol |
|---|---|---|
| `goCoachView(id)` | 814–829 | Click sidebar / bottom nav; resuelve tab LS para `athletes` / `training`; cierra form alta |
| `selectAthletesTab(tab)` | 831–834 | Chips Lista / Evaluación / Retos |
| `selectTrainingTab(tab)` | 836–839 | Chips Plan 2 Semanas / Builder / GPX |

### JSX del chrome (return coach, post-gates)

Tras early-returns de bootstrap (~L740–794: confirm email, recovery, authLoading, AuthLanding, profileLoading, AthleteHome), el return coach:

| Región | Líneas ~ | Contenido |
|---|---|---|
| Shell root + toast + InviteModal mount | 841–851 | Overlays ya extraídos montados aquí |
| **Sidebar** desktop | 853–909 | Logo, `coachNavItems`, footer (nombre, conteo athletes, sign-out) |
| **Main** | 911–1143 | InstallApp, PushInviteBanner, trial banner, gate `loadingAthletes`, **switch `view === …`** |
| **Bottom nav** mobile | 1145–1168 | Mismos items / active rules |
| PlanPicker mount | 1171–1176 | Overlay (no es `view`) |

*InviteModal / PlanPicker / PushInviteBanner ya son módulos; el chrome solo los monta.*

---

## 2) Dueño de `view` / `setView`

**Sí: App es el dueño real de `view`.** Nadie más declara ese estado.

Quién **escribe** vía `setView` (pasado o inline):

| Quién | Destino típico | ¿Es AuthLanding / Plan picker? |
|---|---|---|
| App — restore / visibility / gates | lastView, `dashboard` | — |
| App — `goCoachView` / `select*Tab` | cualquier vista nav/tab | — |
| App — Dashboard `onSelect` | `"athletes"` | — |
| App — Library callbacks | `"admin"`, `"library"` | — |
| App — sign-out | `"dashboard"` | — |
| **`useBuilderLibraryBridge`** | `"builder"` (`useLibraryWorkout`) | No es AuthLanding |
| **`useCoachPushDeepLinks`** | `"athletes"` (+ `setViewRestored`) | No |

**Aclaración vs intuición del enunciado:**

- **AuthLanding** — **no** llama `setView`. Vive en el early-return `!session`; al loguear, App pinta el chrome y `view` queda en default/restore.
- **PlanPicker** — **no** usa `view`. Se controla con `coachPlanPickerVoluntary` / `coachPlanBlockedUi` (overlay fullscreen).
- Los CTAs `onGoToPlans` abren el picker; no cambian `view`.

---

## 3) Lista completa de vistas / tabs (hoy)

### Items de navegación principal (`coachNavItems`)

| id nav | En UI | Notas |
|---|---|---|
| `dashboard` | Panel | |
| `athletes` | Atletas | Active también si `evaluation` / `challenges` |
| `training` | Entrenamientos | Active si `plan12` / `builder` / `carrera_gpx`; **no** es un `view` estable por sí solo (alias → tab LS) |
| `library` | Biblioteca | |
| `marketplace` | Marketplace | |
| `settings` | Configuración | Siempre añadido |
| `admin` | Admin | Solo `role === "admin"` o `ADMIN_EMAIL` |

### Valores reales de `view` (switch main)

| `view` | Módulo | Grupo |
|---|---|---|
| `dashboard` | Dashboard | Nav |
| `athletes` | Athletes | Tab Atletas → lista |
| `evaluation` | EvaluationView | Tab Atletas |
| `challenges` | ChallengesHub | Tab Atletas |
| `plan12` | Plan2Weeks | Tab Entrenamientos |
| `training` | Plan2Weeks (mismo que plan12) | Legacy / alias en condiciones |
| `builder` | Builder | Tab Entrenamientos |
| `carrera_gpx` | GpxRacePlan | Tab Entrenamientos |
| `library` | WorkoutLibrary | Nav |
| `marketplace` | MarketplaceHub | Nav |
| `settings` | CoachSettings | Nav |
| `admin` | AdminPanel | Nav (gated) |

### Tabs LS (no son `view` por sí solos)

| Key | Valores | Mapeo a `view` |
|---|---|---|
| `raf_tab_atletas` | `lista` / `evaluacion` / `retos` | → athletes / evaluation / challenges |
| `raf_tab_entrenamientos` | `plan_2_semanas` / `crear_workout` / `carrera_gpx` | → plan12 / builder / carrera_gpx |

### Eliminado / legacy

| Id | Estado |
|---|---|
| **Plans** (vista planes en chrome) | **Eliminado** — pago/suscripción = `PlanPicker` overlay |
| `admin-coaches` | Si aparece en `view`, effect fuerza `dashboard` |
| `isCoachUi` (~L796) | Calculado y **no usado** (código muerto local) |

AthleteHome **no** usa este `view` (early-return por `role === "athlete"`).

---

## 4) Por qué el aislamiento es “bajo” — ¿solo lectura o lógica de negocio?

**No es solo “todo lee `view`”.** Hay lógica real mezclada, aunque no es el corazón de Supabase:

1. **Orquestación UI masiva** — Casi todo el JSX coach es `view === "…"`. Extraer sin llevar el switch deja un App vacío de UI o un CoachChrome con ~15 props densas.
2. **Gates de acceso** — Admin: item nav + render + effect que saca a no-admins de `"admin"`. Plan bloqueado / trial: banners y PlanPicker (estado aparte, pero JSX vive en el chrome).
3. **Persistencia cross-session** — `raf_lastView` + tabs + visibilitychange; acoplado a `session` / `profile.role` (no restaurar si athlete).
4. **Acoplamiento a hooks ya extraídos** — Push y Library→Builder **escriben** `setView`; deep links también tocan `setViewRestored`.
5. **Acoplamiento a athletes shell** — `goCoachView` llama `setShowAddAthleteForm(false)`; sidebar muestra `athletes.length` / km; main espera `loadingAthletes`.
6. **Sign-out** — Limpia `raf_lastView` / tabs y `setView("dashboard")` (bootstrap + chrome).

Lo que **no** está aquí: queries de negocio de cada vista (ya en módulos), CRUD atletas, Wompi, FCM interno.

---

## 5) Dependencias App ↔ bloque — ¿casi todo necesita `view` / `setView`?

### Lectores de `view` (principales)

| Consumidor | Uso |
|---|---|
| Sidebar / bottom nav | Active state |
| Main switch | Qué montar |
| Chips Atletas / Training | Highlight |
| Effects lastView / tab sync / admin gate | Persistencia y corrección |
| (implícito) loadingAthletes gate | Envuelve el switch |

Los **módulos de vista** (Dashboard, Athletes, …) **no reciben `view` como prop**; App decide montarlos. Solo reciben datos/callbacks.

### Escritores de `setView` (principales)

| Consumidor | Uso |
|---|---|
| Handlers chrome (`goCoachView`, tabs) | Navegación primaria |
| Dashboard `onSelect` | → athletes |
| WorkoutLibrary | → admin / library |
| `useBuilderLibraryBridge` | → builder |
| `useCoachPushDeepLinks` | → athletes (+ `setViewRestored`) |
| Sign-out / admin gate / restore | Reset / corrección |

### También necesita el chrome (aunque no sea `view`)

`profile`, `session`, `athletes`, `notify`, flags plan/trial/push, invite open, **todas** las props que hoy baja el switch a cada vista.

**En la práctica:** casi todo el shell coach **depende del chrome como contenedor**; el estado `view` en sí lo leen sobre todo App + nav, y lo escriben App + 2 hooks.

---

## 6) Recomendación: ¿Paso 2 chrome ahora, o fusionar con bootstrap?

### Veredicto: **no fusionar con el bootstrap final.** Sí tiene sentido un Paso 2 de chrome **separado**, con alcance claro.

| Opción | Pros | Contras |
|---|---|---|
| **A. Fusionar chrome + AuthGate** | Un solo “gran final” | Mezcla auth (session/profile/early-returns) con layout coach; PR enorme; peor bisección de bugs |
| **B. Extraer solo `useCoachView` (2 estados + effects + handlers)** | Adelgaza lógica de nav | El JSX (~330 líneas) sigue en App; poco alivio visual |
| **C. Extraer `CoachChrome.jsx` (layout + switch) recibiendo `view`/`setView` + props** | App queda como orquestador fino; AuthGate después solo mueve gates | Muchas props al chrome (esperado) |
| **D. B+C en un PR** | Cierra el paso #6 del shell-breakdown | Alcance medio-alto; validar nav/restore/deep link |

**Recomendación:** **Opción C (o D).** Mantener bootstrap (session/profile/AuthLanding/AthleteHome) en App hasta el **último** paso. El chrome es “todo lee/escribe navegación”; el bootstrap es “quién puede entrar”. Separarlos evita tocar auth y layout en el mismo diff.

Si priorizas **mínimo riesgo / mínimo pasos:** se puede **diferir** el chrome y hacer AuthGate dejando el JSX en App — pero entonces AuthGate extract arrastra el return gigante o lo deja huérfano. Mejor chrome **antes** del corazón, como decía el shell-breakdown.

**No** crear Context de `view` en este paso: seguir pasando `setView` a los 2 hooks que ya lo usan.

---

## 7) Conteo final de líneas

| Pieza | ~Líneas |
|---|---|
| Consts nav + TAB keys | ~12 |
| 2× useState | 2 |
| Helpers tab + read/write LS | ~30 |
| `coachNavItems` / `allowedCoachViews` | ~15 |
| Effects nav/persist/gates | ~55 |
| `goCoachView` / `select*Tab` | ~25 |
| JSX sidebar + main switch + bottom nav (+ mounts overlays) | **~320–340** |
| **Total orientativo si se extrae chrome completo (C/D)** | **~450–480** |
| Solo hook nav (B) | **~120–140** |

Destinos sugeridos:

- `src/hooks/useCoachNavigation.js` — opcional (estados + effects + handlers)
- `src/components/CoachChrome.jsx` — sidebar, banners shell, switch de vistas, bottom nav

App post-extract (ideal): gates bootstrap → `<CoachChrome … />` + overlays si se dejan fuera.

---

## Riesgos

| Riesgo | Detalle |
|---|---|
| Prop drilling denso | CoachChrome recibirá athletes + bridge + invite + plan flags + … — aceptable; no Context todavía |
| Deep link + `viewRestored` | Orden restore vs `setView("athletes")` del push; no “optimizar” effects |
| `training` vs `plan12` | Mantener ambas en condiciones del switch |
| Form alta | `goCoachView` cierra `showAddAthleteForm` — sigue necesitando callback del athletes hook |
| `isCoachUi` muerto | No mover; candidata a borrar en extract o PR aparte |
| Overlays | Invite/PlanPicker pueden quedar hermanos de CoachChrome en App |

---

## Checklist (cuando se decida Paso 2 o fusión)

- [ ] Decisión: **C/D chrome separado** vs diferir vs fusión bootstrap (no recomendada)
- [ ] Si C/D: `CoachChrome` (+ opcional `useCoachNavigation`); mismos active rules sidebar/bottom
- [ ] Smoke: restore lastView; tabs atletas/training; Library→Builder; push→athletes; admin gate; plan picker overlay; sign-out
- [ ] Build limpio; AthleteHome / AuthLanding sin regresión
