# Auditoría completa — RunningApexFlow / PaceForge

Fecha: **2026-08**  
HEAD de referencia: `7da716a` (post split App.jsx → ~745 líneas + hooks/módulos)  
Alcance: codebase completo (src/, api/, lib/, supabase/, public/, assets) — **solo lectura**  
Proyecto Supabase auditado: `paceforge` (`xweecyaqjflmhieeouqm`)

Este documento no propone patches; prioriza impacto real (dinero, datos, usuarios) vs deuda incremental.

---

## Resumen ejecutivo

Tras el split, el riesgo principal **ya no** es el monolito de App.jsx. Los hallazgos más urgentes están en:

1. **Pagos Wompi** — el servidor firma el monto que manda el cliente.
2. **Proxy Anthropic** — cualquier usuario autenticado puede quemar cuota de IA.
3. **Higiene de secretos locales** — `.gitignore` no ignora bien `.env`.
4. **Monolitos restantes** — `Athletes.jsx` (~3.7k líneas) y `AthleteHome.jsx` (~2.2k) concentran bugs/perf.

RLS en tablas está **habilitado en las 29 tablas** públicas listadas; no hay tabla de negocio sin RLS. Quedan views SECURITY DEFINER y grants de RPC a revisar. Varios hardenings de `0064_*.sql` **ya están en producción** aunque el archivo del repo diga “no aplicar” (drift repo↔prod).

---

## 1) SEGURIDAD

### 1.1 RLS / base de datos

| Hallazgo | Ubicación | Severidad | Impacto real |
|---|---|---|---|
| Las **29 tablas** públicas tienen `rls_enabled=true` | Prod `paceforge` (list_tables / pg_class) | — | Buena base: no hay tabla “abierta” sin RLS. |
| `oauth_states`: RLS ON, **0 policies** | Advisor + `0042_device_connections_oauth.sql` | **Bajo** (INFO) | Tabla vacía; sin policies = nadie con JWT puede leer/escribir (solo service_role). Correcto si el OAuth solo usa backend. |
| Views SECURITY DEFINER: `coach_public`, `user_names`, `athlete_device_status` | Advisor ERROR; defs en `0045`, `0054`, `0058` | **Medio** | Diseñadas a propósito (bypassean RLS de `profiles`). `coach_public` en prod **ya filtra** `is_public` / coach propio / atleta del coach — menos fuga que el borrador histórico. Siguen siendo superficie ancha: cualquier `authenticated`/`anon` con GRANT ve el directorio público. |
| `upsert_profile`: EXECUTE solo `service_role` | Prod grants (verificado SQL) | — | Mitigado en prod (antes era vector IDOR). Repo `0039` aún muestra GRANT a `authenticated`; `0064` en repo dice “no aplicar” pero prod ya revocó — **drift de documentación**. |
| `accept_invitation_by_code` exige sesión + email match | Prod function def | — | Hardening aplicado; quemar invite con UUID solo ya no aplica a anon. |
| `delete_own_account()` executable por **anon** | Advisor WARN; `0049_delete_own_account.sql:29` exige `auth.uid()` | **Medio** | Anon sin sesión falla con `not_authenticated`. Ruido de superficie: conviene `REVOKE` de anon. |
| `find_coach_by_code` / `find_invitation_by_code` executable por anon | Advisor; intencional para registro | **Bajo–medio** | Enumeración limitada (códigos UUID/8 chars). Aceptable con rate-limit en edge; sin rate-limit = abuso de lookup. |
| Identidad admin en cliente: email + UUID fijos | `appShared.js:1551–1553` (`ADMIN_EMAIL`, `PLATFORM_ADMIN_USER_ID`) | **Medio** | Facilita targeting; la autoridad real debería ser solo `profiles.role='admin'` / `is_admin()`. UI de nav Admin también usa el email (`useCoachNavigation.js`). |
| Catálogo `achievements` SELECT amplio | `0010_achievements_system.sql` policy `achievements_select_all` | **Bajo** | Catálogo no sensible. |
| `subscription_payments`: solo SELECT own/admin; inserts vía service_role en API | Policies prod | — | Coherente; el riesgo es el **monto** en create-checkout, no el SELECT. |

**Tablas (29) con RLS ON:** athletes, workouts, coaches, profiles, training_plans, messages, workout_library, promo_codes, coach_profiles, athlete_evaluations, achievements, athlete_achievements, athlete_payments, ai_generations, races, invitations, coach_requests, plan_drafts, challenges, challenge_participants, plan_marketplace, plan_purchases, subscription_payments, coach_staff, staff_athletes, device_connections, oauth_states, push_deliveries, device_tokens.

### 1.2 Claves y secretos

| Hallazgo | Ubicación | Severidad | Impacto real |
|---|---|---|---|
| `.gitignore` ignora la cadena literal `".env"` (con comillas), **no** el archivo `.env` | `.gitignore:25` | **Alto** | `git status` muestra `?? .env`. Un `git add .` puede subir Resend/Supabase keys. Hoy no está tracked, pero el riesgo de commit accidental es alto. |
| Firebase web `apiKey` embebida | `src/lib/firebaseMessaging.js:5`, `public/sw.js:6` | **Bajo–medio** | Normal en apps Firebase; impacto depende de restricciones de API key en Google Cloud (HTTP referrer / Android package). Si la key no está restringida → abuso de cuota. |
| `google-services.json` con `current_key` | `android/app/google-services.json` | **Bajo** | Esperado en apps Android; no es service_role. |
| Server secrets solo vía `process.env` | `api/*`, `lib/apiAuth.js` | — | Patrón correcto (no hardcode de service_role en fuente). |
| Admin email en fuente | `appShared.js:1551` | **Medio** | PII / superficie de ingeniería social (ver arriba). |

### 1.3 Endpoints `/api/*`

| Endpoint | Auth | Hallazgo | Severidad |
|---|---|---|---|
| `api/wompi-create-checkout.js:63–67,96` | JWT `getUser` | **`amount_cop` viene del body**; solo valida `>= 5000`. Firma Wompi e insert PENDING usan ese monto. Cliente (`PlanPicker.jsx:140`) puede enviar 5000 COP por un plan Pro. Webhook acredita plan según fila PENDING — **pago incompleto → plan completo**. | **Crítico** |
| `api/generate-workout.js:10–23,28–40` | `requireUser` | Tras auth, reenvía casi todo el body a Anthropic (`max_tokens` hasta 32k). Sin rate-limit, sin check de plan/trial, sin tope de coste por user. Cuenta free/comprometida = factura Anthropic. | **Alto** |
| `api/achievements.js:49–61` | `requireUser` + `canAccessAthlete` | POST puede insertar `achievement_code` arbitrario (service_role). Coach/atleta con acceso puede auto-otorgar logros inventados (integridad de gamificación, no dinero). | **Medio** |
| `api/send-push.js:77–80` | Cron `CRON_SECRET` / user JWT | Cron protegido; path user usa `areRelated`. | — OK |
| `api/send-email.js` | `requireUser` + plantillas | HTML no libre; escape + URL http(s). | — OK (buen patrón) |
| `api/create-profile.js:23–46` | `requireUser`; user_id del JWT | No confía user_id del body. | — OK |
| `api/analyze-workout.js` | `requireUser` + `getWorkoutIfAllowed` | Coste IA similar a generate; scoped a workout permitido. | **Medio** (coste) |
| `api/wompi-webhook.js:28–49` | Firma HMAC eventos | Valida checksum; lee monto de DB no del atacante directo. | — OK si create-checkout fija precios |
| `api/integrations.js` | `requireUser` + `canAccessAthlete` | Superficie grande OAuth/ICU; revisar acciones una a una en PRs futuros. | **Medio** (complejidad) |
| `api/weather.js` | `requireUser` | Auth OK; abuso = cuota OpenWeather. | **Bajo** |

### 1.4 Inputs de usuario → Supabase

| Hallazgo | Ubicación | Severidad | Impacto |
|---|---|---|---|
| Insert atleta: trim + validación básica; sin sanitizar HTML (no hace falta si UI escapa React) | `useCoachAthletes.js` `saveNewAthlete` | **Bajo** | XSS React-default escaped; riesgo residual en emails/PDF si se concatena HTML. |
| Mensajes chat insert directo | `Athletes.jsx` ~1997 | **Bajo–medio** | Texto libre; OK en React; push body puede filtrar basura. |
| FC / pagos: validación numérica + alerts | `Athletes.jsx:1878+` | — | Mejor que nada. |
| Invite email / PlanPicker promo | `InviteModal`, `PlanPicker` | **Bajo** | Promo server-side redeem; invite usa plantilla email. |

### 1.5 Dependencias (`npm audit`)

| Severidad npm | Count (metadata) | Notas |
|---|---|---|
| critical | 3 | Incluye cadenas transitivas (p.ej. toolchain Capacitor/assets, tar, etc.) |
| high | 16 | `vite`, `react-router`/`react-router-dom`, `postcss`, `nanoid`, … |
| moderate | 13 | |
| low | 1 | |
| **Total** | **33** paquetes reportados / 66 vulns agregadas | Muchas son **dev/CLI** (`@capacitor/cli`, assets). Priorizar CVEs en **runtime** (vite preview no es prod; `react-router-dom` sí si se usa routing XSS). |

Revisar con `npm audit` humano qué critical afectan el bundle de producción vs solo build Android.

---

## 2) PERFORMANCE

| Hallazgo | Ubicación | Severidad | Impacto real |
|---|---|---|---|
| `Athletes.jsx` **eager** en CoachChrome (no lazy) + importa `jspdf` | `CoachChrome.jsx:2`; `Athletes.jsx:2` | **Alto** | Cualquier coach carga el módulo ficha (~180KB fuente, chunk grande) aunque solo vea Dashboard. jsPDF arrastra peso al grafo. |
| `AthleteHome` / Plan2Weeks / AdminMarketplace ya lazy | `App.jsx`, `CoachChrome.jsx` | — | Bien; asimetría con Athletes. |
| `AthleteHome` carga **todos** los workouts `select("*")` | `AthleteHome.jsx:1224` | **Alto** | Atleta con historial largo = payload grande en cada refresh; UI lenta en móvil. |
| Dashboard: **una** query semanal de workouts (ya no N+1 por atleta) | `Dashboard.jsx:97–102` | — | Patrón bueno post-fix. |
| Athletes lista: batch devices / week km / unread | `Athletes.jsx:681–724` | — | Buen patrón anti-N+1 en lista. |
| ChallengesHub: varias queries secuenciales + logs | `ChallengesHub.jsx:93–171` | **Medio** | Latencia percibida al abrir Retos; no N+1 clásico. |
| CoachSettings: `Promise.all` por staff member | `CoachSettings.jsx:268` | **Medio** | N queries al abrir staff (escala con staff). |
| Builder assign: `map(async …)` inserts | `Builder.jsx:230` | **Bajo–medio** | Paralelismo OK; muchos atletas = muchos inserts. |
| Assets PNG enormes | `public/pwa-512.png` **~806 KB** (varias copias android/splash) | **Medio** | PWA/install/splash lentos en 3G; conviene WebP/comprimir. |
| Bundle main sigue >500 KB gzip warning | build Vite | **Medio** | Esperable con Supabase+Firebase; lazy Athletes + jspdf ayudaría. |
| Memoización | Varios `useMemo` en Dashboard; Athletes sin memo agresivo | **Bajo** | No priorizar memo “preventivo”; el coste real es I/O y tamaño de módulo. |

---

## 3) BUGS

| Hallazgo | Ubicación | Severidad | Impacto real |
|---|---|---|---|
| Form “Nuevo atleta” **inalcanzable** (`setShowAddAthleteForm(true)` no existe) | App/Dashboard wiring; map athletes | **Medio** (UX/deuda) | Alta real = InviteModal; código save/delete form confunde mantenimiento. |
| Catch vacío / solo console | `Athletes.jsx:855`, `:1023`; muchos `console.warn` en `appShared.js` (FCM, push, invite) | **Medio** | Fallos de sync/push/analisis fallan en silencio para el usuario. |
| Challenges / PlanPicker: error → `console.error` a veces sin toast | `ChallengesHub.jsx:93+`; `PlanPicker.jsx:145–161` | **Medio** | Usuario cree que “no pasó nada” en pago o carga de retos. |
| `delete_own_account` callable anon | ver seguridad | **Bajo** bug/surface | Falla sin sesión; no borra datos ajenos. |
| Drift: comentarios `0064` “NO APLICAR” vs prod ya endurecido | `supabase/migrations/0064_*.sql:1–15` | **Medio** (ops) | Equipo puede re-aplicar mal o dudar del estado real. |
| Efectos densos en Athletes (15+ `useEffect`) | `Athletes.jsx:681–1469` | **Medio** | Riesgo clásico de deps incompletas / doble fetch / stale athlete al cambiar selección rápido (condiciones de carrera canceladas a veces con `cancelled`, no siempre). |
| Admin gate por email hardcode + role | `useCoachNavigation.js` + effect admin | **Bajo** | Si el email cambia y el role no, UI inconsistente. |

Patrones del split ya mitigados (no reabrir salvo regresión): auth-lock retry en loadAthletes/bootstrap; IDOR achievements parcialmente cerrado; push `setNativePushPermission` expuesto.

---

## 4) DEUDA TÉCNICA

| Hallazgo | Ubicación | Severidad | Impacto |
|---|---|---|---|
| **Gigantes fuera del split App** | `Athletes.jsx` ~3738 líneas; `AthleteHome.jsx` ~2238; `appShared.js` ~2808; `Plan2Weeks.jsx` ~2046; `WorkoutLibrary` ~1286; `AuthLanding` ~1091 | **Alto** (mantenibilidad) | Mismo problema que App.jsx tenía: reviews imposibles, bugs locales, coste de carga. Siguiente “split” natural: Athletes → tabs/ficha/chat/pagos. |
| `appShared.js` cajón de sastre | `src/components/shared/appShared.js` | **Alto** | Mezcla styles, admin IDs, FCM, VDOT, email, invites — acoplamiento y circular imports potenciales. |
| Prop drilling CoachChrome (~50 props) | `App.jsx:691–744`, `CoachChrome.jsx` | **Medio** | Funciona; NotifyContext / agrupar props “athletesBundle” reduciría ruido sin Context gigante. |
| Estados residuales invite/plan en App | `App.jsx:103–104` | **Bajo** | Mapeo bootstrap ya lo notó; mover a Chrome. |
| Duplicación resolve coach code | `App.jsx` + `appShared` helpers | **Bajo** | Unificar en un solo helper. |
| Dead path form alta Dashboard | ver bugs | **Bajo** | Purgar o reconectar conscientemente. |
| Inconsistencia lazy: Athletes eager vs resto lazy | `CoachChrome.jsx` | **Medio** | Alinear con lazy + Suspense. |
| Repo migrations vs prod | `0064` header vs SQL live | **Medio** | Documentar “applied on prod YYYY-MM” o squashear estado. |

---

## Top 10 — priorización por impacto real

### Urgente (seguridad / dinero / abuso / pérdida de datos de pago)

| # | Hallazgo | Sev | Por qué primero |
|---|---|---|---|
| **1** | Wompi `amount_cop` confiado al cliente | **Crítico** | Impacto directo en ingresos: pagar el mínimo y recibir plan Pro/marketplace. |
| **2** | `/api/generate-workout` sin rate-limit / tope de plan | **Alto** | Quema `ANTHROPIC_API_KEY` con JWT válido; coste real. |
| **3** | `.gitignore` no ignora `.env` (comillas) | **Alto** | Un commit despistado filtra Resend/Supabase/Wompi al remoto. |
| **4** | `ADMIN_EMAIL` + `PLATFORM_ADMIN_USER_ID` en cliente | **Medio** | Facilita ataques dirigidos; autoridad debería ser solo rol DB. |

### Importante (usuarios / fiabilidad / coste operativo)

| # | Hallazgo | Sev | Por qué |
|---|---|---|---|
| **5** | `Athletes.jsx` monolito + import eager + jsPDF | **Alto** | Perf en cada sesión coach + deuda de bugs en el módulo más crítico del producto. |
| **6** | `AthleteHome` `workouts select("*")` completo | **Alto** | Atletas con historial sufren app lenta / datos móviles. |
| **7** | Errores solo en `console.*` (push, challenges, checkout) | **Medio** | Fallos silenciosos = soporte “no me llega la noti / no cobró”. |
| **8** | npm audit critical/high (filtrar runtime) | **Medio** | Actualizar deps con CVE explotables en cliente/router/vite. |

### Incremental (deuda / higiene — sin urgencia de incidente)

| # | Hallazgo | Sev | Por qué |
|---|---|---|---|
| **9** | Dividir `AthleteHome` / `Plan2Weeks` / `appShared` | **Medio** | Misma clase de win que el split de App; no es incidente. |
| **10** | Assets PNG 800KB+, REVOKE anon en RPCs ruidosos, mover invite/plan state a Chrome, alinear docs `0064` | **Bajo–medio** | Mejora incremental; bajo riesgo si se deja para después del top 1–4. |

---

## Notas metodológicas

- Advisors Supabase + SQL live sobre `paceforge`; no se modificó schema ni código.
- No se listan valores de secretos encontrados en `.env` local.
- Firebase API keys en cliente se tratan como **esperadas** salvo falta de restricción en GCP (verificar en consola, fuera de este repo).
- “23 tablas” del enunciado: en prod hay **29** tablas con RLS; el número creció con device_tokens, push_deliveries, etc.

---

## Siguiente paso sugerido (fuera de esta tarea)

1. Fijar precios server-side en `wompi-create-checkout` (mapa plan→COP; ignorar `amount_cop` del cliente o validar igualdad).  
2. Rate-limit + comprobación de plan en `generate-workout` / `analyze-workout`.  
3. Corregir `.gitignore` → `.env` (y rotar cualquier key si algún día se filtró).  
4. Lazy-load `Athletes` (+ dynamic import de jsPDF al exportar PDF).  
5. Plan de split de `Athletes.jsx` / `AthleteHome.jsx` con el mismo ritmo map→extract.

*Fin de la auditoría — sin cambios de runtime en este commit.*
