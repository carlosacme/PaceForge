# Mapeo: extracción del Coach Plan Picker (Wompi / promo)

Fecha: 2026-08-27  
HEAD de referencia: `534708a` (`fix: restore reliable close for InviteModal`)  
Archivo: `src/App.jsx` (~1980 líneas)  
Contexto: `docs/shell-breakdown-map.md` §3 paso **#2** (Plan picker); historial Plans → picker canónico (`setCoachPlanPickerVoluntary`, `/api/wompi-create-checkout`)

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 1) Rangos exactos en App.jsx

No hay `function CoachPlanPicker`. Es **overlay fullscreen inline** + handlers en `App()`.

### Constantes de producto (módulo top-level) — L118–140 (~23 L)

| Símbolo | Líneas | Rol |
|---|---|---|
| `COACH_PLAN_PICKER_DEFS` | 119–134 | Planes `basico` / `pro`: títulos, bullets, precios COP por período |
| `COACH_PLAN_PICKER_PERIODS` | 136–140 | `monthly` / `semestral` / `anual` (+ badges descuento de período) |

Solo las consume el picker (handlers + JSX). En `docs/prelude-styles-map.md` figuraban como “(c) shell”; **para este extract van con el módulo** (no quedan como insumo externo del shell).

### Estado (8 `useState`) — L189–197

| Estado | Línea | Rol |
|---|---|---|
| `coachPlanPickerVoluntary` | 189 | Apertura voluntaria (“Ver planes”) |
| `coachPickerPlan` | 190 | `"basico"` \| `"pro"` \| null |
| `coachPickerPeriod` | 191 | `"monthly"` \| `"semestral"` \| `"anual"` \| null |
| `coachSubscriptionSaving` | 192 | Busy “Pagar ahora” |
| `coachPromoInput` | 194 | Texto del código |
| `coachAppliedPromo` | 195 | `{ code, discount_percent }` o null |
| `coachPromoError` | 196 | Error de validación |
| `coachPromoLoading` | 197 | Busy “Aplicar” |

### Handlers — L307–422 (~116 L)

| Símbolo | Líneas | ~L | Qué hace |
|---|---|---|---|
| `clearCoachPromo` | 307–311 | 5 | Limpia applied / input / error |
| `closeCoachPlanPicker` | 313–316 | 4 | `voluntary=false` + `clearCoachPromo` (solo modo voluntario) |
| `applyCoachPromo` | 318–345 | 28 | RPC `validate_promo_code` → set applied + `notify` |
| `handleCoachPlanPagarAhora` | 347–422 | **76** | Calcula monto → opcional `redeem_promo_code` → `getSession` → **POST `/api/wompi-create-checkout`** → redirect `checkout.wompi.co` |

**No hay** manejo de webhook ni de `redirect-url` de vuelta en App: tras `window.location.href = checkoutUrl` el flujo sale de la SPA. La activación post-pago es **servidor/webhook** (fuera de este bloque).

### Flags derivados (chrome, no estado) — L1278–1290 (~13 L)

| Flag | Depende de | Rol |
|---|---|---|
| `coachPlanBlockedUi` | `profile.plan_status === "blocked"` (+ rol coach, no admin) | Fuerza overlay; **oculta** botón Cerrar |
| `showCoachPlanPickerScreen` | blocked **o** voluntary | Condición del overlay |
| `trialBannerDays` / `showTrialBanner` | trial + `coachTrialDaysRemainingFromStart` | Banner que **abre** el picker (UI fuera del overlay) |

### JSX overlay — L1714–1974 (~261 L)

Fullscreen `zIndex: 4000`: promo, grid planes/períodos, “Pagar ahora”, mensaje si blocked.

### Relacionado pero **fuera** del núcleo a extraer

| Pieza | Líneas | Nota |
|---|---|---|
| Trial banner “Ver planes” | ~1456–1500 | Chrome; solo llama `setCoachPlanPickerVoluntary(true)` |
| `syncCoachPlanIfNeeded` en `loadProfile` | ~717–645 área | Pasa trial→`blocked` en DB; **no** es UI del picker; queda en bootstrap |
| Wompi en AthleteHome / MarketplaceHub | otros módulos | Otros `payer_type`; **no** compartir extract |

---

## 2) Supabase / APIs / appShared

| Operación | Dónde | Detalle |
|---|---|---|
| `validate_promo_code` | App local | `supabase.rpc("validate_promo_code", { code_input })` en `applyCoachPromo` |
| `redeem_promo_code` | App local | Antes del checkout si hay promo aplicada; si falla, **no** abre Wompi |
| `supabase.auth.getSession()` | App local | Bearer para el API |
| `POST /api/wompi-create-checkout` | App local | Body: `payer_type: "coach_subscription"`, `plan_key`, `plan_period` (`monthly`→`"mensual"`), `amount_cop` (ya con descuento) |
| Redirect Wompi | App local | Arma query `public-key`, `amount-in-cents`, `reference`, `signature:integrity`, `redirect-url`, email |
| Webhook / confirmación pago | **No en App** | Fuera de este bloque |

**appShared ya usados (no duplicar):**

| Helper | Uso |
|---|---|
| `formatCopInt` | Precios en el JSX |
| `coachTrialDaysRemainingFromStart` / `COACH_PROFILE_TRIAL_DAYS` | Banner trial (chrome), no el overlay |

No hay helper `createCoachWompiCheckout` en appShared hoy: la lógica de checkout del **coach** está **entera en App**. (AthleteHome/Marketplace tienen fetches similares con otros `payer_type` — no unificar en este extract salvo decisión explícita.)

---

## 3) Todos los puntos que abren el picker

| # | Origen | Mecanismo |
|---|---|---|
| 1 | **Trial banner** (App chrome) | `setCoachPlanPickerVoluntary(true)` |
| 2 | **Dashboard** aviso límite plan (“Ver Planes”) | `onGoToPlans` → `setCoachPlanPickerVoluntary(true)` |
| 3 | **Plan2Weeks** CTA upgrade | `onGoToPlans` → igual |
| 4 | **Builder** CTA upgrade | `onGoToPlans` → igual |
| 5 | **Cuenta blocked** | `showCoachPlanPickerScreen` por `coachPlanBlockedUi` **sin** voluntary; no se puede cerrar con “Cerrar” |

**No hay más** en el repo: GpxRacePlan, Library, Settings, Athletes, Admin **no** llaman `setCoachPlanPickerVoluntary` / `onGoToPlans`.

Cerrar voluntario: `closeCoachPlanPicker` (solo si `!coachPlanBlockedUi`).

---

## 4) Relación con `COACH_PLAN_PICKER_*`

Son **parte del bloque del picker**, no config genérica del shell:

- Definidas en el prelude de App.jsx (L118–140).
- Leídas en `handleCoachPlanPagarAhora` (montos / `plan_key`) y en el JSX (cards).
- **Único consumidor** en el codebase (grep).

**Paso 2:** mover `DEFS` + `PERIODS` al módulo del picker (o `planPickerConstants.js` junto al componente). El shell deja de importarlas.

`prelude-styles-map` las marcó “(c) shell” cuando aún no había extract; este mapa **actualiza** ese veredicto: van con el picker.

---

## 5) Dependencias App ↔ Plan picker

### Diseño recomendado (~6–8 props)

**App → CoachPlanPicker (o similar):**

| Prop | Origen |
|---|---|
| `open` | `showCoachPlanPickerScreen` (o `voluntary \|\| blocked`) |
| `forced` / `blocked` | `coachPlanBlockedUi` (oculta Cerrar) |
| `onClose` | `closeCoachPlanPicker` / `setVoluntary(false)` |
| `notify` | toast shell |
| (opcional) nada de `session`: el módulo puede `getSession` internamente | — |

Si el módulo **posee** los 8 `useState` + consts + handlers:

```jsx
<CoachPlanPicker
  open={showCoachPlanPickerScreen}
  locked={coachPlanBlockedUi}
  onClose={() => setCoachPlanPickerVoluntary(false)}
  notify={notify}
/>
```

App conserva solo:

- `coachPlanPickerVoluntary` (boolean de apertura voluntaria), **o** un setter expuesto a hijos vía `onGoToPlans={() => set…(true)}`.
- Cálculo de `coachPlanBlockedUi` / `showCoachPlanPickerScreen` (necesita `profile`).
- Trial banner + cableado `onGoToPlans` a Dashboard/Builder/Plan2Weeks.

**Picker → App:** **0** de sesión/perfil. Tras pago, redirect full-page; al volver, bootstrap/`loadProfile` refresca `plan_status`.

**Context:** no necesario. Prop drilling de `onGoToPlans` ya existe.

---

## 6) Riesgos (flujo de cobro canónico)

| Pieza | Delicadeza | Por qué |
|---|---|---|
| `handleCoachPlanPagarAhora` (monto + redeem + checkout body) | **Crítica** | Monto mal calculado = cobro incorrecto; redeem antes del redirect evita códigos infinitos pero si se reordena mal se puede cobrar sin canjear o canjear sin pagar |
| Mapping `monthly` → `"mensual"` en `plan_period` | **Alta** | Contrato con `/api/wompi-create-checkout`; romperlo falla el pago o registra mal el período |
| `payer_type: "coach_subscription"` | **Alta** | No confundir con checkouts de atleta/marketplace |
| `amount_cop` ya descontado | **Alta** | Debe coincidir con lo mostrado en UI; no re-descontar en API si la API espera monto final (comportamiento actual: App envía final) |
| `validate_promo` vs `redeem_promo` | **Alta** | Validar ≠ canjear; canje solo al pagar; mensajes de error actuales |
| Redirect a `checkout.wompi.co` con signature | **Alta** | No inventar campos; copiar íntegro el armado de `URLSearchParams` |
| Modo `blocked` sin Cerrar | **Media** | Producto: coach bloqueado debe pagar; no “arreglar” ocultando el lock |
| Trial banner / `onGoToPlans` | **Baja** | Solo abren; no tocan dinero |
| Precios en `COACH_PLAN_PICKER_DEFS` | **Alta (producto)** | Fuente de verdad de list price; mover sin cambiar números |

**Regla Paso 2:** mover el handler de pago **byte-a-byte** (salvo imports); no “limpiar” montos, order de redeem, ni shape del POST. Smoke obligatorio: plan+período sin promo → URL Wompi; con promo → monto UI = `amount_cop`; blocked no cierra.

**No** hay webhook en este archivo: no inventar listeners al extraer.

---

## 7) Conteo final a extraer

| Pieza | ~Líneas |
|---|---|
| `COACH_PLAN_PICKER_DEFS` + `PERIODS` | 23 |
| 8× `useState` | 9 |
| Handlers clear/close/apply/pagar | 116 |
| JSX overlay | 261 |
| **Total núcleo** | **~409** |
| (+ flags derivados si se documentan en el módulo) | +~13 opcionales |
| Trial banner | **no** contar en el extract (queda chrome) |

Alineado con shell-breakdown (~400 JSX+lógica). Destino sugerido: `src/components/CoachPlanPicker.jsx` (o `PlanPicker/`).

Wire mínimo:

```jsx
{showCoachPlanPickerScreen && (
  <CoachPlanPicker
    locked={coachPlanBlockedUi}
    onClose={() => setCoachPlanPickerVoluntary(false)}
    notify={notify}
  />
)}
// open implícito por montaje, o open={true}
```

Hijos Dashboard/Builder/Plan2Weeks: **sin cambio de API** (`onGoToPlans`).

---

## Checklist Paso 2 (cuando se valide)

- [ ] Mover consts + 8 estados + 4 handlers + JSX overlay
- [ ] Preservar redeem → checkout → redirect sin reordenar
- [ ] App: `voluntary` + `blocked` + `onGoToPlans` + trial banner
- [ ] Smoke: abrir desde 4 CTAs + forced blocked; promo apply/quitar; pagar (staging Wompi)
- [ ] Build limpio; no tocar AthleteHome/Marketplace Wompi
