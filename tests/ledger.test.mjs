import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateLedger,
  parseBankMessage,
  seedExpenses,
} from "../src/lib/ledger.js";

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
});
