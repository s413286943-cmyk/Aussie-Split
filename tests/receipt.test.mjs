import assert from "node:assert/strict";
import { describe, it } from "node:test";

let importError;
const receipts = await import("../src/lib/receipt.js").catch((error) => {
  importError = error;
  return {};
});

describe("private receipt metadata", () => {
  it("accepts supported images and builds one stable canonical path", () => {
    assert.equal(typeof receipts.parseReceiptUploadRequest, "function", importError?.message);

    const cases = [
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/heic", "heic"],
      ["image/heif", "heif"],
      ["image/webp", "webp"],
    ];
    for (const [mimeType, extension] of cases) {
      const parsed = receipts.parseReceiptUploadRequest({
        expenseId: "expense-one",
        receiptId: "receipt-one",
        originalName: " Café Sydney FINAL!!.jpeg ",
        mimeType,
        sizeBytes: 2048,
      });
      assert.equal(parsed.mimeType, mimeType);
      assert.equal(parsed.storagePath, `expense-one/receipt-one-cafe-sydney-final.${extension}`);
      assert.equal(
        receipts.parseReceiptUploadRequest({
          ...parsed,
          originalName: " Café Sydney FINAL!!.jpeg ",
        }).storagePath,
        parsed.storagePath,
      );
    }
  });

  it("rejects empty, oversized, unsupported, missing, and traversal metadata", () => {
    const valid = {
      expenseId: "expense-one",
      receiptId: "receipt-one",
      originalName: "receipt.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
    };
    const invalid = [
      { ...valid, expenseId: "" },
      { ...valid, receiptId: "" },
      { ...valid, originalName: "" },
      { ...valid, originalName: "../receipt.jpg" },
      { ...valid, originalName: "folder/receipt.jpg" },
      { ...valid, originalName: "folder\\receipt.jpg" },
      { ...valid, mimeType: "application/pdf" },
      { ...valid, sizeBytes: 0 },
      { ...valid, sizeBytes: 10 * 1024 * 1024 + 1 },
      { ...valid, sizeBytes: 1.5 },
    ];

    for (const input of invalid) {
      assert.throws(() => receipts.parseReceiptUploadRequest(input), TypeError);
    }
  });

  it("uses resumable upload only above the required six MiB boundary", () => {
    assert.equal(receipts.receiptUploadMode(6 * 1024 * 1024), "signed-put");
    assert.equal(receipts.receiptUploadMode(6 * 1024 * 1024 + 1), "tus");
    assert.throws(() => receipts.receiptUploadMode(0), TypeError);
  });

  it("validates finalize ids without accepting paths", () => {
    assert.deepEqual(receipts.parseReceiptFinalizeRequest({
      expenseId: "expense-one",
      receiptId: "receipt-one",
    }), {
      expenseId: "expense-one",
      receiptId: "receipt-one",
    });
    assert.throws(() => receipts.parseReceiptFinalizeRequest({
      expenseId: "../expense-one",
      receiptId: "receipt-one",
    }), TypeError);
  });

  it("creates a durable HEIC Blob record when Safari omits the MIME type", () => {
    assert.equal(typeof receipts.createReceiptBlobRecord, "function", importError?.message);
    const file = new Blob(["heic bytes"]);
    Object.defineProperty(file, "name", { value: "IMG 1001.HEIC" });

    const record = receipts.createReceiptBlobRecord({
      expenseId: "expense-one",
      receiptId: "receipt-one",
      file,
      createdAt: "2026-07-10T00:00:00.000Z",
    });

    assert.equal(record.originalName, "IMG 1001.HEIC");
    assert.equal(record.mimeType, "image/heic");
    assert.equal(record.sizeBytes, 10);
    assert.notEqual(record.blob, file);
    assert.equal(record.blob.type, "image/heic");
    assert.equal(record.blob.size, file.size);
    assert.equal(record.attempts, 0);
    assert.equal(record.lastError, "");
  });
});
