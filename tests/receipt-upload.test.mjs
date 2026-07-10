import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  startResumableReceiptUpload,
  uploadReceiptRecord,
} from "../src/lib/receiptUpload.js";

describe("browser receipt upload", () => {
  it("uploads a small Blob with the signed contract before finalizing", async () => {
    const calls = [];
    let finalizeCalls = 0;
    const record = receiptRecord();
    const result = await uploadReceiptRecord(record, {
      async createUploadContract(metadata) {
        calls.push({ type: "contract", metadata });
        return {
          mode: "signed-put",
          signedUrl: "https://storage.example/signed?token=one",
          storagePath: "expense-one/receipt-one-receipt.png",
        };
      },
      async fetch(url, options) {
        calls.push({ type: "upload", url, options });
        return new Response(null, { status: 200 });
      },
      async finalize(metadata) {
        calls.push({ type: "finalize", metadata });
        finalizeCalls += 1;
        if (finalizeCalls === 1) throw { serverCode: "receipt_not_found" };
        return { receipt: { receiptId: metadata.receiptId, finalizedAt: "now" } };
      },
    });

    assert.deepEqual(calls.map(({ type }) => type), ["finalize", "contract", "upload", "finalize"]);
    assert.deepEqual(calls[1].metadata, {
      expenseId: "expense-one",
      receiptId: "receipt-one",
      originalName: "Receipt.png",
      mimeType: "image/png",
      sizeBytes: 13,
    });
    assert.equal(calls[2].options.method, "PUT");
    assert.equal(calls[2].options.headers["x-upsert"], "false");
    assert.equal(calls[2].options.body instanceof FormData, true);
    assert.equal(result.receipt.receiptId, "receipt-one");
  });

  it("uses a six MiB TUS upload with the scoped signature for a large Blob", async () => {
    const calls = [];
    const record = receiptRecord({
      blob: new Blob([new Uint8Array(6 * 1024 * 1024 + 1)], { type: "image/jpeg" }),
      originalName: "Large.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 6 * 1024 * 1024 + 1,
    });

    await uploadReceiptRecord(record, {
      async createUploadContract() {
        return {
          mode: "tus",
          endpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable",
          token: "scoped-token",
          chunkSize: 6 * 1024 * 1024,
          bucketName: "receipts",
          objectName: "expense-one/receipt-one-large.jpg",
        };
      },
      async startTusUpload(blob, contract, metadata) {
        calls.push({ blob, contract, metadata });
      },
      async finalize() {
        if (!calls.length) throw { serverCode: "receipt_object_missing" };
        return { receipt: { receiptId: "receipt-one" } };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].blob.size, 6 * 1024 * 1024 + 1);
    assert.equal(calls[0].contract.token, "scoped-token");
    assert.equal(calls[0].contract.chunkSize, 6 * 1024 * 1024);
    assert.equal(calls[0].metadata.contentType, "image/jpeg");
  });

  it("does not finalize after a failed direct upload", async () => {
    let finalizeCalls = 0;
    await assert.rejects(() => uploadReceiptRecord(receiptRecord(), {
      async createUploadContract() {
        return { mode: "signed-put", signedUrl: "https://storage.example/signed" };
      },
      async fetch() {
        return new Response(null, { status: 503 });
      },
      async finalize() {
        finalizeCalls += 1;
        throw { serverCode: "receipt_not_found" };
      },
    }), /receipt upload failed/i);
    assert.equal(finalizeCalls, 1);
  });

  it("does not finalize after a failed resumable upload", async () => {
    let finalizeCalls = 0;
    await assert.rejects(() => uploadReceiptRecord(receiptRecord(), {
      async createUploadContract() {
        return {
          mode: "tus",
          endpoint: "https://storage.example/resumable",
          token: "token",
          chunkSize: 6 * 1024 * 1024,
          bucketName: "receipts",
          objectName: "expense-one/receipt-one-receipt.png",
        };
      },
      async startTusUpload() {
        throw new Error("offline");
      },
      async finalize() {
        finalizeCalls += 1;
        throw { serverCode: "receipt_not_found" };
      },
    }), /offline/);
    assert.equal(finalizeCalls, 1);
  });

  it("recovers a completed upload by finalizing before requesting another token", async () => {
    let contractCalls = 0;
    let uploadCalls = 0;
    const result = await uploadReceiptRecord(receiptRecord(), {
      async finalize(metadata) {
        return { receipt: { receiptId: metadata.receiptId, finalizedAt: "now" } };
      },
      async createUploadContract() {
        contractCalls += 1;
      },
      async fetch() {
        uploadCalls += 1;
      },
    });

    assert.equal(result.receipt.finalizedAt, "now");
    assert.equal(contractCalls, 0);
    assert.equal(uploadCalls, 0);
  });

  it("does not upload after an ambiguous finalize failure", async () => {
    let contractCalls = 0;
    await assert.rejects(() => uploadReceiptRecord(receiptRecord(), {
      async finalize() {
        throw new Error("gateway timeout");
      },
      async createUploadContract() {
        contractCalls += 1;
      },
    }), /gateway timeout/);
    assert.equal(contractCalls, 0);
  });

  it("resumes a persisted TUS upload after a page reopen", async () => {
    const events = [];
    class FakeUpload {
      constructor(blob, options) {
        this.blob = blob;
        this.options = options;
        events.push(["construct", blob.size]);
      }

      async findPreviousUploads() {
        events.push(["fingerprint", await this.options.fingerprint(this.blob)]);
        return [{ uploadUrl: "https://storage.example/resume-one" }];
      }

      resumeFromPreviousUpload(previous) {
        events.push(["resume", previous.uploadUrl]);
      }

      start() {
        events.push(["start"]);
        this.options.onSuccess();
      }
    }

    const contract = {
      endpoint: "https://storage.example/resumable",
      token: "token",
      chunkSize: 6 * 1024 * 1024,
      bucketName: "receipts",
      objectName: "expense-one/receipt-one-large.jpg",
    };
    await startResumableReceiptUpload(
      new Blob(["large"], { type: "image/jpeg" }),
      contract,
      { contentType: "image/jpeg" },
      FakeUpload,
    );

    assert.deepEqual(events, [
      ["construct", 5],
      ["fingerprint", "aussie-receipt:expense-one/receipt-one-large.jpg"],
      ["resume", "https://storage.example/resume-one"],
      ["start"],
    ]);
  });

  it("adopts a finalized remote receipt instead of retrying a conflicting Blob forever", async () => {
    let uploadCalls = 0;
    const result = await uploadReceiptRecord(receiptRecord(), {
      async finalize() {
        throw { serverCode: "receipt_not_found" };
      },
      async createUploadContract() {
        throw { serverCode: "receipt_conflict" };
      },
      async fetchExistingReceipt(expenseId) {
        return {
          receipt: {
            expenseId,
            receiptId: "receipt-remote",
            originalName: "remote.jpg",
            storagePath: "expense-one/receipt-remote-remote.jpg",
            finalizedAt: "2026-07-10T00:00:00.000Z",
          },
        };
      },
      async fetch() {
        uploadCalls += 1;
      },
    });

    assert.equal(result.receipt.receiptId, "receipt-remote");
    assert.equal(result.resolvedConflict, true);
    assert.equal(uploadCalls, 0);
  });
});

function receiptRecord(overrides = {}) {
  const blob = new Blob(["receipt bytes"], { type: "image/png" });
  return {
    receiptId: "receipt-one",
    expenseId: "expense-one",
    blob,
    originalName: "Receipt.png",
    mimeType: "image/png",
    sizeBytes: blob.size,
    createdAt: "2026-07-10T00:00:00.000Z",
    attempts: 0,
    ...overrides,
  };
}
