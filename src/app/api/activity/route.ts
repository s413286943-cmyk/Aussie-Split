import "server-only";

import {
  authenticationRequiredResponse,
  privateJsonResponse,
  upstreamUnavailableResponse,
} from "../../../lib/server/http.js";
import { isRequestAuthenticated } from "../../../lib/server/session.js";
import { fetchActivity } from "../../../lib/server/supabase.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!isRequestAuthenticated(request)) return authenticationRequiredResponse();
  } catch {
    return upstreamUnavailableResponse();
  }

  const limit = clampLimit(new URL(request.url).searchParams.get("limit"));
  try {
    return privateJsonResponse({ activity: await fetchActivity(limit) });
  } catch {
    return upstreamUnavailableResponse();
  }
}

function clampLimit(value: string | null) {
  const parsed = Number.parseInt(value || "50", 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 100);
}
