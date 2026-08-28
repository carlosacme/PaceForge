# Mapeo: extracción de Plans desde App.jsx

Fecha: 2026-08-27  
HEAD de referencia: `1f88977` (`refactor: extract Admin pack (Panel, Promo, Coaches) from App.jsx`)  
Archivo origen: `src/App.jsx` (~4123 líneas)  
Contexto: `docs/app-extract-map-v2.md` §3 orden #3  

**Estado:** **SUPERSEDIDO (2026-08-27).** No se extrajo el componente. Se eliminó el checkout legacy de Plans y se redirigió Dashboard / Builder / Plan2Weeks al picker canónico del shell (`setCoachPlanPickerVoluntary(true)`). Los códigos promo (`validate_promo_code` / `redeem_promo_code`) se migraron al picker. La vista `view === "plans"` y el componente `Plans` se eliminaron de `App.jsx`.

---

## 1) Estructura histórica: un solo componente

**Un único** `function Plans({ athletes, notify })` — no había sub-bloques top-level hermanos (a diferencia del pack Admin).

| Símbolo | Líneas (1-based inclusivas, pre-fix) | ~Líneas |
|---|---|---|
| `function Plans(...)` | **3760–4039** | **280** |

Helpers internos (ya eliminados con el componente):
- `PLAN_CATALOG`, `amountInCentsByPlan`, `applyPromo` / `clearPromo`, `openDirectWompiCheckout`
- Clave embebida `pub_test_…` + `window.open` sin firma / sin `subscription_payments`

---

## 2) Qué pasó con cada pieza

| Pieza | Destino |
|---|---|
| Entry points `onGoToPlans` (Dashboard, Builder, Plan2Weeks) | `setCoachPlanPickerVoluntary(true)` |
| Checkout `window.open` + clave test | **Eliminado** |
| Promo `validate_promo_code` / `redeem_promo_code` | Migrado al overlay del picker canónico |
| `coachPlan = athletes?.[0]?.plan` | Corregido a `profile.subscription_plan` en límites / Builder / Plan2Weeks |
| Vista `plans` + `hiddenViews` entry | **Eliminadas** (sin usuarios reales tras redirigir) |

---

## 3) Auditoría Wompi (contexto del fix)

- Mensual coach Básico/Pro: mismos montos en Plans legacy y `COACH_PLAN_PICKER_DEFS` (100 000 / 160 000).
- Riesgo real del legacy: pago sin PENDING + sin firma + sin activación por webhook.
- Flujo canónico: `/api/wompi-create-checkout` + `WOMPI_PUBLIC_KEY` / `WOMPI_INTEGRITY_SECRET` en env.

El resto del mapeo original (props, acoplamiento bajo, ~280 líneas) queda obsoleto como guía de extracción; este archivo sirve de auditoría del cambio de producto.
