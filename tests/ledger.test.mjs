import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import itinerary from "../src/data/itinerary.generated.json" with { type: "json" };
import { formatCurrencyAmount, supportedCurrencies } from "../src/lib/currency.js";
import {
  applyExpenseEdit,
  applyExpenseTemplate,
  calculateLedger,
  createCapturedExpense,
  expenseTemplates,
  expenseToEditableForm,
  formatCategoryLabel,
  formatStatusLabel,
  formatTotals,
  parseBankMessage,
} from "../src/lib/ledger.js";
import {
  buildDayLookup,
  countLegacyExpenses,
  scopeTripExpenses,
  summarizeByBase,
  summarizeByDay,
} from "../src/lib/ledgerSummary.js";

const bookingSql = fs.readFileSync("supabase/migrations/20261025091000_seed_nz2027_bookings.sql", "utf8");
const bookings = parseSeedRows(bookingSql);

describe("two-person travel ledger", () => {
  it("accepts NZD alongside CNY and AUD and formats each with its own symbol", () => {
    assert.deepEqual(supportedCurrencies, ["NZD", "CNY", "AUD"]);
    assert.equal(formatCurrencyAmount("NZD", 1546.31), "NZ$1,546.31");
    assert.equal(formatCurrencyAmount("CNY", 1962.74), "¥1,962.74");
    assert.equal(formatCurrencyAmount("AUD", 12), "A$12.00");
  });

  it("seeds exactly the booked costs from the 2027 itinerary in their original currencies", () => {
    assert.equal(bookings.length, 10);
    const ledger = calculateLedger(bookings);

    assert.deepEqual(Object.keys(ledger.currencies), ["NZD", "CNY"]);
    assert.equal(ledger.currencies.NZD.paid, 1546.31);
    assert.equal(ledger.currencies.NZD.pending, 1454.87);
    assert.equal(ledger.currencies.NZD.total, 3001.18);
    assert.equal(ledger.currencies.CNY.paid, 0);
    assert.equal(ledger.currencies.CNY.pending, 1962.74);
    assert.equal(ledger.currencies.CNY.total, 1962.74);
  });

  it("keeps currencies apart and splits paid from pending without any couple share", () => {
    const ledger = calculateLedger([
      expense({ id: "a", currency: "NZD", amount: 100, status: "confirmed", category: "dining" }),
      expense({ id: "b", currency: "NZD", amount: 40.5, status: "draft", category: "dining" }),
      expense({ id: "c", currency: "CNY", amount: 300, status: "confirmed", category: "酒店" }),
      expense({ id: "deleted", currency: "NZD", amount: 999, deletedAt: "2027-02-01T00:00:00.000Z" }),
    ]);

    assert.deepEqual(ledger.currencies.NZD, { total: 140.5, paid: 100, pending: 40.5, count: 2, pendingCount: 1 });
    assert.deepEqual(ledger.currencies.CNY, { total: 300, paid: 300, pending: 0, count: 1, pendingCount: 0 });
    assert.equal(ledger.categoriesByCurrency.NZD.dining, 140.5);
    assert.equal("eachCoupleShare" in ledger.currencies.NZD, false);
    assert.equal("netOtherOwesUs" in ledger.currencies.NZD, false);
  });

  it("formats multi-currency totals without converting them", () => {
    assert.equal(formatTotals({ NZD: { total: 10, pending: 0 }, CNY: { total: 20, pending: 5 } }, "total"), "NZ$10.00 + ¥20.00");
    assert.equal(formatTotals({ NZD: { total: 10, pending: 0 } }, "pending"), "—");
  });

  it("labels statuses as paid and pending", () => {
    assert.equal(formatStatusLabel("confirmed"), "已付");
    assert.equal(formatStatusLabel("draft"), "待付");
  });

  it("offers templates for the NZ road trip", () => {
    assert.deepEqual(expenseTemplates.map((template) => template.label), [
      "餐饮",
      "超市补给",
      "油费",
      "停车",
      "打车 / Uber",
      "门票 / 活动",
    ]);
  });

  it("presents stored categories with traveler-facing Chinese labels", () => {
    assert.equal(formatCategoryLabel("dining"), "餐饮");
    assert.equal(formatCategoryLabel("酒店"), "住宿");
    assert.equal(formatCategoryLabel("机票"), "机票");
  });

  it("always writes the database-compatible payer and split fields", () => {
    const captured = createCapturedExpense({ id: "x", item: "Kika", amount: "186.50", currency: "NZD", payer: "them", splitSettled: true });
    assert.equal(captured.payer, "us");
    assert.equal(captured.splitSettled, false);
    assert.equal(captured.amount, 186.5);

    const template = applyExpenseTemplate(
      { id: "", category: "其他", item: "", date: "2027-02-09", currency: "NZD", amount: "88.50", payer: "them", status: "draft", note: "Mount Iron", splitSettled: true },
      "fuel",
      new Date("2027-02-10T10:30:00"),
    );
    assert.equal(template.category, "交通");
    assert.equal(template.item, "油费");
    assert.equal(template.date, "2027-02-09");
    assert.equal(template.payer, "us");
    assert.equal(template.status, "confirmed");
    assert.equal(template.splitSettled, false);
    assert.equal(template.amount, "88.50");
    assert.equal(template.note, "Mount Iron");

    const undated = applyExpenseTemplate({ date: "" }, "dining", new Date("2027-02-12T10:30:00"));
    assert.equal(undated.date, "2027-02-12");
  });

  it("turns bank messages into pending drafts with the right currency and trip year", () => {
    const nz = parseBankMessage("02/09 Kika Wanaka card purchase NZ$186.50", new Date("2026-11-01T10:00:00"));
    assert.equal(nz.currency, "NZD");
    assert.equal(nz.amount, 186.5);
    assert.equal(nz.date, "2027-02-09");
    assert.equal(nz.status, "draft");
    assert.equal(nz.payer, "us");

    const au = parseBankMessage("02/03 Spice Alley dinner A$64.00", new Date("2027-02-03T20:00:00"));
    assert.equal(au.currency, "AUD");
    assert.equal(au.category, "dining");
    assert.equal(au.date, "2027-02-03");

    const fuel = parseBankMessage("02/10 Z Energy Frankton NZD 92.10");
    assert.equal(fuel.category, "交通");
  });

  it("applies edits while preserving identity and the stored payer", () => {
    const original = { ...bookings[0], payer: "us" };
    const form = { ...expenseToEditableForm(original), item: "悉尼两晚", amount: "1400.00", note: "改过备注" };

    assert.equal("payer" in expenseToEditableForm(original), false);
    assert.deepEqual(applyExpenseEdit(original, form), {
      ...original,
      item: "悉尼两晚",
      amount: 1400,
      note: "改过备注",
    });
  });
});

describe("ledger summaries", () => {
  const days = buildDayLookup(itinerary);

  it("hides 2026 Australia records from the 2027 ledger but counts them", () => {
    const records = [
      expense({ id: "old", date: "2026-08-09", currency: "AUD" }),
      expense({ id: "new", date: "2027-02-09" }),
      expense({ id: "undated", date: "" }),
      expense({ id: "tomb", date: "2027-02-09", deletedAt: "2027-02-09T00:00:00.000Z" }),
    ];
    assert.deepEqual(scopeTripExpenses(records).map((item) => item.id), ["new", "undated"]);
    assert.equal(countLegacyExpenses(records), 1);
  });

  it("groups by itinerary day with pre-trip bookings first", () => {
    const rows = summarizeByDay([
      expense({ id: "pre", date: "2026-12-01", currency: "NZD", amount: 50 }),
      expense({ id: "d9a", date: "2027-02-09", currency: "NZD", amount: 100 }),
      expense({ id: "d9b", date: "2027-02-09", currency: "NZD", amount: 20, status: "draft" }),
      expense({ id: "d2", date: "2027-02-02", currency: "AUD", amount: 30 }),
    ], days);

    assert.deepEqual(rows.map((row) => row.key), ["before", "2027-02-02", "2027-02-09"]);
    assert.equal(rows[0].label, "行前预订");
    assert.match(rows[2].label, /^D09 · 02\.09/);
    assert.deepEqual(rows[2].totals.NZD, { paid: 100, pending: 20, total: 120 });
  });

  it("groups by the city where you sleep that night", () => {
    const rows = summarizeByBase(bookings, days);
    const byCity = Object.fromEntries(rows.map((row) => [row.key, row]));

    assert.deepEqual(rows.map((row) => row.key), ["Sydney", "Christchurch", "Twizel", "Wānaka", "Te Anau", "Queenstown", "Auckland"]);
    assert.equal(byCity["Wānaka"].totals.NZD.total, 433.55);
    assert.equal(byCity["Te Anau"].totals.NZD.total, 1061);
    assert.equal(byCity.Sydney.totals.CNY.pending, 1361.31);
    assert.equal(byCity.Auckland.detail, "D15");
  });

  it("falls back to date-only groups when the itinerary is not loaded", () => {
    const rows = summarizeByDay([expense({ id: "x", date: "2027-02-09" })], []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, "before");
  });
});

function expense(overrides) {
  return {
    id: "expense",
    category: "dining",
    item: "Dinner",
    date: "2027-02-09",
    currency: "NZD",
    amount: 10,
    payer: "us",
    status: "confirmed",
    note: "",
    splitSettled: false,
    deletedAt: null,
    ...overrides,
  };
}

function parseSeedRows(sql) {
  const pattern = /\('(nz27-[^']+)', '([^']+)', '([^']+)', date '(\d{4}-\d{2}-\d{2})', '([A-Z]{3})', ([0-9.]+)(?:::numeric\(12, 2\))?, '(confirmed|draft)',\s*'([^']*)', \d+\)/g;
  return [...sql.matchAll(pattern)].map((match) => expense({
    id: match[1],
    category: match[2],
    item: match[3],
    date: match[4],
    currency: match[5],
    amount: Number(match[6]),
    status: match[7],
    note: match[8],
  }));
}
