import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findDuplicateExpense,
  itemSimilarity,
  validateExpense,
} from "../src/lib/expenseValidation.js";

describe("expense validation", () => {
  it("rejects an empty item", () => {
    assert.deepEqual(validateExpense(expense({ item: "  " })).errors, {
      item: "请填写项目",
    });
  });

  it("rejects zero, negative, non-finite, and more than two-decimal amounts", () => {
    for (const amount of ["0", "-1", "Infinity", "NaN", "12.345"]) {
      const result = validateExpense(expense({ amount }));
      assert.equal(result.valid, false, `${amount} should be invalid`);
      assert.ok(result.errors.amount, `${amount} should return an amount error`);
    }
  });

  it("accepts a positive amount with at most two decimal places", () => {
    for (const amount of ["12", "12.3", "12.30", 12.3]) {
      assert.deepEqual(validateExpense(expense({ amount })), {
        valid: true,
        errors: {},
      });
    }
  });

  it("returns a non-blocking duplicate warning for a similar matching expense", () => {
    const existing = expense({
      id: "existing",
      item: "Oaks Melbourne Hotel",
      amount: 2189.69,
      updatedAt: "2026-07-10T08:00:00.000Z",
    });
    const candidate = expense({
      id: "candidate",
      item: "Oaks Melbourne Hote1",
      amount: "2189.69",
    });

    assert.ok(itemSimilarity(existing.item, candidate.item) >= 0.75);
    assert.equal(findDuplicateExpense(candidate, [existing])?.id, "existing");
  });

  it("does not warn when date, currency, amount, or current id differs", () => {
    const existing = expense({ id: "existing" });

    assert.equal(findDuplicateExpense(expense({ date: "2026-07-30" }), [existing]), null);
    assert.equal(findDuplicateExpense(expense({ currency: "AUD" }), [existing]), null);
    assert.equal(findDuplicateExpense(expense({ amount: "11" }), [existing]), null);
    assert.equal(findDuplicateExpense(expense({ id: "existing" }), [existing]), null);
  });
});

function expense(overrides = {}) {
  return {
    id: "candidate",
    item: "Oaks Melbourne Hotel",
    date: "2026-07-29",
    currency: "CNY",
    amount: "2189.69",
    updatedAt: "2026-07-11T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
