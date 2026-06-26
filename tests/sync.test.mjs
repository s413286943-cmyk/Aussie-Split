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

describe("Supabase REST headers", () => {
  it("does not send publishable keys as bearer tokens", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const calls = [];

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_test";
    globalThis.fetch = async (_url, options) => {
      calls.push(options);
      return { ok: true, json: async () => [] };
    };

    try {
      const { fetchRemoteExpenses } = await import(`../src/lib/supabaseRest.js?headers=${Date.now()}`);
      await fetchRemoteExpenses();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
      }
      if (originalKey === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
      }
    }

    assert.equal(calls[0].headers.apikey, "sb_publishable_test");
    assert.equal("Authorization" in calls[0].headers, false);
  });

  it("loads remote expense activity newest-first", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const calls = [];

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_test";
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => [
          {
            id: "activity-1",
            expense_id: "expense-1",
            action: "add",
            item: "晚餐",
            amount: 100,
            currency: "CNY",
            summary: "新增了 ¥100.00 晚餐",
            created_at: "2026-07-30T10:00:00.000Z",
          },
        ],
      };
    };

    try {
      const { fetchRemoteActivity } = await import(`../src/lib/supabaseRest.js?activityFetch=${Date.now()}`);
      const activity = await fetchRemoteActivity();

      assert.match(calls[0].url, /expense_activity\?select=\*&order=created_at\.desc&limit=8/);
      assert.equal(activity[0].expenseId, "expense-1");
      assert.equal(activity[0].createdAt, "2026-07-30T10:00:00.000Z");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(originalUrl, originalKey);
    }
  });

  it("inserts remote expense activity without blocking on response rows", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const calls = [];

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_test";
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true };
    };

    try {
      const { insertRemoteActivity } = await import(`../src/lib/supabaseRest.js?activityInsert=${Date.now()}`);
      await insertRemoteActivity({
        id: "activity-1",
        expenseId: "expense-1",
        action: "add",
        item: "晚餐",
        amount: 100,
        currency: "CNY",
        summary: "新增了 ¥100.00 晚餐",
        createdAt: "2026-07-30T10:00:00.000Z",
      });

      assert.match(calls[0].url, /expense_activity$/);
      assert.equal(calls[0].options.method, "POST");
      assert.equal(JSON.parse(calls[0].options.body).expense_id, "expense-1");
      assert.equal(JSON.parse(calls[0].options.body).created_at, "2026-07-30T10:00:00.000Z");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(originalUrl, originalKey);
    }
  });
});

function restoreEnv(originalUrl, originalKey) {
  if (originalUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  }
  if (originalKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  }
}
