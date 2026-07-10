import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

const serviceWorkerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const registrationSource = readFileSync(
  new URL("../src/components/ServiceWorkerRegistration.tsx", import.meta.url),
  "utf8",
);
const manifestSource = readFileSync(new URL("../src/app/manifest.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const nextConfigSource = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

describe("offline application shell", () => {
  it("pre-caches every high-frequency route and the manifest", () => {
    for (const route of [
      "/",
      "/itinerary",
      "/expenses",
      "/add",
      "/settlement",
      "/activity",
      "/manifest.webmanifest",
    ]) {
      assert.match(serviceWorkerSource, new RegExp("[\"']" + escapeRegExp(route) + "[\"']"));
    }
  });

  it("pre-caches the rendered Next static dependencies needed to hydrate offline", () => {
    assert.match(serviceWorkerSource, /precacheApplicationShell/);
    assert.match(serviceWorkerSource, /extractStaticAssetUrls/);
    assert.match(serviceWorkerSource, /response\.clone\(\)\.text\(\)/);
    assert.match(serviceWorkerSource, /caches\.open\(STATIC_CACHE\)/);
    assert.match(serviceWorkerSource, /staticCache\.addAll/);
  });

  it("keeps API requests network-only and uses explicit route strategies", () => {
    assert.match(serviceWorkerSource, /url\.pathname\.startsWith\(["']\/api\/["']\)/);
    assert.match(serviceWorkerSource, /request\.mode === ["']navigate["']/);
    assert.match(serviceWorkerSource, /url\.pathname\.startsWith\(["']\/_next\/static\/["']\)/);
    assert.match(serviceWorkerSource, /url\.pathname === ["']\/_next\/image["']/);
    assert.match(serviceWorkerSource, /url\.pathname\.startsWith\(["']\/itinerary\/["']\)/);
    assert.match(serviceWorkerSource, /networkFirst/);
    assert.match(serviceWorkerSource, /cacheFirst/);
    assert.match(serviceWorkerSource, /staleWhileRevalidate/);
    assert.doesNotMatch(serviceWorkerSource, /skipWaiting\(\)/);
  });

  it("activates a new cache without retaining obsolete application shells", () => {
    assert.match(serviceWorkerSource, /self\.addEventListener\(["']activate["']/);
    assert.match(serviceWorkerSource, /caches\.keys\(\)/);
    assert.match(serviceWorkerSource, /clients\.claim\(\)/);
  });

  it("stages a failed update in release-specific caches without mutating the active release", async () => {
    const cacheStorage = createMemoryCacheStorage();
    const active = createWorkerRuntime("release-a", cacheStorage);
    await dispatchWorkerEvent(active, "install");
    const before = await snapshotCaches(cacheStorage);

    const update = createWorkerRuntime("release-b", cacheStorage, { failUrl: "/settlement" });
    await assert.rejects(dispatchWorkerEvent(update, "install"), /Unable to pre-cache \/settlement/);
    const after = await snapshotCaches(cacheStorage);

    for (const [cacheName, entries] of Object.entries(before)) {
      assert.match(cacheName, /release-a/);
      assert.deepEqual(after[cacheName], entries);
    }
    assert.ok(Object.keys(after).some((cacheName) => cacheName.includes("release-b")));
  });

  it("registers the worker from the root layout", () => {
    assert.match(registrationSource, /navigator\.serviceWorker\.register\(`\/sw\.js\?release=\$\{encodeURIComponent\(release\)\}`\)/);
    assert.match(registrationSource, /window\.addEventListener\(["']load["']/);
    assert.match(layoutSource, /ServiceWorkerRegistration/);
    assert.match(layoutSource, /AUSSIE_BUILD_RELEASE/);
    assert.match(layoutSource, /<ServiceWorkerRegistration\s+release=\{serviceWorkerRelease\}\s*\/>/);
  });

  it("generates a distinct build release even outside Vercel", () => {
    assert.match(nextConfigSource, /randomUUID\(\)/);
    assert.match(nextConfigSource, /AUSSIE_BUILD_RELEASE/);
    assert.match(layoutSource, /process\.env\.AUSSIE_BUILD_RELEASE/);
    assert.doesNotMatch(layoutSource, /\|\|\s*["']development["']/);
  });

  it("publishes a standalone Chinese travel-ledger manifest", () => {
    assert.match(manifestSource, /name:\s*["']Aussie Chill["']/);
    assert.match(manifestSource, /display:\s*["']standalone["']/);
    assert.match(manifestSource, /start_url:\s*["']\/["']/);
    assert.match(manifestSource, /lang:\s*["']zh-CN["']/);
    assert.match(manifestSource, /\/icons\/aussie-chill-192\.png/);
    assert.match(manifestSource, /\/icons\/aussie-chill-512\.png/);
  });
});

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function createWorkerRuntime(release, cacheStorage, options = {}) {
  const listeners = new Map();
  const origin = "https://aussie.example";
  const self = {
    location: {
      href: `${origin}/sw.js?release=${release}`,
      origin,
    },
    clients: { claim: async () => undefined },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const fetch = async (request) => {
    const url = new URL(typeof request === "string" ? request : request.url, origin);
    if (url.pathname === options.failUrl) return new Response("failed", { status: 503 });
    return new Response(`${release}:${url.pathname}`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  cacheStorage.setFetch(fetch);
  vm.runInNewContext(serviceWorkerSource, {
    URL,
    Set,
    Promise,
    Error,
    Response,
    caches: cacheStorage,
    fetch,
    self,
  });
  return { listeners };
}

async function dispatchWorkerEvent(runtime, type) {
  let pending;
  runtime.listeners.get(type)({
    waitUntil(value) {
      pending = Promise.resolve(value);
    },
  });
  return pending;
}

function createMemoryCacheStorage() {
  const stores = new Map();
  let fetchImplementation;
  return {
    setFetch(value) {
      fetchImplementation = value;
    },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(request, response) {
          store.set(requestKey(request), response.clone());
        },
        async match(request) {
          return store.get(requestKey(request))?.clone();
        },
        async addAll(urls) {
          for (const url of urls) {
            const response = await fetchImplementation(url);
            if (!response.ok) throw new Error(`Unable to cache ${url}`);
            store.set(requestKey(url), response.clone());
          }
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(request) {
      for (const store of stores.values()) {
        const response = store.get(requestKey(request));
        if (response) return response.clone();
      }
      return undefined;
    },
    stores,
  };
}

async function snapshotCaches(cacheStorage) {
  const snapshot = {};
  for (const [cacheName, entries] of cacheStorage.stores) {
    snapshot[cacheName] = {};
    for (const [key, response] of entries) {
      snapshot[cacheName][key] = await response.clone().text();
    }
  }
  return snapshot;
}

function requestKey(request) {
  return typeof request === "string" ? request : request.url;
}
