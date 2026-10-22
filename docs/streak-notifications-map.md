# Mapeo — Push de racha en riesgo

Paso 1 (solo lectura). No hay código todavía. Cuando esto se valide, el Paso 2
entra en `api/send-push.js` y `vercel.json`.

---

## 1) Dónde vive el cron hoy

| Pieza | Dónde | Qué hace |
|---|---|---|
| Trigger | `vercel.json:12` | Un solo cron: `GET /api/send-push?action=remind`, `0 12 * * *` (12:00 UTC = **07:00 Colombia**, sin DST) |
| Auth | `api/send-push.js:77-83` | Exige `Authorization: Bearer $CRON_SECRET` |
| Quién | `handleDailyReminders` `:14-73` | Workouts con `scheduled_date = hoy (UTC-5)` y `done = false` |
| Destino | `athletes.user_id` → `device_tokens` (con fallback a `profiles.fcm_token`) | Un push por workout no hecho, no por atleta |
| Kind | `"athlete_calendar"` | Deep link al calendario; `pushData.workout_id` |
| Log | `push_deliveries` vía `sendToAllDevices` / `logDelivery` | `from_user_id` null en cron |

A quién notifica **hoy**: todo atleta que tenga **al menos un workout programado hoy y no marcado hecho**, y que tenga token FCM. Si tiene dos sesiones hoy, recibe **dos** pushes (el bucle es por workout, `:51`).

No hay otra categoría de cron. Chat, “entreno hecho”, invitaciones, etc. salen por POST autenticado al mismo endpoint, no por cron.

---

## 2) Qué significa “racha” aquí (propuesta)

La racha de **logros** ya existe y **no** es la que queremos:

- `getLongestConsecutiveDays` (`appShared.js:1889`) cuenta días calendario con al menos un `done`, ignorando el plan.
- `longestDoneNoFailStreak` (`:1991-1993`) recorre **todos** los workouts pasados en orden y se resetea en el primero no hecho. Es historial máximo, no racha **actual**, y recorre todo.

Para este push, la racha es **según el plan**:

1. Un **día programado** = hay ≥1 workout con `scheduled_date = D`.
2. Día **completado** = todos los workouts de D están `done`.
3. Día **fallido** = D < hoy y hay al menos un workout de D con `done = false`.
4. Los días **sin nada en el calendario** (descanso) **no rompen** la racha y no cuentan como “días sin correr”.
5. Racha activa `Y` = días programados consecutivos completados, contando hacia atrás desde el último día programado completado (saltando descansos).
6. Días en riesgo `X` = días programados fallidos consecutivos más recientes (hacia atrás desde ayer). Hoy aún no se cuenta como fallido: el atleta todavía puede marcar el de hoy.

**Disparo:** `X >= 2` **y** `Y >= 1` (tenía racha; no molestar a quien nunca completó nada).

Ejemplo: lun–vie programados, completó lun–mié, falló jue y vie. El sábado: `X=2`, `Y=3` → “Llevas 2 días sin completar lo programado, tu racha de 3 está en riesgo.”

---

## 3) No saturar con el recordatorio genérico

El remind de las 07:00 ya dice “Tienes un entreno hoy”. Si además mandamos racha, el mismo atleta puede llevarse **dos** pushes en el mismo minuto.

Regla propuesta (una sola, explícita):

- Si el atleta califica para **racha en riesgo**, se manda **solo** esa (`kind: "streak_risk"`). El remind genérico de hoy se **omite** para ese `user_id`.
- Si no califica, el remind sigue igual (incluido el caso de 2 workouts hoy → 2 reminds; eso es deuda previa, no la tocamos aquí).
- Dedup extra: no volver a mandar `streak_risk` el mismo día calendario Colombia si `push_deliveries` ya tiene `kind=streak_risk` + `status=sent` para ese `to_user_id` desde las 00:00 COT. Cubre re-ejecuciones del cron.

Copy (un push, no uno por workout):

> **🔥 Tu racha está en riesgo**
> Llevas X días sin completar lo programado. Tu racha de Y día(s) se corta si hoy tampoco cuentas.

Deep link: `{ type: "athlete_calendar" }` (sin `workout_id`, para no privilegiar una sesión). Hay que enseñar a `useCoachPushDeepLinks` / el home del atleta a ignorar un type nuevo o tratarlo como calendario — hoy el deep link ya abre por `open=athlete_calendar`.

---

## 4) Query eficiente (sin recorrer todo el historial)

**No** hace falta tabla nueva ni columna `athletes.current_streak`.

Índice ya existente (`0062_workouts_generated_with_vdot.sql`):

```sql
(athlete_id, scheduled_date)
```

Ventana: **60 días** hacia atrás + hoy. Una racha de 60 días de plan es más que suficiente para el copy; más allá no cambia el mensaje.

Una sola lectura por corrida:

```text
workouts
  select athlete_id, scheduled_date, done
  where scheduled_date >= hoy_cot - 60
    and scheduled_date <= hoy_cot
  order by athlete_id, scheduled_date
```

En memoria: agrupar por `athlete_id`, colapsar a un mapa `fecha → {total, done}`, caminar desde ayer hacia atrás. Complejidad O(filas de la ventana), no O(toda la carrera del atleta).

Luego, solo para los atletas que disparan, resolver `user_id` + tokens (mismo patrón que `handleDailyReminders`).

Orden dentro del mismo cron (`action=remind`):

1. Cargar ventana 60d + workouts de hoy no hechos (puede ser la misma query).
2. Enviar `streak_risk` a quien califique.
3. Enviar reminds genéricos al resto con sesión hoy no hecha.

Un cron, dos categorías, un round-trip extra de `workouts` acotado. Vercel Hobby permite 2 crons; no gastar el segundo aquí.

---

## 5) Qué no hacer en v1

- No persistir racha en `athletes` (se puede añadir después si el calendario quiere pintarla).
- No push al coach (“tu atleta va a perder la racha”).
- No contar km ni RPE; esto es adherencia de días de plan.
- No usar `actual_synced_at` como proxy de “corrió”: el plan se cierra con `done`.

---

## 6) Archivos del Paso 2 (cuando se apruebe)

- `api/send-push.js` — nueva función junto a `handleDailyReminders`, mismo GET.
- `lib/fcmPush.js` — sin cambios de transporte; solo un `kind` nuevo.
- `vercel.json` — sin cron nuevo.
- Tests: script o casos de mesa (descanso en medio, 1 fallo vs 2, racha 0, ya enviado hoy).
