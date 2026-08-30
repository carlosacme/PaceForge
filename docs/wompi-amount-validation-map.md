# Mapeo: validación server-side de `amount_cop` (Wompi)

Fecha: 2026-08-29  
HEAD de referencia: `c50a001` (`master`)  
Archivo crítico: `api/wompi-create-checkout.js`  
Estado: **solo mapeo**. Sin fix. Esperando validación.

Problema (audit v1 #1 / v2 #1): el servidor **firma e inserta** el monto que manda el cliente. El único filtro es `>= 5000` COP. El webhook acredita el plan según `plan_key` / `payer_type` de la fila PENDING, no según lo que Wompi cobró vs catálogo. Pagar el mínimo → plan Pro / premium / marketplace completo.

---

## 1) Dónde entra `amount_cop` y dónde se firma

Flujo del handler (`api/wompi-create-checkout.js`):

| Paso | Líneas | Qué hace |
|---|---|---|
| Recibe body | **49–56** | Desestructura `payer_type`, `plan_key`, `plan_period`, **`amount_cop`**, `marketplace_plan_id`, `marketplace_purchase_id` |
| Piso mínimo | **63–66** | `Math.round(Number(amount_cop))`; rechazo solo si no es finito o **`< 5000`** |
| Cents | **67** | `amountInCents = amountNum * 100` |
| Combo plan/período | **69–84** | Valida *claves*, no montos |
| Insert PENDING | **89–104**, **`amount_cop: amountNum` (96)** | Persiste el monto del cliente |
| Firma Wompi | **111–112** | `SHA-256(reference + amountInCents + "COP" + integrity_secret)` |
| Respuesta | **114–122** | Devuelve `amount_in_cents` + `signature` |
| Cliente | PlanPicker / AthleteHome / MarketplaceHub | Abre `checkout.wompi.co` con esos query params |

**Línea exacta donde falta la validación de catálogo:** entre **63–67** (hoy solo el piso) y **96 / 111** (ya se confía en ese número). El sitio correcto del fix: **después** de validar `payer_type` + combo plan (69–84), **antes** del insert y de la firma: derivar `expectedCop` y **ignorar o exigir igualdad** con `amount_cop`.

El webhook (`api/wompi-webhook.js`) **no** relee un catálogo. Si `APPROVED`, activa:

- coach → `subscription_plan` = `"Pro"` si `plan_key === "pro"`, si no `"Basico"` (`:177`)
- atleta → `athlete_plan: "premium"` (`:202`)
- marketplace → `plan_purchases.payment_status = confirmed`

`subscription_amount` se copia de `paymentRow.amount_cop` (el PENDING). Arreglar create-checkout es suficiente para el agujero de dinero; el webhook ya no debe “inventar” un precio.

---

## 2) Dónde vive el catálogo (y que **no** está en `api/`)

Hay **tres** fuentes de precio. Ninguna de las de suscripción vive hoy en el servidor.

### A) Coach Básico/Pro — list price real del checkout

| | |
|---|---|
| Archivo | `src/components/PlanPicker.jsx` **7–22** |
| Símbolo | `COACH_PLAN_PICKER_DEFS` (constante de módulo, **no exportada**) |
| ¿Cliente o server? | **Solo frontend** |
| ¿Importable desde `api/`? | No, sin mover/duplicar |

```js
basico.prices = { monthly: 100000, semestral: 528000, anual: 960000 }
pro.prices    = { monthly: 160000, semestral: 844800, anual: 1536000 }
```

Comentario en código: mensual = base; semestral −12%; anual −20%.  
Comprobación: `100000 × 6 × 0.88 = 528000`, `100000 × 12 × 0.80 = 960000`, igual con 160000 → 844800 / 1536000.

**Trampa de claves:** el picker usa período UI `monthly` / `semestral` / `anual`. Al POST mapea `monthly` → **`"mensual"`** (`PlanPicker.jsx:123`). El API valida `basico|pro` × `mensual|semestral|anual` (`wompi-create-checkout.js:69`). El catálogo server-side debe indexar por **`mensual`**, no `monthly`, o mapear igual.

### B) Atleta solo (premium)

| | |
|---|---|
| Archivo | `src/components/AthleteHome.jsx` **73–74** |
| Símbolo | `SOLO_PLAN_MONTHLY_COP = 25000`, `SOLO_PLAN_ANNUAL_COP = 250000` |
| ¿Cliente o server? | **Solo frontend** |

Períodos que manda el cliente: `"monthly"` | `"annual"` (inglés). El API ya espera eso (`VALID_ATHLETE_PLANS`).

### C) Marketplace — precio por fila en BD

| | |
|---|---|
| Tabla | `plan_marketplace.price_cop` |
| Cliente | `MarketplaceHub.jsx:252` manda `amount_cop: Number(plan.price_cop)` |
| ¿Server puede leerlo? | **Sí**, con `marketplace_plan_id` + service_role. No hace falta catálogo estático. |

El coach/admin fija el precio al publicar (admin AI clamp 50 000–300 000; el form del coach no tiene ese clamp). El valor de verdad es la fila, no un mapa en código.

### D) Catálogo que **no** es Wompi (no usar en el fix)

`appShared.js` `PAYMENT_PLAN_AMOUNT_COP` = `{ Basico: 129000, Pro: 199000 }`.

Es el default al **registrar un pago en efectivo** (`Athletes.jsx` / `defaultPaymentAmountStringForPlan`). No pasa por `/api/wompi-create-checkout`. **No** son los precios del picker (100k/160k). Mezclarlos rompería el checkout legítimo.

---

## 3) Productos que hoy pasan por el endpoint

Tres `payer_type` (`VALID_TYPES`, línea 58). Call sites: solo esos tres `fetch`.

### Coach (`coach_subscription`) — 6 SKUs

Fuente: `COACH_PLAN_PICKER_DEFS` + mapeo `monthly`→`mensual`. Monto **de lista** (antes de promo).

| `plan_key` | `plan_period` (body) | COP de lista |
|---|---|---|
| `basico` | `mensual` | **100 000** |
| `basico` | `semestral` | **528 000** |
| `basico` | `anual` | **960 000** |
| `pro` | `mensual` | **160 000** |
| `pro` | `semestral` | **844 800** |
| `pro` | `anual` | **1 536 000** |

### Atleta independiente (`athlete_solo_subscription`) — 2 SKUs

| `plan_key` | `plan_period` | COP |
|---|---|---|
| `premium` | `monthly` | **25 000** |
| `premium` | `annual` | **250 000** |

Sin promo. WhatsApp (`openAthletePremiumWa`) es un canal paralelo, no Wompi.

### Marketplace (`marketplace_purchase`) — N SKUs

| Campo | Valor |
|---|---|
| `plan_key` / `plan_period` | `null` / `null` (el API pone `"mp"` / `"x"` en la reference) |
| Monto | `plan_marketplace.price_cop` de **esa** fila |
| Extra | `marketplace_plan_id` (obligatorio), `marketplace_purchase_id` (fila `plan_purchases` ya insertada en `initiated`) |

No hay lista fija. Default de UI al publicar: 120 000. Rango admin sugerido 50k–300k; un coach puede guardar otro entero.

---

## 4) Qué manda el cliente (para derivar el monto)

Body actual (todos los call sites):

| Campo | Coach | Atleta | Marketplace | ¿Sirve para precio? |
|---|---|---|---|---|
| `payer_type` | `coach_subscription` | `athlete_solo_subscription` | `marketplace_purchase` | Sí — elige catálogo |
| `plan_key` | `basico` \| `pro` | `premium` | `null` | Sí (coach/atleta) |
| `plan_period` | `mensual` \| `semestral` \| `anual` | `monthly` \| `annual` | `null` | Sí (coach/atleta) |
| `amount_cop` | lista o con % promo | lista | `price_cop` del plan | **No confiar** |
| `marketplace_plan_id` | — | — | uuid | Sí — lookup BD |
| `marketplace_purchase_id` | — | — | uuid | No es precio; ancla la compra. Conviene comprobar que `plan_id` + `buyer_user_id` + `price_paid` coinciden |
| **`promo_code`** | **no se envía** | — | — | **Falta** para validar descuento en server |

Auth: `Authorization: Bearer <access_token>`. Identidad = JWT, no el body.

**Regla de derivación propuesta (Paso 2, no implementar ahora):**

1. Coach: `LIST[plan_key][plan_period]`, luego aplicar promo **revalidado en server** si viene `promo_code`.
2. Atleta: `25000` / `250000` según `plan_period`.
3. Marketplace: `SELECT price_cop FROM plan_marketplace WHERE id = marketplace_plan_id` (y que esté activo/aprobado). Ignorar `amount_cop`.
4. Firmar e insertar **solo** el monto derivado. El `amount_cop` del body se puede borrar o usar como assert (`=== expected`) para cachar desync de UI.

Vercel ya importa `src/lib/*` desde `api/` (`analyze-workout.js` → `workoutStructure.js`). Un módulo `src/lib/planPrices.js` (o `lib/planPrices.js`) lo pueden usar el endpoint y PlanPicker/AthleteHome. Evitar dejar la única copia en un `.jsx`.

---

## 5) Promos (`validate_promo_code` / `redeem_promo_code`)

Solo el **coach picker** usa promo. Atleta y marketplace no.

### Flujo actual (todo en el cliente)

1. `validate_promo_code(code)` → `{ discount_percent, max_uses, uses_count }` si activo, no vencido, con usos.
2. UI: `amountCop = round(lista * (100 - pct) / 100)` (`PlanPicker.jsx:103–104`). Piso **0**, no 5000.
3. **Antes** del checkout: `redeem_promo_code` incrementa `uses_count` (`:108–121`).
4. POST a Wompi con el monto ya descontado. **Sin mandar el código.**

RPCs: `0007_promo_codes_coach_profiles.sql`. `discount_percent` 0–100. GRANT a `authenticated`. El API de Wompi **no** las llama.

### Implicaciones para la validación

- Si el server solo acepta los 6 precios de lista, **rompe** todos los checkouts con promo (p. ej. 10% sobre Básico mensual = **90 000**, no 100 000).
- El server **no puede** adivinar el %: el body no trae código. El Paso 2 debe **añadir `promo_code`** (o dejar de redimir en el cliente y redimir en el endpoint).
- Recalcular: `expected = round(list * (100 - pct) / 100)` con el `discount_percent` de **`validate_promo_code` otra vez en server** (service_role o RPC). No aceptar `discount_percent` del body.
- **Orden actual:** redeem **antes** de crear la transacción. Si Wompi falla o el user cierra, el uso ya se quemó. El fix de monto es buen momento para redimir **después** de insertar PENDING (o al APPROVED). Fuera del mínimo del Paso 2, pero no empeorar: si el cliente sigue redimiendo y el server exige el código *y* el monto descontado, un segundo validate puede fallar por `uses_count` (el redeem ya corrió). **O** el server confía en “monto ∈ { lista, lista×(1−pct) para algún código activo }” (flojo) **o** se mueve el redeem al server y el cliente deja de llamar `redeem_promo_code`. Lo segundo es lo correcto.
- Promo **100%** → `amountCop = 0` → el API actual responde 400 (mín. 5000). Wompi tampoco cobra 0. Un 100% no puede pasar por este checkout; es WhatsApp/admin, no un caso que la validación estricta “rompa” de más.

Atleta/marketplace: no hay promo que preservar.

---

## 6) ¿Hay montos arbitrarios legítimos?

**No** en este endpoint.

| Caso | ¿Pasa por create-checkout? | ¿La validación estricta lo rompe? |
|---|---|---|
| Coach elige Básico/Pro × período | Sí | No, si el catálogo es el de `COACH_PLAN_PICKER_DEFS` (100k/160k…), **no** el de `PAYMENT_PLAN_AMOUNT_COP` (129k/199k) |
| Promo % coach | Sí | Sí, si no se revalida el código en server |
| Premium atleta 25k / 250k | Sí | No, si se copian esas constantes |
| Compra marketplace | Sí | No, si se lee `price_cop` de BD (el “arbitrario” ya está en la fila, fijado al publicar) |
| Coach registra Nequi/efectivo en ficha atleta | **No** (`athlete_payments`) | N/A |
| Ajuste manual / “cobrar 80k esta vez” | **No existe** en Wompi | N/A |
| Trial / admin | No pasa por este POST | N/A |
| Precio marketplace 0 o &lt; 5000 | Cliente podría mandarlo; API rechaza &lt; 5000 | Seguir rechazando; no firmar 0 |

No hay “el coach pone un monto libre en Wompi”. El único monto variable honesto es **lista ± promo%** (coach) o **`plan_marketplace.price_cop`** (marketplace).

---

## 7) Riesgos del Paso 2 (para no pisarlos)

1. **Duplicar mal el catálogo** — un `lib/planPrices.js` desfasado de PlanPicker cobra mal a usuarios honestos. Mover/exportar una sola fuente; PlanPicker y AthleteHome importan de ahí.
2. **Clave `monthly` vs `mensual`** — indexar el mapa server como el API (`mensual`) o mapear en un solo sitio.
3. **`PAYMENT_PLAN_AMOUNT_COP` 129k/199k** — no usarlo.
4. **Promo sin `promo_code` en el body** — o se añade y se revalida, o se rompe el descuento.
5. **Redeem en el cliente antes del POST** — si el server re-valida después del redeem, `uses_count` ya subió; un código `max_uses = 1` falla el segundo validate. Mover redeem al server o validar sin exigir “aún queda uso” si *este* user acaba de redimir (frágil). Preferir mover.
6. **Marketplace** — no basta `amount_cop ===` lo que manda el cliente. Lookup `price_cop`. Opcional: `is_approved && is_active`, y que `plan_purchases.id` sea del `userId` y del mismo `plan_id`.
7. **Piso 5000** — Wompi/COP. Tras promo, un 95% sobre 25k atleta no aplica (atleta no tiene promo). Un 96% sobre Básico mensual → 4000 &lt; 5000: hoy el cliente lo mandaría y el API lo rechaza. Seguir rechazando &lt; 5000; no es un flujo de producto documentado.
8. **`createClient(serviceKey)`** — el endpoint sigue con el patrón SDK dual-header (audit v2 N1). No es este fix; no mezclar.

---

## 8) Contrato propuesto para el Paso 2 (no implementado)

```
expected = f(payer_type, plan_key, plan_period, marketplace_plan_id, promo_code?)
amount_cop_firmado = expected
// amount_cop del body: ignorar, o 400 si !== expected (útil en desync de UI)
```

Módulo compartido (sugerido): `src/lib/planPrices.js` (o `lib/planPrices.js`)

- `COACH_LIST_COP[basico|pro][mensual|semestral|anual]`
- `ATHLETE_SOLO_COP[monthly|annual]`
- `applyPromoPercent(listCop, discountPercent)` → mismo `Math.round` que PlanPicker

Marketplace: no va en el módulo; va a SQL.

Tamaño estimado del fix: **S–M (~80–160 líneas)** en el endpoint + extraer constantes (~40) + PlanPicker/AthleteHome importan. Promo-en-server: **+40–80** y un cambio de orden en PlanPicker (dejar de `redeem` en el cliente).

---

## 9) Fuera de alcance

- Cambiar precios de producto.
- Unificar 129k/199k (pagos en ficha) con 100k/160k (Wompi).
- Promo para atleta/marketplace.
- Fix de `createClient` / keys `sb_secret_`.
- Recalcular `subscription_amount` en el webhook.

*Fin del mapeo — sin cambios de runtime en este commit.*
