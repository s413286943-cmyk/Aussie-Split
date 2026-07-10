import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDeleteOperation, createUpsertOperation } from "../src/lib/operation.js";
import {
  acknowledgedOperationIds,
  flushPendingOperations,
  mergeRemoteSnapshot,
  syncStateLabel,
  visibleExpenses,
} from "../src/lib/syncEngine.js";

const serverTime = "2026-07-10T00:05:00.000Z";
const serverMillis = Date.parse(serverTime);

describe("remote snapshot merge", () => {
  it("uses canonical LWW, retains tombstones, reapplies pending operations, and dedupes activity", () => {
    const remoteNewer = expenseFixture({
      id: "expense-one",
      item: "Remote newer",
      mutationVersion: version(-4_000, 2, "remote-b"),
      updatedAt: timestamp(-4_000),
    });
    const remoteOlderDuplicate = expenseFixture({
      id: "expense-one",
      item: "Remote older duplicate",
      mutationVersion: version(-5_000, 8, "remote-z"),
      updatedAt: timestamp(-5_000),
    });
    const remoteTombstone = expenseFixture({
      id: "expense-remote-delete",
      item: "Already deleted",
      mutationVersion: version(-3_000, 0, "remote-a"),
      updatedAt: timestamp(-3_000),
      deletedAt: timestamp(-3_000),
    });
    const remoteForLocalDelete = expenseFixture({
      id: "expense-local-delete",
      item: "Delete locally",
      mutationVersion: version(-5_000, 0, "remote-a"),
      updatedAt: timestamp(-5_000),
    });
    const localEdit = createUpsertOperation({
      opId: "op-local-edit",
      expense: expenseFixture({
        id: "expense-one",
        item: "Pending local edit",
        mutationVersion: version(-2_000, 0, "local-a"),
        updatedAt: timestamp(-2_000),
      }),
      activity: activityFixture({
        id: "activity-local-edit",
        expenseId: "expense-one",
        item: "Pending local edit",
        createdAt: timestamp(-2_000),
      }),
      createdAt: timestamp(-2_000),
    });
    const localDeleteTime = timestamp(-1_000);
    const localDelete = createDeleteOperation({
      opId: "op-local-delete",
      expense: expenseFixture({
        id: "expense-local-delete",
        item: "Delete locally",
        mutationVersion: version(-1_000, 0, "local-a"),
        updatedAt: localDeleteTime,
        deletedAt: localDeleteTime,
      }),
      activity: activityFixture({
        id: "activity-local-delete",
        expenseId: "expense-local-delete",
        action: "delete",
        item: "Delete locally",
        summary: "Deleted locally",
        createdAt: localDeleteTime,
      }),
      createdAt: localDeleteTime,
    });
    const duplicateActivity = activityFixture({
      id: "activity-remote",
      expenseId: "expense-one",
      item: "Remote newer",
      createdAt: timestamp(-4_000),
    });
    const snapshot = {
      expenses: [remoteNewer, remoteOlderDuplicate, remoteTombstone, remoteForLocalDelete],
      activity: [duplicateActivity, { ...duplicateActivity }],
      serverTime,
    };

    const merged = mergeRemoteSnapshot(snapshot, [localDelete, localEdit]);

    assert.equal(merged.expenses.length, 3);
    assert.equal(merged.expenses.find((expense) => expense.id === "expense-one").item, "Pending local edit");
    assert.equal(
      merged.expenses.find((expense) => expense.id === "expense-remote-delete").deletedAt,
      remoteTombstone.deletedAt,
    );
    assert.equal(
      merged.expenses.find((expense) => expense.id === "expense-local-delete").deletedAt,
      localDeleteTime,
    );
    assert.deepEqual(visibleExpenses(merged.expenses).map((expense) => expense.id), ["expense-one"]);
    assert.deepEqual(new Set(merged.activity.map((activity) => activity.id)), new Set([
      "activity-remote",
      "activity-local-edit",
      "activity-local-delete",
    ]));
    assert.equal(merged.activity.length, 3);
    assert.equal(snapshot.expenses[0].item, "Remote newer");
  });

  it("rejects invalid snapshot timestamps and remote versions over five minutes ahead", () => {
    const validSnapshot = () => ({
      expenses: [expenseFixture()],
      activity: [activityFixture()],
      serverTime,
    });
    const invalidSnapshots = [
      { ...validSnapshot(), serverTime: "" },
      { ...validSnapshot(), serverTime: "2026-02-30T00:00:00.000Z" },
      { ...validSnapshot(), expenses: [expenseFixture({ updatedAt: "" })] },
      {
        ...validSnapshot(),
        expenses: [expenseFixture({ deletedAt: "not-a-timestamp" })],
      },
      { ...validSnapshot(), activity: [activityFixture({ createdAt: "" })] },
    ];

    for (const snapshot of invalidSnapshots) {
      assert.throws(() => mergeRemoteSnapshot(snapshot), TypeError);
    }

    assert.throws(
      () => mergeRemoteSnapshot({
        ...validSnapshot(),
        expenses: [expenseFixture({
          mutationVersion: version(300_001, 0, "remote-future"),
        })],
      }),
      /remote mutation version is too far in the future/i,
    );
    assert.doesNotThrow(() => mergeRemoteSnapshot({
      expenses: [],
      activity: [],
      serverTime,
    }, [createUpsertOperation({
      opId: "op-local-future",
      expense: expenseFixture({
        mutationVersion: version(600_000, 0, "local-future"),
        updatedAt: timestamp(1_000),
      }),
      activity: activityFixture({
        id: "activity-local-future",
        createdAt: timestamp(1_000),
      }),
      createdAt: timestamp(1_000),
    })]));
  });

  it("does not let a stale pending operation overwrite a newer remote row", () => {
    const remote = expenseFixture({
      item: "Remote winner",
      mutationVersion: version(-1_000, 0, "remote-a"),
      updatedAt: timestamp(-1_000),
    });
    const staleLocal = createUpsertOperation({
      opId: "op-stale-local",
      expense: expenseFixture({
        item: "Stale local",
        mutationVersion: version(-2_000, 0, "local-a"),
        updatedAt: timestamp(-2_000),
      }),
      activity: activityFixture({
        id: "activity-stale-local",
        item: "Stale local",
        createdAt: timestamp(-2_000),
      }),
      createdAt: timestamp(-2_000),
    });

    const merged = mergeRemoteSnapshot({ expenses: [remote], activity: [], serverTime }, [staleLocal]);

    assert.equal(merged.expenses[0].item, "Remote winner");
    assert.equal(merged.activity.some((activity) => activity.id === "activity-stale-local"), false);
  });

  it("keeps the authenticated remote row when an idempotent retry has the same version", () => {
    const sharedVersion = version(-1_000, 0, "local-a");
    const remote = expenseFixture({
      item: "Canonical remote",
      mutationVersion: sharedVersion,
      updatedAt: timestamp(-1_000),
      attachmentName: "server-receipt.jpg",
    });
    const retry = createUpsertOperation({
      opId: "op-retry",
      expense: expenseFixture({
        item: "Local retry payload",
        mutationVersion: sharedVersion,
        updatedAt: timestamp(-1_000),
      }),
      activity: activityFixture({
        id: "activity-retry",
        item: "Local retry payload",
        createdAt: timestamp(-1_000),
      }),
      createdAt: timestamp(-1_000),
    });

    const merged = mergeRemoteSnapshot({ expenses: [remote], activity: [], serverTime }, [retry]);

    assert.equal(merged.expenses[0].item, "Canonical remote");
    assert.equal(merged.expenses[0].attachmentName, "server-receipt.jpg");
    assert.equal(merged.activity[0].id, "activity-retry");
  });
});

describe("operation acknowledgements", () => {
  it("dedupes applied acknowledgements and treats stale operations as acknowledged", () => {
    const pending = [
      { opId: "op-applied" },
      { opId: "op-stale" },
      { opId: "op-unacknowledged" },
    ];
    const results = [
      { opId: "op-applied", status: "applied" },
      { opId: "op-applied", status: "applied" },
      { opId: "op-stale", status: "stale" },
      { opId: "op-unacknowledged", status: "failed" },
      { opId: "op-not-in-batch", status: "applied" },
    ];

    assert.deepEqual(acknowledgedOperationIds(results, pending), ["op-applied", "op-stale"]);
    assert.deepEqual(acknowledgedOperationIds(results, []), []);
  });
});

describe("sync state labels", () => {
  it("returns the exact Chinese state for synced, pending, syncing, and failed work", () => {
    assert.equal(syncStateLabel({ pendingCount: 0 }), "已同步");
    assert.equal(syncStateLabel({ pendingCount: 3 }), "已本机保存，待同步（3）");
    assert.equal(syncStateLabel({ pendingCount: 3, syncing: true }), "正在同步");
    assert.equal(syncStateLabel({ pendingCount: 3, syncing: true, failed: true }), "同步失败，可重试");
    assert.throws(() => syncStateLabel({ pendingCount: -1 }), TypeError);
  });
});

describe("fenced outbox flush", () => {
  it("refreshes and commits one server snapshot when the outbox is already empty", async () => {
    const sentBatchSizes = [];
    let commits = 0;
    const storage = memorySyncStorage([], {
      commit(input) {
        commits += 1;
        assert.deepEqual(input.acknowledgedOpIds, []);
        assert.equal(input.snapshot.serverTime, serverTime);
        return { accepted: true };
      },
    });

    const result = await flushPendingOperations({
      storage,
      owner: "tab-a",
      now: () => 1000,
      async sendOperations(batch) {
        sentBatchSizes.push(batch.length);
        return syncResponse([]);
      },
    });

    assert.deepEqual(sentBatchSizes, [0]);
    assert.equal(commits, 1);
    assert.deepEqual(result, {
      acquired: true,
      completed: true,
      reason: null,
      batches: 0,
      acknowledged: 0,
    });
  });

  it("drains bounded batches and commits applied and stale acknowledgements", async () => {
    const outbox = Array.from({ length: 205 }, (_, index) => ({ opId: `op-${index}` }));
    const sentBatchSizes = [];
    const commits = [];
    let renewals = 0;
    let released = 0;
    const storage = {
      async acquireSyncLease(options) {
        assert.deepEqual(options, { owner: "tab-a", now: 1000, ttlMs: 30_000 });
        return { owner: "tab-a", fence: 7 };
      },
      async renewSyncLease(options) {
        assert.equal(options.owner, "tab-a");
        assert.equal(options.fence, 7);
        assert.equal(options.ttlMs, 30_000);
        renewals += 1;
        return { accepted: true, owner: "tab-a", fence: 7 };
      },
      async getOutboxBatch(limit) {
        assert.equal(limit, 100);
        return outbox.slice(0, 150);
      },
      async commitSyncResponse(input) {
        assert.equal(input.owner, "tab-a");
        assert.equal(input.fence, 7);
        assert.equal(input.mergeRemoteSnapshot, mergeRemoteSnapshot);
        commits.push(input);
        const acknowledged = new Set(input.acknowledgedOpIds);
        for (let index = outbox.length - 1; index >= 0; index -= 1) {
          if (acknowledged.has(outbox[index].opId)) outbox.splice(index, 1);
        }
        return { accepted: true };
      },
      async releaseSyncLease(options) {
        assert.deepEqual(options, { owner: "tab-a", fence: 7 });
        released += 1;
        return true;
      },
    };

    const result = await flushPendingOperations({
      storage,
      owner: "tab-a",
      now: () => 1000,
      leaseTtlMs: 30_000,
      async sendOperations(batch) {
        sentBatchSizes.push(batch.length);
        return syncResponse(batch.map((operation, index) => ({
          opId: operation.opId,
          status: index % 2 === 0 ? "applied" : "stale",
        })));
      },
    });

    assert.deepEqual(sentBatchSizes, [100, 100, 5]);
    assert.equal(commits.length, 3);
    assert.equal(commits.every((commit) => commit.snapshot.results === undefined), true);
    assert.equal(renewals, 6);
    assert.equal(released, 1);
    assert.equal(outbox.length, 0);
    assert.deepEqual(result, {
      acquired: true,
      completed: true,
      reason: null,
      batches: 3,
      acknowledged: 205,
    });
  });

  it("leaves every unacknowledged operation queued and stops instead of spinning", async () => {
    const outbox = [{ opId: "op-one" }, { opId: "op-two" }];
    let sends = 0;
    const storage = memorySyncStorage(outbox);

    const result = await flushPendingOperations({
      storage,
      owner: "tab-a",
      now: () => 1000,
      async sendOperations() {
        sends += 1;
        return syncResponse([{ opId: "op-one", status: "applied" }]);
      },
    });

    assert.equal(sends, 1);
    assert.deepEqual(outbox.map(({ opId }) => opId), ["op-two"]);
    assert.deepEqual(result, {
      acquired: true,
      completed: false,
      reason: "unacknowledged_operations",
      batches: 1,
      acknowledged: 1,
    });
  });

  it("does not commit a response after lease ownership or fencing is lost", async () => {
    let commits = 0;
    let renewals = 0;
    const storage = memorySyncStorage([{ opId: "op-one" }], {
      renew() {
        renewals += 1;
        return renewals === 1;
      },
      commit() {
        commits += 1;
        return { accepted: true };
      },
    });

    const result = await flushPendingOperations({
      storage,
      owner: "tab-a",
      now: () => 1000,
      async sendOperations(batch) {
        return syncResponse(batch.map(({ opId }) => ({ opId, status: "applied" })));
      },
    });

    assert.equal(commits, 0);
    assert.equal(result.reason, "lease_lost");
  });

  it("retries the same op id after an ambiguous 502 without acknowledging it", async () => {
    const outbox = [{ opId: "op-ambiguous" }];
    const storage = memorySyncStorage(outbox);
    const sentIds = [];
    const upstreamError = Object.assign(new Error("Bad gateway"), { status: 502 });

    await assert.rejects(
      () => flushPendingOperations({
        storage,
        owner: "tab-a",
        now: () => 1000,
        async sendOperations(batch) {
          sentIds.push(batch[0].opId);
          throw upstreamError;
        },
      }),
      (error) => error === upstreamError,
    );
    assert.deepEqual(outbox.map(({ opId }) => opId), ["op-ambiguous"]);

    await flushPendingOperations({
      storage,
      owner: "tab-a",
      now: () => 2000,
      async sendOperations(batch) {
        sentIds.push(batch[0].opId);
        return syncResponse([{ opId: batch[0].opId, status: "applied" }]);
      },
    });

    assert.deepEqual(sentIds, ["op-ambiguous", "op-ambiguous"]);
    assert.equal(outbox.length, 0);
  });
});

function syncResponse(results) {
  return {
    results,
    expenses: [],
    activity: [],
    serverTime,
  };
}

function memorySyncStorage(outbox, hooks = {}) {
  let fence = 0;
  let lease = null;
  return {
    async acquireSyncLease({ owner }) {
      fence += 1;
      lease = { owner, fence };
      return lease;
    },
    async renewSyncLease(input) {
      const accepted = hooks.renew ? hooks.renew(input) : true;
      return { accepted, ...lease };
    },
    async getOutboxBatch(limit) {
      return outbox.slice(0, limit);
    },
    async commitSyncResponse(input) {
      if (hooks.commit) return hooks.commit(input);
      if (!lease || input.owner !== lease.owner || input.fence !== lease.fence) {
        return { accepted: false };
      }
      const acknowledged = new Set(input.acknowledgedOpIds);
      for (let index = outbox.length - 1; index >= 0; index -= 1) {
        if (acknowledged.has(outbox[index].opId)) outbox.splice(index, 1);
      }
      return { accepted: true };
    },
    async releaseSyncLease(input) {
      if (lease && input.owner === lease.owner && input.fence === lease.fence) lease = null;
      return true;
    },
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
    mutationVersion: version(-10_000, 0, "fixture"),
    updatedAt: timestamp(-10_000),
    deletedAt: null,
    ...overrides,
  };
}

function activityFixture(overrides = {}) {
  return {
    id: "activity-one",
    expenseId: "expense-one",
    action: "edit",
    item: "Dinner",
    amount: 88.5,
    currency: "AUD",
    summary: "Updated dinner",
    createdAt: timestamp(-10_000),
    ...overrides,
  };
}

function version(offset, counter, clientId) {
  return `${serverMillis + offset}-${String(counter).padStart(6, "0")}-${clientId}`;
}

function timestamp(offset) {
  return new Date(serverMillis + offset).toISOString();
}
