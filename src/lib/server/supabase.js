import "server-only";

const MAX_OPERATION_BATCH = 100;
const MAX_ACTIVITY_LIMIT = 100;

export class SupabaseUpstreamError extends Error {
  constructor(status = 0) {
    super("The ledger data service is unavailable");
    this.name = "SupabaseUpstreamError";
    this.code = "supabase_upstream_error";
    this.status = status;
  }
}

export class SupabaseConfigurationError extends Error {
  constructor() {
    super("The ledger data service is not configured");
    this.name = "SupabaseConfigurationError";
    this.code = "server_configuration_error";
  }
}

export async function fetchLedgerSnapshot() {
  const [expenseRows, attachmentRows] = await Promise.all([
    serviceJson("/rest/v1/expenses?select=*&order=date.asc"),
    serviceJson(
      "/rest/v1/attachments?select=expense_id,original_name,storage_path,created_at"
      + "&deleted_at=is.null&order=created_at.desc",
    ),
  ]);
  if (!Array.isArray(expenseRows) || !Array.isArray(attachmentRows)) {
    throw new SupabaseUpstreamError();
  }

  const attachmentByExpense = new Map();
  for (const attachment of attachmentRows) {
    if (attachment?.expense_id && !attachmentByExpense.has(attachment.expense_id)) {
      attachmentByExpense.set(attachment.expense_id, attachment);
    }
  }

  return expenseRows.map((row) => mapExpense(row, attachmentByExpense.get(row.id)));
}

export async function applyExpenseOperations(operations) {
  if (!Array.isArray(operations) || operations.length > MAX_OPERATION_BATCH) {
    throw new TypeError("Expense operations must be an array of at most 100 entries");
  }

  const results = [];
  for (const operation of operations) {
    const result = await serviceJson("/rest/v1/rpc/apply_expense_operation", {
      method: "POST",
      body: JSON.stringify({ operation }),
    });
    if (
      !result
      || typeof result !== "object"
      || result.opId !== operation?.opId
      || !["applied", "stale"].includes(result.status)
    ) {
      throw new SupabaseUpstreamError();
    }
    results.push(result);
  }
  return results;
}

export async function fetchActivity(limit = 50) {
  const safeLimit = clampInteger(limit, 1, MAX_ACTIVITY_LIMIT);
  const rows = await serviceJson(
    `/rest/v1/expense_activity?select=*&order=created_at.desc&limit=${safeLimit}`,
  );
  if (!Array.isArray(rows)) throw new SupabaseUpstreamError();
  return rows.map(mapActivity);
}

async function serviceJson(path, options = {}) {
  const { url, serviceRole } = readSupabaseConfig();
  let response;
  try {
    response = await fetch(`${url}${path}`, {
      ...options,
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new SupabaseUpstreamError();
  }
  if (!response.ok) throw new SupabaseUpstreamError(response.status);

  try {
    return await response.json();
  } catch {
    throw new SupabaseUpstreamError(response.status);
  }
}

function readSupabaseConfig(env = process.env) {
  const url = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.replace(/\/$/, "") : "";
  const serviceRole = typeof env.SUPABASE_SERVICE_ROLE_KEY === "string"
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : "";
  if (!url || !serviceRole) throw new SupabaseConfigurationError();
  return { url, serviceRole };
}

function mapExpense(row, attachment) {
  return {
    id: row.id,
    category: row.category,
    item: row.item,
    date: row.date || "",
    currency: row.currency,
    amount: Number(row.amount),
    payer: row.payer,
    status: row.status,
    note: row.note || "",
    splitSettled: Boolean(row.split_settled),
    mutationVersion: row.mutation_version,
    updatedAt: row.updated_at || "",
    deletedAt: row.deleted_at || null,
    attachmentName: attachment?.original_name || row.attachment_name || "",
    attachmentPath: attachment?.storage_path || "",
  };
}

function mapActivity(row) {
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

function clampInteger(value, minimum, maximum) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(Math.max(parsed, minimum), maximum);
}
