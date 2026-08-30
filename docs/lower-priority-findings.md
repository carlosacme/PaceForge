# Hallazgos de menor urgencia — diagnóstico (2026-08-30)

Seguimiento de tres puntos de `docs/full-audit-2026-08-v3.md`. El punto 1 (bundle)
está implementado en esta misma rama. Los puntos 2 y 3 son **solo diagnóstico**:
nada de su código se ha tocado, y cada uno cierra con una recomendación para decidir.

Todo lo que se afirma aquí está verificado contra producción (tablas `workout_library`
y `workouts`) o ejecutando las funciones reales de `src/lib/enrichPace.js` sobre las
cadenas exactas de esas filas. Donde no pude comprobar algo, lo digo.

---

## 1) Bundle — `Athletes.jsx` fuera del chunk eager (implementado)

`CoachChrome.jsx:2` importaba `Athletes` de forma estática, así que el split de ayer
no llegó al bundle inicial. Ahora entra por `React.lazy` con su propio `Suspense`
local, igual que `EvaluationView`.

| | Antes | Después | Δ |
|---|---|---|---|
| `index-*.js` | 1.071,36 kB | 608,33 kB | **−463,03 kB (−43 %)** |
| `index-*.js` gzip | 327,46 kB | 189,38 kB | **−138,08 kB (−42 %)** |
| chunk `Athletes-*.js` | — | 517,18 kB (gzip 158,01 kB) | nuevo, bajo demanda |

`Athletes` solo se importaba desde `CoachChrome`, así que no queda ninguna ruta que
lo devuelva al chunk inicial. Build y lint limpios.

---

## 2) Strip del objetivo en TEST — huecos restantes

### Dónde corre hoy

`stripTestTimeGoalFromDescription` y `stripTestTimeGoalsFromStructure` se llaman
**solo en dos sitios**, los dos en el cliente y los dos en el momento de asignar:
`Builder.jsx:174,195` y `WorkoutLibrary.jsx:502,526`. No existen en `api/` ni en
`lib/`, así que **`Plan2Weeks` y `MarketplaceHub` asignan sin pasar por el strip**.
Un TEST dentro de un plan de 2 semanas generado por IA, o dentro de un plan comprado
en el marketplace, conserva su objetivo íntegro. Esto es independiente de lo ancho
que sea el regex y, en mi opinión, es el hueco más grande de los tres de este bloque.

### a) "S16 Dom - TEST 5K" (id 198) — el regex **sí** lo cubre

Confirmado en los dos niveles. En SQL, `title ~* 'TEST\s*\d*K'` da `true` para las
tres plantillas de test que hay en biblioteca (138 `TEST 3K`, 168 `TEST 10K`,
198 `TEST 5K`). Y ejecutando las funciones reales sobre la descripción exacta de la
fila 198, el strip funciona completo:

```
antes:  TEST 5K - Objetivo: 19:30-20:00 (VDOT 46-47)
        […]
        @ 4:03/km — 5K all-out objetivo 19:30-20:00

después: TEST 5K - corre a tu máximo esfuerzo sostenible
        […]
        @ 4:03/km — 5K all-out
```

Los dos regex disparan: `TEST_OBJETIVO_VDOT_RE` sobre la cabecera y
`TEST_OBJETIVO_TIME_RE` sobre el paso. **No hay nada que arreglar en 198.**

Por qué no salió en las pruebas de ayer: la fila 198 nunca se ha asignado. En
`workouts` solo hay TEST 3K y TEST 10K (ids 1030, 1031, 1039, 1040). El 1039,
asignado el 2 de septiembre, ya muestra el texto limpio ("corre a tu máximo esfuerzo
sostenible", paso "10K all-out"), así que el fix está operando en producción; el 1031
sigue con el objetivo porque se asignó antes. Fue un hueco de cobertura de prueba,
no de regex.

### b) "Carrera 5K / Test final" (workout 905) — no calza, y ampliar el regex no cambiaría nada

El título no calza, correcto: tras "Test" viene " final", y el regex exige una `K`
después del dígito opcional. Pero al mirar la fila entera, **no hay ningún objetivo
que limpiar**:

- `description`: "Rodaje final o día de carrera de 5K, iniciando suave a 7:13–7:54 min/km según sensaciones"
- `structure`: `[]` (vacía)

No hay "Objetivo: mm:ss", no hay paso de all-out, no hay `target_pace`. Si mañana el
regex cubriera este título, el resultado sería idéntico. Es un falso positivo del
hallazgo: el título sugiere un test, pero el contenido es un rodaje.

**Recomendación: flag explícito en la fila, no un regex más ancho.** Razones, en orden
de peso:

1. **El regex no es el cuello de botella, la cobertura de caminos lo es.** Ampliarlo no
   toca `Plan2Weeks` ni `MarketplaceHub`, que es donde de verdad se escapan objetivos.
   Un flag viaja con la fila y se puede leer desde cualquier camino, incluido `api/`.
2. **Adivinar por título es frágil en las dos direcciones.** Con "cualquier título que
   contenga test" entrarían cosas donde el ritmo objetivo **sí** es la intención:
   "Test de campo 30 min", "test de lactato", un "Test de FC" en cinta. Y seguirían
   fuera los tests que no usan la palabra ("Contrarreloj 5K", "CR 10K", "time trial").
3. **Un flag hace explícito lo que hoy es una convención tácita.** Quien crea la
   plantilla sabe si es un test de esfuerzo; el título es una pista, no un dato.

Forma concreta que propondría: columna booleana en `workout_library` (p. ej.
`is_effort_test`), un checkbox al guardar la plantilla, y `isTestWorkoutTitle` degradado
a heurística de dos usos — sugerir el checkbox marcado cuando el título calza, y
backfill de las 3 filas existentes. Coste real: una migración, un checkbox, y mover
las llamadas al strip para que lean el flag. Lo que no haría es sustituir una
adivinanza por otra adivinanza más ancha.

### c) El `target_pace` numérico del bloque all-out — confirmado, y es el hallazgo serio

Confirmado ejecutando el pipeline real de asignación (`rescaleStructureToVdot` →
`enrichStructureWithPaces` → `stripTestTimeGoalsFromStructure`) sobre el bloque
all-out de la fila 198, con un atleta de VDOT 52:

```
original  : description "@ 4:03/km — 5K all-out objetivo 19:30-20:00"  target_pace "3:59-4:07/km"
rescalado : description "5K all-out objetivo 19:30-20:00"              target_pace "3:54-3:48"
+ strip   : description "5K all-out"                                    target_pace "3:54-3:48"
```

El strip solo toca `b.description`. `target_pace` **no se vacía nunca**, y además el
rescale lo reescribe al VDOT del atleta. Es decir: quitamos el objetivo del texto y
dejamos el mismo objetivo, en la misma pantalla, expresado en la unidad que el reloj
muestra durante el esfuerzo. 3:48–3:54/km sobre 5 km **es** 19:00–19:30: el objetivo
que borramos del texto, traducido a ritmo.

Mi lectura de producto: **el bloque de medición de un TEST debería ir sin ritmo
objetivo.** No es una cuestión de pureza, es que el número rompe la medición de tres
formas concretas:

1. **El objetivo sale del VDOT que el test viene a re-medir.** Es circular. Si el
   atleta corre al ritmo que le pinta la pantalla, el test solo puede confirmar el
   VDOT anterior. Una mejora real queda truncada: llega a 3:54, ve que va "en
   objetivo", y sostiene en vez de apretar.
2. **En el otro sentido, invita a reventar.** Si el atleta viene de una mala semana,
   perseguir un ritmo calculado para su mejor día convierte el test en un abandono a
   mitad, y ahí no medimos nada.
3. **El texto ya dice "all-out".** Tener "all-out" y un rango de ritmo estrecho en el
   mismo paso son instrucciones contradictorias, y en el reloj gana el número: es lo
   que vibra y lo que aparece en la esfera.

Dónde no lo vaciaría: **solo el bloque de medición**. Calentamiento, intervalos de
activación, recuperaciones y enfriamiento deben conservar sus ritmos — ahí sí son una
prescripción, no la medida. Y el ritmo rescalado no se pierde: sigue siendo útil
*después*, para contextualizar el resultado en el análisis, y ya lo tenemos guardado
vía `generated_with_vdot`.

Viabilidad técnica, que conviene saber antes de decidir: vaciar el `target_pace` de un
solo bloque es seguro. `isRunWorkout` (`intervals.js:466-475`) solo exige que **algún**
bloque produzca ritmo válido, y el WU/CD lo siguen dando, así que el workout no se
marca "sin ritmos". Y `normalizeBlock` (`:210`) descarta un bloque solo si no tiene ni
duración ni distancia; el all-out trae `distance_km: "5"`, así que sobrevive como paso
de 5 km sin ritmo objetivo. No verifiqué la cadena exacta que se exporta al reloj para
un paso sin pace, y eso sí habría que mirarlo al implementar.

Observación secundaria que salió al probar, sin relación con el sesgo: el rescale emite
el rango como `"3:54-3:48"` (lento→rápido, sin sufijo `/km`), mientras la biblioteca usa
`"3:59-4:07/km"` (rápido→lento, con sufijo). Conviven dos convenciones en la misma
columna. No comprobé si el envío al reloj parsea distinto una y otra, así que lo dejo
como observación, no como fallo.

---

## 3) `EvaluationView.jsx` — etiquetas Élite / Avanzado / Intermedio / Principiante

### Qué es exactamente

Bloque `EvaluationView.jsx:405-455`, dentro de la tarjeta **"TIEMPOS PREDICHOS"**. Para
cada distancia (5K, 10K, 21K, 42K) se pinta el tiempo predicho y debajo una píldora con
la etiqueta. El tiempo viene de `predictRaceSeconds(vdot, distancia)` (`:253-255`), y el
VDOT viene de la evaluación que **acaba de registrarse**: un resultado de carrera o un
test de Cooper (`:226-243`).

Los umbrales están hardcodeados por distancia. Para 5K: ≤18:00 Élite, ≤22:00 Avanzado,
≤27:00 Intermedio, resto Principiante.

**Lo ve el atleta, no solo el coach.** Además de `CoachChrome.jsx:297`, el mismo
componente se monta en `AthleteHome.jsx:922` (pestaña "eval", con `athleteOnlyId`, tras
el gate de Premium). Esto no estaba en la auditoría v3 y es lo que hace que la pregunta
tenga sentido.

### ¿Ancla expectativas como el sesgo de TEST?

Honestamente: **no por el mismo mecanismo, y bastante más débil.** La diferencia que
importa es *cuándo* llega el número. El sesgo de TEST es una instrucción entregada
minutos antes de un esfuerzo máximo, en la muñeca, durante el esfuerzo: ahí el anclaje
es mecánico, cambia el ritmo de la primera vuelta. La etiqueta de nivel llega
*después* del esfuerzo que la produjo, en otra pestaña, y habla de distancias que
pueden estar a meses. No puede sesgar el esfuerzo que la generó.

Donde sí veo un solape real, y lo digo sin adornar: si el coach programa un 5K de
carrera y el atleta ha visto "5K — 21:40 · Avanzado", ese 21:40 es un ancla para el día
de la carrera. Es la misma familia que el sesgo de TEST, más difusa (otra pantalla, otro
día, no está en el reloj), pero existe. El tiempo predicho ancla más que la etiqueta.

Y hay un problema distinto, que me parece más importante que el anclaje:

1. **Es una etiqueta de identidad, no de tarea.** "21:40" describe una actuación;
   "Principiante" describe a la persona. Las etiquetas de identidad se pegan y no
   aportan nada entrenable: nadie ajusta una sesión porque le hayan dicho
   "Intermedio". El coste motivacional es real y el beneficio de entrenamiento es cero.
2. **Los umbrales son absolutos, sin sexo ni edad.** Un 5K en 27:30 etiqueta
   "Principiante" tanto a un chico de 20 años como a una mujer de 50, para quien ese
   tiempo es un resultado sólido. Como afirmación sobre el nivel de la persona,
   simplemente es falsa en el segundo caso, y es la primera cosa que ese atleta ve tras
   pagar Premium.
3. **La escala está descalibrada en el extremo bueno.** 18:00 en 5K se etiqueta
   "Élite"; élite de verdad son ~13-14 min. Halaga arriba y castiga abajo, así que la
   etiqueta no significa lo que dice en ninguno de los dos extremos.

### Recomendación

No lo trataría como el mismo bug que el sesgo de TEST — no hay anclaje pre-esfuerzo, así
que no es urgente y no bloquea nada. Pero cambiaría el encuadre, porque el coste actual
no compensa: quitar las cuatro etiquetas absolutas y sustituirlas por progreso relativo,
que es información que el atleta sí puede usar y que **el componente ya calcula** en el
gráfico de historial (`:678-682`: "+1.8 puntos" desde el primer test). Pasar de "lo que
soy" a "hacia dónde voy" conserva el valor motivacional sin poner techo ni etiqueta.

Si se quiere conservar una noción de nivel, la única versión defendible es percentil
ajustado por edad y sexo (age-grading), que es un dato estándar y no una tabla inventada.
Eso es bastante más trabajo que borrar las píldoras, así que lo pondría en un segundo
paso, no en el primero.

---

## Resumen para decidir

| # | Hallazgo | Mi recomendación | Esfuerzo |
|---|---|---|---|
| 2 (caminos) | `Plan2Weeks` y `MarketplaceHub` asignan sin strip | Arreglar primero: es el hueco más ancho | Medio |
| 2a | Fila 198 | Nada. El regex ya la cubre; faltaba la prueba | — |
| 2b | "Carrera 5K / Test final" | Flag `is_effort_test` en la fila, no ampliar el regex | Medio |
| 2c | `target_pace` del bloque all-out | Vaciarlo solo en el bloque de medición del TEST | Bajo |
| 3 | Etiquetas de nivel | Sustituir por progreso relativo (ya calculado); age-grading después | Bajo / Medio |
