# Desglose del App shell restante

Fecha: 2026-08-27  
HEAD de referencia: `9a7be91` (`refactor: extract AuthLanding from App with auth-lock retry`)  
Archivo: `src/App.jsx` (**~2202** líneas totales / **~2096** no vacías)

**Estado:** solo análisis. Sin extracción de código. Esperando decisión de troceo.

**Contexto:** tras Athletes, Marketplace accordion, Admin pack, Dashboard, Plans (eliminado), prelude/styles, y AuthLanding. Relacionado: `docs/app-extract-map-v2.md` (cifras antiguas; este doc actualiza la foto).

---

## 0) Foto actual (corrección de cifras)

| Métrica | Valor actual | Nota vs v2 (~2895 / 48 `useState`) |
|---|---|---|
| Líneas totales / no vacías | **~2202 / ~2096** | Bajó tras Dashboard + AuthLanding + limpieza Plans/prelude |
| `useState` + `usePersistedState` | **37** | 36 al inicio de `App()` + 1 `nativeDeepLinkTick` más abajo |
| `useEffect` | **17** | Bootstrap, perfil, atletas, push, nav, deep links |
| `useCallback` / `useMemo` / `useRef` | **22 / 4 / 1** | Helpers de tabs, FCM, picker, invite, athletes, deep link |

**Ya no vive en App (módulos / lazy):** Athletes, Dashboard, Admin*, AuthLanding, ConfirmEmail, ResetPassword, AthleteHome, CoachSettings, Plan2Weeks, Builder, GpxRacePlan, WorkoutLibrary, MarketplaceHub, ChallengesHub, EvaluationView, InstallAppButton.

**Integraciones externas en App:** **no** hay wiring de Intervals.icu / Garmin / Strava. El comentario en L942 lo deja explícito: *AthleteHome* hace su propio resume (ficha/workouts/intervals). App solo orquesta FCM/push nativo + deep links de coach + app links nativos genéricos.

---

## 1) Secciones / responsabilidades

Los `useState` están **declarados en bloque** (L145–202 + L1031), pero la lógica y el JSX viven en franjas distintas. La columna “estados” asigna cada estado a la sección **dueña**; estados compartidos se anotan.

### A. Prelude / config de módulo (~L1–143) — **0 estados**

Imports, detección recovery URL (`PASSWORD_RECOVERY_IN_URL`), `COACH_NAV_BASE_ITEMS`, claves de tabs, precios `COACH_PLAN_PICKER_*`, constantes Nequi/WA.

| Aislamiento | Alta (datos estáticos). Viaja con el bloque consumidor (nav / plan picker). |

---

### B. Bootstrap sesión + perfil + auth gates (~L549–832, early-returns ~L1304–1356, signOut/recovery ~L1127–1213) — **6 estados**

| Estado | Rol |
|---|---|
| `session` | Sesión Supabase (dueño del shell) |
| `authLoading` | Spinner “Cargando sesión…” |
| `passwordRecovery` | Gate a `ResetPasswordScreen` |
| `authLandingOpenRequest` | Puente post-reset → `AuthLanding` |
| `profile` | Perfil (+ cache `raf_cached_profile`) |
| `profileLoading` | Spinner perfil |

**Lógica:** `getSession` + `onAuthStateChange` (con `withAuthLockRetry`), `loadProfile` (heal perfil, staff invite, sync trial→blocked, `ensureOwnProfile` / invites), `refreshProfileSilent`, `handleSignOut`, `closePasswordRecovery`.

**Early-returns (orden):** ConfirmEmail → ResetPassword → authLoading → `!session` → AuthLanding → profileLoading → AthleteHome.

| Aislamiento | **Baja.** Es el corazón. Todo lo demás espera `session`/`profile`. No extraer pronto. |

---

### C. Lista de atletas + CRUD shell (~L834–949, handlers ~L1215–1303, wiring vistas) — **9 estados**

| Estado | Rol |
|---|---|
| `athletes` / `loadingAthletes` | Lista coach (+ staff) |
| `selectedAthlete` | Ficha Atletas (persistida) |
| `workoutsRefresh` | Tick para Athletes / Plan2Weeks / Gpx |
| `pendingRegistroWorkoutId` | Deep link → modal Registro |
| `showAddAthleteForm` / `newAthlete` / `planLimitWarning` | Form alta (Dashboard) |
| `staffParentCoachId` | Staff → parent coach (Library/Settings) |

**Lógica:** `loadAthletes` (+ lock retry), `saveNewAthlete`, `handleDeleteAthlete`, resume refresh, restore selected athlete.

| Aislamiento | **Media-baja.** Depende de `session`/`notify`; alimenta casi todas las vistas coach. Candidato a hook `useCoachAthletes` **después** de sacar overlays. |

---

### D. Navegación / tabs / vista activa (~L204–232, L297–310, L951–1028, L1096–1103, L1376–1401, chrome L1472–1853) — **2 estados (+ helpers)**

| Estado | Rol |
|---|---|
| `view` | Vista coach activa |
| `viewRestored` | Evita pisar `raf_lastView` al montar |

**Sin useState propio:** mapeo tabs Atletas/Entrenamientos (`TAB_KEY_*`), `coachNavItems` / `allowedCoachViews` / `hiddenViews`, `goCoachView` / `selectAthletesTab` / `selectTrainingTab`, sidebar + bottom nav, Suspense de vistas.

| Aislamiento | **Baja.** Enlaza deep links, plan picker CTAs, y todos los `view === "…"`. Dejar al final (o como `CoachChrome` que reciba `view`/`setView`). |

---

### E. Notificaciones push / FCM (~L239–295, effects L961–996, banner JSX ~L1537–1596) — **2 estados**

| Estado | Rol |
|---|---|
| `pushInviteDismissed` | Banner “Activa notificaciones” |
| `nativePushPermission` | Estado permiso nativo |

**Lógica:** `syncFcmTokenToProfile`, `dismissPushInvite`, `refreshNativePushPermission`, registro token post-login, foreground `onMessage` → `notify`.

| Aislamiento | **Media.** Depende de `session` + `notify`. Extraíble a hook/`PushInviteBanner` con callbacks. |

---

### F. Deep links coach + app links nativos (~L534–547, L1030–1094) — **1 estado + 1 ref**

| Estado / ref | Rol |
|---|---|
| `nativeDeepLinkTick` | Re-disparar apply cuando llega push link |
| `pendingCoachDeepLinkRef` | Buffer si athletes aún no cargaron |

**Lógica:** `initNativeAppLinks` / `applyAppLink`; `applyCoachDeepLink` (abre Atletas + `pendingRegistroWorkoutId`); consume URL/query.

| Aislamiento | **Media.** Depende de `athletes` + `setView` + `profile.role`. Buen candidato a hook junto con push, no solo. |

---

### G. Invite modal (invitar atleta) (~L451–532, JSX ~L1407–1470) — **4 estados**

| Estado | Rol |
|---|---|
| `inviteModalOpen` / `inviteEmail` / `inviteSending` / `lastInviteLink` | Modal + envío / link |

**Lógica:** `createInviteLink`, `generateInviteLink`, `sendAthleteInvitation`, `resolveCoachIdByCode` / código público (compartido con AuthLanding vía prop).

| Aislamiento | **Alta.** UI + handlers autocontenidos; inputs: `session`, `notify`, código coach. **Mejor primer extract** del shell restante. |

---

### H. Coach plan picker (suscripción / Wompi / promo) (~L312–449, flags UI ~L1362–1374, overlay JSX ~L1855–2196) — **8 estados**

| Estado | Rol |
|---|---|
| `coachPlanPickerVoluntary` | Apertura voluntaria (“Ver planes”) |
| `coachPickerPlan` / `coachPickerPeriod` | Selección |
| `coachSubscriptionSaving` | Busy pagar |
| `coachPromoInput` / `coachAppliedPromo` / `coachPromoError` / `coachPromoLoading` | Promo |

**Lógica:** `applyCoachPromo`, `handleCoachPlanPagarAhora` (`/api/wompi-create-checkout`), WhatsApp/Nequi, trial banner CTA → picker, blocked UI fullscreen.

**Nota:** bloque muerto `{false ? ( … setCoachPaymentModalOpen …)}` (~L2115+): modal legacy no montado; `setCoachPaymentModalOpen` **no tiene** `useState` (código inalcanzable). Limpieza barata al extraer el picker.

| Aislamiento | **Alta-media.** Mucho JSX + pocos callbacks desde fuera (`onGoToPlans`, trial, blocked). Ideal **segundo extract**. Depende de `profile`/`session`/`notify`. |

---

### I. Puente Builder / Library (~declaración L150–153; wiring ~L1759–1814) — **4 estados**

| Estado | Rol |
|---|---|
| `aiPrompt` (persisted) / `aiWorkout` / `aiLoading` | Builder |
| `libraryRefresh` | Invalidar biblioteca tras save |

| Aislamiento | **Alta.** Solo atraviesa Library→Builder (`onUseWorkout`). Mover con un mini-hook o dentro de un wrapper `TrainingViews` cuando se trocee chrome. |

---

### J. Toast global `notify` (~L154, L234–237, JSX L1406) — **1 estado**

| Estado | Rol |
|---|---|
| `notification` | Toast 3s |

Usado por push, invite, athletes CRUD, casi todas las vistas lazy.

| Aislamiento | Transversal (ver §4). |

---

### K. Chrome coach + wire de vistas (resto del `return`, ~L1403–2199) — **0 estados propios**

Sidebar, `InstallAppButton`, banners (push/trial), switch `view === …` con props a Dashboard/Athletes/…, bottom nav, plan picker overlay.

| Aislamiento | **Baja** como unidad; se adelgaza solo si G–I (y opcional E/F) salen primero. |

---

### Resumen de estados por sección (37)

| # | Sección | ~Lógica / JSX | Estados | ~Líneas orientativas |
|---|---|---|---|---|
| A | Prelude config | 1–143 | 0 | ~143 |
| B | Bootstrap sesión/perfil + gates | 549–832, 1127–1213, 1304–1356 | **6** | ~450–500 |
| C | Athletes list / CRUD shell | 834–949, 1215–1303 (+ syncs) | **9** | ~250–300 |
| D | Navegación / tabs / chrome | 204–232, 297–310, 951–1028, 1376–1853 | **2** | ~400+ (UI) |
| E | Push / FCM | 239–295, 961–996, 1537–1596 | **2** | ~120 |
| F | Deep links | 534–547, 1030–1094 | **1** (+ref) | ~90 |
| G | Invite modal | 451–532, 1407–1470 | **4** | ~150 |
| H | Plan picker | 312–449, 1855–2196 | **8** | ~400 |
| I | Builder/Library bridge | 150–153, 1759–1814 | **4** | ~80 (estado+wire) |
| J | Toast `notify` | 154, 234–237, 1406 | **1** | ~10 |
| K | Wire vistas (sin estado extra) | 1649–1824 | 0 | ~180 |

*Los rangos se solapan en el archivo (estado arriba, JSX abajo); la tabla es por responsabilidad, no por un único intervalo continuo.*

---

## 2) Aislamiento (matriz rápida)

| Sección | Independencia | Depende fuerte de |
|---|---|---|
| G Invite modal | Alta | `session`, `notify`, código coach |
| H Plan picker | Alta-media | `profile`, `session`, `notify` |
| I Builder/Library state | Alta | `notify`, `setView` al saltar a builder |
| E Push/FCM | Media | `session`, `notify` |
| F Deep links | Media | `athletes`, `view`, `profile` |
| C Athletes shell | Media-baja | `session`, `notify`; **salida** a casi todo |
| D Navegación/chrome | Baja | `profile`, `athletes`, todos los setters |
| B Bootstrap | Muy baja | Supabase; **entrada** a todo |

---

## 3) Orden recomendado de sub-extracciones

No un solo Paso 2: varios pasos pequeños, cada uno con map (si hace falta) → extract → build → commit.

| Paso | Qué sacar | Por qué primero / después |
|---|---|---|
| **1** | **Invite modal** → `InviteAthleteModal` (o similar) | Más aislado; ~4 estados; poco riesgo auth |
| **2** | **Coach plan picker** (+ consts precios/Nequi; borrar modal `{false}`) | 8 estados; JSX grande; CTAs quedan como `onOpenPlans` |
| **3** | **Push invite banner + sync FCM helpers** → hook `useCoachPush` / componente banner | Aclara shell; deep links pueden quedar o ir en 3b |
| **3b** (opcional mismo PR o siguiente) | **Deep links coach** → `useCoachDeepLinks` | Tras tener `setView`/`athletes` estables vía props |
| **4** | **Builder/Library bridge state** → hook o contenedor training | Reduce 4 estados del top-level |
| **5** | **Athletes list hook** (`useCoachAthletes` + CRUD) | Más delicado; toca Dashboard/Athletes props |
| **6** | **CoachChrome** (sidebar + bottom nav + main switch) | Solo cuando overlays y hooks ya salieron |
| **7 (último)** | **Bootstrap / AuthGate** (session, profile, early-returns) | Corazón; no mover hasta que el chrome sea fino |

Cada paso debería dejar App como orquestador que declara menos estado y pasa callbacks.

---

## 4) Riesgos transversales y Context vs props

### Lo que casi todo necesita

| Pieza | Hoy | Recomendación |
|---|---|---|
| `notify` | `useCallback` + 1 estado; prop a ~todas las vistas | **Candidato #1 a Context** (`ToastProvider` / `useNotify`) — API mínima, cero acoplamiento a perfil |
| `session` / `profile` | Dueños del bootstrap; props/selectores a hijos | **Candidato #2** a `Auth/SessionContext` **solo cuando** el chrome ya no sea monstruo; hasta entonces props desde App bastan |
| `athletes` / `setAthletes` / `selectedAthlete` | Bus compartido coach | Preferir hook + props a vistas; Context solo si el drilling duele tras pasos 1–5 |
| `styles` | Import `appShared` | Ya compartido; no Context |
| `withAuthLockRetry` | Bootstrap + loadAthletes | Queda en dueños de esas llamadas |

### ¿Conviene Context ya (con 37 estados)?

**Todavía no como “AppContext” gigante.** Un Context que meta los 37 estados recrearía el monolito.

Sí tiene sentido, **en paralelo o justo después del paso 1–2**:

1. **`NotifyContext`** (o hook de módulo) — gana inmediato, bajo riesgo.
2. Más adelante **`SessionProfileContext`** (session + profile + `refreshProfileSilent`) cuando AuthGate se estabilice.

Seguir con **prop drilling** para invite/picker/athletes en los próximos extracts: el mapa de props por vista ya es conocido y acotado.

### Otros riesgos

- **`loadProfile` es denso** (staff invite, trial sync, heal): al mover bootstrap, no “simplificar” mensajes ni orden.
- **Deep link vs `raf_lastView` / visibilitychange:** acoplamiento sutil con nav; documentar en el extract de deep links.
- **Código muerto plan picker** (`{false}` + `setCoachPaymentModalOpen`): limpiar al extraer H.
- **AthleteHome** solo recibe `profile`: no mezclar con chrome coach.

---

## 5) Checklist (cuando se valide el troceo)

- [ ] Paso invite modal  
- [ ] Paso plan picker (+ purge modal muerto)  
- [ ] Paso push (± deep links)  
- [ ] Decidir NotifyContext sí/no  
- [ ] Solo entonces athletes hook / CoachChrome / AuthGate  

**No mover código en este commit** — solo este documento.
