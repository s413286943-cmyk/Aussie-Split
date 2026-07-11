import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  buildLedgerSnapshot,
  fetchProtectedLedger,
} from "../scripts/export-ledger-snapshot.mjs";
import { runPython } from "../scripts/pythonRunner.mjs";

const committedSnapshot = JSON.parse(fs.readFileSync("content/ledger-snapshot.json", "utf8"));

describe("ledger snapshot boundary", () => {
  it("exports deterministic active totals without counting drafts or tombstones", () => {
    const snapshot = buildLedgerSnapshot({
      serverTime: "2026-07-11T01:02:03.000Z",
      activity: [{ id: "a1" }, { id: "a2" }],
      expenses: [
        expense({ id: "cny-pending", currency: "CNY", amount: 100, splitSettled: false }),
        expense({ id: "cny-settled", currency: "CNY", amount: 50, splitSettled: true }),
        expense({ id: "aud-pending", currency: "AUD", amount: 20.25, splitSettled: false }),
        expense({ id: "draft", currency: "AUD", amount: 99, status: "draft" }),
        expense({ id: "deleted", currency: "CNY", amount: 500, deletedAt: "2026-07-11T00:00:00.000Z" }),
      ],
    });

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.exportedAt, "2026-07-11T01:02:03.000Z");
    assert.equal(snapshot.activityCount, 2);
    assert.deepEqual(snapshot.expenses.map((item) => item.id), [
      "aud-pending",
      "cny-pending",
      "cny-settled",
      "deleted",
      "draft",
    ]);
    assert.deepEqual(snapshot.totalsByCurrency, {
      AUD: { confirmed: 20.25, pendingSettlement: 20.25, splitSettled: 0 },
      CNY: { confirmed: 150, pendingSettlement: 100, splitSettled: 50 },
    });
  });

  it("authenticates once and exports through the protected same-origin API", async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/api/access")) {
        return new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "aussie_session=signed-token; Path=/; HttpOnly; SameSite=Lax",
          },
        });
      }
      return Response.json({
        serverTime: "2026-07-11T01:02:03.000Z",
        expenses: [expense({ id: "one" })],
        activity: [{ id: "activity-one" }],
      });
    };

    const payload = await fetchProtectedLedger({
      baseUrl: "https://aussie.example",
      tripCode: "secret-code",
      fetch: fetchImpl,
    });

    assert.equal(payload.expenses.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers.Origin, "https://aussie.example");
    assert.equal(calls[0].options.headers["Sec-Fetch-Site"], "same-origin");
    assert.equal(calls[1].options.headers.Cookie, "aussie_session=signed-token");
  });

  it("keeps workbook finance sheets reconciled to the committed snapshot", () => {
    const workbook = JSON.parse(runPython([
      "scripts/itinerary_excel.py",
      "read_finance",
      "content/aussie-itinerary.xlsx",
    ]));

    assert.equal(workbook.snapshot.exportedAt, committedSnapshot.exportedAt);
    assert.equal(workbook.snapshot.activityCount, committedSnapshot.activityCount);
    assert.deepEqual(workbook.snapshot.totalsByCurrency, committedSnapshot.totalsByCurrency);
    assert.equal(
      workbook.lodging.find((row) => row.name === "Oaks Melbourne on Market Hotel").price,
      "¥2,189.69",
    );
    assert.deepEqual(
      workbook.activityCosts.find((row) => /Puffing Billy/.test(row.item)),
      {
        item: "Puffing Billy + Sassafras 半日团",
        price: "实付 ¥2,352 / 4人",
        cny: "¥2,352",
      },
    );
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
    mutationVersion: "1780000000000-000001-test",
    updatedAt: "2026-07-11T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
