/**
 * src/lib/workoutStructure.js
 * -----------------------------------------------------------
 * Fuente unica para leer la estructura de un workout.
 *
 * La tabla `workouts` (y `workout_library`) tiene DOS columnas:
 *   - structure          (legacy)
 *   - workout_structure  (anadida en 0030)
 * que deberian llevar lo mismo, pero pueden divergir.
 *
 * OJO con el bug del array vacio: `[]` es truthy y NO es nullish,
 * asi que tanto `a || b` como `a ?? b` devuelven `[]` cuando la
 * primera columna esta vacia, ignorando datos validos en la otra.
 * Este helper prefiere la columna que REALMENTE tenga contenido.
 *
 * Tambien tolera filas donde el jsonb llego como string JSON.
 * -----------------------------------------------------------
 */
function coerceArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function readStructure(row) {
  const a = coerceArray(row?.workout_structure);
  if (a && a.length) return a;
  const b = coerceArray(row?.structure);
  if (b && b.length) return b;
  return [];
}
