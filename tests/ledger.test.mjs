import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyExpenseEdit,
  calculateLedger,
  expenseToEditableForm,
  parseBankMessage,
  seedExpenses,
  setExpenseSplitSettled,
  splitSettledLabel,
} from "../src/lib/ledger.js";
import {
  coupleName,
  formatPayerLabel,
  formatSettlementDirection,
} from "../src/lib/couples.js";

describe("travel split ledger", () => {
  it("seeds the 10 non-flight prepaid expenses", () => {
    assert.equal(seedExpenses.length, 10);
    assert.equal(seedExpenses.some((expense) => /机票|flight/i.test(expense.item)), false);
  });

  it("keeps RMB and AUD totals separate", () => {
    const ledger = calculateLedger(seedExpenses);

    assert.equal(ledger.currencies.CNY.total, 29543.26);
    assert.equal(ledger.currencies.CNY.eachCoupleShare, 14771.63);
    assert.equal(ledger.currencies.CNY.netOtherOwesUs, 14771.63);
    assert.equal(ledger.currencies.AUD.total, 1296.2);
    assert.equal(ledger.currencies.AUD.eachCoupleShare, 648.1);
    assert.equal(ledger.currencies.AUD.netOtherOwesUs, 648.1);
  });

  it("offsets expenses paid by the other couple", () => {
    const ledger = calculateLedger([
      {
        id: "ours",
        category: "dining",
        item: "Dinner",
        date: "2026-08-01",
        currency: "CNY",
        amount: 100,
        payer: "us",
        status: "confirmed",
        note: "",
      },
      {
        id: "theirs",
        category: "transport",
        item: "Taxi",
        date: "2026-08-02",
        currency: "AUD",
        amount: 80,
        payer: "them",
        status: "confirmed",
        note: "",
      },
    ]);

    assert.equal(ledger.currencies.CNY.netOtherOwesUs, 50);
    assert.equal(ledger.currencies.AUD.netOtherOwesUs, -40);
  });

  it("marks an expense as split-settled without changing the ledger math", () => {
    const expense = {
      id: "dinner",
      category: "dining",
      item: "Dinner",
      date: "2026-08-01",
      currency: "CNY",
      amount: 100,
      payer: "us",
      status: "confirmed",
      note: "",
      splitSettled: false,
    };
    const before = calculateLedger([expense]);
    const settledExpense = setExpenseSplitSettled(expense, true);
    const after = calculateLedger([settledExpense]);

    assert.equal(settledExpense.splitSettled, true);
    assert.deepEqual(after, before);
  });

  it("labels split-settled state as pending before it is settled", () => {
    assert.equal(splitSettledLabel(false), "待分摊");
    assert.equal(splitSettledLabel(true), "已分摊");
  });

  it("turns a bank message into a draft expense", () => {
    const draft = parseBankMessage("08/11 Captain Cook Whale Watching card purchase A$340.20");

    assert.equal(draft.amount, 340.2);
    assert.equal(draft.currency, "AUD");
    assert.equal(draft.status, "draft");
    assert.match(draft.item, /Captain Cook/);
  });

  it("classifies dinner messages as dining, not hotels", () => {
    const draft = parseBankMessage("08/12 Dinner at Cafe Sydney card purchase A$220.50");

    assert.equal(draft.category, "dining");
    assert.equal(draft.item.startsWith("/"), false);
  });

  it("uses traveler-facing couple names", () => {
    assert.equal(coupleName("us"), "孙张");
    assert.equal(coupleName("them"), "胡董");
    assert.equal(formatPayerLabel("us"), "孙张付款");
    assert.equal(formatPayerLabel("them"), "胡董付款");
  });

  it("formats settlement direction with couple names", () => {
    assert.equal(formatSettlementDirection(120), "胡董还需给孙张");
    assert.equal(formatSettlementDirection(-80), "孙张还需给胡董");
    assert.equal(formatSettlementDirection(0), "两边已结清");
  });

  it("applies edits while preserving record identity", () => {
    const original = seedExpenses[0];
    const form = {
      ...expenseToEditableForm(original),
      item: "Oaks Melbourne updated",
      amount: "3000.50",
      payer: "them",
      note: "改过备注",
    };

    assert.deepEqual(applyExpenseEdit(original, form), {
      ...original,
      item: "Oaks Melbourne updated",
      amount: 3000.5,
      payer: "them",
      note: "改过备注",
    });
  });
});
