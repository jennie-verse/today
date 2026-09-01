// Keep VERSION in step with APP_BUILD in ./src/version.js.
const VERSION = "2026.09.01-journal-session1";
const CACHE_NAME = `today-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/app.css",
  "./assets/fonts/lexend-400.woff2",
  "./assets/fonts/lexend-700.woff2",
  "./src/app.js",
  "./src/version.js",
  "./src/model.js",
  "./src/nlp-date.js",
  "./src/store.js",
  "./src/sync.js",
  "./src/sync-runner.js",
  "./src/journal.js",
  "./src/journal-record.js",
  "./src/backup.js",
  "./src/settings.js",
  "./src/ui.js",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Shared modules live in another repository but on the same origin, so they
// can be cached. Added one by one rather than with addAll: a single failure
// there must not stop the whole app from installing.
const OPTIONAL_ASSETS = [
  "../shared/v1/sync.js",
  "../shared/v2/journal.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await Promise.all(OPTIONAL_ASSETS.map(async (path) => {
      try { await cache.add(new URL(path, self.registration.scope)); }
      catch { /* the fetch handler caches it on a later run */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("today-") && key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Cross-origin requests (Journal talks to https://api.github.com) are left
  // entirely alone — see loom's sw.js for why answering those from cache is
  // dangerous (reads would fail while writes still went through).
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    } catch {
      if (request.mode === "navigate") {
        return (await cache.match("./index.html")) || Response.error();
      }
      return Response.error();
    }
  })());
});
