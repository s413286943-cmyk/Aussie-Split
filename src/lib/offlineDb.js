import {
  compareMutationVersions,
  legacyMutationVersion,
  nextMutationVersion,
  parseMutationVersion,
} from "./mutationVersion.js";
import { parseIsoTimestamp } from "./operation.js";

const DATABASE_NAME = "aussie-chill-v2";
const DATABASE_VERSION = 1;
const LEGACY_EXPENSES_KEY = "aussie-chill-expenses-v1";
const LEGACY_ACTIVITY_KEY = "aussie-chill-activity-v1";
const MAX_REMOTE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function openOfflineDb(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  if (!indexedDB?.open) throw new Error("IndexedDB is unavailable");

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => createSchema(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline database open was blocked"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export function closeOfflineDb(db) {
  db?.close();
}

export async function migrateLegacyLocalStorage(db, options) {
  const transaction = db.transaction(["expenses", "activity", "outbox", "meta"], "readwrite");
  const completed = transactionComplete(transaction);
  const meta = transaction.objectStore("meta");

  try {
    const migrated = await requestResult(meta.get("localStorageMigrated"));
    if (migrated?.value === true) {
      await completed;
      return false;
    }

    const expenses = parseLegacyArray(options.storage.getItem(LEGACY_EXPENSES_KEY), LEGACY_EXPENSES_KEY);
    const activity = parseLegacyArray(options.storage.getItem(LEGACY_ACTIVITY_KEY), LEGACY_ACTIVITY_KEY);
    assertLegacyRecords(expenses, "expense");
    assertLegacyRecords(activity, "activity");
    const migratedExpenses = expenses.map((expense, index) => {
      const mutationVersion = validMutationVersion(expense?.mutationVersion)
        ? expense.mutationVersion
        : legacyMutationVersion({
            createdAt: expense?.updatedAt ?? expense?.createdAt ?? options.now,
            index,
            clientId: options.clientId,
          });
      return {
        ...expense,
        mutationVersion,
        updatedAt: legacyUpdatedAt(expense, mutationVersion),
        deletedAt: expense.deletedAt ?? null,
      };
    });
    const highWater = greatestMutationVersion(migratedExpenses.map((expense) => expense.mutationVersion));

    for (const entry of activity) transaction.objectStore("activity").put(entry);
    for (const [index, expense] of migratedExpenses.entries()) {
      const entry = matchingLegacyActivity(activity, expense) ?? legacyActivity(expense, index, options.clientId);
      transaction.objectStore("expenses").put(expense);
      transaction.objectStore("activity").put(entry);
      transaction.objectStore("outbox").add({
        opId: `legacy-op-${String(index).padStart(6, "0")}-${options.clientId}`,
        type: "upsert",
        expenseId: expense.id,
        mutationVersion: expense.mutationVersion,
        expense,
        activity: entry,
        createdAt: expense.updatedAt,
      });
    }
    meta.put({ key: "localStorageMigrated", value: true });
    if (highWater) meta.put({ key: "mutationHighWater", value: highWater });

    await completed;
    return true;
  } catch (error) {
    try {
      transaction.abort();
    } catch (abortError) {
      if (abortError?.name !== "InvalidStateError") throw abortError;
    }
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function loadOfflineLedger(db) {
  const transaction = db.transaction(["expenses", "activity", "outbox", "meta"], "readonly");
  const completed = transactionComplete(transaction);
  const [expenses, activity, outboxCount, metaRecords] = await Promise.all([
    requestResult(transaction.objectStore("expenses").getAll()),
    requestResult(transaction.objectStore("activity").getAll()),
    requestResult(transaction.objectStore("outbox").count()),
    requestResult(transaction.objectStore("meta").getAll()),
  ]);

  await completed;
  return {
    expenses,
    activity,
    outboxCount,
    meta: Object.fromEntries(metaRecords.map(({ key, value }) => [key, value])),
  };
}

export async function commitLocalMutation(db, options) {
  if (options?.type !== "upsert" && options?.type !== "delete") {
    throw new TypeError("Invalid local mutation type");
  }
  assertRecordId(options.expense, "expense");
  assertRecordId(options.activity, "activity");
  if (options.activity.expenseId !== options.expense.id) {
    throw new TypeError("Activity expense id does not match the mutation");
  }
  assertNonemptyString(options.opId, "operation id");

  const now = options.now ?? Date.now();
  const timestamp = isoTimestamp(now, "mutation time");
  const createdAt = validTimestamp(options.createdAt ?? timestamp, "operation creation time");
  const transaction = db.transaction(["expenses", "activity", "outbox", "meta"], "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const expenseStore = transaction.objectStore("expenses");
    const metaStore = transaction.objectStore("meta");
    const [currentExpense, highWaterRecord] = await Promise.all([
      requestResult(expenseStore.get(options.expense.id)),
      requestResult(metaStore.get("mutationHighWater")),
    ]);
    const observed = greatestMutationVersion(
      [currentExpense?.mutationVersion, options.expense.mutationVersion]
        .filter((value) => value !== undefined && value !== null && value !== "")
        .map((value) => {
          parseMutationVersion(value);
          return value;
        }),
    );
    const mutationVersion = nextMutationVersion({
      previous: highWaterRecord?.value ?? "",
      observed,
      now,
      clientId: options.tabId ? `${options.clientId}-${options.tabId}` : options.clientId,
    });
    const expense = {
      ...(currentExpense ?? {}),
      ...options.expense,
      mutationVersion,
      updatedAt: timestamp,
      deletedAt: options.type === "delete" ? timestamp : null,
    };
    const operation = {
      opId: options.opId,
      type: options.type,
      expenseId: expense.id,
      mutationVersion,
      expense: options.type === "delete" ? null : expense,
      ...(options.type === "delete" ? { beforeExpense: currentExpense ?? options.expense } : {}),
      activity: options.activity,
      createdAt,
    };

    metaStore.put({ key: "mutationHighWater", value: mutationVersion });
    expenseStore.put(expense);
    transaction.objectStore("activity").put(options.activity);
    transaction.objectStore("outbox").add(operation);

    await completed;
    return { expense, activity: options.activity, operation };
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function getOutboxOperation(db, opId) {
  assertNonemptyString(opId, "operation id");
  const transaction = db.transaction("outbox", "readonly");
  const completed = transactionComplete(transaction);
  const operation = await requestResult(transaction.objectStore("outbox").get(opId));
  await completed;
  return operation;
}

export async function getOutboxBatch(db, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid outbox batch limit");
  const transaction = db.transaction("outbox", "readonly");
  const completed = transactionComplete(transaction);
  const operations = await requestResult(
    transaction.objectStore("outbox").index("createdAt").getAll(undefined, Math.min(limit, 100)),
  );
  await completed;
  return operations;
}

export async function countOutbox(db) {
  const transaction = db.transaction("outbox", "readonly");
  const completed = transactionComplete(transaction);
  const count = await requestResult(transaction.objectStore("outbox").count());
  await completed;
  return count;
}

export async function undoPendingDelete(db, options) {
  assertNonemptyString(options?.deleteOpId, "delete operation id");
  if (options.activityId !== undefined) assertNonemptyString(options.activityId, "activity id");

  const transaction = db.transaction(["expenses", "activity", "outbox"], "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const outbox = transaction.objectStore("outbox");
    const operation = await requestResult(outbox.get(options.deleteOpId));
    if (operation?.type !== "delete") {
      await completed;
      return false;
    }

    const expense = options.expense ?? operation.beforeExpense;
    assertRecordId(expense, "expense");
    if (expense.mutationVersion) parseMutationVersion(expense.mutationVersion);
    if (operation.expenseId !== expense.id) throw new TypeError("Undo expense does not match delete operation");

    outbox.delete(options.deleteOpId);
    transaction.objectStore("expenses").put(expense);
    if (options.activityId) transaction.objectStore("activity").delete(options.activityId);

    await completed;
    return true;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function acquireSyncLease(db, options) {
  const { owner, now, ttlMs } = leaseTiming(options);
  const transaction = db.transaction("meta", "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const meta = transaction.objectStore("meta");
    const [leaseRecord, fenceRecord] = await Promise.all([
      requestResult(meta.get("syncLease")),
      requestResult(meta.get("syncFence")),
    ]);
    const currentLease = storedLease(leaseRecord?.value);
    const lastFence = storedFence(fenceRecord?.value, currentLease?.fence);
    if (currentLease && currentLease.expiresAt > now) {
      await completed;
      return null;
    }
    if (lastFence >= Number.MAX_SAFE_INTEGER) throw new RangeError("Sync lease fence exhausted");

    const lease = { owner, fence: lastFence + 1, expiresAt: leaseExpiry(now, ttlMs) };
    meta.put({ key: "syncFence", value: lease.fence });
    meta.put({ key: "syncLease", value: lease });
    await completed;
    return lease;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function renewSyncLease(db, options) {
  const { owner, now, ttlMs } = leaseTiming(options);
  assertFence(options.fence);
  const transaction = db.transaction("meta", "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const meta = transaction.objectStore("meta");
    const leaseRecord = await requestResult(meta.get("syncLease"));
    const currentLease = storedLease(leaseRecord?.value);
    if (
      !currentLease
      || currentLease.owner !== owner
      || currentLease.fence !== options.fence
      || currentLease.expiresAt <= now
    ) {
      await completed;
      return null;
    }

    const lease = { ...currentLease, expiresAt: leaseExpiry(now, ttlMs) };
    meta.put({ key: "syncLease", value: lease });
    await completed;
    return lease;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function releaseSyncLease(db, options) {
  assertNonemptyString(options?.owner, "sync lease owner");
  assertFence(options?.fence);
  const transaction = db.transaction("meta", "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const meta = transaction.objectStore("meta");
    const leaseRecord = await requestResult(meta.get("syncLease"));
    const currentLease = storedLease(leaseRecord?.value);
    if (!currentLease || currentLease.owner !== options.owner || currentLease.fence !== options.fence) {
      await completed;
      return false;
    }

    meta.delete("syncLease");
    await completed;
    return true;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function commitSyncResponse(db, options) {
  assertNonemptyString(options?.owner, "sync lease owner");
  assertFence(options?.fence);
  if (!Array.isArray(options?.acknowledgedOpIds)) {
    throw new TypeError("Invalid acknowledged operation ids");
  }
  for (const opId of options.acknowledgedOpIds) assertNonemptyString(opId, "acknowledged operation id");
  if (typeof options.mergeRemoteSnapshot !== "function") {
    throw new TypeError("Invalid remote snapshot merger");
  }

  const transaction = db.transaction(["expenses", "activity", "outbox", "meta"], "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const meta = transaction.objectStore("meta");
    const leaseRecord = await requestResult(meta.get("syncLease"));
    const lease = storedLease(leaseRecord?.value);
    if (!lease || lease.owner !== options.owner || lease.fence !== options.fence) {
      await completed;
      return { accepted: false };
    }

    const serverTime = assertRemoteSnapshot(options.snapshot);
    const outbox = transaction.objectStore("outbox");
    for (const opId of new Set(options.acknowledgedOpIds)) outbox.delete(opId);
    const pendingOperations = await requestResult(outbox.index("createdAt").getAll());
    const merged = options.mergeRemoteSnapshot(options.snapshot, pendingOperations);
    if (merged?.then || !merged || !Array.isArray(merged.expenses) || !Array.isArray(merged.activity)) {
      throw new TypeError("Invalid merged remote snapshot");
    }
    assertUniqueRecords(merged.expenses, "merged expense");
    assertUniqueRecords(merged.activity, "merged activity");
    for (const expense of merged.expenses) parseMutationVersion(expense.mutationVersion);
    const highWaterRecord = await requestResult(meta.get("mutationHighWater"));
    const highWater = greatestMutationVersion([
      ...(highWaterRecord?.value ? [highWaterRecord.value] : []),
      ...merged.expenses.map((expense) => expense.mutationVersion),
    ]);
    const expenseStore = transaction.objectStore("expenses");
    const activityStore = transaction.objectStore("activity");

    expenseStore.clear();
    activityStore.clear();
    for (const expense of merged.expenses) expenseStore.put(expense);
    for (const activity of merged.activity) activityStore.put(activity);
    if (highWater) meta.put({ key: "mutationHighWater", value: highWater });
    meta.put({ key: "serverTime", value: serverTime });
    meta.put({ key: "lastSyncAt", value: serverTime });

    await completed;
    return {
      accepted: true,
      expenses: merged.expenses,
      activity: merged.activity,
      outboxCount: pendingOperations.length,
    };
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function clearLegacyStorageAfterSync(db, storage) {
  if (!storage || typeof storage.removeItem !== "function") {
    throw new TypeError("Invalid legacy storage");
  }
  const transaction = db.transaction(["meta", "outbox"], "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const meta = transaction.objectStore("meta");
    const [migrated, lastSyncAt, cleared, outboxCount] = await Promise.all([
      requestResult(meta.get("localStorageMigrated")),
      requestResult(meta.get("lastSyncAt")),
      requestResult(meta.get("legacyStorageCleared")),
      requestResult(transaction.objectStore("outbox").count()),
    ]);
    if (migrated?.value !== true || !lastSyncAt?.value || cleared?.value === true || outboxCount !== 0) {
      await completed;
      return false;
    }

    storage.removeItem(LEGACY_EXPENSES_KEY);
    storage.removeItem(LEGACY_ACTIVITY_KEY);
    meta.put({ key: "legacyStorageCleared", value: true });
    await completed;
    return true;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function putReceiptBlob(db, receipt) {
  assertReceiptBlob(receipt);
  const transaction = db.transaction("receiptBlobs", "readwrite");
  const completed = transactionComplete(transaction);
  transaction.objectStore("receiptBlobs").put(receipt);
  await completed;
  return receipt;
}

export async function getReceiptBlob(db, receiptId) {
  assertNonemptyString(receiptId, "receipt id");
  const transaction = db.transaction("receiptBlobs", "readonly");
  const completed = transactionComplete(transaction);
  const receipt = await requestResult(transaction.objectStore("receiptBlobs").get(receiptId));
  await completed;
  return receipt;
}

export async function getReceiptBlobByExpenseId(db, expenseId) {
  assertNonemptyString(expenseId, "expense id");
  const transaction = db.transaction("receiptBlobs", "readonly");
  const completed = transactionComplete(transaction);
  const receipt = await requestResult(
    transaction.objectStore("receiptBlobs").index("expenseId").get(expenseId),
  );
  await completed;
  return receipt;
}

export async function deleteReceiptBlob(db, receiptId) {
  assertNonemptyString(receiptId, "receipt id");
  const transaction = db.transaction("receiptBlobs", "readwrite");
  const completed = transactionComplete(transaction);
  const store = transaction.objectStore("receiptBlobs");
  const receipt = await requestResult(store.get(receiptId));
  if (!receipt) {
    await completed;
    return false;
  }
  store.delete(receiptId);
  await completed;
  return true;
}

function createSchema(db) {
  db.createObjectStore("expenses", { keyPath: "id" });
  db.createObjectStore("activity", { keyPath: "id" });
  const outbox = db.createObjectStore("outbox", { keyPath: "opId" });
  outbox.createIndex("createdAt", "createdAt");
  const receiptBlobs = db.createObjectStore("receiptBlobs", { keyPath: "receiptId" });
  receiptBlobs.createIndex("expenseId", "expenseId", { unique: true });
  db.createObjectStore("meta", { keyPath: "key" });
}

function legacyUpdatedAt(expense, mutationVersion) {
  for (const candidate of [expense.updatedAt, expense.createdAt]) {
    if (typeof candidate === "string" && Number.isFinite(Date.parse(candidate))) return candidate;
  }
  return new Date(parseMutationVersion(mutationVersion).millis).toISOString();
}

function matchingLegacyActivity(activity, expense) {
  return [...activity].reverse().find((entry) =>
    entry.expenseId === expense.id
    && ["add", "edit", "confirm"].includes(entry.action)
    && entry.item === expense.item
    && entry.amount === expense.amount
    && entry.currency === expense.currency
    && typeof entry.summary === "string"
    && typeof entry.createdAt === "string"
    && Number.isFinite(Date.parse(entry.createdAt)),
  );
}

function legacyActivity(expense, index, clientId) {
  return {
    id: `legacy-activity-${String(index).padStart(6, "0")}-${clientId}`,
    expenseId: expense.id,
    action: "edit",
    item: expense.item,
    amount: expense.amount,
    currency: expense.currency,
    summary: `从本机恢复了 ${expense.item || "未命名费用"}`,
    createdAt: expense.updatedAt,
  };
}

function parseLegacyArray(serialized, key) {
  if (serialized === null) return [];
  const value = JSON.parse(serialized);
  if (!Array.isArray(value)) throw new TypeError(`Legacy storage ${key} must contain an array`);
  return value;
}

function assertLegacyRecords(records, label) {
  const ids = new Set();
  for (const record of records) {
    if (!record || Array.isArray(record) || typeof record !== "object") {
      throw new TypeError(`Invalid legacy ${label} record`);
    }
    if (typeof record.id !== "string" || !record.id) {
      throw new TypeError(`Invalid legacy ${label} id`);
    }
    if (ids.has(record.id)) throw new TypeError(`Duplicate legacy ${label} id`);
    ids.add(record.id);
  }
}

function assertUniqueRecords(records, label) {
  const ids = new Set();
  for (const record of records) {
    assertRecordId(record, label);
    if (ids.has(record.id)) throw new TypeError(`Duplicate ${label} id`);
    ids.add(record.id);
  }
}

function assertRecordId(record, label) {
  if (!record || Array.isArray(record) || typeof record !== "object") {
    throw new TypeError(`Invalid ${label} record`);
  }
  assertNonemptyString(record.id, `${label} id`);
}

function assertReceiptBlob(receipt) {
  if (!receipt || Array.isArray(receipt) || typeof receipt !== "object") {
    throw new TypeError("Invalid receipt blob record");
  }
  assertNonemptyString(receipt.receiptId, "receipt id");
  assertNonemptyString(receipt.expenseId, "expense id");
  if (
    !receipt.blob
    || typeof receipt.blob.arrayBuffer !== "function"
    || typeof receipt.blob.size !== "number"
    || typeof receipt.blob.type !== "string"
  ) {
    throw new TypeError("Invalid receipt blob");
  }
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || !value) throw new TypeError(`Invalid ${label}`);
}

function isoTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${label}`);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new RangeError(`Invalid ${label}`);
  return timestamp.toISOString();
}

function validTimestamp(value, label) {
  parseIsoTimestamp(value, label);
  return value;
}

function assertRemoteSnapshot(snapshot) {
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") {
    throw new TypeError("Invalid remote snapshot");
  }
  if (!Array.isArray(snapshot.expenses) || !Array.isArray(snapshot.activity)) {
    throw new TypeError("Invalid remote snapshot");
  }
  const serverMillis = parseIsoTimestamp(snapshot.serverTime, "server timestamp");
  assertUniqueRecords(snapshot.expenses, "remote expense");
  assertUniqueRecords(snapshot.activity, "remote activity");

  for (const expense of snapshot.expenses) {
    const version = parseMutationVersion(expense.mutationVersion);
    if (version.millis > serverMillis + MAX_REMOTE_CLOCK_SKEW_MS) {
      throw new RangeError("Remote mutation version is too far in the future");
    }
    validTimestamp(expense.updatedAt, "remote expense timestamp");
    if (expense.deletedAt !== null) validTimestamp(expense.deletedAt, "remote deletion timestamp");
  }
  for (const activity of snapshot.activity) {
    validTimestamp(activity.createdAt, "remote activity timestamp");
  }
  return snapshot.serverTime;
}

function leaseTiming(options) {
  assertNonemptyString(options?.owner, "sync lease owner");
  if (!Number.isSafeInteger(options?.now) || options.now < 0) {
    throw new RangeError("Invalid sync lease time");
  }
  if (!Number.isSafeInteger(options?.ttlMs) || options.ttlMs < 1) {
    throw new RangeError("Invalid sync lease TTL");
  }
  leaseExpiry(options.now, options.ttlMs);
  return options;
}

function leaseExpiry(now, ttlMs) {
  const expiresAt = now + ttlMs;
  if (!Number.isSafeInteger(expiresAt)) throw new RangeError("Invalid sync lease expiry");
  return expiresAt;
}

function assertFence(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid sync lease fence");
}

function storedLease(value) {
  if (value === undefined) return null;
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Invalid stored sync lease");
  }
  assertNonemptyString(value.owner, "stored sync lease owner");
  assertFence(value.fence);
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0) {
    throw new TypeError("Invalid stored sync lease expiry");
  }
  return value;
}

function storedFence(value, leaseFence) {
  if (value === undefined) return leaseFence ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid stored sync fence");
  return Math.max(value, leaseFence ?? 0);
}

function validMutationVersion(value) {
  if (value === undefined || value === null || value === "") return false;
  parseMutationVersion(value);
  return true;
}

function greatestMutationVersion(versions) {
  let greatest = "";
  for (const version of versions) {
    if (!greatest || compareMutationVersions(version, greatest) > 0) greatest = version;
  }
  return greatest;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => {};
  });
}

function abortTransaction(transaction) {
  try {
    transaction.abort();
  } catch (error) {
    if (error?.name !== "InvalidStateError") throw error;
  }
}
