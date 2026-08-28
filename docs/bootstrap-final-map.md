# Mapeo: Bootstrap / AuthGate final en App.jsx

Fecha: 2026-08-28  
HEAD de referencia: `bef3433` (`refactor: extract CoachChrome and useCoachNavigation`)  
Archivo: `src/App.jsx` (**745 líneas**)  
Contexto: `docs/shell-breakdown-map.md` §B — último paso del orden (**#7**)

**Estado:** solo mapeo. Sin extracción. Esperando decisión: extraer vs dejar en App.

---

## 1) Qué queda en App.jsx tras `bef3433`

| Métrica | Valor |
|---|---|
| Líneas totales | **745** (antes del ciclo shell: ~2200+) |
| `useState` en App | **9** |
| De esos, bootstrap §B | **6** |
| Residuales (no bootstrap) | **3** — ver §5 |

### Inventario por responsabilidad

| Bloque | ~Líneas | Qué es |
|---|---|---|
| Prelude módulo (`CONFIRM_EMAIL_ROUTE`, detect recovery URL) | ~35–75 | Antes de montar; no es React state |
| Declaraciones estado + `notify` | ~78–109 | 9 estados + toast |
| Wiring hooks (athletes / nav / bridge / push) | ~111–189 | Pegamento |
| Invite code helpers (`inviteCoachPublicCode`, `resolveCoachIdByCode`) | ~193–208 | AuthLanding + InviteModal |
| Native **app links** auth (`nativeAppLinks`) | ~210–226 | APK email → ruta; distinto de push deep links |
| **Bootstrap auth** `getSession` + `onAuthStateChange` | ~228–279 | Corazón sesión |
| **`loadProfile`** (+ staff invite, heal, trial→blocked) | ~281–504 | Corazón perfil |
| `refreshProfileSilent` + `useAppResumeRefresh` | ~509–546 | Resume |
| `handleSignOut` / `closePasswordRecovery` | ~548–633 | Logout + recovery close |
| **Early-return gates** | ~635–689 | AuthGate UI |
| `<CoachChrome … />` prop dump | ~691–744 | Orquestación coach |

App ya **no** contiene: sidebar/switch, athletes CRUD, push FCM interno, builder/library state, plan picker Wompi, invite modal JSX.

---

## 2) Los 6 estados del bootstrap (confirmados)

Coinciden con el shell-breakdown §B:

| # | Estado | Línea ~ | Rol |
|---|---|---|---|
| 1 | `session` | 79 | Sesión Supabase (dueño del shell) |
| 2 | `authLoading` | 80 | Spinner “Cargando sesión…” |
| 3 | `passwordRecovery` | 86–93 | Gate a `ResetPasswordScreen` (URL + sessionStorage) |
| 4 | `authLandingOpenRequest` | 95 | Puente post-reset → `AuthLanding` |
| 5 | `profile` | 96–101 | Perfil (+ cache `raf_cached_profile`) |
| 6 | `profileLoading` | 102 | Spinner “Cargando perfil…” |

### Los 3 estados extra que aún viven en App (no son §B)

| Estado | Rol | Origen |
|---|---|---|
| `notification` | Toast `notify` | §J transversal |
| `inviteModalOpen` | Abrir InviteModal (componente ya extraído) | Resto del extract invite |
| `coachPlanPickerVoluntary` | Abrir PlanPicker voluntario | Resto del extract plan picker |

---

## 3) Flujo completo de bootstrap — ¿cambió con extracciones?

### Flujo (orden lógico)

```
[módulo] detectPasswordRecoveryFromUrl → sessionStorage mark
    ↓
getSession (withAuthLockRetry) → setSession / authLoading=false
    ↓
onAuthStateChange → setSession; PASSWORD_RECOVERY → passwordRecovery=true; PostHog identify
    ↓
loadProfile(session) (withAuthLockRetry en select profiles)
    ├─ processPendingStaffInvite
    ├─ acceptPendingInvitationIfAny
    ├─ ensureOwnProfile / heal huérfano / role missing → coach default
    └─ syncCoachPlanIfNeeded (trial expirado → blocked)
    ↓
refreshProfileSilent en resume (+ loadAthletes/bump si coach)
```

### Auth-lock

- `getSession` — envuelto en `withAuthLockRetry`
- `profiles` select en `loadProfile` — igual
- `refreshProfileSilent` — igual  

**No se simplificó ni se movió** en extracciones previas; sigue byte-equivalente en App.

### ¿Qué cambió con extracciones anteriores?

| Pieza | ¿Cambió el bootstrap? |
|---|---|
| AuthLanding / ConfirmEmail / ResetPassword | Solo **montaje** vía gates; lógica de sesión intacta |
| Invite / PlanPicker / Push / Bridge / Athletes / Chrome | **Sacaron** UI/estado de dominio; **no** reescribieron `loadProfile` / `getSession` |
| `handleSignOut` | Sigue en App; ahora llama `clearSelectedOnSignOut` + `setView("dashboard")` de hooks |
| Native app links | Sigue en App (auth URL APK); push coach deep links ya en hook |

**Conclusión:** el corazón auth/perfil es el mismo; App se adelgazó alrededor.

---

## 4) Gates (early-returns) — orden actual

Exactamente el orden del shell-breakdown:

| # | Condición | Render |
|---|---|---|
| 1 | `CONFIRM_EMAIL_ROUTE` | `<ConfirmEmailScreen />` |
| 2 | `passwordRecovery` | `<ResetPasswordScreen onDone/onCancel={closePasswordRecovery} />` |
| 3 | `authLoading` | Spinner sesión |
| 4 | `!session` | `<AuthLanding … />` |
| 5 | `profileLoading` | Spinner perfil |
| 6 | `profile.role === "athlete"` | `<AthleteHome profile={profile} />` |
| 7 | (else coach) | `<CoachChrome … />` |

Ningún gate adicional. Plan blocked / trial son **dentro** de CoachChrome (PlanPicker / banner), no early-returns de App.

---

## 5) Pegamento: ¿solo bootstrap, o hay más mezclado?

App **no** es solo AuthGate. Es **orquestador** + bootstrap:

### Hooks que App compone (y qué les pasa)

| Hook / módulo | Inputs desde App | Salida usada en |
|---|---|---|
| `useCoachAthletes` | `session`, `authLoading`, `notify`, `profile` | CoachChrome props; resume; push; sign-out |
| `useCoachNavigation` | `session`, `profile`, `onCloseAddAthleteForm` | CoachChrome; bridge/push (`setView`); sign-out |
| `useBuilderLibraryBridge` | `setView`, `notify` | CoachChrome |
| `useCoachPushDeepLinks` | `session`, `authLoading`, `profile`, `athletes`, `notify`, `setView`, `setSelectedAthlete`, `setViewRestored`, `setPendingRegistro…` | AuthLanding `onLoginSuccess`; CoachChrome banner; sign-out FCM clear |
| `useAppResumeRefresh` | callback con `refreshProfileSilent` + athletes | — |

### También en App (pegamento no-bootstrap)

- `notify` + `notification`
- `inviteModalOpen` / `coachPlanPickerVoluntary`
- `inviteCoachPublicCode` + `resolveCoachIdByCode` (AuthLanding + Invite)
- Effect `nativeAppLinks` (APK)
- Prop drilling masivo a `CoachChrome` (~50 props)

**Veredicto:** el bootstrap **es el bloque más denso de lógica**, pero App sigue siendo el **único punto de composición** de hooks + gates + 3 leftovers de overlays. No es “solo pegamento mínimo” todavía, pero sí está cerca de la forma final razonable.

---

## 6) Recomendación: ¿extraer `useAuthBootstrap` / AuthGate o dejarlo?

### Veredicto: **dejar el bootstrap en `App.jsx` como punto de entrada real.**

No recomendar un Paso 2 de extracción del corazón **salvo** que el objetivo sea puramente estética de archivo.

### Beneficio real de extraer (más allá de líneas)

| Posible ganancia | Realidad aquí |
|---|---|
| Reutilizar bootstrap en otra app/shell | No hay segundo entrypoint |
| Testear `loadProfile` aislado | Se puede extraer **funciones puras** (`syncCoachPlanIfNeeded`, heal) sin mover gates; no requiere hook |
| App de 100 líneas “bonita” | El orquestador seguiría necesitando `session`/`profile`/gates; el archivo “App” solo renombraría el dueño |
| Aislar riesgo auth-lock | Mover `withAuthLockRetry` + heal a otro archivo **aumenta** riesgo de regresiones sutiles sin ganar API pública |

### Coste / riesgo de extraer

- Early-returns + Rules of Hooks: o el hook no hace returns (App sigue gordo en JSX), o un `<AuthGate>` envuelve children y **duplica** la forma actual.
- `handleSignOut` cruza FCM (push hook), nav (`setView`), athletes (`clearSelectedOnSignOut`) — el “bootstrap puro” no es puro.
- `loadProfile` es denso y frágil (staff, trial, heal); el shell-breakdown ya decía **no extraer pronto** / no “simplificar”.

### Cuándo sí tendría sentido un extract parcial

1. **`NotifyContext`** (opcional, bajo riesgo) — saca `notification`/`notify` del orquestador.  
2. Mover `inviteModalOpen` / `coachPlanPickerVoluntary` **dentro** de CoachChrome (o wrappers) — limpia 2 estados residuales **sin** tocar auth.  
3. Extraer helpers de `loadProfile` a `lib/profileBootstrap.js` **sin** cambiar el flujo de App.

Ninguno de esos es “AuthGate hook” completo.

---

## 7) Si se extrajera (solo para dimensionar)

| Pieza | ~Líneas |
|---|---|
| 6 estados + prelude recovery | ~80 |
| getSession + onAuthStateChange | ~50 |
| loadProfile completo | ~220 |
| refresh + trozo resume profile | ~40 |
| closePasswordRecovery + gates JSX | ~80 |
| handleSignOut (parcial; FCM acoplado) | ~50 |
| **Total si se mueve “todo B”** | **~450–520** |

App quedaría ~200–250 líneas de composición + CoachChrome props — **poco beneficio neto** frente al riesgo.

---

## 8) Forma final recomendada de App.jsx (sin extract del corazón)

App como **entry + AuthGate + compositor**:

```
App.jsx (~700–750 líneas hoy; opcionalmente ~650 si se meten invite/plan flags en Chrome)
├── Prelude recovery URL
├── Estados: 6 bootstrap + notify (+ invite/plan open si no se mueven)
├── notify
├── useCoachAthletes / useCoachNavigation / useBuilderLibraryBridge / useCoachPushDeepLinks
├── invite code helpers (+ nativeAppLinks effect)
├── getSession + onAuthStateChange + loadProfile + resume
├── handleSignOut + closePasswordRecovery
├── Early-returns (Confirm → Reset → authLoading → AuthLanding → profileLoading → AthleteHome)
└── return <CoachChrome …props de hooks… />
```

**Qué contiene exactamente (honesto):** el corazón auth/perfil, los gates, el cableado de hooks, y un poco de estado de overlays. **Eso es el rol correcto de App** tras el ciclo de extracciones — no un bug de “aún monolítico”.

Próximos pasos opcionales (menor prioridad que “cerrar el mapa”):

- [ ] Meter `inviteModalOpen` / `coachPlanPickerVoluntary` en CoachChrome  
- [ ] Considerar `NotifyContext`  
- [ ] **No** mover `loadProfile` / gates a hook salvo bug concreto o segundo shell  

---

## Checklist

- [x] Conteo post-`bef3433`: **745 líneas**, **9 useState** (6 bootstrap + 3 residuales)
- [x] 6 estados §B confirmados
- [x] Flujo auth-lock intacto tras extracts
- [x] Gates en orden documentados
- [x] Recomendación: **dejar bootstrap en App**; extract completo no aporta más allá de líneas
- [ ] (Usuario) Validar decisión; si “dejar”, no hay Paso 2 de runtime
