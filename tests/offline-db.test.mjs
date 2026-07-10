import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { parseExpenseOperationBatch } from "../src/lib/server/http.js";
import { mergeRemoteSnapshot } from "../src/lib/syncEngine.js";
import * as ledger from "../src/lib/ledger.js";

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
      { ...expenses[1], mutationVersion: "0000000000000-000001-legacy-device", updatedAt: "1970-01-01T00:00:00.000Z" },
      { ...expenses[2], mutationVersion: "0000000000000-000002-legacy-device", updatedAt: "1970-01-01T00:00:00.000Z" },
    ]);
    assert.deepEqual(ledger.activity.find(({ id }) => id === "activity-a"), activity[0]);
    assert.equal(ledger.activity.length, 3);
    assert.equal(ledger.outboxCount, 3);
    assert.deepEqual(
      (await offlineDb.getOutboxBatch(db)).map(({ expenseId, type }) => ({ expenseId, type })),
      [
        { expenseId: "expense-b", type: "upsert" },
        { expenseId: "expense-c", type: "upsert" },
        { expenseId: "expense-a", type: "upsert" },
      ],
    );
    assert.equal(ledger.meta.localStorageMigrated, true);
    assert.equal(ledger.meta.mutationHighWater, preservedVersion);
    assert.equal(storage.getItem("aussie-chill-expenses-v1"), JSON.stringify(expenses));
    assert.equal(storage.getItem("aussie-chill-activity-v1"), JSON.stringify(activity));

    const pending = await offlineDb.getOutboxBatch(db);
    const merged = mergeRemoteSnapshot({
      expenses: [
        expenseFixture({
          id: "expense-b",
          item: "Remote lunch",
          mutationVersion: version(-2_000, 0, "remote"),
          updatedAt: timestamp(-2_000),
        }),
        expenseFixture({
          id: "expense-c",
          item: "Deleted remote dinner",
          mutationVersion: version(-1_000, 0, "remote"),
          updatedAt: timestamp(-1_000),
          deletedAt: timestamp(-1_000),
        }),
      ],
      activity: [],
      serverTime,
    }, pending);
    assert.equal(merged.expenses.find(({ id }) => id === "expense-a").item, "早餐");
    assert.equal(merged.expenses.find(({ id }) => id === "expense-b").item, "Remote lunch");
    assert.notEqual(merged.expenses.find(({ id }) => id === "expense-c").deletedAt, null);
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
  it("carries a manual capture through IndexedDB and protected API validation", async () => {
    assert.equal(typeof ledger.createCapturedExpense, "function");

    const db = await openDatabase();
    const expense = ledger.createCapturedExpense({
      id: "",
      category: "dining",
      item: "Manual dinner",
      date: "2026-08-01",
      currency: "AUD",
      amount: "42.50",
      payer: "us",
      status: "confirmed",
      note: "",
      attachmentName: "",
      splitSettled: true,
    }, { id: "expense-manual" });
    const activity = {
      id: "activity-manual",
      expenseId: expense.id,
      action: "add",
      item: expense.item,
      amount: expense.amount,
      currency: expense.currency,
      summary: "Added manual dinner",
      createdAt: timestamp(-10_000),
    };

    await offlineDb.commitLocalMutation(db, {
      type: "upsert",
      expense,
      activity,
      clientId: "device-a",
      tabId: "tab-a",
      now: serverMillis - 10_000,
      opId: "op-manual",
      createdAt: activity.createdAt,
    });

    const operations = await offlineDb.getOutboxBatch(db);
    assert.equal(operations[0].expense.splitSettled, false);
    assert.doesNotThrow(() => parseExpenseOperationBatch({ operations }));
  });

  it("persists a strictly versioned expense, activity, high-water mark, and complete operation", async () => {
    assert.equal(typeof offlineDb.commitLocalMutation, "function");
    assert.equal(typeof offlineDb.getOutboxOperation, "function");

    const db = await openDatabase();
    const input = mutationInput();
    const activity = input.activity;
    const committed = await offlineDb.commitLocalMutation(db, input);
    const expectedExpense = {
      ...input.expense,
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
      item: added.expense.item,
      amount: added.expense.amount,
      currency: added.expense.currency,
      summary: "Deleted breakfast",
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
  it("atomically restores a pending delete and queues its compensation after reopen", async () => {
    assert.equal(typeof offlineDb.commitDeleteUndo, "function");

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
        item: added.expense.item,
        amount: added.expense.amount,
        currency: added.expense.currency,
        summary: "Deleted breakfast",
        createdAt: "2026-05-28T20:26:42.000Z",
      },
    });

    offlineDb.closeOfflineDb(db);
    openDatabases.delete(db);
    const reopened = await openDatabase();

    const undoActivity = {
      id: "activity-undo",
      expenseId: "expense-a",
      action: "edit",
      item: added.expense.item,
      amount: added.expense.amount,
      currency: added.expense.currency,
      summary: "Restored breakfast",
      createdAt: "2026-05-28T20:26:43.000Z",
    };
    const restored = await offlineDb.commitDeleteUndo(reopened, {
      deleteOpId: "op-delete",
      deleteActivityId: "activity-delete",
      expense: added.expense,
      activity: undoActivity,
      opId: "op-undo",
      clientId: "device-a",
      tabId: "tab-a",
      now: 1_780_000_003_000,
      createdAt: undoActivity.createdAt,
    });

    const ledger = await offlineDb.loadOfflineLedger(reopened);
    assert.equal(restored.cancelledPendingDelete, true);
    assert.equal(ledger.expenses[0].deletedAt, null);
    assert.deepEqual(ledger.activity.map(({ id }) => id), ["activity-add", "activity-undo"]);
    assert.equal(ledger.outboxCount, 2);
    assert.equal(ledger.meta.mutationHighWater, restored.expense.mutationVersion);
    assert.equal(await offlineDb.getOutboxOperation(reopened, "op-delete"), undefined);
    assert.equal((await offlineDb.getOutboxOperation(reopened, "op-undo")).type, "upsert");
    assert.ok(restored.expense.mutationVersion > deleted.expense.mutationVersion);
  });

  it("rolls back the restore when the compensating operation cannot be written", async () => {
    const db = await openDatabase();
    const added = await offlineDb.commitLocalMutation(db, mutationInput({
      opId: "op-add",
      activityId: "activity-add",
    }));
    await offlineDb.commitLocalMutation(db, {
      ...mutationInput({ opId: "op-delete", activityId: "activity-delete" }),
      type: "delete",
      expense: added.expense,
      activity: {
        id: "activity-delete",
        expenseId: "expense-a",
        action: "delete",
        item: added.expense.item,
        amount: added.expense.amount,
        currency: added.expense.currency,
        summary: "Deleted breakfast",
        createdAt: "2026-05-28T20:26:42.000Z",
      },
    });

    await assert.rejects(offlineDb.commitDeleteUndo(db, {
      deleteOpId: "op-delete",
      deleteActivityId: "activity-delete",
      expense: added.expense,
      activity: {
        id: "activity-undo",
        expenseId: "expense-a",
        action: "edit",
        item: added.expense.item,
        amount: added.expense.amount,
        currency: added.expense.currency,
        summary: "Restored breakfast",
        createdAt: "2026-05-28T20:26:43.000Z",
      },
      opId: "op-add",
      clientId: "device-a",
      tabId: "tab-a",
      now: 1_780_000_003_000,
      createdAt: "2026-05-28T20:26:43.000Z",
    }));

    const ledger = await offlineDb.loadOfflineLedger(db);
    assert.notEqual(ledger.expenses[0].deletedAt, null);
    assert.deepEqual(ledger.activity.map(({ id }) => id), ["activity-add", "activity-delete"]);
    assert.equal(await offlineDb.getOutboxOperation(db, "op-delete").then(Boolean), true);
    assert.equal(await offlineDb.getOutboxOperation(db, "op-undo"), undefined);
  });

  it("preserves a newer cross-tab edit when an older delete is undone", async () => {
    const db = await openDatabase();
    const added = await offlineDb.commitLocalMutation(db, mutationInput({
      opId: "op-add",
      activityId: "activity-add",
    }));
    await offlineDb.commitLocalMutation(db, {
      ...mutationInput({ opId: "op-delete", activityId: "activity-delete" }),
      type: "delete",
      expense: added.expense,
      activity: {
        id: "activity-delete",
        expenseId: "expense-a",
        action: "delete",
        item: added.expense.item,
        amount: added.expense.amount,
        currency: added.expense.currency,
        summary: "Deleted breakfast",
        createdAt: "2026-05-28T20:26:42.000Z",
      },
    });
    const crossTab = await offlineDb.commitLocalMutation(db, {
      ...completeMutationInput({
        expenseId: "expense-a",
        opId: "op-cross-tab",
        activityId: "activity-cross-tab",
        item: "Cross-tab brunch",
      }),
      now: 1_780_000_002_000,
    });

    const restored = await offlineDb.commitDeleteUndo(db, {
      deleteOpId: "op-delete",
      deleteActivityId: "activity-delete",
      expense: added.expense,
      activity: {
        id: "activity-undo",
        expenseId: "expense-a",
        action: "edit",
        item: added.expense.item,
        amount: added.expense.amount,
        currency: added.expense.currency,
        summary: "Restored breakfast",
        createdAt: "2026-05-28T20:26:43.000Z",
      },
      opId: "op-undo",
      clientId: "device-a",
      tabId: "tab-a",
      now: 1_780_000_003_000,
    });

    assert.equal(restored.expense.item, crossTab.expense.item);
    assert.equal(restored.activity.item, crossTab.expense.item);
    assert.equal((await offlineDb.loadOfflineLedger(db)).expenses[0].item, "Cross-tab brunch");
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
  it("drops only local activity for operations acknowledged as stale", async () => {
    const db = await openDatabase();
    const stale = await offlineDb.commitLocalMutation(
      db,
      completeMutationInput({ expenseId: "expense-a", opId: "op-stale", activityId: "activity-stale" }),
    );
    const pending = await offlineDb.commitLocalMutation(
      db,
      completeMutationInput({ expenseId: "expense-b", opId: "op-pending", activityId: "activity-pending" }),
    );
    const lease = await offlineDb.acquireSyncLease(db, {
      owner: "tab-a",
      now: serverMillis,
      ttlMs: 30_000,
    });
    const remoteExpense = expenseFixture({
      id: "expense-a",
      item: "Newer remote dinner",
      mutationVersion: version(-1_000, 0, "remote"),
      updatedAt: timestamp(-1_000),
    });
    const remoteActivity = {
      id: "activity-remote",
      expenseId: "expense-a",
      action: "edit",
      item: remoteExpense.item,
      amount: remoteExpense.amount,
      currency: remoteExpense.currency,
      summary: "Remote edit",
      createdAt: timestamp(-1_000),
    };

    await offlineDb.commitSyncResponse(db, {
      owner: "tab-a",
      fence: lease.fence,
      snapshot: {
        expenses: [remoteExpense],
        activity: [remoteActivity],
        serverTime,
      },
      acknowledgedOpIds: [stale.operation.opId],
      staleAcknowledgedOpIds: [stale.operation.opId],
      mergeRemoteSnapshot,
    });

    const ledger = await offlineDb.loadOfflineLedger(db);
    assert.deepEqual(
      ledger.activity.map(({ id }) => id).sort(),
      [remoteActivity.id, pending.activity.id].sort(),
    );
    assert.equal(await offlineDb.getOutboxOperation(db, stale.operation.opId), undefined);
    assert.deepEqual(await offlineDb.getOutboxOperation(db, pending.operation.opId), pending.operation);
  });

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
      originalName: "receipt.png",
      mimeType: "image/png",
      sizeBytes: 13,
      createdAt: serverTime,
      attempts: 0,
      lastError: "",
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

  it("stores the expense operation and receipt Blob atomically", async () => {
    const db = await openDatabase();
    const receipt = receiptFixture();
    const committed = await offlineDb.commitLocalMutation(db, {
      ...mutationInput(),
      receipt,
    });

    assert.equal(committed.expense.attachmentName, "receipt.png");
    assert.equal(committed.expense.receiptId, "receipt-a");
    assert.equal(committed.expense.attachmentStatus, "pending");
    assert.equal(committed.operation.expense.attachmentName, undefined);
    assert.equal((await offlineDb.getReceiptBlob(db, "receipt-a")).expenseId, "expense-a");

    await assert.rejects(offlineDb.commitLocalMutation(db, {
      ...mutationInput({ expenseId: "expense-b", activityId: "activity-b" }),
      receipt: receiptFixture({ expenseId: "expense-b", receiptId: "receipt-b" }),
    }));
    assert.equal((await offlineDb.loadOfflineLedger(db)).expenses.some(({ id }) => id === "expense-b"), false);
    assert.equal(await offlineDb.getReceiptBlob(db, "receipt-b"), undefined);
  });

  it("uploads only acknowledged active expenses and commits finalization atomically", async () => {
    assert.equal(typeof offlineDb.claimReadyReceiptBlobs, "function");
    assert.equal(typeof offlineDb.getReadyReceiptBlobs, "function");
    assert.equal(typeof offlineDb.commitReceiptFinalization, "function");
    assert.equal(typeof offlineDb.markReceiptUploadFailure, "function");

    const db = await openDatabase();
    const committed = await offlineDb.commitLocalMutation(db, {
      ...mutationInput(),
      receipt: receiptFixture(),
    });
    assert.deepEqual(await offlineDb.getReadyReceiptBlobs(db), []);

    const lease = await offlineDb.acquireSyncLease(db, {
      owner: "tab-a",
      now: serverMillis,
      ttlMs: 30_000,
    });
    await offlineDb.commitSyncResponse(db, {
      owner: "tab-a",
      fence: lease.fence,
      snapshot: {
        expenses: [committed.operation.expense],
        activity: [committed.activity],
        serverTime,
      },
      acknowledgedOpIds: [committed.operation.opId],
      mergeRemoteSnapshot,
    });

    const [ready] = await offlineDb.claimReadyReceiptBlobs(db, {
      owner: "receipt-worker-a",
      now: serverMillis + 500,
      ttlMs: 60_000,
      limit: 10,
    });
    assert.equal(ready.receiptId, "receipt-a");
    assert.equal((await offlineDb.loadOfflineLedger(db)).expenses[0].attachmentStatus, "pending");

    await offlineDb.markReceiptUploadFailure(db, "receipt-a", {
      now: serverMillis + 1_000,
      message: "offline",
      owner: "receipt-worker-a",
    });
    assert.equal((await offlineDb.getReceiptBlob(db, "receipt-a")).attempts, 1);

    const [retried] = await offlineDb.claimReadyReceiptBlobs(db, {
      owner: "receipt-worker-b",
      now: serverMillis + 2_000,
      ttlMs: 60_000,
      limit: 10,
    });
    assert.equal(retried.receiptId, "receipt-a");

    await offlineDb.commitReceiptFinalization(db, {
      receiptId: "receipt-a",
      expenseId: "expense-a",
      owner: "receipt-worker-b",
      attachment: {
        receiptId: "receipt-a",
        expenseId: "expense-a",
        originalName: "receipt.png",
        storagePath: "expense-a/receipt-a-receipt.png",
        finalizedAt: serverTime,
      },
    });
    assert.equal(await offlineDb.getReceiptBlob(db, "receipt-a"), undefined);
    const [expense] = (await offlineDb.loadOfflineLedger(db)).expenses;
    assert.equal(expense.attachmentName, "receipt.png");
    assert.equal(expense.attachmentPath, "expense-a/receipt-a-receipt.png");
    assert.equal(expense.attachmentStatus, "uploaded");
  });

  it("claims one ready receipt for only one tab and recovers an expired claim", async () => {
    const db = await openDatabase();
    const committed = await offlineDb.commitLocalMutation(db, {
      ...mutationInput(),
      receipt: receiptFixture(),
    });
    const lease = await offlineDb.acquireSyncLease(db, {
      owner: "tab-a",
      now: serverMillis,
      ttlMs: 30_000,
    });
    await offlineDb.commitSyncResponse(db, {
      owner: "tab-a",
      fence: lease.fence,
      snapshot: {
        expenses: [committed.operation.expense],
        activity: [committed.activity],
        serverTime,
      },
      acknowledgedOpIds: [committed.operation.opId],
      mergeRemoteSnapshot,
    });

    const [tabA, tabB] = await Promise.all([
      offlineDb.claimReadyReceiptBlobs(db, {
        owner: "receipt-tab-a", now: serverMillis + 1_000, ttlMs: 60_000, limit: 10,
      }),
      offlineDb.claimReadyReceiptBlobs(db, {
        owner: "receipt-tab-b", now: serverMillis + 1_000, ttlMs: 60_000, limit: 10,
      }),
    ]);
    assert.equal(tabA.length + tabB.length, 1);
    const winner = tabA.length ? "receipt-tab-a" : "receipt-tab-b";
    const loser = tabA.length ? "receipt-tab-b" : "receipt-tab-a";
    assert.deepEqual(await offlineDb.claimReadyReceiptBlobs(db, {
      owner: loser, now: serverMillis + 60_999, ttlMs: 60_000, limit: 10,
    }), []);
    const [recovered] = await offlineDb.claimReadyReceiptBlobs(db, {
      owner: loser, now: serverMillis + 61_000, ttlMs: 60_000, limit: 10,
    });
    assert.equal(recovered.receiptId, "receipt-a");
    assert.notEqual(recovered.uploadClaimOwner, winner);
  });

  it("atomically adopts a different finalized remote receipt after conflict", async () => {
    assert.equal(typeof offlineDb.commitReceiptConflictResolution, "function");
    const db = await openDatabase();
    const committed = await offlineDb.commitLocalMutation(db, {
      ...mutationInput(),
      receipt: receiptFixture(),
    });
    const lease = await offlineDb.acquireSyncLease(db, {
      owner: "tab-a", now: serverMillis, ttlMs: 30_000,
    });
    await offlineDb.commitSyncResponse(db, {
      owner: "tab-a",
      fence: lease.fence,
      snapshot: { expenses: [committed.operation.expense], activity: [committed.activity], serverTime },
      acknowledgedOpIds: [committed.operation.opId],
      mergeRemoteSnapshot,
    });
    await offlineDb.claimReadyReceiptBlobs(db, {
      owner: "receipt-worker", now: serverMillis + 1_000, ttlMs: 60_000, limit: 10,
    });

    await offlineDb.commitReceiptConflictResolution(db, {
      localReceiptId: "receipt-a",
      expenseId: "expense-a",
      owner: "receipt-worker",
      attachment: {
        receiptId: "receipt-remote",
        expenseId: "expense-a",
        originalName: "remote.jpg",
        storagePath: "expense-a/receipt-remote-remote.jpg",
        finalizedAt: serverTime,
      },
    });

    assert.equal(await offlineDb.getReceiptBlob(db, "receipt-a"), undefined);
    const [expense] = (await offlineDb.loadOfflineLedger(db)).expenses;
    assert.equal(expense.receiptId, "receipt-remote");
    assert.equal(expense.attachmentName, "remote.jpg");
    assert.equal(expense.attachmentStatus, "uploaded");
  });
});

function receiptFixture(overrides = {}) {
  return {
    receiptId: "receipt-a",
    expenseId: "expense-a",
    blob: new Blob(["receipt bytes"], { type: "image/png" }),
    originalName: "receipt.png",
    mimeType: "image/png",
    sizeBytes: 13,
    createdAt: serverTime,
    attempts: 0,
    lastError: "",
    ...overrides,
  };
}

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
    expense: {
      id: expenseId,
      category: "dining",
      item: "早餐",
      date: "2026-08-01",
      currency: "AUD",
      amount: 20,
      payer: "us",
      status: "confirmed",
      note: "",
      splitSettled: false,
    },
    activity: {
      id: activityId,
      expenseId,
      action: "add",
      item: "早餐",
      amount: 20,
      currency: "AUD",
      summary: "Added breakfast",
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
