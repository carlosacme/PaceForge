import { useState, useCallback } from "react";
import { usePersistedState } from "./usePersistedState";
import { libraryRowToBuilderWorkout } from "../components/shared/appShared";

/**
 * Estado puente Builder ↔ Library (y tick de refresh para Gpx).
 *
 * No incluye workoutsRefresh ni Plan2Weeks — ticks/vistas distintas.
 *
 * @param {{
 *   setView: (v: string) => void,
 *   notify: (msg: string) => void,
 * }} args
 */
export function useBuilderLibraryBridge({ setView, notify }) {
  const [aiPrompt, setAiPrompt] = usePersistedState("raf_gen_prompt", "");
  const [aiWorkout, setAiWorkout] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);

  const bumpLibraryRefresh = useCallback(() => {
    setLibraryRefresh((r) => r + 1);
  }, []);

  const useLibraryWorkout = useCallback(
    (row) => {
      setAiWorkout(libraryRowToBuilderWorkout(row));
      setView("builder");
      notify("Workout cargado en el generador. Puedes asignarlo a un atleta.");
    },
    [setView, notify],
  );

  return {
    aiPrompt,
    setAiPrompt,
    aiWorkout,
    setAiWorkout,
    aiLoading,
    setAiLoading,
    libraryRefresh,
    bumpLibraryRefresh,
    useLibraryWorkout,
  };
}
