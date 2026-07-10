import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDeleteOperation,
  createSynchronizedDeleteUndoOperation,
  createUpsertOperation,
} from "../src/lib/operation.js";
import { compareMutationVersions } from "../src/lib/mutationVersion.js";

const createdAt = "2026-07-10T00:00:00.000Z";
const mutationVersion = "1780000000000-000001-browser-a";

describe("durable expense operations", () => {
  it("creates the exact upsert operation shape without attachment projections", () => {
    const expense = expenseFixture();
    const activity = activityFixture();

    const operation = createUpsertOperation({
      opId: "op-one",
      expense,
      activity,
      createdAt,
    });

    assert.deepEqual(Object.keys(operation), [
      "opId",
      "type",
      "expenseId",
      "mutationVersion",
      "expense",
      "activity",
      "createdAt",
    ]);
    assert.deepEqual(operation, {
      opId: "op-one",
      type: "upsert",
      expenseId: "expense-one",
      mutationVersion,
      expense: {
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
        mutationVersion,
        updatedAt: createdAt,
        deletedAt: null,
      },
      activity,
      createdAt,
    });
    assert.notStrictEqual(operation.expense, expense);
    assert.notStrictEqual(operation.activity, activity);
  });

  it("rejects invalid upsert metadata, timestamps, expense data, and activity mismatches", () => {
    const valid = () => ({
      opId: "op-one",
      expense: expenseFixture(),
      activity: activityFixture(),
      createdAt,
    });
    const invalidInputs = [
      { ...valid(), opId: "" },
      { ...valid(), createdAt: "not-a-timestamp" },
      { ...valid(), expense: expenseFixture({ mutationVersion: "not-a-version" }) },
      { ...valid(), expense: expenseFixture({ updatedAt: "2026-02-30T00:00:00.000Z" }) },
      { ...valid(), expense: expenseFixture({ deletedAt: createdAt }) },
      { ...valid(), expense: expenseFixture({ amount: Number.NaN }) },
      { ...valid(), expense: expenseFixture({ date: "2026-02-30" }) },
      { ...valid(), activity: activityFixture({ expenseId: "expense-two" }) },
      { ...valid(), activity: activityFixture({ item: "Wrong item" }) },
      { ...valid(), activity: activityFixture({ createdAt: "" }) },
    ];

    for (const input of invalidInputs) {
      assert.throws(() => createUpsertOperation(input), TypeError);
    }
  });

  it("accepts valid database ISO timestamps with microsecond precision", () => {
    const databaseTimestamp = "2026-07-10T00:00:00.123456+00:00";

    assert.doesNotThrow(() => createUpsertOperation({
      opId: "op-microseconds",
      expense: expenseFixture({ updatedAt: databaseTimestamp }),
      activity: activityFixture({ createdAt: databaseTimestamp }),
      createdAt: databaseTimestamp,
    }));
  });

  it("creates a delete operation with a null expense and validates its tombstone", () => {
    const deletedAt = "2026-07-10T00:01:00.000Z";
    const deleteVersion = "1780000060000-000000-browser-a";
    const expense = expenseFixture({
      mutationVersion: deleteVersion,
      updatedAt: deletedAt,
      deletedAt,
    });
    const activity = activityFixture({
      id: "activity-delete",
      action: "delete",
      summary: "Deleted dinner",
      createdAt: deletedAt,
    });

    const operation = createDeleteOperation({
      opId: "op-delete",
      expense,
      activity,
      createdAt: deletedAt,
    });

    assert.deepEqual(operation, {
      opId: "op-delete",
      type: "delete",
      expenseId: "expense-one",
      mutationVersion: deleteVersion,
      expense: null,
      activity,
      createdAt: deletedAt,
    });
    assert.throws(() => createDeleteOperation({
      opId: "op-delete",
      expense: expenseFixture(),
      activity,
      createdAt: deletedAt,
    }), TypeError);
    assert.throws(() => createDeleteOperation({
      opId: "op-delete",
      expense,
      activity: { ...activity, action: "edit" },
      createdAt: deletedAt,
    }), TypeError);
  });

  it("turns synchronized-delete Undo into a strictly newer upsert", () => {
    const deletedAt = "2026-07-10T00:01:00.000Z";
    const deleteVersion = "1780000060000-000000-browser-a";
    const original = expenseFixture();
    const deleted = createDeleteOperation({
      opId: "op-delete",
      expense: expenseFixture({
        mutationVersion: deleteVersion,
        updatedAt: deletedAt,
        deletedAt,
      }),
      activity: activityFixture({
        id: "activity-delete",
        action: "delete",
        summary: "Deleted dinner",
        createdAt: deletedAt,
      }),
      createdAt: deletedAt,
    });
    const now = 1780000000000;

    const undo = createSynchronizedDeleteUndoOperation({
      deletedOperation: deleted,
      expense: original,
      activity: activityFixture({
        id: "activity-undo",
        action: "edit",
        summary: "Restored dinner",
      }),
      opId: "op-undo",
      clientId: "browser-undo",
      now,
    });

    assert.equal(undo.type, "upsert");
    assert.equal(undo.expense.deletedAt, null);
    assert.equal(undo.mutationVersion, undo.expense.mutationVersion);
    assert.equal(compareMutationVersions(undo.mutationVersion, deleteVersion), 1);
    assert.equal(undo.createdAt, new Date(now).toISOString());
    assert.equal(undo.expense.updatedAt, undo.createdAt);
    assert.equal(undo.activity.createdAt, undo.createdAt);
    assert.equal(original.mutationVersion, mutationVersion);
  });
});

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
    mutationVersion,
    updatedAt: createdAt,
    deletedAt: null,
    attachmentName: "receipt.jpg",
    attachmentPath: "expense-one/receipt.jpg",
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
    createdAt,
    ...overrides,
  };
}
