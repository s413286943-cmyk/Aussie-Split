import "server-only";

import { validMealNote } from "../nz2027/meals.js";
import { SupabaseUpstreamError, supabaseServiceJson } from "./supabase.js";

export function parseMealBatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.notes) || body.notes.length > 100) {
    throw new TypeError("Invalid meal note batch");
  }
  const ids = new Set();
  return body.notes.map((note) => {
    if (!validMealNote(note) || ids.has(note.id)) throw new TypeError("Invalid meal note");
    ids.add(note.id);
    return { id: note.id, note: note.note, rating: note.rating ?? null, updatedAt: note.updatedAt };
  });
}

export async function fetchMealNotes() {
  const rows = await supabaseServiceJson("/rest/v1/nz2027_meal_notes?select=*&limit=200");
  if (!Array.isArray(rows)) throw new SupabaseUpstreamError();
  return rows.map((row) => ({
    id: row.id,
    note: row.note || "",
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function saveMealNotes(notes) {
  const results = [];
  for (const note of notes) {
    const result = await supabaseServiceJson("/rest/v1/rpc/nz2027_set_meal_note", { method: "POST", body: JSON.stringify({ note }) });
    if (!result || result.id !== note.id || !["applied", "stale"].includes(result.status)) throw new SupabaseUpstreamError();
    results.push(result);
  }
  return results;
}
