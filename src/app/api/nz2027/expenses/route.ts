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
import {
  fetchNz2027Expenses,
  parseNz2027Batch,
  upsertNz2027Expenses,
} from "../../../../lib/server/nz2027Ledger.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const accessResponse = authenticate(request);
  if (accessResponse) return accessResponse;

  try {
    return privateJsonResponse({ expenses: await fetchNz2027Expenses(), serverTime: new Date().toISOString() });
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

  let records;
  try {
    records = parseNz2027Batch(await request.json());
  } catch {
    return invalidRequestResponse();
  }

  try {
    const results = await upsertNz2027Expenses(records);
    return privateJsonResponse({ results, expenses: await fetchNz2027Expenses(), serverTime: new Date().toISOString() });
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
