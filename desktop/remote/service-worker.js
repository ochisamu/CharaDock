// SPDX-License-Identifier: Apache-2.0
const SHELL_CACHE = "charadock-link-v0.3.0-1";
const SHELL_ASSETS = ["/", "/remote.css", "/audio-envelope.js", "/remote.js", "/manifest.webmanifest", "/app-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith("charadock-link-") && key !== SHELL_CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request)
    .then((response) => {
      if (response.ok && SHELL_ASSETS.includes(url.pathname)) {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })
    .catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") return caches.match("/");
      return Response.error();
    }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: "notification-open", tag: event.notification.tag || "" });
      return;
    }
    await self.clients.openWindow("/");
  }));
});
