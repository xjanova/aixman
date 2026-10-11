// Bump the name whenever cached files must go: activate drops every cache
// under another name. v3 clears the studio tab art and icons that v2 kept
// forever under their old file names.
const CACHE_NAME = "xman-ai-v3";
const PRECACHE_URLS = ["/", "/manifest.json", "/logo.webp", "/favicon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Other sites (generated media on R2, fonts) and partial requests (video
  // seeking) are the browser's own business.
  if (url.origin !== self.location.origin || request.headers.has("range")) return;

  // Network-first for API and HTML pages
  if (url.pathname.startsWith("/api/") || request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Build output carries a content hash in its name, so a cached copy is
  // never out of date.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Everything else (files in public/, /_next/image) can be replaced under
  // the same name: answer from the cache when there is a copy, and fetch a
  // fresh one behind it for next time.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok && response.status === 200) cache.put(request, response.clone());
          return response;
        });
        if (cached) {
          event.waitUntil(network.catch(() => undefined));
          return cached;
        }
        return network;
      })
    )
  );
});
