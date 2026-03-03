const CACHE_NAME = "10blocuri-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "10Blocuri", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(String(payload.title || "10Blocuri"), {
      body: String(payload.body || ""),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag || "default",
      renotify: true,
      data: { module: payload.module || null, url: payload.url || "/" },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const module = event.notification.data?.module;
  const url = module ? `${self.location.origin}/?module=${module}` : event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.focus();
          if (module) client.postMessage({ type: "NAVIGATE_MODULE", module });
          return null;
        }
      }
      return clients.openWindow(url);
    })
  );
});

