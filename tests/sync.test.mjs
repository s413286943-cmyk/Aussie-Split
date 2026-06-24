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
});
