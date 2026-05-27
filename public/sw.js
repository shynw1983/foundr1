self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Network-first by default. This service worker exists so browsers can
  // recognize the site as an installable standalone app without caching APIs.
});
