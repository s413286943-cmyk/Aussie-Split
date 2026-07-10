import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const serviceWorkerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const registrationSource = readFileSync(
  new URL("../src/components/ServiceWorkerRegistration.tsx", import.meta.url),
  "utf8",
);
const manifestSource = readFileSync(new URL("../src/app/manifest.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

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

  it("registers the worker from the root layout", () => {
    assert.match(registrationSource, /navigator\.serviceWorker\.register\(["']\/sw\.js["']/);
    assert.match(registrationSource, /window\.addEventListener\(["']load["']/);
    assert.match(layoutSource, /ServiceWorkerRegistration/);
    assert.match(layoutSource, /<ServiceWorkerRegistration\s*\/>/);
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
