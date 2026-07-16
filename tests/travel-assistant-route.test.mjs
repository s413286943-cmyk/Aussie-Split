import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createSessionToken } from "../src/lib/server/session.js";

let routeImportError;
const travelAssistantRoute = await import("../src/app/api/travel-assistant/route.ts").catch((error) => {
  routeImportError = error;
  return {};
});

let rateLimitImportError;
const travelAssistantRateLimit = await import("../src/lib/server/travelAssistantRateLimit.js").catch((error) => {
  rateLimitImportError = error;
  return {};
});

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalEnv = {};
const envKeys = [
  "TRIP_CODE",
  "SESSION_SECRET",
  "TRAVEL_AI_API_KEY",
  "TRAVEL_AI_BASE_URL",
  "TRAVEL_AI_MODEL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const providerUrl = "https://assistant.test/v1/chat/completions";
const fixedNow = Date.UTC(2026, 6, 15, 6, 0, 0);

describe("protected travel-assistant brief route", () => {
  beforeEach(() => {
    for (const key of envKeys) originalEnv[key] = process.env[key];
    process.env.TRIP_CODE = "shared-code";
    process.env.SESSION_SECRET = "route-test-session-secret";
    process.env.TRAVEL_AI_API_KEY = "synthetic-travel-assistant-key";
    process.env.TRAVEL_AI_BASE_URL = "https://assistant.test";
    process.env.TRAVEL_AI_MODEL = "synthetic-brief-model";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    Date.now = () => fixedNow;
    resetRateLimit();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
    resetRateLimit();
    for (const key of envKeys) restoreEnv(key, originalEnv[key]);
  });

  it("exports only framework-supported route fields", () => {
    assert.deepEqual(Object.keys(travelAssistantRoute).sort(), ["POST", "runtime"]);
  });

  it("rejects an unauthenticated request before reading its body", async () => {
    let bodyRead = false;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("Provider must not be called");
    };
    const request = {
      url: "https://aussie.example/api/travel-assistant",
      headers: new Headers({
        "Sec-Fetch-Site": "cross-site",
      }),
      async text() {
        bodyRead = true;
        return JSON.stringify(validBriefRequest());
      },
    };

    const response = await postTravelAssistant(request);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "access_required" });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(bodyRead, false);
    assert.equal(fetchCalls, 0);
  });

  it("rejects missing and cross-site mutation metadata", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("Provider must not be called");
    };
    const cases = [
      { name: "missing origin", headers: { "Sec-Fetch-Site": "same-origin" } },
      { name: "missing fetch site", headers: { Origin: "https://aussie.example" }, omitFetchSite: true },
      {
        name: "cross-site origin",
        headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
      },
    ];

    for (const testCase of cases) {
      resetRateLimit();
      const response = await postTravelAssistant(authenticatedMutation(validBriefRequest(), {
        headers: testCase.headers,
        omitFetchSite: testCase.omitFetchSite,
      }));
      assert.equal(response.status, 403, testCase.name);
      assert.deepEqual(await response.json(), { error: "request_rejected" }, testCase.name);
    }
    assert.equal(fetchCalls, 0);
  });

  it("rejects invalid day IDs, extra fields, and bodies over 16 KiB before provider fetch", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("Provider must not be called");
    };
    const cases = [
      { name: "invalid day ID", body: { mode: "brief", dayId: "d99" } },
      {
        name: "extra ledger field",
        body: { ...validBriefRequest(), ledger: { privateMarker: "CALLER_LEDGER_MUST_NOT_LEAK" } },
      },
      {
        name: "oversized body",
        rawBody: `${JSON.stringify(validBriefRequest()).slice(0, -1)},"padding":"${"x".repeat(16 * 1024)}"}`,
      },
    ];

    for (const testCase of cases) {
      resetRateLimit();
      const response = await postTravelAssistant(authenticatedMutation(
        testCase.body,
        { rawBody: testCase.rawBody },
      ));
      assert.equal(response.status, 400, testCase.name);
      assert.deepEqual(await response.json(), { error: "invalid_request" }, testCase.name);
    }
    assert.equal(fetchCalls, 0);
  });

  it("returns a validated private brief with exactly three safe enriched priorities", async () => {
    const fetchRequests = [];
    globalThis.fetch = providerFetch(fetchRequests, () => validProviderResponse());

    const response = await postTravelAssistant(authenticatedMutation(validBriefRequest()));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Pragma"), "no-cache");
    assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
    assert.deepEqual(Object.keys(payload).sort(), ["brief", "generatedAt", "sourceDayIds"]);
    assert.deepEqual(payload.sourceDayIds, ["d1"]);
    assert.equal(Number.isNaN(Date.parse(payload.generatedAt)), false);
    assert.equal(payload.brief.priorities.length, 3);
    assert.deepEqual(payload.brief, expectedBriefOutput());
    assert.equal(JSON.stringify(payload).includes("CALLER_LEDGER_MUST_NOT_LEAK"), false);

    assert.equal(fetchRequests.length, 1);
    assert.equal(fetchRequests[0].url, providerUrl);
    const providerBody = JSON.parse(fetchRequests[0].options.body);
    const providerText = JSON.stringify(providerBody);
    assert.equal(providerText.includes("CALLER_LEDGER_MUST_NOT_LEAK"), false);
    assert.equal(providerText.includes("ledger"), false);
    const providerPrompt = JSON.parse(providerBody.messages[1].content);
    assert.deepEqual(Object.keys(providerPrompt).sort(), ["context", "outputSchema", "task"]);
    assert.deepEqual(Object.keys(providerPrompt.context).sort(), [
      "checklist",
      "day",
      "facts",
      "scope",
      "sourceDayIds",
      "tomorrow",
      "weather",
    ]);
    assert.deepEqual(providerPrompt.context.sourceDayIds, ["d1"]);
  });

  it("returns buffered and validated current-day chat as controlled SSE", async () => {
    const fetchRequests = [];
    globalThis.fetch = providerFetch(fetchRequests, () => providerChatResponse([
      "下雨时",
      "先缩短户外段。",
    ]));

    const response = await postTravelAssistant(authenticatedMutation(validChatRequest()));
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Accel-Buffering"), "no");
    assert.equal(response.headers.get("Connection"), "keep-alive");
    assert.equal(body, [
      `event: scope\ndata: ${JSON.stringify({ scope: "day", sourceDayIds: ["d14"] })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ delta: "下雨时先缩短户外段。" })}\n\n`,
      "event: done\ndata: {}\n\n",
    ].join(""));

    assert.equal(fetchRequests.length, 1);
    const providerBody = JSON.parse(fetchRequests[0].options.body);
    assert.equal(providerBody.stream, true);
    assert.deepEqual(providerBody.messages.at(-1), {
      role: "user",
      content: "下雨怎么调整？",
    });
    const contextEnvelope = JSON.parse(providerBody.messages[1].content);
    assert.deepEqual(contextEnvelope.context.sourceDayIds, ["d14"]);
    assert.equal(JSON.stringify(providerBody).includes("ledgerExpenses"), false);
    assert.equal(JSON.stringify(providerBody).includes("CALLER_LEDGER_MUST_NOT_LEAK"), false);
  });

  it("routes locked day, date, city, and trip chat scopes before the provider call", async () => {
    const cases = [
      {
        question: "今天下雨怎么调整？",
        scope: "day",
        sourceDayIds: ["d14"],
        matchedDayIds: [],
        tripRows: 0,
      },
      {
        question: "D13 怎么安排？",
        scope: "day",
        sourceDayIds: ["d14", "d13"],
        matchedDayIds: ["d13"],
        tripRows: 0,
      },
      {
        question: "8月12日怎么安排？",
        scope: "day",
        sourceDayIds: ["d14", "d15"],
        matchedDayIds: ["d15"],
        tripRows: 0,
      },
      {
        question: "Cairns 哪天休息？",
        scope: "city",
        sourceDayIds: ["d14", "d10", "d7", "d6"],
        matchedDayIds: ["d10", "d7", "d6"],
        tripRows: 0,
      },
      {
        question: "全程哪天最累？",
        scope: "trip",
        sourceDayIds: ["d14"],
        matchedDayIds: [],
        tripRows: 17,
      },
    ];

    for (const testCase of cases) {
      resetRateLimit();
      const fetchRequests = [];
      globalThis.fetch = providerFetch(fetchRequests, () => providerChatResponse(["按已提供的行程安排。"]));

      const response = await postTravelAssistant(authenticatedMutation({
        ...validChatRequest(),
        question: testCase.question,
      }));
      const responseBody = await response.text();

      assert.equal(response.status, 200, testCase.question);
      assert.match(
        responseBody,
        new RegExp(`event: scope\\ndata: ${escapeRegExp(JSON.stringify({
          scope: testCase.scope,
          sourceDayIds: testCase.sourceDayIds,
        }))}\\n\\n`),
        testCase.question,
      );

      const providerBody = JSON.parse(fetchRequests[0].options.body);
      const context = JSON.parse(providerBody.messages[1].content).context;
      assert.equal(context.scope, testCase.scope, testCase.question);
      assert.deepEqual(context.sourceDayIds, testCase.sourceDayIds, testCase.question);
      assert.equal(context.day.id, "d14", testCase.question);
      assert.equal(context.facts.every((fact) => fact.id.startsWith("block:d14:")), true, testCase.question);
      assert.equal(typeof context.weather.summary, "string", testCase.question);
      assert.equal(Array.isArray(context.checklist), true, testCase.question);
      assert.equal(context.tomorrow.dayId, "d15", testCase.question);
      assert.deepEqual(context.matchedDays.map((day) => day.id), testCase.matchedDayIds, testCase.question);
      assert.equal(context.matchedDays.length <= 3, true, testCase.question);
      assert.equal(context.tripIndex.length, testCase.tripRows, testCase.question);
      assert.equal(context.tripIndex.some((day) => "facts" in day || "resources" in day), false, testCase.question);
      assert.equal(Object.hasOwn(context, "currentDay"), false, testCase.question);
      assert.doesNotMatch(
        JSON.stringify(context),
        /ledger|payer|amount|receipt|operation|supabase|attachment|splitSettled|recentExpenses/i,
        testCase.question,
      );
    }
  });

  it("warns the provider for unknown references while preserving matched facts", async () => {
    const cases = [
      {
        question: "火星基地怎么走？",
        expectedUnmatched: true,
        expectedMatchedDays: [],
      },
      {
        question: "D13 和 D17 怎么安排？",
        expectedUnmatched: true,
        expectedMatchedDays: ["d13"],
      },
      {
        question: "全程交通怎么安排？",
        expectedUnmatched: false,
        expectedMatchedDays: [],
      },
    ];

    for (const testCase of cases) {
      resetRateLimit();
      const fetchRequests = [];
      globalThis.fetch = providerFetch(fetchRequests, () => providerChatResponse(["仅按已提供的事实回答。"]));

      const response = await postTravelAssistant(authenticatedMutation({
        ...validChatRequest(),
        question: testCase.question,
      }));
      assert.equal(response.status, 200, testCase.question);
      await response.text();

      const providerBody = JSON.parse(fetchRequests[0].options.body);
      const context = JSON.parse(providerBody.messages[1].content).context;
      const systemPrompt = providerBody.messages[0].content;
      assert.equal(context.unmatched, testCase.expectedUnmatched, testCase.question);
      assert.deepEqual(context.matchedDays.map((day) => day.id), testCase.expectedMatchedDays, testCase.question);
      if (testCase.expectedUnmatched) {
        assert.match(systemPrompt, /one or more requested place, date, or day references were not found/i, testCase.question);
        assert.match(systemPrompt, /do not infer or invent them/i, testCase.question);
        assert.match(systemPrompt, /answer any matched portion only from supplied facts/i, testCase.question);
      } else {
        assert.doesNotMatch(systemPrompt, /requested place, date, or day references were not found/i, testCase.question);
      }
    }
  });

  it("rejects invalid chat before provider fetch and preserves brief-only shape rules", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("Provider must not be called");
    };
    const cases = [
      { mode: "chat", dayId: "d14" },
      { mode: "chat", dayId: "d14", question: "" },
      { mode: "brief", dayId: "d14", question: "下雨呢？" },
      {
        mode: "chat",
        dayId: "d14",
        question: "下雨呢？",
        history: [{ role: "user", content: "未完成的一轮" }],
      },
    ];

    for (const body of cases) {
      resetRateLimit();
      const response = await postTravelAssistant(authenticatedMutation(body));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
    }
    assert.equal(fetchCalls, 0);
  });

  it("validates the full upstream chat answer before emitting any SSE", async () => {
    const invalidAnswers = [
      "x".repeat(3_001),
      "请先检查付款人和小票。",
      "建议 18:30 出发。",
      "建议安排在 2026-08-11。",
    ];

    for (const answer of invalidAnswers) {
      resetRateLimit();
      globalThis.fetch = providerFetch([], () => providerChatResponse([answer]));
      const response = await postTravelAssistant(authenticatedMutation(validChatRequest()));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
      assert.deepEqual(await response.json(), { error: "assistant_unavailable" });
    }
  });

  it("rate limits the same authenticated session and trusted address with Retry-After", async () => {
    const fetchRequests = [];
    globalThis.fetch = providerFetch(fetchRequests, () => validProviderResponse());

    const first = await postTravelAssistant(authenticatedMutation(validBriefRequest()));
    const second = await postTravelAssistant(authenticatedMutation(validBriefRequest()));

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: "rate_limited" });
    assert.match(second.headers.get("Retry-After") || "", /^[1-9]\d*$/);
    assert.equal(second.headers.get("Cache-Control"), "private, no-store");
    assert.equal(fetchRequests.length, 1);
    assertOnlyProviderUrls(fetchRequests);
  });

  it("enforces ten calls per ten minutes without flaky timing", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("The in-memory limiter must not call the network");
    };
    assert.equal(
      typeof travelAssistantRateLimit.consumeTravelAssistantCall,
      "function",
      rateLimitImportError?.message,
    );
    const request = authenticatedMutation(validBriefRequest());
    for (let index = 0; index < 10; index += 1) {
      const result = travelAssistantRateLimit.consumeTravelAssistantCall(
        request,
        process.env,
        fixedNow + index * 3_001,
      );
      assert.deepEqual(result, { allowed: true });
    }

    const denied = travelAssistantRateLimit.consumeTravelAssistantCall(
      request,
      process.env,
      fixedNow + 10 * 3_001,
    );
    assert.equal(denied.allowed, false);
    assert.equal(Number.isInteger(denied.retryAfterSeconds), true);
    assert.equal(denied.retryAfterSeconds > 0, true);
    assert.equal(fetchCalls, 0);
  });

  it("maps provider timeouts to a generic private 504", async () => {
    const fetchRequests = [];
    globalThis.fetch = providerFetch(fetchRequests, () => {
      const error = new Error("synthetic timeout detail");
      error.name = "AbortError";
      throw error;
    });
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    let response;
    try {
      response = await postTravelAssistant(authenticatedMutation(validBriefRequest()));
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: "assistant_timeout" });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assertOnlyProviderUrls(fetchRequests);
  });

  it("maps provider configuration, network, upstream, and malformed output failures to generic private 502s", async () => {
    const cases = [
      {
        name: "missing configuration",
        expectedFetchCalls: 0,
        prepare() {
          delete process.env.TRAVEL_AI_API_KEY;
          const requests = [];
          globalThis.fetch = async (url, options = {}) => {
            requests.push({ url: String(url), options });
            throw new Error("Provider must not be called without configuration");
          };
          return requests;
        },
      },
      {
        name: "network failure",
        expectedFetchCalls: 1,
        prepare() {
          const requests = [];
          globalThis.fetch = providerFetch(requests, () => {
            throw new Error("synthetic network detail");
          });
          return requests;
        },
      },
      {
        name: "upstream failure",
        expectedFetchCalls: 1,
        prepare() {
          const requests = [];
          globalThis.fetch = providerFetch(requests, () => Response.json({
            private_upstream_detail: "must not leak",
          }, { status: 503 }));
          return requests;
        },
      },
      {
        name: "invalid provider envelope",
        expectedFetchCalls: 1,
        prepare() {
          const requests = [];
          globalThis.fetch = providerFetch(requests, () => Response.json({ choices: [] }));
          return requests;
        },
      },
      {
        name: "invalid assistant output",
        expectedFetchCalls: 1,
        prepare() {
          const requests = [];
          globalThis.fetch = providerFetch(requests, () => validProviderResponse({
            ...validBriefOutput(),
            priorities: validBriefOutput().priorities.slice(0, 2),
          }));
          return requests;
        },
      },
    ];

    for (const testCase of cases) {
      resetRateLimit();
      globalThis.fetch = async () => {
        throw new Error("Unexpected provider call");
      };
      const fetchRequests = testCase.prepare();
      const response = await postTravelAssistant(authenticatedMutation(validBriefRequest(), {
        address: `203.0.113.${fetchRequests.length + 20}`,
      }));
      const payload = await response.json();

      assert.equal(response.status, 502, testCase.name);
      assert.deepEqual(payload, { error: "assistant_unavailable" }, testCase.name);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store", testCase.name);
      assert.equal(JSON.stringify(payload).includes("detail"), false, testCase.name);
      assert.equal(fetchRequests.length, testCase.expectedFetchCalls, testCase.name);
      assertOnlyProviderUrls(fetchRequests);

      process.env.TRAVEL_AI_API_KEY = "synthetic-travel-assistant-key";
    }
  });
});

async function postTravelAssistant(request) {
  assert.equal(typeof travelAssistantRoute.POST, "function", routeImportError?.message);
  return travelAssistantRoute.POST(request);
}

function resetRateLimit() {
  if (typeof travelAssistantRateLimit.resetTravelAssistantRateLimitForTests === "function") {
    travelAssistantRateLimit.resetTravelAssistantRateLimitForTests();
  }
}

function authenticatedMutation(body, options = {}) {
  const token = createSessionToken(process.env.SESSION_SECRET, fixedNow);
  const headers = {
    Cookie: `aussie_chill_session=${token}`,
    Origin: "https://aussie.example",
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json",
    "X-Forwarded-For": options.address || "203.0.113.10",
    ...(options.headers || {}),
  };
  if (options.headers && !("Origin" in options.headers)) delete headers.Origin;
  if (options.omitFetchSite) delete headers["Sec-Fetch-Site"];
  const rawBody = options.rawBody ?? JSON.stringify(body);
  return new Request("https://aussie.example/api/travel-assistant", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function validBriefRequest() {
  return { mode: "brief", dayId: "d1" };
}

function validChatRequest() {
  return {
    mode: "chat",
    dayId: "d14",
    question: "下雨怎么调整？",
    history: [
      { role: "user", content: "今天体力一般。" },
      { role: "assistant", content: "优先保留主线。" },
    ],
  };
}

function validBriefOutput() {
  return {
    pace: { level: "balanced", note: "Keep transitions calm and flexible." },
    priorities: [
      {
        factId: "block:d1:10",
        reason: "Start with a gentle transition before adding more stops.",
      },
      {
        factId: "block:d1:45",
        reason: "Protect the fixed stop while energy is still steady.",
      },
      {
        factId: "block:d1:70",
        reason: "Keep the final anchor visible and simplify around it.",
      },
    ],
    tradeoffs: ["Treat optional indoor time as the first flexible element."],
    firstCut: {
      factId: "block:d1:60",
      reason: "Drop the optional stop first if energy falls.",
    },
    tomorrowPrepItemIds: ["power", "weather-shell"],
    suggestedQuestions: ["Which optional stop is easiest to skip?"],
  };
}

function expectedBriefOutput() {
  return {
    pace: { level: "balanced", note: "Keep transitions calm and flexible." },
    priorities: [
      {
        factId: "block:d1:10",
        title: "墨尔本机场 → CBD",
        reason: "Start with a gentle transition before adding more stops.",
      },
      {
        factId: "block:d1:45",
        title: "Carlton / Lygon Street (Little Italy)",
        reason: "Protect the fixed stop while energy is still steady.",
      },
      {
        factId: "block:d1:70",
        title: "Queen Victoria Market",
        reason: "Keep the final anchor visible and simplify around it.",
      },
    ],
    tradeoffs: ["Treat optional indoor time as the first flexible element."],
    firstCut: {
      factId: "block:d1:60",
      title: "NGV",
      reason: "Drop the optional stop first if energy falls.",
    },
    tomorrowPrep: [
      {
        id: "power",
        label: "手机电量 / 充电宝",
        detail: "地图、支付、票据都靠手机，出门前确认满电。",
      },
      {
        id: "weather-shell",
        label: "防风防雨外套",
        detail: "澳洲冬天海边和雨林温差明显。",
      },
    ],
    suggestedQuestions: ["Which optional stop is easiest to skip?"],
    sourceDayIds: ["d1"],
  };
}

function validProviderResponse(output = validBriefOutput()) {
  return providerChatResponse([JSON.stringify(output)]);
}

function providerChatResponse(deltas) {
  const encoder = new TextEncoder();
  const events = [
    ...deltas.map((content) => (
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
    )),
    "data: [DONE]\n\n",
  ];
  return new Response(new ReadableStream({
    pull(controller) {
      const event = events.shift();
      if (event === undefined) controller.close();
      else controller.enqueue(encoder.encode(event));
    },
  }), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function providerFetch(requests, respond) {
  return async (url, options = {}) => {
    const requestedUrl = String(url);
    requests.push({ url: requestedUrl, options });
    assert.equal(requestedUrl, providerUrl);
    return respond(requestedUrl, options);
  };
}

function assertOnlyProviderUrls(requests) {
  for (const request of requests) assert.equal(request.url, providerUrl);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
