import "server-only";

import { RESUMABLE_RECEIPT_THRESHOLD_BYTES } from "../receipt.js";
import {
  SupabaseUpstreamError,
  supabaseServiceJson,
  supabaseServiceUrl,
} from "./supabase.js";

const RECEIPT_BUCKET = "receipts";
const SIGNED_DOWNLOAD_SECONDS = 300;

export class ReceiptNotFoundError extends Error {
  constructor() {
    super("The receipt is not available");
    this.name = "ReceiptNotFoundError";
    this.code = "receipt_not_found";
  }
}

export class ReceiptConflictError extends Error {
  constructor() {
    super("This expense already has another receipt");
    this.name = "ReceiptConflictError";
    this.code = "receipt_conflict";
  }
}

export class ReceiptVerificationError extends Error {
  constructor() {
    super("The uploaded receipt does not match its pending metadata");
    this.name = "ReceiptVerificationError";
    this.code = "receipt_verification_failed";
  }
}

export class ReceiptObjectMissingError extends Error {
  constructor() {
    super("The pending receipt object has not been uploaded");
    this.name = "ReceiptObjectMissingError";
    this.code = "receipt_object_missing";
  }
}

export async function createReceiptUpload(metadata) {
  let row;
  try {
    row = await supabaseServiceJson("/rest/v1/rpc/create_receipt_upload_intent", {
      method: "POST",
      body: JSON.stringify({ receipt: metadata }),
    });
  } catch (error) {
    throw mapReceiptRpcError(error);
  }
  assertIntentMatches(row, metadata);

  const signed = await supabaseServiceJson(
    `/storage/v1/object/upload/sign/${RECEIPT_BUCKET}/${encodeStoragePath(metadata.storagePath)}`,
    { method: "POST", body: "{}" },
  );
  const signedUrl = absoluteStorageUrl(readSignedPath(signed));
  const token = readSignedToken(signedUrl, signed);

  if (metadata.uploadMode === "tus") {
    return {
      mode: "tus",
      endpoint: resumableStorageEndpoint(),
      token,
      chunkSize: RESUMABLE_RECEIPT_THRESHOLD_BYTES,
      bucketName: RECEIPT_BUCKET,
      objectName: metadata.storagePath,
      storagePath: metadata.storagePath,
    };
  }

  return {
    mode: "signed-put",
    signedUrl,
    token,
    storagePath: metadata.storagePath,
  };
}

export async function finalizeReceiptUpload({ expenseId, receiptId }) {
  const pending = await fetchCanonicalAttachment({ expenseId, receiptId });
  if (!pending) throw new ReceiptNotFoundError();
  if (pending.finalized_at) return mapAttachment(pending);

  let objectInfo;
  try {
    objectInfo = await supabaseServiceJson(
      `/storage/v1/object/info/${RECEIPT_BUCKET}/${encodeStoragePath(pending.storage_path)}`,
    );
  } catch (error) {
    if (error instanceof SupabaseUpstreamError && error.status === 404) {
      throw new ReceiptObjectMissingError();
    }
    throw error;
  }
  const expectedSize = Number(pending.size_bytes);
  const actualSize = readObjectSize(objectInfo);
  const expectedMimeType = pending.mime_type;
  const actualMimeType = readObjectMimeType(objectInfo);
  if (actualSize !== expectedSize || actualMimeType !== expectedMimeType) {
    console.error("receipt_verification_mismatch", {
      expectedSize,
      actualSize,
      expectedMimeType,
      actualMimeType,
      objectKeys: Object.keys(objectInfo && typeof objectInfo === "object" ? objectInfo : {}).sort(),
      metadataKeys: Object.keys(
        objectInfo?.metadata && typeof objectInfo.metadata === "object" ? objectInfo.metadata : {},
      ).sort(),
    });
    throw new ReceiptVerificationError();
  }

  let finalized;
  try {
    finalized = await supabaseServiceJson("/rest/v1/rpc/finalize_receipt_upload", {
      method: "POST",
      body: JSON.stringify({
        requested_expense_id: expenseId,
        requested_receipt_id: receiptId,
      }),
    });
  } catch (error) {
    throw mapReceiptRpcError(error);
  }
  return mapAttachment(finalized);
}

export async function fetchReceiptDownload(expenseId, now = new Date()) {
  const row = await fetchCanonicalAttachment({ expenseId, finalized: true });
  if (!row) throw new ReceiptNotFoundError();

  const signed = await supabaseServiceJson(
    `/storage/v1/object/sign/${RECEIPT_BUCKET}/${encodeStoragePath(row.storage_path)}`,
    {
      method: "POST",
      body: JSON.stringify({ expiresIn: SIGNED_DOWNLOAD_SECONDS }),
    },
  );
  const signedUrl = absoluteStorageUrl(readSignedPath(signed));
  const expiresAt = new Date(now.getTime() + SIGNED_DOWNLOAD_SECONDS * 1000).toISOString();
  return {
    receipt: mapAttachment(row),
    signedUrl,
    expiresAt,
  };
}

export async function cleanupReceipts(options = {}) {
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new RangeError("Invalid receipt cleanup limit");
  }
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const claimToken = `cleanup-${randomUUID()}`;
  const candidates = await supabaseServiceJson("/rest/v1/rpc/claim_receipt_cleanup", {
    method: "POST",
    body: JSON.stringify({ claim_token: claimToken, max_rows: limit }),
  });
  if (!Array.isArray(candidates) || !candidates.every(isCleanupCandidate)) {
    throw new SupabaseUpstreamError();
  }

  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    let storageDeleted = false;
    try {
      const verified = await supabaseServiceJson(
        "/rest/v1/rpc/verify_receipt_cleanup_claim",
        {
          method: "POST",
          body: JSON.stringify({
            requested_attachment_id: candidate.attachment_id,
            requested_claim_token: claimToken,
          }),
        },
      );
      if (!verified) {
        skipped += 1;
        continue;
      }
      const storagePath = verified.storage_path;
      if (!safeStoragePath(storagePath) || storagePath !== candidate.storage_path) {
        throw new SupabaseUpstreamError();
      }

      await supabaseServiceJson(`/storage/v1/object/${RECEIPT_BUCKET}`, {
        method: "DELETE",
        body: JSON.stringify({ prefixes: [storagePath] }),
      });
      storageDeleted = true;
      const completed = await supabaseServiceJson(
        "/rest/v1/rpc/finish_receipt_cleanup_claim",
        {
          method: "POST",
          body: JSON.stringify({
            requested_attachment_id: candidate.attachment_id,
            requested_claim_token: claimToken,
            mark_deleted: true,
          }),
        },
      );
      if (completed !== true) throw new SupabaseUpstreamError();
      deleted += 1;
    } catch {
      try {
        await supabaseServiceJson(
          "/rest/v1/rpc/finish_receipt_cleanup_claim",
          {
            method: "POST",
            body: JSON.stringify({
              requested_attachment_id: candidate.attachment_id,
              requested_claim_token: claimToken,
              mark_deleted: storageDeleted,
            }),
          },
        );
      } catch {
        // An expired claim is safe to recover on the next bounded cleanup pass.
      }
      failed += 1;
    }
  }
  return { claimed: candidates.length, deleted, skipped, failed };
}

async function fetchCanonicalAttachment({ expenseId, receiptId, finalized = false }) {
  const query = new URLSearchParams({
    select: "id,expense_id,receipt_id,original_name,mime_type,size_bytes,storage_path,finalized_at,created_at",
    expense_id: `eq.${expenseId}`,
    deleted_at: "is.null",
    limit: "1",
  });
  if (receiptId) query.set("receipt_id", `eq.${receiptId}`);
  if (finalized) {
    query.set("finalized_at", "not.is.null");
    query.set("order", "created_at.desc");
  }
  const rows = await supabaseServiceJson(`/rest/v1/attachments?${query}`);
  if (!Array.isArray(rows)) throw new SupabaseUpstreamError();
  return rows[0] || null;
}

function assertIntentMatches(row, metadata) {
  if (
    !row
    || row.expense_id !== metadata.expenseId
    || row.receipt_id !== metadata.receiptId
    || row.original_name !== metadata.originalName
    || row.mime_type !== metadata.mimeType
    || Number(row.size_bytes) !== metadata.sizeBytes
    || row.storage_path !== metadata.storagePath
    || row.deleted_at
  ) {
    throw new SupabaseUpstreamError();
  }
}

function mapAttachment(row) {
  if (!row || typeof row !== "object") throw new SupabaseUpstreamError();
  return {
    id: row.id,
    expenseId: row.expense_id,
    receiptId: row.receipt_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storagePath: row.storage_path,
    finalizedAt: row.finalized_at || null,
    createdAt: row.created_at,
  };
}

function mapReceiptRpcError(error) {
  if (!(error instanceof SupabaseUpstreamError)) return error;
  if (error.upstreamMessage === "receipt_conflict" || error.upstreamCode === "23505") {
    return new ReceiptConflictError();
  }
  if (["receipt_expense_unavailable", "receipt_not_found"].includes(error.upstreamMessage)) {
    return new ReceiptNotFoundError();
  }
  return error;
}

function readObjectSize(info) {
  const value = info?.size ?? info?.metadata?.size;
  const size = typeof value === "string" ? Number(value) : value;
  return Number.isSafeInteger(size) ? size : -1;
}

function readObjectMimeType(info) {
  const value = info?.mimetype
    ?? info?.mime_type
    ?? info?.contentType
    ?? info?.content_type
    ?? info?.metadata?.mimetype
    ?? info?.metadata?.mime_type
    ?? info?.metadata?.contentType;
  return typeof value === "string" ? value.toLowerCase() : "";
}

function readSignedPath(payload) {
  const value = payload?.signedURL ?? payload?.signedUrl ?? payload?.url;
  if (typeof value !== "string" || !value) throw new SupabaseUpstreamError();
  return value;
}

function readSignedToken(signedUrl, payload) {
  const explicit = typeof payload?.token === "string" ? payload.token : "";
  const token = explicit || new URL(signedUrl).searchParams.get("token") || "";
  if (!token) throw new SupabaseUpstreamError();
  return token;
}

function absoluteStorageUrl(path) {
  if (/^https:\/\//i.test(path)) return path;
  const base = new URL(supabaseServiceUrl());
  if (path.startsWith("/storage/v1/")) return `${base.origin}${path}`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base.origin}/storage/v1${normalized}`;
}

function resumableStorageEndpoint() {
  const base = new URL(supabaseServiceUrl());
  if (base.hostname.endsWith(".supabase.co")) {
    base.hostname = base.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  return `${base.origin}/storage/v1/upload/resumable`;
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function isCleanupCandidate(value) {
  return Boolean(value)
    && typeof value === "object"
    && /^[0-9a-f-]{36}$/i.test(value.attachment_id || "")
    && typeof value.receipt_id === "string"
    && typeof value.expense_id === "string"
    && safeStoragePath(value.storage_path)
    && ["pending", "tombstoned"].includes(value.cleanup_reason);
}

function safeStoragePath(path) {
  return typeof path === "string"
    && path.length > 2
    && path.length <= 512
    && !path.startsWith("/")
    && !path.includes("//")
    && !/(^|\/)\.\.(\/|$)/.test(path);
}
