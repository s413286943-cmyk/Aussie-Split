import "server-only";

import { parseReceiptExpenseId } from "../../../../lib/receipt.js";
import {
  authenticationRequiredResponse,
  invalidRequestResponse,
  privateJsonResponse,
  upstreamUnavailableResponse,
} from "../../../../lib/server/http.js";
import {
  ReceiptNotFoundError,
  fetchReceiptDownload,
} from "../../../../lib/server/receipts.js";
import { isRequestAuthenticated } from "../../../../lib/server/session.js";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ expenseId: string }> },
) {
  const accessResponse = authenticate(request);
  if (accessResponse) return accessResponse;

  let expenseId;
  try {
    expenseId = parseReceiptExpenseId((await context.params).expenseId);
  } catch {
    return invalidRequestResponse();
  }

  try {
    return privateJsonResponse(await fetchReceiptDownload(expenseId));
  } catch (error) {
    if (error instanceof ReceiptNotFoundError) {
      return privateJsonResponse({ error: error.code }, { status: 404 });
    }
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
