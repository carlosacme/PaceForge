# Mapeo — Resumen semanal automático

Paso 1 (solo lectura). No hay código todavía.

---

## 1) Qué ya se calcula (reutilizar, no duplicar)

Hay **tres** superficies distintas. No coinciden al 100 %; el resumen debe elegir una y no mezclarlas.

### A) Dashboard del coach (`Dashboard.jsx`)

Consulta `workouts` de **esta semana lun–dom** (`startOfWeekMonday` + 6 días), del coach y su staff.

Por atleta (`:148-157`) y en global:

| Métrica | Función | Definición |
|---|---|---|
| Km programados | `sumWeekKm` | suma de `total_km` de **todos** los workouts de la semana |
| Km corridos | `sumWeekKm` → `workoutActualKm` | si `done`: reloj (`actual_distance_km`) o manual; si no hay, 0 (no cae a `total_km`) |
| Adherencia | `weekDone / weekTotal` | sesiones `done` / sesiones programadas |
| RPE medio | workouts done con `rpe` | solo coach, global |

`fetchWeeklyKmByAthlete` (`appShared.js:1018`) es la misma semántica de km, ya en una query para la lista.

### B) Tira del atleta (`AthleteWeeklyStrip`)

Últimas **4** semanas lun–dom, en cliente, sobre el array `workouts` del home:

- `kmTotal` = suma de `total_km` de **todas** las sesiones (programado, no corrido).
- `adherence` = `done / total` de esa semana.
- Etiqueta “Semana actual” vs “Hace N semanas”.

**No compara** vs la semana anterior en un solo número; pone las 4 cajas lado a lado.

### C) Card Semana/Mes/Año (`AthleteHomeProgress`)

Usa `distance_km` (no `total_km`) y **solo** sesiones `done`. Distinta otra vez. No usar para el resumen.

**Fuente canónica para el cron:** la de A) — `sumWeekKm` + adherencia `done/total` — porque es la que el coach ya mira y usa km reales cuando hay reloj. Extraer esas dos funciones a un módulo importable desde `api/` (hoy viven en `appShared.js` del cliente; el cron no debe importar React). El Paso 2 puede copiar `workoutActualKm` + `sumWeekKm` a `lib/weekStats.js` (10 líneas) o exportarlas desde un `.js` sin JSX. No reimplementar la fórmula.

Semana del resumen = **la que acaba de cerrar** (lunes anterior → domingo anterior), no la semana a medias.

---

## 2) Cron

Hoy solo existe `0 12 * * *` → remind diario.

Hobby de Vercel = **2 crons**. El segundo cabe aquí.

Propuesta: **lunes 12:00 UTC** (07:00 Colombia), `GET /api/send-push?action=weekly-summary`.

Por qué lunes y no domingo noche:

- El domingo a las 07:00 COT la semana lun–dom **aún no cerró** (falta el resto del domingo).
- El lunes a las 07:00 la semana anterior está completa y el atleta no está a mitad de un long.

Handler: mismo archivo `send-push.js` (mismo `CRON_SECRET`), rama `action=weekly-summary`. No hace falta un serverless nuevo.

Query (una, 14 días):

```text
workouts
  select athlete_id, scheduled_date, done, total_km, actual_distance_km, manual_distance_km
  where scheduled_date >= lunes_anterior
    and scheduled_date <= domingo_anterior   -- semana cerrada
  -- más la semana previa (lunes-2 → domingo-2) para el delta
```

O dos rangos en la misma query (`scheduled_date >= lunes-2sem`). Agrupar por atleta. Atletas sin ningún workout en esas dos semanas: **no** notificar.

Índice `(athlete_id, scheduled_date)` ya cubre esto.

---

## 3) Canal: push vs email vs ambos

| | Push (FCM) | Email (Resend) |
|---|---|---|
| Infra | Ya está en este mismo archivo | `api/send-email.js` + `lib/emailSender.js` |
| Auth del cron | `CRON_SECRET` | send-email **exige sesión de usuario**; el cron no puede usarlo tal cual. Habría que extraer `sendEmailViaResend` (ya exportado) y una plantilla nueva en el **servidor**, nunca vía el POST del cliente |
| Destinatario | `device_tokens` / `fcm_token` | email en `auth.users` (service_role) o `athletes.email` |
| Copy | ~2 líneas, se lee en el bloqueo | HTML, más espacio, más trabajo de plantilla |
| Quien no tiene token | Silencio | Llega al correo |
| Riesgo | Satura si se suma al remind del lunes (el remind también corre a las 07:00) | Resend key ya estuvo en git; no ampliar superficie sin plantilla allowlist |

**Recomendación: solo push en v1.**

Razones: el cron ya envía FCM; el kind nuevo entra en `push_deliveries`; el deep link ya existe (`athlete_calendar` o uno `weekly_summary` que abra la tira de progreso). Email obliga a un camino cron→Resend que **no existe** (send-email está cerrado a JWT + plantillas de invitación/pago/asignación) y a decidir qué email es “el del atleta”.

v1.1 (si hay atletas sin token): fallback email con plantilla `weekly_summary` añadida **en el servidor**, no al POST público de `/api/send-email`.

El lunes a las 07:00 también corre el remind de “tienes un entreno hoy”. Coordinación:

- Resumen semanal **primero**.
- Remind genérico después, como siempre.
- Son mensajes distintos (semana pasada vs sesión de hoy). **Sí se permiten los dos el lunes**; no es el mismo caso que racha vs remind. Si en el mismo día también hay racha, racha gana al remind (ver el otro mapa) y el resumen **igual se manda**: uno mira atrás, el otro mira el plan de hoy.

Dedup: no reenviar `kind=weekly_summary` al mismo `to_user_id` en las últimas 24 h.

---

## 4) Copy

Tono: un dato, una comparación, un empujón. Sin “has fallado”.

Variables: `km` (corridos, 1 decimal), `adherence` (%), `deltaKm` (corridos vs semana previa; puede ser negativo), `done/total`.

**Si adherencia ≥ 80 % y km ≥ semana previa**

> **📬 Tu semana**
> Cerraste 42.0 km y 5/5 sesiones. 4 km más que la anterior. Así se construye fondo.

**Si adherencia ≥ 50 %**

> **📬 Tu semana**
> 28.0 km · 3/4 sesiones (75 %). Un poco menos que la anterior, pero la consistencia sigue ahí. Esta semana suma una.

**Si adherencia < 50 % y había plan**

> **📬 Tu semana**
> 12.0 km · 1/4 sesiones. La anterior fue más llena. Un entreno hecho hoy ya cambia el recuento.

**Si no hay semana previa con la que comparar**

> **📬 Tu primera semana en el plan**
> 32.0 km · 4/4. Queda registrada: a partir de la que viene vas a ver el salto.

No poner RPE ni VDOT en el push (frío y largo). Eso sigue en Forma / Evaluación.

---

## 5) Archivos del Paso 2

- `vercel.json` — segundo cron `weekly-summary`.
- `api/send-push.js` — `handleWeeklySummary`.
- `lib/weekStats.js` (nuevo, chico) — `workoutActualKm` + `sumWeekKm` + rango lun–dom en COT, para no importar `appShared.jsx`.
- Deep link: reutilizar `athlete_calendar` o añadir `weekly_summary` en el home del atleta (scroll a `AthleteWeeklyStrip`). Lo segundo es más fiel; lo primero es más barato.

No tocar Dashboard ni `AthleteWeeklyStrip` en v1: el push **lee** las mismas reglas; no hace falta que la UI cambie.
