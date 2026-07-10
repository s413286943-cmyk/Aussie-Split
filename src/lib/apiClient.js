export const ACCESS_REQUIRED_EVENT = "aussie-chill-access-required";

export class AccessRequiredError extends Error {
  constructor() {
    super("Access is required");
    this.name = "AccessRequiredError";
    this.code = "access_required";
    this.status = 401;
  }
}

export class ApiClientError extends Error {
  constructor(status = 0) {
    super("The protected API request failed");
    this.name = "ApiClientError";
    this.code = "api_request_failed";
    this.status = status;
  }
}

export function checkAccessSession() {
  return requestJson("/api/access");
}

export function unlockAccessSession(code) {
  return requestJson("/api/access", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function clearAccessSession() {
  return requestJson("/api/access", { method: "DELETE" });
}

export function fetchLedgerSnapshot() {
  return requestJson("/api/sync");
}

export function applyLedgerOperations(operations) {
  return requestJson("/api/sync", {
    method: "POST",
    body: JSON.stringify({ operations }),
  });
}

export function fetchActivity(limit = 50) {
  const parsed = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
  return requestJson(`/api/activity?limit=${safeLimit}`);
}

export function createExpenseOperation(type, expense, activity, options = {}) {
  if (type !== "upsert" && type !== "delete") throw new TypeError("Invalid expense operation type");
  if (!expense?.id || !expense?.mutationVersion || !activity) {
    throw new TypeError("Incomplete expense operation");
  }

  return {
    opId: options.opId || `op-${randomUUID()}`,
    type,
    expenseId: expense.id,
    mutationVersion: expense.mutationVersion,
    expense: type === "delete" ? null : writableExpense(expense),
    activity,
  };
}

async function requestJson(path, options = {}) {
  const hasBody = options.body !== undefined;
  let response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new ApiClientError();
  }

  if (response.status === 401) {
    notifyAccessRequired();
    throw new AccessRequiredError();
  }
  if (!response.ok) throw new ApiClientError(response.status);

  try {
    return await response.json();
  } catch {
    throw new ApiClientError(response.status);
  }
}

function writableExpense(expense) {
  return {
    id: expense.id,
    category: expense.category,
    item: expense.item,
    date: expense.date || null,
    currency: expense.currency,
    amount: Number(expense.amount),
    payer: expense.payer,
    status: expense.status,
    note: expense.note || "",
    splitSettled: Boolean(expense.splitSettled),
  };
}

function notifyAccessRequired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ACCESS_REQUIRED_EVENT));
  }
}

function randomUUID() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Web Crypto randomUUID is unavailable");
  return globalThis.crypto.randomUUID();
}
