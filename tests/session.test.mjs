import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  readSessionConfig,
  sessionCookieOptions,
  timingSafeTripCodeEqual,
  verifySessionToken,
} from "../src/lib/server/session.js";

const secret = "test-session-secret-with-enough-entropy";
const now = Date.UTC(2026, 6, 10, 0, 0, 0);

describe("signed shared-trip session", () => {
  it("accepts an unchanged HMAC session inside the 30-day window", () => {
    const token = createSessionToken(secret, now);

    assert.equal(verifySessionToken(token, secret, now + 29 * 24 * 60 * 60 * 1000), true);
    assert.equal(SESSION_MAX_AGE_SECONDS, 2_592_000);
  });

  it("rejects a changed session token", () => {
    const token = createSessionToken(secret, now);
    const finalCharacter = token.at(-1) === "a" ? "b" : "a";
    const changed = `${token.slice(0, -1)}${finalCharacter}`;

    assert.equal(verifySessionToken(changed, secret, now), false);
  });

  it("rejects an expired session token", () => {
    const token = createSessionToken(secret, now);

    assert.equal(
      verifySessionToken(token, secret, now + (SESSION_MAX_AGE_SECONDS + 1) * 1000),
      false,
    );
  });

  it("compares equal and unequal trip codes without a length shortcut", () => {
    assert.equal(timingSafeTripCodeEqual("shared-code", "shared-code", secret), true);
    assert.equal(timingSafeTripCodeEqual("short", "a-much-longer-code", secret), false);

    const source = readFileSync(new URL("../src/lib/server/session.js", import.meta.url), "utf8");
    assert.match(source, /timingSafeEqual/);
  });

  it("has no production trip-code or session-secret fallback", () => {
    assert.throws(
      () => readSessionConfig({ NODE_ENV: "production", SESSION_SECRET: secret }),
      (error) => error?.code === "server_configuration_error",
    );
    assert.throws(
      () => readSessionConfig({ NODE_ENV: "production", TRIP_CODE: "shared-code" }),
      (error) => error?.code === "server_configuration_error",
    );
  });

  it("uses an HttpOnly 30-day same-site cookie", () => {
    assert.equal(SESSION_COOKIE_NAME, "aussie_chill_session");
    assert.deepEqual(sessionCookieOptions({ NODE_ENV: "production" }), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    assert.equal(sessionCookieOptions({ NODE_ENV: "test" }).secure, false);
  });

  it("marks every secret-reading session module as server-only", () => {
    const source = readFileSync(new URL("../src/lib/server/session.js", import.meta.url), "utf8");
    assert.match(source, /^import ["']server-only["'];/m);
    assert.doesNotMatch(source, /NEXT_PUBLIC_TRIP_CODE|\|\|\s*["']aussie["']/);
  });
});
