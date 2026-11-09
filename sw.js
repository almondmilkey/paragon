// Paragon service worker: makes the app installable and lets it open without a connection.
// Bump VERSION whenever you publish changes so phones pick up the new files.
const VERSION = "paragon-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest",
  "vendor/supabase-2.118.0.js", "icons/icon-192.png", "icons/icon-512.png", "icons/logo.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Own files: network first, cached copy when offline. Requests to Supabase are never cached.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
