# Mapeo: rate-limit de `/api/generate-workout`

Fecha: 2026-08-29  
HEAD de referencia: `master` (docs; el fix de Wompi vive en `test/wompi-amount-validation` y no se toca)  
Estado: **solo mapeo**. Sin implementación.

Problema (audit v1 #2 / v2 #2): el endpoint exige JWT pero reenvía el body a Anthropic (`max_tokens` hasta 32k). Un loop del frontend, una cuenta comprometida o un `curl` con sesión válida queman `ANTHROPIC_API_KEY`. El “límite 100/mes” del plan Básico **solo vive en el cliente**.

---

## 1) Qué hace el endpoint hoy

`api/generate-workout.js` — proxy genérico a `https://api.anthropic.com/v1/messages`.

| Paso | Qué ocurre |
|---|---|
| Auth | `requireUser` (Bearer = JWT de sesión). Sin JWT → 401. **No** mira `profiles.role` ni el plan. |
| Body | Se reenvía casi entero: `model`, `system`, `messages`, `thinking`, etc. |
| `max_tokens` | Si el cliente manda un número > 0: `min(pedido, 32000)`. Si no: **2000**. |
| Retry | Si `thinking: { type: "disabled" }` sale 400, **segunda** llamada con `budget_tokens: 1024`. |
| Respuesta | Status y JSON de Anthropic al cliente. Log: `user.id`, `usage`, `stop_reason`. |

No hay cola, no hay techo de peticiones, no hay techo de `$`, no hay `maxDuration` en `vercel.json`. El único techo implícito es el timeout de la función Vercel (Hobby ~10 s; Pro ~60 s salvo `maxDuration`). Una llamada que se corta por timeout **puede haber cobrado ya** en Anthropic.

### Call sites (todos `authApiFetch` / POST)

| UI | `max_tokens` | Rol | Tras éxito |
|---|---|---|---|
| `Builder.jsx` (~287) | **8000** | Coach (chrome) | Incrementa `ai_generations` |
| `Plan2Weeks.jsx` (~940) | **32000** | Coach | Incrementa `ai_generations` |
| `AdminMarketplacePanel.jsx` (~576) | **32000** | Admin | No incrementa |
| `ChallengesHub.jsx` (~419) | **8000** | Solo `isAdmin` en UI | No incrementa |

Costo aproximado (orden de magnitud, Sonnet ~USD 3/M input + 15/M output; no es factura real):

| Llamada típica | Input | Output (techo) | ~USD / OK | Peor caso (llena el techo) |
|---|---|---|---|---|
| Builder (1 workout JSON) | ~2–4k | ~2–4k (máx 8k) | **0,04–0,10** | ~0,15 |
| Plan 2 semanas | ~4–8k | 8–20k (máx 32k) | **0,20–0,40** | **~0,50** |
| Marketplace plan N semanas | similar / peor | máx 32k | **0,30–0,80** | **~0,50+** |
| Reto admin | ~1k | ~1k | **< 0,03** | ~0,15 |

Un loop de 100× Plan2Weeks en un día: **decenas de USD**, no cientos — salvo que alguien suba `max_tokens` y el prompt. El riesgo real es **cuenta free/robada + script**, no un coach distraído.

---

## 2) Quién puede llamarlo

**Servidor:** cualquier usuario con sesión válida (`requireUser`). Atleta, coach, staff, admin: el proxy no distingue.

**Producto (UI):**

| Quién | ¿Usa generate-workout? |
|---|---|
| Coach / staff (Builder, Plan 2 semanas) | Sí |
| Admin (marketplace + retos) | Sí |
| Atleta | **No** en la UI. `AthleteHome` usa `/api/analyze-workout` (`briefing`), no este proxy |

**Plan:**

- Básico (`basico` / `starter` / plan vacío): UI bloquea a **100 generaciones / mes** (`Builder` / `Plan2Weeks`).
- Pro: UI dice “Ilimitado”.
- Admin: salta el chequeo.
- El contador es `ai_generations.count` por `coach_id` + `month` (`YYYY-MM`). **Solo el cliente** lee y escribe. Un POST directo al API no incrementa y no se rechaza.

Conclusión: el límite de plan **debería** influir (Básico 100/mes es promesa de producto), pero hoy **no es enforceable**. Pro no puede ser “∞” en el servidor: hace falta un techo de abuso (día / ráfaga) distinto del techo comercial.

---

## 3) ¿Hay rate-limit reutilizable?

**No hay middleware de rate-limit en `/api`.**

| Qué hay | Sirve para esto |
|---|---|
| `ai_generations` (`0013_*.sql`) | **Casi.** Tabla mensual por coach, RLS own-row. Pensada para el tope Básico. Escritura **desde el browser** (se puede saltar o falsear). No hay RPC atómica `increment_if_under`. |
| Admin `Coaches.jsx` | Solo **lee** `ai_generations` para el directorio. |
| Strings “rate limit” en `appShared` | Errores de **Supabase Auth / email**, no de IA. |
| `integrations.js` “rate limit” | Comentarios sobre **intervals.icu**, no Anthropic. |
| Redis / Upstash / `@upstash/ratelimit` | **No** en `package.json`. |
| Vercel WAF / Firewall rate limit | No configurado en el repo. Existe en el dashboard (plan Pro+), por IP, no por `user.id`. |

`weather.js` y `generate-workout` son el mismo patrón (JWT → cuota de tercero). El precedente útil es **`ai_generations`**, no un servicio nuevo.

---

## 4) Opciones (Vercel Functions + Supabase)

### A) Endurecer `ai_generations` en el servidor (recomendado para el tope mensual)

Antes de llamar a Anthropic, con service_role / RPC:

1. Resolver `profiles.role` + `subscription_plan`.
2. `INSERT … ON CONFLICT (coach_id, month) DO UPDATE SET count = count + 1` **solo si** `count < techo`.
3. Si no cabe → **429** sin tocar Anthropic.

Pros: ya existe la tabla; el admin ya la mira; Básico 100/mes queda de verdad.  
Contras: granularidad **mes**. Un loop de 80 llamadas en 10 minutos en Pro (o Básico día 1) sigue pasando. El incremento hay que hacerlo **antes** de Anthropic (si no, el loop no se frena a tiempo) y aceptar un +1 si Anthropic falla.

### B) Tabla de ráfaga / día (`ai_usage_events` o `count` por `day`)

Fila `(user_id, day, kind, count)` o eventos con `created_at`. Techo **por día** y/o ventana de 10–15 min (contar filas recientes).

Pros: para el loop es lo que importa.  
Contras: migración nueva; hay que borrar/archivar.

Se puede combinar: mensual en `ai_generations` + diario en la misma tabla ampliando la clave, o una tabla chica `ai_daily_usage (user_id, day, generate_count, analyze_count)`.

### C) Upstash Redis

Pros: sliding window limpio, no satura Postgres.  
Contras: **cuenta y env nuevas**, fuera del stack actual. No hace falta para el volumen de coaches de RAF.

### D) Vercel nativo

Firewall / “Rate Limiting” del dashboard: por IP, sin leer JWT. Útil como red de emergencia (p. ej. 60 POST/min/IP a `/api/generate-workout`). **No** sustituye el tope por usuario ni el de plan. No añade dependencia al repo; se configura en Vercel si el plan lo incluye.

**Recomendación:** A + techo diario en Postgres (B mínimo: una columna o tabla `day`). Sin Redis. WAF por IP opcional, no bloqueante del Paso 2.

---

## 5) Límite razonable (uso normal)

Uso esperado de un coach en un día de verdad:

| Acción | Veces / día típico | Veces / día pico (varios atletas) |
|---|---|---|
| Builder “generar 1 workout” | 1–5 | 10–15 |
| Plan 2 semanas | 0–2 | 3–5 (varios atletas) |
| Marketplace / reto (admin) | 0–1 | 2–3 |

**100/mes Básico** ≈ 3–4 generaciones/día si se reparte el mes. Encaja con Builder; **no** encaja con “ilimitado” si alguien pega Plan2Weeks en un `while`.

Propuesta para el Paso 2 (calibrar, no grabar en piedra):

| Techo | Básico | Pro | Admin | Para qué |
|---|---|---|---|---|
| **Mes** (`ai_generations`) | **100** (ya prometido en UI) | **400** (no ∞) | 400 o exento mes, **nunca** exento de ráfaga | Producto |
| **Día** (nuevo) | **20** | **40** | **60** | Loop / script |
| **15 min** (opcional v1.1) | 8 | 8 | 12 | Bug de reintento |

429 claro: `{"error":"Límite de generaciones IA alcanzado","reset":"…"}`. La UI de Básico puede seguir mostrando `n / 100`; el servidor es la fuente de verdad.

Atleta: no necesita cuota en **este** endpoint si el Paso 2 sigue siendo “cualquier JWT”. Conviene **429 genérico** igual (p. ej. 5/día) por si pegan el proxy a mano. Alternativa más estricta: 403 si `profiles.role === 'athlete'` — cambia el contrato (hoy el API los acepta). Preferible **no** 403 en v1; el techo diario los cubre.

---

## 6) Otros proxies Anthropic — ¿el mismo fix?

### `/api/analyze-workout` — **mismo problema, otro endpoint**

| Acción | Quién | `max_tokens` | Scoped |
|---|---|---|---|
| `mode=briefing` | Atleta (`AthleteHome`) | 400 | **No.** Prompt libre del body. |
| `action=analyze` | Coach (`Athletes.jsx`) | 4000 | `requireUser` only; workout viene del cliente |
| `action=adjust` | Coach | 4000 | igual |
| `adjust-steps` | Coach | (escala local; Claude en adjust) | `getWorkoutIfAllowed` |

Costo/call más bajo que Plan2Weeks, pero **briefing** es fácil de spamear (un clic por workout, o un script). Un atleta con JWT válido quema la misma `ANTHROPIC_API_KEY`.

**No meter analyze en el mismo PR que generate** si se quiere un Paso 2 pequeño. **Sí compartir helper** (`assertAiBudget(userId, kind)`) y aplicarlo a analyze en un Paso 2b (mismo techo diario, `kind=analyze|briefing`, números más altos: p. ej. 30 briefing + 20 analyze / día).

No hay más `api.anthropic.com` en el repo.

---

## 7) Riesgos del Paso 2

1. **Contar en el cliente sigue siendo inútil** — hay que **dejar de confiar** en `incrementGenerationCounter` como defensa. Puede quedar como UX.
2. **RLS de `ai_generations`** — el usuario puede `update` su `count`. El servidor debe usar service_role / RPC, no el JWT del coach.
3. **Plan2Weeks vs Builder** — un solo “count” trata igual 8k y 32k. Aceptable en v1; v1.1: ponderar (`plan2` = 3 créditos) o techo diario más bajo para `max_tokens > 8000`.
4. **Incremento antes vs después de Anthropic** — antes = el loop para; un 500 de Claude consume cuota. Después = el loop no para. **Antes.**
5. **Staff** — `coach_id` en `ai_generations` es `auth.uid()`. Cada staff tiene su cupo, no el del dueño. Documentar; no reasignar en v1.
6. **No mezclar** con el Preview de Wompi.

---

## 8) Contrato propuesto (no implementado)

```
POST /api/generate-workout
  requireUser
  → assertAiBudget(user.id, "generate")   // 429 si excede día y/o mes
  → (opcional) clamp max_tokens ya existe
  → Anthropic
```

Helper en `lib/aiBudget.js` (junto a `apiAuth.js`).  
Mes: reutilizar `ai_generations`.  
Día: tabla nueva mínima o `month` + `day` — decidir en Paso 2.  
Sin Upstash. WAF por IP opcional en dashboard.

Tamaño estimado del fix generate-only: **S–M (~80–150 líneas + 1 migración)**.  
Paso 2b analyze: **+30–50** reutilizando el helper.

---

## 9) Fuera de alcance

- Bajar `max_tokens` de Plan2Weeks (producto, no rate-limit).
- Pagar Anthropic por atleta.
- Redis.
- Unificar el score Garmin / Wompi.

*Fin del mapeo — sin cambios de runtime en este commit.*
