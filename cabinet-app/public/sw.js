// Service worker : permet d'OUVRIR l'application sans réseau (coquilles des pages
// et fichiers statiques). Les données et les photos ne passent jamais par ce cache :
// les photos en attente sont dans IndexedDB, les appels /api et Supabase sont
// toujours envoyés au réseau.
const CACHE = "fiches-shell-v1";
const PAGES = ["/", "/scan", "/login", "/patients", "/patient", "/document", "/dashboard", "/securite"];

async function precache() {
  const cache = await caches.open(CACHE);
  const assets = new Set(["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"]);
  for (const page of PAGES) {
    try {
      const res = await fetch(page, { cache: "reload", credentials: "same-origin" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await cache.put(page, res);
      for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(m[0]);
    } catch { /* hors ligne pendant l'installation : on réessaiera */ }
  }
  await Promise.all([...assets].map((a) => cache.add(a).catch(() => undefined)));
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(png|webmanifest)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  if (req.mode === "navigate") {
    // Réseau d'abord (version à jour), cache en secours (hors connexion).
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(url.pathname, res.clone());
        return res;
      } catch {
        return (await cache.match(url.pathname)) || (await cache.match("/")) || Response.error();
      }
    })());
  }
});
