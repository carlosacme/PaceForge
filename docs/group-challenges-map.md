# Mapeo — Retos grupales (entre atletas de un mismo coach)

Paso 1 (solo lectura). No hay código de implementación todavía.

Spoiler: **hoy no es 100 % individual**. Ya hay reto compartido + participantes +
ranking. Lo que no existe es el recorte “solo los atletas de este coach”.

---

## 1) Dónde vive

Un solo componente para los dos lados:

| Superficie | Archivo | Cómo se monta |
|---|---|---|
| Coach | `ChallengesHub.jsx` | `CoachChrome.jsx` tab Retos (`view === "challenges"`), `athleteId={null}`, `workouts={[]}`, pasa `coachAthletes` |
| Atleta | el mismo `ChallengesHub.jsx` | `AthleteHome.jsx` tab `challenges`, `isAthlete`, `athleteId` + `workouts` propios |
| Tipos / progreso | `appShared.js` ~2174–2280 | `CHALLENGE_TYPE_OPTIONS`, `computeChallengeProgressForAthlete` |

No hay `useChallenge*`. La carga, el join, el create y el modal viven dentro del hub.

El coach **no crea** retos (salvo que sea admin de plataforma). El atleta **sí se une**. El admin crea, borra, renueva y puede prellenar con IA (`/api/generate-workout`).

---

## 2) ¿Individual o compartido?

**Compartido a nivel de plataforma, no 1:1.**

- Una fila en `challenges` = un evento (título, tipo, meta, fechas).
- N atletas se unen a **el mismo** `challenge_id` vía `challenge_participants`.
- El progreso se calcula **por atleta** (sus workouts `done` en el rango de fechas), en el cliente. No hay columna de progreso persistida.
- Ranking: sí, cuando la meta de distancia es abierta (`target_value <= 0`): “Sin meta fija · Ranking por km” (`ChallengesHub.jsx` ~907–934). Con meta fija, el modal muestra barras por participante, no un puesto 1–2–3.

No hay flag `is_group` / `shared`. El modelo ya es grupal. Lo que falta para el producto de esta mañana es **alcance de equipo**: “reto del coach X, solo sus atletas”.

Hoy un atleta de coach A y uno de coach B pueden estar en el mismo reto global y verse en el mismo ranking.

---

## 3) Esquema

`supabase/migrations/0028_challenges_tables.sql` (+ recurrencia en `0038`):

**`challenges`**

| Columna | Notas |
|---|---|
| `id` | bigserial |
| `title`, `description`, `emoji`, `color` | copy / UI |
| `challenge_type` | `distancia` · `tiempo` · `workouts` · `racha` |
| `target_value`, `unit` | 0 en distancia = ranking abierto |
| `start_date`, `end_date` | ventana del progreso |
| `is_active` | |
| `created_by` | uuid; en el insert del UI siempre es `PLATFORM_ADMIN_USER_ID` |
| `is_recurring`, `recurrence` | `monthly` / `weekly` |

**No hay `coach_id` ni `athlete_id` en `challenges`.**

**`challenge_participants`** — ya es la tabla de participantes que se habría propuesto:

| Columna | Notas |
|---|---|
| `challenge_id` | FK a `challenges` ON DELETE CASCADE |
| `user_id` | quien se unió |
| `athlete_id` | ficha; unique `(challenge_id, user_id, athlete_id)` |
| `joined_at` | |

Asociar a un `coach_id` compartido **es poco esfuerzo de esquema**: una columna nullable `challenges.coach_id` (null = reto global de admin; uuid = reto del equipo). Los participantes no cambian.

---

## 4) Cambio mínimo si el objetivo es “reto del equipo”

No hace falta una tabla nueva de participantes. Ya existe.

1. **`challenges.coach_id`** (nullable). Admin sigue creando globales (`coach_id` null). El coach crea con su `auth.uid()`.
2. **Desbloquear el formulario de create** para `profileRole === "coach"` (hoy `createChallenge` sale si `!isAdmin`).
3. **Filtro de listado:**
   - Atleta: retos globales + retos cuyo `coach_id` es el de su ficha.
   - Coach: los suyos + (opcional) los globales.
4. **Leaderboard de equipo:** reutilizar `computeChallengeProgressForAthlete` sobre los participantes **cuyo `athlete_id` está en `coachAthletes`**. El ranking abierto ya ordena por km; para sesiones / tiempo / racha, el mismo sort por `pr.value`.
5. **Join:** el atleta se une igual (`insert` en `challenge_participants`). El coach puede, en v1, “inscribir a todos” con un insert masivo de sus atletas — eso sí es UI nueva, no esquema.
6. **Notificaciones de progreso (fuera de v1 de esquema):** no hay push de retos hoy. Encajaría un `kind` nuevo en `send-push` (p. ej. “X te superó en el reto Y”), no un cron de Retos.

Progreso: **no persistir** en v1. El hub ya carga workouts `done` de los participantes en el rango y calcula en memoria. Un leaderboard de 20 atletas de un coach cabe en esa query.

---

## 5) Cómo se crea un reto hoy

| Camino | Quién | Qué |
|---|---|---|
| Formulario manual | Solo admin | Título, fechas, tipo, meta (km opcional), emoji, color, recurrencia |
| IA (prefill) | Solo admin | `/api/generate-workout` rellena el form; el admin guarda |
| Renovar | Admin o cron `renew_recurring_challenges` | Copia el reto al siguiente periodo; **no copia participantes** |

No hay plantilla por atleta ni generación automática al asignar un plan.

**Implicación:** “crear un reto grupal del equipo” **no es un producto nuevo**. Es una opción en el formulario que ya existe, quitándole el candado de admin y guardando `coach_id`. El trabajo grande no es el form: es el filtro de visibilidad + no mezclar equipos en el ranking.

---

## 6) Riesgos y cruces

**Logros / achievements:** sistema aparte. Tablas `achievements` + `athlete_achievements`, UI `AchievementsGrid`, API `/api/achievements`. Misma familia de métricas (km, racha, sesiones) pero ventana distinta (toda la vida vs fechas del reto). Completar un reto **no** dispara un logro. Tocar Retos no rompe lo de racha/ACWR de esta semana.

**Suposiciones 1:1 que SÍ existen (y importan):**

- El progreso siempre se calcula para **un set de workouts de un atleta**, no para el reto entero. Hacerlo “grupal de equipo” no rompe eso.
- El join exige `currentUserId` **y** `athleteId`. Un atleta sin ficha no se une.
- El coach ve el modal de participantes de **todo el reto global**, no solo los suyos. Si no se filtra, al crear retos de equipo mezclados con globales el coach vería extraños en el ranking.
- RLS: las migraciones crean las tablas y habilitan poco de policies visibles en `0028`. Cualquier insert de coach hay que revisarlo (hoy el create asume admin / `created_by` fijo).
- Cron `0048` inserta columnas que no coinciden del todo con `0028` (`type` vs `challenge_type`, etc.). Drift: no tocarlo al añadir `coach_id` sin mirar el schema real.
- No hay push de retos: si se promete “notificaciones de progreso” es feature aparte, no un flag en el form.

**No se rompe** el supuesto “un reto = un atleta”, porque ese supuesto **no está** en el código.

---

## 7) Lectura para validar el alcance

El pedido de “tabla de participantes + leaderboard” **ya está construido** a escala plataforma.

Lo que aplicaría de verdad:

1. Reto **por coach** (columna + form desbloqueado + ranking filtrado).
2. Opcional: inscribir al equipo de un clic.
3. Más adelante: push “te alcanzaron”.

Si el objetivo es solo que los atletas de un coach compitan entre sí **sin** retos globales, el filtro `coach_id` es el Paso 2. Si se quieren dejar los retos de admin y sumar los de equipo, `coach_id` nullable.

Cuando esto se valide, el Paso 2 no inventa tablas de progreso.
