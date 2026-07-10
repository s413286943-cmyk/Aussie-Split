import { parseMutationVersion } from "./mutationVersion.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const compatibilityColumns = ["mutation_version", "deleted_at"];

let expenseCompatibilityPromise = null;

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export class RemoteExpenseWriteError extends Error {
  constructor(message, code, status = 0) {
    super(message);
    this.name = "RemoteExpenseWriteError";
    this.code = code;
    this.status = status;
  }
}

export async function detectExpenseCompatibility() {
  if (!supabaseConfigured) return "local";
  if (!expenseCompatibilityPromise) {
    expenseCompatibilityPromise = probeExpenseCompatibility().catch((error) => {
      expenseCompatibilityPromise = null;
      throw error;
    });
  }
  return expenseCompatibilityPromise;
}

export async function fetchRemoteExpenses() {
  const mode = await detectExpenseCompatibility();
  if (mode === "local") return null;

  const query = mode === "compatible"
    ? "select=*&deleted_at=is.null&order=date.asc"
    : "select=*&order=date.asc";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/expenses?${query}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new SupabaseRestError("Unable to load Supabase expenses", "expense_read_failed", response.status);
  }
  const rows = await response.json();
  const visibleRows = mode === "compatible"
    ? rows.filter((row) => !row.deleted_at)
    : rows;
  return visibleRows.map((row) => fromRow(row, mode));
}

export async function fetchRemoteActivity() {
  if (!supabaseConfigured) return null;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/expense_activity?select=*&order=created_at.desc&limit=8`, {
    headers: authHeaders(),
  });

  if (!response.ok) throw new Error("Unable to load Supabase expense activity");
  const rows = await response.json();
  return rows.map(activityFromRow);
}

export async function upsertRemoteExpense(expense) {
  const mode = await detectExpenseCompatibility();
  if (mode === "local") return;

  const row = mode === "compatible" ? toCompatibleRow(expense) : toLegacyRow(expense);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/expenses`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!response.ok) throw await remoteWriteError(response, "save");
}

export async function insertRemoteActivity(entry) {
  if (!supabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/expense_activity`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(activityToRow(entry)),
  });

  if (!response.ok) throw new Error("Unable to save Supabase expense activity");
}

export async function deleteRemoteExpense(expense) {
  const mode = await detectExpenseCompatibility();
  if (mode === "local") return;

  const id = typeof expense === "string" ? expense : expense?.id;
  if (!id) throw new RemoteExpenseWriteError("Expense id is required", "invalid_expense_id");

  const url = `${SUPABASE_URL}/rest/v1/expenses?id=eq.${encodeURIComponent(id)}`;
  let response;
  if (mode === "compatible") {
    assertMutationVersion(expense?.mutationVersion);
    assertDeletedAt(expense?.deletedAt);
    response = await fetch(url, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        mutation_version: expense.mutationVersion,
        deleted_at: expense.deletedAt,
      }),
    });
  } else {
    response = await fetch(url, {
      method: "DELETE",
      headers: authHeaders(),
    });
  }

  if (!response.ok) throw await remoteWriteError(response, "delete");
}

export async function uploadRemoteReceipt(file) {
  if (!supabaseConfigured || !file) return "";

  const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${path}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) throw new Error("Unable to upload receipt");
  return path;
}

async function probeExpenseCompatibility() {
  let response;
  try {
    response = await fetch(
      `${SUPABASE_URL}/rest/v1/expenses?select=${compatibilityColumns.join(",")}&limit=1`,
      { headers: authHeaders() }
    );
  } catch {
    throw new SupabaseRestError(
      "Unable to detect Supabase expense schema",
      "expense_schema_probe_failed"
    );
  }
  if (response.ok) return "compatible";

  const payload = await readErrorPayload(response);
  if (isMissingCompatibilityColumn(response.status, payload)) return "legacy";
  throw new SupabaseRestError(
    "Unable to detect Supabase expense schema",
    "expense_schema_probe_failed",
    response.status
  );
}

function authHeaders() {
  const headers = { apikey: SUPABASE_KEY };
  if (!SUPABASE_KEY.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  }
  return headers;
}

function toLegacyRow(expense) {
  return {
    id: expense.id,
    category: expense.category,
    item: expense.item,
    date: expense.date || null,
    currency: expense.currency,
    amount: expense.amount,
    payer: expense.payer,
    status: expense.status,
    note: expense.note || "",
    attachment_name: expense.attachmentName || "",
    split_settled: Boolean(expense.splitSettled),
  };
}

function toCompatibleRow(expense) {
  assertMutationVersion(expense?.mutationVersion);
  return {
    ...toLegacyRow(expense),
    mutation_version: expense.mutationVersion,
    deleted_at: expense.deletedAt || null,
  };
}

function fromRow(row, mode) {
  const expense = {
    id: row.id,
    category: row.category,
    item: row.item,
    date: row.date || "",
    currency: row.currency,
    amount: Number(row.amount),
    payer: row.payer,
    status: row.status,
    note: row.note || "",
    attachmentName: row.attachment_name || "",
    splitSettled: Boolean(row.split_settled),
  };

  if (mode === "compatible") {
    expense.mutationVersion = row.mutation_version;
    expense.updatedAt = row.updated_at || "";
    expense.deletedAt = row.deleted_at || null;
  }
  return expense;
}

function activityToRow(entry) {
  return {
    id: entry.id,
    expense_id: entry.expenseId,
    action: entry.action,
    item: entry.item,
    amount: entry.amount,
    currency: entry.currency,
    summary: entry.summary,
    created_at: entry.createdAt,
  };
}

function activityFromRow(row) {
  return {
    id: row.id,
    expenseId: row.expense_id,
    action: row.action,
    item: row.item,
    amount: Number(row.amount),
    currency: row.currency,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function assertMutationVersion(value) {
  try {
    parseMutationVersion(value);
  } catch {
    throw new RemoteExpenseWriteError("Expense mutation version is invalid", "invalid_mutation_version");
  }
}

function assertDeletedAt(value) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    throw new RemoteExpenseWriteError("Expense deletion timestamp is invalid", "invalid_deleted_at");
  }
}

async function remoteWriteError(response, operation) {
  const payload = await readErrorPayload(response);
  const rawCode = typeof payload?.code === "string" ? payload.code : "";
  const rawMessage = typeof payload?.message === "string" ? payload.message : "";
  const signature = `${rawCode} ${rawMessage}`.toLowerCase();

  if (rawCode === "40001" || signature.includes("stale_mutation_version")) {
    return new RemoteExpenseWriteError("Expense update is older than the saved version", "stale_mutation_version", response.status);
  }
  if (signature.includes("mutation_version_in_future")) {
    return new RemoteExpenseWriteError("Expense mutation time is too far in the future", "mutation_version_in_future", response.status);
  }
  if (signature.includes("invalid_mutation_version")) {
    return new RemoteExpenseWriteError("Expense mutation version was rejected", "invalid_mutation_version", response.status);
  }
  if (signature.includes("physical_delete_disabled")) {
    return new RemoteExpenseWriteError("Physical expense deletion is disabled", "physical_delete_disabled", response.status);
  }
  return new RemoteExpenseWriteError(
    operation === "delete" ? "Unable to delete Supabase expense" : "Unable to save Supabase expense",
    "remote_write_failed",
    response.status
  );
}

async function readErrorPayload(response) {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function isMissingCompatibilityColumn(status, payload) {
  if (status !== 400) return false;
  const code = typeof payload?.code === "string" ? payload.code.toUpperCase() : "";
  const message = [payload?.message, payload?.details, payload?.hint]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const identifiesColumn = compatibilityColumns.some((column) => message.includes(column));
  const identifiesMissing = /does not exist|could not find|missing column|schema cache/.test(message);
  return identifiesColumn && (code === "42703" || code === "PGRST204" || identifiesMissing);
}

class SupabaseRestError extends Error {
  constructor(message, code, status = 0) {
    super(message);
    this.name = "SupabaseRestError";
    this.code = code;
    this.status = status;
  }
}
