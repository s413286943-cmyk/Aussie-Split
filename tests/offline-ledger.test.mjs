import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDBFactory } from "fake-indexeddb";

import {
  closeOfflineLedger,
  commitOfflineMutation,
  initializeOfflineLedger,
  syncOfflineLedger,
  undoOfflineDelete,
} from "../src/lib/offlineLedger.js";
import { compareMutationVersions } from "../src/lib/mutationVersion.js";

const baseNow = 1_780_000_000_000;

describe("offline ledger lifecycle", () => {
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
    const context = await initializedContext();
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
    await commitOfflineMutation(context, {
      type: "delete",
      expense: original,
      activity: activityFixture({ id: "activity-delete-one", action: "delete", summary: "Deleted dinner" }),
      opId: "op-delete-one",
      now: baseNow + 3_000,
    });
    const cancelled = await undoOfflineDelete(context, {
      deleteOpId: "op-delete-one",
      expense: original,
      deleteActivityId: "activity-delete-one",
      now: baseNow + 4_000,
      opId: "op-restore-unused",
      activity: activityFixture({ id: "activity-restore-unused" }),
    });

    assert.equal(cancelled.synchronized, false);
    assert.equal(cancelled.state.expenses[0].deletedAt, null);
    assert.equal(cancelled.state.outboxCount, 0);

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
    assert.equal(restored.state.outboxCount, 1);
    assert.equal(restored.state.expenses[0].deletedAt, null);
    assert.equal(
      compareMutationVersions(restored.state.expenses[0].mutationVersion, secondDelete.rawExpenses[0].mutationVersion),
      1,
    );
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
  return {
    results: batch.map(({ opId }) => ({ opId, status: "applied" })),
    expenses: batch
      .map((operation) => operation.type === "delete"
        ? { ...expenseFixture(), mutationVersion: operation.mutationVersion, updatedAt: operation.createdAt, deletedAt: operation.createdAt }
        : operation.expense),
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
