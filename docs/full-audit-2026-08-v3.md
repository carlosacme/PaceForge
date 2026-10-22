# Auditoría completa v3 — RunningApexFlow / PaceForge

Fecha: **2026-08-30**
HEAD de referencia: `04717ee` (`master`) — *fix: stop AI analysis cache from regenerating unchanged workouts*
Audit anterior: `docs/full-audit-2026-08-v2.md` (HEAD `aa609fc`)
Alcance: `src/`, `api/`, `lib/`, `supabase/`, `public/` + **verificación live contra Supabase prod** (`xweecyaqjflmhieeouqm`) + build real + `npm audit` + historia de git.
Modo: **solo lectura**. No se modificó código, schema ni datos. Este archivo es el único entregable.

## Nota de proceso

`master` y `origin/master` están **idénticos** en `04717ee` (`git rev-list --left-right --count` → `0 0`). Es decir, el trabajo de caché IA de hoy **ya está en master y publicado**, aunque la instrucción de la tarea anterior era no mergear hasta validar la estabilidad del texto cacheado en Preview. La validación carácter-por-carácter en Preview **no consta como ejecutada**. No es un bug, pero conviene saberlo antes de asumir que master está validado.

## Metodología y honestidad de la evidencia

| Verificado en vivo | Solo repo / no verificable |
|---|---|
| RLS + policies de las 30 tablas (`pg_class`, `pg_policies`) | Si las **legacy keys** de Supabase están deshabilitadas (no hay tool ni dashboard desde aquí) |
| Advisors de seguridad y performance de Supabase | Formato real de `SUPABASE_SERVICE_ROLE_KEY` en Vercel (no está en `.env` local) |
| Constraints y datos de `ai_generations`, `workout_ai_cache`, `workout_library`, `workouts` | Comportamiento en Preview con sesión real (SSO de Vercel bloquea el acceso) |
| Existencia real de columnas "fantasma" (`information_schema`) | |
| Tamaño de chunks con `npm run build` + contenido del chunk eager | |
| Historia de git (`git log -S`, blobs de `.env`) y visibilidad del repo (API de GitHub) | |

**Falsos positivos corregidos en esta pasada** (los subagentes los reportaron como críticos; la verificación en prod los desmiente):

- `athlete_evaluations.test_date` **existe** en prod (`date`). También `athletes.weekly_km`, `workouts_done`, `workouts_total` y `subscription_payments.amount_cop`. No es un bug de runtime: es **drift documental** (columnas creadas fuera de migraciones versionadas). Severidad real: **medio**, no crítico.
- "IDOR de lectura de `workout_ai_cache`" vía API **no es explotable**: el texto solo se devuelve si `cached.input_hash === inputHash` (`api/analyze-workout.js:507-519`), y el hash incluye la fila completa de DB más el VDOT resuelto en servidor. Un atacante que no puede leer el workout no puede reproducir el hash. Lo explotable es la **escritura**, no la lectura.
- `send-email` **no** es un relay de HTML libre: rechaza `html`/`subject` sueltos y exige plantilla conocida (`api/send-email.js:150-161`). Lo abierto es el destinatario.
- Los tamaños de archivo medidos por línea total sugerían que `Plan2Weeks`, `integrations.js` y `App.jsx` "crecieron". Con la **misma métrica que la v2** (líneas no vacías, `Measure-Object -Line`) están **iguales**. No hubo crecimiento.

---

# 1) SEGURIDAD

## 1.1 El incidente del `.env` NO está cerrado — Crítico

Este es el hallazgo más grave de la auditoría y es **nuevo** respecto a la v2, que daba el tema por resuelto solo porque el `.gitignore` se arregló.

| Evidencia | Resultado |
|---|---|
| Visibilidad del repo | `carlosacme/PaceForge` es **público** (`api.github.com/repos/...` → `"visibility": "public"`, HTTP 200 sin autenticación) |
| `.env` en la historia | Añadido en `d5de0a2`, modificado en `9c3d219`, eliminado en `5b34b6e`. **La historia no se reescribió**: los blobs siguen recuperables con `git show 9c3d219:.env` |
| Contenido filtrado | `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (`sb_publishable_…`) y **`RESEND_API_KEY`** (`re_5Hv7f6u…`) |
| ¿Se rotó la key de Resend? | **No.** El prefijo de `RESEND_API_KEY` en el `.env` local (`re_5Hv7f6`) **coincide** con el filtrado |

**Impacto real:** cualquiera puede clonar el repo público y leer una `RESEND_API_KEY` válida. Con ella se puede enviar correo desde el dominio verificado de la app (`runningapexflow.com`): phishing a los atletas con remitente legítimo, y quema de la cuota/reputación del dominio. La `VITE_SUPABASE_KEY` filtrada es **publishable**, diseñada para ser pública y protegida por RLS → riesgo **bajo**.

Lo que sí está correcto: `.gitignore:27-29` (`.env`, `.env.*`, `!.env.example`), `git check-ignore -v .env` → `.gitignore:27`, `.env` no trackeado, y **cero secretos nuevos** en commits recientes (`git log --all -S` para JWT `eyJ…`, `sk-ant-api` y `service_role_key` → sin resultados). `.env.example` solo tiene placeholders.

## 1.2 `api/analyze-workout.js` — envenenamiento del caché IA — Crítico (introducido hoy)

| Línea | Qué pasa |
|---|---|
| `api/analyze-workout.js:435` | `const { workout, allowed } = await hydrateWorkout(user.id, workoutIn)` |
| `:210-214` | Si `getWorkoutIfAllowed` devuelve `null`, `hydrateWorkout` **devuelve el objeto del cliente igualmente** |
| `:441` | La acción `analyze` solo comprueba `if (!workout)`. **Nunca comprueba `allowed`** → no hay 403 |
| `:506` | `const hashSource = allowed || workout` → para un workout ajeno usa el blob del atacante |
| `:542` | `upsertAiCache(workout.id, "coach_analyze", …)` escribe con **service_role**, usando el `id` que mandó el cliente |

**Impacto real:** cualquier usuario autenticado (incluido un atleta cualquiera) puede hacer `POST /api/analyze-workout` con `{action:"analyze", workout:{id:<id de otro coach>, title:…, athlete_notes:…}}` y **sobrescribir el análisis cacheado de cualquier workout existente**. El coach víctima abre "Ver análisis" y ve ese texto, porque el cliente hidrata directamente desde la tabla (`src/components/Athletes/useWorkoutAnalysis.js:45-49`) y `openCoachAnalysis` ya no llama al API. Como el prompt incorpora `title` y `athlete_notes` del atacante, además es un vector de inyección de contenido en la UI del coach.

El RLS de **lectura** está bien (ver 1.5); el agujero es que la escritura pasa por el API con service_role, no por RLS. Los otros caminos sí validan: briefing hace 403 (`:379-381`), `adjust-steps` usa `getWorkoutIfAllowed` (`:665`).

## 1.3 `analyze-workout` sigue sin rate-limit, y ahora persiste — Alto

Confirmado: `assertGenerateBudget` solo se importa en `api/generate-workout.js:2`. `analyze-workout` no tiene ningún control de cuota.

| Acción | Techo de tokens | Gate |
|---|---|---|
| `analyze` | 4000 (`:26`) | `requireUser` únicamente |
| `adjust` | 4000 | `requireUser` únicamente |
| `briefing` | 400 | `requireUser` + 403 si hay `workout_id` sin acceso |

Sobre la pregunta concreta de **inflar `workout_ai_cache`**: no se puede crecer la tabla sin límite, porque `UNIQUE (workout_id, kind)` (`supabase/migrations/0066_workout_ai_cache.sql:14`) topa en 2 filas por workout. El coste real no es el tamaño de la tabla, es **la factura de Anthropic**: con `force: true` cada request salta el caché y llama a Claude. El daño de escritura es de *sobrescritura*, no de volumen.

## 1.4 El presupuesto de IA está inoperante por drift de migración — Alto (nuevo)

Cadena verificada en prod:

1. `supabase/migrations/0013_ai_generations.sql:3-9` declara `UNIQUE (coach_id, month)` y `:29-34` una policy `ai_generations_update_own`. En prod **no existe ninguna de las dos**: el único constraint es `ai_generations_pkey PRIMARY KEY (id)`, y las policies son 2 (`SELECT`, `INSERT`) con nombres en español que no coinciden con los del repo. Causa: `CREATE TABLE IF NOT EXISTS` sobre una tabla que ya existía → la migración fue un no-op.
2. Sin policy `UPDATE`, el `.update()` del cliente (`src/components/Builder.jsx:93-97`, `src/components/Plan2Weeks.jsx:387-392`) afecta **0 filas y no devuelve error** (RLS filtra, no falla). El código cree que incrementó.
3. Datos reales: el mes `2026-08` tiene `count = 1` con `updated_at = 2026-08-04`, y `2026-04` tiene 14. El contador mensual está **congelado**.
4. `lib/aiBudget.js:162` lee el tope mensual de esa misma fila → **el límite de 100/400 al mes nunca dispara**. El "X/100" que ve el coach es falso.
5. Sin `UNIQUE`, hay duplicados reales (`2026-05` tiene 2 filas). `readCount` (`lib/aiBudget.js:94-99`) hace `select=id,count` **sin `order`** y toma `data[0]` → fila arbitraria. Como la policy `INSERT` permite `coach_id = auth.uid()`, un coach puede insertar una segunda fila `d:<hoy>` con `count: 0` y **saltarse también el tope diario**.

**Impacto real:** el único control de gasto de IA que existía en el proyecto no protege. Dinero.

## 1.5 RLS — inventario completo verificado en prod

**30 tablas** (las 29 de la v2 + `workout_ai_cache`), **todas con `rls_enabled = true`**, ninguna con `relforcerowsecurity`.

`workout_ai_cache` (lo que se pidió revisar explícitamente) — **correcto**:

- 2 policies, ambas `SELECT` y solo para `authenticated`.
- `workout_ai_cache_select_coach_analyze`: `is_admin()` OR `a.coach_id = auth.uid()` OR `w.coach_id = auth.uid()` OR staff vía `staff_athletes`+`coach_staff`. **El atleta no puede leer el análisis del coach.**
- `workout_ai_cache_select_athlete_briefing`: lo anterior **más** `a.user_id = auth.uid()`.
- **Cero policies de escritura** → el cliente no puede insertar ni modificar. Correcto por diseño.
- Nadie puede leer el análisis de otro atleta/coach **por RLS**. El problema es el API (1.2).

Hallazgos de RLS que **siguen igual** que en la v2, ahora confirmados en prod:

| Hallazgo | Evidencia live | Sev |
|---|---|---|
| `oauth_states`: RLS ON, **0 policies** | advisor `rls_enabled_no_policy` | Bajo (solo service_role la usa) |
| 3 views `SECURITY DEFINER` | advisor `security_definer_view` nivel **ERROR** para `coach_public`, `athlete_device_status`, `user_names` | Medio |
| `0064` sin aplicar | advisors siguen mostrando `find_coach_by_code`, `find_invitation_by_code`, `is_admin`, `delete_own_account`, `handle_new_user` ejecutables por `anon` | Medio |
| `search_path` mutable | `set_coach_code`, `find_coach_by_code` | Bajo |
| Protección de contraseñas filtradas desactivada | advisor `auth_leaked_password_protection` | Bajo |

**Nuevo:** `authenticated` tiene `UPDATE` sobre **todas** las columnas de `workouts` (`information_schema.column_privileges`), y la policy `athletes can update own workouts` solo restringe `athlete_id` en el `WITH CHECK`. Un atleta puede por tanto reescribir `structure`, `title`, `total_km` y `generated_with_vdot` de su propio plan, y **cambiar `coach_id` a un UUID arbitrario** (el `WITH CHECK` no lo cubre), lo que inyecta la fila en la lista de otro coach (`Coach ve workouts de sus atletas` es `coach_id = auth.uid()`). Severidad **medio**.

## 1.6 Endpoints `/api/*` — barrido completo

Auditado por [Endpoints /api](f4070909-5d7e-401d-979a-c8b017afee34), con severidades recalibradas tras verificación.

| Endpoint | Auth | Autorización de recurso | Cuota | Hallazgo | Sev |
|---|---|---|---|---|---|
| `analyze-workout` | `requireUser` `:370` | **Parcial**: briefing `:379`, adjust-steps `:665`; **analyze/adjust no** | **No** | 1.2 + 1.3 | **Crítico** |
| `generate-workout` | `requireUser` `:12` | rol coach/admin vía `aiBudget` | Sí (roto, ver 1.4) | Reenvía casi todo el body a Anthropic, `max_tokens` hasta 32000 (`:18-31`), sin whitelist de modelo | Medio |
| `wompi-create-checkout` | JWT `:47-57` | Pago atado al `userId` del token | No | **Precio server-side** (`:90-141`); `amount_cop` del cliente solo se compara (`:149-157`) | **Bajo — resuelto** |
| `wompi-webhook` | HMAC `:94-97` | Lookup por `wompi_reference`, idempotente `:169` | — | Correcto | Bajo |
| `achievements` | `requireUser` `:11` | `canAccessAthlete` `:29,:50` | No | POST acepta `achievement_code` y `value` del body (`:46-57`); `canAccessAthlete` **incluye al propio atleta** (`lib/apiAuth.js:157`) → **auto-otorgamiento** de cualquier logro del catálogo | **Alto** |
| `send-email` | `requireUser` `:146` | **Ninguna** sobre el destinatario | No | Plantillas cerradas (no HTML libre), pero `to` es cualquier email válido (`:155-173`) → correo con marca de la app a terceros | **Medio–Alto** |
| `integrations` | JWT `:1307` (webhook ICU y oauth-callback con secret/state) | `canAccessAthlete` `:1317`; workouts validados vs `athlete_id` | No | `api_key` del cliente `:1322`; `vdot-resync` **correcto** (VDOT de DB + rescale en servidor, `:883`) | Medio |
| `send-push` | Cron `CRON_SECRET` `:77`; user `requireUser`+`areRelated` `:92-99` | Relación emisor↔destino | No | Texto arbitrario dentro del grafo coach↔atleta (probablemente aceptable) | Medio |
| `create-profile` | `requireUser` `:23` | `user_id` forzado del JWT `:28` | No | `role` y `coach_id` del body (`:26-36`): re-registro puede fijar `role: "coach"`, y `coach_id` no se valida contra invitación aceptada | Medio |
| `weather` | `requireUser` `:22` | N/A | No | Quema de `OPENWEATHER_API_KEY` / Nominatim | Medio |
| `register-fcm-token` | `requireUser` `:31` | Token siempre para `user.id` `:77` | — | Correcto | Bajo |

`stripTestTimeGoal*` **no existe en `api/` ni `lib/`** — vive solo en el cliente (`src/lib/enrichPace.js`). Consecuencia en 6).

`createClient(url, serviceKey)` del SDK: siguen **6 call sites** (`wompi-create-checkout.js:45`, `wompi-webhook.js:82`, `create-profile.js:56`, `register-fcm-token.js:45`, `send-push.js:18`, `lib/fcmPush.js:45`), sin la política de `adminHeaders()`. Igual que la v2 (N1): si las keys legacy se apagan y se pasa a `sb_secret_`, estos caminos (pagos, push, alta de perfil) fallan con *Invalid JWT*. **No verificable desde aquí** si ya se hizo el swap.

## 1.7 `npm audit` — sin cambios desde la v2

| | v2 (2026-08-29) | Ahora | Estado |
|---|---|---|---|
| Total | 33 (1 low, 13 mod, 16 high, 3 crit) | **33 (1 low, 13 mod, 16 high, 3 crit)** | **Idéntico** |
| Runtime (`--omit=dev`) | 20 (11 mod, 6 high, 3 crit) | **20 (11 mod, 6 high, 3 crit)** | **Idéntico** |

Runtime crítico: `protobufjs`, `tar`, `websocket-driver`. Runtime alto: `@grpc/grpc-js`, `@xmldom/xmldom`, `brace-expansion`, `react-router`, `react-router-dom`, `ws`. El único de impacto directo en el navegador sigue siendo `react-router-dom`.

---

# 2) INTEGRIDAD DE DATOS

Auditado por [Integridad post-split](a8f2d61c-4394-4803-8deb-827294f5bb55).

## 2.1 Consistencia post-split — sin roturas

`npm run build` pasa con **996 módulos y cero errores de resolución**. No hay imports a rutas viejas: el puente `src/components/Athletes/index.js:1` funciona con `CoachChrome.jsx:2`, el parser FIT se consume solo desde `src/lib/fitImport.js` (`WorkoutLibrary.jsx:26-30`) y el FCM se re-exporta a propósito desde `appShared.js:3-35`.

Lo que sí quedó: **imports muertos** en `src/components/AthleteHome.jsx:19-56` (`normalizeLibraryRow`, `libraryRowToBuilderWorkout`, `workoutStructureToEditableRows`, `challengeHasOpenTarget`, `RACE_DISTANCE_PRESETS`, etc. aparecen solo en la línea de import). Severidad **bajo**: ruido, no rotura.

## 2.2 Lógica duplicada

| Símbolo | Ubicaciones | Sev | Impacto |
|---|---|---|---|
| RPC `find_coach_by_code` | `App.jsx:202-207` y `appShared.js:2166-2171` | Medio | Sigue igual que en la v2: cambiar la validación exige tocar dos sitios |
| `EFFORT_TO_ZONE` | `src/lib/intervals.js:30` y `src/lib/blockComparison.js:26-54` | **Medio** | Los mapas **divergen** (`"half marathon"→T` vs `"half marathon effort"→HM`): la misma etiqueta puede resolver zonas distintas según si la lee el envío al reloj o la comparación del Registro |
| `durationToSecs` | `blockComparison.js:61` duplica `intervals.js:85` | Bajo | Reconocido en comentario |
| `vdotFromCooper` | Local en `EvaluationView.jsx:49-53` | Bajo | El resto de VDOT está en `src/lib/vdot.js` |
| Parsing de `feeling` en `athlete_notes` | `useAthleteWorkoutRpe.js:16-29` vs inline en `WorkoutRegistroModal.jsx:51-54` | Medio | Cambiar el formato rompe la lectura en un modal |

Verificado como **fuente única** (no duplicado): `formatLocalYMD` (`appShared.js:383`), `normalizeWorkoutStructure` (`appShared.js:684`), `libraryRowToBuilderWorkout`.

## 2.3 Más pares de tablas que deben sincronizarse

El patrón `athletes.coach_id` / `profiles.coach_id` **no era el único**:

| Par | Lado A | Lado B | Si divergen | Sev |
|---|---|---|---|---|
| `athletes.coach_id` ↔ `profiles.coach_id` | `AthleteHome.jsx:681` / `:683` (link manual), `api/create-profile.js:67-92` (sincroniza ambos) | `CoachSettings.jsx:220-242` (aceptar solicitud) | Chat/push usan `athleteInfo.coach_id`; el registro lee `profile.coach_id` | **Alto** |
| Registro sin código | Coach crea la fila con `coach_id` (`useCoachAthletes.js:184-185`) | `api/create-profile.js:88` hace upsert con `coach_id: null` | **Se pierde el vínculo con el coach** que ya lo había dado de alta | **Alto** |
| `athletes.workouts_done` ↔ conteo real de `workouts.done` | Coach: `useAthleteCalendar.js:91-97` **sí** actualiza el contador | Atleta: `useAthleteWorkoutRpe.js:173-181` **no** lo actualiza | La adherencia que ve el coach (`Athletes.jsx:514`) **subestima** si el atleta marca desde su app | **Alto** |
| `athletes.workouts_total` | Default 18 (`appShared.js:283`) | **Nunca se incrementa** al asignar | El % de adherencia es incorrecto | Medio |
| `coach_staff` ↔ `staff_athletes` | `App.jsx:369`, `AuthLanding.jsx:419` | `CoachSettings.jsx:354-392` | Staff sin fila en `coach_staff` pierde acceso (`lib/apiAuth.js:118-143`) | **Alto** |
| `coach_profiles.full_name`/`avatar_url` ↔ `profiles.*` | `CoachSettings.jsx:441,460-478` escribe ambos | Atleta lee `profiles.avatar_url` (`AthleteHome.jsx:446-451`) | Nombre/avatar distintos según vista | Medio |
| `device_tokens` ↔ `profiles.fcm_token` | `api/register-fcm-token.js:50-89` escribe ambos | Logout limpia solo `profiles.fcm_token` (`App.jsx:560`) | Multi-dispositivo: legacy = último device | Medio |
| `plan_purchases` ↔ `subscription_payments` | `MarketplaceHub.jsx:243-247` | `wompi-create-checkout.js:176-178` | El webhook confirma ambos (`wompi-webhook.js:142,216`); riesgo si falla a medias | Medio |

Verificado que **no** aplica: `challenges` no tiene contador denormalizado (el progreso se calcula en vivo), y no existe `athletes.vdot` (el VDOT vive solo en `athlete_evaluations`).

## 2.4 Todos los caminos de asignación de workouts — Marketplace es el hueco

| Camino | Ubicación | `rescaleStructureToVdot` | `enrichStructureWithPaces` | Strip TEST | Veredicto |
|---|---|---|---|---|---|
| Builder → Asignar | `Builder.jsx:196-230` | ✅ `:208` | ✅ `:207-210` | ✅ `:199-220` | Correcto (arreglado hoy) |
| Biblioteca → Asignar | `WorkoutLibrary.jsx:495-535` | ✅ `:511` | ✅ `:510-514` | ✅ `:502-526` | Correcto |
| **Marketplace → Cargar al calendario** | `MarketplaceHub.jsx:312` | ❌ | ✅ | ❌ | **BUG alto** |
| Plan 2 semanas → Asignar | `Plan2Weeks.jsx:1067-1123` | ❌ (correcto: genera al VDOT del atleta, `:196-198`) | ✅ | ❌ | Falta solo el strip TEST |
| GPX → Asignar | `GpxRacePlan.jsx:183-197` | ❌ (usa Minetti a propósito) | ❌ | ❌ | Correcto |
| Evaluación → resync VDOT | `EvaluationView.jsx:333` → `api/integrations.js:883` | ✅ | ❌ (no aplica) | ❌ | Correcto |
| Builder → "Usar" | `useBuilderLibraryBridge.js:25-29` | ❌ | ❌ | ❌ | Correcto (no hay atleta aún) |
| Builder/Biblioteca → guardar en biblioteca, import FIT | `Builder.jsx:344`, `WorkoutLibrary.jsx:368` | ❌ | ❌ | ❌ | Correcto (`workout_library`, sin atleta) |
| Calendario coach (editar/mover/borrar), sync reloj, RPE atleta | `useAthleteCalendar.js:211,226`, `integrations.js:725` | — | — | — | Correcto (UPDATE, no asignación) |

**`MarketplaceHub.jsx:312` — Alto.** Es exactamente el bug que se arregló hoy en Builder, pero por otra puerta. Verificado el mecanismo: usa solo `enrichStructureWithPaces`, y `src/lib/enrichPace.js:93` (`if (/\d+:\d{2}/.test(rawPace)) return b;`) **deja intacto** cualquier bloque que ya traiga un ritmo numérico. Los `plan_sessions` vienen de `workout_library`, donde los ritmos son absolutos y calibrados a otro VDOT (p. ej. 47.2). Agravante: `:320` escribe `generated_with_vdot: athleteVdot` **aunque no se haya rescalado** — la fila **miente** sobre su calibración, así que un futuro `vdot-resync` partirá de una base equivocada y el error se agrava en vez de corregirse. El atleta entrena a ritmos que no son suyos.

---

# 3) PERFORMANCE

## 3.1 Los splits NO bajaron el bundle inicial

Medido con `npm run build` en `04717ee`:

| Chunk | Tamaño | gzip |
|---|---|---|
| **`index-D93EO2hh.js`** | **1 071,36 kB** | **327,45 kB** |
| `RegistroPaceChart` (recharts, lazy) | 373,87 kB | 107,86 kB |
| `WorkoutLibrary` | 203,09 kB | 51,37 kB |
| `html2canvas` | 199,56 kB | 46,78 kB |
| `supabase` | 184,08 kB | 47,85 kB |
| `WorkoutRouteMap` (Leaflet, lazy) | 156,52 kB | 46,44 kB |
| `index.es` (jsPDF) | 151,40 kB | 48,88 kB |
| `AthleteHome` (lazy) | 98,73 kB | 25,34 kB |
| `appShared` | 59,35 kB | 20,42 kB |

Verifiqué **qué vive dentro del chunk eager** buscando marcadores en el bundle generado: contiene la cadena `"Vueltas del reloj"` (modal de Registro), `blockComparison` y `raf_analysis_` (`useWorkoutAnalysis`). Es decir, **toda la ficha del coach con el Registro y el análisis IA sigue en el bundle inicial**, porque `CoachChrome.jsx:2` importa `Athletes` de forma estática mientras el resto va con `React.lazy` (`:15-22`).

**La conclusión importante:** partir un monolito en muchos archivos **no reduce el bundle** si todos siguen importados estáticamente. Las mejoras reales de hoy vinieron de las fronteras `lazy`, no de los splits: Leaflet salió del chunk eager (`WorkoutRegistroModal.jsx:19`) y recharts nació lazy (`RegistroPaceChart`). Ambos verificados ausentes del chunk `index`. Eso sí resuelve el N9 de la v2.

Severidad **medio–alto**: cada sesión de coach sigue descargando 327 kB gzip antes de pintar.

## 3.2 El caché IA no hace N+1, pero refetchea de más — Medio

`src/components/Athletes/useWorkoutAnalysis.js:45-49` hace **una sola query** con `.in("workout_id", ids)`. No hay N+1.

El problema es la dependencia: el `useEffect` (`:30-63`) depende de `[workouts]`, y ese array se recrea con cada mutación (marcar hecho, drag&drop, editar, RPE). Cada cambio dispara de nuevo la query completa sobre todos los ids **más** un bucle síncrono de `localStorage.getItem` por workout (`:33-37`). Encima, esa query paga en el servidor los dos advisors de `workout_ai_cache` (ver 3.3).

Además `workout_ai_cache_workout_idx` aparece como **`unused_index`** en los advisors: la query del cliente filtra por `kind` + `workout_id IN (…)`, y el API por `workout_id` + `kind`; el índice de una sola columna no se está usando.

## 3.3 Advisors de performance de Supabase

| Advisor | Ocurrencias | Nota |
|---|---|---|
| `auth_rls_initplan` | **80** | `auth.uid()` / `current_setting()` re-evaluado **por fila**. Incluye las 2 policies nuevas de `workout_ai_cache`. Se arregla con `(select auth.uid())` |
| `multiple_permissive_policies` | **83** | Varias policies permisivas para el mismo rol y acción. Incluye `workout_ai_cache` (las 2 `SELECT` de `authenticated` se evalúan siempre ambas) |
| `unindexed_foreign_keys` | 7 | `coach_staff.staff_id`, `coaches.user_id`, `oauth_states.athlete_id`, `plan_purchases.plan_id`, `profiles.parent_coach_id`, `staff_athletes.athlete_id`, `staff_athletes.coach_id` |
| `unused_index` | 8 | Incluye `workout_ai_cache_workout_idx` |

Las tablas más castigadas son justo las del camino caliente: `workouts` (15 avisos) y `athletes` (13).

## 3.4 Memoización de los hooks nuevos

No encontré re-renders por memoización mal hecha. `useAthleteCalendar.js` usa `useMemo` correctamente para `workoutsByDate` (`:47-55`), `calendarCells` (`:61-64`) y `calendarMonthLabel` (`:65-71`), y los efectos dependen de primitivos o de claves serializadas (`athleteIdsKey` en `Athletes.jsx:62-66`), no de objetos recreados. El único coste real es el refetch de 3.2. Se mantiene la conclusión de la v2: **no priorizar** memoización.

## 3.5 Sigue igual

`public/pwa-512.png` = **806,1 KB** (sin cambio). `AthleteHome` **ya no** hace `select("*")` de workouts: usa `ATHLETE_HOME_WORKOUT_COLUMNS` (`AthleteHome.jsx:263,686`) → hallazgo #6 de la v2 **resuelto**.

---

# 4) BUGS

Auditado por [Patrones de bugs](cbcf1658-a17e-4d8d-8efb-919de9824d7f).

## 4.1 ¿Se repiten los patrones de hoy en el resto del código?

| Patrón | ¿Aparece en otro sitio? | Detalle |
|---|---|---|
| Hash no determinista por `JSON.stringify` | **Casi no** | Un caso: `api/integrations.js:884` compara `JSON.stringify(antes) === JSON.stringify(despues)` para decidir si reescribe `structure` en `vdot-resync`. Si el orden de keys cambia, hace un PATCH innecesario o se salta uno necesario. **Medio**. No hay `key={JSON.stringify(...)}` ni claves de caché derivadas de stringify en `src/` |
| `force` con default invertido | **No** | Cero `opts.force !== false`, `?? true` o `|| true` peligrosos fuera de lo corregido. `CoachSettings.jsx:113-114` (`!== false`) es correcto: lee un `DEFAULT true` de la DB con semántica opt-out |
| Columnas inexistentes en selects | **No como bug** | Ver falsos positivos: `test_date` y compañía **existen** en prod. Lo que hay es drift documental (**medio**). `athletes.vdot` ya no se lee en ningún sitio → resuelto. Columnas realmente eliminadas (`workout_structure` en `0044`, `athletes.device` en `0047`, `*_pace` en `0040`) no tienen lectores |
| Z-index conflictivos | **Sí** | Ver 4.2 |
| Doble llamada modal + API | **No** | El anti-patrón se eliminó hoy (`Athletes.jsx:360-361` separa `onAnalyze` de `onOpenAnalysis`). Queda el refetch de 3.2 |
| Errores silenciados | **Sí** | Ver 4.3 |

## 4.2 Colisiones reales de z-index

| Colisión | Ubicación | Sev | Impacto |
|---|---|---|---|
| **10010 duplicado** | `WorkoutRegistroModal.jsx:65` y `WorkoutAnalysisOverlays.jsx:91` | **Alto** | El modal de Registro y el de análisis del coach **pueden estar abiertos a la vez** (se analiza desde el Registro) y comparten z-index: quién queda encima depende del orden en el DOM, no de la intención. Es el conflicto más probable de dar la cara |
| Toast a 200 vs modales 200–301 | `appShared.js:1220` vs `Builder.jsx:611`, `WorkoutLibrary.jsx:997,1096`, `AthleteCalendarSection.jsx:467,695` | Medio | Las confirmaciones del coach pueden quedar **detrás** del modal abierto |
| 10050 triple | `AthleteRpeModal.jsx:23`, `InviteModal.jsx:139`, `DeleteAccountSection.jsx:101` | Bajo | Improbable abrirlos juntos, pero sin jerarquía |
| 10032 doble | `WorkoutLibrary.jsx:977`, `MarketplaceHub.jsx:627` | Bajo | Difícil que coincidan |

**No son bugs** (documentados a propósito): nav atleta 9999 sobre chat 9989, overlays de briefing a 10003 sobre la nav, y el toast de medalla a 10100 por encima del modal RPE.

## 4.3 Errores silenciados con impacto real

| Ubicación | Operación | Sev | Impacto |
|---|---|---|---|
| `useWorkoutAnalysis.js:97-98` | Análisis IA del coach | **Alto** | Si falla la red o el API, solo `console.error`. El coach pulsa "Analizar IA" y **no ve nada**: ni error ni texto |
| `appShared.js:2059-2060` | `evaluateAndAwardAthleteAchievements` | **Alto** | `catch {}` devuelve arrays vacíos: las medallas no se otorgan y nadie se entera |
| `useWorkoutAnalysis.js:214-216` | `adjust-steps` tras aplicar el ajuste IA | Medio–Alto | El workout se actualiza en DB pero `structure` puede quedar desincronizada, en silencio |
| `useAthleteWorkoutRpe.js:211,213` | `pull-activity` al marcar hecho | Medio | El sync con el reloj falla sin avisar |
| `useAthleteCalendar.js:98-99` | Update de `athletes.workouts_done` | Medio | Se suma al problema de 2.3 |

---

# 5) DEUDA TÉCNICA Y LIMPIEZA

Auditado por [Deuda técnica](ad811cfd-2113-4eeb-ad6d-07140968451d).

## 5.1 Inventario de código muerto — la lista de hoy estaba incompleta

| Candidato | Veredicto | Ubicación | Sev |
|---|---|---|---|
| `saveWorkoutRpe` | **Muerto confirmado** | `AthleteHome.jsx:399-422`, cero llamadas (el RPE vive en `useAthleteWorkoutRpe`) | Medio |
| Carga de `races` en AthleteHome | **Muerto confirmado** | Fetch `:369-380`, `racesByDate` `:382-391`, `nextRaceCountdownAthlete` `:394`: **ninguno llega al JSX** | Medio |
| `structureHasGradePct` | **Vivo, footgun confirmado** | `src/lib/gpxRacePlan.js:236-237`, usado en `Builder.jsx:201,213` y `WorkoutLibrary.jsx:504,516` | Medio |
| Form "Nuevo atleta" | **Cableado vivo, UI inalcanzable** | Cero `setShowAddAthleteForm(true)`; el botón del Dashboard abre el InviteModal (`CoachChrome.jsx:254`) | Medio |
| `athleteFormaFatigaTableRows` | **Ya no existe** (falso positivo del mapa viejo) | El vivo es `formaFatigaTableRows` (`FormaFatigaPanel.jsx:21,176`) | — |
| `ATHLETE_SUBSCRIPTION_PLAN_CATALOG`, `readMyLastPushDelivery` | **Eliminados hoy** | Cero matches | — |

**Lo que faltaba en la lista:** estados `achievementsCatalog` y `achProgress` que se escriben y **nunca se leen** (`AthleteHome.jsx:165,167,354,356,413,415,551,553`); `athleteTodayYmd` alimentando un memo huérfano (`:393-394`); imports de carreras huérfanos (`:48-49`); y exports sin consumidores: `default compareBlocks` (`blockComparison.js:262`), `isTestWorkoutTitle` (`enrichPace.js:120`), `mapFitWorkoutType` (`fitImport.js:46`), `EFFORT_TO_ZONE`/`zoneForEffort` (`blockComparison.js:26,49`).

El **footgun de `structureHasGradePct`** sigue exactamente como lo describió la v2: `Number(null)` y `Number("")` dan `0`, y `Number.isFinite(0)` es `true`, así que un `grade_pct` nulo cuenta como "tiene pendiente" y **salta el rescale VDOT** para entrar por Minetti.

## 5.2 Tamaños reales post-split

Medido con la **misma métrica que la v2** (`Get-Content | Measure-Object -Line`):

| Archivo | v2 | Ahora | Δ |
|---|---|---|---|
| `src/components/Athletes/Athletes.jsx` | 3738 | **655** | **−3083** |
| `src/components/AthleteHome.jsx` | 2238 | **971** | **−1267** |
| `src/components/shared/appShared.js` | 2808 | **2134** | **−674** |
| `src/components/Plan2Weeks.jsx` | 2046 | **2046** | 0 |
| `src/components/WorkoutLibrary.jsx` | 1286 | **1291** | +5 |
| `api/integrations.js` | 1193 | **1193** | 0 |
| `src/components/AuthLanding.jsx` | 1091 | **1091** | 0 |
| `src/App.jsx` | 704 | **704** | 0 |
| `api/analyze-workout.js` | — | **655** | nuevo peso (caché IA) |
| `src/components/Athletes/AthleteCalendarSection.jsx` | — | **780** | nuevo |

**Los tres monolitos que la v2 pedía partir se partieron de verdad.** Ningún archivo creció de forma descontrolada con el trabajo de hoy. Los nuevos grandes son `AdminMarketplacePanel.jsx` (1044) y `ChallengesHub.jsx` (989), que nunca se tocaron.

**Sí amerita revisión:** `AthleteCalendarSection.jsx` con **780 líneas** mezcla grid, menú contextual, panel de edición y borrado por rango. Va contra el objetivo del propio refactor (~400 líneas por pieza).

## 5.3 Convenciones del código nuevo

| Aspecto | Veredicto |
|---|---|
| Hooks de dominio junto al feature, lógica pura en `src/lib/` | **Consistente** |
| Naming (camelCase / PascalCase / `use*`) | **Consistente** |
| Comentarios en español explicando el *por qué* | **Consistente** (`useWorkoutAnalysis.js:5-9`, `WorkoutRegistroModal.jsx:22-24`, `intervals.js:238-240`) |
| Estilos compartidos | **Parcial**: AthleteHome recibe `cardStyle={S.card}`; los modales del coach son inline puro |
| Manejo de errores | **Parcial**: mezcla `notify` y `console.error` (`useWorkoutAnalysis.js:98,155`); `Builder.jsx:233` aún usa `alert()` |
| Tamaño de componente | **No** en `AthleteCalendarSection` (780 L) |

Sobre duplicación de estilos: `appShared.js` solo expone `root`, `sidebar`, `navBtn`, `page`, `pageTitle`, `card` (`:1190-1196`), `avatar` y `notification` (`:1209-1222`). **No hay token de overlay de modal, botón primario ni stat-card**, así que las 4+ copias inline del overlay (`WorkoutRegistroModal.jsx:65`, `WorkoutAnalysisOverlays.jsx:20,91`, `AthleteCalendarSection.jsx:467,695`) son deuda **compartida con todo el repo**, no una regresión del código de hoy. El toast de medalla (`AthleteMedalToast.jsx:14-28`) sí copia `styles.notification` inline, y el propio comentario lo reconoce.

---

# 6) PRODUCTO / UX

Auditado por [Producto y UX](e6dc2e1f-507e-46bd-a7b3-3817ffcc222b).

## 6.1 El sesgo de los TEST está solo parcialmente cerrado

El arreglo (`src/lib/enrichPace.js:113-151`) actúa **solo** sobre `description`, **solo** con títulos que matcheen `/TEST\s*\d*K/i`, y **solo** en la asignación desde Biblioteca y Builder. Verificado en la base de datos:

| Evidencia | Estado |
|---|---|
| `workout_library` id **168** "S10 Dom - TEST 10K" | Descripción **sigue** con `"Objetivo: 40:00-41:00 (VDOT 46-47)"` |
| `workout_library` id **198** "S16 Dom - TEST 5K" | Descripción **sigue** con `"Objetivo: 19:30-20:00 (VDOT 46-47)"` ← **no se había mencionado** |
| `workouts` id **1031** (asignado 2026-08-30) | **Sigue** con `"Objetivo: 40:00-41:00"` (no hubo backfill, por diseño) |
| `workouts` id **1039** (asignado 2026-09-02) | `"TEST 10K - corre a tu máximo esfuerzo sostenible"` → **el fix funciona en asignaciones nuevas** |
| `workouts` id **905** "Carrera 5K / Test final" | `"…iniciando suave a 7:13–7:54 min/km según sensaciones"` → **la regex no lo cubre** ("Test" sin `K` detrás) |

Huecos concretos, todos **alto** salvo indicación:

1. **`target_pace` de la estructura nunca se limpia**, aunque el título matchee. Tras el rescale, los bloques de un TEST 10K llevan ritmos numéricos que el atleta ve en el detalle (`WorkoutDetailBreakdown.jsx:29-31`) y que **el reloj recibe** vía `intervals.js`. El ancla sobrevive por otro canal.
2. **La regex se queda corta**: no cubre `TEST 1 milla`, `TEST 1600m`, `Test Cooper`, `Test Umbral`, `Contrarreloj 5K`, `Time Trial 10K`, `Prueba 10K`, ni `"Carrera 5K / Test final"`.
3. **Plan2Weeks (`:1067-1078`) y Marketplace (`:317`) no aplican el strip**, así que un plan con TEST importado por esas rutas llega sucio.
4. **La biblioteca no se backfilleó**: las filas 168 y 198 siguen mostrando el objetivo de reloj en la UI de biblioteca y en el preview del Builder, antes de cualquier asignación.

## 6.2 Otros anclajes del mismo tipo

Aplicando el criterio de hoy, el caso más fuerte **no es un TEST**:

| Ubicación | Qué ancla | Sev |
|---|---|---|
| `EvaluationView.jsx:406-452` | **"TIEMPOS PREDICHOS"** más etiquetas **"Élite / Avanzado / Intermedio / Principiante"** por tiempo. La pestaña Eval es accesible al atleta (`AthleteHome.jsx:914-922`) | **Alto** — le pone una autoetiqueta identitaria y una meta de maratón/21K antes de tener base |
| `EvaluationView.jsx:122-123` | Defaults persistidos `raceTime = "00:45:00"` y `cooperDistance = "2800"` | Alto — sesga la entrada del propio test si no se borra el placeholder |
| `Plan2Weeks.jsx:830,854-861` | El prompt manda `Target time` y **"Use these EXACT ranges in every description"** | Alto — las sesiones generadas llevan ritmos explícitos en la descripción que ve el atleta |
| `api/analyze-workout.js:486` | *"¿Cumplió el objetivo del workout?"* | Medio — empuja al coach a juzgar cumplimiento de plan, no esfuerzo relativo; en un test mal prescrito refuerza el sesgo |
| `useAthleteWorkoutOverlays.js:45` | `Objetivo: ${athleteGoal}` en el briefing pre-sesión | Medio |
| `appShared.js:1836-1842` | Push *"Tus ritmos se ajustaron a VDOT X"* con VDOT aspiracional, no medido | Medio |

Bien resuelto y no hay que tocar: `WorkoutRegistroModal.jsx:102-103` avisa de que el ritmo previsto es *"referencia para interpretar la ejecución, no un objetivo exacto"*; `EvaluationView.jsx:138-140` pide máximo esfuerzo en Cooper/umbral; `:606-607` aclara que la FC de umbral no cambia el VDOT; `Plan2Weeks.jsx:307-316` alerta si el tiempo objetivo diverge ≥3 puntos del VDOT.

## 6.3 Coherencia de lo añadido hoy

**Las 3 mejoras Garmin: coherentes.** Las pills de filtro usan el teal `#0d9488` que ya identifica el subsistema de datos/reloj (mismo tono que el header de pasos en `WorkoutDetailBreakdown.jsx:130`), el gráfico respeta la tipografía del modal (`.78em`/`.72em`) y explica su eje invertido con *"Más alto = más rápido"*, y las vueltas expandibles usan el patrón ▸/▾ del resto. Los emojis de los menús (📋, 📊) siguen la convención.

**Toast de logros: inconsistencia menor.** `AthleteMedalToast.jsx:11-33` comparte paleta con `styles.notification` pero se posiciona arriba-centro mientras el toast del coach va arriba-derecha. Y el copy difiere entre las dos rutas que lo disparan: `AthleteHome.jsx:418` dice *"¡Nueva medalla desbloqueada! 🎉 …"* y `useAthleteWorkoutRpe.js:45-46` la misma frase **sin** el 🎉. Severidad **bajo**.

**Persistencia IA: asimétrica entre coach y atleta.** Severidad **medio**.

| | Coach | Atleta (briefing) |
|---|---|---|
| ¿Indica que el texto viene de caché? | No (solo `console.log`) | No |
| ¿Puede regenerar desde la UI? | **No** hay botón "Regenerar" (`WorkoutAnalysisOverlays.jsx:90-114`) | Sí, con `force: true` |
| Etiquetas | "🤖 Analizar IA" vs "📄 Ver análisis" | "Generando briefing con IA…" → texto |

El atleta entiende el modelo (ver / regenerar); el coach no distingue un análisis recién generado de uno guardado y **no tiene forma de forzar la regeneración**. Se suma el riesgo de 4.3: si el análisis falla, el coach no ve error. Y `localStorage` (`raf_analysis_${id}`) se hidrata **sin comparar hash**, así que "Ver análisis" puede mostrar un texto viejo que ya no corresponde al workout (p. ej. después de cambiar el RPE) sin ninguna señal.

---

# PRIORIZACIÓN FINAL — Top 10

## URGENTE (seguridad, datos, dinero)

| # | Hallazgo | Ubicación | Sev | vs v2 |
|---|---|---|---|---|
| **1** | `RESEND_API_KEY` filtrada en la historia de un repo **público** y **sin rotar** | `git show 9c3d219:.env`; repo `carlosacme/PaceForge` | **Crítico** | **Nuevo** (la v2 lo daba por resuelto) |
| **2** | Envenenamiento del caché IA: `analyze` no exige `allowed` y escribe con service_role el `workout_id` del cliente | `api/analyze-workout.js:435,441,506,542` | **Crítico** | **Nuevo** (introducido hoy) |
| **3** | Presupuesto de IA inoperante: drift de `0013` (sin `UNIQUE`, sin policy UPDATE) → tope mensual congelado y tope diario evitable con filas duplicadas | `lib/aiBudget.js:94-99,162`; `Builder.jsx:93-97`; prod | **Alto** | **Nuevo** |
| **4** | `analyze-workout` sin cuota alguna: cualquier autenticado factura Claude (4000 tokens/req) | `api/analyze-workout.js:370` | **Alto** | **Igual** (la v2 ya lo señaló; `generate-workout` sí se arregló) |
| **5** | Marketplace asigna sin `rescaleStructureToVdot` **y** marca `generated_with_vdot` del atleta → ritmos ajenos + calibración falsa | `MarketplaceHub.jsx:312,320`; `enrichPace.js:93` | **Alto** | **Nuevo** (misma clase que el bug de Builder de hoy) |
| **6** | Endpoints que confían en el body: auto-otorgamiento de logros; email con marca de la app a destinatario arbitrario; `role`/`coach_id` en re-registro | `achievements.js:46-57`; `send-email.js:155-173`; `create-profile.js:26-36` | **Alto** | **Igual** (logros) / **detalle nuevo** |
| **7** | Integridad coach↔atleta: registro sin código anula `athletes.coach_id`; `workouts_done` no se actualiza cuando marca el atleta; `coach_staff`/`staff_athletes` desincronizables | `create-profile.js:88`; `useAthleteWorkoutRpe.js:173-181`; `CoachSettings.jsx:354-392` | **Alto** | **Nuevo** |

## INCREMENTAL (performance, deuda, UX)

| # | Hallazgo | Ubicación | Sev | vs v2 |
|---|---|---|---|---|
| **8** | Sesgo TEST cerrado a medias: `target_pace` sin limpiar, regex corta, biblioteca sin backfill (ids 168 y **198**), Plan2Weeks/Marketplace sin strip. Además "TIEMPOS PREDICHOS" + etiquetas Élite/Principiante visibles al atleta | `enrichPace.js:113-151`; `EvaluationView.jsx:406-452` | Alto (producto) | **Nuevo** |
| **9** | Bundle eager 1 071 kB / 327 kB gzip: los splits **no** lo bajaron porque `Athletes` sigue importado estático; + refetch del caché IA en cada cambio de `workouts` | `CoachChrome.jsx:2`; `useWorkoutAnalysis.js:30-63` | Medio–alto | **Cambió** (los monolitos sí se partieron; el chunk no bajó) |
| **10** | Higiene: z-index 10010 duplicado (Registro vs análisis), errores silenciados con impacto (análisis IA, medallas), código muerto confirmado, footgun `structureHasGradePct`, `AthleteCalendarSection` 780 L, 80 `auth_rls_initplan`, PNG 806 KB, `npm audit` idéntico | varias | Medio–bajo | **Igual + extras** |

## Comparación explícita contra `full-audit-2026-08-v2.md`

### Resuelto hoy

| Hallazgo v2 | Evidencia |
|---|---|
| **#1 Crítico — Wompi `amount_cop` del cliente** | Precio server-side desde `plan_marketplace.price_cop` o catálogo; promo revalidada por RPC; el `amount_cop` del cliente solo se compara (`wompi-create-checkout.js:90-157`) |
| **#9 / #5 — Partir `Athletes` / `AthleteHome` / `appShared`** | 3738→**655**, 2238→**971**, 2808→**2134** |
| **N9 — Leaflet eager en Athletes** | Ahora `React.lazy` (`WorkoutRegistroModal.jsx:19`), chunk propio de 156 kB, ausente del bundle eager. jsPDF también en chunk aparte |
| **#7 — Análisis IA sin ritmos de bloque ni VDOT real** | `blocksPromptSection` + `compareBlocks` + `latestVdotForAthlete` desde `athlete_evaluations` (`analyze-workout.js:190-207,335-358`) |
| **N4 — cliente leía `athletes.vdot` (columna inexistente)** | Cero lectores; confirmado que la columna no existe en prod |
| **#6 — `AthleteHome` `workouts select("*")`** | Ahora `ATHLETE_HOME_WORKOUT_COLUMNS` (`AthleteHome.jsx:263,686`) |
| **#2 (mitad) — `generate-workout` sin rate-limit** | Ya tiene `assertGenerateBudget`… pero el presupuesto está roto por drift (urgente #3) |

### Sigue exactamente igual

`analyze-workout` sin cuota y sin gate en `analyze`/`adjust` (N3, ahora peor porque persiste) · los **6** `createClient(serviceKey)` sin la política de `adminHeaders` (N1) · `ADMIN_EMAIL` + UUID admin en cliente y en `is_admin()` SQL (#4) · `npm audit` 33/20 idéntico (#8) · `oauth_states` con 0 policies · 3 views `SECURITY DEFINER` (advisor ERROR) · `0064` sin aplicar · `POST /api/achievements` con código arbitrario · `find_coach_by_code` duplicado · form "Nuevo atleta" inalcanzable · footgun `structureHasGradePct` (N6) · descripciones viejas sin backfill (N7) · `public/pwa-512.png` 806 KB · prop drilling de `CoachChrome` e invite/plan state en `App.jsx`.

### Nuevo en v3

Key de Resend viva en repo público (#1) · envenenamiento del caché IA (#2) · presupuesto IA roto por drift de `0013` (#3) · Marketplace sin rescale + `generated_with_vdot` falso (#5) · `UPDATE` de `workouts` sin restricción de columnas para `authenticated` · pares de tablas desincronizables más allá de `coach_id` (#7) · el bundle eager no bajó pese a los splits (#9) · `EFFORT_TO_ZONE` divergente entre `intervals.js` y `blockComparison.js` · z-index 10010 duplicado · `TEST 5K` (id 198) y títulos tipo "Test final" fuera de la regex · asimetría de UX en la persistencia IA (coach sin "Regenerar" ni indicador de caché) · 80 `auth_rls_initplan` + 83 policies permisivas múltiples · `AthleteCalendarSection` 780 L.

---

## Notas finales

- Sin cambios de código, schema ni datos. No se ejecutó ninguna sentencia de escritura contra Supabase.
- No se imprimen valores de secretos: de la key filtrada solo se compara el prefijo, que ya es público en la historia del repo.
- Lo **no verificable** desde aquí queda marcado como tal: estado de las legacy keys de Supabase, formato real de la service key en Vercel, y comportamiento en Preview con sesión (SSO de Vercel).

*Fin de la auditoría v3 — solo lectura.*
