import { useState, useEffect, useRef } from "react";

// Igual que useState, pero persiste el valor en localStorage bajo `key`.
// Al montar restaura lo guardado; en cada cambio guarda. Sobrevive a que
// la webview se descarte por memoria al mandar la app a background.
export function usePersistedState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved != null ? JSON.parse(saved) : initialValue;
    } catch {
      return initialValue;
    }
  });

  // Guardar en cada cambio (con debounce corto para no golpear en cada tecla).
  const timer = useRef(null);
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
  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignorar */
    }
  };

  return [value, setValue, clear];
}
