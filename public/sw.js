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

self.addEventListener("push", (event) => {
  const fallback = {
    title: "Foundr1 OS",
    body: "新しい通知があります。",
    href: "/os"
  };
  const payload = event.data ? (() => {
    try {
      return event.data.json();
    } catch {
      return { ...fallback, body: event.data.text() };
    }
  })() : fallback;

  const title = payload.title || fallback.title;
  const options = {
    body: payload.body || payload.message || fallback.body,
    tag: `${payload.type || "foundr1_notification"}:${payload.sentAt || Date.now()}`,
    renotify: true,
    timestamp: payload.sentAt ? Date.parse(payload.sentAt) : Date.now(),
    data: {
      href: payload.href || fallback.href
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "/os";
  const targetUrl = new URL(href, self.location.origin).href;

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const sameOriginClient = windowClients.find((client) => new URL(client.url).origin === self.location.origin);
    if (sameOriginClient) {
      await sameOriginClient.navigate(targetUrl);
      return sameOriginClient.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});
