import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createLedgerBackup,
  parseLedgerBackup,
  previewBackupMerge,
} from "../src/lib/backup.js";

describe("ledger backup", () => {
  it("exports a deterministic versioned backup", () => {
    const backup = createLedgerBackup({
      expenses: [expense({ id: "newer" }), expense({ id: "older", updatedAt: "2026-07-10T00:00:00.000Z" })],
      activity: [{ id: "activity-one", createdAt: "2026-07-11T00:00:00.000Z" }],
      exportedAt: "2026-07-11T12:00:00.000Z",
    });

    assert.equal(backup.schemaVersion, 1);
    assert.equal(backup.kind, "aussie-chill-ledger-backup");
    assert.deepEqual(backup.expenses.map((item) => item.id), ["newer", "older"]);
    assert.equal(backup.activityCount, 1);
  });

  it("rejects an unsupported schema version", () => {
    assert.throws(
      () => parseLedgerBackup({ kind: "aussie-chill-ledger-backup", schemaVersion: 2, expenses: [] }),
      /不支持的备份版本/,
    );
  });

  it("merges only missing or newer rows and preserves rows absent from the file", () => {
    const current = [
      expense({ id: "keep", updatedAt: "2026-07-11T10:00:00.000Z" }),
      expense({ id: "replace", item: "旧名称", updatedAt: "2026-07-10T10:00:00.000Z" }),
      expense({ id: "current-newer", updatedAt: "2026-07-12T10:00:00.000Z" }),
    ];
    const backup = createLedgerBackup({
      expenses: [
        expense({ id: "replace", item: "新名称", updatedAt: "2026-07-11T10:00:00.000Z" }),
        expense({ id: "current-newer", updatedAt: "2026-07-11T10:00:00.000Z" }),
        expense({ id: "restore", currency: "AUD", amount: 25, updatedAt: "2026-07-11T10:00:00.000Z" }),
      ],
      exportedAt: "2026-07-11T12:00:00.000Z",
    });

    const preview = previewBackupMerge(backup, current);

    assert.deepEqual(preview.accepted.map((item) => item.id), ["replace", "restore"]);
    assert.deepEqual(preview.skipped.map((item) => item.id), ["current-newer"]);
    assert.deepEqual(preview.merged.map((item) => item.id).sort(), ["current-newer", "keep", "replace", "restore"]);
    assert.equal(preview.merged.find((item) => item.id === "replace").item, "新名称");
    assert.deepEqual(preview.acceptedTotalsByCurrency, { AUD: 25, CNY: 10 });
  });

  it("rejects malformed expense rows instead of partially importing them", () => {
    const backup = createLedgerBackup({ expenses: [expense()] });
    backup.expenses[0].amount = -1;

    assert.throws(() => previewBackupMerge(backup, []), /备份中的费用无效/);
  });

  it("rejects duplicate expense ids instead of applying the same row twice", () => {
    const backup = createLedgerBackup({ expenses: [expense()] });
    backup.expenses.push({ ...backup.expenses[0], updatedAt: "2026-07-12T00:00:00.000Z" });

    assert.throws(() => previewBackupMerge(backup, []), /重复的费用记录/);
  });
});

function expense(overrides = {}) {
  return {
    id: "expense-one",
    category: "dining",
    item: "Dinner",
    date: "2026-07-29",
    currency: "CNY",
    amount: 10,
    payer: "us",
    status: "confirmed",
    note: "",
    splitSettled: false,
    updatedAt: "2026-07-11T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
