import { defaultSnapshot } from "./data.js";
import itinerary from "../../src/data/itinerary.generated.json" with { type: "json" };
import nz2027Itinerary from "../../src/data/nz2027-itinerary.generated.json" with { type: "json" };
import nz2027Releases from "../../content/nz2027-updates.json" with { type: "json" };

export class MockApi {
  constructor(options = {}) {
    const snapshot = options.snapshot || defaultSnapshot();
    this.authenticated = options.authenticated ?? true;
    this.accessCode = options.accessCode || "shared-code";
    this.expectedOrigin = options.expectedOrigin || "";
    this.expenses = structuredClone(snapshot.expenses);
    this.activity = structuredClone(snapshot.activity);
    this.requests = [];
    this.securityViolations = [];
    this.uploadedReceipts = new Map();
    this.nz2027Expenses = structuredClone(options.nz2027Expenses || defaultNz2027Expenses());
    this.nz2027Available = options.nz2027Available ?? true;
    this.nz2027Checklist = structuredClone(options.nz2027Checklist || []);
    // Mirrors the database triggers that log every applied 2027 change.
    this.nz2027Activity = structuredClone(options.nz2027Activity || []);
    this.nz2027ActivityAvailable = options.nz2027ActivityAvailable ?? true;
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
    if (url.pathname === "/api/itinerary") return json(route, { itinerary: structuredClone(itinerary) });
    if (url.pathname === "/api/nz2027/itinerary") return json(route, { itinerary: structuredClone(nz2027Itinerary) });
    if (url.pathname === "/api/nz2027/expenses") return this.#handleNz2027(route);
    if (url.pathname === "/api/nz2027/checklist") return this.#handleNz2027Checklist(route);
    if (url.pathname === "/api/nz2027/updates") {
      return json(route, {
        releases: structuredClone(nz2027Releases),
        activity: this.nz2027ActivityAvailable ? structuredClone(this.nz2027Activity) : [],
        activityAvailable: this.nz2027ActivityAvailable,
      });
    }
    if (url.pathname === "/api/sync") return this.#handleSync(route);
    if (url.pathname === "/api/activity") return json(route, { activity: structuredClone(this.activity) });
    if (url.pathname === "/api/receipts/upload-url") return this.#createUpload(route);
    if (url.pathname === "/api/receipts/finalize") return this.#finalizeReceipt(route);
    if (url.pathname.startsWith("/api/receipts/")) return this.#viewReceipt(route, url.pathname);
    return json(route, { error: "not_found" }, 404);
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

  async #handleNz2027Checklist(route) {
    if (!this.nz2027Available) return json(route, { error: "service_unavailable" }, 502);
    if (route.request().method() === "POST") {
      const payload = readJsonBody(route.request());
      const results = [];
      for (const item of payload.items || []) {
        const existing = this.nz2027Checklist.find((entry) => entry.id === item.id);
        if (existing && existing.updatedAt >= item.updatedAt) {
          results.push({ id: item.id, status: "stale" });
          continue;
        }
        this.nz2027Checklist = [structuredClone(item), ...this.nz2027Checklist.filter((entry) => entry.id !== item.id)];
        if (Boolean(existing?.done) !== item.done && (existing || item.done)) {
          this.#logNz2027({ kind: "check", action: item.done ? "done" : "undone", refId: item.id, detail: {} });
        }
        results.push({ id: item.id, status: "applied" });
      }
      return json(route, { results, items: structuredClone(this.nz2027Checklist) });
    }
    return json(route, { items: structuredClone(this.nz2027Checklist) });
  }

  async #handleNz2027(route) {
    if (!this.nz2027Available) return json(route, { error: "service_unavailable" }, 502);
    const method = route.request().method();
    if (method === "POST") {
      const payload = readJsonBody(route.request());
      const results = [];
      for (const record of payload.records || []) {
        const existing = this.nz2027Expenses.find((item) => item.id === record.id);
        if (existing && existing.updatedAt >= record.updatedAt) {
          results.push({ id: record.id, status: "stale" });
          continue;
        }
        this.nz2027Expenses = [structuredClone(record), ...this.nz2027Expenses.filter((item) => item.id !== record.id)];
        this.#logNz2027Expense(existing, record);
        results.push({ id: record.id, status: "applied" });
      }
      return json(route, { results, expenses: structuredClone(this.nz2027Expenses), serverTime: new Date().toISOString() });
    }
    if (method !== "GET") return json(route, { error: "method_not_allowed" }, 405);
    return json(route, { expenses: structuredClone(this.nz2027Expenses), serverTime: new Date().toISOString() });
  }

  #logNz2027(entry) {
    this.nz2027Activity = [{ id: String(this.nz2027Activity.length + 1), at: new Date().toISOString(), ...entry }, ...this.nz2027Activity];
  }

  #logNz2027Expense(before, after) {
    const detail = (record) => ({ item: record.item, currency: record.currency, amount: record.amount, status: record.status, date: record.date || undefined });
    let action;
    if (!before) action = after.deletedAt ? "removed" : "added";
    else if (!before.deletedAt && after.deletedAt) action = "removed";
    else if (before.deletedAt && !after.deletedAt) action = "restored";
    else if (after.deletedAt) return;
    else if (["date", "category", "item", "currency", "amount", "status", "note"].every((key) => before[key] === after[key])) return;
    else action = "changed";
    this.#logNz2027({
      kind: "expense",
      action,
      refId: after.id,
      detail: action === "changed" ? { ...detail(after), before: detail(before) } : detail(after),
    });
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

function defaultNz2027Expenses() {
  const record = (id, date, category, item, currency, amount, status) => ({
    id, date, category, item, currency, amount, status, note: "", updatedAt: "2026-10-25T00:00:00.000Z", deletedAt: null,
  });
  return [
    record("nz27-hotel-sydney-great-southern", "2027-02-02", "lodging", "悉尼 Great Southern Hotel 2/2–4（2晚）", "CNY", 1361.31, "pending"),
    record("nz27-hotel-twizel", "2027-02-05", "lodging", "Twizel Holiday Park 2/5–8（3晚）", "NZD", 525, "paid"),
    record("nz27-tour-milford", "2027-02-11", "activity", "Milford Sound RealNZ 大巴＋游船（2人）", "NZD", 578, "paid"),
  ];
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function readJsonBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function snapshotServerTime(expenses, activity) {
  const latestRecordTime = [...expenses, ...activity].reduce((latest, record) => {
    const parsed = Date.parse(record.updatedAt || record.createdAt || "");
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
  return new Date(Math.max(Date.now(), latestRecordTime) + 1_000).toISOString();
}
