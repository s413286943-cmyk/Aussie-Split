import {
  compareMutationVersions,
  legacyMutationVersion,
  nextMutationVersion,
  parseMutationVersion,
} from "./mutationVersion.js";
import {
  createDeleteOperation,
  createUpsertOperation,
  parseIsoTimestamp,
} from "./operation.js";

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
            createdAt: expense?.updatedAt ?? expense?.createdAt,
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
    const highWater = greatestMutationVersion([
      ...(validMutationVersion(options.highWater) ? [options.highWater] : []),
      ...migratedExpenses.map((expense) => expense.mutationVersion),
    ]);

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

export async function repairLegacySplitState(db) {
  const transaction = db.transaction(["expenses", "outbox"], "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const expenseStore = transaction.objectStore("expenses");
    const outbox = transaction.objectStore("outbox");
    const [expenses, operations] = await Promise.all([
      requestResult(expenseStore.getAll()),
      requestResult(outbox.getAll()),
    ]);
    let repaired = 0;

    for (const expense of expenses) {
      if (typeof expense.splitSettled === "boolean") continue;
      expenseStore.put({ ...expense, splitSettled: false });
      repaired += 1;
    }
    for (const operation of operations) {
      if (
        operation?.type !== "upsert"
        || !operation.expense
        || typeof operation.expense.splitSettled === "boolean"
      ) continue;
      outbox.put({
        ...operation,
        expense: { ...operation.expense, splitSettled: false },
      });
    }

    await completed;
    return repaired;
  } catch (error) {
    abortTransaction(transaction);
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
  if (options.receipt !== undefined) {
    assertReceiptBlob(options.receipt);
    if (options.receipt.expenseId !== options.expense.id) {
      throw new TypeError("Receipt expense id does not match the mutation");
    }
  }

  const now = options.now ?? Date.now();
  const timestamp = isoTimestamp(now, "mutation time");
  const createdAt = validTimestamp(options.createdAt ?? timestamp, "operation creation time");
  const transaction = db.transaction(["expenses", "activity", "outbox", "receiptBlobs", "meta"], "readwrite");
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
      ...(options.receipt ? {
        attachmentName: options.receipt.originalName,
        attachmentPath: "",
        receiptId: options.receipt.receiptId,
        attachmentStatus: "pending",
      } : {}),
    };
    const operation = options.type === "delete"
      ? {
          ...createDeleteOperation({
            opId: options.opId,
            expense,
            activity: options.activity,
            createdAt,
          }),
          beforeExpense: currentExpense ?? options.expense,
        }
      : createUpsertOperation({
          opId: options.opId,
          expense,
          activity: options.activity,
          createdAt,
        });

    metaStore.put({ key: "mutationHighWater", value: mutationVersion });
    expenseStore.put(expense);
    transaction.objectStore("activity").put(options.activity);
    transaction.objectStore("outbox").add(operation);
    if (options.receipt) transaction.objectStore("receiptBlobs").put(options.receipt);

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
  const operations = await requestResult(transaction.objectStore("outbox").getAll());
  await completed;
  return operations
    .sort((left, right) => {
      const compared = compareMutationVersions(left.mutationVersion, right.mutationVersion);
      return compared || left.opId.localeCompare(right.opId);
    })
    .slice(0, Math.min(limit, 100));
}

export async function countOutbox(db) {
  const transaction = db.transaction("outbox", "readonly");
  const completed = transactionComplete(transaction);
  const count = await requestResult(transaction.objectStore("outbox").count());
  await completed;
  return count;
}

export async function commitDeleteUndo(db, options) {
  assertNonemptyString(options?.deleteOpId, "delete operation id");
  if (options?.expense !== undefined) assertRecordId(options.expense, "expense");
  assertRecordId(options?.activity, "activity");
  assertNonemptyString(options?.opId, "operation id");
  if (options.deleteActivityId !== undefined) {
    assertNonemptyString(options.deleteActivityId, "delete activity id");
  }

  const now = options.now ?? Date.now();
  const createdAt = isoTimestamp(now, "Undo mutation time");
  const transaction = db.transaction(["expenses", "activity", "outbox", "meta"], "readwrite");
  const completed = transactionComplete(transaction);

  try {
    const outbox = transaction.objectStore("outbox");
    const expenseStore = transaction.objectStore("expenses");
    const metaStore = transaction.objectStore("meta");
    const deleteOperation = await requestResult(outbox.get(options.deleteOpId));
    const sourceExpense = options.expense ?? deleteOperation?.beforeExpense;
    assertRecordId(sourceExpense, "expense");
    if (options.activity.expenseId !== sourceExpense.id) {
      throw new TypeError("Activity expense id does not match the Undo");
    }
    const [currentExpense, highWaterRecord] = await Promise.all([
      requestResult(expenseStore.get(sourceExpense.id)),
      requestResult(metaStore.get("mutationHighWater")),
    ]);
    if (deleteOperation && (
      deleteOperation.type !== "delete"
      || deleteOperation.expenseId !== sourceExpense.id
    )) {
      throw new TypeError("Undo expense does not match delete operation");
    }

    const observed = greatestMutationVersion([
      highWaterRecord?.value,
      currentExpense?.mutationVersion,
      deleteOperation?.mutationVersion,
      sourceExpense.mutationVersion,
    ].filter(Boolean));
    const mutationVersion = nextMutationVersion({
      previous: highWaterRecord?.value ?? "",
      observed,
      now,
      clientId: options.tabId ? `${options.clientId}-${options.tabId}` : options.clientId,
    });
    const baseExpense = currentExpense?.deletedAt == null
      && currentExpense.mutationVersion
      && (!sourceExpense.mutationVersion || (
        compareMutationVersions(currentExpense.mutationVersion, sourceExpense.mutationVersion) > 0
      ))
      ? currentExpense
      : sourceExpense;
    const expense = {
      ...baseExpense,
      mutationVersion,
      updatedAt: createdAt,
      deletedAt: null,
    };
    const operation = createUpsertOperation({
      opId: options.opId,
      expense,
      activity: {
        ...options.activity,
        item: expense.item,
        amount: expense.amount,
        currency: expense.currency,
        createdAt,
      },
      createdAt,
    });
    const cancelledPendingDelete = deleteOperation?.type === "delete";

    if (cancelledPendingDelete) {
      outbox.delete(options.deleteOpId);
      if (options.deleteActivityId) {
        transaction.objectStore("activity").delete(options.deleteActivityId);
      }
    }
    metaStore.put({ key: "mutationHighWater", value: mutationVersion });
    expenseStore.put(expense);
    transaction.objectStore("activity").put(operation.activity);
    outbox.add(operation);

    await completed;
    return {
      cancelledPendingDelete,
      expense,
      activity: operation.activity,
      operation,
    };
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
  const staleAcknowledgedOpIds = options.staleAcknowledgedOpIds ?? [];
  if (!Array.isArray(staleAcknowledgedOpIds)) {
    throw new TypeError("Invalid stale acknowledged operation ids");
  }
  for (const opId of staleAcknowledgedOpIds) {
    assertNonemptyString(opId, "stale acknowledged operation id");
  }
  const acknowledgedSet = new Set(options.acknowledgedOpIds);
  if (staleAcknowledgedOpIds.some((opId) => !acknowledgedSet.has(opId))) {
    throw new TypeError("Stale acknowledgements must also be acknowledged");
  }
  if (typeof options.mergeRemoteSnapshot !== "function") {
    throw new TypeError("Invalid remote snapshot merger");
  }

  const transaction = db.transaction(["expenses", "activity", "outbox", "receiptBlobs", "meta"], "readwrite");
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
    const staleActivityIds = new Set();
    for (const opId of new Set(staleAcknowledgedOpIds)) {
      const operation = await requestResult(outbox.get(opId));
      if (operation?.activity?.id) staleActivityIds.add(operation.activity.id);
    }
    for (const opId of acknowledgedSet) outbox.delete(opId);
    const pendingOperations = await requestResult(outbox.getAll());
    const merged = options.mergeRemoteSnapshot(options.snapshot, pendingOperations);
    if (merged?.then || !merged || !Array.isArray(merged.expenses) || !Array.isArray(merged.activity)) {
      throw new TypeError("Invalid merged remote snapshot");
    }
    assertUniqueRecords(merged.expenses, "merged expense");
    assertUniqueRecords(merged.activity, "merged activity");
    for (const expense of merged.expenses) parseMutationVersion(expense.mutationVersion);
    const pendingReceipts = await requestResult(transaction.objectStore("receiptBlobs").getAll());
    const receiptByExpense = new Map(pendingReceipts.map((receipt) => [receipt.expenseId, receipt]));
    const mergedExpenses = merged.expenses.map((expense) => {
      const receipt = receiptByExpense.get(expense.id);
      if (!receipt || expense.deletedAt) return expense;
      return {
        ...expense,
        attachmentName: receipt.originalName,
        attachmentPath: "",
        receiptId: receipt.receiptId,
        attachmentStatus: "pending",
      };
    });
    const highWaterRecord = await requestResult(meta.get("mutationHighWater"));
    const highWater = greatestMutationVersion([
      ...(highWaterRecord?.value ? [highWaterRecord.value] : []),
      ...mergedExpenses.map((expense) => expense.mutationVersion),
    ]);
    const expenseStore = transaction.objectStore("expenses");
    const activityStore = transaction.objectStore("activity");
    const existingActivity = await requestResult(activityStore.getAll());
    const pendingActivityIds = new Set(
      pendingOperations.map((operation) => operation?.activity?.id).filter(Boolean),
    );
    const activityHistory = mergeActivityHistory(
      existingActivity.filter((entry) => (
        !staleActivityIds.has(entry.id) || pendingActivityIds.has(entry.id)
      )),
      merged.activity,
    );

    expenseStore.clear();
    for (const expense of mergedExpenses) expenseStore.put(expense);
    for (const activityId of staleActivityIds) {
      if (!pendingActivityIds.has(activityId)) activityStore.delete(activityId);
    }
    for (const activity of activityHistory) activityStore.put(activity);
    if (highWater) meta.put({ key: "mutationHighWater", value: highWater });
    meta.put({ key: "serverTime", value: serverTime });
    meta.put({ key: "lastSyncAt", value: serverTime });

    await completed;
    return {
      accepted: true,
      expenses: mergedExpenses,
      activity: activityHistory,
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

export async function cleanupDeletedReceiptBlobs(db, options = {}) {
  if (options.expenseId !== undefined) assertNonemptyString(options.expenseId, "expense id");
  if (options.deletedBefore !== undefined && (
    !Number.isSafeInteger(options.deletedBefore) || options.deletedBefore < 0
  )) {
    throw new RangeError("Invalid deleted receipt cutoff");
  }

  const transaction = db.transaction(["receiptBlobs", "expenses"], "readwrite");
  const completed = transactionComplete(transaction);
  try {
    const receiptStore = transaction.objectStore("receiptBlobs");
    const [receipts, expenses] = await Promise.all([
      requestResult(receiptStore.getAll()),
      requestResult(transaction.objectStore("expenses").getAll()),
    ]);
    const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
    const removable = receipts.filter((receipt) => {
      if (options.expenseId && receipt.expenseId !== options.expenseId) return false;
      const deletedAt = expenseById.get(receipt.expenseId)?.deletedAt;
      if (!deletedAt) return false;
      const deletedMillis = Date.parse(deletedAt);
      return Number.isFinite(deletedMillis)
        && (options.deletedBefore === undefined || deletedMillis <= options.deletedBefore);
    });
    for (const receipt of removable) receiptStore.delete(receipt.receiptId);
    await completed;
    return removable.length;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function getReadyReceiptBlobs(db) {
  const transaction = db.transaction(["receiptBlobs", "expenses", "outbox"], "readonly");
  const completed = transactionComplete(transaction);
  const [receipts, expenses, operations] = await Promise.all([
    requestResult(transaction.objectStore("receiptBlobs").getAll()),
    requestResult(transaction.objectStore("expenses").getAll()),
    requestResult(transaction.objectStore("outbox").getAll()),
  ]);
  await completed;
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
  const pendingExpenseIds = new Set(operations.map((operation) => operation.expenseId));
  return receipts
    .filter((receipt) => {
      const expense = expenseById.get(receipt.expenseId);
      return expense && !expense.deletedAt && !pendingExpenseIds.has(receipt.expenseId);
    })
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export async function claimReadyReceiptBlobs(db, options) {
  assertNonemptyString(options?.owner, "receipt claim owner");
  if (!Number.isSafeInteger(options?.now) || options.now < 0) {
    throw new RangeError("Invalid receipt claim time");
  }
  if (!Number.isSafeInteger(options?.ttlMs) || options.ttlMs < 1) {
    throw new RangeError("Invalid receipt claim TTL");
  }
  if (!Number.isInteger(options?.limit) || options.limit < 1 || options.limit > 25) {
    throw new RangeError("Invalid receipt claim limit");
  }

  const transaction = db.transaction(["receiptBlobs", "expenses", "outbox"], "readwrite");
  const completed = transactionComplete(transaction);
  try {
    const receiptStore = transaction.objectStore("receiptBlobs");
    const [receipts, expenses, operations] = await Promise.all([
      requestResult(receiptStore.getAll()),
      requestResult(transaction.objectStore("expenses").getAll()),
      requestResult(transaction.objectStore("outbox").getAll()),
    ]);
    const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
    const pendingExpenseIds = new Set(operations.map((operation) => operation.expenseId));
    const claimed = receipts
      .filter((receipt) => {
        const expense = expenseById.get(receipt.expenseId);
        const claimActive = Number.isSafeInteger(receipt.uploadClaimExpiresAt)
          && receipt.uploadClaimExpiresAt > options.now;
        return expense
          && !expense.deletedAt
          && !pendingExpenseIds.has(receipt.expenseId)
          && !claimActive;
      })
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .slice(0, options.limit)
      .map((receipt) => ({
        ...receipt,
        uploadClaimOwner: options.owner,
        uploadClaimExpiresAt: options.now + options.ttlMs,
      }));
    for (const receipt of claimed) receiptStore.put(receipt);
    await completed;
    return claimed;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function renewReceiptUploadClaim(db, options) {
  assertNonemptyString(options?.receiptId, "receipt id");
  assertNonemptyString(options?.owner, "receipt claim owner");
  if (!Number.isSafeInteger(options?.now) || options.now < 0) {
    throw new RangeError("Invalid receipt claim time");
  }
  if (!Number.isSafeInteger(options?.ttlMs) || options.ttlMs < 1) {
    throw new RangeError("Invalid receipt claim TTL");
  }
  const transaction = db.transaction("receiptBlobs", "readwrite");
  const completed = transactionComplete(transaction);
  try {
    const store = transaction.objectStore("receiptBlobs");
    const receipt = await requestResult(store.get(options.receiptId));
    if (
      !receipt
      || receipt.uploadClaimOwner !== options.owner
      || !Number.isSafeInteger(receipt.uploadClaimExpiresAt)
      || receipt.uploadClaimExpiresAt <= options.now
    ) {
      await completed;
      return false;
    }
    store.put({
      ...receipt,
      uploadClaimExpiresAt: options.now + options.ttlMs,
    });
    await completed;
    return true;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function markReceiptUploadFailure(db, receiptId, options = {}) {
  assertNonemptyString(receiptId, "receipt id");
  assertNonemptyString(options.owner, "receipt claim owner");
  if (!Number.isSafeInteger(options.now) || options.now < 0) {
    throw new RangeError("Invalid receipt failure time");
  }
  const transaction = db.transaction("receiptBlobs", "readwrite");
  const completed = transactionComplete(transaction);
  try {
    const store = transaction.objectStore("receiptBlobs");
    const receipt = await requestResult(store.get(receiptId));
    if (!receipt || receipt.uploadClaimOwner !== options.owner) {
      await completed;
      return null;
    }
    const updated = {
      ...receipt,
      attempts: (Number.isSafeInteger(receipt.attempts) ? receipt.attempts : 0) + 1,
      lastError: typeof options.message === "string" ? options.message.slice(0, 120) : "upload_failed",
      lastAttemptAt: new Date(options.now).toISOString(),
      uploadClaimOwner: "",
      uploadClaimExpiresAt: 0,
    };
    store.put(updated);
    await completed;
    return updated;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function commitReceiptFinalization(db, options) {
  assertNonemptyString(options?.receiptId, "receipt id");
  assertNonemptyString(options?.expenseId, "expense id");
  assertNonemptyString(options?.owner, "receipt claim owner");
  const attachment = options?.attachment;
  if (
    !attachment
    || attachment.receiptId !== options.receiptId
    || attachment.expenseId !== options.expenseId
    || typeof attachment.originalName !== "string"
    || !attachment.originalName
    || typeof attachment.storagePath !== "string"
    || !attachment.storagePath
    || typeof attachment.finalizedAt !== "string"
    || !Number.isFinite(Date.parse(attachment.finalizedAt))
  ) {
    throw new TypeError("Invalid finalized receipt");
  }

  const transaction = db.transaction(["receiptBlobs", "expenses"], "readwrite");
  const completed = transactionComplete(transaction);
  try {
    const receiptStore = transaction.objectStore("receiptBlobs");
    const expenseStore = transaction.objectStore("expenses");
    const [receipt, expense] = await Promise.all([
      requestResult(receiptStore.get(options.receiptId)),
      requestResult(expenseStore.get(options.expenseId)),
    ]);
    if (!receipt || receipt.uploadClaimOwner !== options.owner) {
      await completed;
      return null;
    }
    if (receipt.expenseId !== options.expenseId || !expense || expense.deletedAt) {
      throw new TypeError("Receipt finalization target is unavailable");
    }
    const updatedExpense = {
      ...expense,
      attachmentName: attachment.originalName,
      attachmentPath: attachment.storagePath,
      receiptId: attachment.receiptId,
      attachmentStatus: "uploaded",
    };
    expenseStore.put(updatedExpense);
    receiptStore.delete(options.receiptId);
    await completed;
    return updatedExpense;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
}

export async function commitReceiptConflictResolution(db, options) {
  assertNonemptyString(options?.localReceiptId, "local receipt id");
  assertNonemptyString(options?.expenseId, "expense id");
  assertNonemptyString(options?.owner, "receipt claim owner");
  const attachment = options?.attachment;
  if (
    !attachment
    || typeof attachment.receiptId !== "string"
    || !attachment.receiptId
    || attachment.expenseId !== options.expenseId
    || typeof attachment.originalName !== "string"
    || !attachment.originalName
    || typeof attachment.storagePath !== "string"
    || !attachment.storagePath
    || typeof attachment.finalizedAt !== "string"
    || !Number.isFinite(Date.parse(attachment.finalizedAt))
  ) {
    throw new TypeError("Invalid finalized receipt");
  }

  const transaction = db.transaction(["receiptBlobs", "expenses"], "readwrite");
  const completed = transactionComplete(transaction);
  try {
    const receiptStore = transaction.objectStore("receiptBlobs");
    const expenseStore = transaction.objectStore("expenses");
    const [receipt, expense] = await Promise.all([
      requestResult(receiptStore.get(options.localReceiptId)),
      requestResult(expenseStore.get(options.expenseId)),
    ]);
    if (!receipt || receipt.uploadClaimOwner !== options.owner) {
      await completed;
      return null;
    }
    if (receipt.expenseId !== options.expenseId || !expense || expense.deletedAt) {
      throw new TypeError("Receipt conflict target is unavailable");
    }
    const updatedExpense = {
      ...expense,
      attachmentName: attachment.originalName,
      attachmentPath: attachment.storagePath,
      receiptId: attachment.receiptId,
      attachmentStatus: "uploaded",
    };
    expenseStore.put(updatedExpense);
    receiptStore.delete(options.localReceiptId);
    await completed;
    return updatedExpense;
  } catch (error) {
    abortTransaction(transaction);
    await completed.then(() => undefined, () => undefined);
    throw error;
  }
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
  assertNonemptyString(receipt.originalName, "receipt original name");
  assertNonemptyString(receipt.mimeType, "receipt MIME type");
  if (!Number.isSafeInteger(receipt.sizeBytes) || receipt.sizeBytes < 1) {
    throw new TypeError("Invalid receipt size");
  }
  if (typeof receipt.createdAt !== "string" || !Number.isFinite(Date.parse(receipt.createdAt))) {
    throw new TypeError("Invalid receipt creation time");
  }
  if (
    !receipt.blob
    || typeof receipt.blob.arrayBuffer !== "function"
    || typeof receipt.blob.size !== "number"
    || typeof receipt.blob.type !== "string"
  ) {
    throw new TypeError("Invalid receipt blob");
  }
  if (receipt.blob.size !== receipt.sizeBytes) throw new TypeError("Invalid receipt Blob size");
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

function mergeActivityHistory(existingActivity, remoteActivity) {
  const byId = new Map(existingActivity.map((activity) => [activity.id, activity]));
  for (const activity of remoteActivity) byId.set(activity.id, activity);
  return [...byId.values()].sort((left, right) => {
    const compared = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return compared || left.id.localeCompare(right.id);
  });
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
