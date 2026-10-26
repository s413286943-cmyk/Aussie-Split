import "server-only";

import releases from "../../../content/nz2027-updates.json" with { type: "json" };
import { SupabaseUpstreamError, supabaseServiceJson } from "./supabase.js";

const ACTIVITY_LIMIT = 200;

export function listReleases() {
  return releases.map((release) => ({ ...release, items: [...release.items] }));
}

// Returns null when the change log has not been set up yet, so the page can
// still show itinerary updates.
export async function fetchActivity() {
  let rows;
  try {
    rows = await supabaseServiceJson(`/rest/v1/nz2027_activity?select=*&order=at.desc,id.desc&limit=${ACTIVITY_LIMIT}`);
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!Array.isArray(rows)) throw new SupabaseUpstreamError();
  return rows.map(mapActivity);
}

export function mapActivity(row) {
  const detail = row.detail && typeof row.detail === "object" ? row.detail : {};
  return {
    id: String(row.id),
    at: new Date(row.at).toISOString(),
    kind: row.kind,
    action: row.action,
    refId: row.ref_id,
    detail: {
      ...pick(detail),
      ...(detail.before && typeof detail.before === "object" ? { before: pick(detail.before) } : {}),
    },
  };
}

function pick(value) {
  const result = {};
  if (typeof value.item === "string") result.item = value.item;
  if (typeof value.currency === "string") result.currency = value.currency;
  if (value.amount !== undefined && value.amount !== null && Number.isFinite(Number(value.amount))) result.amount = Number(value.amount);
  if (typeof value.status === "string") result.status = value.status;
  if (typeof value.date === "string") result.date = value.date;
  return result;
}

function isMissingTable(error) {
  return error instanceof SupabaseUpstreamError
    && (error.status === 404 || ["PGRST205", "42P01"].includes(error.upstreamCode));
}
