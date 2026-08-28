# Mapeo: Push/FCM + Deep links (coach) en App.jsx

Fecha: 2026-08-27  
HEAD de referencia: `2a91cbe` (`refactor: extract PlanPicker (Wompi/promo) from App shell`)  
Archivo: `src/App.jsx` (~1575 líneas post–PlanPicker)  
Contexto: `docs/shell-breakdown-map.md` §3 paso **#3** / **#3b**

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 0) Dos tuberías distintas (no mezclar)

| Tubería | Módulo de soporte | Qué transporta | ¿En este extract? |
|---|---|---|---|
| **Push FCM + deep link de notificación** | `src/lib/nativePush.js` + Firebase messaging (web) | Token → `device_tokens` / API; tap → `{ type, athlete_id, workout_id }` | **Sí** |
| **App Links de auth (correo)** | `src/lib/nativeAppLinks.js` | Ruta `/auth/…` cuando el WebView arranca en `/` | **No** (L297–313). Es auth, no push; el propio archivo dice que vive aparte a propósito |

El shell breakdown agrupa “push + deep links”; este mapa **sí** recomienda empaquetar Push/FCM + **coach push deep links**, y **dejar App Links fuera** (o un Paso 3c mínimo aparte).

---

## 1) Rangos exactos en App.jsx

### A. Push / FCM

| Pieza | Líneas | ~L | Rol |
|---|---|---|---|
| `pushInviteDismissed` | 157–159 | 3 | Banner “Ahora no” (`localStorage raf_push_invite_dismissed`) |
| `nativePushPermission` | 160 | 1 | Permiso Capacitor (WebView sin `Notification`) |
| `syncFcmTokenToProfile` | 201–229 | 29 | Web: permiso → `registerFcmToken`; nativo: `registerNativePush({ notify })` |
| `dismissPushInvite` | 231–234 | 4 | Persiste dismiss |
| `refreshNativePushPermission` + effect | 241–249 | 9 | Sync permiso al tener sesión |
| Derivados `showPushInvite` | 251–257 | 7 | Condición del banner |
| Effect registro token post-sesión | 727–744 | 18 | Arranque / rotación FCM (`refreshFcmTokenIfGranted` o `registerNativePush`) |
| Effect `onMessage` (web foreground) | 746–762 | 17 | Toast título; **no** en nativo (lo cubre `nativePush.js`) |
| JSX banner permiso | 1246–1305 | **60** | “Activa las notificaciones” / Activar / Ahora no |

**Estados Push propios: 2** (`pushInviteDismissed`, `nativePushPermission`).

**Relacionado pero fuera del bloque UI:** limpieza FCM en `handleSignOut` (`unregisterOwnDeviceToken`, `profiles.fcm_token = null`, `clearNativePush`) — pertenece al **sign-out / bootstrap**, no mover con el banner.

### B. Deep links coach (desde push / URL `?open=coach_*`)

| Pieza | Líneas | ~L | Rol |
|---|---|---|---|
| `pendingCoachDeepLinkRef` | 796 | 1 | Buffer si `athletes` aún no tiene el `athlete_id` |
| `nativeDeepLinkTick` | 797 | 1 | Despierta el efecto cuando hay tap con app ya montada |
| Effect `subscribeDeepLink` | 802–805 | 4 | Contador ← plugin nativo |
| `applyCoachDeepLink` | 812–828 | 17 | `setView("athletes")`, selecciona atleta, opcional `setPendingRegistroWorkoutId` |
| Effect consume URL / pending / consumePendingDeepLink | 833–860 | 28 | Tres orígenes; limpia query params |

**Estados Deep propios: 1** (`nativeDeepLinkTick`) + **1 ref**.

**Estado tocado pero dueño Athletes/shell:** `pendingRegistroWorkoutId` (declarado ~L122) — el deep link solo lo **setea**; Athletes lo consume vía `openRegistroWorkoutId`.

### C. App Links auth (mencionar, no extraer aquí)

| Pieza | Líneas | ~L |
|---|---|---|
| Effect `initNativeAppLinks` / `consumePendingAppLink` / `applyAppLink` | 297–313 | 17 |

---

## 2) SDKs / almacenamiento

### Push / FCM

| Capa | Uso |
|---|---|
| **Firebase** (`firebase.js`: `initMessaging`, `onMessage`, `requestNotificationPermission`, `refreshFcmTokenIfGranted`, `clearFcmToken`) | Solo **web** |
| **Capacitor** `@capacitor/push-notifications` vía `nativePush.js` | Solo **APK** |
| **appShared** | `registerFcmToken` / `registerFcmTokenDetailed` → `POST /api/register-fcm-token`; escribe **`device_tokens`** (y verifica); legacy/`profiles.fcm_token` en flujos de logout/read |
| **Supabase directo en App (push)** | No en el registro (pasa por API). Logout sí toca `profiles.fcm_token` |

### Deep links coach

| Capa | Uso |
|---|---|
| `nativePush.js` | Guarda `pendingDeepLink` en tap (`pushNotificationActionPerformed`); `consumePendingDeepLink("coach_")`; `subscribeDeepLink` |
| URL web | `?open=coach_*&athlete_id=&workout_id=` |
| Supabase | **Ninguna** query en el apply; solo estado React (`view`, `selectedAthlete`, `pendingRegistroWorkoutId`) |

---

## 3) Interacción con `pendingRegistroWorkoutId` y navegación

```
Tap push / URL ?open=coach_workout_completed
        ↓
applyCoachDeepLink(data)
        ↓
setView("athletes") + raf_lastView=athletes + viewRestored=true
        ↓ (si type === coach_workout_completed && workout_id)
setPendingRegistroWorkoutId(workout_id)
        ↓
Athletes openRegistroWorkoutId → modal Registro → onRegistroOpened limpia
```

Si `athlete_id` no está aún en `athletes` → `applyCoachDeepLink` retorna `false` → destino en `pendingCoachDeepLinkRef` → reintento cuando `athletes` cambia (dep del effect).

Otros destinos: cualquier `open` con prefijo `coach_` navega a Atletas; solo el tipo `coach_workout_completed` abre el modal de registro.

**Atleta:** destinos `athlete_*` los consume **AthleteHome** (u otro) con otro prefix; App coach usa solo `"coach_"`.

---

## 4) Dependencias App ↔ bloques

### Push → necesita de App

| In | Uso |
|---|---|
| `session` / `authLoading` | Cuándo registrar token |
| `notify` | Toast + `registerNativePush({ notify })` |
| Capacitor / imports ya listados | — |

### App → Push (salidas)

| Out | Uso |
|---|---|
| `syncFcmTokenToProfile` | **`AuthLanding onLoginSuccess`** + botón “Activar” del banner |
| Banner JSX | Chrome coach (post-sesión) |

### Deep links → necesita de App

| In | Uso |
|---|---|
| `profile` (rol ≠ athlete) | Gate |
| `athletes` | Resolver `athlete_id` |
| Setters nav | `setView`, `setSelectedAthlete`, `setViewRestored`, `setPendingRegistroWorkoutId` |

### Props/callbacks si se extrae (recomendado)

**Opción hook `useCoachPushAndDeepLinks({ session, authLoading, profile, athletes, notify, setView, setSelectedAthlete, setViewRestored, setPendingRegistroWorkoutId })`:**

- Retorna: `{ showPushInvite, syncFcmTokenToProfile, dismissPushInvite, refreshNativePushPermission, PushInviteBanner }` o JSX banner aparte.
- Deep link effects viven **dentro** del mismo hook (comparten ciclo de vida con registro nativo).

**AuthLanding:** sigue recibiendo `onLoginSuccess={syncFcmTokenToProfile}` desde App (App re-exporta el callback del hook).

Prop drilling / un solo hook: suficiente; no hace falta Context.

---

## 5) Riesgos: foreground / background / killed

La lógica crítica de los **3 estados** vive sobre todo en **`nativePush.js`** (pendiente + subscribers). App solo **consume**.

| Estado app | Qué pasa hoy | Riesgo al extraer App |
|---|---|---|
| **Foreground** | Web: `onMessage` → toast. Nativo: listener en `nativePush.js` (no Firebase). Tap: `subscribeDeepLink` → tick → effect apply | Mover `onMessage` + subscribe **juntos**; no omitir el tick |
| **Background** | Tap → plugin → `pendingDeepLink` + notify subscribers → tick / consume | Si el hook no monta `subscribeDeepLink` al inicio, se pierde el “despertar” |
| **Killed / cold start** | Destino en `pendingDeepLink` **antes** de React; effect de App hace `consumePendingDeepLink` cuando hay `profile` + `athletes` | El effect debe seguir dependiendo de `[profile, athletes, …, nativeDeepLinkTick]`; no consumir demasiado pronto (sin atletas) |

Riesgos adicionales:

1. **Carrera con `raf_lastView` / visibilitychange:** `applyCoachDeepLink` fuerza `raf_lastView=athletes` y `viewRestored=true` a propósito — no “simplificar”.
2. **`pendingRegistroWorkoutId`:** si el hook no recibe el setter, se rompe el modal Registro.
3. **Doble registro de listeners** en `nativePush` si se llama mal `registerNativePush` — respetar el patrón actual (idempotente en el lib).
4. **No meter App Links** en el mismo módulo: distinto payload y distinto momento (auth vs coach UI).

---

## 6) ¿Juntos o separados?

**Recomendación: extraer juntos (un hook + banner), en un solo Paso 2.**

| Motivo | Detalle |
|---|---|
| Misma tubería nativa | `nativePush.js` ya une registro FCM y `pendingDeepLink` del tap |
| Mismo ciclo de vida | Sesión coach montada → registrar token **y** estar listo para consumir destino |
| Menos props rotas | Un hook evita olvidar `subscribeDeepLink` al sacar solo el banner |
| App Links fuera | Evita mezclar auth email con push coach |

**Separar** solo tendría sentido si se quisiera un banner web-only sin tocar deep links; aquí el riesgo de romper cold-start es mayor que el beneficio.

Nombre sugerido: `src/hooks/useCoachPushDeepLinks.js` + opcional `src/components/PushInviteBanner.jsx`.

---

## 7) Conteo final a extraer

| Bloque | ~Líneas |
|---|---|
| Push estado + sync + dismiss/refresh + derivados | ~50 |
| Effects token + onMessage | ~35 |
| Banner JSX | ~60 |
| Deep ref/tick + apply + effect | ~65 |
| **Total Push + Deep coach** | **~200–220** |
| App Links auth (excluido) | ~17 |
| Sign-out FCM cleanup (excluido) | ~20–30 |

Shell breakdown hablaba de ~120 (push) + ~90 (deep); con banner y syncFCM el techo real es **~210**.

---

## Checklist Paso 2 (cuando se valide)

- [ ] Hook: syncFCM + effects token/onMessage + subscribeDeepLink + applyCoachDeepLink + consume
- [ ] Banner con Activar / Ahora no
- [ ] App: `onLoginSuccess={syncFcmTokenToProfile}`; cablear setters nav / `pendingRegistroWorkoutId`
- [ ] **No** mover `nativeAppLinks` en el mismo PR (salvo PR aparte mínimo)
- [ ] Smoke: permiso banner; login → token; tap push cold/warm → Atletas (+ Registro si workout); web `?open=coach_…`
- [ ] Build limpio; sign-out sigue limpiando token
