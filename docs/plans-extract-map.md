# Mapeo: extracción de Plans desde App.jsx

Fecha: 2026-08-27  
HEAD de referencia: `1f88977` (`refactor: extract Admin pack (Panel, Promo, Coaches) from App.jsx`)  
Archivo origen: `src/App.jsx` (~4123 líneas)  
Contexto: `docs/app-extract-map-v2.md` §3 orden #3  

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 1) Estructura: un solo componente

**Un único** `function Plans({ athletes, notify })` — no hay sub-bloques top-level hermanos (a diferencia del pack Admin).

| Símbolo | Líneas (1-based inclusivas) | ~Líneas |
|---|---|---|
| `function Plans(...)` | **3760–4039** | **280** |

Inmediatamente después: `const styles = { … }` (fin de App) — **no** forma parte de Plans; el shell/Dashboard siguen usándolo.

Helpers **internos** (closures dentro de `Plans`, se mueven con el archivo):
- `PLAN_CATALOG` (`useMemo`)
- `amountInCentsByPlan`
- `applyPromo` / `clearPromo`
- `openDirectWompiCheckout`

Constantes locales (Wompi): `WOMPI_PUBLIC_KEY`, `WompiCheckoutBase`, `redirectUrl`.

---

## 2) Estado, datos y I/O

### Hooks
| Hook | Cantidad | Detalle |
|---|---|---|
| `useState` | **4** | `promoInput`, `appliedPromo`, `promoError`, `promoLoading` |
| `useMemo` | **1** | `PLAN_CATALOG` (Básico / Pro, precios y benefits) |
| `useEffect` / `useCallback` / `useRef` | **0** | — |

### Supabase / red
| Llamada | Tipo | Uso |
|---|---|---|
| `supabase.rpc("validate_promo_code", { code_input })` | RPC | Aplicar código en UI |
| `supabase.rpc("redeem_promo_code", { code_input })` | RPC | Consumir uso **antes** de abrir Wompi |
| Checkout Wompi | `window.open` URL | No pasa por API propia; query params a `checkout.wompi.co` |

Sin `.from(...)` de tablas. Sin `fetch` a `/api/*` en este bloque.

### Props desde App
| Prop | Uso en Plans |
|---|---|
| `athletes` | Solo `athletes?.[0]?.plan` → resaltar plan “actual” (`coachPlan`) |
| `notify` | Toast éxito/error promo y redeem |

Mount en App (~2915):

```jsx
{view === "plans" && <Plans athletes={athletes} notify={notify} />}
```

---

## 3) Compartido con módulos ya extraídos / appShared

| Dependencia | ¿Plans la usa? | Notas |
|---|---|---|
| `Athletes.jsx` | **No** | — |
| `WorkoutStructureTable` | **No** | — |
| `MarketplacePlanWorkoutsAccordion` | **No** | — |
| Admin pack (`Admin/Promo`) | **Indirecto** | Admin **crea** filas `promo_codes`; Plans **valida/redime** vía RPC. Sin import cruzado de código |
| `appShared.styles` | Hoy **no** (cierra sobre `styles` local de App) | En extracción: importar `styles` de `appShared` |
| `PAYMENT_PLAN_OPTIONS` / `PAYMENT_PLAN_AMOUNT_COP` / `ATHLETE_SUBSCRIPTION_PLAN_CATALOG` | **No importados** | Catálogos **distintos** (ver riesgos) |
| `coachTrialDaysRemainingFromStart` | **No** | — |
| `formatCopInt` | **No** | Formatea con `toLocaleString("es-CO")` inline |

**No hay helper de Plans reutilizado por el shell** (nada equivalente al trial helper del Admin). Extracción no obliga a mover funciones usadas también fuera de Plans.

**Otro Wompi en App (no es Plans):** el plan-picker / suscripción del shell (~618) usa `fetch("/api/wompi-create-checkout", …)`. Flujo distinto; **no** mover con Plans.

---

## 4) App ↔ Plans: props y estrategia

| Dirección | Qué cruza | Tras extracción |
|---|---|---|
| App → Plans | `athletes`, `notify` | **2 props** (igual) |
| Plans → App | nada | 0 |

**Prop drilling** sigue siendo adecuado. No hace falta Context: no hay estado compartido con Admin/Athletes más allá de la lista `athletes` del shell (y el uso es superficial).

Opcional (no bloqueante del Paso 2): pasar `coachPlan` explícito desde `profile.subscription_plan` (como ya hacen Builder/Plan2Weeks en App) en lugar de `athletes[0].plan` — mejora semántica, pero puede cambiar el badge “plan actual”; dejar como follow-up.

---

## 5) Riesgos y casos raros

1. **Precios divergentes (preexistente)**  
   - Plans `PLAN_CATALOG`: Basico **100 000** / Pro **160 000** COP (y `amountInCents` ×100).  
   - Shell `COACH_PLAN_PICKER` mensual: mismos 100 000 / 160 000.  
   - `appShared` `PAYMENT_PLAN_AMOUNT_COP`: Basico **129 000** / Pro **199 000** (pagos **atleta**).  
   No unificar en el extract sin decisión de producto; mover el catálogo de Plans **tal cual**.

2. **`coachPlan = athletes?.[0]?.plan`** — heurística frágil; el resto del shell usa `profile?.subscription_plan`. Olor, no código muerto. Extraer sin cambiar salvo que se pida.

3. **Wompi `pub_test_…`** hardcodeado — entorno test. Mover con el módulo; no rotar claves en este PR.

4. **`redeem_promo_code` al abrir checkout** — consume uso aunque el pago Wompi no se complete. Comportamiento actual a preservar; smoke en staging sin asumir que es “bug nuevo”.

5. **`styles` local App** — tras mover Plans, importar `appShared.styles` (mismo patrón Admin). El objeto `styles` al final de App **se queda** para el shell.

6. **Sin duplicado de `function Plans`** en el repo (solo App).

7. **Admin Promo ↔ Plans** — misma familia de promos; smoke: crear código en Admin → aplicar en Plans → abrir Wompi (staging).

8. **No confundir** con `coachPlanPicker` / checkout vía `/api/wompi-create-checkout` del shell (periodos semestral/anual).

---

## 6) Conteo final a extraer

| Concepto | ~Líneas |
|---|---|
| `function Plans` completa | **280** (3760–4039) |
| Auxiliares top-level exclusivos | **0** |
| **Total move** | **~280** |

Destino propuesto: `src/components/Plans.jsx` (archivo único; carpeta opcional si se prefiere el patrón `Athletes/` / `Admin/`).

App tras move: ~4123 − 280 ≈ **~3843**, más  
`import Plans from "./components/Plans"` y el JSX de `view === "plans"` sin cambios de props.

---

## 7) Plan de commits (acordado)

1. **Este documento** — commit + push ahora, sin runtime.  
2. **Paso 2** — tras OK: mover `Plans` a módulo, `styles`/`supabase` por imports, App solo wiring.  
3. Build + smoke: catálogo, aplicar/quitar promo, CTA Suscribirse (staging, no cobro prod).

---

## Checklist post-extracción (Paso 2, no ahora)

- [ ] `npm run build` OK  
- [ ] App sin `function Plans`  
- [ ] Vista Planes: dos cards, precios, benefits  
- [ ] Código promo: válido / inválido / quitar  
- [ ] Suscribirse abre checkout Wompi (staging)  
- [ ] Sin ciclos App ↔ Plans  
- [ ] Admin → Promo sigue independiente  
- [ ] Plan-picker del shell (`/api/wompi-create-checkout`) intacto  
