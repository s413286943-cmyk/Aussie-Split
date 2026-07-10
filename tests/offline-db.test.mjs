import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { mergeRemoteSnapshot } from "../src/lib/syncEngine.js";

const indexedDbApi = globalThis.indexedDB
  ? { indexedDB: globalThis.indexedDB }
  : await import("fake-indexeddb");
const testIndexedDB = indexedDbApi.indexedDB;
const databaseName = "aussie-chill-v2";
const serverTime = "2026-07-10T00:05:00.000Z";
const serverMillis = Date.parse(serverTime);

let importError;
const offlineDb = await import("../src/lib/offlineDb.js").catch((error) => {
  importError = error;
  return {};
});

const openDatabases = new Set();

afterEach(async () => {
  for (const db of openDatabases) db.close();
  openDatabases.clear();
  await deleteDatabase();
});

describe("offline database schema", () => {
  it("opens the versioned native IndexedDB schema", async () => {
    assert.equal(typeof offlineDb.openOfflineDb, "function", importError?.message);
    assert.equal(typeof offlineDb.closeOfflineDb, "function", importError?.message);

    const db = await openDatabase();

    assert.equal(db.name, databaseName);
    assert.equal(db.version, 1);
    assert.deepEqual([...db.objectStoreNames], [
      "activity",
      "expenses",
      "meta",
      "outbox",
      "receiptBlobs",
    ]);

    const transaction = db.transaction([...db.objectStoreNames], "readonly");
    assert.equal(transaction.objectStore("expenses").keyPath, "id");
    assert.equal(transaction.objectStore("activity").keyPath, "id");
    assert.equal(transaction.objectStore("outbox").keyPath, "opId");
    assert.equal(transaction.objectStore("outbox").index("createdAt").keyPath, "createdAt");
    assert.equal(transaction.objectStore("receiptBlobs").keyPath, "receiptId");
    const expenseIndex = transaction.objectStore("receiptBlobs").index("expenseId");
    assert.equal(expenseIndex.keyPath, "expenseId");
    assert.equal(expenseIndex.unique, true);
    assert.equal(transaction.objectStore("meta").keyPath, "key");
  });
});

describe("legacy localStorage migration", () => {
  it("imports legacy arrays with deterministic versions without deleting the source", async () => {
    assert.equal(typeof offlineDb.migrateLegacyLocalStorage, "function");
    assert.equal(typeof offlineDb.loadOfflineLedger, "function");

    const db = await openDatabase();
    const now = 1_780_000_000_000;
    const preservedVersion = "1770000000000-000004-existing-client";
    const { mutationVersion: ignoredBVersion, updatedAt: ignoredBUpdatedAt, ...expenseB } = expenseFixture({ id: "expense-b", item: "午餐" });
    const { mutationVersion: ignoredCVersion, updatedAt: ignoredCUpdatedAt, ...expenseC } = expenseFixture({ id: "expense-c", item: "晚餐" });
    void ignoredBVersion;
    void ignoredBUpdatedAt;
    void ignoredCVersion;
    void ignoredCUpdatedAt;
    const expenses = [
      expenseFixture({ id: "expense-a", item: "早餐", mutationVersion: preservedVersion }),
      expenseB,
      expenseC,
    ];
    const activity = [
      {
        id: "activity-a",
        expenseId: "expense-a",
        action: "edit",
        item: "早餐",
        amount: 88.5,
        currency: "AUD",
        summary: "Edited breakfast",
        createdAt: "2026-07-10T01:00:00.000Z",
      },
    ];
    const storage = memoryStorage({
      "aussie-chill-expenses-v1": JSON.stringify(expenses),
      "aussie-chill-activity-v1": JSON.stringify(activity),
    });

    assert.equal(await offlineDb.migrateLegacyLocalStorage(db, {
      storage,
      clientId: "legacy-device",
      now,
    }), true);

    const ledger = await offlineDb.loadOfflineLedger(db);
    assert.deepEqual(ledger.expenses, [
      expenses[0],
      { ...expenses[1], mutationVersion: "1780000000000-000001-legacy-device", updatedAt: "2026-05-28T20:26:40.000Z" },
      { ...expenses[2], mutationVersion: "1780000000000-000002-legacy-device", updatedAt: "2026-05-28T20:26:40.000Z" },
    ]);
    assert.deepEqual(ledger.activity.find(({ id }) => id === "activity-a"), activity[0]);
    assert.equal(ledger.activity.length, 3);
    assert.equal(ledger.outboxCount, 3);
    assert.deepEqual(
      (await offlineDb.getOutboxBatch(db)).map(({ expenseId, type }) => ({ expenseId, type })),
      [
        { expenseId: "expense-a", type: "upsert" },
        { expenseId: "expense-b", type: "upsert" },
        { expenseId: "expense-c", type: "upsert" },
      ],
    );
    assert.equal(ledger.meta.localStorageMigrated, true);
    assert.equal(ledger.meta.mutationHighWater, "1780000000000-000002-legacy-device");
    assert.equal(storage.getItem("aussie-chill-expenses-v1"), JSON.stringify(expenses));
    assert.equal(storage.getItem("aussie-chill-activity-v1"), JSON.stringify(activity));
  });

  it("does not import legacy storage more than once", async () => {
    const db = await openDatabase();
    const storage = memoryStorage({
      "aussie-chill-expenses-v1": JSON.stringify([{ id: "expense-a", item: "早餐" }]),
      "aussie-chill-activity-v1": "[]",
    });
    const options = { storage, clientId: "legacy-device", now: 1_780_000_000_000 };

    assert.equal(await offlineDb.migrateLegacyLocalStorage(db, options), true);
    storage.setItem(
      "aussie-chill-expenses-v1",
      JSON.stringify([{ id: "expense-b", item: "不应导入" }]),
    );

    assert.equal(await offlineDb.migrateLegacyLocalStorage(db, options), false);
    const ledger = await offlineDb.loadOfflineLedger(db);
    assert.deepEqual(ledger.expenses.map(({ id }) => id), ["expense-a"]);
  });

  it("rejects duplicate legacy ids instead of silently overwriting data", async () => {
    const db = await openDatabase();
    const storage = memoryStorage({
      "aussie-chill-expenses-v1": JSON.stringify([
        { id: "duplicate", item: "早餐" },
        { id: "duplicate", item: "午餐" },
      ]),
      "aussie-chill-activity-v1": "[]",
    });

    await assert.rejects(
      offlineDb.migrateLegacyLocalStorage(db, {
        storage,
        clientId: "legacy-device",
        now: 1_780_000_000_000,
      }),
      /duplicate legacy expense id/i,
    );

    assert.deepEqual(await offlineDb.loadOfflineLedger(db), {
      expenses: [],
      activity: [],
      outboxCount: 0,
      meta: {},
    });
  });
});

describe("atomic local mutations", () => {
  it("persists a strictly versioned expense, activity, high-water mark, and complete operation", async () => {
    assert.equal(typeof offlineDb.commitLocalMutation, "function");
    assert.equal(typeof offlineDb.getOutboxOperation, "function");

    const db = await openDatabase();
    const activity = {
      id: "activity-a",
      expenseId: "expense-a",
      action: "add",
      createdAt: "2026-05-28T20:26:40.000Z",
    };
    const committed = await offlineDb.commitLocalMutation(db, {
      type: "upsert",
      expense: { id: "expense-a", item: "早餐", amount: 20 },
      activity,
      clientId: "device-a",
      tabId: "tab-a",
      now: 1_780_000_000_000,
      opId: "op-a",
      createdAt: "2026-05-28T20:26:41.000Z",
    });
    const expectedExpense = {
      id: "expense-a",
      item: "早餐",
      amount: 20,
      mutationVersion: "1780000000000-000000-device-a-tab-a",
      updatedAt: "2026-05-28T20:26:40.000Z",
      deletedAt: null,
    };
    const expectedOperation = {
      opId: "op-a",
      type: "upsert",
      expenseId: "expense-a",
      mutationVersion: expectedExpense.mutationVersion,
      expense: expectedExpense,
      activity,
      createdAt: "2026-05-28T20:26:41.000Z",
    };

    assert.deepEqual(committed, {
      expense: expectedExpense,
      activity,
      operation: expectedOperation,
    });
    assert.deepEqual(await offlineDb.getOutboxOperation(db, "op-a"), expectedOperation);
    assert.deepEqual(await offlineDb.loadOfflineLedger(db), {
      expenses: [expectedExpense],
      activity: [activity],
      outboxCount: 1,
      meta: { mutationHighWater: expectedExpense.mutationVersion },
    });
  });

  it("stores a delete as a tombstone with a null operation payload", async () => {
    const db = await openDatabase();
    const added = await offlineDb.commitLocalMutation(db, mutationInput({
      opId: "op-add",
      activityId: "activity-add",
    }));
    const deleteActivity = {
      id: "activity-delete",
      expenseId: "expense-a",
      action: "delete",
      createdAt: "2026-05-28T20:26:42.000Z",
    };

    const deleted = await offlineDb.commitLocalMutation(db, {
      type: "delete",
      expense: added.expense,
      activity: deleteActivity,
      clientId: "device-a",
      tabId: "tab-a",
      now: 1_780_000_000_000,
      opId: "op-delete",
      createdAt: "2026-05-28T20:26:42.000Z",
    });

    assert.equal(deleted.expense.mutationVersion, "1780000000000-000001-device-a-tab-a");
    assert.equal(deleted.expense.deletedAt, "2026-05-28T20:26:40.000Z");
    assert.deepEqual(deleted.operation, {
      opId: "op-delete",
      type: "delete",
      expenseId: "expense-a",
      mutationVersion: deleted.expense.mutationVersion,
      expense: null,
      beforeExpense: added.expense,
      activity: deleteActivity,
      createdAt: "2026-05-28T20:26:42.000Z",
    });

    const ledger = await offlineDb.loadOfflineLedger(db);
    assert.deepEqual(ledger.expenses, [deleted.expense]);
    assert.equal(ledger.outboxCount, 2);
  });
});

describe("outbox reads", () => {
  it("returns mutation-version-ordered bounded batches even when the clock moves backward", async () => {
    assert.equal(typeof offlineDb.getOutboxBatch, "function");
    assert.equal(typeof offlineDb.countOutbox, "function");

    const db = await openDatabase();
    await offlineDb.commitLocalMutation(db, mutationInput({
      opId: "op-later",
      activityId: "activity-later",
      createdAt: "2026-05-28T20:26:43.000Z",
    }));
    await offlineDb.commitLocalMutation(db, mutationInput({
      opId: "op-earlier",
      activityId: "activity-earlier",
      expenseId: "expense-b",
      createdAt: "2026-05-28T20:26:41.000Z",
    }));

    assert.equal(await offlineDb.countOutbox(db), 2);
    assert.deepEqual(
      (await offlineDb.getOutboxBatch(db, 1)).map(({ opId }) => opId),
      ["op-later"],
    );
    assert.deepEqual(
      (await offlineDb.getOutboxBatch(db)).map(({ opId }) => opId),
      ["op-later", "op-earlier"],
    );
    assert.equal((await offlineDb.getOutboxBatch(db, 1_000)).length, 2);
  });
});

describe("pending delete Undo", () => {
  it("atomically restores a pending delete after the database is closed and reopened", async () => {
    assert.equal(typeof offlineDb.undoPendingDelete, "function");

    const db = await openDatabase();
    const added = await offlineDb.commitLocalMutation(db, mutationInput({
      opId: "op-add",
      activityId: "activity-add",
    }));
    const deleted = await offlineDb.commitLocalMutation(db, {
      ...mutationInput({ opId: "op-delete", activityId: "activity-delete" }),
      type: "delete",
      expense: added.expense,
      activity: {
        id: "activity-delete",
        expenseId: "expense-a",
        action: "delete",
        createdAt: "2026-05-28T20:26:42.000Z",
      },
    });

    offlineDb.closeOfflineDb(db);
    openDatabases.delete(db);
    const reopened = await openDatabase();

    assert.equal(await offlineDb.undoPendingDelete(reopened, {
      deleteOpId: "op-delete",
      activityId: "activity-delete",
    }), true);

    const ledger = await offlineDb.loadOfflineLedger(reopened);
    assert.deepEqual(ledger.expenses, [added.expense]);
    assert.deepEqual(ledger.activity.map(({ id }) => id), ["activity-add"]);
    assert.equal(ledger.outboxCount, 1);
    assert.equal(ledger.meta.mutationHighWater, deleted.expense.mutationVersion);
    assert.equal(await offlineDb.getOutboxOperation(reopened, "op-delete"), undefined);
    assert.equal(await offlineDb.undoPendingDelete(reopened, {
      deleteOpId: "op-delete",
      expense: added.expense,
    }), false);
  });
});

describe("sync lease fencing", () => {
  it("recovers expired leases and increases the fence across owners and releases", async () => {
    assert.equal(typeof offlineDb.acquireSyncLease, "function");
    assert.equal(typeof offlineDb.renewSyncLease, "function");
    assert.equal(typeof offlineDb.releaseSyncLease, "function");

    const tabA = await openDatabase();
    const tabB = await openDatabase();

    assert.deepEqual(await offlineDb.acquireSyncLease(tabA, {
      owner: "tab-a",
      now: 100,
      ttlMs: 50,
    }), { owner: "tab-a", fence: 1, expiresAt: 150 });
    assert.equal(await offlineDb.acquireSyncLease(tabB, {
      owner: "tab-b",
      now: 149,
      ttlMs: 50,
    }), null);
    assert.deepEqual(await offlineDb.renewSyncLease(tabA, {
      owner: "tab-a",
      fence: 1,
      now: 120,
      ttlMs: 50,
    }), { owner: "tab-a", fence: 1, expiresAt: 170 });
    assert.equal(await offlineDb.acquireSyncLease(tabB, {
      owner: "tab-b",
      now: 169,
      ttlMs: 50,
    }), null);

    assert.deepEqual(await offlineDb.acquireSyncLease(tabB, {
      owner: "tab-b",
      now: 170,
      ttlMs: 50,
    }), { owner: "tab-b", fence: 2, expiresAt: 220 });
    assert.equal(await offlineDb.renewSyncLease(tabA, {
      owner: "tab-a",
      fence: 1,
      now: 171,
      ttlMs: 50,
    }), null);
    assert.equal(await offlineDb.releaseSyncLease(tabA, { owner: "tab-a", fence: 1 }), false);
    assert.equal(await offlineDb.releaseSyncLease(tabB, { owner: "tab-b", fence: 2 }), true);
    assert.deepEqual(await offlineDb.acquireSyncLease(tabA, {
      owner: "tab-a",
      now: 171,
      ttlMs: 50,
    }), { owner: "tab-a", fence: 3, expiresAt: 221 });
  });
});

describe("sync response commits", () => {
  it("acknowledges operations and atomically replaces stores with pending work reapplied", async () => {
    assert.equal(typeof offlineDb.commitSyncResponse, "function");

    const db = await openDatabase();
    const acknowledged = await offlineDb.commitLocalMutation(
      db,
      completeMutationInput({ expenseId: "expense-a", opId: "op-ack", activityId: "activity-a" }),
    );
    const pending = await offlineDb.commitLocalMutation(
      db,
      completeMutationInput({
        expenseId: "expense-b",
        opId: "op-pending",
        activityId: "activity-b",
        item: "Pending local dinner",
      }),
    );
    const lease = await offlineDb.acquireSyncLease(db, {
      owner: "tab-a",
      now: serverMillis,
      ttlMs: 30_000,
    });
    const remoteExpense = expenseFixture({
      id: "expense-c",
      item: "Remote hotel",
      mutationVersion: version(-5_000, 0, "remote"),
      updatedAt: timestamp(-5_000),
    });
    const snapshot = {
      expenses: [
        acknowledged.expense,
        expenseFixture({
          id: "expense-b",
          item: "Older remote dinner",
          mutationVersion: version(-20_000, 0, "remote"),
          updatedAt: timestamp(-20_000),
        }),
        remoteExpense,
      ],
      activity: [acknowledged.activity],
      serverTime,
    };

    const result = await offlineDb.commitSyncResponse(db, {
      owner: "tab-a",
      fence: lease.fence,
      snapshot,
      acknowledgedOpIds: ["op-ack", "op-ack", "op-already-gone"],
      mergeRemoteSnapshot,
    });

    assert.equal(result.accepted, true);
    assert.equal(result.outboxCount, 1);
    assert.equal(result.expenses.find(({ id }) => id === "expense-b").item, "Pending local dinner");
    const ledger = await offlineDb.loadOfflineLedger(db);
    assert.equal(ledger.expenses.find(({ id }) => id === "expense-b").item, "Pending local dinner");
    assert.equal(ledger.expenses.find(({ id }) => id === "expense-c").item, "Remote hotel");
    assert.deepEqual(ledger.activity.map(({ id }) => id), ["activity-a", "activity-b"]);
    assert.equal(ledger.outboxCount, 1);
    assert.equal(ledger.meta.serverTime, serverTime);
    assert.equal(ledger.meta.lastSyncAt, serverTime);
    assert.equal(ledger.meta.mutationHighWater, remoteExpense.mutationVersion);
    assert.equal(await offlineDb.getOutboxOperation(db, "op-ack"), undefined);
    assert.deepEqual(await offlineDb.getOutboxOperation(db, "op-pending"), pending.operation);
  });

  it("rejects remote mutation clocks over five minutes ahead and rolls back acknowledgements", async () => {
    const db = await openDatabase();
    const local = await offlineDb.commitLocalMutation(
      db,
      completeMutationInput({ expenseId: "expense-local", opId: "op-local", activityId: "activity-local" }),
    );
    const lease = await offlineDb.acquireSyncLease(db, {
      owner: "tab-a",
      now: serverMillis,
      ttlMs: 30_000,
    });
    const futureSnapshot = {
      expenses: [expenseFixture({
        id: "expense-future",
        mutationVersion: version(300_001, 0, "remote-future"),
        updatedAt: serverTime,
      })],
      activity: [],
      serverTime,
    };

    await assert.rejects(
      offlineDb.commitSyncResponse(db, {
        owner: "tab-a",
        fence: lease.fence,
        snapshot: futureSnapshot,
        acknowledgedOpIds: ["op-local"],
        mergeRemoteSnapshot: (snapshot) => snapshot,
      }),
      /remote mutation version is too far in the future/i,
    );

    const ledger = await offlineDb.loadOfflineLedger(db);
    assert.deepEqual(ledger.expenses, [local.expense]);
    assert.equal(ledger.outboxCount, 1);
    assert.equal(ledger.meta.serverTime, undefined);
    assert.deepEqual(await offlineDb.getOutboxOperation(db, "op-local"), local.operation);
  });
});

describe("legacy storage cleanup", () => {
  it("clears old arrays only after an accepted remote sync", async () => {
    assert.equal(typeof offlineDb.clearLegacyStorageAfterSync, "function");

    const db = await openDatabase();
    const legacyExpense = expenseFixture({ item: "Legacy dinner" });
    const legacyActivity = [
      {
        id: "legacy-history-one",
        expenseId: legacyExpense.id,
        action: "add",
        item: legacyExpense.item,
        amount: legacyExpense.amount,
        currency: legacyExpense.currency,
        summary: "Added legacy dinner",
        createdAt: timestamp(-20_000),
      },
      {
        id: "legacy-history-two",
        expenseId: legacyExpense.id,
        action: "edit",
        item: legacyExpense.item,
        amount: legacyExpense.amount,
        currency: legacyExpense.currency,
        summary: "Edited legacy dinner",
        createdAt: timestamp(-10_000),
      },
    ];
    const storage = memoryStorage({
      "aussie-chill-expenses-v1": JSON.stringify([legacyExpense]),
      "aussie-chill-activity-v1": JSON.stringify(legacyActivity),
      "unrelated-key": "keep-me",
    });
    await offlineDb.migrateLegacyLocalStorage(db, {
      storage,
      clientId: "legacy-device",
      now: serverMillis - 10_000,
    });

    assert.equal(await offlineDb.clearLegacyStorageAfterSync(db, storage), false);
    assert.notEqual(storage.getItem("aussie-chill-expenses-v1"), null);

    const lease = await offlineDb.acquireSyncLease(db, {
      owner: "tab-a",
      now: serverMillis,
      ttlMs: 30_000,
    });
    await offlineDb.commitSyncResponse(db, {
      owner: "tab-a",
      fence: lease.fence,
      snapshot: { expenses: [], activity: [], serverTime },
      acknowledgedOpIds: [],
      mergeRemoteSnapshot,
    });

    assert.equal((await offlineDb.loadOfflineLedger(db)).expenses[0].item, "Legacy dinner");
    assert.equal(await offlineDb.clearLegacyStorageAfterSync(db, storage), false);
    assert.notEqual(storage.getItem("aussie-chill-expenses-v1"), null);

    const [legacyOperation] = await offlineDb.getOutboxBatch(db);
    await offlineDb.commitSyncResponse(db, {
      owner: "tab-a",
      fence: lease.fence,
      snapshot: {
        expenses: [legacyOperation.expense],
        activity: [legacyOperation.activity],
        serverTime,
      },
      acknowledgedOpIds: [legacyOperation.opId],
      mergeRemoteSnapshot,
    });

    assert.equal(await offlineDb.clearLegacyStorageAfterSync(db, storage), true);
    assert.equal(storage.getItem("aussie-chill-expenses-v1"), null);
    assert.equal(storage.getItem("aussie-chill-activity-v1"), null);
    assert.equal(storage.getItem("unrelated-key"), "keep-me");
    const finalLedger = await offlineDb.loadOfflineLedger(db);
    assert.equal(finalLedger.meta.legacyStorageCleared, true);
    assert.deepEqual(
      finalLedger.activity.map(({ id }) => id).sort(),
      legacyActivity.map(({ id }) => id).sort(),
    );
    assert.equal(await offlineDb.clearLegacyStorageAfterSync(db, storage), false);
  });
});

describe("receipt blob persistence", () => {
  it("puts, reloads, finds, and deletes a receipt blob across database reopen", async () => {
    assert.equal(typeof offlineDb.putReceiptBlob, "function");
    assert.equal(typeof offlineDb.getReceiptBlob, "function");
    assert.equal(typeof offlineDb.getReceiptBlobByExpenseId, "function");
    assert.equal(typeof offlineDb.deleteReceiptBlob, "function");

    let db = await openDatabase();
    const receipt = {
      receiptId: "receipt-a",
      expenseId: "expense-a",
      blob: new Blob(["receipt bytes"], { type: "image/png" }),
      name: "receipt.png",
      createdAt: serverTime,
    };

    assert.deepEqual(await offlineDb.putReceiptBlob(db, receipt), receipt);
    offlineDb.closeOfflineDb(db);
    openDatabases.delete(db);
    db = await openDatabase();

    const byId = await offlineDb.getReceiptBlob(db, "receipt-a");
    const byExpense = await offlineDb.getReceiptBlobByExpenseId(db, "expense-a");
    assert.equal(await byId.blob.text(), "receipt bytes");
    assert.equal(await byExpense.blob.text(), "receipt bytes");
    assert.equal(byExpense.receiptId, "receipt-a");
    assert.equal(await offlineDb.deleteReceiptBlob(db, "receipt-a"), true);
    assert.equal(await offlineDb.getReceiptBlob(db, "receipt-a"), undefined);
    assert.equal(await offlineDb.deleteReceiptBlob(db, "receipt-a"), false);
  });
});

async function openDatabase() {
  const db = await offlineDb.openOfflineDb({ indexedDB: testIndexedDB });
  openDatabases.add(db);
  return db;
}

async function deleteDatabase() {
  await new Promise((resolve, reject) => {
    const request = testIndexedDB.deleteDatabase(databaseName);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Test database deletion was blocked"));
    request.onsuccess = () => resolve();
  });
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function mutationInput(overrides = {}) {
  const activityId = overrides.activityId ?? "activity-a";
  const expenseId = overrides.expenseId ?? "expense-a";
  return {
    type: "upsert",
    expense: { id: expenseId, item: "早餐", amount: 20 },
    activity: {
      id: activityId,
      expenseId,
      action: "add",
      createdAt: "2026-05-28T20:26:40.000Z",
    },
    clientId: "device-a",
    tabId: "tab-a",
    now: 1_780_000_000_000,
    opId: overrides.opId ?? "op-a",
    createdAt: overrides.createdAt ?? "2026-05-28T20:26:41.000Z",
  };
}

function completeMutationInput(overrides = {}) {
  const expenseId = overrides.expenseId ?? "expense-a";
  const item = overrides.item ?? "Dinner";
  const createdAt = timestamp(-10_000);
  return {
    type: "upsert",
    expense: expenseFixture({ id: expenseId, item, mutationVersion: undefined, updatedAt: undefined }),
    activity: {
      id: overrides.activityId ?? "activity-a",
      expenseId,
      action: "add",
      item,
      amount: 88.5,
      currency: "AUD",
      summary: `Added ${item}`,
      createdAt,
    },
    clientId: "device-a",
    tabId: "tab-a",
    now: serverMillis - 10_000,
    opId: overrides.opId ?? "op-a",
    createdAt,
  };
}

function expenseFixture(overrides = {}) {
  return {
    id: "expense-a",
    category: "dining",
    item: "Dinner",
    date: "2026-08-01",
    currency: "AUD",
    amount: 88.5,
    payer: "us",
    status: "confirmed",
    note: "Harbour",
    splitSettled: false,
    mutationVersion: version(-10_000, 0, "fixture"),
    updatedAt: timestamp(-10_000),
    deletedAt: null,
    ...overrides,
  };
}

function version(offset, counter, clientId) {
  return `${serverMillis + offset}-${String(counter).padStart(6, "0")}-${clientId}`;
}

function timestamp(offset) {
  return new Date(serverMillis + offset).toISOString();
}
