import "server-only";

import {
  assertSameOriginMutation,
  authenticationRequiredResponse,
  invalidRequestResponse,
  parseExpenseOperationBatch,
  privateJsonResponse,
  requestRejectedResponse,
  upstreamUnavailableResponse,
} from "../../../lib/server/http.js";
import { isRequestAuthenticated } from "../../../lib/server/session.js";
import {
  applyExpenseOperations,
  fetchActivity,
  fetchLedgerSnapshot,
} from "../../../lib/server/supabase.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const accessResponse = authenticate(request);
  if (accessResponse) return accessResponse;

  try {
    return privateJsonResponse(await freshSnapshot());
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

  let operations;
  try {
    operations = parseExpenseOperationBatch(await request.json());
  } catch {
    return invalidRequestResponse();
  }

  try {
    const results = await applyExpenseOperations(operations);
    return privateJsonResponse({ results, ...await freshSnapshot() });
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

async function freshSnapshot() {
  const [expenses, activity] = await Promise.all([
    fetchLedgerSnapshot(),
    fetchActivity(100),
  ]);
  return {
    expenses,
    activity,
    serverTime: new Date().toISOString(),
  };
}
