# Auditoría completa v2 — RunningApexFlow / PaceForge

Fecha: **2026-08-29**  
HEAD de referencia: `aa609fc` (`master`) — *strip stale /km paces from description on VDOT rescale*  
Audit anterior: `docs/full-audit-2026-08.md` (HEAD `7da716a`, commit del doc `950f4c5`)  
Alcance: codebase actual (`src/`, `api/`, `lib/`, `supabase/`, `public/`) — **solo lectura**  
Prod Supabase: **no se re-consultó** advisors ni `pg_class` en esta pasada (sin service_role local). El inventario de tablas se confirma por migraciones del repo.

Este documento no propone patches aplicados; prioriza impacto real (dinero, datos, usuarios) vs deuda incremental.

---

## Qué cambió desde el audit anterior (contexto)

Commits relevantes entre `7da716a` y `aa609fc`:

| Área | Commits | Efecto en hallazgos |
|---|---|---|
| Headers Supabase REST | `b1852c1`, `575a2d6` | REST admin ya no manda Bearer ciego; `adminHeaders()` pone Bearer **solo** si la key es JWT legacy (`eyJ…`). |
| `.gitignore` / `.env.example` | `b1852c1` | `.env` se ignora de verdad; plantilla sin secretos reales. |
| Descripción vs ritmo rescalado | `aa609fc` | `rescaleStructureToVdot` ahora recorta `m:ss/km` embebido en `description`. Filas ya asignadas **no** se reescriben. |
| Split App.jsx | varios extracts previos + chrome/hooks | `App.jsx` ~745 → **704** líneas. Los monolitos **fuera** de App no se partieron. |
| GPX / mapa | `4ab7694`, `884e435` | Superficie nueva: `GpxRacePlan`, `WorkoutRouteMap`, `structureHasGradePct`. |
| Push al completar | `9527286`, `0065_*.sql` | Columna `workouts.coach_completion_notified_at` (no es tabla nueva). |

`Athletes.jsx` se **movió** a `src/components/Athletes/Athletes.jsx` (re-export). El archivo sigue siendo el mismo monolito.

---

## Resumen ejecutivo

El riesgo principal **sigue** siendo dinero y cuota de IA, no el monolito de App.jsx.

1. **Pagos Wompi** — el servidor **sigue** firmando el `amount_cop` del cliente. Sin cambio.
2. **Proxies Anthropic** — `generate-workout` sigue sin rate-limit/plan. Además, `analyze-workout` `mode=briefing` reenvía el prompt del cliente (mismo patrón de quema).
3. **`.gitignore` de `.env`** — **resuelto**.
4. **Monolitos restantes** — `Athletes.jsx` / `AthleteHome.jsx` / `appShared.js` **no bajaron de tamaño**. Athletes ahora además importa Leaflet (`WorkoutRouteMap`) en el chunk eager del coach.

RLS: el repo **no añade tablas** desde el audit anterior (siguen las 29). No se re-verificó `rls_enabled` en prod. Views SECURITY DEFINER, grants de lookup y drift de `0064` siguen iguales en el repo.

---

## Tabla maestra — qué pasó con cada hallazgo del audit 2026-08

Leyenda: **Igual** · **Resuelto** · **Parcial** · **Cambió** (sigue abierto, pero el detalle no es el mismo) · **No re-verificado en prod**

### 1) Seguridad — RLS / base de datos

| Hallazgo original | Estado | Evidencia actual |
|---|---|---|
| 29 tablas públicas con RLS ON | **No re-verificado en prod** / inventario repo **igual** | Ningún `CREATE TABLE` nuevo. `0065` solo añade columna a `workouts`. Lista de 29 sin cambio. |
| `oauth_states`: RLS ON, 0 policies | **Igual** | `0042_device_connections_oauth.sql` sigue sin `CREATE POLICY`. Solo service_role (correcto si el OAuth no toca la tabla desde el cliente). |
| Views SECURITY DEFINER (`coach_public`, `user_names`, `athlete_device_status`) | **Igual** | Defs en `0045`, `0054`, `0058`. `0064` endurece `coach_public` pero el archivo del repo sigue diciendo “NO APLICAR”. |
| `upsert_profile`: EXECUTE solo `service_role` en prod; repo `0039` GRANT a `authenticated`; `0064` “no aplicar” | **Igual** (drift repo↔prod) | `0064` líneas 127–133 revoca anon/authenticated y GRANT solo `service_role`. Header del archivo **sigue** “NO APLICAR”. `create-profile.js` usa JWT del usuario, no `user_id` del body. |
| `accept_invitation_by_code` exige sesión + email | **Igual** | Hardening en `0064`; `0056` aún GRANT a `anon` (el endurecimiento está en el borrador 0064). |
| `delete_own_account()` executable por anon (advisor) | **Igual** en repo | `0049` REVOKE PUBLIC + GRANT `authenticated`. Sigue `auth.uid()` obligatorio. Sin REVOKE explícito de `anon` post-0049. |
| `find_coach_by_code` / `find_invitation_by_code` por anon | **Igual** | `0056` GRANT a `anon, authenticated`. Cliente sigue llamando RPC (`App.jsx` ~205, `appShared.js` ~2893). Sin rate-limit de edge. |
| `ADMIN_EMAIL` + `PLATFORM_ADMIN_USER_ID` en cliente | **Igual** | `appShared.js:1551–1553`. Usado en `useCoachNavigation.js`, `CoachChrome.jsx`, `ChallengesHub.jsx`, `AdminMarketplacePanel.jsx`. `is_admin()` en SQL (`0035`) es el **mismo UUID** hardcodeado. |
| Catálogo `achievements` SELECT amplio | **Igual** | Policy histórica; catálogo no sensible. |
| `subscription_payments`: SELECT own/admin; insert service_role | **Igual** | El riesgo sigue siendo el **monto** en create-checkout, no el SELECT. |

**Tablas (29) — mismo inventario:** athletes, workouts, coaches, profiles, training_plans, messages, workout_library, promo_codes, coach_profiles, athlete_evaluations, achievements, athlete_achievements, athlete_payments, ai_generations, races, invitations, coach_requests, plan_drafts, challenges, challenge_participants, plan_marketplace, plan_purchases, subscription_payments, coach_staff, staff_athletes, device_connections, oauth_states, push_deliveries, device_tokens.

### 1.2 Claves y secretos

| Hallazgo original | Estado | Evidencia actual |
|---|---|---|
| `.gitignore` ignoraba la cadena `".env"` (con comillas) | **Resuelto** | `.gitignore:27–29`: `.env`, `.env.*`, `!.env.example`. `git check-ignore -v .env` → `.gitignore:27:.env`. `.env` no está tracked. |
| Firebase web `apiKey` embebida | **Igual** | `src/lib/firebaseMessaging.js:5`, `public/sw.js`. Esperado; impacto = restricciones GCP. |
| `android/app/google-services.json` `current_key` | **Igual** | Esperado en Android. |
| Server secrets solo `process.env` | **Igual** | Sin service_role en fuente. |
| Admin email en fuente | **Igual** | Ver arriba. |

### 1.3 Endpoints `/api/*`

| Hallazgo original | Estado | Evidencia actual |
|---|---|---|
| **Wompi `amount_cop` del body** (mín. 5000; firma + PENDING usan ese monto) | **Igual — crítico** | `api/wompi-create-checkout.js:63–67,96`. Cliente: `PlanPicker.jsx:140`, `AthleteHome.jsx:901`, `MarketplaceHub.jsx:252`. Webhook (`wompi-webhook.js`) sigue leyendo el monto de la fila PENDING. |
| `/api/generate-workout` sin rate-limit / plan / tope de coste | **Igual — alto** | `api/generate-workout.js`: `requireUser` → reenvía el body a Anthropic (`max_tokens` hasta 32k). Sin plan/trial. |
| POST `/api/achievements` `achievement_code` arbitrario | **Igual** | `api/achievements.js:45–58`. Sigue `canAccessAthlete` (IDOR cerrado); integridad de gamificación abierta. |
| `send-push` cron + `areRelated` | **Igual — OK** | Cron `CRON_SECRET`; POST user con relación. |
| `send-email` plantillas + escape | **Igual — OK** | Sin HTML libre. |
| `create-profile` user_id del JWT | **Igual — OK** | `api/create-profile.js:26–28`. |
| `analyze-workout` coste IA, “scoped a workout permitido” | **Cambió** (peor de lo que decía el audit) | `getWorkoutIfAllowed` **solo** en `adjust-steps` (`:361`). `analyze` / `adjust` / `briefing` = `requireUser` y **body del cliente**. `mode=briefing` reenvía `briefingPrompt` a Claude (`:155–164`) — segundo proxy Anthropic. Prompt de `analyze` **no** incluye `structure` / `target_pace`. |
| `wompi-webhook` HMAC + monto de DB | **Igual — OK** (si create-checkout fijara precios) | Firma intacta. El agujero sigue siendo create-checkout. |
| `integrations.js` superficie grande | **Igual** (archivo más grande) | ~1193 líneas. Auth: `requireUser` + `canAccessAthlete`. |
| `weather.js` auth + cuota OpenWeather | **Igual — bajo** | `requireUser`; lat/lon validados. |

### 1.4 Inputs de usuario → Supabase

| Hallazgo original | Estado | Notas |
|---|---|---|
| Insert atleta: trim, sin sanitizar HTML | **Igual** | `useCoachAthletes.js` `saveNewAthlete`. |
| Chat texto libre | **Igual** | `Athletes.jsx` ~1997. Push fallido sigue en `.catch(() => {})` (`:2027`). |
| FC / pagos validación numérica | **Igual** | |
| Invite / promo server-side | **Igual** | |

### 1.5 Dependencias (`npm audit`)

| Original (2026-08) | Ahora | Estado |
|---|---|---|
| 33 paquetes / 66 vulns agregadas; 3 critical, 16 high | **33 vulnerabilities** (1 low, 13 moderate, **16 high**, **3 critical**) | **Igual en clase**; el recuento npm cambió (ya no reporta “66 agregadas”). Runtime `--omit=dev`: **20** (11 mod, 6 high, 3 critical). Critical: `tar`, `websocket-driver`. High runtime: `react-router` / `react-router-dom`, `ws`. |

---

### 2) Performance

| Hallazgo original | Estado | Evidencia actual |
|---|---|---|
| `Athletes.jsx` eager en CoachChrome + `jspdf` | **Igual**, con peso extra | `CoachChrome.jsx:2` `import Athletes`. `Athletes.jsx:2` `import { jsPDF } from "jspdf"`. **Nuevo:** `import WorkoutRouteMap` (`:7`) — Leaflet en el grafo del ficha, no lazy. |
| AthleteHome / Plan2Weeks / AdminMarketplace lazy | **Igual — bien** | `App.jsx:30`; `CoachChrome.jsx:16–23`. |
| `AthleteHome` `workouts select("*")` completo | **Igual — alto** | `AthleteHome.jsx:1224` (y `:420`). |
| Dashboard: una query semanal | **Igual — bien** | `Dashboard.jsx:97–102`. Sigue `select("*")` de la semana (aceptable vs N+1). |
| Lista Athletes: batch devices / km / unread | **Igual — bien** | Patrón anti-N+1 intacto. |
| ChallengesHub queries secuenciales | **Parcial** | Carga inicial ya usa `Promise.all` (`:90`, `:154`). Sigue `select("*")` de `challenge_participants` y varios `console.error` en subqueries. **Mejora UX:** `notify` si falla la carga (`:94`). |
| CoachSettings `Promise.all` por staff | **Igual** | `:268`. |
| Builder `map(async)` | **Igual** | Insert batch + `Promise.all` de emails (`:229`). |
| `public/pwa-512.png` ~806 KB | **Igual** | 825 443 bytes. |
| Bundle main >500 KB gzip warning | **No re-medido** (no se corrió build) | El grafo de Athletes + jsPDF + Leaflet **empeora** la hipótesis, no la mejora. |
| Memoización | **Igual** | No priorizar. |

### 3) Bugs

| Hallazgo original | Estado | Evidencia actual |
|---|---|---|
| Form “Nuevo atleta” inalcanzable (`setShowAddAthleteForm(true)` no existe) | **Igual** | Grep: ningún `setShowAddAthleteForm(true)` en `src/`. Dashboard “＋ Nuevo Atleta” → `setInviteModalOpen(true)` (`CoachChrome.jsx:256`). El form + `saveNewAthlete` siguen cableados. |
| Catch vacío / solo `console` (Athletes 855, 1023; appShared FCM) | **Igual** | `:855` localStorage análisis; `:1023` persist análisis; `:2027` push chat silencioso. Analyze coach: `console.error` sin toast (`:1026`). |
| Challenges / PlanPicker error sin toast | **Parcial — mejoró** | `PlanPicker` ahora `notify` en fallo de checkout (`:145–162`). `ChallengesHub` notifica carga/crear/unir. AthleteHome checkout usa `setMessage` (`:904`). Quedan fallos solo-consola (chat atleta, carreras, etc.). |
| `delete_own_account` callable anon | **Igual** (superficie) | Falla sin sesión. |
| Drift comentarios `0064` “NO APLICAR” vs prod | **Igual** | Header `0064:1–15` sin cambio. |
| 15+ `useEffect` en Athletes | **Igual / empeoró el conteo** | **23** `useEffect(` en `Athletes.jsx`. |
| Admin gate email + role | **Igual** | `useCoachNavigation.js:67,95`. |

### 4) Deuda técnica

| Hallazgo original | Estado | Tamaño ahora (líneas no vacías, `Measure-Object -Line`) |
|---|---|---|
| Gigantes fuera de App | **Igual** | `Athletes.jsx` **3738** (igual; solo cambió de carpeta). `AthleteHome.jsx` **2238** (igual). `appShared.js` **2808** (igual; prelude/styles se **metieron aquí**, no se partieron). `Plan2Weeks.jsx` **2046**. `WorkoutLibrary.jsx` **1286**. `AuthLanding.jsx` **1091**. |
| `appShared.js` cajón de sastre | **Igual** | Styles, admin IDs, FCM, VDOT, email, invites. |
| Prop drilling CoachChrome (~50 props) | **Igual** | `App.jsx:691–743` sigue pasando el bundle completo. Invite/plan state **sigue en App** (`:103–104`). |
| Estados residuales invite/plan en App | **Igual** | No se movieron a Chrome. |
| Duplicación `find_coach_by_code` | **Igual** | `App.jsx` ~205 y `appShared.js` ~2893. |
| Dead path form alta Dashboard | **Igual** | |
| Athletes eager vs resto lazy | **Igual** | |
| Repo migrations vs prod (`0064`) | **Igual** | |

`App.jsx`: ~745 → **704**. El split posterior (chrome, hooks, InviteModal, PlanPicker) **sí** recortó el shell; **no** tocó los tres gigantes que el audit pedía partir.

---

## 2) Barrido de seguridad sobre lo reciente

### 2.1 Headers `service_role` (REST)

**Arreglado en el camino REST** que usó el 403 de RLS:

- `lib/apiAuth.js` `adminHeaders()`: `apikey` = service key; `Authorization: Bearer` **solo** si la key empieza por `eyJ`.
- `serviceHeaders` / `sbGet` delegan ahí.
- `api/integrations.js` `sbHeaders` → `adminHeaders`.
- `api/achievements.js`, `api/analyze-workout.js` (adjust-steps) usan `adminHeaders()`.

`requireUser` **correctamente** sigue con `apikey` = anon + `Authorization` = JWT del usuario.

**No quedó el patrón roto “Bearer = service_role siempre” en fetch REST.** El patrón que **sí** quedó (y rompe el corte a keys `sb_secret_`) es el SDK:

| Archivo | Qué hace | Riesgo al cambiar a `sb_secret_` |
|---|---|---|
| `api/wompi-create-checkout.js` | `createClient(url, serviceKey)` | SDK manda apikey **y** Bearer. `sb_secret_` no es JWT → **Invalid JWT**. Pagos. |
| `api/wompi-webhook.js` | igual | Acreditación de planes. |
| `api/send-push.js` | igual | Cron recordatorios. |
| `api/register-fcm-token.js` | igual | Registro de dispositivos. |
| `api/create-profile.js` | igual | Alta de perfil. |
| `lib/fcmPush.js` | igual | Envío FCM. |

Los `Authorization: Bearer ${session.access_token}` del **frontend** son JWT de usuario: correctos, no tocar.

### 2.2 `.env.example`

Revisado entero. **No hay secretos reales.**

- URLs: `https://xxxx.supabase.co` (placeholder).
- Keys: `replace-with-…`, `pub_test_xxx`, `sk-ant-xxx`, `re_xxx`, `phc_xxx`.
- `FIREBASE_SERVICE_ACCOUNT`: JSON de plantilla (`your-project`, key PEM ficticia).
- `APP_URL=https://www.runningapexflow.com` — dominio público, no es secreto.

---

## 3) Hallazgos nuevos (post-split / post-headers / post-rescale)

| # | Hallazgo | Ubicación | Sev | Impacto |
|---|---|---|---|---|
| N1 | `createClient(serviceKey)` no usa `adminHeaders`; bloquea migración a `sb_secret_` | 6 archivos arriba | **Alto** (ops) | Tras el swap de keys, pagos/push/perfil fallan aunque REST ya esté bien. |
| N2 | `analyze-workout` `mode=briefing` es proxy Anthropic (prompt libre) | `api/analyze-workout.js:155–164` | **Alto** | Misma clase que `generate-workout`: JWT válido → factura Claude. Techo 400 tokens, pero sin rate-limit. |
| N3 | `analyze` / `adjust` no llaman `getWorkoutIfAllowed` | mismo archivo | **Medio** | Cualquier usuario auth puede mandar un `workout` inventado y quemar cuota. `adjust-steps` sí está scoped. |
| N4 | Prompt de análisis **sin** `structure` / `target_pace`; cliente manda `athlete?.vdot` (columna **inexistente**) | `analyze-workout.js:203–216`; `Athletes.jsx:1016` | **Alto** (producto) | La IA compara ritmo **de sesión** vs plan a ojo. Encaja con “Puntuación 59%” inventada. VDOT llega `null`. |
| N5 | `adjust-steps` exige `process.env.SUPABASE_URL` **sin** fallback `VITE_` | `analyze-workout.js:364` | **Medio** (ops) | En Vercel, si solo está `VITE_SUPABASE_URL`, el fetch va a `undefined`. |
| N6 | `structureHasGradePct`: `Number(null)` / `Number("")` → `0` → `true` | `src/lib/gpxRacePlan.js:236–237` | **Medio** | Un `grade_pct` nulo puede saltar el rescale VDOT de Biblioteca/Builder y entrar por Minetti. No es el caso Castro (descripción Garmin), pero es trampa latente. |
| N7 | Descripción con ritmo Garmin original: **fix en código**, no en datos viejos | `enrichPace.js` (`aa609fc`) | **Parcial resuelto** | Asignaciones nuevas ya no muestran 4:03 en el texto. Filas de Castro **siguen** sucias hasta reasignar o resync. |
| N8 | Push al reloj lee `target_pace` de la fila ya guardada | `intervals.js` `normalizeBlock` / `stepLine` | **No es bug de orden** | Biblioteca rescala **antes** del insert; “Enviar al reloj” es posterior. Si el reloj mostró 4:03, la causa más probable es Builder sin rescale o el workout Garmin original en el dispositivo — no un race rescale-vs-push. |
| N9 | `WorkoutRouteMap` (Leaflet) eager en Athletes | `Athletes.jsx:7` | **Medio** (perf) | Suma peso al módulo que ya era el peor chunk del coach. |
| N10 | `is_admin()` = UUID fijo en SQL | `0035_is_admin_fixed_uuid.sql` | **Medio** | Misma identidad que `PLATFORM_ADMIN_USER_ID`. Autoridad no es solo `profiles.role`. |

---

## 4) Top 10 actualizado (mismo formato; prioridades cambiadas)

### Urgente (seguridad / dinero / abuso)

| # | Hallazgo | Sev | vs audit anterior | Por qué primero |
|---|---|---|---|---|
| **1** | Wompi `amount_cop` confiado al cliente | **Crítico** | **Igual** | Pagar 5000 COP y recibir Pro/marketplace. Nada se movió. |
| **2** | `/api/generate-workout` + `analyze-workout` briefing sin rate-limit / plan | **Alto** | **Empeoró** (se suma briefing) | Quema `ANTHROPIC_API_KEY` con JWT. |
| **3** | `createClient(serviceKey)` dual-header (6 call sites) | **Alto** (ops) | **Nuevo** | El fix REST no cubre SDK. Swap a `sb_secret_` tumba pagos y push. |
| **4** | `ADMIN_EMAIL` + UUID admin en cliente **y** `is_admin()` SQL | **Medio** | **Igual** | Targeting + autoridad fuera de `profiles.role`. |

*El #3 anterior (`.gitignore` `.env`) **sale del top 10**: resuelto.*

### Importante (usuarios / fiabilidad / coste)

| # | Hallazgo | Sev | vs anterior | Por qué |
|---|---|---|---|---|
| **5** | `Athletes.jsx` monolito + eager + jsPDF **+ Leaflet** | **Alto** | **Empeoró** (mapa) | Cada sesión coach carga el módulo más crítico y más pesado. |
| **6** | `AthleteHome` `workouts select("*")` | **Alto** | **Igual** | Historial largo = app lenta en móvil. |
| **7** | Análisis IA sin ritmos de bloque / VDOT real | **Alto** (producto) | **Nuevo** | Consejo y “% de ejecución” pueden ser falsos; el atleta ya lo sufrió (Castro / Garmin 59%). |
| **8** | npm audit 3 critical / 16 high (filtrar runtime) | **Medio** | **Igual en clase** | `react-router-dom` es runtime; `tar`/`websocket-driver` suelen ser toolchain. |

### Incremental

| # | Hallazgo | Sev | vs anterior | Por qué |
|---|---|---|---|---|
| **9** | Partir `Athletes` / `AthleteHome` / `appShared` (tamaños **idénticos**) | **Medio** | **Igual** | App.jsx ya no es el problema; estos tres sí. |
| **10** | PNG 800KB+; REVOKE anon en RPCs; mover invite/plan a Chrome; alinear docs `0064`; `structureHasGradePct`; backfill descripciones viejas | **Bajo–medio** | **Igual + extras** | Higiene; el backfill de `description` es lo único con efecto visible en atletas ya asignados. |

---

## Tamaños de monolitos (pedido explícito)

| Archivo | Audit 2026-08 | Ahora | Δ |
|---|---|---|---|
| `src/components/Athletes/Athletes.jsx` | ~3738 (`Athletes.jsx` en `components/`) | **3738** | 0 (solo se movió de carpeta) |
| `src/components/AthleteHome.jsx` | ~2238 | **2238** | 0 |
| `src/components/shared/appShared.js` | ~2808 | **2808** | 0 |
| `src/App.jsx` | ~745 | **704** | −41 |
| `src/components/Plan2Weeks.jsx` | ~2046 | **2046** | 0 |
| `src/components/WorkoutLibrary.jsx` | ~1286 | **1286** | 0 |
| `src/components/AuthLanding.jsx` | ~1091 | **1091** | 0 |
| `api/integrations.js` | (no listado como monolito) | **1193** | — |

---

## Notas metodológicas

- No se modificó schema ni runtime. Este archivo es el único deliverable.
- No se listan valores de `.env` local.
- **No** se re-ejecutaron advisors Supabase ni SQL live sobre `paceforge`. Donde el audit v1 dependía de prod (`rls_enabled`, grants reales de `upsert_profile`), el estado se marca **no re-verificado**; el repo no muestra migraciones que apaguen RLS ni añadan tablas.
- Firebase API keys en cliente se tratan como esperadas.
- El push-to-watch **no** usa `nativePush.js` (eso es FCM). El payload del reloj sale de `toIntervalsText` → `normalizeBlock` → `target_pace`.

---

## Siguiente paso sugerido (fuera de esta tarea — no implementado)

1. Fijar precios server-side en `wompi-create-checkout` (mapa plan→COP; ignorar o exigir igualdad con `amount_cop`).
2. Rate-limit + plan en `generate-workout` **y** `analyze-workout` (incluye `briefing`); dejar de reenviar prompts libres.
3. Meter `structure` / ritmos rescalados (o `compareBlocks`) en el prompt de analyze; resolver VDOT desde `athlete_evaluations`, no `athletes.vdot`.
4. Unificar los 6 `createClient(serviceKey)` con la misma política que `adminHeaders` **antes** de apagar keys legacy.
5. Lazy-load `Athletes` + dynamic `jspdf` + dynamic `WorkoutRouteMap`.
6. Plan de split de `Athletes.jsx` / `AthleteHome.jsx` / `appShared.js` (los tamaños no se movieron solos).

*Fin de la auditoría v2 — sin cambios de runtime.*
