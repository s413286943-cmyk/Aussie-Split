import {
  acquireSyncLease,
  clearLegacyStorageAfterSync,
  closeOfflineDb,
  commitLocalMutation,
  commitSyncResponse,
  getOutboxBatch,
  loadOfflineLedger,
  migrateLegacyLocalStorage,
  openOfflineDb,
  releaseSyncLease,
  renewSyncLease,
  undoPendingDelete,
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
  const cancelled = await undoPendingDelete(context.db, {
    deleteOpId: options.deleteOpId,
    expense: options.expense,
    activityId: options.deleteActivityId,
  });

  const state = await commitOfflineMutation(context, {
    type: "upsert",
    expense: options.expense,
    activity: options.activity,
    opId: options.opId,
    now: options.now,
    createdAt: options.activity.createdAt,
  });
  return { synchronized: !cancelled, requiresSync: true, state };
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
