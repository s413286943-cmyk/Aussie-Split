import "server-only";

import {
  authenticationRequiredResponse,
  privateJsonResponse,
  upstreamUnavailableResponse,
} from "../../../../lib/server/http.js";
import { isRequestAuthenticated } from "../../../../lib/server/session.js";
import { fetchActivity, listReleases } from "../../../../lib/server/nz2027Updates.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!isRequestAuthenticated(request)) return authenticationRequiredResponse();
  } catch {
    return upstreamUnavailableResponse();
  }
  const releases = listReleases();
  try {
    const activity = await fetchActivity();
    return privateJsonResponse({ releases, activity: activity || [], activityAvailable: activity !== null });
  } catch {
    // Itinerary updates still show when the change log is unreachable.
    return privateJsonResponse({ releases, activity: [], activityAvailable: false });
  }
}
