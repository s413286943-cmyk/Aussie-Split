import { defaultSnapshot } from "./data.js";

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
