import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { DELETE, GET, POST } from "../src/app/api/access/route.ts";
import { createSessionToken } from "../src/lib/server/session.js";

const originalFetch = globalThis.fetch;
const originalEnv = {};
const envKeys = [
  "NODE_ENV",
  "TRIP_CODE",
  "SESSION_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

describe("shared access route", () => {
  beforeEach(() => {
    for (const key of envKeys) originalEnv[key] = process.env[key];
    process.env.NODE_ENV = "test";
    process.env.TRIP_CODE = "shared-code";
    process.env.SESSION_SECRET = "route-test-session-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("checks the durable throttle with a source-address HMAC before unlocking", async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json(calls.length === 1
        ? { allowed: true, remaining: 4, blockedUntil: null }
        : { allowed: true, remaining: 5, blockedUntil: null });
    };

    const response = await POST(accessMutationRequest("POST", { code: "shared-code" }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: true });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/consume_access_attempt$/);
    assert.match(calls[1].url, /\/rest\/v1\/rpc\/reset_access_attempt$/);
    const consumeBody = JSON.parse(calls[0].options.body);
    assert.match(consumeBody.address_hash, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(calls[0].options.body, /203\.0\.113\.10/);
    assert.equal(calls[0].options.headers.apikey, "service-role-test-secret");
    assert.equal(calls[0].options.headers.Authorization, "Bearer service-role-test-secret");
    assert.match(response.headers.get("Set-Cookie"), /aussie_chill_session=/);
    assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
    assert.match(response.headers.get("Set-Cookie"), /SameSite=Lax/);
    assert.match(response.headers.get("Set-Cookie"), /Max-Age=2592000/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("uses one generic response for a wrong code and a blocked source", async () => {
    globalThis.fetch = async () => Response.json({ allowed: true, remaining: 3, blockedUntil: null });
    const wrong = await POST(accessMutationRequest("POST", { code: "wrong" }));
    const wrongBody = await wrong.json();

    globalThis.fetch = async () => Response.json({
      allowed: false,
      remaining: 0,
      blockedUntil: "2026-07-10T00:15:00.000Z",
    });
    const blocked = await POST(accessMutationRequest("POST", { code: "shared-code" }));

    assert.equal(wrong.status, blocked.status);
    assert.deepEqual(wrongBody, await blocked.json());
    assert.deepEqual(wrongBody, { error: "access_denied" });
    assert.equal(wrong.headers.has("Set-Cookie"), false);
    assert.equal(blocked.headers.has("Set-Cookie"), false);
  });

  it("reports only whether the signed session is authenticated", async () => {
    const unauthenticated = await GET(new Request("https://aussie.example/api/access"));
    const token = createSessionToken(process.env.SESSION_SECRET);
    const authenticated = await GET(new Request("https://aussie.example/api/access", {
      headers: { Cookie: `aussie_chill_session=${token}` },
    }));

    assert.deepEqual(await unauthenticated.json(), { authenticated: false });
    assert.deepEqual(await authenticated.json(), { authenticated: true });
    assert.equal(unauthenticated.headers.get("Cache-Control"), "private, no-store");
    assert.equal(authenticated.headers.get("Cache-Control"), "private, no-store");
  });

  it("requires same-origin metadata when clearing a session", async () => {
    const rejected = await DELETE(new Request("https://aussie.example/api/access", {
      method: "DELETE",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    }));
    const cleared = await DELETE(accessMutationRequest("DELETE"));

    assert.equal(rejected.status, 403);
    assert.deepEqual(await rejected.json(), { error: "request_rejected" });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await cleared.json(), { authenticated: false });
    assert.match(cleared.headers.get("Set-Cookie"), /Max-Age=0/);
    assert.equal(cleared.headers.get("Cache-Control"), "private, no-store");
  });
});

function accessMutationRequest(method, body) {
  return new Request("https://aussie.example/api/access", {
    method,
    headers: {
      Origin: "https://aussie.example",
      "Sec-Fetch-Site": "same-origin",
      "X-Vercel-Forwarded-For": "203.0.113.10",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
