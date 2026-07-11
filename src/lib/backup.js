import { validateExpense } from "./expenseValidation.js";

const BACKUP_KIND = "aussie-chill-ledger-backup";
const BACKUP_SCHEMA_VERSION = 1;

export function createLedgerBackup({ expenses, activity = [], exportedAt = new Date().toISOString() }) {
  assertIsoTimestamp(exportedAt, "导出时间");
  const normalizedExpenses = (expenses || [])
    .filter((expense) => !expense.deletedAt)
    .map(normalizeBackupExpense)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    kind: BACKUP_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    activityCount: Array.isArray(activity) ? activity.length : 0,
    expenses: normalizedExpenses,
  };
}

export function parseLedgerBackup(input) {
  let backup;
  try {
    backup = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new TypeError("备份文件不是有效的 JSON");
  }
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new TypeError("备份文件格式不正确");
  }
  if (backup.kind !== BACKUP_KIND || backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new TypeError("不支持的备份版本");
  }
  if (!Array.isArray(backup.expenses)) throw new TypeError("备份文件缺少费用明细");
  assertIsoTimestamp(backup.exportedAt, "备份导出时间");
  return backup;
}

export function previewBackupMerge(input, currentExpenses = []) {
  const backup = parseLedgerBackup(input);
  const incoming = backup.expenses.map(normalizeBackupExpense);
  const incomingIds = new Set();
  for (const expense of incoming) {
    if (incomingIds.has(expense.id)) throw new TypeError("备份中存在重复的费用记录");
    incomingIds.add(expense.id);
  }
  const currentById = new Map((currentExpenses || []).map((expense) => [expense.id, expense]));
  const accepted = [];
  const skipped = [];

  for (const expense of incoming) {
    const current = currentById.get(expense.id);
    if (!current || timestamp(expense.updatedAt) > timestamp(current.updatedAt)) {
      accepted.push(expense);
      currentById.set(expense.id, expense);
    } else {
      skipped.push(expense);
    }
  }

  return {
    backup,
    accepted,
    skipped,
    merged: [...currentById.values()],
    acceptedTotalsByCurrency: moneyTotals(accepted),
  };
}

function normalizeBackupExpense(expense) {
  const validation = validateExpense(expense);
  if (!expense || typeof expense !== "object" || Array.isArray(expense)
    || typeof expense.id !== "string" || !expense.id
    || !validation.valid
    || !["CNY", "AUD"].includes(expense.currency)
    || !["us", "them"].includes(expense.payer)
    || !["confirmed", "draft"].includes(expense.status)
    || typeof expense.category !== "string" || !expense.category
    || typeof expense.note !== "string"
    || typeof expense.splitSettled !== "boolean"
    || !validDate(expense.date)) {
    throw new TypeError("备份中的费用无效");
  }
  assertIsoTimestamp(expense.updatedAt, "费用更新时间");

  return {
    id: expense.id,
    category: expense.category,
    item: expense.item.trim(),
    date: expense.date || "",
    currency: expense.currency,
    amount: Number(expense.amount),
    payer: expense.payer,
    status: expense.status,
    note: expense.note,
    splitSettled: expense.splitSettled,
    updatedAt: new Date(expense.updatedAt).toISOString(),
    deletedAt: null,
  };
}

function moneyTotals(expenses) {
  const totals = {};
  for (const expense of expenses) {
    totals[expense.currency] = Math.round(((totals[expense.currency] || 0) + expense.amount) * 100) / 100;
  }
  return Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right)));
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function assertIsoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label}无效`);
  }
}

function validDate(value) {
  if (value === "" || value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}
