// Service worker mínimo para abrir la app sin conexión (sobre todo la lista de la compra).
// El build (scripts/vite-sw.ts) sustituye VERSION y PRECACHE; cada build es una caché nueva.
//
// - Navegación: primero la red (3 s como mucho); si no llega, el index.html guardado.
// - /assets/*: primero la caché (llevan hash en el nombre, no cambian).
// - /api/*: nunca se guarda.
// - Solo se guardan respuestas 200 del mismo origen: las redirecciones al login de
//   Cloudflare Access pasan tal cual y no se guardan nunca.

const VERSION = "dev";
const PRECACHE = /* __SW_PRECACHE__ */ [];
const PREFIX = "menu-familiar-";
const CACHE = `${PREFIX}${VERSION}`;
const NAVIGATION_TIMEOUT_MS = 3000;

const cacheable = (res) => res.status === 200 && res.type === "basic" && !res.redirected;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        ["/", ...PRECACHE].map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache", redirect: "manual" });
            if (cacheable(res)) await cache.put(url, res);
          } catch {
            // Sin red o sin sesión de Access: se guardará al usarse.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") event.respondWith(navigation(event));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(cacheFirst(req));
  else event.respondWith(networkFirst(req));
});

async function navigation(event) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(async (res) => {
    if (cacheable(res) && (res.headers.get("content-type") ?? "").includes("text/html")) await cache.put("/", res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => undefined));
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // sin red: se usa la copia
  }
  return (await cache.match("/")) ?? network;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (cacheable(res)) await cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}
