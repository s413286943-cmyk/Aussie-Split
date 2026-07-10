import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { seedExpenses } from "../src/lib/ledger.js";
import {
  allocateExpenseMutation,
  allocatePersistedExpenseMutation,
  createSerialLedgerActionQueue,
  createSerialMutationLockRunner,
  createSyncRequestCoordinator,
  loadMutationState,
  mutationClockLockName,
  observeExpenseMutationVersions,
  parseStoredArray,
  prependExpenseToList,
  prepareBootstrapExpenses,
  removeExpenseFromList,
  replaceExpenseInList,
  restoreExpenseInList,
  saveMutationState,
  shouldUploadLocalCache,
  runWithMutationClockLock,
  withTimeout,
} from "../src/lib/sync.js";
import { compareMutationVersions, parseMutationVersion } from "../src/lib/mutationVersion.js";

const compatibleVersion = "1780000000000-000001-browser-a";
const tripLedgerSource = readFileSync(new URL("../src/components/TripLedgerApp.jsx", import.meta.url), "utf8");

describe("expense sync bootstrap", () => {
  it("uploads local cache when the remote ledger is empty", () => {
    assert.equal(shouldUploadLocalCache(seedExpenses, []), true);
  });

  it("does not upload local cache over existing remote records", () => {
    const local = seedExpenses.map((expense) =>
      expense.id === "car-atherton"
        ? { ...expense, item: "凯恩斯租车含保险", currency: "AUD", amount: 279.51, note: "" }
        : expense
    );

    assert.equal(shouldUploadLocalCache(local, seedExpenses), false);
  });

  it("allocates above observed versions even when the clock moves backward", () => {
    const observed = "1780000005000-000009-browser-b";
    const state = observeExpenseMutationVersions(
      { clientId: "browser-a", highWater: "1780000000000-000001-browser-a" },
      [{ mutationVersion: observed }]
    );
    const allocated = allocateExpenseMutation(
      { id: "expense-1", item: "晚餐" },
      state,
      { now: 1770000000000 }
    );

    assert.equal(allocated.state.highWater, allocated.expense.mutationVersion);
    assert.equal(compareMutationVersions(allocated.expense.mutationVersion, observed), 1);
    assert.deepEqual(parseMutationVersion(allocated.expense.mutationVersion), {
      millis: 1780000005000,
      counter: 10,
      clientId: "browser-a",
    });
  });

  it("assigns ordered versions to every versionless bootstrap row", () => {
    const input = [
      { id: "expense-1", item: "早餐" },
      { id: "expense-2", item: "午餐" },
      { id: "expense-3", item: "晚餐" },
    ];
    const prepared = prepareBootstrapExpenses(
      input,
      { clientId: "browser-a", highWater: "" },
      { now: 1780000000000 }
    );

    assert.equal(input[0].mutationVersion, undefined);
    assert.equal(prepared.expenses.every((expense) => expense.mutationVersion), true);
    assert.equal(compareMutationVersions(prepared.expenses[0].mutationVersion, prepared.expenses[1].mutationVersion), -1);
    assert.equal(compareMutationVersions(prepared.expenses[1].mutationVersion, prepared.expenses[2].mutationVersion), -1);
    assert.equal(prepared.state.highWater, prepared.expenses[2].mutationVersion);
  });

  it("allocates the deletion timestamp together with its reusable tombstone version", () => {
    const allocated = allocateExpenseMutation(
      { id: "expense-1", item: "晚餐", mutationVersion: compatibleVersion },
      { clientId: "browser-a", highWater: compatibleVersion },
      { now: 1780000005000, deleted: true }
    );

    assert.equal(allocated.expense.deletedAt, "2026-05-28T20:26:45.000Z");
    assert.equal(allocated.expense.updatedAt, allocated.expense.deletedAt);
    assert.equal(allocated.expense.mutationVersion, allocated.state.highWater);
  });

  it("persists one browser identity and its mutation high-water mark", () => {
    const storage = memoryStorage();
    let generated = 0;
    const first = loadMutationState(storage, {
      randomUUID: () => {
        generated += 1;
        return "123e4567-e89b-12d3-a456-426614174000";
      },
    });
    const advanced = {
      ...first,
      highWater: compatibleVersion,
    };
    saveMutationState(storage, advanced);
    const second = loadMutationState(storage, {
      randomUUID: () => {
        generated += 1;
        return "00000000-0000-0000-0000-000000000000";
      },
    });

    assert.equal(generated, 1);
    assert.equal(second.clientId, "browser-123e4567-e89b-12d3-a456-426614174000");
    assert.equal(second.highWater, compatibleVersion);
  });

  it("serializes overlapping allocations from two tabs sharing one mutation clock", async () => {
    const storage = memoryStorage();
    const lockRunner = createSerialMutationLockRunner();
    const tabA = loadMutationState(storage, {
      randomUUID: () => "123e4567-e89b-12d3-a456-426614174000",
      tabId: "tab-a",
    });
    const tabB = loadMutationState(storage, {
      randomUUID: () => "00000000-0000-0000-0000-000000000000",
      tabId: "tab-b",
    });

    const allocations = await Promise.all([
      allocatePersistedExpenseMutation(
        { id: "expense-a", item: "早餐" },
        tabA,
        { storage, lockRunner, now: 1780000000000 }
      ),
      allocatePersistedExpenseMutation(
        { id: "expense-b", item: "午餐" },
        tabB,
        { storage, lockRunner, now: 1780000000000 }
      ),
    ]);

    const [firstVersion, secondVersion] = allocations.map((result) => result.expense.mutationVersion);
    assert.notEqual(firstVersion, secondVersion);
    assert.equal(compareMutationVersions(firstVersion, secondVersion), -1);
    assert.equal(storage.getItem("aussie-chill-mutation-high-water-v1"), secondVersion);
  });

  it("requests the origin-wide named Web Lock when the API is available", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let requestedName = "";
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        locks: {
          request(name, task) {
            requestedName = name;
            return Promise.resolve(task());
          },
        },
      },
    });

    try {
      assert.equal(await runWithMutationClockLock(() => "locked"), "locked");
      assert.equal(requestedName, mutationClockLockName);
    } finally {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    }
  });

  it("uses tab identity to avoid duplicate versions when origin-wide locks are unavailable", () => {
    const expense = { id: "expense-1", item: "晚餐" };
    const commonState = { clientId: "browser-stable", highWater: compatibleVersion };
    const fromTabA = allocateExpenseMutation(
      expense,
      { ...commonState, tabId: "tab-a" },
      { now: 1780000000000 }
    );
    const fromTabB = allocateExpenseMutation(
      expense,
      { ...commonState, tabId: "tab-b" },
      { now: 1780000000000 }
    );

    assert.notEqual(fromTabA.expense.mutationVersion, fromTabB.expense.mutationVersion);
    assert.notEqual(
      parseMutationVersion(fromTabA.expense.mutationVersion).clientId,
      parseMutationVersion(fromTabB.expense.mutationVersion).clientId
    );
  });

  it("never lets a stale tab state move persisted high-water backward", () => {
    const storage = memoryStorage({
      "aussie-chill-mutation-client-id-v1": "browser-stable",
      "aussie-chill-mutation-high-water-v1": "1780000005000-000009-browser-newer",
    });
    const saved = saveMutationState(storage, {
      clientId: "browser-stable",
      tabId: "tab-stale",
      highWater: compatibleVersion,
    });

    assert.equal(saved.highWater, "1780000005000-000009-browser-newer");
    assert.equal(
      storage.getItem("aussie-chill-mutation-high-water-v1"),
      "1780000005000-000009-browser-newer"
    );
  });

  it("versions fallback seed rows without treating them as a saved cache upload", () => {
    const savedExpenses = null;
    const initialExpenses = savedExpenses ?? seedExpenses;
    const prepared = prepareBootstrapExpenses(
      initialExpenses,
      { clientId: "browser-a", tabId: "tab-a", highWater: "" },
      { now: 1780000000000 }
    );

    assert.equal(prepared.expenses.length, seedExpenses.length);
    assert.equal(prepared.expenses.every((expense) => expense.mutationVersion), true);
    assert.equal(shouldUploadLocalCache(savedExpenses, []), false);
  });

  it("keeps separate fallback runners distinct without regressing shared storage", async () => {
    const storage = memoryStorage({
      "aussie-chill-mutation-client-id-v1": "browser-stable",
      "aussie-chill-mutation-high-water-v1": compatibleVersion,
    });
    const state = { clientId: "browser-stable", highWater: compatibleVersion };
    const [fromTabA, fromTabB] = await Promise.all([
      allocatePersistedExpenseMutation(
        { id: "expense-a", item: "早餐" },
        { ...state, tabId: "tab-a" },
        { storage, lockRunner: createSerialMutationLockRunner(), now: 1780000000000 }
      ),
      allocatePersistedExpenseMutation(
        { id: "expense-b", item: "午餐" },
        { ...state, tabId: "tab-b" },
        { storage, lockRunner: createSerialMutationLockRunner(), now: 1780000000000 }
      ),
    ]);

    const versions = [fromTabA.expense.mutationVersion, fromTabB.expense.mutationVersion];
    assert.notEqual(versions[0], versions[1]);
    const greatest = compareMutationVersions(versions[0], versions[1]) > 0 ? versions[0] : versions[1];
    assert.equal(storage.getItem("aussie-chill-mutation-high-water-v1"), greatest);
    saveMutationState(storage, { ...state, tabId: "tab-stale" });
    assert.equal(storage.getItem("aussie-chill-mutation-high-water-v1"), greatest);
  });
});

describe("serialized visible ledger transitions", () => {
  it("preserves two overlapping independent edits", async () => {
    const queue = createSerialLedgerActionQueue();
    const firstStarted = deferred();
    const releaseFirst = deferred();
    let visible = [
      { id: "expense-a", item: "早餐" },
      { id: "expense-b", item: "午餐" },
    ];

    const first = queue(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      visible = replaceExpenseInList(visible, { id: "expense-a", item: "早餐已改" });
    });
    await firstStarted.promise;
    const second = queue(async () => {
      visible = replaceExpenseInList(visible, { id: "expense-b", item: "午餐已改" });
    });
    releaseFirst.resolve();
    await Promise.all([first, second]);

    assert.deepEqual(visible.map((expense) => expense.item), ["早餐已改", "午餐已改"]);
  });

  it("does not let an overlapping edit resurrect a deleted expense", async () => {
    const queue = createSerialLedgerActionQueue();
    const deleteStarted = deferred();
    const releaseDelete = deferred();
    let visible = [
      { id: "expense-a", item: "早餐" },
      { id: "expense-b", item: "午餐" },
    ];

    const deletion = queue(async () => {
      deleteStarted.resolve();
      await releaseDelete.promise;
      visible = removeExpenseFromList(visible, "expense-a");
    });
    await deleteStarted.promise;
    const staleEdit = queue(async () => {
      visible = replaceExpenseInList(visible, { id: "expense-a", item: "不应恢复" });
    });
    releaseDelete.resolve();
    await Promise.all([deletion, staleEdit]);

    assert.deepEqual(visible.map((expense) => expense.id), ["expense-b"]);
  });

  it("supports add, remove, and indexed Undo as pure transitions", () => {
    const original = [{ id: "expense-a", item: "早餐" }];
    const added = prependExpenseToList(original, { id: "expense-b", item: "午餐" });
    const removed = removeExpenseFromList(added, "expense-b");
    const restored = restoreExpenseInList(removed, { id: "expense-b", item: "午餐" }, 0);

    assert.deepEqual(added.map((expense) => expense.id), ["expense-b", "expense-a"]);
    assert.deepEqual(removed.map((expense) => expense.id), ["expense-a"]);
    assert.deepEqual(restored.map((expense) => expense.id), ["expense-b", "expense-a"]);
  });
});

describe("initial ledger read safety", () => {
  it("falls back when cached expense or activity JSON is corrupt", () => {
    assert.deepEqual(parseStoredArray("{not-json", seedExpenses), seedExpenses);
    assert.deepEqual(parseStoredArray('{"unexpected":true}', []), []);
    assert.deepEqual(parseStoredArray('[{"id":"expense-1"}]', []), [{ id: "expense-1" }]);
  });

  it("times out deterministically and ignores a late remote resolution", async () => {
    const remote = deferred();
    let fireTimeout;
    let cleared = 0;
    const bounded = withTimeout(remote.promise, {
      timeoutMs: 7000,
      setTimer(callback, delay) {
        assert.equal(delay, 7000);
        fireTimeout = callback;
        return "timer-1";
      },
      clearTimer(id) {
        assert.equal(id, "timer-1");
        cleared += 1;
      },
    });

    fireTimeout();
    await assert.rejects(bounded, (error) => error?.code === "initial_expense_read_timeout");
    remote.resolve([{ id: "late-expense" }]);
    await Promise.resolve();
    assert.equal(cleared, 0);
  });
});

describe("sync request ordering", () => {
  it("keeps A failed after independent B succeeds", () => {
    const coordinator = createSyncRequestCoordinator();
    const requestA = coordinator.begin("expense-a");
    const requestB = coordinator.begin("expense-b");

    assert.deepEqual(coordinator.settle(requestA, "failed"), { accepted: true, state: "failed" });
    assert.deepEqual(coordinator.settle(requestB, "synced"), { accepted: true, state: "failed" });
    assert.equal(coordinator.current(), "failed");
  });

  it("ignores an old A failure after newer A succeeds", () => {
    const coordinator = createSyncRequestCoordinator();
    const failed = coordinator.begin("expense-a");
    coordinator.settle(failed, "failed");
    const older = coordinator.begin("expense-a");
    const newer = coordinator.begin("expense-a");

    assert.deepEqual(coordinator.settle(newer, "synced"), { accepted: true, state: "synced" });
    assert.deepEqual(coordinator.settle(older, "failed"), { accepted: false, state: "synced" });
    assert.equal(coordinator.current(), "synced");
  });

  it("keeps syncing while A is pending after independent B succeeds", () => {
    const coordinator = createSyncRequestCoordinator();
    coordinator.begin("expense-a");
    const requestB = coordinator.begin("expense-b");

    assert.deepEqual(coordinator.settle(requestB, "synced"), { accepted: true, state: "syncing" });
    assert.equal(coordinator.current(), "syncing");
  });

  it("exposes failed and pending aggregate state for Undo", () => {
    const coordinator = createSyncRequestCoordinator();
    const requestA = coordinator.begin("expense-a");
    coordinator.settle(requestA, "failed");
    coordinator.begin("expense-b");

    assert.equal(coordinator.current(), "failed");
    assert.deepEqual(coordinator.snapshot(), {
      state: "failed",
      expenses: {
        "expense-a": { failed: true, pending: false },
        "expense-b": { failed: false, pending: true },
      },
    });
  });
});

describe("TripLedger durable outbox contract", () => {
  it("routes add, edit, confirm, and delete through the serialized local commit", () => {
    for (const name of ["addExpense", "updateExpense", "confirmExpense", "removeExpense"]) {
      assert.match(functionSource(tripLedgerSource, name), /await commitLedgerMutation\(/);
    }
    const splitSource = functionSource(tripLedgerSource, "toggleSplitSettled");
    assert.match(splitSource, /await onUpdate\(expense, "toggle-split"\)/);
    const updateSource = functionSource(tripLedgerSource, "updateExpense");
    assert.match(updateSource, /action === "toggle-split"/);
    assert.match(updateSource, /setExpenseSplitSettled\(latestExpense/);
  });

  it("commits IndexedDB before updating refs and React state", () => {
    const commitSource = functionSource(tripLedgerSource, "commitLedgerMutation");
    assert.match(commitSource, /ledgerActionQueueRef\.current/);
    assert.match(commitSource, /expensesRef\.current/);
    assert.match(commitSource, /await commitOfflineMutation/);
    assert.match(commitSource, /applyOfflineState/);
    assert.ok(commitSource.indexOf("await commitOfflineMutation") < commitSource.indexOf("applyOfflineState"));
    assert.doesNotMatch(commitSource, /localStorage\.setItem/);
  });

  it("persists one delete operation immediately and retains its id for Undo", () => {
    const removeSource = functionSource(tripLedgerSource, "removeExpense");
    assert.equal((removeSource.match(/await commitLedgerMutation\(/g) || []).length, 1);
    assert.match(removeSource, /type:\s*"delete"/);
    assert.match(removeSource, /opId/);
    assert.match(removeSource, /deleteActivityId/);
    assert.doesNotMatch(tripLedgerSource, /deleteRemoteExpense/);
  });

  it("uses the durable Undo path and only schedules a compensating sync when needed", () => {
    const undoSource = functionSource(tripLedgerSource, "undoDelete");
    assert.match(undoSource, /ledgerActionQueueRef\.current/);
    assert.match(undoSource, /undoOfflineDelete/);
    assert.match(undoSource, /result\.requiresSync/);
    assert.doesNotMatch(undoSource, /deleteRemoteExpense|applyLedgerOperations/);
  });

  it("serializes one reusable sync loop and retries on connectivity lifecycle events", () => {
    const syncSource = functionSource(tripLedgerSource, "requestLedgerSync");
    assert.match(syncSource, /syncPromiseRef\.current/);
    assert.match(syncSource, /syncRequestedRef\.current/);
    assert.match(syncSource, /syncOfflineLedger/);
    assert.match(tripLedgerSource, /addEventListener\("online"/);
    assert.match(tripLedgerSource, /addEventListener\("visibilitychange"/);
    assert.match(tripLedgerSource, /document\.visibilityState === "visible"/);
  });

  it("opens the durable local ledger before enabling actions, then refreshes online", () => {
    const bootstrapSource = functionSource(tripLedgerSource, "initializeLedger");
    assert.match(bootstrapSource, /await initializeOfflineLedger/);
    assert.match(bootstrapSource, /applyOfflineState\(context\.state/);
    assert.ok(bootstrapSource.indexOf("applyOfflineState(context.state") < bootstrapSource.indexOf("setReady(true)"));
    assert.match(bootstrapSource, /requestLedgerSync/);
    assert.equal((tripLedgerSource.match(/setReady\(true\)/g) || []).length, 1);
  });

  it("does not write the ledger or activity arrays back to localStorage", () => {
    assert.doesNotMatch(tripLedgerSource, /aussie-chill-expenses-v1|aussie-chill-activity-v1/);
    assert.doesNotMatch(tripLedgerSource, /localStorage\.setItem\(storageKey|localStorage\.setItem\(activityStorageKey/);
  });
});

function memoryStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}
