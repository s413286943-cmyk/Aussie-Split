import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyExpenseTemplate,
  applyExpenseEdit,
  calculateLedger,
  expenseToEditableForm,
  expenseTemplates,
  formatCategoryLabel,
  parseBankMessage,
  setExpenseSplitSettled,
  splitSettledLabel,
} from "../src/lib/ledger.js";
import { seedExpenses } from "./fixtures/seed-expenses.mjs";
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

  it("keeps historical totals but removes split-settled expenses from the current balance", () => {
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
    assert.equal(before.currencies.CNY.total, 100);
    assert.equal(before.currencies.CNY.netOtherOwesUs, 50);
    assert.equal(after.currencies.CNY.total, 100);
    assert.equal(after.currencies.CNY.eachCoupleShare, 50);
    assert.equal(after.currencies.CNY.pendingTotal, 0);
    assert.equal(after.currencies.CNY.netOtherOwesUs, 0);
    assert.equal(after.categoriesByCurrency.CNY.dining, 100);
    assert.deepEqual(after.pendingCategoriesByCurrency.CNY, {});
  });

  it("calculates settlement totals and category subtotals from pending expenses only", () => {
    const ledger = calculateLedger([
      {
        id: "settled-dinner",
        category: "dining",
        item: "Dinner",
        date: "2026-08-01",
        currency: "CNY",
        amount: 100,
        payer: "us",
        status: "confirmed",
        note: "",
        splitSettled: true,
      },
      {
        id: "pending-dinner",
        category: "dining",
        item: "Dinner 2",
        date: "2026-08-02",
        currency: "CNY",
        amount: 60,
        payer: "us",
        status: "confirmed",
        note: "",
        splitSettled: false,
      },
      {
        id: "pending-taxi",
        category: "交通",
        item: "Taxi",
        date: "2026-08-03",
        currency: "CNY",
        amount: 20,
        payer: "them",
        status: "confirmed",
        note: "",
        splitSettled: false,
      },
    ]);

    assert.equal(ledger.currencies.CNY.total, 180);
    assert.equal(ledger.currencies.CNY.eachCoupleShare, 90);
    assert.equal(ledger.currencies.CNY.pendingTotal, 80);
    assert.equal(ledger.currencies.CNY.pendingEachCoupleShare, 40);
    assert.equal(ledger.currencies.CNY.netOtherOwesUs, 20);
    assert.deepEqual(ledger.pendingCategoriesByCurrency.CNY, {
      dining: 60,
      交通: 20,
    });
  });

  it("labels split-settled state as pending before it is settled", () => {
    assert.equal(splitSettledLabel(false), "待分摊");
    assert.equal(splitSettledLabel(true), "已分摊");
  });

  it("offers high-frequency templates for fast expense entry", () => {
    assert.deepEqual(expenseTemplates.map((template) => template.label), [
      "餐饮",
      "打车 / Uber",
      "停车 / toll",
      "油费",
      "门票 / tour",
      "购物 / 超市",
    ]);
  });

  it("presents stored categories with traveler-facing Chinese labels", () => {
    assert.equal(formatCategoryLabel("dining"), "餐饮");
    assert.equal(formatCategoryLabel("酒店"), "酒店");
  });

  it("applies an expense template without clearing amount or note", () => {
    const next = applyExpenseTemplate(
      {
        id: "",
        category: "其他",
        item: "",
        date: "",
        currency: "AUD",
        amount: "88.50",
        payer: "them",
        status: "draft",
        note: "机场到酒店",
        attachmentName: "",
        splitSettled: true,
      },
      "taxi",
      new Date("2026-08-02T10:30:00"),
    );

    assert.equal(next.category, "交通");
    assert.equal(next.item, "打车 / Uber");
    assert.equal(next.date, "2026-08-02");
    assert.equal(next.payer, "us");
    assert.equal(next.status, "confirmed");
    assert.equal(next.splitSettled, false);
    assert.equal(next.currency, "AUD");
    assert.equal(next.amount, "88.50");
    assert.equal(next.note, "机场到酒店");
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
