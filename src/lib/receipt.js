export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const RESUMABLE_RECEIPT_THRESHOLD_BYTES = 6 * 1024 * 1024;
export const RECEIPT_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

const MIME_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
});

const EXTENSION_MIME_TYPES = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
});

export function parseReceiptUploadRequest(body) {
  if (!isRecord(body)) throw new TypeError("Invalid receipt upload metadata");
  const expenseId = receiptIdentifier(body.expenseId, "expense id");
  const receiptId = receiptIdentifier(body.receiptId, "receipt id");
  const originalName = receiptFileName(body.originalName);
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  if (!RECEIPT_MIME_TYPES.includes(mimeType)) throw new TypeError("Invalid receipt MIME type");
  const sizeBytes = body.sizeBytes;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_RECEIPT_BYTES) {
    throw new TypeError("Invalid receipt size");
  }

  const stem = sanitizedReceiptStem(originalName);
  return {
    expenseId,
    receiptId,
    originalName,
    mimeType,
    sizeBytes,
    storagePath: `${expenseId}/${receiptId}-${stem}.${MIME_EXTENSIONS[mimeType]}`,
    uploadMode: receiptUploadMode(sizeBytes),
  };
}

export function parseReceiptFinalizeRequest(body) {
  if (!isRecord(body)) throw new TypeError("Invalid receipt finalize metadata");
  return {
    expenseId: receiptIdentifier(body.expenseId, "expense id"),
    receiptId: receiptIdentifier(body.receiptId, "receipt id"),
  };
}

export function parseReceiptExpenseId(value) {
  return receiptIdentifier(value, "expense id");
}

export function receiptUploadMode(sizeBytes) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_RECEIPT_BYTES) {
    throw new TypeError("Invalid receipt size");
  }
  return sizeBytes > RESUMABLE_RECEIPT_THRESHOLD_BYTES ? "tus" : "signed-put";
}

export function createReceiptBlobRecord({ expenseId, receiptId, file, createdAt }) {
  if (
    !file
    || typeof file.arrayBuffer !== "function"
    || typeof file.size !== "number"
    || typeof file.name !== "string"
  ) {
    throw new TypeError("Invalid receipt file");
  }
  const declaredType = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  const extension = file.name.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  const mimeType = RECEIPT_MIME_TYPES.includes(declaredType)
    ? declaredType
    : EXTENSION_MIME_TYPES[extension] || "";
  const parsed = parseReceiptUploadRequest({
    expenseId,
    receiptId,
    originalName: file.name,
    mimeType,
    sizeBytes: file.size,
  });
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) {
    throw new TypeError("Invalid receipt creation time");
  }
  const blob = declaredType === parsed.mimeType
    ? file
    : file.slice(0, file.size, parsed.mimeType);
  return {
    receiptId: parsed.receiptId,
    expenseId: parsed.expenseId,
    blob,
    originalName: parsed.originalName,
    mimeType: parsed.mimeType,
    sizeBytes: parsed.sizeBytes,
    createdAt,
    attempts: 0,
    lastError: "",
  };
}

function receiptIdentifier(value, label) {
  if (
    typeof value !== "string"
    || value.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function receiptFileName(value) {
  if (typeof value !== "string") throw new TypeError("Invalid receipt file name");
  const fileName = value.trim();
  if (
    !fileName
    || fileName.length > 255
    || fileName.includes("/")
    || fileName.includes("\\")
    || fileName.includes("\0")
  ) {
    throw new TypeError("Invalid receipt file name");
  }
  return fileName;
}

function sanitizedReceiptStem(fileName) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return normalized || "receipt";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
