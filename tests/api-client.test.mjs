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
  generateTravelBrief,
  streamTravelChat,
  unlockAccessSession,
} from "../src/lib/apiClient.js";
import * as protectedApi from "../src/lib/apiClient.js";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

describe("browser protected API client", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
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
      if (url === "/api/travel-assistant") {
        return Response.json({ brief: {}, generatedAt: "2026-07-15T00:00:00.000Z", sourceDayIds: ["d14"] });
      }
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
    await generateTravelBrief({
      dayId: "d14",
      weather: {
        status: " forecast ",
        summary: " 晴 ",
        detail: {
          payer: "private",
          amount: 99,
          receipt: { id: "private" },
          supabase: { token: "private" },
        },
        adviceLabel: "预报穿衣建议",
        ledger: [{ id: "private" }],
        receipt: { id: "private" },
        supabase: { token: "private" },
      },
      checkedKitItemIds: [
        "power",
        "weather-shell",
        "power",
        "not valid",
        "UPPER",
        "",
        { payer: "private", amount: 99, receipt: "private", supabase: "private" },
      ],
      ledger: [{ id: "private" }],
      payer: "private",
      amount: 99,
      receipt: { id: "private" },
      operation: { id: "private" },
      supabase: { token: "private" },
    });

    assert.equal(calls.every((call) => call.url.startsWith("/api/")), true);
    assert.equal(calls.every((call) => !call.url.startsWith("http")), true);
    assert.equal(calls.every((call) => call.options.credentials === "same-origin"), true);
    for (const call of calls.filter((entry) => ["POST", "DELETE"].includes(entry.options.method))) {
      assert.equal(call.options.headers.Accept, "application/json");
      if (call.options.body) assert.equal(call.options.headers["Content-Type"], "application/json");
    }

    const briefCall = calls.find((call) => call.url === "/api/travel-assistant");
    const briefBody = JSON.parse(briefCall.options.body);
    assert.equal(briefCall.options.credentials, "same-origin");
    assert.deepEqual(Object.keys(briefBody).sort(), ["checkedKitItemIds", "dayId", "mode", "weather"]);
    assert.deepEqual(briefBody, {
      mode: "brief",
      dayId: "d14",
      weather: {
        status: "forecast",
        summary: "晴",
        detail: "",
        adviceLabel: "预报穿衣建议",
      },
      checkedKitItemIds: ["power", "weather-shell"],
    });
    assert.deepEqual(Object.keys(briefBody.weather).sort(), ["adviceLabel", "detail", "status", "summary"]);
    assert.equal(Object.values(briefBody.weather).every((value) => typeof value === "string"), true);
    assert.equal(new Set(briefBody.checkedKitItemIds).size, briefBody.checkedKitItemIds.length);
    assert.equal(briefBody.checkedKitItemIds.every((id) => /^[a-z0-9-]{1,64}$/.test(id)), true);
    assert.doesNotMatch(briefCall.options.body, /ledger|payer|amount|receipt|operation|supabase/i);
  });

  it("serializes only valid travel brief day ids", async () => {
    const requestBodies = [];
    globalThis.fetch = async (_url, options = {}) => {
      requestBodies.push(options.body);
      return Response.json({ brief: {}, generatedAt: "2026-07-15T00:00:00.000Z", sourceDayIds: [] });
    };

    for (const dayId of [
      { payer: "private", receipt: { id: "private" }, supabase: { token: "private" } },
      "d17",
    ]) {
      await generateTravelBrief({ dayId, weather: {}, checkedKitItemIds: [] });
    }

    const parsedBodies = requestBodies.map((body) => JSON.parse(body));
    assert.deepEqual(parsedBodies.map((body) => body.dayId), ["", ""]);
    assert.equal(parsedBodies.every((body) => typeof body.dayId === "string"), true);
    assert.doesNotMatch(requestBodies.join("\n"), /payer|receipt|supabase/i);
  });

  it("assembles chunked chat SSE deltas and reports the current-day scope", async () => {
    const calls = [];
    const deltaEvents = [];
    const scopeEvents = [];
    const eventOrder = [];
    const sse = [
      `event: scope\ndata: ${JSON.stringify({ scope: "day", sourceDayIds: ["d14"] })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ delta: "下雨时" })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ delta: "先缩短户外段。" })}\n\n`,
      "event: done\ndata: {}\n\n",
    ].join("");
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return chunkedSseResponse(sse, [1, 7, 19, 23, 41, 59]);
    };

    const result = await streamTravelChat({
      dayId: "d14",
      weather: { status: " fallback ", summary: " 有风 ", ledger: "private" },
      checkedKitItemIds: ["power", "power", "not valid"],
      question: " 下雨怎么调整？ ",
      history: [
        { role: "user", content: " 之前的问题 ", ledger: "private" },
        {
          role: "assistant",
          content: " 之前的回答 ",
          scope: "city",
          sourceDayIds: ["d14", "d10"],
          receipt: "private",
        },
      ],
      ledger: [{ payer: "private" }],
      receipt: { id: "private" },
      supabase: { token: "private" },
    }, {
      onDelta(delta) {
        deltaEvents.push(delta);
        eventOrder.push("delta");
      },
      onScope(scope) {
        scopeEvents.push(scope);
        eventOrder.push("scope");
      },
    });

    assert.deepEqual(result, {
      answer: "下雨时先缩短户外段。",
      scope: "day",
      sourceDayIds: ["d14"],
    });
    assert.deepEqual(deltaEvents, ["下雨时", "先缩短户外段。"]);
    assert.deepEqual(scopeEvents, [{ scope: "day", sourceDayIds: ["d14"] }]);
    assert.deepEqual(eventOrder, ["scope", "delta", "delta"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/travel-assistant");
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers.Accept, "text/event-stream");
    assert.equal(calls[0].options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      mode: "chat",
      dayId: "d14",
      weather: {
        status: "fallback",
        summary: "有风",
        detail: "",
        adviceLabel: "",
      },
      checkedKitItemIds: ["power"],
      question: "下雨怎么调整？",
      history: [
        { role: "user", content: "之前的问题" },
        { role: "assistant", content: "之前的回答" },
      ],
    });
    assert.doesNotMatch(calls[0].options.body, /ledger|payer|receipt|supabase|private/i);
  });

  it("accepts only server scope metadata with the current day first and at most four unique days", async () => {
    const validScopes = [
      { scope: "day", sourceDayIds: ["d14", "d13"] },
      { scope: "city", sourceDayIds: ["d14", "d10", "d7", "d6"] },
      { scope: "trip", sourceDayIds: ["d14"] },
    ];

    for (const expectedScope of validScopes) {
      globalThis.fetch = async () => chunkedSseResponse([
        `event: scope\ndata: ${JSON.stringify(expectedScope)}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ delta: "按行程回答。" })}\n\n`,
        "event: done\ndata: {}\n\n",
      ].join(""), [3, 17, 41]);

      const result = await streamTravelChat({
        dayId: "d14",
        question: "怎么安排？",
        history: [],
      });
      assert.deepEqual(result, { answer: "按行程回答。", ...expectedScope });
    }

    const invalidScopes = [
      { scope: "unknown", sourceDayIds: ["d14"] },
      { scope: "day", sourceDayIds: [] },
      { scope: "day", sourceDayIds: ["d13", "d14"] },
      { scope: "city", sourceDayIds: ["d14", "d10", "d10"] },
      { scope: "city", sourceDayIds: ["d14", "d10", "d7", "d6", "d9"] },
      { scope: "day", sourceDayIds: ["d14", "d17"] },
      { scope: "trip", sourceDayIds: ["d14", "d13"] },
    ];

    for (const invalidScope of invalidScopes) {
      globalThis.fetch = async () => chunkedSseResponse([
        `event: scope\ndata: ${JSON.stringify(invalidScope)}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ delta: "不应接受。" })}\n\n`,
        "event: done\ndata: {}\n\n",
      ].join(""), [5, 29]);

      await assert.rejects(
        () => streamTravelChat({ dayId: "d14", question: "怎么安排？", history: [] }),
        (error) => error instanceof ApiClientError && error.code === "api_request_failed",
      );
    }
  });

  it("fails closed before rendering text when scope ordering is invalid", async () => {
    const invalidStreams = [
      [
        `event: delta\ndata: ${JSON.stringify({ delta: "不应显示。" })}\n\n`,
        `event: scope\ndata: ${JSON.stringify({ scope: "day", sourceDayIds: ["d14"] })}\n\n`,
        "event: done\ndata: {}\n\n",
      ].join(""),
      [
        `event: scope\ndata: ${JSON.stringify({ scope: "day", sourceDayIds: ["d14"] })}\n\n`,
        `event: scope\ndata: ${JSON.stringify({ scope: "day", sourceDayIds: ["d14"] })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ delta: "不应显示。" })}\n\n`,
        "event: done\ndata: {}\n\n",
      ].join(""),
      "event: done\ndata: {}\n\n",
    ];

    for (const sse of invalidStreams) {
      const deltas = [];
      globalThis.fetch = async () => chunkedSseResponse(sse, [3, 17, 41]);

      await assert.rejects(
        () => streamTravelChat(
          { dayId: "d14", question: "怎么安排？", history: [] },
          { onDelta: (delta) => deltas.push(delta) },
        ),
        (error) => error instanceof ApiClientError && error.code === "api_request_failed",
      );
      assert.deepEqual(deltas, []);
    }
  });

  it("drops oldest complete multibyte turns until the chat body fits the client ceiling", async () => {
    const requestBodies = [];
    const history = Array.from({ length: 8 }, (_, index) => ([
      { role: "user", content: `${String(index).padStart(2, "0")}${"问".repeat(1_998)}` },
      { role: "assistant", content: `${String(index).padStart(2, "0")}${"答".repeat(1_998)}` },
    ])).flat();
    globalThis.fetch = async (_url, options = {}) => {
      requestBodies.push(options.body);
      return chunkedSseResponse([
        `event: scope\ndata: ${JSON.stringify({ scope: "day", sourceDayIds: ["d14"] })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ delta: "保留最新上下文。" })}\n\n`,
        "event: done\ndata: {}\n\n",
      ].join(""), [11, 37]);
    };

    await streamTravelChat({
      dayId: "d14",
      question: "继续怎么安排？",
      history,
    }, {});

    const [serialized] = requestBodies;
    const body = JSON.parse(serialized);
    const safeClientBodyCeiling = 15 * 1_024;
    assert.ok(new TextEncoder().encode(serialized).byteLength < safeClientBodyCeiling);
    assert.ok(body.history.length < 16);
    assert.equal(body.history.length % 2, 0);
    assert.deepEqual(body.history.slice(-2), history.slice(-2));
    assert.deepEqual(
      body.history.map((message) => message.role),
      body.history.map((_, index) => (index % 2 === 0 ? "user" : "assistant")),
    );
  });

  it("notifies the access gate and throws AccessRequiredError for chat 401s", async () => {
    const events = [];
    globalThis.window = {
      dispatchEvent(event) {
        events.push(event.type);
      },
    };
    globalThis.fetch = async () => Response.json(
      { error: "access_required" },
      { status: 401 },
    );

    await assert.rejects(
      () => streamTravelChat({ dayId: "d14", question: "下雨呢？", history: [] }, {}),
      (error) => error instanceof AccessRequiredError && error.code === "access_required",
    );
    assert.deepEqual(events, ["aussie-chill-access-required"]);
  });

  it("maps failed and malformed chat streams to a generic API client error", async () => {
    globalThis.fetch = async () => Response.json(
      { error: "assistant_unavailable", privateDetail: "must not escape" },
      { status: 502 },
    );
    await assert.rejects(
      () => streamTravelChat({ dayId: "d14", question: "下雨呢？", history: [] }, {}),
      (error) => error instanceof ApiClientError && error.status === 502,
    );

    globalThis.fetch = async () => chunkedSseResponse(
      "event: delta\ndata: not-json\n\nevent: done\ndata: {}\n\n",
      [3, 8, 17],
    );
    await assert.rejects(
      () => streamTravelChat({ dayId: "d14", question: "下雨呢？", history: [] }, {}),
      (error) => error instanceof ApiClientError && error.code === "api_request_failed",
    );

    const source = readFileSync(new URL("../src/lib/apiClient.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\s*\(/);
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

function chunkedSseResponse(source, boundaries) {
  const bytes = new TextEncoder().encode(source);
  const cuts = [...boundaries.filter((value) => value > 0 && value < bytes.length), bytes.length];
  let start = 0;
  return new Response(new ReadableStream({
    start(controller) {
      for (const end of cuts) {
        controller.enqueue(bytes.slice(start, end));
        start = end;
      }
      controller.close();
    },
  }), {
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}
