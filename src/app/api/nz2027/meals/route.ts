import "server-only";

import {
  assertSameOriginMutation,
  authenticationRequiredResponse,
  invalidRequestResponse,
  privateJsonResponse,
  requestRejectedResponse,
  upstreamUnavailableResponse,
} from "../../../../lib/server/http.js";
import { isRequestAuthenticated } from "../../../../lib/server/session.js";
import { fetchMealNotes, parseMealBatch, saveMealNotes } from "../../../../lib/server/nz2027Meals.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const accessResponse = authenticate(request);
  if (accessResponse) return accessResponse;
  try {
    return privateJsonResponse({ notes: await fetchMealNotes() });
  } catch {
    return upstreamUnavailableResponse();
  }
}

export async function POST(request: Request) {
  const accessResponse = authenticate(request);
  if (accessResponse) return accessResponse;
  try {
    assertSameOriginMutation(request);
  } catch {
    return requestRejectedResponse();
  }
  let notes;
  try {
    notes = parseMealBatch(await request.json());
  } catch {
    return invalidRequestResponse();
  }
  try {
    const results = await saveMealNotes(notes);
    return privateJsonResponse({ results, notes: await fetchMealNotes() });
  } catch {
    return upstreamUnavailableResponse();
  }
}

function authenticate(request: Request) {
  try {
    return isRequestAuthenticated(request) ? null : authenticationRequiredResponse();
  } catch {
    return upstreamUnavailableResponse();
  }
}
