import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { GET as getActivity } from "../src/app/api/activity/route.ts";
import { GET as getSync, POST as postSync } from "../src/app/api/sync/route.ts";
import { createSessionToken } from "../src/lib/server/session.js";

const originalFetch = globalThis.fetch;
const originalEnv = {};
const envKeys = ["TRIP_CODE", "SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

describe("authenticated ledger routes", () => {
  beforeEach(() => {
    for (const key of envKeys) originalEnv[key] = process.env[key];
    process.env.TRIP_CODE = "shared-code";
    process.env.SESSION_SECRET = "route-test-session-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) restoreEnv(key, originalEnv[key]);
  });

  it("rejects unauthenticated sync before reading a mutation body", async () => {
    let bodyRead = false;
    globalThis.fetch = async () => {
      throw new Error("Supabase must not be called");
    };
    const request = {
      url: "https://aussie.example/api/sync",
      headers: new Headers({
        Origin: "https://aussie.example",
        "Sec-Fetch-Site": "same-origin",
      }),
      async json() {
        bodyRead = true;
        return { operations: [] };
      },
    };

    const response = await postSync(request);

    assert.equal(response.status, 401);
    assert.equal(bodyRead, false);
    assert.deepEqual(await response.json(), { error: "access_required" });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("returns all current expense rows including tombstones with activity and server time", async () => {
    const requestedUrls = [];
    globalThis.fetch = createSupabaseFetch(requestedUrls);

    const response = await getSync(authenticatedRequest("https://aussie.example/api/sync"));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.expenses.length, 2);
    assert.equal(payload.expenses[1].deletedAt, "2026-07-10T00:00:01.000Z");
    assert.equal(payload.activity.length, 1);
    assert.equal(Number.isNaN(Date.parse(payload.serverTime)), false);
    assert.equal(requestedUrls.some((url) => url.includes("deleted_at=is.null") && url.includes("/expenses?")), false);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("rejects more than 100 operations before calling the data service", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({});
    };
    const operations = Array.from({ length: 101 }, (_, index) => operation(`op-${index}`, `expense-${index}`));

    const response = await postSync(authenticatedMutation({ operations }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
    assert.equal(calls, 0);
  });

  it("rejects an operation whose activity does not describe its expense", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({});
    };
    const input = operation("op-mismatch", "expense-mismatch");
    input.activity.amount = 99;

    const response = await postSync(authenticatedMutation({ operations: [input] }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
    assert.equal(calls, 0);
  });

  it("returns per-operation status with a fresh protected snapshot", async () => {
    const requestedUrls = [];
    globalThis.fetch = createSupabaseFetch(requestedUrls);
    const input = operation("op-one", "expense-one");

    const response = await postSync(authenticatedMutation({ operations: [input] }));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.results, [{ opId: "op-one", status: "applied" }]);
    assert.equal(payload.expenses.length, 2);
    assert.equal(payload.activity.length, 1);
    assert.equal(Number.isNaN(Date.parse(payload.serverTime)), false);
    assert.equal(
      requestedUrls.filter((url) => url.endsWith("/rest/v1/rpc/apply_expense_operation")).length,
      1,
    );
  });

  it("clamps protected activity reads to 1 through 100", async () => {
    const requestedUrls = [];
    globalThis.fetch = createSupabaseFetch(requestedUrls);

    const response = await getActivity(authenticatedRequest(
      "https://aussie.example/api/activity?limit=500",
    ));

    assert.equal(response.status, 200);
    assert.equal(requestedUrls.some((url) => url.includes("expense_activity") && url.includes("limit=100")), true);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });
});

function authenticatedRequest(url, init = {}) {
  const token = createSessionToken(process.env.SESSION_SECRET);
  return new Request(url, {
    ...init,
    headers: {
      Cookie: `aussie_chill_session=${token}`,
      ...(init.headers || {}),
    },
  });
}

function authenticatedMutation(body) {
  return authenticatedRequest("https://aussie.example/api/sync", {
    method: "POST",
    headers: {
      Origin: "https://aussie.example",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createSupabaseFetch(requestedUrls) {
  return async (url, options = {}) => {
    const requestedUrl = String(url);
    requestedUrls.push(requestedUrl);
    if (requestedUrl.endsWith("/rest/v1/rpc/apply_expense_operation")) {
      const { operation: input } = JSON.parse(options.body);
      return Response.json({ opId: input.opId, status: "applied" });
    }
    if (requestedUrl.includes("/expenses?")) {
      return Response.json([
        expenseRow("expense-visible", null),
        expenseRow("expense-deleted", "2026-07-10T00:00:01.000Z"),
      ]);
    }
    if (requestedUrl.includes("/attachments?")) return Response.json([]);
    if (requestedUrl.includes("/expense_activity?")) {
      return Response.json([{
        id: "activity-one",
        expense_id: "expense-visible",
        action: "add",
        item: "Dinner",
        amount: "10.00",
        currency: "AUD",
        summary: "Added dinner",
        created_at: "2026-07-10T00:00:00.000Z",
      }]);
    }
    return Response.json({ message: "unexpected request" }, { status: 500 });
  };
}

function expenseRow(id, deletedAt) {
  return {
    id,
    category: "dining",
    item: "Dinner",
    date: "2026-08-01",
    currency: "AUD",
    amount: "10.00",
    payer: "us",
    status: "confirmed",
    note: "",
    attachment_name: "",
    split_settled: false,
    mutation_version: id === "expense-visible"
      ? "1780000000000-000001-browser-a"
      : "1780000000001-000000-browser-b",
    updated_at: deletedAt || "2026-07-10T00:00:00.000Z",
    deleted_at: deletedAt,
  };
}

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
