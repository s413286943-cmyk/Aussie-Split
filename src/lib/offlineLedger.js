import {
  acquireSyncLease,
  clearLegacyStorageAfterSync,
  closeOfflineDb,
  commitDeleteUndo,
  commitLocalMutation,
  commitReceiptConflictResolution,
  commitReceiptFinalization,
  commitSyncResponse,
  claimReadyReceiptBlobs,
  getOutboxBatch,
  loadOfflineLedger,
  markReceiptUploadFailure,
  migrateLegacyLocalStorage,
  openOfflineDb,
  releaseSyncLease,
  renewSyncLease,
  renewReceiptUploadClaim,
} from "./offlineDb.js";
import { createMutationTabId, loadMutationState } from "./sync.js";
import { flushPendingOperations, visibleExpenses } from "./syncEngine.js";

export async function initializeOfflineLedger(options) {
  const storage = options?.storage;
  if (!storage) throw new TypeError("Offline ledger storage is required");
  const randomUUID = options.randomUUID ?? defaultRandomUUID;
  const tabId = createMutationTabId(randomUUID);
  const identity = loadMutationState(storage, { randomUUID, tabId });
  const db = await openOfflineDb({ indexedDB: options.indexedDB });

  try {
    await migrateLegacyLocalStorage(db, {
      storage,
      clientId: identity.clientId,
      highWater: identity.highWater,
      now: options.now ?? Date.now(),
    });
    const context = {
      db,
      storage,
      clientId: identity.clientId,
      tabId,
      owner: `sync-${tabId}`,
      load: () => loadOfflineView(db),
    };
    context.state = await context.load();
    return context;
  } catch (error) {
    closeOfflineDb(db);
    throw error;
  }
}

export function closeOfflineLedger(context) {
  closeOfflineDb(context?.db);
}

export async function commitOfflineMutation(context, options) {
  assertContext(context);
  await commitLocalMutation(context.db, {
    ...options,
    clientId: context.clientId,
    tabId: context.tabId,
  });
  context.state = await context.load();
  return context.state;
}

export async function undoOfflineDelete(context, options) {
  assertContext(context);
  const committed = await commitDeleteUndo(context.db, {
    deleteOpId: options.deleteOpId,
    deleteActivityId: options.deleteActivityId,
    expense: options.expense,
    activity: options.activity,
    opId: options.opId,
    clientId: context.clientId,
    tabId: context.tabId,
    now: options.now,
  });
  context.state = await context.load();
  return {
    synchronized: !committed.cancelledPendingDelete,
    requiresSync: true,
    state: context.state,
  };
}

export async function syncOfflineLedger(context, options) {
  assertContext(context);
  const result = await flushPendingOperations({
    storage: syncStorageAdapter(context.db),
    sendOperations: (operations) => options.sendOperations(operations.map(remoteOperation)),
    owner: context.owner,
    now: options.now ?? Date.now,
    leaseTtlMs: options.leaseTtlMs,
  });
  context.state = await context.load();

  if (result.completed && context.state.outboxCount === 0) {
    await clearLegacyStorageAfterSync(context.db, context.storage);
  }

  return { result, state: context.state };
}

export async function syncOfflineReceipts(context, options) {
  assertContext(context);
  if (typeof options?.uploadReceipt !== "function") {
    throw new TypeError("Receipt upload function is required");
  }
  const now = options.now ?? Date.now;
  if (typeof now !== "function") throw new TypeError("Invalid receipt sync clock");

  const claimOwner = `receipt-${context.tabId}`;
  const claimTtlMs = options.claimTtlMs ?? 10 * 60 * 1000;
  const ready = await claimReadyReceiptBlobs(context.db, {
    owner: claimOwner,
    now: now(),
    ttlMs: claimTtlMs,
    limit: 10,
  });
  let uploaded = 0;
  let failed = 0;
  let skipped = 0;
  for (const receipt of ready) {
    try {
      const result = await options.uploadReceipt(receipt, {
        onProgress: () => renewReceiptUploadClaim(context.db, {
          receiptId: receipt.receiptId,
          owner: claimOwner,
          now: now(),
          ttlMs: claimTtlMs,
        }),
      });
      const attachment = result?.receipt;
      const finalized = result?.resolvedConflict || attachment?.receiptId !== receipt.receiptId
        ? await commitReceiptConflictResolution(context.db, {
            localReceiptId: receipt.receiptId,
            expenseId: receipt.expenseId,
            owner: claimOwner,
            attachment,
          })
        : await commitReceiptFinalization(context.db, {
            receiptId: receipt.receiptId,
            expenseId: receipt.expenseId,
            owner: claimOwner,
            attachment,
          });
      if (finalized) uploaded += 1;
      else skipped += 1;
    } catch {
      const retained = await markReceiptUploadFailure(context.db, receipt.receiptId, {
        now: now(),
        message: "upload_failed",
        owner: claimOwner,
      });
      if (retained) failed += 1;
      else skipped += 1;
    }
  }

  context.state = await context.load();
  return { uploaded, failed, skipped, state: context.state };
}

async function loadOfflineView(db) {
  const state = await loadOfflineLedger(db);
  return {
    ...state,
    rawExpenses: state.expenses,
    expenses: visibleExpenses(state.expenses),
    activity: [...state.activity].sort((left, right) => {
      const compared = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return compared || left.id.localeCompare(right.id);
    }),
  };
}

function syncStorageAdapter(db) {
  return {
    acquireSyncLease: (options) => acquireSyncLease(db, options),
    renewSyncLease: (options) => renewSyncLease(db, options),
    getOutboxBatch: (limit) => getOutboxBatch(db, limit),
    commitSyncResponse: (options) => commitSyncResponse(db, options),
    releaseSyncLease: (options) => releaseSyncLease(db, options),
  };
}

function assertContext(context) {
  if (!context?.db || typeof context.load !== "function") {
    throw new TypeError("Invalid offline ledger context");
  }
}

function remoteOperation(operation) {
  const remote = { ...operation };
  delete remote.beforeExpense;
  return remote;
}

function defaultRandomUUID() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Web Crypto randomUUID is unavailable");
  return globalThis.crypto.randomUUID();
}
