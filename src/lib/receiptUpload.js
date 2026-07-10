import { Upload } from "tus-js-client";

import {
  createReceiptUploadContract,
  fetchReceipt,
  finalizeReceipt,
} from "./apiClient.js";
import { parseReceiptUploadRequest } from "./receipt.js";

export async function uploadReceiptRecord(record, options = {}) {
  const metadata = receiptMetadata(record);
  const createUploadContract = options.createUploadContract ?? createReceiptUploadContract;
  const finalize = options.finalize ?? finalizeReceipt;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  try {
    return await finalize({ expenseId: record.expenseId, receiptId: record.receiptId });
  } catch (error) {
    if (!["receipt_not_found", "receipt_object_missing"].includes(error?.serverCode)) throw error;
  }
  let contract;
  try {
    contract = await createUploadContract(metadata);
  } catch (error) {
    if (error?.serverCode !== "receipt_conflict") throw error;
    const fetchExistingReceipt = options.fetchExistingReceipt ?? fetchReceipt;
    const existing = await fetchExistingReceipt(record.expenseId);
    return { ...existing, resolvedConflict: true };
  }

  if (contract?.mode === "signed-put") {
    if (typeof contract.signedUrl !== "string" || !contract.signedUrl) {
      throw new Error("Invalid receipt upload contract");
    }
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", record.blob, record.originalName);
    await options.onProgress?.();
    const response = await fetchImpl(contract.signedUrl, {
      method: "PUT",
      headers: { "x-upsert": "false" },
      body,
    });
    if (!response?.ok) throw new Error("Receipt upload failed");
    await options.onProgress?.();
  } else if (contract?.mode === "tus") {
    const startTusUpload = options.startTusUpload ?? startResumableReceiptUpload;
    await startTusUpload(record.blob, contract, {
      contentType: record.mimeType,
      originalName: record.originalName,
      onProgress: options.onProgress,
    });
  } else {
    throw new Error("Invalid receipt upload contract");
  }

  return finalize({ expenseId: record.expenseId, receiptId: record.receiptId });
}

function receiptMetadata(record) {
  if (
    !record
    || !record.blob
    || typeof record.blob.arrayBuffer !== "function"
    || record.blob.size !== record.sizeBytes
    || (record.blob.type && record.blob.type.toLowerCase() !== record.mimeType)
  ) {
    throw new TypeError("Invalid receipt Blob record");
  }
  const parsed = parseReceiptUploadRequest({
    expenseId: record.expenseId,
    receiptId: record.receiptId,
    originalName: record.originalName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
  });
  return {
    expenseId: parsed.expenseId,
    receiptId: parsed.receiptId,
    originalName: parsed.originalName,
    mimeType: parsed.mimeType,
    sizeBytes: parsed.sizeBytes,
  };
}

export function startResumableReceiptUpload(blob, contract, metadata, UploadClass = Upload) {
  if (
    typeof contract.endpoint !== "string"
    || !contract.endpoint
    || typeof contract.token !== "string"
    || !contract.token
    || !Number.isSafeInteger(contract.chunkSize)
    || contract.chunkSize < 1
    || typeof contract.bucketName !== "string"
    || typeof contract.objectName !== "string"
  ) {
    throw new Error("Invalid resumable receipt contract");
  }

  return new Promise((resolve, reject) => {
    const upload = new UploadClass(blob, {
      endpoint: contract.endpoint,
      headers: { "x-signature": contract.token },
      metadata: {
        bucketName: contract.bucketName,
        objectName: contract.objectName,
        contentType: metadata.contentType,
        cacheControl: "3600",
      },
      chunkSize: contract.chunkSize,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1_000, 3_000, 5_000],
      fingerprint: async () => `aussie-receipt:${contract.objectName}`,
      onProgress: metadata.onProgress,
      onError: reject,
      onSuccess: resolve,
    });
    Promise.resolve(upload.findPreviousUploads())
      .then((previousUploads) => {
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      })
      .catch(reject);
  });
}
