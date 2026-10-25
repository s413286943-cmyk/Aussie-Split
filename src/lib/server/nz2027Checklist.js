import "server-only";

import { validCheck } from "../nz2027/checklist.js";
import { SupabaseUpstreamError, supabaseServiceJson } from "./supabase.js";

export function parseChecklistBatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.items) || body.items.length > 200) {
    throw new TypeError("Invalid checklist batch");
  }
  const ids = new Set();
  return body.items.map((item) => {
    if (!validCheck(item) || ids.has(item.id)) throw new TypeError("Invalid checklist item");
    ids.add(item.id);
    return { id: item.id, done: item.done, updatedAt: item.updatedAt };
  });
}

export async function fetchChecklist() {
  const rows = await supabaseServiceJson("/rest/v1/nz2027_checklist?select=*&limit=500");
  if (!Array.isArray(rows)) throw new SupabaseUpstreamError();
  return rows.map((row) => ({ id: row.item_id, done: Boolean(row.done), updatedAt: new Date(row.updated_at).toISOString() }));
}

export async function saveChecklistItems(items) {
  const results = [];
  for (const item of items) {
    const result = await supabaseServiceJson("/rest/v1/rpc/nz2027_set_check", { method: "POST", body: JSON.stringify({ item }) });
    if (!result || result.id !== item.id || !["applied", "stale"].includes(result.status)) throw new SupabaseUpstreamError();
    results.push(result);
  }
  return results;
}
