/**
 * Marca UI "ocupada" para no forzar reload de build a mitad de un chat
 * o borrador. Los componentes lo actualizan en un useEffect.
 */
export function setResumeUiBusy(busy) {
  if (typeof window === "undefined") return;
  window.__rafResumeUiBusy = Boolean(busy);
}

export function isResumeUiBusy() {
  if (typeof window === "undefined") return false;
  return Boolean(window.__rafResumeUiBusy);
}
