import "server-only";

import { normalizeRecord, validateRecord } from "../nz2027/ledger.js";
import { SupabaseUpstreamError, supabaseServiceJson } from "./supabase.js";

const MAX_BATCH = 100;

export function parseNz2027Batch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.records)) {
    throw new TypeError("Invalid 2027 ledger batch");
  }
  if (body.records.length > MAX_BATCH) throw new TypeError("Too many 2027 ledger records");
  const ids = new Set();
  return body.records.map((record) => {
    if (validateRecord(record).length) throw new TypeError("Invalid 2027 ledger record");
    if (ids.has(record.id)) throw new TypeError("Duplicate 2027 ledger record");
    ids.add(record.id);
    return normalizeRecord(record);
  });
}

export async function fetchNz2027Expenses() {
  const rows = await supabaseServiceJson("/rest/v1/nz2027_expenses?select=*&order=date.asc.nullsfirst,id.asc&limit=2000");
  if (!Array.isArray(rows)) throw new SupabaseUpstreamError();
  return rows.map(mapRow);
}

export async function upsertNz2027Expenses(records) {
  const results = [];
  for (const record of records) {
    const result = await supabaseServiceJson("/rest/v1/rpc/nz2027_upsert_expense", {
      method: "POST",
      body: JSON.stringify({ record }),
    });
    if (!result || result.id !== record.id || !["applied", "stale"].includes(result.status)) {
      throw new SupabaseUpstreamError();
    }
    results.push(result);
  }
  return results;
}

function mapRow(row) {
  return {
    id: row.id,
    date: row.date || "",
    category: row.category,
    item: row.item,
    currency: row.currency,
    amount: Number(row.amount),
    status: row.status,
    note: row.note || "",
    updatedAt: new Date(row.updated_at).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  };
}
