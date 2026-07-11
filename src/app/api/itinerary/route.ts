import "server-only";

import itinerary from "../../../data/itinerary.generated.json" with { type: "json" };
import {
  authenticationRequiredResponse,
  privateJsonResponse,
  upstreamUnavailableResponse,
} from "../../../lib/server/http.js";
import { isRequestAuthenticated } from "../../../lib/server/session.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!isRequestAuthenticated(request)) return authenticationRequiredResponse();
    return privateJsonResponse({ itinerary });
  } catch {
    return upstreamUnavailableResponse();
  }
}
