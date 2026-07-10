const CACHE_PREFIX = "aussie-chill-";
const SHELL_CACHE = CACHE_PREFIX + "shell-v2";
const STATIC_CACHE = CACHE_PREFIX + "static-v2";
const ITINERARY_CACHE = CACHE_PREFIX + "itinerary-v1";
const PRECACHE_URLS = [
  "/",
  "/itinerary",
  "/expenses",
  "/add",
  "/settlement",
  "/activity",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheApplicationShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && ![
            SHELL_CACHE,
            STATIC_CACHE,
            ITINERARY_CACHE,
          ].includes(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (url.pathname.startsWith("/itinerary/")) {
    event.respondWith(staleWhileRevalidate(request, ITINERARY_CACHE));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true })
      || await caches.match(new URL(request.url).pathname, { ignoreSearch: true })
      || await caches.match("/");
    if (cached) return cached;
    throw error;
  }
}

async function precacheApplicationShell() {
  const [shellCache, staticCache] = await Promise.all([
    caches.open(SHELL_CACHE),
    caches.open(STATIC_CACHE),
  ]);
  const staticAssetUrls = new Set();

  await Promise.all(PRECACHE_URLS.map(async (url) => {
    const response = await fetch(url, { cache: "reload" });
    if (!response.ok) throw new Error(`Unable to pre-cache ${url}`);
    await shellCache.put(url, response.clone());

    if (response.headers.get("content-type")?.includes("text/html")) {
      const html = await response.clone().text();
      for (const assetUrl of extractStaticAssetUrls(html)) staticAssetUrls.add(assetUrl);
    }
  }));

  await staticCache.addAll([...staticAssetUrls]);
}

function extractStaticAssetUrls(html) {
  const urls = [];
  const pattern = /(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g;
  for (const match of html.matchAll(pattern)) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin) urls.push(`${url.pathname}${url.search}`);
  }
  return urls;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  return cached || network;
}
