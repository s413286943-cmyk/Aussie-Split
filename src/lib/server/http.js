export class RequestSecurityError extends Error {
  constructor() {
    super("Request origin is not allowed");
    this.name = "RequestSecurityError";
    this.code = "invalid_origin";
  }
}

export function assertSameOriginMutation(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin || fetchSite !== "same-origin") throw new RequestSecurityError();

  let normalizedOrigin;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    throw new RequestSecurityError();
  }
  if (normalizedOrigin !== requestOrigin) throw new RequestSecurityError();
}

export function privateJsonResponse(payload, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    headers,
  });
}

export function authenticationRequiredResponse() {
  return privateJsonResponse({ error: "access_required" }, { status: 401 });
}

export function accessDeniedResponse() {
  return privateJsonResponse({ error: "access_denied" }, { status: 401 });
}

export function invalidRequestResponse() {
  return privateJsonResponse({ error: "invalid_request" }, { status: 400 });
}

export function requestRejectedResponse() {
  return privateJsonResponse({ error: "request_rejected" }, { status: 403 });
}

export function upstreamUnavailableResponse() {
  return privateJsonResponse({ error: "service_unavailable" }, { status: 502 });
}

export function parseExpenseOperationBatch(body) {
  if (!isRecord(body) || !Array.isArray(body.operations) || body.operations.length > 100) {
    throw new TypeError("Invalid expense operation batch");
  }
  if (!body.operations.every(isExpenseOperation)) {
    throw new TypeError("Invalid expense operation batch");
  }
  return body.operations;
}

function isExpenseOperation(operation) {
  if (!isRecord(operation)) return false;
  if (!isIdentifier(operation.opId) || !isIdentifier(operation.expenseId)) return false;
  if (!/^[0-9]{13}-[0-9]{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(operation.mutationVersion || "")) {
    return false;
  }
  if (!isActivity(operation.activity, operation.expenseId, operation.type)) return false;

  if (operation.type === "delete") {
    return operation.expense === null
      || (isRecord(operation.expense) && operation.expense.id === operation.expenseId);
  }
  if (operation.type !== "upsert" || !isRecord(operation.expense)) return false;

  const expense = operation.expense;
  return expense.id === operation.expenseId
    && nonEmptyString(expense.category)
    && nonEmptyString(expense.item)
    && validDate(expense.date)
    && ["CNY", "AUD"].includes(expense.currency)
    && finiteNumber(expense.amount)
    && ["us", "them"].includes(expense.payer)
    && ["confirmed", "draft"].includes(expense.status)
    && typeof expense.note === "string"
    && typeof expense.splitSettled === "boolean"
    && operation.activity.item === expense.item
    && operation.activity.amount === expense.amount
    && operation.activity.currency === expense.currency;
}

function isActivity(activity, expenseId, operationType) {
  if (!isRecord(activity)) return false;
  const validActions = operationType === "delete" ? ["delete"] : ["add", "edit", "confirm"];
  return nonEmptyString(activity.id)
    && activity.expenseId === expenseId
    && validActions.includes(activity.action)
    && nonEmptyString(activity.item)
    && finiteNumber(activity.amount)
    && ["CNY", "AUD"].includes(activity.currency)
    && typeof activity.summary === "string"
    && typeof activity.createdAt === "string"
    && Number.isFinite(Date.parse(activity.createdAt));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIdentifier(value) {
  return typeof value === "string"
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validDate(value) {
  if (value === null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}
