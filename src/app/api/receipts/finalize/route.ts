import "server-only";

import { parseReceiptFinalizeRequest } from "../../../../lib/receipt.js";
import {
  assertSameOriginMutation,
  authenticationRequiredResponse,
  invalidRequestResponse,
  privateJsonResponse,
  requestRejectedResponse,
  upstreamUnavailableResponse,
} from "../../../../lib/server/http.js";
import {
  ReceiptConflictError,
  ReceiptNotFoundError,
  ReceiptObjectMissingError,
  ReceiptVerificationError,
  finalizeReceiptUpload,
} from "../../../../lib/server/receipts.js";
import { isRequestAuthenticated } from "../../../../lib/server/session.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accessResponse = authenticate(request);
  if (accessResponse) return accessResponse;

  try {
    assertSameOriginMutation(request);
  } catch {
    return requestRejectedResponse();
  }

  let metadata;
  try {
    metadata = parseReceiptFinalizeRequest(await request.json());
  } catch {
    return invalidRequestResponse();
  }

  try {
    return privateJsonResponse({ receipt: await finalizeReceiptUpload(metadata) });
  } catch (error) {
    if (
      error instanceof ReceiptVerificationError
      || error instanceof ReceiptObjectMissingError
      || error instanceof ReceiptConflictError
    ) {
      return privateJsonResponse({ error: error.code }, { status: 409 });
    }
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
