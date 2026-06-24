const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export async function fetchRemoteExpenses() {
  if (!supabaseConfigured) return null;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/expenses?select=*&order=date.asc`, {
    headers: authHeaders(),
  });

  if (!response.ok) throw new Error("Unable to load Supabase expenses");
  const rows = await response.json();
  return rows.map(fromRow);
}

export async function upsertRemoteExpense(expense) {
  if (!supabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/expenses`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(toRow(expense)),
  });

  if (!response.ok) throw new Error("Unable to save Supabase expense");
}

export async function deleteRemoteExpense(id) {
  if (!supabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/expenses?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!response.ok) throw new Error("Unable to delete Supabase expense");
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

function authHeaders() {
  const headers = { apikey: SUPABASE_KEY };
  if (!SUPABASE_KEY.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  }
  return headers;
}

function toRow(expense) {
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
  };
}

function fromRow(row) {
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
    attachmentName: row.attachment_name || "",
  };
}
