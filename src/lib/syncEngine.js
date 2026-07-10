import { parseIsoTimestamp } from "./operation.js";
import { compareMutationVersions, parseMutationVersion } from "./mutationVersion.js";

const MAX_REMOTE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function mergeRemoteSnapshot(snapshot, pendingOperations = []) {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.expenses) || !Array.isArray(snapshot.activity)) {
    throw new TypeError("Invalid remote snapshot");
  }
  if (!Array.isArray(pendingOperations)) throw new TypeError("Invalid pending operations");
  const serverMillis = parseIsoTimestamp(snapshot.serverTime, "server timestamp");

  const expensesById = new Map();
  for (const expense of snapshot.expenses) {
    assertRemoteExpense(expense, serverMillis);
    const current = expensesById.get(expense.id);
    if (!current || compareMutationVersions(expense.mutationVersion, current.mutationVersion) > 0) {
      expensesById.set(expense.id, { ...expense });
    }
  }

  const activityById = new Map();
  for (const activity of snapshot.activity) {
    assertActivityTimestamp(activity);
    if (!activityById.has(activity.id)) activityById.set(activity.id, { ...activity });
  }

  const orderedPending = [...pendingOperations].sort((left, right) => {
    const compared = compareMutationVersions(left.mutationVersion, right.mutationVersion);
    return compared || left.opId.localeCompare(right.opId);
  });
  for (const operation of orderedPending) {
    assertPendingOperation(operation);
    const current = expensesById.get(operation.expenseId);
    const comparison = current
      ? compareMutationVersions(operation.mutationVersion, current.mutationVersion)
      : 1;
    if (comparison < 0) continue;

    if (comparison > 0 && operation.type === "upsert") {
      expensesById.set(operation.expenseId, { ...operation.expense });
    } else if (comparison > 0) {
      expensesById.set(operation.expenseId, {
        ...(current || { id: operation.expenseId }),
        mutationVersion: operation.mutationVersion,
        updatedAt: operation.createdAt,
        deletedAt: operation.createdAt,
      });
    }
    if (!activityById.has(operation.activity.id)) {
      activityById.set(operation.activity.id, { ...operation.activity });
    }
  }

  return {
    expenses: [...expensesById.values()],
    activity: [...activityById.values()].sort((left, right) => {
      const compared = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return compared || left.id.localeCompare(right.id);
    }),
    serverTime: snapshot.serverTime,
  };
}

export function visibleExpenses(expenses) {
  if (!Array.isArray(expenses)) throw new TypeError("Expenses must be an array");
  return expenses.filter((expense) => expense?.deletedAt == null);
}

export function acknowledgedOperationIds(results, pendingOperations) {
  if (!Array.isArray(results) || !Array.isArray(pendingOperations)) {
    throw new TypeError("Invalid operation acknowledgements");
  }
  const pendingIds = new Set(pendingOperations.map((operation) => operation?.opId));
  const acknowledged = new Set();
  for (const result of results) {
    if (
      isRecord(result)
      && pendingIds.has(result.opId)
      && ["applied", "stale"].includes(result.status)
    ) {
      acknowledged.add(result.opId);
    }
  }
  return [...pendingIds].filter((opId) => acknowledged.has(opId));
}

export function syncStateLabel({ pendingCount = 0, syncing = false, failed = false } = {}) {
  if (!Number.isSafeInteger(pendingCount) || pendingCount < 0) {
    throw new TypeError("Invalid pending operation count");
  }
  if (failed) return "同步失败，可重试";
  if (syncing) return "正在同步";
  if (pendingCount > 0) return `已本机保存，待同步（${pendingCount}）`;
  return "已同步";
}

export async function flushPendingOperations({
  storage,
  sendOperations,
  owner,
  now,
  leaseTtlMs = 30_000,
}) {
  assertStorageAdapter(storage);
  if (typeof sendOperations !== "function") throw new TypeError("Invalid sync transport");
  if (typeof owner !== "string" || !owner) throw new TypeError("Invalid sync lease owner");
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs <= 0) {
    throw new TypeError("Invalid sync lease duration");
  }

  const lease = await storage.acquireSyncLease({
    owner,
    now: readNow(now),
    ttlMs: leaseTtlMs,
  });
  if (lease === null || lease === false) {
    return flushResult(false, false, "lease_unavailable", 0, 0);
  }
  assertLease(lease, owner);

  let batches = 0;
  let acknowledged = 0;
  let primaryError;
  try {
    while (true) {
      const pending = await storage.getOutboxBatch(100);
      if (!Array.isArray(pending)) throw new TypeError("Invalid outbox batch");
      const batch = pending.slice(0, 100);
      if (batch.length === 0) {
        return flushResult(true, true, null, batches, acknowledged);
      }

      if (!await renewLease(storage, lease, now, leaseTtlMs)) {
        return flushResult(true, false, "lease_lost", batches, acknowledged);
      }

      const response = await sendOperations(batch);
      const snapshot = responseSnapshot(response);
      mergeRemoteSnapshot(snapshot);

      if (!await renewLease(storage, lease, now, leaseTtlMs)) {
        return flushResult(true, false, "lease_lost", batches, acknowledged);
      }

      const acknowledgedOpIds = acknowledgedOperationIds(response.results, batch);
      const committed = await storage.commitSyncResponse({
        owner: lease.owner,
        fence: lease.fence,
        snapshot,
        acknowledgedOpIds,
        mergeRemoteSnapshot,
      });
      if (!commitAccepted(committed)) {
        return flushResult(true, false, "lease_lost", batches, acknowledged);
      }

      batches += 1;
      acknowledged += acknowledgedOpIds.length;
      if (acknowledgedOpIds.length !== batch.length) {
        return flushResult(true, false, "unacknowledged_operations", batches, acknowledged);
      }
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await storage.releaseSyncLease({ owner: lease.owner, fence: lease.fence });
    } catch (releaseError) {
      if (!primaryError) throw releaseError;
    }
  }
}

function assertStorageAdapter(storage) {
  if (!isRecord(storage)) throw new TypeError("Invalid sync storage adapter");
  for (const method of [
    "acquireSyncLease",
    "renewSyncLease",
    "getOutboxBatch",
    "commitSyncResponse",
    "releaseSyncLease",
  ]) {
    if (typeof storage[method] !== "function") {
      throw new TypeError(`Sync storage adapter is missing ${method}`);
    }
  }
}

function assertLease(lease, owner) {
  if (
    !isRecord(lease)
    || lease.owner !== owner
    || !Number.isSafeInteger(lease.fence)
    || lease.fence < 0
  ) {
    throw new TypeError("Invalid sync lease");
  }
}

async function renewLease(storage, lease, now, ttlMs) {
  const renewed = await storage.renewSyncLease({
    owner: lease.owner,
    fence: lease.fence,
    now: readNow(now),
    ttlMs,
  });
  if (renewed === true) return true;
  if (!isRecord(renewed) || renewed.accepted === false) return false;
  if (renewed.accepted === true) return true;
  return renewed.owner === lease.owner && renewed.fence === lease.fence;
}

function responseSnapshot(response) {
  if (!isRecord(response) || !Array.isArray(response.results)) {
    throw new TypeError("Invalid sync response");
  }
  return {
    expenses: response.expenses,
    activity: response.activity,
    serverTime: response.serverTime,
  };
}

function commitAccepted(result) {
  return result === true || (isRecord(result) && result.accepted === true);
}

function readNow(now) {
  const value = typeof now === "function" ? now() : now;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid sync time");
  return value;
}

function flushResult(acquired, completed, reason, batches, acknowledged) {
  return { acquired, completed, reason, batches, acknowledged };
}

function assertRemoteExpense(expense, serverMillis) {
  if (!isRecord(expense) || typeof expense.id !== "string" || !expense.id) {
    throw new TypeError("Invalid remote expense");
  }
  const version = parseMutationVersion(expense.mutationVersion);
  if (version.millis > serverMillis + MAX_REMOTE_CLOCK_SKEW_MS) {
    throw new RangeError("Remote mutation version is too far in the future");
  }
  parseIsoTimestamp(expense.updatedAt, "remote expense timestamp");
  if (expense.deletedAt !== null) {
    parseIsoTimestamp(expense.deletedAt, "remote deletion timestamp");
  }
}

function assertActivityTimestamp(activity) {
  if (!isRecord(activity) || typeof activity.id !== "string" || !activity.id) {
    throw new TypeError("Invalid activity");
  }
  parseIsoTimestamp(activity.createdAt, "activity timestamp");
}

function assertPendingOperation(operation) {
  if (!isRecord(operation) || !["upsert", "delete"].includes(operation.type)) {
    throw new TypeError("Invalid pending operation");
  }
  if (typeof operation.opId !== "string" || !operation.opId || typeof operation.expenseId !== "string" || !operation.expenseId) {
    throw new TypeError("Invalid pending operation id");
  }
  parseMutationVersion(operation.mutationVersion);
  parseIsoTimestamp(operation.createdAt, "operation timestamp");
  assertActivityTimestamp(operation.activity);
  if (operation.activity.expenseId !== operation.expenseId) {
    throw new TypeError("Pending activity does not match expense");
  }
  if (operation.type === "delete") {
    if (operation.expense !== null) throw new TypeError("Invalid pending delete");
    return;
  }
  if (!isRecord(operation.expense) || operation.expense.id !== operation.expenseId) {
    throw new TypeError("Invalid pending upsert");
  }
  if (operation.expense.mutationVersion !== operation.mutationVersion) {
    throw new TypeError("Pending mutation versions do not match");
  }
  parseIsoTimestamp(operation.expense.updatedAt, "pending expense timestamp");
  if (operation.expense.deletedAt !== null) throw new TypeError("Pending upsert is deleted");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
