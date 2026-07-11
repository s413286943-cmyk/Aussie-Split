import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  ReceiptNotFoundError,
  ReceiptObjectMissingError,
  ReceiptVerificationError,
  cleanupReceipts,
  createReceiptUpload,
  fetchReceiptDownload,
  finalizeReceiptUpload,
} from "../src/lib/server/receipts.js";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("private receipt server transport", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("SUPABASE_URL", originalUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalServiceRole);
  });

  it("records a pending intent before issuing a signed PUT token", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/rest/v1/rpc/create_receipt_upload_intent")) {
        return Response.json(attachmentRow());
      }
      if (String(url).includes("/storage/v1/object/upload/sign/receipts/")) {
        return Response.json({
          url: "/object/upload/sign/receipts/expense-one/receipt-one-dinner.jpg?token=signed-token",
        });
      }
      return Response.json({ message: "unexpected request" }, { status: 500 });
    };

    const result = await createReceiptUpload(uploadMetadata());

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url.endsWith("/rest/v1/rpc/create_receipt_upload_intent"), true);
    assert.deepEqual(JSON.parse(calls[0].options.body), { receipt: uploadMetadata() });
    assert.match(calls[1].url, /\/storage\/v1\/object\/upload\/sign\/receipts\/expense-one\/receipt-one-dinner\.jpg$/);
    assert.equal(calls[0].options.headers.apikey, "service-role-test-secret");
    assert.equal(result.mode, "signed-put");
    assert.equal(
      result.signedUrl,
      "https://project.supabase.co/storage/v1/object/upload/sign/receipts/expense-one/receipt-one-dinner.jpg?token=signed-token",
    );
    assert.equal(result.token, "signed-token");
    assert.equal(result.storagePath, "expense-one/receipt-one-dinner.jpg");
  });

  it("returns a direct Storage TUS endpoint for files larger than six MiB", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/rest/v1/rpc/create_receipt_upload_intent")) {
        return Response.json(attachmentRow({ size_bytes: 6 * 1024 * 1024 + 1 }));
      }
      return Response.json({
        url: "/object/upload/sign/receipts/expense-one/receipt-one-dinner.jpg?token=tus-token",
      });
    };

    const result = await createReceiptUpload(uploadMetadata({
      sizeBytes: 6 * 1024 * 1024 + 1,
      uploadMode: "tus",
    }));

    assert.equal(result.mode, "tus");
    assert.equal(result.endpoint, "https://project.storage.supabase.co/storage/v1/upload/resumable");
    assert.equal(result.token, "tus-token");
    assert.equal(result.chunkSize, 6 * 1024 * 1024);
    assert.equal(result.bucketName, "receipts");
    assert.equal(result.objectName, "expense-one/receipt-one-dinner.jpg");
  });

  it("verifies exact object metadata before idempotently finalizing", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).includes("/rest/v1/attachments?")) return Response.json([attachmentRow()]);
      if (String(url).includes("/storage/v1/object/info/receipts/")) {
        return Response.json({ metadata: { size: 1024, mimetype: "image/jpeg" } });
      }
      if (String(url).endsWith("/rest/v1/rpc/finalize_receipt_upload")) {
        assert.deepEqual(JSON.parse(options.body), {
          requested_expense_id: "expense-one",
          requested_receipt_id: "receipt-one",
        });
        return Response.json(attachmentRow({ finalized_at: "2026-07-10T01:00:00.000Z" }));
      }
      return Response.json({ message: "unexpected request" }, { status: 500 });
    };

    const result = await finalizeReceiptUpload({ expenseId: "expense-one", receiptId: "receipt-one" });

    assert.equal(result.receiptId, "receipt-one");
    assert.equal(result.originalName, "Dinner.JPG");
    assert.equal(result.finalizedAt, "2026-07-10T01:00:00.000Z");
    assert.ok(calls.findIndex((url) => url.includes("/object/info/"))
      < calls.findIndex((url) => url.endsWith("/rpc/finalize_receipt_upload")));
  });

  it("accepts the current Storage info content_type response field", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/rest/v1/attachments?")) return Response.json([attachmentRow()]);
      if (String(url).includes("/storage/v1/object/info/receipts/")) {
        return Response.json({ size: 1024, content_type: "image/jpeg" });
      }
      if (String(url).endsWith("/rest/v1/rpc/finalize_receipt_upload")) {
        return Response.json(attachmentRow({ finalized_at: "2026-07-10T01:00:00.000Z" }));
      }
      return Response.json({ message: "unexpected request" }, { status: 500 });
    };

    const result = await finalizeReceiptUpload({ expenseId: "expense-one", receiptId: "receipt-one" });

    assert.equal(result.finalizedAt, "2026-07-10T01:00:00.000Z");
  });

  it("does not finalize when uploaded bytes do not match the pending intent", async () => {
    let finalized = false;
    const errors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => errors.push(args);
    globalThis.fetch = async (url) => {
      if (String(url).includes("/rest/v1/attachments?")) return Response.json([attachmentRow()]);
      if (String(url).includes("/storage/v1/object/info/receipts/")) {
        return Response.json({ metadata: { size: 1023, mimetype: "image/jpeg" } });
      }
      finalized = true;
      return Response.json({});
    };

    try {
      await assert.rejects(
        () => finalizeReceiptUpload({ expenseId: "expense-one", receiptId: "receipt-one" }),
        (error) => error instanceof ReceiptVerificationError && error.code === "receipt_verification_failed",
      );
      assert.equal(finalized, false);
      assert.deepEqual(errors, [["receipt_verification_mismatch", {
        expectedSize: 1024,
        actualSize: 1023,
        expectedMimeType: "image/jpeg",
        actualMimeType: "image/jpeg",
        objectKeys: ["metadata"],
        metadataKeys: ["mimetype", "size"],
      }]]);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("distinguishes a missing Storage object from a mismatched upload", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/rest/v1/attachments?")) return Response.json([attachmentRow()]);
      return Response.json({ message: "not found" }, { status: 404 });
    };

    await assert.rejects(
      () => finalizeReceiptUpload({ expenseId: "expense-one", receiptId: "receipt-one" }),
      (error) => error instanceof ReceiptObjectMissingError && error.code === "receipt_object_missing",
    );
  });

  it("returns a five-minute signed URL only for a finalized canonical receipt", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/rest/v1/attachments?")) {
        return Response.json([attachmentRow({ finalized_at: "2026-07-10T01:00:00.000Z" })]);
      }
      if (String(url).includes("/storage/v1/object/sign/receipts/")) {
        assert.deepEqual(JSON.parse(options.body), { expiresIn: 300 });
        return Response.json({ signedURL: "/object/sign/receipts/path?token=download-token" });
      }
      return Response.json({ message: "unexpected request" }, { status: 500 });
    };

    const result = await fetchReceiptDownload("expense-one", new Date("2026-07-10T02:00:00.000Z"));

    assert.equal(
      result.signedUrl,
      "https://project.supabase.co/storage/v1/object/sign/receipts/path?token=download-token",
    );
    assert.equal(result.expiresAt, "2026-07-10T02:05:00.000Z");
    assert.equal(result.receipt.originalName, "Dinner.JPG");
    assert.equal(calls.length, 2);
  });

  it("returns a typed not-found error without requesting a signed URL", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json([]);
    };

    await assert.rejects(
      () => fetchReceiptDownload("expense-missing"),
      (error) => error instanceof ReceiptNotFoundError && error.code === "receipt_not_found",
    );
    assert.equal(calls, 1);
  });

  it("rechecks cleanup claims immediately before deleting through the Storage API", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const call = { url: String(url), options };
      calls.push(call);
      if (call.url.endsWith("/rest/v1/rpc/claim_receipt_cleanup")) {
        return Response.json([
          cleanupCandidate("00000000-0000-0000-0000-000000000001", "delete-me.jpg"),
          cleanupCandidate("00000000-0000-0000-0000-000000000002", "restored.jpg"),
          cleanupCandidate("00000000-0000-0000-0000-000000000003", "delete-fails.jpg"),
        ]);
      }
      if (call.url.endsWith("/rest/v1/rpc/verify_receipt_cleanup_claim")) {
        const body = JSON.parse(options.body);
        if (body.requested_attachment_id.endsWith("0002")) return Response.json(null);
        return Response.json({
          id: body.requested_attachment_id,
          storage_path: body.requested_attachment_id.endsWith("0001")
            ? "expense-0001/delete-me.jpg"
            : "expense-0003/delete-fails.jpg",
        });
      }
      if (call.url.endsWith("/storage/v1/object/receipts")) {
        const [{ prefixes }] = [JSON.parse(options.body)];
        if (prefixes[0].endsWith("delete-fails.jpg")) {
          return Response.json({ message: "temporary failure" }, { status: 503 });
        }
        return Response.json([{ name: prefixes[0] }]);
      }
      if (call.url.endsWith("/rest/v1/rpc/finish_receipt_cleanup_claim")) {
        return Response.json(true);
      }
      return Response.json({ message: "unexpected request" }, { status: 500 });
    };

    const result = await cleanupReceipts({
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
      limit: 10,
    });

    assert.deepEqual(result, { claimed: 3, deleted: 1, skipped: 1, failed: 1 });
    const storageDeletes = calls.filter(({ url }) => url.endsWith("/storage/v1/object/receipts"));
    assert.equal(storageDeletes.length, 2);
    assert.equal(storageDeletes.every(({ options }) => options.method === "DELETE"), true);
    assert.deepEqual(JSON.parse(storageDeletes[0].options.body), {
      prefixes: ["expense-0001/delete-me.jpg"],
    });
    const firstVerify = calls.findIndex(({ url, options }) => (
      url.endsWith("/rpc/verify_receipt_cleanup_claim")
      && JSON.parse(options.body).requested_attachment_id.endsWith("0001")
    ));
    const firstDelete = calls.findIndex(({ url, options }) => (
      url.endsWith("/storage/v1/object/receipts")
      && JSON.parse(options.body).prefixes[0].endsWith("delete-me.jpg")
    ));
    const firstFinish = calls.findIndex(({ url, options }) => (
      url.endsWith("/rpc/finish_receipt_cleanup_claim")
      && JSON.parse(options.body).requested_attachment_id.endsWith("0001")
    ));
    assert.ok(firstVerify < firstDelete && firstDelete < firstFinish);
    assert.equal(JSON.parse(calls[firstFinish].options.body).mark_deleted, true);
    const failedRelease = calls.find(({ url, options }) => (
      url.endsWith("/rpc/finish_receipt_cleanup_claim")
      && JSON.parse(options.body).requested_attachment_id.endsWith("0003")
    ));
    assert.equal(JSON.parse(failedRelease.options.body).mark_deleted, false);
  });
});

function uploadMetadata(overrides = {}) {
  return {
    expenseId: "expense-one",
    receiptId: "receipt-one",
    originalName: "Dinner.JPG",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    storagePath: "expense-one/receipt-one-dinner.jpg",
    uploadMode: "signed-put",
    ...overrides,
  };
}

function attachmentRow(overrides = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    expense_id: "expense-one",
    receipt_id: "receipt-one",
    original_name: "Dinner.JPG",
    mime_type: "image/jpeg",
    size_bytes: 1024,
    storage_path: "expense-one/receipt-one-dinner.jpg",
    finalized_at: null,
    created_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function cleanupCandidate(attachmentId, name) {
  return {
    attachment_id: attachmentId,
    receipt_id: `receipt-${attachmentId.slice(-4)}`,
    expense_id: `expense-${attachmentId.slice(-4)}`,
    storage_path: `expense-${attachmentId.slice(-4)}/${name}`,
    cleanup_reason: "pending",
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
