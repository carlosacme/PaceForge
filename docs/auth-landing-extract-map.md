# Mapeo: extracción del auth landing desde App()

Fecha: 2026-08-27  
HEAD de referencia: `40a3e1a` (`chore: remove dead prelude helpers and unused App imports`)  
Archivo: `src/App.jsx` (~3245 líneas / ~3115 no vacías)  
Contexto: `docs/app-extract-map-v2.md` §3 orden **#6** (Auth landing / login UI)

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 1) ¿Componente separado o JSX inline?

**JSX inline** dentro de `export default function App()`, no hay `function AuthLanding`.

Flujo de early-returns en orden (todas **antes** del chrome coach):

| # | Condición | Líneas | Qué es |
|---|---|---|---|
| 1 | `CONFIRM_EMAIL_ROUTE` | **1737–1738** | Ya módulo: `<ConfirmEmailScreen />` |
| 2 | `passwordRecovery` | **1742–1748** | Ya módulo: `<ResetPasswordScreen …/>` |
| 3 | `authLoading` | **1751–1758** | Spinner “Cargando sesión…” |
| 4 | `!session` | **1761–2381** | **Auth landing + marketing** (este extract) |
| 5 | `profileLoading` | **2383–2390** | Spinner perfil (post-sesión) |
| 6 | `profile.role === "athlete"` | **2393–2398** | `<AthleteHome />` |

**Bloque a extraer (núcleo):** el early-return `if (!session) { … }` = **L1761–2381 (~621 líneas de JSX)**.

Incluye dos modos:
1. `landingAuthOpen === true` → formularios **choice / login / register** (+ forgot password UI).
2. `landingAuthOpen === false` → **landing marketing** (hero, CTAs “Iniciar sesión / Crear cuenta”, modal demo).

**Handlers / lógica a mover con el UI** (viven arriba en `App()`, no dentro del JSX):

| Símbolo | Líneas | ~L |
|---|---|---|
| `handleResendConfirmation` | 1199–1228 | 30 |
| `handleAuthSubmit` | 1230–1531 | **302** |
| `handleForgotPasswordClick` | 1623–1646 | 24 |
| Efecto invite URL → abre register | 645–666 | 22 |
| Efecto post-delete cuenta → login | 629–643 | 15 |

`closePasswordRecovery` (1595–1621) **no** es solo del landing: también cablea `ResetPasswordScreen`. En extract: dejar en App y pasar callbacks, o mover a un pequeño `authRecovery.js` compartido.

**ConfirmEmail / ResetPassword:** ya extraídos; **no** cuentan en el “auth landing” salvo como vecinos en el árbol de early-returns. El Paso 2 puede dejarlos en App o envolverlos en un `AuthGate` shell.

---

## 2) Estado local y ciclo de vida

### Early-return (sí)
App **no** monta sidebar/nav/Dashboard mientras `!session`. El auth landing es un **return completo** del render de `App()`, no un panel condicional junto al chrome.

Tras `signInWithPassword` / `signUp` con sesión, `onAuthStateChange` / `setSession` en el bootstrap hace que el siguiente render **salga** del bloque `!session` y continúe a carga de perfil / coach UI. El landing **no** recibe la sesión por prop: reacciona al estado `session` del padre.

### `useState` propios del flujo auth (en `App()` hoy)

| Estado | Uso |
|---|---|
| `authMode` | `"login"` \| `"register"` |
| `authEmail` / `authPassword` | Forms |
| `authError` / `authInfo` | Mensajes UI |
| `authSubmitting` / `authCanResend` / `authResending` | Submit / reenvío confirmación |
| `landingAuthOpen` | Marketing vs forms |
| `authLandingStep` | `"choice"` \| `"login"` \| `"register"` |
| `authRole` / `authName` / `authCoachCode` | Registro |
| `inviteCodeFromUrl` / `inviteParentCoachId` | Invite link / staff |
| `demoModalOpen` | Modal demo en marketing |
| `passwordRecovery` | Gate a `ResetPasswordScreen` (vecino) |

Relacionados pero **dueños del shell** (no mover por defecto): `session`, `authLoading`, `profile`, `notify`, bootstrap `getSession` / `onAuthStateChange`.

### Effects que tocan el landing
- Invite `?invite=` → `setLandingAuthOpen(true)` + register (L645–666).
- `raf_account_deleted` → login abierto con mensaje (L629–643).
- Bootstrap sesión (L~560–627): **permanece en App**; usa `withAuthLockRetry` en `getSession`.

---

## 3) Dependencias: qué necesita el auth landing

### Auth Supabase (desde handlers)
| API | Dónde |
|---|---|
| `supabase.auth.signInWithPassword` | login |
| `supabase.auth.signUp` (+ `emailRedirectTo` → `CONFIRM_EMAIL_PATH`) | register |
| `supabase.auth.resetPasswordForEmail` | forgot |
| `supabase.rpc("find_invitation_by_code")` | invite en register |
| **No hay OAuth** (`signInWithOAuth` ausente) | — |

### appShared ya usados
`resendSignupConfirmation`, `ensureOwnProfile`, `stashPendingInviteCode`, `acceptPendingInvitationIfAny`, `userFacingError`, `BRAND_NAME`, `styles` (importados en App).

### Callbacks / datos desde el shell
| Necesidad | Origen en App |
|---|---|
| `resolveCoachIdByCode` | callback App (RPC `find_coach_by_code`) — register manual |
| `syncFcmTokenToProfile` | post-login exitoso |
| `notify` | toast tras recovery / mensajes |
| `inviteCodeFromUrl` / staff pending | URL + localStorage |
| Sesión resultante | **no prop**: Supabase auth → `setSession` en bootstrap App |

Tras login/signup, el landing **no** setea `session` a mano (salvo flujos internos de ensureOwnProfile con token); el shell escucha auth y carga perfil.

### Sincronización “de vuelta” a App
| Evento | Efecto en App |
|---|---|
| Login OK | `onAuthStateChange` → `session` → sale de `!session` → `loadProfile` |
| Signup con sesión | Igual + `ensureOwnProfile` / invite accept en submit |
| Signup sin sesión (email confirm) | Mensaje + modo login; usuario va a ConfirmEmail |
| Forgot password | Email enviado; recovery UI vía `passwordRecovery` / URL |

---

## 4) Compartido con módulos / appShared / auth-lock

| Pieza | Landing | Shell / otros |
|---|---|---|
| `withAuthLockRetry` | **No** en `signIn`/`signUp`/`resetPassword` | Sí en `getSession`, `loadProfile`, `loadAthletes` |
| `userFacingError` | Sí | Global |
| `ensureOwnProfile` / invite helpers | Sí (register) | También post-login en `loadProfile` si falta perfil |
| `ConfirmEmailScreen` / `ResetPasswordScreen` | Vecinos early-return | Ya módulos |
| `resolveCoachUserIdFromPublicCode` (appShared) | No (landing usa `resolveCoachIdByCode` local) | AthleteHome |

**Duplicación de sesión:** el landing **no** reimplementa bootstrap; dispara auth API y deja que el listener del shell actualice `session`. Bien para extract: no mover `getSession`/`onAuthStateChange` al landing.

---

## 5) Riesgos seguridad / UX / deep links

1. **Errores auth:** lógica delicada (email no confirmado vs credentials inválidos + `authCanResend`). Mover **íntegro** `handleAuthSubmit` / resend; no reescribir mensajes.
2. **Signup identities vacío:** detecta “correo ya registrado” sin filtrar enumeración de GoTrue — conservar.
3. **Redirects:** `emailRedirectTo` → `/auth/confirm`; recovery → `/?type=recovery`. No romper `CONFIRM_EMAIL_PATH` / hash recovery.
4. **Invite link:** efecto URL debe seguir abriendo register (mover efecto con el módulo o pasar `initialInvite` desde App).
5. **`pendingRegistroWorkoutId` / `applyCoachDeepLink`:** solo coach **ya autenticado** (L1112+). **No interactúa** con el auth landing. Safe.
6. **Staff invite** (`pendingStaffInvite` en localStorage): se escribe en efecto invite y se consume en `loadProfile` — al extraer, no cortar esa cadena.
7. **FCM post-login:** `syncFcmTokenToProfile()` tras login — inyectar como callback `onLoginSuccess` desde App.
8. **Sign-out** limpia `landingAuthOpen` / step — queda en App (`handleSignOut`).

---

## 6) ¿Auth-lock retry en el landing?

| Llamada | ¿Retry hoy? | Recomendación |
|---|---|---|
| `signInWithPassword` / `signUp` / `resetPasswordForEmail` | No | **Opcional / bajo valor**: no pasan por el mismo path de `navigator.locks` que `getSession`/`getUser` en multi-tab; el error típico aquí es credenciales, no steal. |
| RPCs invite / `ensureOwnProfile` dentro del submit | No | Si `ensureOwnProfile` hace `getUser`/`getSession`, **sí** conviene `withAuthLockRetry` ahí (o dentro del helper en appShared). |
| Bootstrap `getSession` (App) | **Ya** | No tocar en este extract. |

Conclusión: **no es obligatorio** envolver signIn/signUp; sí revisar `ensureOwnProfile` una vez. No bloquear el extract por retry en forms.

---

## 7) Dependencias App ↔ AuthLanding (prop drilling)

Diseño recomendado (prop drilling / callbacks, sin Context):

**App → AuthLanding (~10–14 props):**

| Prop | Dirección |
|---|---|
| `styles` / o import interno | — |
| `notify` | ↓ |
| `inviteCodeFromUrl` (+ staff parent si aplica) | ↓ |
| `resolveCoachIdByCode` | ↓ |
| `onLoginSuccess` → `syncFcmTokenToProfile` | ↓ |
| (opcional) `initialStep` / `forceOpen` desde efectos URL | ↓ |

**AuthLanding → App:** **0 props de sesión**. Éxito de login = efecto lateral en Supabase → App ya escucha.

Si se mueven **todos** los `useState` de form al módulo, App solo necesita efectos URL que seteen props iniciales (`openRegisterWithInvite(code)`).

Alternativa mínima (más props): dejar estado en App y pasar setters — peor API (~20+ props). **Preferir estado local en AuthLanding.**

---

## 8) Conteo final a extraer

| Pieza | ~Líneas |
|---|---|
| JSX `if (!session)` (1761–2381) | **621** |
| `handleAuthSubmit` | **302** |
| `handleResendConfirmation` + `handleForgotPasswordClick` | **54** |
| Efectos invite + account-deleted (si se mueven) | **~37** |
| **Total orientativo** | **~980–1015** |

Alineado con v2 (“~600–900”); el submit pesado empuja el techo a **~1000**.

**Destino sugerido:** `src/components/AuthLanding.jsx` (o `Auth/AuthLanding.jsx` + index).  
Wire en App:

```jsx
if (!session) {
  return (
    <AuthLanding
      notify={notify}
      inviteCodeFromUrl={inviteCodeFromUrl}
      inviteParentCoachId={inviteParentCoachId}
      resolveCoachIdByCode={resolveCoachIdByCode}
      onLoginSuccess={syncFcmTokenToProfile}
    />
  );
}
```

(Early returns ConfirmEmail / ResetPassword / authLoading quedan en App o en un wrapper `AuthGate`.)

---

## Checklist Paso 2 (cuando se valide)

- [ ] Extraer JSX `!session` + handlers submit/resend/forgot
- [ ] Estado de forms vive en el módulo (o documentar props si se deja en App)
- [ ] Preservar invite URL + account-deleted messaging
- [ ] Smoke: login, register coach/athlete, invite link, forgot password, confirm email route
- [ ] Build limpio; sin romper bootstrap `withAuthLockRetry` del shell
- [ ] Confirmar que deep link registro workout sigue solo post-sesión coach
