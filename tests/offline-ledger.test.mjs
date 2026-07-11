import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDBFactory } from "fake-indexeddb";

import {
  closeOfflineLedger,
  commitOfflineMutation,
  initializeOfflineLedger,
  syncOfflineLedger,
  syncOfflineReceipts,
  undoOfflineDelete,
} from "../src/lib/offlineLedger.js";
import { getReceiptBlobByExpenseId } from "../src/lib/offlineDb.js";
import { compareMutationVersions } from "../src/lib/mutationVersion.js";

const baseNow = 1_780_000_000_000;

describe("offline ledger lifecycle", () => {
  it("carries the legacy mutation high-water above a rolled-back clock", async () => {
    const previousHighWater = "1780000500000-000009-browser-old";
    const context = await initializeOfflineLedger({
      indexedDB: new IDBFactory(),
      storage: memoryStorage({
        "aussie-chill-mutation-high-water-v1": previousHighWater,
      }),
      now: baseNow,
      randomUUID: uuidSequence(),
    });

    const committed = await commitOfflineMutation(context, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-after-upgrade",
      now: baseNow,
    });

    assert.equal(compareMutationVersions(committed.expenses[0].mutationVersion, previousHighWater), 1);
    closeOfflineLedger(context);
  });

  it("commits locally before rendering and keeps the operation across a database reopen", async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage();
    const first = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow,
      randomUUID: uuidSequence(),
    });

    const committed = await commitOfflineMutation(first, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-local-add",
      now: baseNow + 1_000,
    });

    assert.equal(committed.expenses[0].item, "Dinner");
    assert.equal(committed.outboxCount, 1);
    closeOfflineLedger(first);

    const reopened = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow + 2_000,
      randomUUID: uuidSequence(),
    });

    assert.equal(reopened.state.expenses[0].item, "Dinner");
    assert.equal(reopened.state.outboxCount, 1);
    closeOfflineLedger(reopened);
  });

  it("retries the same durable operation after an ambiguous network failure", async () => {
    const context = await initializedContext();
    await commitOfflineMutation(context, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-ambiguous",
      now: baseNow + 1_000,
    });
    const sentIds = [];

    await assert.rejects(() => syncOfflineLedger(context, {
      now: () => baseNow + 2_000,
      async sendOperations(batch) {
        sentIds.push(batch[0].opId);
        throw Object.assign(new Error("Bad gateway"), { status: 502 });
      },
    }));
    assert.equal((await context.load()).outboxCount, 1);

    const synced = await syncOfflineLedger(context, {
      now: () => baseNow + 3_000,
      async sendOperations(batch) {
        sentIds.push(batch[0].opId);
        return responseFor(batch);
      },
    });

    assert.deepEqual(sentIds, ["op-ambiguous", "op-ambiguous"]);
    assert.equal(synced.state.outboxCount, 0);
    closeOfflineLedger(context);
  });

  it("cancels an unsynced delete but creates a newer upsert after a synced delete", async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage();
    let context = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow,
      randomUUID: uuidSequence(),
    });
    const added = await commitOfflineMutation(context, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-add",
      now: baseNow + 1_000,
    });
    await syncOfflineLedger(context, {
      now: () => baseNow + 2_000,
      sendOperations: responseFor,
    });

    const original = added.expenses[0];
    const firstDelete = await commitOfflineMutation(context, {
      type: "delete",
      expense: original,
      activity: activityFixture({ id: "activity-delete-one", action: "delete", summary: "Deleted dinner" }),
      opId: "op-delete-one",
      now: baseNow + 3_000,
    });
    closeOfflineLedger(context);
    context = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow + 3_500,
      randomUUID: uuidSequence(),
    });
    const cancelled = await undoOfflineDelete(context, {
      deleteOpId: "op-delete-one",
      deleteActivityId: "activity-delete-one",
      now: baseNow + 4_000,
      opId: "op-restore-unused",
      activity: activityFixture({ id: "activity-restore-unused" }),
    });

    assert.equal(cancelled.synchronized, false);
    assert.equal(cancelled.requiresSync, true);
    assert.equal(cancelled.state.expenses[0].deletedAt, null);
    assert.equal(cancelled.state.outboxCount, 1);
    assert.equal(
      compareMutationVersions(cancelled.state.expenses[0].mutationVersion, firstDelete.rawExpenses[0].mutationVersion),
      1,
    );

    const secondDelete = await commitOfflineMutation(context, {
      type: "delete",
      expense: original,
      activity: activityFixture({ id: "activity-delete-two", action: "delete", summary: "Deleted dinner" }),
      opId: "op-delete-two",
      now: baseNow + 5_000,
    });
    await syncOfflineLedger(context, {
      now: () => baseNow + 6_000,
      sendOperations(batch) {
        assert.equal(batch[0].beforeExpense, undefined);
        return responseFor(batch);
      },
    });
    const restored = await undoOfflineDelete(context, {
      deleteOpId: "op-delete-two",
      expense: original,
      deleteActivityId: "activity-delete-two",
      now: baseNow + 7_000,
      opId: "op-restore",
      activity: activityFixture({ id: "activity-restore", summary: "Restored dinner" }),
    });

    assert.equal(restored.synchronized, true);
    assert.equal(restored.requiresSync, true);
    assert.equal(restored.state.outboxCount, 1);
    assert.equal(restored.state.expenses[0].deletedAt, null);
    assert.equal(
      compareMutationVersions(restored.state.expenses[0].mutationVersion, secondDelete.rawExpenses[0].mutationVersion),
      1,
    );
    closeOfflineLedger(context);
  });

  it("uploads a queued receipt only after its expense operation is acknowledged", async () => {
    const context = await initializedContext();
    await commitOfflineMutation(context, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-with-receipt",
      now: baseNow + 1_000,
      receipt: receiptFixture(),
    });
    const calls = [];

    assert.equal((await syncOfflineReceipts(context, {
      async uploadReceipt() {
        calls.push("upload");
      },
      now: () => baseNow + 1_500,
    })).uploaded, 0);

    await syncOfflineLedger(context, {
      now: () => baseNow + 2_000,
      async sendOperations(batch) {
        calls.push("expense");
        return responseFor(batch);
      },
    });
    const receipts = await syncOfflineReceipts(context, {
      async uploadReceipt(receipt) {
        calls.push("upload");
        return {
          receipt: {
            receiptId: receipt.receiptId,
            expenseId: receipt.expenseId,
            originalName: receipt.originalName,
            storagePath: "expense-one/receipt-one-receipt.png",
            finalizedAt: new Date(baseNow + 2_500).toISOString(),
          },
        };
      },
      now: () => baseNow + 2_500,
    });

    assert.deepEqual(calls, ["expense", "upload"]);
    assert.equal(receipts.uploaded, 1);
    assert.equal(receipts.failed, 0);
    assert.equal(receipts.state.expenses[0].attachmentStatus, "uploaded");
    closeOfflineLedger(context);
  });

  it("keeps a failed receipt queued without failing the saved expense", async () => {
    const context = await initializedContext();
    await commitOfflineMutation(context, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-with-failed-receipt",
      now: baseNow + 1_000,
      receipt: receiptFixture(),
    });
    await syncOfflineLedger(context, {
      now: () => baseNow + 2_000,
      sendOperations: responseFor,
    });

    const result = await syncOfflineReceipts(context, {
      async uploadReceipt() {
        throw new Error("network unavailable");
      },
      now: () => baseNow + 3_000,
    });

    assert.equal(result.uploaded, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.state.expenses[0].item, "Dinner");
    assert.equal(result.state.expenses[0].attachmentStatus, "pending");
    closeOfflineLedger(context);
  });

  it("preserves a deleted expense receipt during Undo then removes it after expiry and reopen", async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage();
    let context = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow,
      randomUUID: uuidSequence(),
    });
    await commitOfflineMutation(context, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-receipt-add",
      now: baseNow + 1_000,
      receipt: receiptFixture(),
    });
    await commitOfflineMutation(context, {
      type: "delete",
      expense: context.state.expenses[0],
      activity: activityFixture({ id: "activity-receipt-delete", action: "delete" }),
      opId: "op-receipt-delete",
      now: baseNow + 2_000,
    });
    closeOfflineLedger(context);

    context = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow + 6_000,
      randomUUID: uuidSequence(),
    });
    assert.ok(await getReceiptBlobByExpenseId(context.db, "expense-one"));
    closeOfflineLedger(context);

    context = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow + 8_000,
      randomUUID: uuidSequence(),
    });
    assert.equal(await getReceiptBlobByExpenseId(context.db, "expense-one"), undefined);
    closeOfflineLedger(context);
  });

  it("lets only one tab upload the same acknowledged receipt", async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage();
    const first = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow,
      randomUUID: uuidSequence(),
    });
    await commitOfflineMutation(first, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-shared-receipt",
      now: baseNow + 1_000,
      receipt: receiptFixture(),
    });
    await syncOfflineLedger(first, {
      now: () => baseNow + 2_000,
      sendOperations: responseFor,
    });
    const second = await initializeOfflineLedger({
      indexedDB,
      storage,
      now: baseNow + 2_500,
      randomUUID: uuidSequence(),
    });
    let uploadCalls = 0;
    const uploadReceipt = async (receipt) => {
      uploadCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        receipt: {
          receiptId: receipt.receiptId,
          expenseId: receipt.expenseId,
          originalName: receipt.originalName,
          storagePath: "expense-one/receipt-one-receipt.png",
          finalizedAt: new Date(baseNow + 3_000).toISOString(),
        },
      };
    };

    const results = await Promise.all([
      syncOfflineReceipts(first, { uploadReceipt, now: () => baseNow + 3_000 }),
      syncOfflineReceipts(second, { uploadReceipt, now: () => baseNow + 3_000 }),
    ]);

    assert.equal(uploadCalls, 1);
    assert.equal(results.reduce((sum, result) => sum + result.uploaded, 0), 1);
    assert.equal(results.every((result) => result.state.expenses[0].attachmentStatus === "uploaded"), true);
    closeOfflineLedger(first);
    closeOfflineLedger(second);
  });

  it("replaces a conflicting local Blob with the finalized remote receipt", async () => {
    const context = await initializedContext();
    await commitOfflineMutation(context, {
      type: "upsert",
      expense: expenseFixture(),
      activity: activityFixture(),
      opId: "op-conflicting-receipt",
      now: baseNow + 1_000,
      receipt: receiptFixture(),
    });
    await syncOfflineLedger(context, {
      now: () => baseNow + 2_000,
      sendOperations: responseFor,
    });

    const result = await syncOfflineReceipts(context, {
      now: () => baseNow + 3_000,
      async uploadReceipt() {
        return {
          resolvedConflict: true,
          receipt: {
            receiptId: "receipt-remote",
            expenseId: "expense-one",
            originalName: "remote.jpg",
            storagePath: "expense-one/receipt-remote-remote.jpg",
            finalizedAt: new Date(baseNow + 2_500).toISOString(),
          },
        };
      },
    });

    assert.equal(result.failed, 0);
    assert.equal(result.uploaded, 1);
    assert.equal(result.state.expenses[0].receiptId, "receipt-remote");
    assert.equal(result.state.expenses[0].attachmentStatus, "uploaded");
    closeOfflineLedger(context);
  });
});

async function initializedContext() {
  return initializeOfflineLedger({
    indexedDB: new IDBFactory(),
    storage: memoryStorage(),
    now: baseNow,
    randomUUID: uuidSequence(),
  });
}

function responseFor(batch) {
  const expensesById = new Map();
  for (const operation of batch) {
    expensesById.set(
      operation.expenseId,
      operation.type === "delete"
        ? { ...expenseFixture(), mutationVersion: operation.mutationVersion, updatedAt: operation.createdAt, deletedAt: operation.createdAt }
        : operation.expense,
    );
  }
  return {
    results: batch.map(({ opId }) => ({ opId, status: "applied" })),
    expenses: [...expensesById.values()],
    activity: batch.map(({ activity }) => activity),
    serverTime: new Date(baseNow + 60_000).toISOString(),
  };
}

function expenseFixture(overrides = {}) {
  return {
    id: "expense-one",
    category: "dining",
    item: "Dinner",
    date: "2026-08-01",
    currency: "AUD",
    amount: 88.5,
    payer: "us",
    status: "confirmed",
    note: "Harbour",
    splitSettled: false,
    deletedAt: null,
    ...overrides,
  };
}

function activityFixture(overrides = {}) {
  return {
    id: "activity-one",
    expenseId: "expense-one",
    action: "add",
    item: "Dinner",
    amount: 88.5,
    currency: "AUD",
    summary: "Added dinner",
    createdAt: new Date(baseNow + 1_000).toISOString(),
    ...overrides,
  };
}

function receiptFixture(overrides = {}) {
  return {
    receiptId: "receipt-one",
    expenseId: "expense-one",
    blob: new Blob(["receipt bytes"], { type: "image/png" }),
    originalName: "receipt.png",
    mimeType: "image/png",
    sizeBytes: 13,
    createdAt: new Date(baseNow + 1_000).toISOString(),
    attempts: 0,
    lastError: "",
    ...overrides,
  };
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

function uuidSequence() {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}
