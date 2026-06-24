import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { seedExpenses } from "../src/lib/ledger.js";
import { shouldUploadLocalCache } from "../src/lib/sync.js";

describe("expense sync bootstrap", () => {
  it("uploads local cache when it edits the same remote records", () => {
    const local = seedExpenses.map((expense) =>
      expense.id === "car-atherton"
        ? { ...expense, item: "凯恩斯租车含保险", currency: "AUD", amount: 279.51, note: "" }
        : expense
    );

    assert.equal(shouldUploadLocalCache(local, seedExpenses), true);
  });

  it("does not upload stale local cache over a different remote set", () => {
    const remote = [
      ...seedExpenses,
      { ...seedExpenses[0], id: "new-remote-expense", item: "New remote expense" },
    ];

    assert.equal(shouldUploadLocalCache(seedExpenses, remote), false);
  });
});
