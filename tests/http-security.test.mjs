import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RequestSecurityError,
  assertSameOriginMutation,
  authenticationRequiredResponse,
  privateJsonResponse,
} from "../src/lib/server/http.js";

function mutationRequest(headers = {}) {
  return new Request("https://aussie.example/api/sync", {
    method: "POST",
    headers,
  });
}

describe("server request boundary", () => {
  it("accepts a mutation carrying strict same-origin browser metadata", () => {
    const request = mutationRequest({
      Origin: "https://aussie.example",
      "Sec-Fetch-Site": "same-origin",
    });

    assert.doesNotThrow(() => assertSameOriginMutation(request));
  });

  it("rejects a cross-origin mutation", () => {
    const request = mutationRequest({
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "same-origin",
    });

    assert.throws(
      () => assertSameOriginMutation(request),
      (error) => error instanceof RequestSecurityError && error.code === "invalid_origin",
    );
  });

  it("rejects a request explicitly marked cross-site", () => {
    const request = mutationRequest({
      Origin: "https://aussie.example",
      "Sec-Fetch-Site": "cross-site",
    });

    assert.throws(
      () => assertSameOriginMutation(request),
      (error) => error instanceof RequestSecurityError && error.code === "invalid_origin",
    );
  });

  it("rejects mutations missing same-origin metadata", () => {
    assert.throws(
      () => assertSameOriginMutation(mutationRequest()),
      (error) => error instanceof RequestSecurityError && error.code === "invalid_origin",
    );
  });

  it("marks access and data responses private and non-cacheable", async () => {
    for (const response of [
      privateJsonResponse({ authenticated: true }),
      privateJsonResponse({ expenses: [] }),
      authenticationRequiredResponse(),
    ]) {
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal(response.headers.get("Pragma"), "no-cache");
    }
  });

  it("returns one generic authentication error", async () => {
    const response = authenticationRequiredResponse();

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "access_required" });
  });
});
