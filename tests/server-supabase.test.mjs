import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  SupabaseUpstreamError,
  applyExpenseOperations,
  fetchActivity,
  fetchLedgerSnapshot,
} from "../src/lib/server/supabase.js";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("server-only Supabase transport", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("SUPABASE_URL", originalUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalServiceRole);
  });

  it("uses the service role only in server-only modules", () => {
    for (const relativePath of [
      "../src/lib/server/session.js",
      "../src/lib/server/rateLimit.js",
      "../src/lib/server/supabase.js",
    ]) {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      assert.match(source, /^import ["']server-only["'];/m);
    }

    const transportSource = readFileSync(
      new URL("../src/lib/server/supabase.js", import.meta.url),
      "utf8",
    );
    assert.match(transportSource, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(transportSource, /NEXT_PUBLIC_/);
  });

  it("maps all expense rows including tombstones and canonical attachment projections", async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/expenses?")) {
        return Response.json([
          {
            id: "expense-visible",
            category: "dining",
            item: "Dinner",
            date: "2026-08-01",
            currency: "AUD",
            amount: "88.50",
            payer: "us",
            status: "confirmed",
            note: "Harbour",
            attachment_name: "legacy-name.jpg",
            split_settled: false,
            mutation_version: "1780000000000-000001-browser-a",
            updated_at: "2026-07-10T00:00:00.000Z",
            deleted_at: null,
          },
          {
            id: "expense-deleted",
            category: "交通",
            item: "Taxi",
            date: null,
            currency: "AUD",
            amount: "30.00",
            payer: "them",
            status: "draft",
            note: "",
            attachment_name: "",
            split_settled: true,
            mutation_version: "1780000000001-000000-browser-b",
            updated_at: "2026-07-10T00:00:01.000Z",
            deleted_at: "2026-07-10T00:00:01.000Z",
          },
        ]);
      }
      return Response.json([
        {
          expense_id: "expense-visible",
          original_name: "receipt.jpg",
          storage_path: "expense-visible/receipt-id.jpg",
          created_at: "2026-07-10T00:00:02.000Z",
        },
      ]);
    };

    const expenses = await fetchLedgerSnapshot();

    assert.equal(expenses.length, 2);
    assert.deepEqual(expenses[0], {
      id: "expense-visible",
      category: "dining",
      item: "Dinner",
      date: "2026-08-01",
      currency: "AUD",
      amount: 88.5,
      payer: "us",
      status: "confirmed",
      note: "Harbour",
      splitSettled: false,
      mutationVersion: "1780000000000-000001-browser-a",
      updatedAt: "2026-07-10T00:00:00.000Z",
      deletedAt: null,
      attachmentName: "receipt.jpg",
      attachmentPath: "expense-visible/receipt-id.jpg",
    });
    assert.equal(expenses[1].deletedAt, "2026-07-10T00:00:01.000Z");
    assert.equal(expenses[1].date, "");
    assert.equal(calls.length, 2);
    assert.equal(calls.some((call) => /\/expenses\?select=\*&order=date\.asc$/.test(call.url)), true);
    for (const call of calls) {
      assert.equal(call.options.headers.apikey, "service-role-test-secret");
      assert.equal(call.options.headers.Authorization, "Bearer service-role-test-secret");
      assert.equal(call.options.cache, "no-store");
    }
  });

  it("drains an operation batch through the atomic RPC and preserves per-op status", async () => {
    const operations = [operation("op-one", "expense-one"), operation("op-two", "expense-two")];
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      const { operation: input } = JSON.parse(options.body);
      return Response.json({ opId: input.opId, status: input.opId === "op-one" ? "applied" : "stale" });
    };

    const results = await applyExpenseOperations(operations);

    assert.deepEqual(results, [
      { opId: "op-one", status: "applied" },
      { opId: "op-two", status: "stale" },
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => call.url.endsWith("/rest/v1/rpc/apply_expense_operation")), true);
    assert.deepEqual(JSON.parse(calls[0].options.body), { operation: operations[0] });
    assert.deepEqual(JSON.parse(calls[1].options.body), { operation: operations[1] });
  });

  it("caps activity reads at 100 rows", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return Response.json([{
        id: "activity-one",
        expense_id: "expense-one",
        action: "add",
        item: "Dinner",
        amount: "10.00",
        currency: "AUD",
        summary: "Added dinner",
        created_at: "2026-07-10T00:00:00.000Z",
      }]);
    };

    const activity = await fetchActivity(1_000);

    assert.match(requestedUrl, /limit=100/);
    assert.deepEqual(activity[0], {
      id: "activity-one",
      expenseId: "expense-one",
      action: "add",
      item: "Dinner",
      amount: 10,
      currency: "AUD",
      summary: "Added dinner",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
  });

  it("throws a typed sanitized upstream error", async () => {
    globalThis.fetch = async () => Response.json({
      message: "service-role-test-secret leaked in upstream detail",
      details: "database internals",
    }, { status: 500 });

    await assert.rejects(
      () => fetchActivity(50),
      (error) => {
        assert.equal(error instanceof SupabaseUpstreamError, true);
        assert.equal(error.code, "supabase_upstream_error");
        assert.equal(error.status, 500);
        assert.doesNotMatch(error.message, /service-role-test-secret|database internals/);
        return true;
      },
    );
  });

  it("rejects a malformed atomic RPC result as an upstream error", async () => {
    globalThis.fetch = async () => Response.json({
      opId: "unexpected-op",
      status: "unknown",
      detail: "service-role-test-secret",
    });

    await assert.rejects(
      () => applyExpenseOperations([operation("op-one", "expense-one")]),
      (error) => error instanceof SupabaseUpstreamError
        && error.code === "supabase_upstream_error"
        && !error.message.includes("service-role-test-secret"),
    );
  });
});

function operation(opId, expenseId) {
  return {
    opId,
    type: "upsert",
    expenseId,
    mutationVersion: "1780000000000-000001-browser-a",
    expense: {
      id: expenseId,
      category: "dining",
      item: "Dinner",
      date: "2026-08-01",
      currency: "AUD",
      amount: 10,
      payer: "us",
      status: "confirmed",
      note: "",
      splitSettled: false,
    },
    activity: {
      id: `activity-${opId}`,
      expenseId,
      action: "add",
      item: "Dinner",
      amount: 10,
      currency: "AUD",
      summary: "Added dinner",
      createdAt: "2026-07-10T00:00:00.000Z",
    },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
