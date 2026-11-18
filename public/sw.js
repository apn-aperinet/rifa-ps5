const CACHE = "rifa-v1";
const STATIC = ["/", "/index.html", "/style.css", "/app.js", "/manifest.json", "/pagamento.html", "/pagamento.js", "/verificar.html", "/verificar.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network-first for API, cache-first for static assets
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ error: "Offline" }), { headers: { "Content-Type": "application/json" } })));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then(ch => ch.put(e.request, c)); }
    return res;
  })));
});
