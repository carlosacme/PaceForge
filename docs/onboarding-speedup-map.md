# Mapeo — Acelerar el vínculo coach–atleta

Paso 2 (solo lectura). Sin código de implementación hasta que esto se valide.

Parte de [onboarding-map.md](./onboarding-map.md): el dolor no es un plan de
muestra genérico, sino el tiempo entre “me registré” y “estoy vinculado a un
coach real” (el calendario vacío es el síntoma).

---

## 1) Flujo actual: atleta sin código de coach

Registro (`AuthLanding.jsx`): nombre, rol, correo, contraseña. Código de coach
**opcional**. `create-profile` deja `athletes.coach_id` y `profiles.coach_id`
en `null`. Tras confirmar correo, `App.jsx` monta `AthleteHome`.

En el home, si no hay coach (`athleteNeedsCoachLink`):

- Banner **“Aún no tienes entrenador”** + “Conéctate con tu coach para recibir
  tus entrenamientos personalizados.”
- `CoachLinkActions` (extraído): campo de código + **“Solicitar entrenador”**.
  Copy auxiliar: “¿No tienes código? Pide que te asignen un entrenador y él te
  contactará.”

Al pulsar **Solicitar entrenador** (`AthleteHome.requestCoach`):

1. Si ya hay una fila `pending` en `coach_requests` para ese `athlete_user_id`,
   no duplica: “Ya tienes una solicitud pendiente.”
2. Destinatario: `resolveDefaultCoachUserId()` — el único `coach_public`
   (`is_public`), o el admin de plataforma (`PLATFORM_ADMIN_USER_ID`) si hay
   varios o ninguno. **Hoy no elige coach**; va al público / admin.
3. Inserta `coach_requests` (`status: pending`).
4. Ya dispara push: `sendChatPushNotification` → `/api/send-push`, título
   “Nueva solicitud de atleta”, body “{nombre} quiere entrenar contigo”,
   `data.type: coach_request`.
5. UI del atleta: botón “Solicitud enviada” + “Solicitud enviada. Tu
   entrenador la revisará pronto.” El título del banner **sigue** siendo
   “Aún no tienes entrenador”. Debajo, el calendario (`AthleteOwnCalendar`)
   se pinta igual: vacío, sin copy de espera.

Quién ve la solicitud:

- Solo el coach destinatario, y **solo en Configuración**
  (`CoachSettings` → “SOLICITUDES DE ATLETAS”). Aceptar/rechazar vive ahí.
- `Dashboard` **no** lista solicitudes. No hay badge en el menú.
- El tap del push **no** abre Configuración: no hay handler de
  `data.type === "coach_request"` (el type se manda, nadie lo rutea).

Tiempo típico hasta que responde:

- No hay SLA en código ni email de fallback.
- El push llega **si** el coach tiene token FCM vigente y la app/OS no lo
  silenció. Si no, la solicitud espera a que entre a **Configuración** (no al
  home). En la práctica eso es horas o días, no minutos: el cuello no es el
  insert, es **descubrir** la fila.

Tras aceptar: `athletes.coach_id` + `profiles.coach_id` = el coach. El
calendario sigue vacío hasta que el coach asigne (fuera de este mapa).

---

## 2) Camino con código / invite: ya es instantáneo

Si el atleta registra con:

- `?invite=CODE` → `find_invitation_by_code` → `coach_id` en metadata, o
- código manual → `resolveCoachIdByCode`,

entonces `ensureOwnProfile` / `POST /api/create-profile` escribe
`profiles.coach_id` y `athletes.coach_id` en el mismo upsert. Al entrar, **no**
sale el banner de “sin entrenador”. No hay `coach_requests`. No hay espera
de aceptación.

No hay nada que mejorar en ese vínculo: ya es inmediato. El vacío de
calendario después (coach aún no asignó) es otro problema
(onboarding-map, fila 1: avisar al coach al confirmar + CTA “asignar esta
semana”).

---

## 3) Mejoras concretas (sin implementar)

| # | Idea | Qué existe hoy | Esfuerzo | Impacto |
|---|---|---|---|---|
| A | Push inmediato al coach | **Ya existe** en `requestCoach`. Hueco: sin deep-link a Config / inbox | Bajo (rutear `coach_request` → `view=settings`) | Medio: solo ayuda si el coach ya tiene push |
| B | Email al coach (o admin) | Toggles de email en Config son de **entrenos/recordatorios**, no de solicitudes | Medio: plantilla + API de mail | Medio-alto si el coach no abre la app |
| C | Copy de espera en el home del atleta | Banner y calendario no cambian tras enviar | **Muy bajo**: si `requestPending`, título/cuerpo distintos; no tocar el grid | Alto percibido: deja de parecer “app rota” |
| D | Inbox de solicitudes en el home del coach | Solo Config, sin badge | Bajo: query `pending` ya hecha en Settings; card + Aceptar en Dashboard | **Alto**: corta el “no me enteré” aunque ignore el push |
| E | Elegir coach (varios públicos) | `resolveDefaultCoachUserId` manda todo a uno | Medio | Bajo hoy (un público) |

---

## 4) Recomendación: más impacto / menos esfuerzo

**Hacer primero C + D.** Reutilizar el push que ya está (A como extra de
una tarde). No priorizar email (B) ni selector de coach (E) ahora.

Por qué:

1. **C** es copy. El atleta ya ve “Solicitud enviada…” debajo del botón, pero
   el home grita “Aún no tienes entrenador” + calendario mudo. Cambiar el
   banner a “Tu solicitud fue enviada; un coach te contactará pronto” (y
   dejar el código por si llega el invite) alinea expectativa con el estado
   real. Cero backend.
2. **D** ataca el tiempo real. El push ya sale; el inbox está escondido. Una
   card en el Dashboard del destinatario (las mismas filas `pending` +
   Aceptar/Rechazar de Settings) hace que el coach actúe al entrar a la app,
   que es lo que hace todos los días. Reusa `loadCoachRequests` /
   `updateCoachRequestStatus`.
3. **A** (deep-link del push) complementa D: si el coach toca la
   notificación, aterriza en el inbox. El envío FCM no se reescribe.
4. **B** (email) tiene sentido si D+A no bajan la espera (coach que no abre
   la app). Hoy no hay mail de `coach_request`; sería un segundo canal, no
   el primer parche.

Qué **no** hacer en este paso: plan de muestra, alargar el registro, tocar
el camino invite/código (ya instantáneo).

Cuando se valide: implementar C y D (y A si cabe en el mismo PR). B queda
como seguimiento si el tiempo-a-aceptar sigue alto.
