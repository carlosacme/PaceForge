# Mapeo: extracción del Invite modal (coach → atleta)

Fecha: 2026-08-27  
HEAD de referencia: `20288af` (`docs: restore invite-modal checklist item after dead-modal cleanup`)  
Archivo: `src/App.jsx` (~2103 líneas post–purge payment modal)  
Contexto: `docs/shell-breakdown-map.md` §3 paso **#1** (Invite modal)

**Estado:** solo mapeo. Sin extracción de código. Esperando validación.

---

## 1) Rangos exactos en App.jsx

No hay `function InviteAthleteModal`. Es **JSX inline** + handlers en `App()`.

### Estado (4 `useState`) — L187–190

| Estado | Línea | Rol |
|---|---|---|
| `inviteModalOpen` | 187 | Visibilidad del overlay |
| `inviteEmail` | 188 | Email opcional del atleta |
| `inviteSending` | 189 | Busy en “Enviar” / “Generar link” |
| `lastInviteLink` | 190 | URL tras crear fila; habilita WhatsApp/copiar |

### Helpers de código coach (compartidos conceptualmente, ver §4) — L433–440 (~8 L)

| Símbolo | Líneas | Rol |
|---|---|---|
| `coachCodeFromId` | 433 | Deriva código 8 chars del `user_id` |
| `inviteCoachPublicCode` | 436–440 | `profile.coach_id` (si no es UUID) o derivado de `session.user.id` — se muestra readonly en el modal |

### Handlers del modal — L450–511 (~62 L)

| Símbolo | Líneas | ~L | Qué hace |
|---|---|---|---|
| `createInviteLink` | 450–475 | 26 | `crypto.randomUUID` → insert `invitations` → `setLastInviteLink` → return URL |
| `generateInviteLink` | 477–484 | 8 | Wrapper busy + `createInviteLink` (sin email) |
| `sendAthleteInvitation` | 486–511 | 26 | Valida email → `createInviteLink` → `sendAppEmail({ template: "athlete_invite" })` |

Cerrar (inline en JSX): `setInviteModalOpen(false); setLastInviteLink("")`.  
Abrir (desde App al cablear hijos): `setLastInviteLink(""); setInviteModalOpen(true)`.

### JSX del modal — L1389–1452 (~64 L)

Overlay z-index 500: email, código coach readonly, botones Cerrar / Enviar correo / Generar link; si hay `lastInviteLink` → WhatsApp + copiar.

### Fuera del extract (no mover con el modal)

| Símbolo | Líneas | Motivo |
|---|---|---|
| `resolveCoachIdByCode` | 442–448 | Solo lo consume **AuthLanding** (registro con código manual). El modal **no** lo usa. |
| Staff invite en `CoachSettings` | módulo aparte | Otro producto (`type=staff`); ver §3. |

---

## 2) Supabase / APIs / appShared

| Operación | Dónde | Detalle |
|---|---|---|
| Insert invitación | Lógica propia en App | `supabase.from("invitations").insert({ coach_id, email, code, status: "pending" })` |
| Generar `code` | Lógica propia | `crypto.randomUUID()` (fallback timestamp/random) |
| URL pública | Hardcode | `https://www.runningapexflow.com?invite=${code}` (no usa `window.location.origin`) |
| Email | **appShared** | `sendAppEmail({ template: "athlete_invite", to, vars: { inviteLink, coachCode } })` → `/api/send-email` |
| Lectura / accept invite | **No** en este modal | Eso es AuthLanding + `find_invitation_by_code` / `stashPendingInviteCode` / `acceptPendingInvitationIfAny` |

**No hay** query de “listar invitaciones” ni RPC en el modal emisor. Solo INSERT + email helper.

---

## 3) Emisor vs receptor (AuthLanding) — sin solapamiento de UI

| Lado | Dueño | Rol |
|---|---|---|
| **Emisor (este extract)** | Coach logueado, chrome App | Crea fila `invitations` + link `?invite=` + opcional correo |
| **Receptor** | `AuthLanding` | Lee `?invite=` / `type=staff` / `coach=`, abre registro, RPC `find_invitation_by_code`, accept al confirmar |

Cadena:

```
Coach Invite modal → INSERT invitations + link
        ↓
Atleta abre ?invite=CODE → AuthLanding (registro)
        ↓
accept / stash (appShared) tras signup/login
```

**No duplican JSX ni handlers.** Comparten el **contrato** del query param `invite` y la tabla `invitations`.

**Vecino distinto:** `CoachSettings` invita **staff** (`?invite=…&type=staff&coach=…`, template `staff_invite`). No abre este modal; no mezclar en el extract.

---

## 4) Dependencias App ↔ Invite modal

### Diseño recomendado (prop drilling; ~4–6 props)

**App → InviteAthleteModal:**

| Prop | Origen |
|---|---|
| `open` | `inviteModalOpen` (o estado interno + `open` controlado) |
| `onClose` | cierra + limpia link |
| `coachUserId` | `session.user.id` |
| `coachPublicCode` | `inviteCoachPublicCode` (o calcularlo dentro con `profile`/`session`) |
| `notify` | toast shell |

Si el módulo **posee** los 4 `useState` internos, App solo necesita:

```jsx
<InviteAthleteModal
  open={inviteModalOpen}
  onClose={() => setInviteModalOpen(false)}
  coachUserId={session?.user?.id}
  coachPublicCode={inviteCoachPublicCode}
  notify={notify}
/>
```

Abrir desde App: `setInviteModalOpen(true)` (opcional reset de email/link en el hijo al abrir vía `useEffect`/`key`).

**InviteAthleteModal → App:** **0** (no toca `session`/`athletes`/`view`).

**Context:** no hace falta para este bloque. Prop drilling sigue siendo lo correcto.

### Qué dejar en App tras el extract

- `inviteModalOpen` (o un booleano mínimo) + callbacks a Dashboard/Athletes.
- `inviteCoachPublicCode` / `coachCodeFromId` (si AuthLanding u otros no los necesitan; hoy AuthLanding usa `resolveCoachIdByCode`, no el código público del coach emisor). Se pueden **mover al módulo** si solo el modal los muestra.
- `resolveCoachIdByCode` **permanece** en App → AuthLanding.

---

## 5) Riesgos / puntos de apertura

### ¿Desde dónde se abre?

| Origen | Callback App | ¿Admin / Settings? |
|---|---|---|
| **Dashboard** “＋ Nuevo Atleta” / “Agregar” | `onRequestAddAthlete` → `setLastInviteLink(""); setInviteModalOpen(true)` | No |
| **Athletes** “📧 Invitar Atleta” (lista vacía y con lista) | `onOpenInviteModal` → igual | No |
| Admin pack / CoachSettings | **No** | Staff invite es otro UI |

Solo **2 puntos de entrada** en el chrome coach (Dashboard + Athletes). Eso **no complica** el aislamiento: el extract recibe `open`/`onClose`; los hijos siguen con el mismo callback.

**Nota UX:** Dashboard “Nuevo Atleta” abre el **invite modal**, no el form `showAddAthleteForm` / `saveNewAthlete` (ese form sigue cableado a Dashboard por otras props). No es código muerto; son dos caminos de “alta”. No cambiar comportamiento en el extract.

### Otros riesgos

1. **Copy engañoso:** tras “Generar link” (sin correo), el UI dice *“Invitación enviada por correo…”* (L1432). Deuda UX; no bloquear extract; opcional fix mínimo en Paso 2.
2. **URL hardcodeada** a producción: en local/staging el link apunta a `runningapexflow.com`. Comportamiento actual; no “arreglar” de paso sin decisión.
3. **Doble insert** si el coach pulsa Enviar y Generar: cada acción crea una fila nueva (intencional / aceptable).
4. **Código muerto:** ninguno en este bloque (a diferencia del payment modal ya borrado). `resolveCoachIdByCode` no es muerto: AuthLanding lo usa.
5. **`sendAppEmail`:** ya en appShared; el módulo debe importarlo, no duplicar.

---

## 6) Conteo final a extraer

| Pieza | Líneas (aprox.) |
|---|---|
| 4× `useState` | 4 |
| `coachCodeFromId` + `inviteCoachPublicCode` (si van con el módulo) | 8 |
| `createInviteLink` + `generateInviteLink` + `sendAthleteInvitation` | 62 |
| JSX modal | 64 |
| **Total orientativo** | **~130–145** (≈ **138** con los rangos actuales) |

Shell breakdown decía “~150”; alineado.

**Destino sugerido:** `src/components/InviteAthleteModal.jsx` (junto a otros overlays del chrome).

Wire mínimo en App:

```jsx
{inviteModalOpen ? (
  <InviteAthleteModal
    onClose={() => setInviteModalOpen(false)}
    coachUserId={session?.user?.id}
    coachPublicCode={inviteCoachPublicCode}
    notify={notify}
  />
) : null}
// o controlled open={inviteModalOpen}
```

Dashboard/Athletes: sin cambio de API (`onRequestAddAthlete` / `onOpenInviteModal`).

---

## Checklist Paso 2 (cuando se valide)

- [ ] Extraer JSX + 4 estados + 3 handlers (+ opcional código público)
- [ ] Importar `sendAppEmail` desde appShared; no tocar AuthLanding
- [ ] Dejar `resolveCoachIdByCode` en App
- [ ] Smoke: abrir desde Dashboard y Athletes; generar link; copiar; (staging) enviar correo
- [ ] Build limpio; confirmar que staff invite en CoachSettings sigue intacto
