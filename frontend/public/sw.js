// ─── FlyndMe Service Worker ─────────────────────────────────────────────────
// Solo se registra en producción (App.jsx: import.meta.env.PROD) — en dev
// causó pantallas en blanco (regla dura #5).
//
// Estrategias por tipo de recurso:
//   · API (/api/*, precios, OG)        → SIEMPRE red, nunca se cachea (datos vivos)
//   · Fuentes (IBM Plex vía Google)    → Cache-First (fonts.googleapis/gstatic)
//   · Estáticos propios (js/css/img…)  → Cache-First (los de Vite llevan hash)
//   · Páginas SEO (/quedar/, /meet/)   → Network-First con respaldo en caché
//   · Navegación de la SPA             → Network-First con respaldo a index.html
//   · Otros orígenes (fotos, analítica)→ sin tocar
//
// v5 (sep-2026): paleta terminal v2 + logo con punto naranja + iconos
// maskable. v6: acento amarillo de señalética + logo amarillo. v7: iconos
// y logo con ?v=6 (fuerza el logo nuevo) + aviso de versión nueva en la app.
// Subir la versión purga los caches viejos en 'activate'.
const VERSION = "v7";
const STATIC_CACHE = `flyndme-static-${VERSION}`;
const FONT_CACHE = "flyndme-fonts-v1";
const PAGES_CACHE = `flyndme-pages-${VERSION}`;
const KEEP = [STATIC_CACHE, FONT_CACHE, PAGES_CACHE];

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/logo-flyndme.svg?v=6",
  "/favicon.svg?v=6",
  "/favicon.ico?v=6",
  "/favicon-32.png?v=6",
  "/icon-192.png?v=6",
  "/icon-512.png?v=6",
  "/icon-maskable-512.png?v=6",
  "/apple-touch-icon.png?v=6",
];

const STATIC_RE = /\.(?:js|css|svg|png|jpg|jpeg|webp|ico|woff2?|json|webmanifest)$/i;
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const SEO_RE = /^\/(?:quedar|meet)\//;

self.addEventListener("install", (event) => {
  event.waitUntil(
    // addAll falla entero si un recurso falla: se precachea uno a uno para que
    // un icono ausente no deje la PWA sin shell.
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Opaque (no-cors, p.ej. la CSS de Google Fonts) también vale para fuentes.
  if (response && (response.ok || response.type === "opaque")) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Fuentes tipográficas (otro origen): Cache-First
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Cualquier otro origen (fotos de ciudad, logos de aerolínea, analítica,
  // backend de Render): no se toca.
  if (url.origin !== self.location.origin) return;

  // Datos vivos: precios, compartir, OG. Nunca desde caché. Tampoco los
  // scripts de Vercel (analítica), que deben poder actualizarse.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/_vercel")) return;

  // Páginas SEO pre-generadas: Network-First con respaldo en caché
  if (request.mode === "navigate" && SEO_RE.test(url.pathname)) {
    event.respondWith(networkFirst(request, PAGES_CACHE, "/index.html"));
    return;
  }

  // Navegación de la SPA: Network-First con respaldo al shell. Se guarda
  // UNA sola copia (/index.html), no una por URL con query (?share=, ?group=).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match("/index.html")) || Response.error())
    );
    return;
  }

  // Estáticos propios: Cache-First
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});
