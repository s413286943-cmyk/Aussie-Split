export const ACCESS_REQUIRED_EVENT = "aussie-chill-access-required";
const TRAVEL_CHAT_BODY_BYTE_CEILING = 15 * 1_024;

export class AccessRequiredError extends Error {
  constructor() {
    super("Access is required");
    this.name = "AccessRequiredError";
    this.code = "access_required";
    this.status = 401;
  }
}

export class ApiClientError extends Error {
  constructor(status = 0, serverCode = "") {
    super("The protected API request failed");
    this.name = "ApiClientError";
    this.code = "api_request_failed";
    this.status = status;
    this.serverCode = serverCode;
  }
}

export function shouldReopenCachedAccess(error, hasOfflineAccess) {
  return Boolean(hasOfflineAccess) && !(error instanceof AccessRequiredError);
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

export function fetchItinerary() {
  return requestJson("/api/itinerary");
}

export function generateTravelBrief(payload) {
  const dayId = typeof payload.dayId === "string" && /^d(?:[0-9]|1[0-6])$/.test(payload.dayId)
    ? payload.dayId : "";
  const weather = Object.fromEntries([
    "status",
    "summary",
    "detail",
    "adviceLabel",
  ].map((key) => [
    key,
    typeof payload.weather?.[key] === "string" ? payload.weather[key].trim().slice(0, 160) : "",
  ]));
  const checkedKitItemIds = [...new Set(
    (Array.isArray(payload.checkedKitItemIds) ? payload.checkedKitItemIds : [])
      .filter((value) => typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value)),
  )];

  return requestJson("/api/travel-assistant", {
    method: "POST",
    body: JSON.stringify({
      mode: "brief",
      dayId,
      weather,
      checkedKitItemIds,
    }),
  });
}

export async function streamTravelChat(payload, { onDelta, onScope, signal } = {}) {
  const dayId = typeof payload.dayId === "string" && /^d(?:[0-9]|1[0-6])$/.test(payload.dayId)
    ? payload.dayId : "";
  const weather = Object.fromEntries([
    "status",
    "summary",
    "detail",
    "adviceLabel",
  ].map((key) => [
    key,
    typeof payload.weather?.[key] === "string" ? payload.weather[key].trim().slice(0, 160) : "",
  ]));
  const checkedKitItemIds = [...new Set(
    (Array.isArray(payload.checkedKitItemIds) ? payload.checkedKitItemIds : [])
      .filter((value) => typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value)),
  )];
  const question = typeof payload.question === "string" ? payload.question.trim().slice(0, 400) : "";
  const history = projectChatHistory(payload.history);
  const body = buildTravelChatRequestBody({
    mode: "chat",
    dayId,
    weather,
    checkedKitItemIds,
    question,
    history,
  });

  let response;
  try {
    response = await fetch("/api/travel-assistant", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body,
      signal,
    });
  } catch {
    throw new ApiClientError();
  }

  if (response.status === 401) {
    notifyAccessRequired();
    throw new AccessRequiredError();
  }
  if (!response.ok || !response.body) throw new ApiClientError(response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let sourceDayIds = [];
  let completed = false;

  try {
    while (!completed) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseEvent(block);
        if (event?.type === "delta") {
          if (typeof event.data.delta !== "string") throw new TypeError("Invalid delta event");
          answer += event.data.delta;
          if (typeof onDelta === "function") onDelta(event.data.delta);
        } else if (event?.type === "scope") {
          if (
            !Array.isArray(event.data.sourceDayIds)
            || event.data.sourceDayIds.length !== 1
            || event.data.sourceDayIds[0] !== dayId
          ) {
            throw new TypeError("Invalid scope event");
          }
          sourceDayIds = [dayId];
          if (typeof onScope === "function") onScope(sourceDayIds);
        } else if (event?.type === "done") {
          completed = true;
          break;
        }
        boundary = buffer.indexOf("\n\n");
      }

      if (chunk.done && !completed) throw new TypeError("Incomplete event stream");
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The stream has already failed.
    }
    if (error instanceof AccessRequiredError) throw error;
    throw new ApiClientError(response.status);
  }

  if (!answer || sourceDayIds.length !== 1) throw new ApiClientError(response.status);
  return { answer, sourceDayIds };
}

export async function applyLedgerOperations(operations) {
  const response = await requestJson("/api/sync", {
    method: "POST",
    body: JSON.stringify({ operations }),
  });
  if (!Array.isArray(response.results)) throw new ApiClientError(response.status);
  return response;
}

export function fetchActivity(limit = 50) {
  const parsed = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
  return requestJson(`/api/activity?limit=${safeLimit}`);
}

export function createReceiptUploadContract(metadata) {
  return requestJson("/api/receipts/upload-url", {
    method: "POST",
    body: JSON.stringify(metadata),
  });
}

export function finalizeReceipt(metadata) {
  return requestJson("/api/receipts/finalize", {
    method: "POST",
    body: JSON.stringify(metadata),
  });
}

export function fetchReceipt(expenseId) {
  if (typeof expenseId !== "string" || !expenseId) throw new TypeError("Invalid expense id");
  return requestJson(`/api/receipts/${encodeURIComponent(expenseId)}`);
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
  if (!response.ok) {
    let serverCode = "";
    try {
      const payload = await response.json();
      if (typeof payload?.error === "string" && /^[a-z0-9_]{1,64}$/.test(payload.error)) {
        serverCode = payload.error;
      }
    } catch {
      serverCode = "";
    }
    throw new ApiClientError(response.status, serverCode);
  }

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

function projectChatHistory(value) {
  if (!Array.isArray(value) || value.length % 2 !== 0) return [];
  const messages = value.map((message, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    if (
      !message
      || typeof message !== "object"
      || Array.isArray(message)
      || message.role !== role
      || typeof message.content !== "string"
      || !message.content.trim()
    ) {
      return null;
    }
    return { role, content: message.content.trim().slice(0, 2_000) };
  });
  return messages.some((message) => !message) ? [] : messages.slice(-16);
}

function buildTravelChatRequestBody(request) {
  let body = JSON.stringify(request);
  while (
    new TextEncoder().encode(body).byteLength >= TRAVEL_CHAT_BODY_BYTE_CEILING
    && request.history.length >= 2
  ) {
    request = { ...request, history: request.history.slice(2) };
    body = JSON.stringify(request);
  }
  if (new TextEncoder().encode(body).byteLength >= TRAVEL_CHAT_BODY_BYTE_CEILING) {
    throw new ApiClientError();
  }
  return body;
}

function parseSseEvent(block) {
  if (!block.trim()) return null;
  let type = "message";
  const dataLines = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  return { type, data: JSON.parse(dataLines.join("\n")) };
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
