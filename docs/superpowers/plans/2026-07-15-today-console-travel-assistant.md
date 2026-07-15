# Today Console Travel Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand, privacy-bounded AI daily brief and follow-up conversation to Today Console, then release current-day and whole-trip query support in V1, V1.1, and V1.2 without changing itinerary, ledger, receipt, offline, or Supabase data.

**Architecture:** One authenticated same-origin `POST /api/travel-assistant` route handles `brief` and `chat`. The server reconstructs an allowlisted fact pack from `itinerary.generated.json`, accepts only normalized weather and checklist IDs from the browser, validates model output against source IDs, and returns private JSON or validated SSE. Briefs and conversations remain in versioned localStorage caches; the AI card is inserted after the deterministic ticket docket and before the checklist/ledger field kit.

**Tech Stack:** Next.js 16 App Router, React 19, Node 24 built-in test runner, native Fetch/ReadableStream, Playwright, existing protected session and same-origin helpers, Vercel Functions and environment variables.

---

## File map

Create focused modules rather than adding AI logic to the ledger or itinerary source files:

- `src/lib/server/travelAssistantContext.js` — allowlisted day projection, fact IDs, tomorrow checklist, trip index, and deterministic query routing.
- `src/lib/server/travelAssistantSchema.js` — request normalization, brief/chat output validation, sensitive-field and unsupported-time guards.
- `src/lib/server/travelAssistantProvider.js` — server-only provider configuration, timeout, JSON completion, and buffered stream parsing.
- `src/lib/server/travelAssistantRateLimit.js` — best-effort in-memory session/IP throttle with no Supabase dependency.
- `src/app/api/travel-assistant/route.ts` — authentication, same-origin boundary, size limit, dispatch, and private responses.
- `src/lib/travelAssistantCache.js` — browser-only fingerprint, brief cache, conversation cache, and clear functions.
- `src/components/itinerary/TravelAssistantPanel.jsx` — the selected in-flow dispatch card and chat UI.
- `tests/travel-assistant-context.test.mjs` — allowlist and D0-D16 routing tests.
- `tests/travel-assistant-schema.test.mjs` — request and model-output guard tests.
- `tests/travel-assistant-provider.test.mjs` — compatible provider response and timeout tests.
- `tests/travel-assistant-route.test.mjs` — authentication, origin, limit, privacy, and response tests.
- `tests/travel-assistant-cache.test.mjs` — refresh/no-repeat and stale-fingerprint tests.
- `tests/travel-assistant-ui.test.mjs` — source/CSS contract tests.
- `e2e/travel-assistant.spec.js` — rendered V1/V1.1/V1.2 behavior and responsive checks.

Modify only these existing files:

- `src/lib/apiClient.js` — same-origin brief and streamed chat calls.
- `src/components/itinerary/TodayConsole.jsx` — insert the assistant panel; do not give it ledger props.
- `src/components/ItineraryApp.jsx` — pass current day, weather, and checklist state only.
- `src/styles/route-atlas.css` — AI dispatch card and responsive styles.
- `e2e/fixtures/mock-api.js` — deterministic assistant responses and request capture.
- `e2e/itinerary.spec.js` only if shared Today Console assertions must be extended; otherwise leave it unchanged.
- `docs/operations/aussie-production-baseline.md` — append deployment IDs and verification evidence after each release.

Do not modify `content/aussie-itinerary.xlsx`, generated itinerary content, ledger calculations, receipt routes, offline ledger modules, Supabase code, or migrations.

---

## V1 — on-demand structured daily brief

### Task 1: Record a clean baseline

**Files:**
- Inspect only: current worktree

- [ ] **Step 1: Confirm the protected recovery worktree is clean except for committed design/plan documents**

Run:

```bash
export PATH="/Users/SeanSun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node --version
git status --short
git log -2 --oneline
```

Expected: Node reports `v24.14.0`; there are no application-code changes; the design commit is present.

- [ ] **Step 2: Run the current unit, lint, build, and local browser baselines**

Run:

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: every command exits 0. Record the test counts in the execution notes before touching code.

### Task 2: Build the allowlisted current-day context

**Files:**
- Create: `src/lib/server/travelAssistantContext.js`
- Create: `tests/travel-assistant-context.test.mjs`

- [ ] **Step 1: Write the failing allowlist tests**

Create `tests/travel-assistant-context.test.mjs` with tests equivalent to:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBriefContext,
  buildTripIndex,
} from "../src/lib/server/travelAssistantContext.js";

describe("travel assistant allowlisted context", () => {
  it("builds D14 facts from itinerary, weather, and valid checklist ids", () => {
    const context = buildBriefContext({
      dayId: "d14",
      weather: {
        status: "forecast",
        summary: "晴 · 9-18°C",
        adviceLabel: "预报穿衣建议",
        detail: "长袖 + 薄外套",
      },
      checkedKitItemIds: ["power", "weather-shell", "not-a-real-item"],
    });

    assert.equal(context.day.id, "d14");
    assert.equal(context.day.city, "悉尼");
    assert.equal(context.weather.summary, "晴 · 9-18°C");
    assert.equal(context.checklist.find((item) => item.id === "power").checked, true);
    assert.equal(context.checklist.some((item) => item.id === "not-a-real-item"), false);
    assert.equal(context.facts.every((fact) => /^block:d14:\d+$/.test(fact.id)), true);
    assert.equal(context.tomorrow.dayId, "d15");
  });

  it("contains no ledger, payer, amount, receipt, operation, or Supabase fields", () => {
    const serialized = JSON.stringify(buildBriefContext({ dayId: "d14" }));
    assert.doesNotMatch(serialized, /ledger|payer|amount|receipt|operation|supabase/i);
    assert.doesNotMatch(serialized, /attachment|splitSettled|recentExpenses/i);
  });

  it("returns a compact D0-D16 index", () => {
    const index = buildTripIndex();
    assert.equal(index.length, 17);
    assert.deepEqual(Object.keys(index[0]).sort(), ["city", "date", "focus", "id", "stops", "title", "transport"]);
  });

  it("rejects an unknown day id", () => {
    assert.throws(() => buildBriefContext({ dayId: "d17" }), /Invalid day id/);
  });
});
```

- [ ] **Step 2: Run the context test and confirm it fails**

Run:

```bash
node --conditions=react-server --test tests/travel-assistant-context.test.mjs
```

Expected: FAIL because `travelAssistantContext.js` does not exist.

- [ ] **Step 3: Implement the minimal context projection**

Create `src/lib/server/travelAssistantContext.js` with these exported interfaces and no ledger imports:

```js
import "server-only";

import itinerary from "../../data/itinerary.generated.json" with { type: "json" };
import { buildDayCarryChecklist, parseMealPlan } from "../today.js";

const DAY_ID_PATTERN = /^d(?:[0-9]|1[0-6])$/;
const WEATHER_STATUSES = new Set(["live", "forecast", "fallback"]);

export function buildBriefContext({ dayId, weather, checkedKitItemIds = [] }) {
  const day = findDay(dayId);
  const dayIndex = itinerary.days.findIndex((entry) => entry.id === day.id);
  const tomorrowDay = itinerary.days[dayIndex + 1] || null;
  const allowedCheckedIds = new Set(Array.isArray(checkedKitItemIds) ? checkedKitItemIds : []);
  const checklist = buildDayCarryChecklist(day).map((item) => ({
    id: item.id,
    label: item.label,
    detail: item.detail,
    checked: allowedCheckedIds.has(item.id),
  }));

  return {
    scope: "today",
    sourceDayIds: [day.id],
    day: projectDay(day),
    weather: normalizeWeather(weather, day),
    checklist,
    facts: buildBlockFacts(day),
    tomorrow: tomorrowDay ? {
      dayId: tomorrowDay.id,
      title: tomorrowDay.title,
      checklist: buildDayCarryChecklist(tomorrowDay).map(projectChecklistItem),
    } : null,
  };
}

export function buildTripIndex() {
  return itinerary.days.map((day) => ({
    id: day.id,
    date: day.date,
    city: day.city,
    title: day.title,
    focus: day.focus,
    transport: day.transport,
    stops: buildBlockFacts(day).slice(0, 4).map((fact) => fact.title),
  }));
}

export function findDay(dayId) {
  if (typeof dayId !== "string" || !DAY_ID_PATTERN.test(dayId)) throw new TypeError("Invalid day id");
  const day = itinerary.days.find((entry) => entry.id === dayId);
  if (!day) throw new TypeError("Invalid day id");
  return day;
}

function projectDay(day) {
  return {
    id: day.id,
    label: day.label,
    date: day.date,
    weekday: day.weekday,
    city: day.city,
    title: day.title,
    focus: day.focus,
    transport: day.transport,
    leaveBy: day.leaveBy,
    lodging: day.lodging,
    climateNote: day.climateNote,
    clothingNote: day.clothingNote,
    meals: parseMealPlan(day),
    resources: collectAllowedResources(day),
  };
}

function buildBlockFacts(day) {
  return (day.blocks || []).filter((block) => block.period !== "饮食").map((block) => ({
    id: `block:${day.id}:${block.sortOrder}`,
    period: block.period,
    title: block.place,
    activity: block.activity,
    highlight: block.highlight,
    tip: block.tip,
  }));
}

function collectAllowedResources(day) {
  const resources = [day.lodgingResource, day.primaryResource, day.ticketResource, ...(day.blocks || []).flatMap((block) => block.resources || [])];
  const seen = new Set();
  return resources.filter(Boolean).filter((resource) => {
    if (seen.has(resource.id)) return false;
    seen.add(resource.id);
    return true;
  }).map((resource) => ({ id: resource.id, title: resource.title, type: resource.type }));
}

function normalizeWeather(weather, day) {
  const fallback = {
    status: "fallback",
    summary: day.climateNote,
    adviceLabel: "季节穿衣参考",
    detail: day.clothingNote,
  };
  if (!weather || !WEATHER_STATUSES.has(weather.status)) return fallback;
  return {
    status: weather.status,
    summary: safeText(weather.summary, 120) || fallback.summary,
    adviceLabel: safeText(weather.adviceLabel, 40) || fallback.adviceLabel,
    detail: safeText(weather.detail, 160) || fallback.detail,
  };
}

function projectChecklistItem(item) {
  return { id: item.id, label: item.label, detail: item.detail };
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
```

- [ ] **Step 4: Run the focused and existing itinerary tests**

Run:

```bash
node --conditions=react-server --test tests/travel-assistant-context.test.mjs tests/itinerary.test.mjs tests/itinerary-generated.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the allowlisted context**

```bash
git add src/lib/server/travelAssistantContext.js tests/travel-assistant-context.test.mjs
git commit -m "feat: build allowlisted travel assistant context"
```

### Task 3: Validate requests and structured brief output

**Files:**
- Create: `src/lib/server/travelAssistantSchema.js`
- Create: `tests/travel-assistant-schema.test.mjs`

- [ ] **Step 1: Write failing schema and fact-guard tests**

Cover all of these exact behaviors in `tests/travel-assistant-schema.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildBriefContext } from "../src/lib/server/travelAssistantContext.js";
import {
  parseTravelAssistantRequest,
  validateBriefOutput,
} from "../src/lib/server/travelAssistantSchema.js";

const context = buildBriefContext({ dayId: "d14" });
const factIds = context.facts.map((fact) => fact.id);

describe("travel assistant schema", () => {
  it("accepts only the V1 brief request shape", () => {
    const parsed = parseTravelAssistantRequest(JSON.stringify({
      mode: "brief",
      dayId: "d14",
      weather: { status: "forecast", summary: "晴", detail: "薄外套", adviceLabel: "预报穿衣建议" },
      checkedKitItemIds: ["power"],
    }), { allowedModes: ["brief"] });
    assert.deepEqual(parsed.checkedKitItemIds, ["power"]);
    assert.equal(parsed.mode, "brief");
  });

  it("rejects unknown fields and oversized bodies", () => {
    assert.throws(() => parseTravelAssistantRequest(JSON.stringify({ mode: "brief", dayId: "d14", ledgerExpenses: [] }), { allowedModes: ["brief"] }));
    assert.throws(() => parseTravelAssistantRequest("x".repeat(16_385), { allowedModes: ["brief"] }));
  });

  it("enriches valid source ids with deterministic titles", () => {
    const output = validateBriefOutput({
      pace: { level: "balanced", note: "先完成固定项目，再按体力调整。" },
      priorities: factIds.slice(0, 3).map((factId) => ({ factId, reason: "它决定今天的主线。" })),
      tradeoffs: ["下午只保留一段海岸步行。"],
      firstCut: { factId: factIds.at(-1), reason: "体力下降时先缩短这一段。" },
      tomorrowPrepItemIds: context.tomorrow.checklist.slice(0, 2).map((item) => item.id),
      suggestedQuestions: ["下雨怎么调整？", "午餐放在哪里最顺？"],
    }, context);
    assert.equal(output.priorities[0].title, context.facts[0].title);
    assert.equal(output.tomorrowPrep[0].label, context.tomorrow.checklist[0].label);
  });

  it("rejects unknown fact ids, money, private fields, and exact times in advice", () => {
    const base = {
      pace: { level: "balanced", note: "按体力走。" },
      priorities: factIds.slice(0, 3).map((factId) => ({ factId, reason: "主线项目。" })),
      tradeoffs: ["保留主线。"],
      firstCut: { factId: factIds.at(-1), reason: "先删次要段。" },
      tomorrowPrepItemIds: [],
      suggestedQuestions: ["下雨怎么调整？"],
    };
    assert.throws(() => validateBriefOutput({ ...base, priorities: [{ factId: "block:d14:999", reason: "未知" }, ...base.priorities.slice(1)] }, context));
    assert.throws(() => validateBriefOutput({ ...base, tradeoffs: ["付款人先支付 A$99。"] }, context));
    assert.throws(() => validateBriefOutput({ ...base, pace: { level: "balanced", note: "18:30 出发。" } }, context));
  });
});
```

- [ ] **Step 2: Run the schema test and confirm it fails**

Run:

```bash
node --conditions=react-server --test tests/travel-assistant-schema.test.mjs
```

Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Implement strict parsing and output enrichment**

Create `src/lib/server/travelAssistantSchema.js` with:

```js
import "server-only";

const MAX_BODY_BYTES = 16_384;
const SAFE_MODES = new Set(["brief", "chat"]);
const WEATHER_KEYS = new Set(["status", "summary", "detail", "adviceLabel"]);
const REQUEST_KEYS = new Set(["mode", "dayId", "weather", "checkedKitItemIds", "question", "history"]);
const SENSITIVE_PATTERN = /(?:ledger|payer|amount|receipt|attachment|operation|supabase|付款人|分摊|小票|收据|金额|A\$\s*\d|[$¥€£]|\b(?:AUD|CNY|RMB)\b)/i;
const EXACT_TIME_PATTERN = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/;
const EXACT_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b|\d{1,2}月\d{1,2}日/;

export function parseTravelAssistantRequest(rawBody, { allowedModes = ["brief", "chat"] } = {}) {
  if (typeof rawBody !== "string" || Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) throw new TypeError("Invalid request");
  let body;
  try { body = JSON.parse(rawBody); } catch { throw new TypeError("Invalid request"); }
  if (!isRecord(body) || Object.keys(body).some((key) => !REQUEST_KEYS.has(key))) throw new TypeError("Invalid request");
  if (!SAFE_MODES.has(body.mode) || !allowedModes.includes(body.mode)) throw new TypeError("Invalid request");
  if (!/^d(?:[0-9]|1[0-6])$/.test(body.dayId || "")) throw new TypeError("Invalid request");
  if (body.weather !== undefined && (!isRecord(body.weather) || Object.keys(body.weather).some((key) => !WEATHER_KEYS.has(key)))) throw new TypeError("Invalid request");
  if (body.checkedKitItemIds !== undefined && (!Array.isArray(body.checkedKitItemIds) || body.checkedKitItemIds.length > 12)) throw new TypeError("Invalid request");
  return {
    mode: body.mode,
    dayId: body.dayId,
    weather: normalizeWeather(body.weather),
    checkedKitItemIds: uniqueIds(body.checkedKitItemIds),
    question: normalizeQuestion(body.question),
    history: normalizeHistory(body.history),
  };
}

export function validateBriefOutput(raw, context) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isRecord(value) || !isRecord(value.pace) || !["easy", "balanced", "full"].includes(value.pace.level)) throw new TypeError("Invalid brief output");
  const facts = new Map(context.facts.map((fact) => [fact.id, fact]));
  const tomorrowItems = new Map((context.tomorrow?.checklist || []).map((item) => [item.id, item]));
  if (!Array.isArray(value.priorities) || value.priorities.length !== 3) throw new TypeError("Invalid brief output");
  const priorities = value.priorities.map((item) => enrichFactAdvice(item, facts));
  if (!Array.isArray(value.tradeoffs) || value.tradeoffs.length < 1 || value.tradeoffs.length > 3) throw new TypeError("Invalid brief output");
  const tradeoffs = value.tradeoffs.map((text) => safeAdvice(text, 120));
  const firstCut = enrichFactAdvice(value.firstCut, facts);
  if (!Array.isArray(value.tomorrowPrepItemIds) || value.tomorrowPrepItemIds.length > 4) throw new TypeError("Invalid brief output");
  const tomorrowPrep = value.tomorrowPrepItemIds.map((id) => {
    const item = tomorrowItems.get(id);
    if (!item) throw new TypeError("Invalid brief output");
    return item;
  });
  if (!Array.isArray(value.suggestedQuestions) || value.suggestedQuestions.length < 1 || value.suggestedQuestions.length > 4) throw new TypeError("Invalid brief output");
  return {
    pace: { level: value.pace.level, note: safeAdvice(value.pace.note, 140) },
    priorities,
    tradeoffs,
    firstCut,
    tomorrowPrep,
    suggestedQuestions: value.suggestedQuestions.map((text) => safeAdvice(text, 80)),
    sourceDayIds: context.sourceDayIds,
  };
}

function enrichFactAdvice(item, facts) {
  if (!isRecord(item) || typeof item.factId !== "string" || !facts.has(item.factId)) throw new TypeError("Invalid brief output");
  return { factId: item.factId, title: facts.get(item.factId).title, reason: safeAdvice(item.reason, 100) };
}

function safeAdvice(value, maxLength) {
  if (typeof value !== "string") throw new TypeError("Invalid advice text");
  const text = value.trim();
  if (!text || text.length > maxLength || SENSITIVE_PATTERN.test(text) || EXACT_TIME_PATTERN.test(text) || EXACT_DATE_PATTERN.test(text)) throw new TypeError("Invalid advice text");
  return text;
}

function normalizeWeather(weather) {
  if (!isRecord(weather)) return undefined;
  return Object.fromEntries(Object.entries(weather).map(([key, value]) => [key, typeof value === "string" ? value.trim().slice(0, 160) : ""]));
}

function uniqueIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value)))];
}

function normalizeQuestion(value) {
  if (value === undefined) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > 400) throw new TypeError("Invalid request");
  return value.trim();
}

function normalizeHistory(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("Invalid request");
  return value.map((entry) => {
    if (!isRecord(entry) || !["user", "assistant"].includes(entry.role) || typeof entry.content !== "string" || entry.content.length > 2_000) throw new TypeError("Invalid request");
    return { role: entry.role, content: entry.content.trim() };
  });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **Step 4: Run the schema and context tests**

Run:

```bash
node --conditions=react-server --test tests/travel-assistant-context.test.mjs tests/travel-assistant-schema.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the request and brief guard**

```bash
git add src/lib/server/travelAssistantSchema.js tests/travel-assistant-schema.test.mjs
git commit -m "feat: validate travel assistant facts"
```

### Task 4: Add the compatible provider client and timeout

**Files:**
- Create: `src/lib/server/travelAssistantProvider.js`
- Create: `tests/travel-assistant-provider.test.mjs`

- [ ] **Step 1: Write failing provider tests**

Test configuration, request shape, JSON-string parsing, sanitized failures, and timeout:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requestTravelBrief, readTravelAssistantConfig } from "../src/lib/server/travelAssistantProvider.js";

const env = {
  TRAVEL_AI_API_KEY: "provider-test-secret",
  TRAVEL_AI_BASE_URL: "https://provider.example",
  TRAVEL_AI_MODEL: "gpt-5-mini",
};

describe("travel assistant provider", () => {
  it("reads only server configuration", () => {
    assert.deepEqual(readTravelAssistantConfig(env), {
      apiKey: "provider-test-secret",
      baseUrl: "https://provider.example",
      model: "gpt-5-mini",
    });
  });

  it("requests JSON object output and parses message content", async () => {
    const calls = [];
    const output = await requestTravelBrief({ context: { day: { id: "d14" } }, env, fetcher: async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ choices: [{ message: { content: "{\"pace\":{}}" } }] });
    } });
    assert.deepEqual(output, { pace: {} });
    assert.equal(calls[0].url, "https://provider.example/v1/chat/completions");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, "gpt-5-mini");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(calls[0].options.headers.Authorization, "Bearer provider-test-secret");
  });

  it("does not expose upstream bodies on failure", async () => {
    await assert.rejects(
      () => requestTravelBrief({ context: {}, env, fetcher: async () => new Response("secret upstream detail", { status: 500 }) }),
      (error) => error.code === "provider_unavailable" && !error.message.includes("secret upstream detail"),
    );
  });

  it("aborts after the configured timeout", async () => {
    await assert.rejects(
      () => requestTravelBrief({ context: {}, env, timeoutMs: 5, fetcher: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))) }),
      (error) => error.code === "provider_timeout",
    );
  });
});
```

- [ ] **Step 2: Run the provider test and confirm it fails**

```bash
node --conditions=react-server --test tests/travel-assistant-provider.test.mjs
```

Expected: FAIL because the provider module does not exist.

- [ ] **Step 3: Implement the server-only provider**

Create `src/lib/server/travelAssistantProvider.js` with a `TravelAssistantProviderError`, HTTPS config validation, a 20-second default timeout, and this request body:

```js
{
  model,
  temperature: 0.2,
  response_format: { type: "json_object" },
  messages: [
    {
      role: "system",
      content: "You are a travel operations advisor. Return only JSON matching the requested schema. Select only supplied fact IDs and checklist IDs. Do not invent or restate exact times, dates, bookings, prices, people, or places. Reasons must be generic and concise. Hard facts remain controlled by the website.",
    },
    {
      role: "user",
      content: JSON.stringify({ task: "daily_brief", outputSchema: BRIEF_OUTPUT_SHAPE, context }),
    },
  ],
}
```

Define `BRIEF_OUTPUT_SHAPE` as the literal keys from the design: `pace`, exactly three `priorities`, `tradeoffs`, `firstCut`, `tomorrowPrepItemIds`, and `suggestedQuestions`. Parse `choices[0].message.content` with `JSON.parse`; never return the upstream error body. In `finally`, clear the timeout.

- [ ] **Step 4: Run focused tests**

```bash
node --conditions=react-server --test tests/travel-assistant-provider.test.mjs tests/travel-assistant-schema.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the provider client**

```bash
git add src/lib/server/travelAssistantProvider.js tests/travel-assistant-provider.test.mjs
git commit -m "feat: call compatible travel brief provider"
```

### Task 5: Protect and expose the V1 brief route

**Files:**
- Create: `src/lib/server/travelAssistantRateLimit.js`
- Create: `src/app/api/travel-assistant/route.ts`
- Create: `tests/travel-assistant-route.test.mjs`

- [ ] **Step 1: Write failing route boundary tests**

The tests must verify all of the following with a fake session and mocked `globalThis.fetch`:

```js
it("rejects unauthenticated requests before reading the body", async () => { /* expect 401 and bodyRead false */ });
it("rejects missing or cross-site origin metadata", async () => { /* expect 403 */ });
it("rejects invalid day ids, extra fields, and bodies over 16 KiB before provider fetch", async () => { /* expect 400 and fetch calls 0 */ });
it("returns a validated private brief without forwarding ledger fields", async () => { /* expect 200, private/no-store, three priorities */ });
it("returns 429 with Retry-After after the short-window limit", async () => { /* inject repeated same token and address */ });
it("maps provider timeout to 504 and other provider failures to 502", async () => { /* generic errors only */ });
it("never calls Supabase or a receipt route", async () => { /* every fetch URL must equal provider /v1/chat/completions */ });
```

Use the existing `createSessionToken`, `Origin`, `Sec-Fetch-Site`, and cookie patterns from `tests/server-routes.test.mjs`.

- [ ] **Step 2: Run the route test and confirm it fails**

```bash
node --conditions=react-server --test tests/travel-assistant-route.test.mjs
```

Expected: FAIL because the route and limiter do not exist.

- [ ] **Step 3: Implement the no-Supabase basic limiter**

Create `src/lib/server/travelAssistantRateLimit.js` with a module-scoped `Map`, a 3-second minimum interval, 10 calls per 10 minutes, a HMAC key made from the session token and trusted source address, and exports:

```js
export function consumeTravelAssistantCall(request, env = process.env, now = Date.now()) {
  // returns { allowed: true } or { allowed: false, retryAfterSeconds }
}

export function resetTravelAssistantRateLimitForTests() {
  buckets.clear();
}
```

Use `readSessionToken`, `readSessionConfig`, and `trustedSourceAddress`; store only the HMAC digest. Remove expired buckets during each call and cap the map at 1,000 entries by deleting the oldest key.

- [ ] **Step 4: Implement the protected route**

Create `src/app/api/travel-assistant/route.ts` with this order of operations:

```ts
export async function POST(request: Request) {
  try {
    if (!isRequestAuthenticated(request)) return authenticationRequiredResponse();
    assertSameOriginMutation(request);

    const limit = consumeTravelAssistantCall(request);
    if (!limit.allowed) return privateJsonResponse(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );

    const input = parseTravelAssistantRequest(await request.text(), { allowedModes: ["brief"] });
    const context = buildBriefContext(input);
    const rawBrief = await requestTravelBrief({ context });
    const brief = validateBriefOutput(rawBrief, context);
    return privateJsonResponse({ brief, sourceDayIds: context.sourceDayIds, generatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof RequestSecurityError) return requestRejectedResponse();
    if (error instanceof TypeError) return invalidRequestResponse();
    if (error?.code === "provider_timeout") return privateJsonResponse({ error: "assistant_timeout" }, { status: 504 });
    return privateJsonResponse({ error: "assistant_unavailable" }, { status: 502 });
  }
}
```

Set `export const runtime = "nodejs"` and import `server-only` modules only from the route.

- [ ] **Step 5: Run route, security, and server regression tests**

```bash
node --conditions=react-server --test tests/travel-assistant-route.test.mjs tests/http-security.test.mjs tests/server-routes.test.mjs tests/lockdown-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the V1 server route**

```bash
git add src/lib/server/travelAssistantRateLimit.js src/app/api/travel-assistant/route.ts tests/travel-assistant-route.test.mjs
git commit -m "feat: protect daily travel brief route"
```

### Task 6: Add browser cache and brief API call

**Files:**
- Create: `src/lib/travelAssistantCache.js`
- Create: `tests/travel-assistant-cache.test.mjs`
- Modify: `src/lib/apiClient.js:1-120`
- Modify: `tests/api-client.test.mjs`

- [ ] **Step 1: Write failing cache tests**

Test the exact local-only behavior:

```js
it("returns fresh for the same day fingerprint after refresh", () => { /* write then read with same fingerprint */ });
it("returns stale while retaining the old brief when weather or checklist changes", () => { /* changed fingerprint */ });
it("keeps D14 and D15 cache entries separate", () => { /* separate keys */ });
it("returns empty for malformed or wrong-version localStorage values", () => { /* no throw */ });
```

Use a Map-backed storage fixture with `getItem`, `setItem`, and `removeItem`.

- [ ] **Step 2: Run the cache test and confirm it fails**

```bash
node --conditions=react-server --test tests/travel-assistant-cache.test.mjs
```

Expected: FAIL because the cache module does not exist.

- [ ] **Step 3: Implement versioned fingerprint and brief cache**

Create `src/lib/travelAssistantCache.js` exporting:

```js
export function buildTravelAssistantFingerprint({ day, weather, checkedKitItemIds }) { /* stable projection + FNV-1a hex */ }
export function readTravelBriefCache(storage, dayId, fingerprint) { /* { state: empty|fresh|stale, entry } */ }
export function writeTravelBriefCache(storage, dayId, entry) { /* version: 1 */ }
export function clearTravelBriefCache(storage, dayId) { /* remove only the selected day */ }
```

The fingerprint projection must contain only day `id/date/city/title/focus/transport/leaveBy/lodging`, block `sortOrder/period/place/activity/highlight/tip`, normalized weather strings, and sorted checked IDs. It must not accept expenses, receipt objects, or Supabase data.

- [ ] **Step 4: Add the same-origin brief client**

Add to `src/lib/apiClient.js`:

```js
export function generateTravelBrief(payload) {
  return requestJson("/api/travel-assistant", {
    method: "POST",
    body: JSON.stringify({ ...payload, mode: "brief" }),
  });
}
```

Extend the existing API client test so the captured request is relative, uses `credentials: "same-origin"`, includes only `mode`, `dayId`, `weather`, and `checkedKitItemIds`, and contains no `ledger`, `payer`, `amount`, `receipt`, `operation`, or `supabase` substring.

- [ ] **Step 5: Run cache and API client tests**

```bash
node --conditions=react-server --test tests/travel-assistant-cache.test.mjs tests/api-client.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the browser data layer**

```bash
git add src/lib/travelAssistantCache.js src/lib/apiClient.js tests/travel-assistant-cache.test.mjs tests/api-client.test.mjs
git commit -m "feat: cache daily travel briefs locally"
```

### Task 7: Render V1 inside Today Console

**Files:**
- Create: `src/components/itinerary/TravelAssistantPanel.jsx`
- Modify: `src/components/itinerary/TodayConsole.jsx:1-70`
- Modify: `src/components/ItineraryApp.jsx:215-235`
- Modify: `src/styles/route-atlas.css:539-1210`
- Create: `tests/travel-assistant-ui.test.mjs`

- [ ] **Step 1: Write failing source and responsive style contracts**

Create `tests/travel-assistant-ui.test.mjs` to assert:

```js
assert.match(todayConsoleSource, /<TravelAssistantPanel[\s\S]*?<div className="today-field-kit"/);
assert.doesNotMatch(panelSource, /ledgerExpenses|ledgerFreshness|formatMoney|receipt|supabase/i);
assert.match(panelSource, /生成今日简报/);
assert.match(panelSource, /资料已更新，可重新生成/);
assert.match(panelSource, /AI 暂不可用，原行程仍可正常查看/);
assert.match(styles, /\.travel-assistant-panel\s*\{/);
assert.match(mobileStyles, /\.travel-assistant-chat-body[\s\S]*?max-height:\s*52vh/);
```

Also assert the panel button is a real `button`, loading uses `aria-live`, and no automatic generation occurs in an effect.

- [ ] **Step 2: Run the UI contract and confirm it fails**

```bash
node --conditions=react-server --test tests/travel-assistant-ui.test.mjs
```

Expected: FAIL because the component and styles do not exist.

- [ ] **Step 3: Implement the V1 component**

`TravelAssistantPanel.jsx` must:

- derive the fingerprint from `day`, `weather`, and `checkedKitItems`;
- read cache in an effect but never call `generateTravelBrief` from an effect;
- guard duplicate clicks with both `loading` state and an `inFlightRef`;
- call `generateTravelBrief` only inside `handleGenerate`;
- write `{ fingerprint, generatedAt, brief, sourceDayIds }` to the day cache;
- keep a stale cached brief visible with the amber update message;
- show deterministic titles returned by the server;
- show statuses for empty, loading, generated, stale, offline, and retryable error.

Use this public component contract:

```jsx
export default function TravelAssistantPanel({ day, weather, checkedKitItems })
```

Do not accept itinerary arrays, expenses, ledger freshness, receipts, or Supabase objects.

- [ ] **Step 4: Insert the panel at the approved location**

In `TodayConsole.jsx`, render:

```jsx
<TodayDocketStrip docket={docket} />
<TravelAssistantPanel
  day={day}
  weather={weather}
  checkedKitItems={checkedKitItems}
/>
<div className="today-field-kit" aria-label="今日出门和账本联动">
```

`ItineraryApp.jsx` continues to pass its existing current day/weather/checklist props. Do not change the ledger sync effect or `TodayLedgerDock`.

- [ ] **Step 5: Add route-atlas styling**

Add an in-flow `.travel-assistant-panel` with existing `--atlas-*` colors, a left terracotta status rule, compact pill button, six brief sections, and no gradients unrelated to the current route-atlas language. At `max-width: 720px`, stack the header/actions, make priorities one column, horizontally scroll suggested questions, and reserve `.travel-assistant-chat-body { max-height: 52vh; overflow-y: auto; }` for V1.1 without rendering chat yet.

- [ ] **Step 6: Run focused UI, layout, lint, and build checks**

```bash
node --conditions=react-server --test tests/travel-assistant-ui.test.mjs tests/itinerary-layout.test.mjs tests/itinerary-checklist-style.test.mjs
npm run lint
npm run build
```

Expected: PASS with no client/server import boundary error.

- [ ] **Step 7: Commit the V1 interface**

```bash
git add src/components/itinerary/TravelAssistantPanel.jsx src/components/itinerary/TodayConsole.jsx src/components/ItineraryApp.jsx src/styles/route-atlas.css tests/travel-assistant-ui.test.mjs
git commit -m "feat: add Today Console AI brief card"
```

### Task 8: Add V1 browser verification and release it

**Files:**
- Modify: `e2e/fixtures/mock-api.js`
- Create: `e2e/travel-assistant.spec.js`
- Modify: `docs/operations/aussie-production-baseline.md`

- [ ] **Step 1: Extend the mock API without touching ledger behavior**

Add a `/api/travel-assistant` handler that records `postDataJSON()` and returns a fixed validated brief for `mode: "brief"`. Keep the existing sync, receipt, access, and itinerary handlers unchanged.

- [ ] **Step 2: Write the failing V1 browser tests**

Cover:

```js
test("does not call AI until Generate is clicked", async ({ page, api }) => { /* zero assistant POSTs before click */ });
test("generates once and reloads from local cache", async ({ page, api }) => { /* one POST across reload */ });
test("marks the cached brief stale after checklist changes", async ({ page }) => { /* old brief remains, update label appears */ });
test("assistant failure leaves weather, ticket docket, checklist, and ledger visible", async ({ page }) => { /* mock 502 */ });
test("desktop and 390px mobile have no overflow", async ({ page }) => { /* documentOverflowsHorizontally false */ });
test("assistant request contains no ledger or receipt fields", async ({ api }) => { /* inspect captured body */ });
```

- [ ] **Step 3: Run the new browser file and make only V1 fixes**

```bash
node e2e/run-tests.mjs --project=local-chrome e2e/travel-assistant.spec.js
```

Expected: PASS.

- [ ] **Step 4: Run the complete V1 regression**

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: all existing ledger, offline, receipt, layout, and itinerary tests remain green.

- [ ] **Step 5: Configure Preview and Production server-only variables interactively**

Run the Vercel environment commands without putting the secret value in shell history or source files:

```bash
vercel env add TRAVEL_AI_API_KEY preview
vercel env add TRAVEL_AI_API_KEY production
vercel env add TRAVEL_AI_BASE_URL preview
vercel env add TRAVEL_AI_BASE_URL production
vercel env add TRAVEL_AI_MODEL preview
vercel env add TRAVEL_AI_MODEL production
vercel env ls
```

Enter the provided secret only at the hidden prompt. Enter `https://www.openai-labs.com` for the base URL and `gpt-5-mini` for the model. Confirm none of the names starts with `NEXT_PUBLIC_`.

- [ ] **Step 6: Deploy and verify V1 Preview**

```bash
vercel
```

On the returned Preview URL, unlock the itinerary, open Today Console, click Generate once, reload, and confirm there is no second request. Inspect the browser request payload and response; neither may contain the API key, ledger values, payer, receipt, operation history, or Supabase data. Force one provider failure and confirm the rest of the page remains functional.

- [ ] **Step 7: Scan the production build artifacts for the configured key**

With the key available only in the current shell environment, run:

```bash
test -z "$(rg -l --fixed-strings "$TRAVEL_AI_API_KEY" .next/static .next/server/app 2>/dev/null | grep -v '/api/travel-assistant/' || true)"
```

Expected: exit 0. The key may exist only in Vercel runtime configuration, never in built files.

- [ ] **Step 8: Commit E2E coverage, deploy V1 Production, and record evidence**

```bash
git add e2e/fixtures/mock-api.js e2e/travel-assistant.spec.js
git commit -m "test: cover on-demand travel briefs"
vercel --prod
```

Run a production smoke generation, record deployment ID, commit, unit/E2E counts, and the no-secret/no-ledger evidence in `docs/operations/aussie-production-baseline.md`, then commit:

```bash
git add docs/operations/aussie-production-baseline.md
git commit -m "docs: record V1 travel brief release"
```

---

## V1.1 — current-day follow-up chat

### Task 9: Add buffered upstream streaming and safe SSE

**Files:**
- Modify: `src/lib/server/travelAssistantProvider.js`
- Modify: `src/lib/server/travelAssistantSchema.js`
- Modify: `src/app/api/travel-assistant/route.ts`
- Modify: `tests/travel-assistant-provider.test.mjs`
- Modify: `tests/travel-assistant-schema.test.mjs`
- Modify: `tests/travel-assistant-route.test.mjs`

- [ ] **Step 1: Write failing stream parsing and chat guard tests**

Tests must cover split SSE lines, `[DONE]`, a refusal, malformed chunks, timeout, a 3,000-character answer cap, `sourceDayIds`, and rejection of answers containing money/private terms or exact times/dates not allowed in advice.

Use a mocked upstream body such as:

```text
data: {"choices":[{"delta":{"content":"下雨时"}}]}

data: {"choices":[{"delta":{"content":"先缩短户外段。"}}]}

data: [DONE]
```

- [ ] **Step 2: Extend request parsing for current-day chat**

For `mode: "chat"`, require a non-empty question, keep at most 16 alternating history messages (8 turns), and reject `mode: "brief"` bodies that contain question/history. Keep the 16 KiB body limit.

- [ ] **Step 3: Implement buffered provider streaming**

Add `requestTravelChat({ context, question, history, fetcher, env, timeoutMs = 30_000 })` that sends `stream: true`, consumes upstream SSE server-side, assembles the complete answer, and does not expose tokens before `validateChatAnswer` passes. The system prompt must say:

```text
Answer from the supplied itinerary context only. Give advice, never claim to change itinerary, bookings, tickets, checklist, ledger, or receipts. Do not invent exact times, dates, prices, people, bookings, or places. If the context does not contain an answer, say so. Hard facts shown by the website are authoritative.
```

- [ ] **Step 4: Return controlled SSE after validation**

Add a helper that creates events from a validated answer:

```js
export function createChatSseResponse({ answer, sourceDayIds }) {
  const events = [
    ...chunkText(answer, 48).map((delta) => `event: delta\ndata: ${JSON.stringify({ delta })}\n\n`),
    `event: scope\ndata: ${JSON.stringify({ sourceDayIds })}\n\n`,
    "event: done\ndata: {}\n\n",
  ];
  // ReadableStream.pull enqueues one encoded event per pull.
}
```

Set `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: private, no-store`, `X-Accel-Buffering: no`, and `Connection: keep-alive`. The route dispatches `chat` only after auth, origin, limit, and request parsing.

- [ ] **Step 5: Run server chat tests**

```bash
node --conditions=react-server --test tests/travel-assistant-provider.test.mjs tests/travel-assistant-schema.test.mjs tests/travel-assistant-route.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit V1.1 server support**

```bash
git add src/lib/server/travelAssistantProvider.js src/lib/server/travelAssistantSchema.js src/app/api/travel-assistant/route.ts tests/travel-assistant-provider.test.mjs tests/travel-assistant-schema.test.mjs tests/travel-assistant-route.test.mjs
git commit -m "feat: add current-day travel chat stream"
```

### Task 10: Add local conversation and the folded chat UI

**Files:**
- Modify: `src/lib/travelAssistantCache.js`
- Modify: `src/lib/apiClient.js`
- Modify: `src/components/itinerary/TravelAssistantPanel.jsx`
- Modify: `src/styles/route-atlas.css`
- Modify: `tests/travel-assistant-cache.test.mjs`
- Modify: `tests/travel-assistant-ui.test.mjs`
- Modify: `e2e/fixtures/mock-api.js`
- Modify: `e2e/travel-assistant.spec.js`

- [ ] **Step 1: Write failing conversation cache and stream-client tests**

Add tests for day-separated local history, 8-turn trimming, malformed cache recovery, clear-chat-only behavior, SSE delta assembly, scope event handling, 401 access notification, and generic stream errors.

- [ ] **Step 2: Implement local conversation storage**

Add these exports to `travelAssistantCache.js`:

```js
export function readTravelChatCache(storage, dayId) { /* version 1, max 16 messages */ }
export function writeTravelChatCache(storage, dayId, messages) { /* localStorage only */ }
export function clearTravelChatCache(storage, dayId) { /* does not delete brief */ }
```

- [ ] **Step 3: Implement the streamed same-origin browser client**

Add `streamTravelChat(payload, { onDelta, onScope, signal })` to `apiClient.js`. It must POST relative `/api/travel-assistant`, use same-origin credentials, parse `delta`, `scope`, and `done` SSE events, reuse the existing 401 access-required behavior, and never log response bodies.

- [ ] **Step 4: Add folded conversation UI**

After a brief exists, render:

- a “继续追问” disclosure button with message count;
- four quick questions;
- the current device’s message history;
- a compact textarea and Send button;
- a Clear conversation action;
- pending, stream, and error states with `aria-live`.

Default collapsed state must be `false` for `chatOpen`. On mobile, `.travel-assistant-chat-body` uses the reserved `max-height: 52vh; overflow-y: auto`; quick prompts scroll horizontally; the input remains below the scroll body.

- [ ] **Step 5: Extend mock and Playwright coverage**

Mock a deterministic SSE body for `mode: "chat"`. Verify no chat request before user action, current-day source scope, reload restores local history, clear removes only chat, assistant failure keeps the brief, and 390px/desktop have no overflow.

- [ ] **Step 6: Run complete V1.1 checks**

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 7: Commit the V1.1 client and browser coverage**

```bash
git add src/lib/travelAssistantCache.js src/lib/apiClient.js src/components/itinerary/TravelAssistantPanel.jsx src/styles/route-atlas.css tests/travel-assistant-cache.test.mjs tests/travel-assistant-ui.test.mjs e2e/fixtures/mock-api.js e2e/travel-assistant.spec.js
git commit -m "feat: add local current-day travel chat"
```

### Task 11: Preview and release V1.1

**Files:**
- Modify: `docs/operations/aussie-production-baseline.md`

- [ ] **Step 1: Deploy Preview and run real current-day questions**

```bash
vercel
```

Verify all four quick prompts, one typed prompt, refresh persistence, clear chat, provider failure, and no AI call on initial load. Confirm request payload contains current day/weather/checklist/question/history only.

- [ ] **Step 2: Re-run real ledger, offline, and receipt checks on Preview**

Use the existing browser flows to read the current ledger, add and remove a temporary expense, verify offline reopening, and view an existing receipt path if available. Confirm no assistant request writes to `/api/sync`, `/api/receipts/*`, or Supabase.

- [ ] **Step 3: Deploy V1.1 Production and record evidence**

```bash
vercel --prod
```

Append deployment ID and V1.1 verification results to the production baseline, then:

```bash
git add docs/operations/aussie-production-baseline.md
git commit -m "docs: record V1.1 travel chat release"
```

---

## V1.2 — deterministic cross-day and whole-trip queries

### Task 12: Route questions to matching itinerary facts

**Files:**
- Modify: `src/lib/server/travelAssistantContext.js`
- Modify: `tests/travel-assistant-context.test.mjs`

- [ ] **Step 1: Write failing routing tests**

Add exact cases:

```js
assert.deepEqual(routeTravelQuestion({ currentDayId: "d14", question: "今天下雨怎么调整？" }).sourceDayIds, ["d14"]);
assert.deepEqual(routeTravelQuestion({ currentDayId: "d14", question: "D13 如果下雨呢？" }).sourceDayIds, ["d14", "d13"]);
assert.deepEqual(routeTravelQuestion({ currentDayId: "d14", question: "8月12日要准备什么？" }).sourceDayIds, ["d14", "d15"]);
assert.deepEqual(routeTravelQuestion({ currentDayId: "d14", question: "凯恩斯哪天最适合休息？" }).matchedDayIds, ["d6", "d7", "d8", "d9", "d10"]);
assert.equal(routeTravelQuestion({ currentDayId: "d14", question: "全程哪天最累？" }).scope, "trip");
assert.equal(routeTravelQuestion({ currentDayId: "d14", question: "火星基地怎么走？" }).unmatched, true);
```

Also test Taronga, Bondi, QVM, Palm Cove, Fitzroy, and duplicate matches; include at most three full matched days beyond current day.

- [ ] **Step 2: Implement deterministic routing**

Add:

```js
export function routeTravelQuestion({ currentDayId, question }) {
  // Match D0-D16, ISO/Chinese dates, normalized city names, titles, block places,
  // activities, and resource titles. Detect whole-trip terms. Return scope,
  // sourceDayIds, matchedDayIds, unmatched, currentDay, matchedDays, and tripIndex.
}
```

The matcher must not call the model. For ordinary questions return only the current day. For cross-day questions include the current day plus at most three matched full days. For trip questions include current full day plus `buildTripIndex()`, not all 17 full day objects.

- [ ] **Step 3: Run routing tests**

```bash
node --conditions=react-server --test tests/travel-assistant-context.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit deterministic query routing**

```bash
git add src/lib/server/travelAssistantContext.js tests/travel-assistant-context.test.mjs
git commit -m "feat: route travel questions across itinerary"
```

### Task 13: Integrate full-trip scope and show source days

**Files:**
- Modify: `src/app/api/travel-assistant/route.ts`
- Modify: `src/lib/server/travelAssistantProvider.js`
- Modify: `src/components/itinerary/TravelAssistantPanel.jsx`
- Modify: `tests/travel-assistant-route.test.mjs`
- Modify: `tests/travel-assistant-ui.test.mjs`
- Modify: `e2e/fixtures/mock-api.js`
- Modify: `e2e/travel-assistant.spec.js`

- [ ] **Step 1: Write failing route and UI scope tests**

Verify a normal question sends only D14 facts, `D13` sends D14+D13, `8月12日` sends D14+D15, `凯恩斯` adds matching Cairns days with the three-full-day cap, and “全程” sends one current full context plus a 17-row compact index. Inspect the serialized provider request and assert no full unrelated day blocks are present.

- [ ] **Step 2: Route chat context before provider invocation**

In the `chat` branch:

```js
const routed = routeTravelQuestion({ currentDayId: input.dayId, question: input.question });
const context = buildChatContext({ routed, weather: input.weather, checkedKitItemIds: input.checkedKitItemIds });
const rawAnswer = await requestTravelChat({ context, question: input.question, history: input.history });
const answer = validateChatAnswer(rawAnswer, context);
return createChatSseResponse({ answer, sourceDayIds: context.sourceDayIds });
```

If `unmatched` is true, the provider prompt must explicitly say the requested place/date was not found and must not invent an answer.

- [ ] **Step 3: Display the verified scope**

Store and render returned scope as compact chips such as `参考 D14 / D13` or `参考 D14 + 全程索引`. Scope chips are server-derived; do not infer them from the model prose.

- [ ] **Step 4: Extend E2E mocks and assertions**

Capture assistant request bodies and return scope events for current, cross-day, and trip questions. Verify local history remains per current Today Console day even when an answer references other days.

- [ ] **Step 5: Run full V1.2 checks**

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 6: Commit V1.2 integration**

```bash
git add src/app/api/travel-assistant/route.ts src/lib/server/travelAssistantProvider.js src/components/itinerary/TravelAssistantPanel.jsx tests/travel-assistant-route.test.mjs tests/travel-assistant-ui.test.mjs e2e/fixtures/mock-api.js e2e/travel-assistant.spec.js
git commit -m "feat: support whole-trip travel questions"
```

### Task 14: Final completion audit, Preview, Production, and Git publication

**Files:**
- Modify: `docs/operations/aussie-production-baseline.md`

- [ ] **Step 1: Run the complete automated regression**

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: all commands exit 0; record counts.

- [ ] **Step 2: Run explicit source and bundle privacy scans**

```bash
rg -n "TRAVEL_AI_API_KEY|TRAVEL_AI_BASE_URL|TRAVEL_AI_MODEL" src tests e2e
rg -n "ledgerExpenses|payer|amount|receipt|operation|supabase" src/components/itinerary/TravelAssistantPanel.jsx src/lib/travelAssistantCache.js
test -z "$(rg -l --fixed-strings "$TRAVEL_AI_API_KEY" src .next/static .next/server 2>/dev/null || true)"
```

Expected: only environment variable names appear in server provider code; no secret value appears anywhere; the assistant client/component/cache have no private-data identifiers.

- [ ] **Step 3: Deploy and verify the V1.2 Preview**

```bash
vercel
```

Use the real browser to verify: one brief call, cache after refresh, stale weather/checklist indicator, normal current-day chat, D13/date/city/place routing, whole-trip query, clear/re-generate, provider failure, desktop, 390px mobile, and no horizontal overflow.

- [ ] **Step 4: Re-verify non-AI production-critical behavior on Preview**

Verify live ledger read/sync, add/edit/delete/Undo cleanup, offline reopen and replay, receipt read/upload path, itinerary expand behavior, weather, ticket docket, and checklist. Compare ledger totals before and after; remove all test rows and objects.

- [ ] **Step 5: Deploy V1.2 Production and run smoke checks**

```bash
vercel --prod
npm run test:e2e:production
```

Run one real brief and one cross-day chat manually after unlock. Confirm no automatic AI request on a clean page load and no Supabase/private data in the assistant payload.

- [ ] **Step 6: Record final deployment evidence**

Append production deployment ID, Git commit, test counts, browser viewport results, real-provider JSON/SSE result, cache evidence, privacy scans, and ledger/offline/receipt regression evidence to `docs/operations/aussie-production-baseline.md`.

```bash
git add docs/operations/aussie-production-baseline.md
git commit -m "docs: record V1.2 travel assistant release"
```

- [ ] **Step 7: Push the verified branch and protected main history**

First fetch and confirm no unexpected remote drift:

```bash
git fetch origin
git log --oneline --decorate --graph --max-count=12 HEAD origin/main
```

If the protected base is still an ancestor, push the verified commit history according to the repository’s existing protected-main workflow. Do not force-push. Then verify:

```bash
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

Expected: clean worktree and the intended verified production commit reachable from `origin/main`.

---

## Plan self-review

- Spec coverage: V1 covers on-demand structured brief, safety, cache, update state, UI, and Preview/Production; V1.1 adds current-day chat and local history; V1.2 adds deterministic cross-day and whole-trip routing. Final audit covers secrets, one-call caching, privacy, hallucination guards, failure isolation, responsive UI, ledger sync, offline, and receipts.
- Data boundary: no task imports ledger, receipts, activity history, or Supabase into the assistant context; server reconstructs itinerary facts from `dayId`.
- Type consistency: `mode`, `dayId`, `weather`, `checkedKitItemIds`, `question`, `history`, `sourceDayIds`, `brief`, and cache entry names are consistent across route, client, component, and tests.
- Placeholder scan: implementation steps name exact functions, files, commands, expected results, output shapes, and release gates; there are no deferred implementation markers.
