import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { GET as getReceipt } from "../src/app/api/receipts/[expenseId]/route.ts";
import { POST as finalizeReceipt } from "../src/app/api/receipts/finalize/route.ts";
import { POST as createUploadUrl } from "../src/app/api/receipts/upload-url/route.ts";
import { createSessionToken } from "../src/lib/server/session.js";

const originalFetch = globalThis.fetch;
const originalEnv = {};
const envKeys = ["TRIP_CODE", "SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

describe("authenticated private receipt routes", () => {
  beforeEach(() => {
    for (const key of envKeys) originalEnv[key] = process.env[key];
    process.env.TRIP_CODE = "shared-code";
    process.env.SESSION_SECRET = "receipt-route-session-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) restoreEnv(key, originalEnv[key]);
  });

  it("rejects unauthenticated upload intent before reading the request body", async () => {
    let bodyRead = false;
    let serviceCalled = false;
    globalThis.fetch = async () => {
      serviceCalled = true;
      return Response.json({});
    };
    const request = {
      url: "https://aussie.example/api/receipts/upload-url",
      headers: new Headers({
        Origin: "https://aussie.example",
        "Sec-Fetch-Site": "same-origin",
      }),
      async json() {
        bodyRead = true;
        return uploadBody();
      },
    };

    const response = await createUploadUrl(request);

    assert.equal(response.status, 401);
    assert.equal(bodyRead, false);
    assert.equal(serviceCalled, false);
    assert.deepEqual(await response.json(), { error: "access_required" });
  });

  it("rejects cross-origin mutations and invalid file metadata before Storage is called", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({});
    };

    const crossOrigin = await createUploadUrl(authenticatedMutation(
      "https://aussie.example/api/receipts/upload-url",
      uploadBody(),
      { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    ));
    const invalid = await createUploadUrl(authenticatedMutation(
      "https://aussie.example/api/receipts/upload-url",
      uploadBody({ mimeType: "application/pdf" }),
    ));

    assert.equal(crossOrigin.status, 403);
    assert.equal(invalid.status, 400);
    assert.equal(calls, 0);
  });

  it("returns a private signed upload contract after recording the pending intent", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).endsWith("/rest/v1/rpc/create_receipt_upload_intent")) {
        const { receipt } = JSON.parse(options.body);
        return Response.json(attachmentRow(receipt));
      }
      return Response.json({
        url: "/object/upload/sign/receipts/expense-one/receipt-one-dinner.jpg?token=upload-token",
      });
    };

    const response = await createUploadUrl(authenticatedMutation(
      "https://aussie.example/api/receipts/upload-url",
      uploadBody(),
    ));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.mode, "signed-put");
    assert.equal(payload.token, "upload-token");
    assert.equal(payload.storagePath, "expense-one/receipt-one-dinner.jpg");
    assert.equal(calls[0].endsWith("/rpc/create_receipt_upload_intent"), true);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("maps an existing different receipt to a stable conflict response", async () => {
    globalThis.fetch = async () => Response.json({
      code: "23505",
      message: "receipt_conflict",
    }, { status: 409 });

    const response = await createUploadUrl(authenticatedMutation(
      "https://aussie.example/api/receipts/upload-url",
      uploadBody(),
    ));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "receipt_conflict" });
  });

  it("logs sanitized upstream details when a signed upload contract fails", async () => {
    const errors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => errors.push(args);
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/rest/v1/rpc/create_receipt_upload_intent")) {
        const { receipt } = JSON.parse(options.body);
        return Response.json(attachmentRow(receipt));
      }
      return Response.json({ code: "storage_code", message: "storage_message" }, { status: 400 });
    };

    try {
      const response = await createUploadUrl(authenticatedMutation(
        "https://aussie.example/api/receipts/upload-url",
        uploadBody(),
      ));

      assert.equal(response.status, 502);
      assert.deepEqual(errors, [["receipt_upload_failed", {
        name: "SupabaseUpstreamError",
        code: "supabase_upstream_error",
        status: 400,
        upstreamCode: "storage_code",
        upstreamMessage: "storage_message",
      }]]);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("verifies and finalizes a receipt through same-origin POST", async () => {
    globalThis.fetch = createFinalizationFetch();

    const response = await finalizeReceipt(authenticatedMutation(
      "https://aussie.example/api/receipts/finalize",
      { expenseId: "expense-one", receiptId: "receipt-one" },
    ));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.receipt.receiptId, "receipt-one");
    assert.equal(payload.receipt.finalizedAt, "2026-07-10T01:00:00.000Z");
  });

  it("does not claim success when the uploaded object fails verification", async () => {
    const errors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => errors.push(args);
    globalThis.fetch = createFinalizationFetch({ objectSize: 1000 });

    try {
      const response = await finalizeReceipt(authenticatedMutation(
        "https://aussie.example/api/receipts/finalize",
        { expenseId: "expense-one", receiptId: "receipt-one" },
      ));

      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "receipt_verification_failed" });
      assert.equal(errors[0]?.[0], "receipt_verification_mismatch");
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("returns a recoverable code when the pending Storage object is absent", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/rest/v1/attachments?")) return Response.json([attachmentRow()]);
      return Response.json({ message: "not found" }, { status: 404 });
    };

    const response = await finalizeReceipt(authenticatedMutation(
      "https://aussie.example/api/receipts/finalize",
      { expenseId: "expense-one", receiptId: "receipt-one" },
    ));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "receipt_object_missing" });
  });

  it("returns a five-minute private download URL and never caches it", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/rest/v1/attachments?")) {
        return Response.json([attachmentRow(uploadMetadata(), {
          finalized_at: "2026-07-10T01:00:00.000Z",
        })]);
      }
      return Response.json({ signedURL: "/object/sign/receipts/path?token=download-token" });
    };

    const request = authenticatedRequest("https://aussie.example/api/receipts/expense-one");
    const response = await getReceipt(request, {
      params: Promise.resolve({ expenseId: "expense-one" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.receipt.originalName, "Dinner.JPG");
    assert.match(payload.signedUrl, /token=download-token/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("returns 404 for an expense without a finalized receipt", async () => {
    globalThis.fetch = async () => Response.json([]);

    const response = await getReceipt(
      authenticatedRequest("https://aussie.example/api/receipts/expense-missing"),
      { params: Promise.resolve({ expenseId: "expense-missing" }) },
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "receipt_not_found" });
  });
});

function authenticatedRequest(url, init = {}) {
  const token = createSessionToken(process.env.SESSION_SECRET);
  return new Request(url, {
    ...init,
    headers: {
      Cookie: `aussie_chill_session=${token}`,
      ...(init.headers || {}),
    },
  });
}

function authenticatedMutation(url, body, headers = {}) {
  return authenticatedRequest(url, {
    method: "POST",
    headers: {
      Origin: "https://aussie.example",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function uploadBody(overrides = {}) {
  return {
    expenseId: "expense-one",
    receiptId: "receipt-one",
    originalName: "Dinner.JPG",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    ...overrides,
  };
}

function uploadMetadata() {
  return {
    ...uploadBody(),
    storagePath: "expense-one/receipt-one-dinner.jpg",
    uploadMode: "signed-put",
  };
}

function attachmentRow(metadata = uploadMetadata(), overrides = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    expense_id: metadata.expenseId,
    receipt_id: metadata.receiptId,
    original_name: metadata.originalName,
    mime_type: metadata.mimeType,
    size_bytes: metadata.sizeBytes,
    storage_path: metadata.storagePath,
    finalized_at: null,
    deleted_at: null,
    created_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function createFinalizationFetch({ objectSize = 1024 } = {}) {
  return async (url) => {
    if (String(url).includes("/rest/v1/attachments?")) return Response.json([attachmentRow()]);
    if (String(url).includes("/storage/v1/object/info/")) {
      return Response.json({ metadata: { size: objectSize, mimetype: "image/jpeg" } });
    }
    if (String(url).endsWith("/rest/v1/rpc/finalize_receipt_upload")) {
      return Response.json(attachmentRow(uploadMetadata(), {
        finalized_at: "2026-07-10T01:00:00.000Z",
      }));
    }
    return Response.json({ message: "unexpected request" }, { status: 500 });
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
