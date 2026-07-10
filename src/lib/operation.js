import { nextMutationVersion, parseMutationVersion } from "./mutationVersion.js";

export function createUpsertOperation({ opId, expense, activity, createdAt }) {
  assertIdentifier(opId, "operation id");
  assertWritableExpense(expense, false);
  assertActivity(activity, expense, ["add", "edit", "confirm"]);
  assertTimestamp(createdAt, "operation timestamp");

  return {
    opId,
    type: "upsert",
    expenseId: expense.id,
    mutationVersion: expense.mutationVersion,
    expense: writableExpense(expense),
    activity: { ...activity },
    createdAt,
  };
}

export function createDeleteOperation({ opId, expense, activity, createdAt }) {
  assertIdentifier(opId, "operation id");
  assertWritableExpense(expense, true);
  assertActivity(activity, expense, ["delete"]);
  assertTimestamp(createdAt, "operation timestamp");

  return {
    opId,
    type: "delete",
    expenseId: expense.id,
    mutationVersion: expense.mutationVersion,
    expense: null,
    activity: { ...activity },
    createdAt,
  };
}

export function createSynchronizedDeleteUndoOperation({
  deletedOperation,
  expense,
  activity,
  opId,
  clientId,
  now,
}) {
  if (!isRecord(deletedOperation) || deletedOperation.type !== "delete" || deletedOperation.expense !== null) {
    throw new TypeError("Invalid synchronized delete operation");
  }
  assertIdentifier(deletedOperation.expenseId, "deleted expense id");
  const deletedVersion = parseMutationVersion(deletedOperation.mutationVersion);
  assertTimestamp(deletedOperation.createdAt, "deletion operation timestamp");
  if (!isRecord(expense) || expense.id !== deletedOperation.expenseId) {
    throw new TypeError("Undo expense does not match delete operation");
  }

  const mutationVersion = nextMutationVersion({
    previous: deletedOperation.mutationVersion,
    now,
    clientId: clientId ?? deletedVersion.clientId,
  });
  const createdAt = new Date(now).toISOString();

  return createUpsertOperation({
    opId,
    expense: {
      ...expense,
      mutationVersion,
      updatedAt: createdAt,
      deletedAt: null,
    },
    activity: { ...activity, createdAt },
    createdAt,
  });
}

function writableExpense(expense) {
  return {
    id: expense.id,
    category: expense.category,
    item: expense.item,
    date: expense.date || null,
    currency: expense.currency,
    amount: expense.amount,
    payer: expense.payer,
    status: expense.status,
    note: expense.note,
    splitSettled: expense.splitSettled,
    mutationVersion: expense.mutationVersion,
    updatedAt: expense.updatedAt,
    deletedAt: expense.deletedAt,
  };
}

function assertWritableExpense(expense, deleted) {
  if (!isRecord(expense)) throw new TypeError("Invalid expense");
  assertIdentifier(expense.id, "expense id");
  parseMutationVersion(expense.mutationVersion);
  assertTimestamp(expense.updatedAt, "expense timestamp");
  if (deleted) assertTimestamp(expense.deletedAt, "deletion timestamp");
  else if (expense.deletedAt !== null) throw new TypeError("Invalid deletion timestamp");

  if (!nonEmptyString(expense.category) || !nonEmptyString(expense.item)) {
    throw new TypeError("Invalid expense text");
  }
  if (!validDate(expense.date)) throw new TypeError("Invalid expense date");
  if (!["CNY", "AUD"].includes(expense.currency)) throw new TypeError("Invalid expense currency");
  if (!finiteNumber(expense.amount)) throw new TypeError("Invalid expense amount");
  if (!["us", "them"].includes(expense.payer)) throw new TypeError("Invalid expense payer");
  if (!["confirmed", "draft"].includes(expense.status)) throw new TypeError("Invalid expense status");
  if (typeof expense.note !== "string") throw new TypeError("Invalid expense note");
  if (typeof expense.splitSettled !== "boolean") throw new TypeError("Invalid split state");
}

function assertActivity(activity, expense, actions) {
  if (!isRecord(activity)) throw new TypeError("Invalid activity");
  assertIdentifier(activity.id, "activity id");
  if (activity.expenseId !== expense.id) throw new TypeError("Invalid activity expense id");
  if (!actions.includes(activity.action)) throw new TypeError("Invalid activity action");
  if (activity.item !== expense.item || activity.amount !== expense.amount || activity.currency !== expense.currency) {
    throw new TypeError("Activity does not match expense");
  }
  if (typeof activity.summary !== "string") throw new TypeError("Invalid activity summary");
  assertTimestamp(activity.createdAt, "activity timestamp");
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function assertTimestamp(value, label) {
  parseIsoTimestamp(value, label);
}

export function parseIsoTimestamp(value, label = "timestamp") {
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
    : null;
  const millis = match && validTimestampFields(match) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(millis)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return millis;
}

function validTimestampFields(match) {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);

  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth(year, month)
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59;
}

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDate(value) {
  if (value === null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
