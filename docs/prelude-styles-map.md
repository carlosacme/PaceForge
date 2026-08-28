# Mapeo: prelude/helpers y `styles` locales en App.jsx

Fecha: 2026-08-27  
HEAD de referencia: `338daea` (`refactor: extract Dashboard and consolidate athlete list from shell`)  
Archivo: `src/App.jsx` (~3468 líneas / ~3281 no vacías)  
Contexto: `docs/app-extract-map-v2.md` §3 orden **#5** (limpieza prelude / unificar styles)

**Estado:** **HECHO** (commits FIT → styles → dead code). Ver historial `fix: define FIT helpers…` / `refactor: use appShared.styles…` / limpieza prelude.

Tras Athletes, accordion, Admin, eliminación de Plans y extracción de Dashboard, el “prelude” ya no son ~426 líneas densas: quedan **~288 líneas hasta `export default function App`** (mucho es blanco + comentarios huérfanos) y **`styles` ~82 líneas** al final.

---

## 1) PRELUDE / HELPERS (L1–288)

### 1.1 Imports y lazy (L1–60) — no son “helpers”, se quedan en el shell

| Símbolo | Líneas | Rol |
|---|---|---|
| Imports React / supabase / hooks / módulos | 1–51 | Shell |
| Lazy: CoachSettings, WorkoutLibrary, MarketplaceHub, ChallengesHub, AthleteHome, Plan2Weeks, Builder, EvaluationView, GpxRacePlan | 52–60 | Shell |

*(Fuera de alcance de listas a/b/c de helpers; no candidatos a appShared.)*

### 1.2 Inventario símbolo a símbolo

Leyenda de columnas:
- **Shell:** ¿lo usa el cuerpo de `App()` / módulo top-level de App.jsx?
- **Extraídos:** ¿Athletes / Dashboard / Admin / accordion / otros módulos lo importan *desde App*? (casi nunca: ya no exporta helpers)
- **appShared:** ¿existe equivalente (o el mismo nombre)?

| Símbolo | Líneas | ~L | Shell | Extraídos | En appShared | Veredicto |
|---|---|---|---|---|---|---|
| `RAF_SELECTED_ATHLETE_STORAGE_KEY` | 66 | 1 | **Sí** | No | No | **(c) shell** |
| `RAF_PASSWORD_RECOVERY_KEY` | 69 | 1 | **Sí** | No | No | **(c) shell** |
| `CONFIRM_EMAIL_ROUTE` | 72 | 1 | **Sí** | No | vía `isConfirmEmailRoute` | **(c) shell** |
| `detectPasswordRecoveryFromUrl` | 85–97 | 13 | **Sí** (módulo) | No | No | **(c) shell** |
| `PASSWORD_RECOVERY_IN_URL` | 99–108 | ~10 | **Sí** | No | No | **(c) shell** |
| Comentarios huérfanos (JSDoc sin cuerpo) | 111–159, 171–173 | ~50 | No | No | — | **(a) eliminar** (ruido) |
| `DAYS` | 123 | 1 | **No** (solo def.) | Athletes tiene **copia local** con acentos; Plan2Weeks / AthleteHome usan **appShared** | **Sí** — sin acentos (`Mie`/`Sab`) | **(a) eliminar** de App; unificar acentos en Paso 2 aparte |
| `PLAN_12_LEVELS` | 162–166 | 5 | **No** | Plan2Weeks → appShared | **Sí** (idéntico) | **(a) eliminar** |
| `fitTitleKeywords` | 177–180 | 4 | **No** (solo FIT internos) | No | **No** (pero `parseFitFileToLibraryDraft` **llama** a helpers FIT) | **(b) mover a appShared** con el par FIT |
| `getFitAvgSpeedChanges` | 182–196 | 15 | **No** | No | **No definido**; sí **referenciado** en `parseFitFileToLibraryDraft` | **(b) mover a appShared** (hoy App tiene la única def.; appShared la necesita) |
| `mapFitWorkoutType` | 198–214 | 17 | **No** | No | Igual: referenciado, no definido en appShared | **(b) mover a appShared** |
| `ADMIN_WHATSAPP_E164` | 222 | 1 | **No** | No | No | **(a) eliminar** (mismo valor que `COACH_SUBSCRIPTION_WA_E164`) |
| `resolveCoachUserIdFromPublicCode` | 224–237 | 14 | **No** | AthleteHome → **appShared** | **Sí**, pero **lógica distinta** (ver §4) | **(a) eliminar** copia de App |
| `coachDirectorySpecialtyLabel` | 239–247 | 9 | **No** | No | No | **(a) eliminar** |
| `COACH_NAV_BASE_ITEMS` | 249–255 | 7 | **Sí** | No | No | **(c) shell** |
| `COACH_SUBSCRIPTION_NEQUI` | 257 | 1 | **Sí** (UI picker) | No | No | **(c) shell** |
| `COACH_SUBSCRIPTION_WA_E164` | 258 | 1 | **Sí** | No | No | **(c) shell** |
| `TAB_KEY_ATHLETES` | 259 | 1 | **Sí** | No | No | **(c) shell** |
| `TAB_KEY_TRAINING` | 260 | 1 | **Sí** | No | No | **(c) shell** |
| `TAB_KEY_CREATE_WORKOUT` | 262 | 1 | **No** | Builder → **appShared** | **Sí** (mismo string) | **(a) eliminar** |
| `COACH_PLAN_PICKER_DEFS` | 266–281 | 16 | **Sí** | No | No | **(c) shell** |
| `COACH_PLAN_PICKER_PERIODS` | 283–287 | 5 | **Sí** | No | No | **(c) shell** |

### 1.3 Imports desde appShared que App ya no usa (ruido del shell)

No son prelude locals, pero conviene listarlos para Paso 2:

| Import | ¿Usado en App.jsx? |
|---|---|
| `EVAL_DISTANCES` | **No** |
| `PLAN_PREVIEW_FULL_DAYS` | **No** |
| `PLAN_SESSION_TYPE_OPTIONS` | **No** |
| `COACH_PROFILE_TRIAL_DAYS` | **Sí** |
| Resto del import block | Sí / según símbolo |

---

## 2) STYLES LOCAL (L3387–3466, ~80 útiles / ~82 con cierre)

### 2.1 Claves del objeto

Mismas **13 claves** que `appShared.styles` (comparación estructural: **idénticas**):

`root`, `sidebar`, `logo`, `logoTitle`, `logoSub`, `navBtn`, `navBtnActive`, `sidebarFooter`, `page`, `pageTitle`, `card`, `avatar`, `notification`

### 2.2 Quién usa qué

| Clave | Shell App (`S.*`) | Pasado como `styles={styles}` a hijos | En `appShared.styles` | Notas |
|---|---|---|---|---|
| `root` | **Sí** | — | Sí | Auth / chrome |
| `sidebar` / `logo*` / `navBtn*` / `sidebarFooter` | **Sí** | — | Sí | Nav desktop |
| `page` / `pageTitle` / `card` | **Sí** | Hijos vía prop | Sí | |
| `notification` | **Sí** (toast) | — | Sí | |
| `avatar` | **No** en JSX de App | Athletes usa **appShared** `S.avatar`, no el de App | Sí | Clave “viva” en appShared; en App es **copia ociosa** si se deja el objeto completo |

**Consumidores del objeto local de App** (prop drilling):

| Destino | Prop |
|---|---|
| `ChallengesHub` | `styles={styles}` |
| `CoachSettings` | `styles={styles}` |
| `AdminMarketplacePanel` (vía Gpx / admin draft path) | `styles={styles}` |
| `MarketplaceHub` | `styles={styles}` |

**Ya migrados a `appShared.styles`:** Dashboard, Admin `Panel`/`Promo`, Athletes (import propio), AthleteHome (import propio).

### 2.3 Veredicto styles

| Acción | Detalle |
|---|---|
| **(a) eliminar objeto local** | Tras hacer que App importe `styles` desde appShared y deje de definir el duplicado |
| **(b) —** | No hace falta “mover” claves: ya existen en appShared |
| **(c) uso exclusivo shell** | El *uso* de chrome (`root`/`sidebar`/…) es del shell, pero la *definición* no debe vivir duplicada |

---

## 3) Tres listas claras

### (a) Eliminar por no tener uso (en App) / ruido

1. Bloques de comentarios JSDoc sin función (L111–159, 171–173).
2. `DAYS` (local App).
3. `PLAN_12_LEVELS` (local App).
4. `ADMIN_WHATSAPP_E164`.
5. `resolveCoachUserIdFromPublicCode` (copia App).
6. `coachDirectorySpecialtyLabel`.
7. `TAB_KEY_CREATE_WORKOUT` (local App).
8. Objeto `const styles = {…}` local — **después** de importar `styles` desde appShared.
9. (Bonus shell) imports muertos: `EVAL_DISTANCES`, `PLAN_PREVIEW_FULL_DAYS`, `PLAN_SESSION_TYPE_OPTIONS`.

### (b) Mover a appShared (uso compartido / dependencia rota)

1. **`fitTitleKeywords` + `getFitAvgSpeedChanges` + `mapFitWorkoutType`**  
   - Única definición viva está en App y **nadie la llama desde App**.  
   - `appShared.parseFitFileToLibraryDraft` **sí** llama `getFitAvgSpeedChanges` / `mapFitWorkoutType` pero **no las define** → riesgo de `ReferenceError` al importar FIT.  
   - Paso 2: **mover** (no solo borrar) esas tres piezas a appShared junto a `parseFitFileToLibraryDraft`.

*No* meter en (b) cosas ya solo-shell (picker Nequi/WA, nav, tabs athletes/training).

### (c) Dejar en App.jsx (exclusivo del shell)

1. Claves de storage / recovery / confirm-email + `detectPasswordRecoveryFromUrl`.
2. `COACH_NAV_BASE_ITEMS`.
3. `COACH_SUBSCRIPTION_NEQUI` / `COACH_SUBSCRIPTION_WA_E164`.
4. `TAB_KEY_ATHLETES` / `TAB_KEY_TRAINING`.
5. `COACH_PLAN_PICKER_DEFS` / `COACH_PLAN_PICKER_PERIODS`.
6. Lazy imports + wiring de vistas (fuera del “helper bag”).

*(Opcional futuro: precios del picker → appShared si se reutilizan fuera del overlay; hoy no.)*

---

## 4) Riesgos

1. **`resolveCoachUserIdFromPublicCode` — shadowing con lógica distinta**  
   - **App (muerto):** `profiles.select…eq("coach_id", code)`.  
   - **appShared (vivo, AthleteHome):** RPC `find_coach_by_code`.  
   - Borrar la de App es seguro; **no** “unificar” hacia la query de profiles sin revisar.

2. **`DAYS` — tres variantes**  
   - App (muerto, con acentos).  
   - Athletes: copia local con acentos.  
   - appShared: sin acentos (`Mie`/`Sab`) — usada por Plan2Weeks / AthleteHome.  
   - Riesgo UX de etiquetas distintas; Paso 2 de prelude puede solo borrar App; unificar Athletes→appShared es follow-up.

3. **FIT helpers — dependencia colgante en appShared**  
   - No es “referencia colgante desde un extract”; es código compartido que **asume** helpers que hoy solo existen (muertos) en App.  
   - **No eliminar de App sin moverlos a appShared primero.**

4. **`styles` dual**  
   - Claves idénticas hoy → consolidar es bajo riesgo.  
   - Si en el futuro alguien edita solo App.local, hijos que reciben `styles={styles}` divergen de Dashboard/Admin (ya en appShared).

5. **Sin closures colgantes** de módulos extraídos hacia helpers del prelude: Dashboard/Admin importan appShared; no capturan `styles`/`DAYS` del scope de App.

6. **`avatar` en styles de App:** no referenciado en el shell; se conserva solo mientras el objeto completo se pasa a hijos (o se elimina el duplicado entero).

---

## 5) Conteo aproximado a tocar en Paso 2

| Acción | ~Líneas netas |
|---|---|
| Eliminar muertos + comentarios huérfanos | ~100–140 (mucho whitespace) |
| Mover FIT trio → appShared | ~36 útiles |
| Sustituir `styles` local por import appShared | −82 en App, 0 netas de producto |
| Dejar shell-only | ~40–50 útiles de constantes |

**No hay un “bloque de 426 líneas” coherente que extraer como módulo:** la mayoría es basura post-extracción + constantes de chrome. El Paso 2 es **limpieza + mover FIT + unificar styles**, no un feature extract.

---

## Checklist propuesto Paso 2 (cuando se valide)

- [ ] Mover `fitTitleKeywords` / `getFitAvgSpeedChanges` / `mapFitWorkoutType` a appShared (antes de borrar App)
- [ ] Smoke: import FIT en Biblioteca (`parseFitFileToLibraryDraft`)
- [ ] Borrar símbolos (a) + comentarios huérfanos + imports muertos
- [ ] `import { styles } from "./components/shared/appShared"` en App; borrar `const styles`
- [ ] Build limpio; smoke auth landing + nav + toast + picker
