# Mapeo — Indicador ACWR (riesgo de lesión)

Paso 1 (solo lectura). No hay código todavía. Spoiler: **el número ya se calcula**; lo que falta es el encuadre de producto (rangos y badge) y, si se quiere, mostrarlo al atleta.

---

## 1) Dónde vive la carga hoy

`computeGarminLoadMetricsFromWorkouts` (`src/components/shared/appShared.js:427-515`).

Entrada: array de workouts del atleta. Solo cuenta `done === true`. Fecha = `scheduled_date`. Km = `total_km` (el del **plan**, no el del reloj).

| Campo que ya devuelve | Definición actual |
|---|---|
| `acuteKm` | Suma de `total_km` de completados en los **últimos 7 días corridos** (hoy inclusive, `today-6` → hoy) |
| `chronicWeeklyAvgKm` | Promedio de km de las **4 semanas lun–dom** (esta + 3 anteriores) / 4 |
| `ratio` | `acuteKm / chronicWeeklyAvgKm` si crónica > 0 |
| `statusLabel` | `< 0.8` Desentrenado · `0.8–1.3` Óptimo · `> 1.3` Sobreentrenado |
| `ratioIndicatorColor` | verde en 0.8–1.3, rojo fuera, naranja si no hay dato |
| `weekBarsOldestFirst` | las 4 barras que ya pinta el coach |

Ese `ratio` **es un ACWR de volumen**. No hay que inventar otra fórmula de km.

Hay un **segundo** sistema en el mismo panel, y no hay que mezclarlo:

`computeFormaFatigaWeeklyPoints` (`:2141`) usa **RPE × km**, aguda 7d / crónica 28d, y `forma = crónica − aguda`. Eso alimenta el gráfico y el badge “En forma / Fatigado / Fresco”. No es ACWR. El Paso 2 no lo toca.

---

## 2) ACWR: lo que pide el producto vs lo que hay

Definición pedida: carga última semana / promedio últimas 4 semanas. Rango seguro típico 0.8–1.3. Por debajo, desentrenamiento. Por encima de **1.5**, riesgo de lesión por sobrecarga.

Huecos honestos respecto al código actual:

1. **Aguda no es “la semana lun–dom”**, es una ventana rodante de 7 días. Crónica sí es 4 semanas de calendario. El ratio mezcla dos relojes. Para un badge semanal es aceptable (Garmin/TrainingPeaks hacen algo parecido); documentarlo en el tooltip. No cambiar la fórmula en v1 salvo que se pida alinear ambas a lun–dom.
2. **El umbral rojo del coach hoy es 1.3, no 1.5.** La leyenda (`FormaFatigaPanel.jsx:39`) dice “> 1.3 sobreentrenado”. La literatura de ACWR suele pintar 1.3–1.5 como “precaución” y ≥ 1.5 como “riesgo”. Eso es el cambio de producto, no un cálculo nuevo.
3. **Km de plan, no de reloj.** Un 10K marcado hecho sin sync cuenta 10 km aunque el reloj diga 8. Consistente con “carga prescrita completada”. Si más adelante se quiere carga real, `workoutActualKm` ya existe; no en v1.
4. **Sin RPE.** El ACWR de este badge es solo km. El RPE sigue en el otro bloque.

Propuesta de bandas (una sola, en el helper):

| Ratio | Label | Color |
|---|---|---|
| sin datos | Sin datos suficientes | gris |
| `< 0.8` | Carga baja | ámbar |
| `0.8 – 1.3` | Rango seguro | verde |
| `> 1.3 y ≤ 1.5` | Precaución | naranja |
| `> 1.5` | Riesgo de sobrecarga | rojo |

“Desentrenado / Sobreentrenado” son juicios fuertes para un número de km; el copy de arriba es más defendible junto a “el coach decide”.

El helper ya tiene `hasRatio`, `ratio`, colores. El Paso 2: ampliar `statusLabel` / color a las 4 bandas y **no** duplicar el cálculo.

---

## 3) Dónde pintarlo

### Coach — `FormaFatigaPanel.jsx`

Ya hay una tarjeta “Estado de entrenamiento” + otra “Ratio carga aguda / crónica” con barra 0–2. No añadir un tercer número distinto.

Cambio propuesto:

- Renombrar la tarjeta de estado a **ACWR** (o “Riesgo de carga”) y usar las bandas de arriba.
- En la tarjeta del ratio, el número grande sigue siendo `ratio.toFixed(2)`; el texto de ayuda pasa a “seguro 0.8–1.3 · precaución 1.3–1.5 · riesgo > 1.5”.
- Ajustar el degradado de la barra para que el verde cubra 0.8–1.3 (hoy el verde es 40–65 % de 0–2, o sea 0.8–1.3: **ya está alineado a 1.3**). Habrá que marcar 1.5 en la escala (tick o cambio de color a rojo más tarde).
- **Ninguna acción automática** (no bloquear Plan 2 Semanas, no avisos push). Solo el indicador.

### Atleta — `AthleteFormaFatigaPanel.jsx`

El comentario del archivo: *“Subset vs el FormaFatigaPanel del coach: sin ratio, sin barras…”*. Ya llama a `computeGarminLoadMetricsFromWorkouts` y **sí pinta** `statusLabel` + aguda/crónica en km. **No pinta** el número `ratio` ni la barra 0–2.

Al cambiar las bandas en el helper, el “Estado de entrenamiento” del atleta se actualiza solo (Desentrenado → Carga baja, etc.).

Opcional v1: añadir el número ACWR (píldora o línea bajo el estado), misma paleta, copy corto tipo “rango seguro 0.8–1.3 · esto no cambia tu plan”. Paywall Premium ya envuelve el panel.

Recomendación: **sí mostrar el número al atleta**, no solo el label. Si se prefiere no asustar, v1 deja el número solo en ficha del coach y el atleta se queda con el estado de texto (que de todos modos cambia de bandas).

---

## 4) Qué no entra

- No cron, no push, no email.
- No umbral que cancele sesiones ni que altere el generador de planes.
- No ACWR por zona (solo km totales).
- No persistir el ratio en BD: se deriva de los workouts ya cargados en la ficha (coach) / home (atleta). Cero queries nuevas.
- No fusionar este badge con “En forma / Fatigado” (RPE). Dos historias: volumen vs percepción.

---

## 5) Archivos del Paso 2

- `src/components/shared/appShared.js` — `computeGarminLoadMetricsFromWorkouts`: 4 bandas, tick 1.5. Un solo sitio; coach y atleta lo leen.
- `src/components/Athletes/FormaFatigaPanel.jsx` — copy + escala.
- `src/components/AthleteHome/AthleteFormaFatigaPanel.jsx` — píldora opcional (si se aprueba).

Verificación: atleta con 4 semanas de datos en ficha coach; casos `<0.8`, `1.0`, `1.4`, `1.7`, y sin completados (guión).
