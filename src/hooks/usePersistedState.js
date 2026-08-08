import { useState, useEffect, useRef, useCallback } from "react";

function readPersisted(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved != null ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

// Igual que useState, pero persiste el valor en localStorage bajo `key`.
// Al montar restaura lo guardado; en cada cambio guarda. Sobrevive a que
// la webview se descarte por memoria al mandar la app a background.
//
// `key` puede ser dinamica (p. ej. una clave por atleta). Cuando cambia, se
// lee el valor guardado de la clave NUEVA en vez de arrastrar el de la
// anterior, que es lo que hacia que los parametros de un atleta se colaran
// en el plan de otro.
export function usePersistedState(key, initialValue) {
  const [state, setState] = useState(() => ({ key, value: readPersisted(key, initialValue) }));

  // Ajuste en render (patron soportado por React): si la clave cambio, el
  // valor actual pertenece a otra clave y hay que releer antes de pintar.
  let current = state;
  if (state.key !== key) {
    current = { key, value: readPersisted(key, initialValue) };
    setState(current);
  }

  const setValue = useCallback((next) => {
    setState((prev) => ({
      key: prev.key,
      value: typeof next === "function" ? next(prev.value) : next,
    }));
  }, []);

  // Guardar en cada cambio (con debounce corto para no golpear en cada tecla).
  const timer = useRef(null);
  const value = current.value;
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* localStorage lleno o no disponible: ignorar */
      }
    }, 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [key, value]);

  // Limpia el borrador persistido (llamar tras guardar/enviar con éxito).
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignorar */
    }
  }, [key]);

  return [value, setValue, clear];
}
