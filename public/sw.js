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
    const { title, body } = payload.notification || {};
    self.registration.showNotification(title || "RunningApexFlow", {
      body: body || "",
      icon: "/pwa-192.png",
    });
  });
} catch {
  /* Messaging no disponible en este contexto */
}

const CACHE_NAME = "runningapexflow-v1";
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

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/").then((r) => r || caches.match("/index.html")),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
