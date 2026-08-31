# Mapeo — Onboarding del atleta y “plan de muestra”

Paso 1 (solo lectura). No hay código de implementación.

Spoiler: **el registro ya es corto**. El atleta no se atasca en un formulario
largo de nivel/objetivo. Se atasca **después**: correo → home vacío → “aún no
tienes entrenador”. Un plan de muestra generado como Plan 2 Semanas **puede**
existir, pero no es el hueco que el producto tiene hoy — y Plan2Weeks no es
un endpoint que el atleta pueda disparar.

---

## 1) Flujo real de un atleta nuevo

`AuthLanding.jsx`, modo registro:

1. Campos: **nombre, rol (coach/atleta), correo, contraseña**. Si es atleta, **código de coach opcional**.
2. Si llega con `?invite=CODE`: resuelve el coach por RPC `find_invitation_by_code`. Si el link está gastado, puede seguir **sin** coach.
3. `signUp` con metadata `{ full_name, role, coach_id }`. Redirect de correo a `/auth/confirm`.
4. `POST /api/create-profile` (si hay sesión) o `raf_pending_profile` en localStorage hasta confirmar.
5. **No entra a la app.** Vuelve a la pantalla de login: “te enviamos un correo…”.

`create-profile.js` (~80–92) crea la ficha de atleta con placeholders:

- `goal: "Objetivo pendiente"`
- `pace: "Pendiente"`
- `weekly_km: 0`
- `coach_id` solo si vino invite o código

Después del verify (`ConfirmEmailScreen.jsx`): `ensureOwnProfile` + `accept_invitation_by_code` si había invite. `App.jsx` ve `profile.role === "athlete"` y monta `AthleteHome`.

**No hay onboarding de entrenamiento.** Ni nivel autopercibido, ni objetivo de carrera, ni VDOT, ni “¿cuántos días corres?”.

---

## 2) Fricción antes de ver algo útil

| Paso | Fricción |
|---|---|
| Formulario de registro | Baja: 4–5 campos. Nada de plan. |
| Confirmar correo | Media: no ve la app hasta abrir el mail. |
| Home sin coach | **Alta.** Banner “Aún no tienes entrenador” + `CoachLinkActions` (código o “solicitar entrenador”). |
| Calendario | Vacío. Sin copy de “aún no hay entrenos”. 0 km / 0 sesiones. |
| Plan de muestra | **No existe.** Nada autoasigna workouts al crear la cuenta. |

Tabs que sí ve: Home, Marketplace, Retos, Eval, Perfil. Puede comprar un plan de marketplace (pago) o hacer **una** evaluación VDOT gratis. Ninguno de los dos es un plan de muestra gratis en el calendario.

Invitado con link bueno: llega **con** coach_id, pero el calendario sigue vacío hasta que el coach asigne (Plan 2 Semanas, Builder, calendario). El banner de “sin entrenador” no sale; el vacío de sesiones sí.

---

## 3) ¿Plan2Weeks sirve para un plan de muestra?

Plan2Weeks es **solo UI de coach** (`CoachChrome`, no el atleta). Genera 2 semanas con IA.

Entradas que **bloquean** generate (`Plan2Weeks.jsx` ~876–884):

- Competencia (texto; default del form: `"Maratón"`)
- Tiempo objetivo `hh:mm:ss`

El resto tiene default o fallback:

| Dato | ¿Lo pide el registro? | ¿Plan2Weeks lo necesita? |
|---|---|---|
| Nivel (principiante / intermedio / avanzado) | No | Default `intermedio`; VDOT estimado 33 / 41 / 51 |
| Competencia + tiempo | No | **Sí, hard-required** |
| Sesiones/semana | No | Default 3 |
| Fecha de inicio | No | Default hoy+14 para asignar |
| VDOT real | No | Opcional; cae al del nivel |
| `athlete_id` + `coach_id` | Coach_id a veces | El generate/assign asume un atleta del roster del coach |

Con “nivel + objetivo” de la idea de la mañana: el nivel ya lo cubre el default. El “objetivo” tendría que ser competencia + marca, no un adjetivo. Aun así **el atleta no puede pulsar Generate**. Habría que extraer la generación a un API (hoy vive en el cliente del coach y cuenta contra el cupo de IA del coach).

Reutilizar la fórmula de km/sesiones es barato. Reutilizar el botón de Plan2Weeks “tal cual” para un signup **no**.

---

## 4) ¿Tiene sentido un plan de muestra antes de vincular coach?

Depende de **quién** es el atleta nuevo.

**Camino invite (el de este producto):** el valor es el coach. Un plan genérico de 2 semanas **antes** de vincular compite con el plan que el coach va a poner, ensucia el calendario y obliga a decidir qué pasa cuando llega el plan de verdad (¿borrar el de muestra? ¿mezclar?). El hueco real es: invite → confirmación de mail → **días de calendario vacío** hasta que el coach asigne. Ahí aplica más: avisar al coach (“X ya confirmó”) y un atajo de “asignar bloque de esta semana”, no un 10K inventado.

**Camino orgánico / sin coach:** el banner ya dice la verdad del producto: “conéctate para recibir entrenos personalizados”. Un plan de muestra le da algo que mirar; también le enseña que la app “ya planea sola” y luego el coach pisa eso. Marketplace ya cubre “quiero un plan sin coach” **pagando**. Un sample gratis canibaliza poco el marketplace si es corto y se etiqueta como demo.

La app **no exige** coach para insertar workouts (RLS de atleta + marketplace). El vacío no es una limitación técnica; es el diseño: el plan “de verdad” lo pone el coach.

---

## 5) Lectura honesta

La mejora tal como se planteó esta mañana (**formulario mínimo nivel + objetivo → plan personalizado en los primeros minutos**) **no encaja con el dolor actual**:

1. El registro **ya** es mínimo. Meter nivel + objetivo **alarga** el único paso que hoy es liviano.
2. No hay un wizard post-login de entrenamiento. El atleta llega a un home de relación coach-atleta, no a un generador.
3. Plan2Weeks no está expuesto al atleta y pide competencia + tiempo, no “nivel + objetivo” sueltos.
4. El problema medible es **time-to-first-workout-asignado-por-el-coach** (invite) o **time-to-vínculo** (orgánico), no time-to-formulario.

Qué sí aplicaría, si se valida:

| Prioridad | Qué | Por qué |
|---|---|---|
| 1 | Invite: push/email al coach cuando el atleta confirma + CTA “asignar esta semana” | Cierra el vacío sin inventar un plan paralelo |
| 2 | Home vacío: una frase y un botón (vincular / marketplace / “tu coach te va a cargar el plan”), no un grid mudo | Expectativa vs landing (“calendario personalizado”) |
| 3 | Sample plan **solo** si el negocio quiere atletas orgánico-sin-coach enganchados | Entonces sí: 2 preguntas post-login, API de generate, workouts marcados `source=sample`, se archivan al primer plan del coach |

Recomendación de este mapa: **no implementar el plan de muestra como Paso 2** hasta decidir si el onboarding objetivo es “atleta invitido por un coach” (mayoría del modelo) o “atleta que llega solo”. Si es el primero, el Paso 2 es agilizar el vínculo y la primera asignación, no Plan2Weeks en el signup.

Cuando esto se valide, el alcance real queda en una de esas tres filas — no en un formulario nuevo en `AuthLanding`.
