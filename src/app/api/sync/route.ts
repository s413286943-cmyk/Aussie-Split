import "server-only";

import { after } from "next/server.js";

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
import { cleanupReceipts } from "../../../lib/server/receipts.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const accessResponse = authenticate(request);
  if (accessResponse) return accessResponse;

  try {
    const snapshot = await freshSnapshot();
    scheduleReceiptCleanup();
    return privateJsonResponse(snapshot);
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
    const snapshot = await freshSnapshot();
    scheduleReceiptCleanup();
    return privateJsonResponse({ results, ...snapshot });
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

function scheduleReceiptCleanup() {
  try {
    after(() => cleanupReceipts().catch(() => undefined));
  } catch {
    // Unit calls and non-Next runtimes have no request lifecycle to extend.
  }
}
