import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";

import {
  AccessRequiredError,
  ApiClientError,
  applyLedgerOperations,
  checkAccessSession,
  clearAccessSession,
  createReceiptUploadContract,
  createExpenseOperation,
  fetchActivity,
  fetchLedgerSnapshot,
  fetchReceipt,
  finalizeReceipt,
  unlockAccessSession,
} from "../src/lib/apiClient.js";
import * as protectedApi from "../src/lib/apiClient.js";

const originalFetch = globalThis.fetch;

describe("browser protected API client", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses only relative API URLs with same-origin credentials", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (url === "/api/access") return Response.json({ authenticated: true });
      if (url === "/api/sync" && options.method === "POST") {
        return Response.json({ results: [], expenses: [], activity: [], serverTime: "2026-07-10T00:00:00.000Z" });
      }
      if (url === "/api/sync") {
        return Response.json({ expenses: [], activity: [], serverTime: "2026-07-10T00:00:00.000Z" });
      }
      if (url === "/api/itinerary") return Response.json({ itinerary: { trip: {}, stages: [], days: [] } });
      if (String(url).startsWith("/api/activity")) return Response.json({ activity: [] });
      if (url === "/api/receipts/upload-url") return Response.json({ mode: "signed-put" });
      if (url === "/api/receipts/finalize") return Response.json({ receipt: { receiptId: "receipt-one" } });
      if (url === "/api/receipts/expense-one") return Response.json({ signedUrl: "https://signed.example" });
      throw new Error(`Unexpected URL: ${url}`);
    };

    await checkAccessSession();
    await unlockAccessSession("shared-code");
    await clearAccessSession();
    await fetchLedgerSnapshot();
    await applyLedgerOperations([]);
    assert.equal(typeof protectedApi.fetchItinerary, "function");
    await protectedApi.fetchItinerary();
    await fetchActivity(50);
    await createReceiptUploadContract({ expenseId: "expense-one" });
    await finalizeReceipt({ expenseId: "expense-one", receiptId: "receipt-one" });
    await fetchReceipt("expense-one");

    assert.equal(calls.every((call) => call.url.startsWith("/api/")), true);
    assert.equal(calls.every((call) => !call.url.startsWith("http")), true);
    assert.equal(calls.every((call) => call.options.credentials === "same-origin"), true);
    for (const call of calls.filter((entry) => ["POST", "DELETE"].includes(entry.options.method))) {
      assert.equal(call.options.headers.Accept, "application/json");
      if (call.options.body) assert.equal(call.options.headers["Content-Type"], "application/json");
    }
  });

  it("maps a 401 response to AccessRequiredError", async () => {
    globalThis.fetch = async () => Response.json({ error: "access_required" }, { status: 401 });

    await assert.rejects(
      () => fetchLedgerSnapshot(),
      (error) => error instanceof AccessRequiredError && error.code === "access_required",
    );
  });

  it("retains a sanitized server error code for recoverable receipt retries", async () => {
    globalThis.fetch = async () => Response.json({ error: "receipt_object_missing" }, { status: 409 });

    await assert.rejects(
      () => finalizeReceipt({ expenseId: "expense-one", receiptId: "receipt-one" }),
      (error) => error instanceof ApiClientError
        && error.status === 409
        && error.serverCode === "receipt_object_missing",
    );
  });

  it("returns stale operation acknowledgements with the fresh server snapshot", async () => {
    globalThis.fetch = async () => Response.json({
      results: [{ opId: "op-stale", status: "stale" }],
      expenses: [],
      activity: [],
      serverTime: "2026-07-10T00:00:00.000Z",
    });

    const response = await applyLedgerOperations([{ opId: "op-stale" }]);

    assert.deepEqual(response.results, [{ opId: "op-stale", status: "stale" }]);
    assert.deepEqual(response.expenses, []);
    assert.deepEqual(response.activity, []);
    assert.equal(response.serverTime, "2026-07-10T00:00:00.000Z");
  });

  it("reopens cached data after a transient online failure only when the offline marker exists", () => {
    assert.equal(protectedApi.shouldReopenCachedAccess(new ApiClientError(503), true), true);
    assert.equal(protectedApi.shouldReopenCachedAccess(new ApiClientError(0), true), true);
    assert.equal(protectedApi.shouldReopenCachedAccess(new ApiClientError(503), false), false);
  });

  it("never reopens cached data after an explicit 401", () => {
    assert.equal(protectedApi.shouldReopenCachedAccess(new AccessRequiredError(), true), false);
  });

  it("builds atomic upsert and delete operations without writable attachment projections", () => {
    const expense = {
      id: "expense-one",
      category: "dining",
      item: "Dinner",
      date: "2026-08-01",
      currency: "AUD",
      amount: 10,
      payer: "us",
      status: "confirmed",
      note: "",
      splitSettled: false,
      mutationVersion: "1780000000000-000001-browser-a",
      updatedAt: "2026-07-10T00:00:00.000Z",
      deletedAt: null,
      attachmentName: "receipt.jpg",
      attachmentPath: "expense-one/receipt.jpg",
    };
    const activity = {
      id: "activity-one",
      expenseId: expense.id,
      action: "add",
      item: expense.item,
      amount: expense.amount,
      currency: expense.currency,
      summary: "Added dinner",
      createdAt: "2026-07-10T00:00:00.000Z",
    };

    const upsert = createExpenseOperation("upsert", expense, activity, { opId: "op-one" });
    const deleted = createExpenseOperation("delete", {
      ...expense,
      deletedAt: "2026-07-10T00:01:00.000Z",
      mutationVersion: "1780000060000-000000-browser-a",
    }, { ...activity, id: "activity-delete", action: "delete" }, { opId: "op-delete" });

    assert.equal(upsert.opId, "op-one");
    assert.equal(upsert.mutationVersion, expense.mutationVersion);
    assert.equal(upsert.expense.attachmentName, undefined);
    assert.equal(upsert.expense.attachmentPath, undefined);
    assert.equal(upsert.expense.updatedAt, undefined);
    assert.deepEqual(upsert.activity, activity);
    assert.equal(deleted.type, "delete");
    assert.equal(deleted.expense, null);
    assert.equal(deleted.activity.action, "delete");
  });

  it("contains no Supabase key or direct Data and Storage endpoint references", () => {
    const source = readFileSync(new URL("../src/lib/apiClient.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /SUPABASE|NEXT_PUBLIC_|\/rest\/v1|\/storage\/v1/);
  });
});

describe("protected browser integration contract", () => {
  const accessSource = readFileSync(new URL("../src/lib/access.js", import.meta.url), "utf8");
  const unlockSource = readFileSync(new URL("../src/components/UnlockGate.jsx", import.meta.url), "utf8");
  const ledgerSource = readFileSync(new URL("../src/components/TripLedgerApp.jsx", import.meta.url), "utf8");
  const itinerarySource = readFileSync(new URL("../src/components/ItineraryApp.jsx", import.meta.url), "utf8");
  const todayConsoleSource = readFileSync(new URL("../src/components/itinerary/TodayConsole.jsx", import.meta.url), "utf8");
  const itineraryUiSource = `${itinerarySource}\n${todayConsoleSource}`;

  it("keeps only an offline reopening marker in browser access state", () => {
    assert.match(accessSource, /aussie-chill-offline-access-v1/);
    assert.doesNotMatch(accessSource, /defaultTripCode|NEXT_PUBLIC_TRIP_CODE|["']aussie["']/);
    assert.match(unlockSource, /checkAccessSession/);
    assert.match(unlockSource, /unlockAccessSession/);
    assert.match(unlockSource, /navigator\.onLine/);
    assert.match(unlockSource, /ACCESS_REQUIRED_EVENT/);
    assert.match(unlockSource, /shouldReopenCachedAccess/);
    assert.match(unlockSource, /session\.authenticated === true[\s\S]*localStorage\.setItem\(offlineAccessKey, "yes"\)/);
    assert.doesNotMatch(unlockSource, /defaultTripCode|placeholder=["']aussie["']/);
  });

  it("connects unlock errors to the access input and focuses the gate input", () => {
    assert.match(unlockSource, /inputRef\.current\?\.focus\(\)/);
    assert.match(unlockSource, /ref=\{inputRef\}/);
    assert.match(unlockSource, /aria-describedby=\{error \? errorId : undefined\}/);
    assert.match(unlockSource, /aria-invalid=\{Boolean\(error\)\}/);
    assert.match(unlockSource, /id=\{errorId\}/);
    assert.match(unlockSource, /role="alert"/);
    assert.match(unlockSource, /aria-live="assertive"/);
  });

  it("routes durable outbox writes through the protected API client", () => {
    assert.match(ledgerSource, /from ["']@\/lib\/apiClient["']/);
    assert.match(ledgerSource, /applyLedgerOperations/);
    assert.match(ledgerSource, /initializeOfflineLedger/);
    assert.match(ledgerSource, /commitOfflineMutation/);
    assert.match(ledgerSource, /syncOfflineLedger/);
    assert.match(ledgerSource, /undoOfflineDelete/);
    assert.match(ledgerSource, /同步失败，可重试/);
    assert.doesNotMatch(ledgerSource, /from ["']@\/lib\/supabaseRest["']|upsertRemoteExpense|insertRemoteActivity/);
  });

  it("uses the durable offline ledger and protected outbox sync for itinerary reads", () => {
    assert.match(itinerarySource, /from ["']@\/lib\/apiClient["']/);
    assert.match(itinerarySource, /applyLedgerOperations/);
    assert.match(itinerarySource, /initializeOfflineLedger/);
    assert.match(itinerarySource, /syncOfflineLedger/);
    assert.match(itinerarySource, /closeOfflineLedger/);
    assert.match(itinerarySource, /lease_unavailable/);
    assert.match(itinerarySource, /setTimeout\([^)]*syncLedger/s);
    assert.doesNotMatch(itinerarySource, /aussie-chill-expenses-v1|fetchLedgerSnapshot/);
    assert.doesNotMatch(itinerarySource, /supabaseRest|fetchRemote/);
  });

  it("shows whether itinerary ledger figures are current or locally cached", () => {
    assert.match(itinerarySource, /synced\.result\.completed \? "current" : "cached"/);
    assert.match(itinerarySource, /setLedgerFreshness\("cached"\)/);
    assert.match(itineraryUiSource, /账本已同步 · 当前数据/);
    assert.match(itineraryUiSource, /本机缓存 · 可能不是最新/);
    assert.match(itineraryUiSource, /role="status"/);
    assert.match(itineraryUiSource, /aria-live="polite"/);
  });

  it("does not present seed expenses as a real cache when IndexedDB is unavailable", () => {
    assert.doesNotMatch(itinerarySource, /seedExpenses/);
    assert.match(itinerarySource, /useState\(\[\]\)/);
    assert.match(itinerarySource, /setLedgerExpenses\(\[\]\)/);
    assert.match(itinerarySource, /setLedgerFreshness\("unavailable"\)/);
    assert.match(itineraryUiSource, /账本暂不可用 · 未显示缓存金额/);
  });

  it("leaves no direct data-service reference in browser entry modules", () => {
    const browserSources = [accessSource, unlockSource, ledgerSource, itinerarySource].join("\n");
    assert.doesNotMatch(
      browserSources,
      /NEXT_PUBLIC_SUPABASE|SUPABASE_SERVICE_ROLE_KEY|\/rest\/v1|\/storage\/v1/,
    );
  });

  it("loads private itinerary and ledger data only after protected API access", () => {
    assert.doesNotMatch(itinerarySource, /itinerary\.generated\.json/);
    assert.match(itinerarySource, /fetchItinerary/);
    assert.doesNotMatch(ledgerSource, /seedExpenses/);
  });

  it("keeps real trip and expense literals out of browser-eligible source files", () => {
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const browserFiles = collectSourceFiles(srcRoot).filter((file) =>
      !file.includes("/src/lib/server/") && !file.includes("/src/app/api/"),
    );
    const browserSource = browserFiles.map((file) => readFileSync(file, "utf8")).join("\n");

    assert.doesNotMatch(
      browserSource,
      /Oaks Melbourne on Market Hotel|Billy Tea Daintree Rainforest|Captain Cook Whale Watching/,
    );
  });

  it("keeps every browser-eligible source file free of direct data-service access", () => {
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const browserFiles = collectSourceFiles(srcRoot).filter((file) =>
      !file.includes("/src/lib/server/") && !file.includes("/src/app/api/"),
    );

    for (const file of browserFiles) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(
        source,
        /NEXT_PUBLIC_SUPABASE|\/rest\/v1|\/storage\/v1|supabaseRest/,
        file,
      );
    }
  });
});

function collectSourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = `${directory}/${entry}`;
    if (statSync(path).isDirectory()) return collectSourceFiles(path);
    return /\.(?:js|jsx|ts|tsx)$/.test(path) ? [path] : [];
  });
}
