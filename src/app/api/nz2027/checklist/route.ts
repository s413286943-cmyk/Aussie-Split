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
import { fetchChecklist, parseChecklistBatch, saveChecklistItems } from "../../../../lib/server/nz2027Checklist.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const accessResponse = authenticate(request);
  if (accessResponse) return accessResponse;
  try {
    return privateJsonResponse({ items: await fetchChecklist() });
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
  let items;
  try {
    items = parseChecklistBatch(await request.json());
  } catch {
    return invalidRequestResponse();
  }
  try {
    const results = await saveChecklistItems(items);
    return privateJsonResponse({ results, items: await fetchChecklist() });
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
