/**
 * `serviceWorker.ready` no resuelve si el SW falló o tarda en activar
 * (webview embebido, primera visita). El timeout evita colgar getToken.
 */
export async function readyServiceWorker(
  timeoutMs = 2500,
  serviceWorker = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
) {
  if (!serviceWorker) return null;
  try {
    return await Promise.race([
      serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}
