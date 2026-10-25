import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import itinerary from "../src/data/nz2027-itinerary.generated.json" with { type: "json" };
import {
  calculateTotals,
  formatMoney,
  formatTotals,
  summarizeByBase,
  summarizeByDay,
  toCsv,
  validateRecord,
} from "../src/lib/nz2027/ledger.js";
import {
  STORAGE_KEY,
  applyServerSnapshot,
  deleteLocal,
  emptyState,
  listRecords,
  loadState,
  pendingRecords,
  restoreLocal,
  saveState,
  upsertLocal,
} from "../src/lib/nz2027/store.js";
import { parseNz2027Batch } from "../src/lib/server/nz2027Ledger.js";
import { GET as getExpenses, POST as postExpenses } from "../src/app/api/nz2027/expenses/route.ts";
import { GET as getItinerary } from "../src/app/api/nz2027/itinerary/route.ts";
import { createSessionToken } from "../src/lib/server/session.js";

const migration = fs.readFileSync("supabase/migrations/20261025090000_create_nz2027_ledger.sql", "utf8");
const seeded = parseSeed(migration);

describe("2027 ledger logic", () => {
  it("seeds exactly the booked costs in their original currencies", () => {
    assert.equal(seeded.length, 10);
    const totals = calculateTotals(seeded);
    assert.deepEqual(Object.keys(totals), ["NZD", "CNY"]);
    assert.deepEqual(totals.NZD, { paid: 1546.31, pending: 1454.87, total: 3001.18, count: 8 });
    assert.deepEqual(totals.CNY, { paid: 0, pending: 1962.74, total: 1962.74, count: 2 });
    for (const record of seeded) assert.deepEqual(validateRecord(record), [], record.id);
  });

  it("formats each currency with its own symbol and never merges them", () => {
    assert.equal(formatMoney("NZD", 1546.31), "NZ$1,546.31");
    assert.equal(formatMoney("CNY", 1962.74), "¥1,962.74");
    assert.equal(formatTotals({ NZD: { total: 10 }, CNY: { total: 20 } }), "NZ$10.00 + ¥20.00");
  });

  it("validates records", () => {
    const good = record({});
    assert.deepEqual(validateRecord(good), []);
    assert.ok(validateRecord({ ...good, currency: "USD" }).length);
    assert.ok(validateRecord({ ...good, amount: 0 }).length);
    assert.ok(validateRecord({ ...good, amount: 1.234 }).length);
    assert.ok(validateRecord({ ...good, category: "split" }).length);
    assert.ok(validateRecord({ ...good, date: "2027-02-30" }).length);
    assert.ok(validateRecord({ ...good, id: "../x" }).length);
    assert.deepEqual(validateRecord({ ...good, amount: 0.1 + 0.2 }), []);
  });

  it("groups by sleeping city and by itinerary day", () => {
    const cities = summarizeByBase(seeded, itinerary.days);
    assert.deepEqual(cities.map((row) => row.key), ["Sydney", "Christchurch", "Twizel", "Wānaka", "Te Anau", "Queenstown", "Auckland"]);
    assert.equal(cities.find((row) => row.key === "Te Anau").totals.NZD.total, 1061);
    assert.equal(cities.find((row) => row.key === "Te Anau").detail, "D10 / D11");

    const days = summarizeByDay([...seeded, record({ id: "pre", date: "2026-12-01" })], itinerary.days);
    assert.equal(days[0].label, "行前预订");
    assert.match(days[1].label, /^D02 · 02\.02/);
  });

  it("exports CSV with original currencies and neutralises spreadsheet formulas", () => {
    const csv = toCsv([record({ item: "=HYPERLINK(1)", note: "a,b" }), record({ id: "gone", deletedAt: "2027-02-01T00:00:00.000Z" })]);
    assert.ok(csv.startsWith("﻿日期,类别,项目,币种,金额,状态,备注,编号"));
    assert.match(csv, /'=HYPERLINK\(1\)/);
    assert.match(csv, /"a,b"/);
    assert.doesNotMatch(csv, /gone/);
  });
});

describe("2027 local store", () => {
  it("keeps edits queued until the server confirms the copy that was sent", () => {
    let state = upsertLocal(emptyState(), record({ id: "a" }), new Date("2027-02-09T01:00:00Z"));
    const sent = pendingRecords(state);
    assert.equal(sent.length, 1);

    state = upsertLocal(state, { ...state.records.a, amount: 99 }, new Date("2027-02-09T01:00:05Z"));
    state = applyServerSnapshot(state, { sent, expenses: [{ ...sent[0] }], serverTime: "2027-02-09T01:00:06Z" });
    assert.deepEqual(state.pendingIds, ["a"], "edited during flight stays queued");
    assert.equal(state.records.a.amount, 99);

    const second = pendingRecords(state);
    state = applyServerSnapshot(state, { sent: second, expenses: second });
    assert.deepEqual(state.pendingIds, []);
  });

  it("soft-deletes, restores, and lets server rows win for unqueued records", () => {
    let state = upsertLocal(emptyState(), record({ id: "a" }));
    state = deleteLocal(state, "a");
    assert.ok(state.records.a.deletedAt);
    assert.equal(listRecords(state).length, 1);
    state = restoreLocal(state, state.records.a);
    assert.equal(state.records.a.deletedAt, null);

    state = applyServerSnapshot(state, { sent: pendingRecords(state), expenses: pendingRecords(state) });
    const fromServer = { ...record({ id: "b" }), updatedAt: "2027-02-10T00:00:00.000Z" };
    state = applyServerSnapshot(state, { sent: [], expenses: [fromServer] });
    assert.equal(state.records.b.item, fromServer.item);
  });

  it("rejects invalid input and survives corrupt storage", () => {
    assert.throws(() => upsertLocal(emptyState(), record({ currency: "USD" })));
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    assert.deepEqual(loadState(storage), emptyState());
    const state = upsertLocal(emptyState(), record({ id: "a" }));
    saveState(storage, state);
    assert.deepEqual(loadState(storage), state);
  });
});

describe("2027 protected API", () => {
  const originalFetch = globalThis.fetch;
  const saved = {};
  beforeEach(() => {
    for (const key of ["TRIP_CODE", "SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) saved[key] = process.env[key];
    process.env.TRIP_CODE = "shared-code";
    process.env.SESSION_SECRET = "nz2027-route-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("requires the shared session for the itinerary and ledger", async () => {
    globalThis.fetch = async () => assert.fail("Supabase must not be called");
    assert.equal((await getItinerary(new Request("https://aussie.example/api/nz2027/itinerary"))).status, 401);
    assert.equal((await getExpenses(new Request("https://aussie.example/api/nz2027/expenses"))).status, 401);

    const response = await getItinerary(authenticated("https://aussie.example/api/nz2027/itinerary"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).itinerary.days.length, 17);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("rejects cross-site writes and invalid batches before calling Supabase", async () => {
    globalThis.fetch = async () => assert.fail("Supabase must not be called");
    const crossSite = await postExpenses(authenticated("https://aussie.example/api/nz2027/expenses", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
      body: JSON.stringify({ records: [] }),
    }));
    assert.equal(crossSite.status, 403);

    const invalid = await postExpenses(sameOrigin({ records: [record({ currency: "USD" })] }));
    assert.equal(invalid.status, 400);
    assert.throws(() => parseNz2027Batch({ records: [record({}), record({})] }), /Duplicate/);
  });

  it("writes through the RPC only and returns the new snapshot", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET", body: options.body });
      if (String(url).includes("/rpc/nz2027_upsert_expense")) {
        const { record: sent } = JSON.parse(options.body);
        return Response.json({ id: sent.id, status: "applied" });
      }
      return Response.json([{ id: "a", date: "2027-02-09", category: "dining", item: "Kika", currency: "NZD", amount: "186.50", status: "paid", note: "", updated_at: "2027-02-09T08:00:00+00:00", deleted_at: null }]);
    };

    const response = await postExpenses(sameOrigin({ records: [record({ id: "a" })] }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.results, [{ id: "a", status: "applied" }]);
    assert.equal(payload.expenses[0].amount, 186.5);
    assert.ok(calls.every((call) => /\/rest\/v1\/(rpc\/nz2027_upsert_expense|nz2027_expenses\?)/.test(call.url)));
    assert.ok(calls.every((call) => !/\/rest\/v1\/(expenses|expense_activity)\b/.test(call.url)), "never touches the 2026 ledger");
  });
});

function record(overrides) {
  return {
    id: "kika",
    date: "2027-02-09",
    category: "dining",
    item: "Kika dinner",
    currency: "NZD",
    amount: 186.5,
    status: "paid",
    note: "",
    updatedAt: "2027-02-09T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function authenticated(url, init = {}) {
  const token = createSessionToken(process.env.SESSION_SECRET);
  return new Request(url, { ...init, headers: { Cookie: `aussie_chill_session=${token}`, ...(init.headers || {}) } });
}

function sameOrigin(body) {
  return authenticated("https://aussie.example/api/nz2027/expenses", {
    method: "POST",
    headers: { Origin: "https://aussie.example", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

function parseSeed(sql) {
  const pattern = /\('(nz27-[^']+)', '(\d{4}-\d{2}-\d{2})', '([a-z]+)', '([^']+)', '([A-Z]{3})', ([0-9.]+), '(paid|pending)',\s*'([^']*)', '([^']+)'\)/g;
  return [...sql.matchAll(pattern)].map((match) => record({
    id: match[1],
    date: match[2],
    category: match[3],
    item: match[4],
    currency: match[5],
    amount: Number(match[6]),
    status: match[7],
    note: match[8],
    updatedAt: new Date(match[9]).toISOString(),
  }));
}
