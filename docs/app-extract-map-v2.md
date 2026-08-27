# Mapeo v2: qué queda en App.jsx tras extraer Athletes

Fecha: 2026-08-27  
HEAD de referencia: `fa51bef` (`refactor: use shared WorkoutStructureTable in Builder`)  
Archivo: `src/App.jsx` (~4981 líneas / ~4704 no vacías)

**Contexto:** el Paso 2 de Athletes ya está en `master` (`2911a69` + fixes). Se extrajeron ~3817 líneas (Athletes + helpers + WST shared).  
**Estado de este doc:** solo mapeo. Sin extracción de código. Esperando validación.

**Relacionado:** `docs/athletes-extract-map.md` (histórico del split Athletes; no sobrescrito).

---

## 0) Foto actual de App.jsx

| Zona | Líneas (aprox.) | ~Líneas | Rol |
|---|---|---|---|
| Prelude (imports, constantes, helpers, `ProgressBar`) | 1–426 | **~426** | Soporte del shell |
| `export default function App()` | 427–3321 | **~2895** | Auth, sesión, nav, tabs, wiring de vistas |
| `Dashboard` | 3323–3774 | **~452** | Panel coach |
| `AdminCoachesProfilesPanel` | 3776–4168 | **~393** | Admin → coaches |
| `MarketplacePlanWorkoutsAccordion` | 4171–4366 | **~196** | Preview estructura (Market + Library) |
| `AdminPanel` (tabs) | 4368–4394 | **~27** | Shell admin |
| `AdminPromoCodes` | 4396–4616 | **~221** | Admin → promos |
| `Plans` | 4618–4897 | **~280** | Suscripción / Wompi / promo |
| `const styles` (local, fin de archivo) | 4899–fin | **~83** | Estilos del shell (duplicados en espíritu con `appShared.styles`) |

**Suma ≈ 4981.** Ya no hay `function Athletes` ni helpers de forma/PDF/badges en este archivo.

Vistas que **ya están en módulos lazy** (solo se cablean desde App):  
`Athletes`, `EvaluationView`, `ChallengesHub`, `CoachSettings`, `Plan2Weeks`, `Builder`, `GpxRacePlan`, `WorkoutLibrary`, `MarketplaceHub`, `AdminMarketplacePanel`, `AthleteHome`, `ResetPasswordScreen`, `ConfirmEmailScreen`.

---

## 1) Bloques restantes (detalle)

### A. Prelude / helpers (~1–426, ~426 líneas)

Incluye (entre otros):
- Constantes de storage / recovery / confirm-email
- `getRaceCountdownText`, `getRaceMeta`, `rpeBandMeta`
- `normalizeWorkoutRow` (local; Dashboard + ChallengesHub vía prop)
- Helpers FIT aparentemente **huérfanos** (`fitTitleKeywords`, `getFitAvgSpeedChanges`, `mapFitWorkoutType`)
- `ProgressBar` (solo Dashboard)
- Constantes admin/trial/nav (`ADMIN_WHATSAPP_*`, `COACH_NAV_BASE_ITEMS`, precios plan picker)
- `resolveCoachUserIdFromPublicCode`, `coachDirectorySpecialtyLabel` — **definidos, sin usos** en el archivo actual (candidatos a borrado o a mover con el bloque que los necesite)

| Métrica | Valor |
|---|---|
| `useState` / `useEffect` | 0 / 0 |
| Acoplamiento | Medio: `normalizeWorkoutRow` + `ProgressBar` + `styles` alimentan Dashboard/Admin/Plans; el resto es dead weight o config del shell |

**Extracción:** no es un “módulo de producto”; más bien limpieza + mover helpers con el bloque consumidor (`ProgressBar`/`getRaceMeta` → Dashboard; `normalizeWorkoutRow` → preferir `appShared` como ya hace Athletes).

---

### B. Shell `App()` (~427–3321, ~2895 líneas) — el núcleo

**~48 `useState`, ~19 `useEffect`, ~19 `useCallback`.**

Subsecciones lógicas (no son funciones separadas hoy):

| Subsección | Líneas aprox. | Contenido |
|---|---|---|
| Estado + effects de sesión/auth/push/deep-links/atletas | ~427–1900 | Sesión Supabase, FCM/native push, invite codes, carga `athletes`, handlers CRUD atleta, plan picker state |
| Early returns: recovery / loading / **login-landing** | ~1905–2540 | `ResetPasswordScreen`, auth UI embebida (login/signup/forgot), landing |
| Early return **AthleteHome** | ~2555–2560 | Rol athlete → módulo ya separado |
| Chrome coach: toast, invite modal, trial banner, plan picker screen, **sidebar + main + bottom nav** | ~2608–3321 | Tabs Atletas/Entrenamientos, Suspense de vistas lazy, wiring de props |

**Props / estado que el shell sigue “dueñando” y pasa a hijos:**

| Dato | Consumidores típicos |
|---|---|
| `athletes` / `setAthletes` / `selectedAthlete` | Athletes, Evaluation, Challenges, Settings, Plans, Library, Builder, Plan2Weeks, Gpx… |
| `workoutsRefresh` / `pendingRegistroWorkoutId` | Athletes (deep link registro) |
| `aiPrompt` / `aiWorkout` / `aiLoading` | Builder |
| `libraryRefresh` | WorkoutLibrary |
| `notify` | casi todas las vistas |
| `profile` / `session` | nav, gates admin, marketplace, settings |
| `showAddAthleteForm` / `newAthlete` / `planLimitWarning` | Dashboard (+ handlers en App) |
| `MarketplacePlanWorkoutsAccordion` (componente) | WorkoutLibrary + MarketplaceHub (inyectado como prop) |
| `styles` / `normalizeWorkoutRow` | varios lazy + ChallengesHub |

| Métrica | Valor |
|---|---|
| Acoplamiento | **Alto** — es el bus de estado. No se “extrae” entero; se adelgaza sacando vistas y luego (opcional) AuthLanding / CoachChrome |

**Orden de trabajo dentro del shell (más adelante):**  
1) Auth landing embebida → módulo `AuthLanding`/`LoginScreens`  
2) Invite modal + plan picker screens  
3) Dejar App como orquestador fino (~routing + providers)

---

### C. `Dashboard` (~3323–3774, ~452 líneas)

Panel semanal: atletas del coach (+ staff), workouts de la semana, adherencia, RPE, km, próxima carrera, CTA alta atleta.

| Métrica | Valor |
|---|---|
| `useState` | **3** (`dashAthletes`, `weekWorkouts`, `dashLoading`) |
| `useEffect` | 1 (+ `useAppResumeRefresh`) |
| `useMemo` / `useCallback` | 7 / 1 |
| Supabase | `athletes`, `workouts`, `coach_staff` |

**Props desde App (~10):**  
`coachUserId`, `onSelect`, `onRequestAddAthlete`, `showAddAthleteForm`, `planLimitWarning`, `onGoToPlans`, `onDismissPlanLimitWarning`, `newAthlete`, `onChangeNewAthleteField`, `onSaveNewAthlete`, `onCancelAddAthlete`.

| Acoplamiento | Bajo–medio |
|---|---|
| Carga **su propia** lista/semana (no reusa `athletes` del shell) | Independiente de datos |
| Formulario “añadir atleta” vive en Dashboard pero el **estado y save** están en App | Acoplado a handlers del shell |
| Usa `ProgressBar`, `getRaceMeta`, `normalizeWorkoutRow`, `styles` locales de App | Hay que mover/importar esos helpers |

---

### D. Admin cluster

#### D1. `AdminPanel` (~4368–4394, ~27 líneas)
Tabs Promo / Marketplace / Coaches. **1** `useState` (`adminTab`).

#### D2. `AdminPromoCodes` (~4396–4616, ~221 líneas)
CRUD códigos promo. **4** `useState`. Supabase `promo_codes` (o tabla afín).

#### D3. `AdminCoachesProfilesPanel` (~3776–4168, ~393 líneas)
Lista coaches, emails, generaciones IA del mes, activar plan. **7** `useState`. Supabase `profiles`, `coach_profiles`, `ai_generations`.

#### D4. Ya externo
`AdminMarketplacePanel` (lazy) — solo se monta desde `AdminPanel`.

| Acoplamiento Admin | Bajo |
|---|---|
| Entrada desde App: `notify`, `adminUserId` | Estable |
| Casi no toca `athletes` / calendario | Ideal para pack `src/components/Admin/` |

**Pack sugerido:** `AdminPanel` + `AdminPromoCodes` + `AdminCoachesProfilesPanel` (+ dejar `AdminMarketplacePanel` donde está).

---

### E. `MarketplacePlanWorkoutsAccordion` (~4171–4366, ~196 líneas)

Acordeón por semana de `preview_workouts`; usa `WorkoutStructureTable` shared + `readStructure`.

| Métrica | Valor |
|---|---|
| `useState` | **1** (`openWeeks`) |
| `useEffect` / `useMemo` | 1 / 3 |
| Props | `previewWorkouts`, `resetKey`, `lockAfterWeek1` |

**Inyección actual:** App pasa el **componente** como prop a `WorkoutLibrary` y `MarketplaceHub` (`MarketplacePlanWorkoutsAccordion={...}`).

| Acoplamiento | Bajo (tras mover) |
|---|---|
| No depende de estado de App | Solo se define en App por historia |
| Tras extraer: import directo en Library/Hub (o shared) y **dejar de inyectar** desde App | Simplifica el shell |

---

### F. `Plans` (~4618–4897, ~280 líneas)

Catálogo Básico/Pro, promo codes, checkout Wompi.

| Métrica | Valor |
|---|---|
| `useState` | **4** (promo*) |
| Props | `athletes`, `notify` (`athletes` poco crítico; más que nada contexto) |
| Acoplamiento | Bajo–medio (Wompi keys / redirect en el propio archivo; `styles`) |

---

### G. `styles` local (~4899–fin, ~83 líneas)

Duplicado conceptual de `appShared.styles` (Athletes ya importa desde `appShared`). Dashboard/Admin/Plans/App chrome siguen con el local.

| Acoplamiento | Medio transversal |
|---|---|
| Migrar consumidores a `appShared.styles` y borrar el local | Limpieza; no es un “módulo de feature” |

---

## 2) Resumen de tamaños y acoplamiento

| Bloque | ~Líneas | useState | useEffect | Acoplamiento | Notas |
|---|---|---|---|---|---|
| Prelude/helpers | 426 | 0 | 0 | Medio | Dead helpers + `normalizeWorkoutRow` / `ProgressBar` |
| **App shell** | **2895** | **48** | **19** | **Alto** | Auth + nav + wiring |
| Dashboard | 452 | 3 | 1 | Bajo–medio | Props de alta atleta en App |
| AdminCoachesProfilesPanel | 393 | 7 | 1 | Bajo | Pack admin |
| Marketplace accordion | 196 | 1 | 1 | Bajo | Shared fácil |
| AdminPanel | 27 | 1 | 1 | Bajo | Tabs |
| AdminPromoCodes | 221 | 4 | 1 | Bajo | Pack admin |
| Plans | 280 | 4 | 0 | Bajo–medio | Wompi |
| styles local | 83 | — | — | Transversal | Unificar con appShared |

**Admin pack (Panel+Promo+Coaches) ≈ 641 líneas.**  
**Dashboard + ProgressBar/getRaceMeta ≈ 460+.**

---

## 3) Orden de extracción sugerido

De más aislado / barato → más estructural:

| # | Extracción | ~Líneas | Por qué primero / después |
|---|---|---|---|
| **1** | `MarketplacePlanWorkoutsAccordion` → `src/components/shared/` (o `Marketplace/`) | ~196 | Casi cero props de App; quita inyección a Library/Hub; ya depende de WST shared |
| **2** | Pack **Admin** (`AdminPanel` + `AdminPromoCodes` + `AdminCoachesProfilesPanel`) | ~641 | Gate admin claro; props `notify`/`adminUserId`; no toca atletas/calendario |
| **3** | **Plans** | ~280 | Vista de suscripción autocontenida; cuidado con claves Wompi / URLs |
| **4** | **Dashboard** (+ `ProgressBar`, `getRaceMeta`; opcional `normalizeWorkoutRow`→appShared) | ~460+ | Pocos estados locales; hay que decidir si el form “nuevo atleta” sigue prop-drilling desde App o se mueve |
| **5** | Limpieza prelude (borrar FIT/`resolveCoach*` muertos; unificar `styles`) | variable | Reduce ruido sin cambiar UX |
| **6** | **Auth landing / login UI** fuera de `App()` | ~600–900 (estim.) | Aísla pantallas pre-sesión; App queda en orquestación |
| **7** | (Opcional, grande) Coach chrome / Context ligero | resto del shell | Solo cuando 1–6 estén verdes; el shell seguirá dueño de `athletes`/`view`/deep-links |

**No recomendar ahora:** Context global enorme, ni “extraer App entero”. El patrón que funcionó con Athletes (prop drilling + módulo único + build/smoke) aplica igual.

---

## 4) Dependencias cruzadas a no romper

1. Deep link `pendingRegistroWorkoutId` → Athletes (ya ok; no mover sin App).  
2. `MarketplacePlanWorkoutsAccordion` prop en Library + MarketplaceHub (cambiar a import directo al extraer).  
3. Dashboard **no** usa `athletes` del shell para la tabla semanal (doble fuente de verdad a tener en cuenta si se unifica).  
4. `normalizeWorkoutRow` local vs `appShared` — Athletes ya usa appShared; Dashboard/Challenges aún pueden usar el local de App.  
5. `styles` local vs `appShared.styles` — misma idea.

---

## 5) Riesgos (del intento Athletes, aplicables aquí)

1. Cortar mid-función / dejar imports huérfanos.  
2. Extraer accordion sin actualizar Library/Hub (rompe “Ver plan”).  
3. Mover Dashboard sin `ProgressBar`/`getRaceMeta`.  
4. Circular imports App ↔ feature.  
5. Tocar Wompi/redirect en Plans sin smoke de checkout (staging).

---

## Plan de commits (propuesto)

1. **Este documento** (`docs/app-extract-map-v2.md`) — commit ahora, sin runtime.  
2. Extracciones reales — **una feature por PR/commit**, en el orden de la §3, tras OK al mapeo.  
3. Push de cada extracción tras `npm run build` + smoke de esa vista.

---

## Checklist de validación (post-cada extracción, no ahora)

- [ ] `npm run build` OK  
- [ ] Sin imports circulares App ↔ módulo nuevo  
- [ ] Vista afectada smoke en local/staging  
- [ ] Si accordion: Library “Ver plan” + Marketplace preview  
- [ ] Si Admin: tabs Promo / Marketplace / Coaches  
- [ ] Si Plans: catálogo + aplicar promo (sin cobrar en prod)  
- [ ] Si Dashboard: semana, adherencia, CTA atleta  
