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

describe("TripLedger bridge action contract", () => {
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

  it("keeps allocation, latest-list derivation, cache write, ref, and state update in one queue unit", () => {
    const commitSource = functionSource(tripLedgerSource, "commitLedgerMutation");
    assert.match(commitSource, /ledgerActionQueueRef\.current/);
    assert.match(commitSource, /expensesRef\.current/);
    assert.match(commitSource, /await allocatePersistedExpenseMutation/);
    assert.match(commitSource, /localStorage\.setItem/);
    assert.match(commitSource, /setExpenses/);
  });

  it("preallocates one tombstone and reuses it for final and unmount deletion", () => {
    const removeSource = functionSource(tripLedgerSource, "removeExpense");
    assert.equal((removeSource.match(/await commitLedgerMutation\(/g) || []).length, 1);
    assert.match(removeSource, /\{ deleted: true \}/);
    assert.equal((tripLedgerSource.match(/deleteRemoteExpense\(pending\.tombstone\)/g) || []).length, 2);
  });

  it("keeps pre-sync Undo free of remote deletion", () => {
    const undoSource = functionSource(tripLedgerSource, "undoDelete");
    assert.match(undoSource, /ledgerActionQueueRef\.current/);
    assert.match(undoSource, /renderSyncAggregate\(syncRequestCoordinatorRef\.current\.current\(\)\)/);
    assert.doesNotMatch(undoSource, /setSyncState\(supabaseConfigured \? "已同步"/);
    assert.doesNotMatch(undoSource, /deleteRemoteExpense/);
  });

  it("suppresses stale failure callbacks and keys every remote request by expense", () => {
    const remoteSource = functionSource(tripLedgerSource, "startRemoteSync");
    assert.match(remoteSource, /coordinator\.begin\(expenseId\)/);
    assert.match(remoteSource, /if \(!settled\.accepted\) return/);
    assert.ok(remoteSource.indexOf("if (!settled.accepted) return") < remoteSource.indexOf("onRemoteFailure?.(error)"));

    for (const name of ["addExpense", "updateExpense", "confirmExpense", "finalizePendingDelete"]) {
      assert.match(functionSource(tripLedgerSource, name), /startRemoteSync\([^,]+\.id,/);
    }
  });

  it("versions seed fallback and settles the initial remote read before enabling actions", () => {
    const bootstrapSource = functionSource(tripLedgerSource, "initializeLedger");
    assert.match(bootstrapSource, /savedExpenses \?\? seedExpenses/);
    assert.match(bootstrapSource, /withTimeout\(fetchRemoteExpenses\(\)/);
    assert.ok(bootstrapSource.indexOf("await withTimeout") < bootstrapSource.indexOf("setReady(true)"));
    assert.equal((tripLedgerSource.match(/setReady\(true\)/g) || []).length, 1);
  });
});

describe("Supabase REST compatibility bridge", () => {
  it("falls back to legacy mode only for an explicit missing compatibility column", async () => {
    await withSupabaseModule("legacyProbe", async ({ module, calls }) => {
      const mode = await module.detectExpenseCompatibility();
      const expenses = await module.fetchRemoteExpenses();

      assert.equal(mode, "legacy");
      assert.deepEqual(expenses, []);
      assert.equal(calls.length, 2);
      assert.match(calls[0].url, /select=mutation_version%2Cdeleted_at|select=mutation_version,deleted_at/);
      assert.match(calls[1].url, /expenses\?select=\*&order=date\.asc$/);
    }, [
      jsonResponse(400, {
        code: "42703",
        message: "column expenses.mutation_version does not exist",
      }),
      jsonResponse(200, []),
    ]);
  });

  it("expires legacy detection after a short TTL while compatible mode remains cached", async () => {
    await withSupabaseModule("legacyTtl", async ({ module, calls }) => {
      assert.equal(await module.detectExpenseCompatibility({ now: 1000 }), "legacy");
      assert.equal(await module.detectExpenseCompatibility({ now: 15_999 }), "legacy");
      assert.equal(calls.length, 1);
      assert.equal(await module.detectExpenseCompatibility({ now: 16_000 }), "compatible");
      assert.equal(await module.detectExpenseCompatibility({ now: 999_999 }), "compatible");
      assert.equal(calls.length, 2);
    }, [missingCompatibilityColumnResponse(), jsonResponse(200, [])]);
  });

  it("uses the tombstone filter and maps compatibility fields", async () => {
    await withSupabaseModule("compatibleRead", async ({ module, calls }) => {
      const expenses = await module.fetchRemoteExpenses();

      assert.match(calls[1].url, /deleted_at=is\.null/);
      assert.match(calls[1].url, /order=date\.asc/);
      assert.equal(expenses.length, 1);
      assert.equal(expenses[0].mutationVersion, compatibleVersion);
      assert.equal(expenses[0].updatedAt, "2026-07-10T00:00:01.000Z");
      assert.equal(expenses[0].deletedAt, null);
      assert.equal(expenses[0].splitSettled, true);
    }, [
      jsonResponse(200, []),
      jsonResponse(200, [
        expenseRow({
          mutation_version: compatibleVersion,
          updated_at: "2026-07-10T00:00:01.000Z",
          deleted_at: null,
          split_settled: true,
        }),
        expenseRow({
          id: "expense-deleted",
          mutation_version: "1780000000000-000002-browser-a",
          updated_at: "2026-07-10T00:00:02.000Z",
          deleted_at: "2026-07-10T00:00:02.000Z",
        }),
      ]),
    ]);
  });

  it("does not fall back when the compatibility probe fails unexpectedly", async () => {
    await withSupabaseModule("failedProbe", async ({ module, calls }) => {
      await assert.rejects(() => module.fetchRemoteExpenses(), /Unable to detect Supabase expense schema/);
      assert.equal(calls.length, 1);
    }, [jsonResponse(503, { message: "upstream unavailable secret-token-value" })]);
  });

  it("rejects unauthorized, unrelated, and network probe failures without exposing raw details", async () => {
    const failures = [
      jsonResponse(401, { message: "invalid key secret-token-value" }),
      jsonResponse(400, { code: "PGRST100", message: "unrelated query failure secret-token-value" }),
      new Error("network failed secret-token-value"),
    ];

    for (const [index, failure] of failures.entries()) {
      await withSupabaseModule(`unsafeProbe-${index}`, async ({ module, calls }) => {
        await assert.rejects(
          () => module.detectExpenseCompatibility(),
          (error) => {
            assert.equal(error.code, "expense_schema_probe_failed");
            assert.doesNotMatch(error.message, /secret-token-value/);
            return true;
          }
        );
        assert.equal(calls.length, 1);
      }, [failure]);
    }
  });

  it("strips compatibility fields from legacy upserts", async () => {
    await withSupabaseModule("legacyUpsert", async ({ module, calls }) => {
      await module.upsertRemoteExpense(expenseModel({
        mutationVersion: compatibleVersion,
        updatedAt: "2026-07-10T00:00:01.000Z",
        deletedAt: null,
      }));

      const body = JSON.parse(calls[1].options.body);
      assert.equal(body.split_settled, true);
      assert.equal("mutation_version" in body, false);
      assert.equal("updated_at" in body, false);
      assert.equal("deleted_at" in body, false);
    }, [missingCompatibilityColumnResponse(), emptyResponse()]);
  });

  it("re-probes and retries one legacy upsert after a migration structural error", async () => {
    await withSupabaseModule("legacyUpsertMigration", async ({ module, calls }) => {
      await module.upsertRemoteExpense(expenseModel({ mutationVersion: compatibleVersion }));

      assert.equal(calls.length, 4);
      assert.equal("mutation_version" in JSON.parse(calls[1].options.body), false);
      assert.match(calls[2].url, /select=mutation_version,deleted_at/);
      assert.equal(JSON.parse(calls[3].options.body).mutation_version, compatibleVersion);
    }, [
      missingCompatibilityColumnResponse(),
      jsonResponse(400, { code: "22023", message: "invalid_mutation_version" }),
      jsonResponse(200, []),
      emptyResponse(),
    ]);
  });

  it("does not retry unrelated legacy write failures", async () => {
    await withSupabaseModule("legacyNoRetry", async ({ module, calls }) => {
      await assert.rejects(
        () => module.upsertRemoteExpense(expenseModel({ mutationVersion: compatibleVersion })),
        (error) => error?.code === "remote_write_failed"
      );
      assert.equal(calls.length, 2);
    }, [missingCompatibilityColumnResponse(), jsonResponse(401, { message: "unauthorized" })]);
  });

  it("includes version fields in compatible upserts and rejects missing or malformed versions", async () => {
    await withSupabaseModule("compatibleUpsert", async ({ module, calls }) => {
      await assert.rejects(
        () => module.upsertRemoteExpense(expenseModel({ mutationVersion: undefined })),
        (error) => error?.code === "invalid_mutation_version"
      );
      await assert.rejects(
        () => module.upsertRemoteExpense(expenseModel({ mutationVersion: "bad-version" })),
        (error) => error?.code === "invalid_mutation_version"
      );

      await module.upsertRemoteExpense(expenseModel({
        mutationVersion: compatibleVersion,
        deletedAt: null,
      }));

      assert.equal(calls.length, 2);
      const body = JSON.parse(calls[1].options.body);
      assert.equal(body.mutation_version, compatibleVersion);
      assert.equal(body.deleted_at, null);
    }, [jsonResponse(200, []), emptyResponse()]);
  });

  it("uses physical DELETE in legacy mode and PATCH tombstones in compatible mode", async () => {
    await withSupabaseModule("legacyDelete", async ({ module, calls }) => {
      await module.deleteRemoteExpense({
        id: "expense-1",
        mutationVersion: compatibleVersion,
        deletedAt: "2026-07-10T00:00:03.000Z",
      });

      assert.equal(calls[1].options.method, "DELETE");
      assert.equal(calls[1].options.body, undefined);
    }, [missingCompatibilityColumnResponse(), emptyResponse()]);

    await withSupabaseModule("compatibleDelete", async ({ module, calls }) => {
      await module.deleteRemoteExpense({
        id: "expense-1",
        mutationVersion: compatibleVersion,
        deletedAt: "2026-07-10T00:00:03.000Z",
      });

      assert.equal(calls[1].options.method, "PATCH");
      assert.deepEqual(JSON.parse(calls[1].options.body), {
        mutation_version: compatibleVersion,
        deleted_at: "2026-07-10T00:00:03.000Z",
      });
    }, [jsonResponse(200, []), emptyResponse()]);
  });

  it("re-probes and retries one legacy delete as a compatible tombstone", async () => {
    await withSupabaseModule("legacyDeleteMigration", async ({ module, calls }) => {
      await module.deleteRemoteExpense({
        id: "expense-1",
        mutationVersion: compatibleVersion,
        deletedAt: "2026-07-10T00:00:03.000Z",
      });

      assert.equal(calls.length, 4);
      assert.equal(calls[1].options.method, "DELETE");
      assert.match(calls[2].url, /select=mutation_version,deleted_at/);
      assert.equal(calls[3].options.method, "PATCH");
      assert.deepEqual(JSON.parse(calls[3].options.body), {
        mutation_version: compatibleVersion,
        deleted_at: "2026-07-10T00:00:03.000Z",
      });
    }, [
      missingCompatibilityColumnResponse(),
      jsonResponse(409, { code: "55000", message: "physical_delete_disabled" }),
      jsonResponse(200, []),
      emptyResponse(),
    ]);
  });

  it("surfaces stale writes as a safe typed error", async () => {
    await withSupabaseModule("staleWrite", async ({ module }) => {
      await assert.rejects(
        () => module.upsertRemoteExpense(expenseModel({ mutationVersion: compatibleVersion })),
        (error) => {
          assert.equal(error.name, "RemoteExpenseWriteError");
          assert.equal(error.code, "stale_mutation_version");
          assert.equal(error.status, 409);
          assert.doesNotMatch(error.message, /secret-token-value/);
          return true;
        }
      );
    }, [
      jsonResponse(200, []),
      jsonResponse(409, { code: "40001", message: "stale_mutation_version secret-token-value" }),
    ]);
  });
});

describe("Supabase REST existing behavior", () => {
  it("does not send publishable keys as bearer tokens", async () => {
    await withSupabaseModule("headers", async ({ module, calls }) => {
      await module.fetchRemoteExpenses();

      assert.equal(calls[0].options.headers.apikey, "sb_publishable_test");
      assert.equal("Authorization" in calls[0].options.headers, false);
      assert.equal(calls[1].options.headers.apikey, "sb_publishable_test");
      assert.equal("Authorization" in calls[1].options.headers, false);
    }, [jsonResponse(200, []), jsonResponse(200, [])]);
  });

  it("loads the split-settled flag from remote expenses", async () => {
    await withSupabaseModule("splitSettledFetch", async ({ module }) => {
      const expenses = await module.fetchRemoteExpenses();
      assert.equal(expenses[0].splitSettled, true);
    }, [
      jsonResponse(200, []),
      jsonResponse(200, [expenseRow({ mutation_version: compatibleVersion, split_settled: true })]),
    ]);
  });

  it("saves the split-settled flag to remote expenses", async () => {
    await withSupabaseModule("splitSettledSave", async ({ module, calls }) => {
      await module.upsertRemoteExpense(expenseModel({ mutationVersion: compatibleVersion }));
      assert.equal(JSON.parse(calls[1].options.body).split_settled, true);
    }, [jsonResponse(200, []), emptyResponse()]);
  });

  it("loads remote expense activity newest-first", async () => {
    await withSupabaseModule("activityFetch", async ({ module, calls }) => {
      const activity = await module.fetchRemoteActivity();

      assert.match(calls[0].url, /expense_activity\?select=\*&order=created_at\.desc&limit=8/);
      assert.equal(activity[0].expenseId, "expense-1");
      assert.equal(activity[0].createdAt, "2026-07-30T10:00:00.000Z");
    }, [jsonResponse(200, [activityRow()])]);
  });

  it("inserts remote expense activity without blocking on response rows", async () => {
    await withSupabaseModule("activityInsert", async ({ module, calls }) => {
      await module.insertRemoteActivity({
        id: "activity-1",
        expenseId: "expense-1",
        action: "add",
        item: "晚餐",
        amount: 100,
        currency: "CNY",
        summary: "新增了 ¥100.00 晚餐",
        createdAt: "2026-07-30T10:00:00.000Z",
      });

      assert.match(calls[0].url, /expense_activity$/);
      assert.equal(calls[0].options.method, "POST");
      assert.equal(JSON.parse(calls[0].options.body).expense_id, "expense-1");
      assert.equal(JSON.parse(calls[0].options.body).created_at, "2026-07-30T10:00:00.000Z");
    }, [emptyResponse()]);
  });
});

async function withSupabaseModule(suffix, run, responses) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const calls = [];
  let responseIndex = 0;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_test";
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const response = responses[Math.min(responseIndex, responses.length - 1)];
    responseIndex += 1;
    if (response instanceof Error) throw response;
    return response;
  };

  try {
    const api = await import(`../src/lib/supabaseRest.js?${suffix}=${Date.now()}-${Math.random()}`);
    await run({ module: api, calls });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(originalUrl, originalKey);
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function emptyResponse() {
  return jsonResponse(204, null);
}

function missingCompatibilityColumnResponse() {
  return jsonResponse(400, {
    code: "PGRST204",
    message: "Could not find the 'deleted_at' column of 'expenses' in the schema cache",
  });
}

function expenseRow(overrides = {}) {
  return {
    id: "expense-1",
    category: "dining",
    item: "晚餐",
    date: "2026-08-01",
    currency: "CNY",
    amount: 100,
    payer: "us",
    status: "confirmed",
    note: "",
    attachment_name: "",
    split_settled: false,
    mutation_version: compatibleVersion,
    updated_at: "2026-07-10T00:00:01.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function expenseModel(overrides = {}) {
  return {
    id: "expense-1",
    category: "dining",
    item: "晚餐",
    date: "2026-08-01",
    currency: "CNY",
    amount: 100,
    payer: "us",
    status: "confirmed",
    note: "",
    attachmentName: "",
    splitSettled: true,
    mutationVersion: compatibleVersion,
    updatedAt: "2026-07-10T00:00:01.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function activityRow() {
  return {
    id: "activity-1",
    expense_id: "expense-1",
    action: "add",
    item: "晚餐",
    amount: 100,
    currency: "CNY",
    summary: "新增了 ¥100.00 晚餐",
    created_at: "2026-07-30T10:00:00.000Z",
  };
}

function restoreEnv(originalUrl, originalKey) {
  if (originalUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  }
  if (originalKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  }
}

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
