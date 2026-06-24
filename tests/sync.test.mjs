import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { seedExpenses } from "../src/lib/ledger.js";
import { shouldUploadLocalCache } from "../src/lib/sync.js";

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
});
