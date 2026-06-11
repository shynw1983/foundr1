self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith((async () => {
    try {
      return await fetch(event.request);
    } catch {
      return new Response(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Foundr1 OS</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2937;background:#fff}
      main{max-width:360px;padding:24px;text-align:center}
      h1{font-size:20px;margin:0 0 10px}
      p{margin:0 0 18px;color:#667085;line-height:1.6}
      button{appearance:none;border:0;border-radius:12px;background:#14745f;color:#fff;font-weight:700;padding:12px 18px}
    </style>
  </head>
  <body>
    <main>
      <h1>ページを読み込めません</h1>
      <p>通信状態を確認して、もう一度読み込んでください。</p>
      <button onclick="location.reload()">再読み込み</button>
    </main>
  </body>
</html>`, {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }
  })());
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
