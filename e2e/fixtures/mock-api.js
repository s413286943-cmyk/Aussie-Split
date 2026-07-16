import { defaultSnapshot } from "./data.js";
import itinerary from "../../src/data/itinerary.generated.json" with { type: "json" };

export class MockApi {
  constructor(options = {}) {
    const snapshot = options.snapshot || defaultSnapshot();
    this.authenticated = options.authenticated ?? true;
    this.accessCode = options.accessCode || "shared-code";
    this.expectedOrigin = options.expectedOrigin || "";
    this.expenses = structuredClone(snapshot.expenses);
    this.activity = structuredClone(snapshot.activity);
    this.requests = [];
    this.assistantRequestBodies = [];
    this.assistantFailureStatus = 0;
    this.securityViolations = [];
    this.uploadedReceipts = new Map();
    this.finalizedReceipts = new Map();
  }

  async install(page) {
    const router = page.context();
    router.on("request", (request) => this.#auditRequest(request));
    await router.route("https://api.open-meteo.com/**", async (route) => {
      await route.fulfill({ status: 503, body: "forecast unavailable in e2e" });
    });
    await router.route("**/e2e/receipt-upload**", (route) => this.#uploadReceipt(route));
    await router.route("**/e2e/receipt-view**", (route) => route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "mock receipt",
    }));
    await router.route("**/api/**", (route) => this.#handleApi(route));
  }

  snapshot() {
    return {
      expenses: structuredClone(this.expenses),
      activity: structuredClone(this.activity),
      serverTime: snapshotServerTime(this.expenses, this.activity),
    };
  }

  get assistantCallCount() {
    return this.assistantRequestBodies.length;
  }

  getAssistantRequests() {
    return structuredClone(this.assistantRequestBodies);
  }

  resetAssistant() {
    this.assistantRequestBodies = [];
    this.assistantFailureStatus = 0;
  }

  forceAssistantFailure(status = 502) {
    this.assistantFailureStatus = status;
  }

  async #handleApi(route) {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== this.expectedOrigin) {
      this.securityViolations.push(`${request.method()} ${url.href}`);
      return route.abort("blockedbyclient");
    }
    this.requests.push({ method: request.method(), url: url.href, pathname: url.pathname });

    if (url.pathname === "/api/access") return this.#handleAccess(route);
    if (!this.authenticated) return json(route, { error: "access_required" }, 401);
    if (url.pathname === "/api/travel-assistant") return this.#handleTravelAssistant(route);
    if (url.pathname === "/api/itinerary") return json(route, { itinerary: structuredClone(itinerary) });
    if (url.pathname === "/api/sync") return this.#handleSync(route);
    if (url.pathname === "/api/activity") return json(route, { activity: structuredClone(this.activity) });
    if (url.pathname === "/api/receipts/upload-url") return this.#createUpload(route);
    if (url.pathname === "/api/receipts/finalize") return this.#finalizeReceipt(route);
    if (url.pathname.startsWith("/api/receipts/")) return this.#viewReceipt(route, url.pathname);
    return json(route, { error: "not_found" }, 404);
  }

  async #handleTravelAssistant(route) {
    if (route.request().method() !== "POST") {
      return json(route, { error: "method_not_allowed" }, 405);
    }

    const body = readJsonBody(route.request());
    this.assistantRequestBodies.push(structuredClone(body));
    if (this.assistantFailureStatus) {
      return json(route, { error: "assistant_unavailable" }, this.assistantFailureStatus);
    }
    if (body.mode === "chat") {
      const response = assistantChatResponse(body);
      return response
        ? sse(route, response)
        : json(route, { error: "invalid_request" }, 400);
    }
    if (body.mode !== "brief") return json(route, { error: "invalid_request" }, 400);

    const response = assistantBriefResponse(body.dayId);
    return response
      ? json(route, response)
      : json(route, { error: "invalid_request" }, 400);
  }

  async #handleAccess(route) {
    const method = route.request().method();
    if (method === "GET") return json(route, { authenticated: this.authenticated });
    if (method === "POST") {
      const body = readJsonBody(route.request());
      this.authenticated = body.code === this.accessCode;
      return this.authenticated
        ? json(route, { authenticated: true })
        : json(route, { error: "access_denied" }, 401);
    }
    if (method === "DELETE") {
      this.authenticated = false;
      return json(route, { authenticated: false });
    }
    return json(route, { error: "method_not_allowed" }, 405);
  }

  async #handleSync(route) {
    if (route.request().method() === "GET") return json(route, this.snapshot());
    if (route.request().method() !== "POST") return json(route, { error: "method_not_allowed" }, 405);

    const payload = readJsonBody(route.request());
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    const results = [];
    for (const operation of operations) {
      this.#applyOperation(operation);
      results.push({ opId: operation.opId, status: "applied" });
    }
    return json(route, { results, ...this.snapshot() });
  }

  #applyOperation(operation) {
    const existing = this.expenses.find((expense) => expense.id === operation.expenseId);
    if (operation.type === "delete") {
      const tombstone = {
        ...(existing || { id: operation.expenseId }),
        mutationVersion: operation.mutationVersion,
        updatedAt: operation.activity.createdAt,
        deletedAt: operation.activity.createdAt,
      };
      this.expenses = [tombstone, ...this.expenses.filter((expense) => expense.id !== operation.expenseId)];
    } else {
      const expense = {
        ...(existing || {}),
        ...operation.expense,
        mutationVersion: operation.mutationVersion,
        updatedAt: operation.activity.createdAt,
        deletedAt: null,
        attachmentName: existing?.attachmentName || "",
        attachmentPath: existing?.attachmentPath || "",
        receiptId: existing?.receiptId || "",
        attachmentStatus: existing?.attachmentStatus || "none",
      };
      this.expenses = [expense, ...this.expenses.filter((item) => item.id !== operation.expenseId)];
    }
    if (!this.activity.some((entry) => entry.id === operation.activity.id)) {
      this.activity = [structuredClone(operation.activity), ...this.activity];
    }
  }

  async #createUpload(route) {
    const metadata = await route.request().postDataJSON();
    const origin = new URL(route.request().url()).origin;
    return json(route, {
      mode: "signed-put",
      signedUrl: `${origin}/e2e/receipt-upload?expenseId=${encodeURIComponent(metadata.expenseId)}&receiptId=${encodeURIComponent(metadata.receiptId)}`,
      storagePath: `${metadata.expenseId}/${metadata.receiptId}-receipt.png`,
    });
  }

  async #uploadReceipt(route) {
    const url = new URL(route.request().url());
    const receiptId = url.searchParams.get("receiptId");
    const expenseId = url.searchParams.get("expenseId");
    this.requests.push({ method: route.request().method(), url: url.href, pathname: url.pathname });
    this.uploadedReceipts.set(receiptId, { expenseId, receiptId });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  }

  async #finalizeReceipt(route) {
    const metadata = await route.request().postDataJSON();
    const existing = this.finalizedReceipts.get(metadata.expenseId);
    if (existing) return json(route, { receipt: existing });
    if (!this.uploadedReceipts.has(metadata.receiptId)) {
      return json(route, { error: "receipt_object_missing" }, 409);
    }
    const receipt = {
      id: `attachment-${metadata.receiptId}`,
      expenseId: metadata.expenseId,
      receiptId: metadata.receiptId,
      originalName: "receipt.png",
      mimeType: "image/png",
      sizeBytes: 68,
      storagePath: `${metadata.expenseId}/${metadata.receiptId}-receipt.png`,
      finalizedAt: "2026-07-12T00:00:00.000Z",
      createdAt: "2026-07-12T00:00:00.000Z",
    };
    this.finalizedReceipts.set(metadata.expenseId, receipt);
    const expense = this.expenses.find((item) => item.id === metadata.expenseId);
    if (expense) {
      Object.assign(expense, {
        attachmentName: receipt.originalName,
        attachmentPath: receipt.storagePath,
        receiptId: receipt.receiptId,
        attachmentStatus: "uploaded",
      });
    }
    return json(route, { receipt });
  }

  #viewReceipt(route, pathname) {
    const expenseId = decodeURIComponent(pathname.slice("/api/receipts/".length));
    const expense = this.expenses.find((item) => item.id === expenseId);
    if (!expense?.attachmentPath && !this.finalizedReceipts.has(expenseId)) {
      return json(route, { error: "receipt_not_found" }, 404);
    }
    const origin = new URL(route.request().url()).origin;
    return json(route, {
      signedUrl: `${origin}/e2e/receipt-view?expenseId=${encodeURIComponent(expenseId)}`,
      receipt: this.finalizedReceipts.get(expenseId) || null,
    });
  }

  #auditRequest(request) {
    const url = new URL(request.url());
    const directSupabase = /(?:^|\.)supabase\.co$/i.test(url.hostname)
      || url.pathname.startsWith("/rest/v1")
      || url.pathname.startsWith("/storage/v1");
    const crossOriginApi = url.pathname.startsWith("/api/") && url.origin !== this.expectedOrigin;
    if (directSupabase || crossOriginApi) {
      this.securityViolations.push(`${request.method()} ${url.href}`);
    }
  }
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function sse(route, body) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream; charset=utf-8",
    headers: {
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
    },
    body,
  });
}

function readJsonBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function assistantBriefResponse(dayId) {
  const day = itinerary.days.find((item) => item.id === dayId);
  if (!day) return null;

  const facts = day.blocks.filter((block) => block.period !== "饮食");
  const priorities = facts.slice(0, 3).map((block) => ({
    factId: `block:${dayId}:${block.sortOrder}`,
    title: block.place,
    reason: "优先完成今日主线，并为后续调整留出空间。",
  }));
  if (priorities.length !== 3) return null;

  const firstCutBlock = facts[4] || facts.at(-1);
  const sourceDayIds = [dayId];
  return {
    brief: {
      pace: { level: "balanced", note: "先守住固定安排，再按天气和体力调整弹性部分。" },
      priorities,
      tradeoffs: ["风大或体力下降时，先缩短户外步行段。"],
      firstCut: {
        factId: `block:${dayId}:${firstCutBlock.sortOrder}`,
        title: firstCutBlock.place,
        reason: "体力下降时先缩短这一段。",
      },
      tomorrowPrep: [
        { id: "power", label: "手机电量 / 充电宝", detail: "出门前确认手机与充电宝电量。" },
        { id: "booking-screenshots", label: "预订截图", detail: "提前保存关键资料，方便离线查看。" },
      ],
      suggestedQuestions: ["下雨时怎样缩短户外步行？"],
      sourceDayIds,
    },
    sourceDayIds,
    generatedAt: "2026-08-11T02:00:00.000Z",
  };
}

function assistantChatResponse(body) {
  const day = itinerary.days.find((item) => item.id === body.dayId);
  if (
    !day
    || typeof body.question !== "string"
    || !body.question.trim()
    || !Array.isArray(body.history)
    || body.history.length % 2 !== 0
  ) {
    return "";
  }

  const scope = assistantChatScope(body.dayId, body.question);

  return [
    `event: scope\ndata: ${JSON.stringify(scope)}\n\n`,
    `event: delta\ndata: ${JSON.stringify({ delta: "下雨时先缩短 Bondi 海岸步道，" })}\n\n`,
    `event: delta\ndata: ${JSON.stringify({ delta: "保留 Taronga Zoo 主线。" })}\n\n`,
    "event: done\ndata: {}\n\n",
  ].join("");
}

function assistantChatScope(currentDayId, question) {
  if (/全程|整趟|整个行程/u.test(question)) {
    return { scope: "trip", sourceDayIds: [currentDayId] };
  }
  if (/cairns|凯恩斯/iu.test(question)) {
    return { scope: "city", sourceDayIds: [currentDayId, "d10", "d7", "d6"] };
  }
  if (/8\s*月\s*12\s*日/u.test(question)) {
    return { scope: "day", sourceDayIds: [currentDayId, "d15"] };
  }
  if (/(?:^|\W)d\s*13(?:\W|$)/iu.test(question)) {
    return { scope: "day", sourceDayIds: [currentDayId, "d13"] };
  }
  return { scope: "day", sourceDayIds: [currentDayId] };
}

function snapshotServerTime(expenses, activity) {
  const latestRecordTime = [...expenses, ...activity].reduce((latest, record) => {
    const parsed = Date.parse(record.updatedAt || record.createdAt || "");
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
  return new Date(Math.max(Date.now(), latestRecordTime) + 1_000).toISOString();
}
