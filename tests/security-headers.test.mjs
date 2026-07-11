import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config.ts";

test("serves browser security headers on every application route", async () => {
  assert.equal(typeof nextConfig.headers, "function");

  const rules = await nextConfig.headers();
  const applicationRule = rules.find((rule) => rule.source === "/:path*");
  assert.ok(applicationRule, "missing all-route security header rule");

  const headers = new Map(
    applicationRule.headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(
    headers.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=()",
  );
  assert.equal(
    headers.get("strict-transport-security"),
    "max-age=63072000; includeSubDomains; preload",
  );
});
