importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

if (!firebase.apps.length) {
  firebase.initializeApp({
    apiKey: "AIzaSyD1HwMxCRP-dmmyA89EJ3z22HXXaAVm6jo",
    authDomain: "runningapexflow.firebaseapp.com",
    projectId: "runningapexflow",
    storageBucket: "runningapexflow.firebasestorage.app",
    messagingSenderId: "224127738625",
    appId: "1:224127738625:web:c91f1634b923e3318bf100",
  });
}

try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    // FCM ya muestra la notificacion por su cuenta cuando el mensaje trae
    // bloque `notification`. Si la mostramos aqui tambien, sale duplicada.
    console.log("[fcm] background message", payload?.data);
  });
} catch {
  /* Messaging no disponible en este contexto */
}

const CACHE_NAME = "runningapexflow-__BUILD_ID__";
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/pwa-192.png",
  "/pwa-512.png",
  "/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => {}),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nunca cachear la API: siempre a red.
  if (url.pathname.startsWith("/api/")) return;

  // Navegacion / index.html: network-first estricto (cache solo si no hay red).
  if (request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/").then((r) => r || caches.match("/index.html")),
      ),
    );
    return;
  }

  // Assets hasheados de Vite (inmutables): cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
      ),
    );
    return;
  }

  // Resto de estaticos (iconos, manifest): stale-while-revalidate suave.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
