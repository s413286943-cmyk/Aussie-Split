import "server-only";

import { parseReceiptUploadRequest } from "../../../../lib/receipt.js";
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
  createReceiptUpload,
} from "../../../../lib/server/receipts.js";
import { SupabaseUpstreamError } from "../../../../lib/server/supabase.js";
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
    metadata = parseReceiptUploadRequest(await request.json());
  } catch {
    return invalidRequestResponse();
  }

  try {
    return privateJsonResponse(await createReceiptUpload(metadata));
  } catch (error) {
    if (error instanceof ReceiptConflictError) {
      return privateJsonResponse({ error: error.code }, { status: 409 });
    }
    if (error instanceof ReceiptNotFoundError) {
      return privateJsonResponse({ error: error.code }, { status: 404 });
    }
    console.error("receipt_upload_failed", error instanceof SupabaseUpstreamError ? {
      name: error.name,
      code: error.code,
      status: error.status,
      upstreamCode: error.upstreamCode,
      upstreamMessage: error.upstreamMessage,
    } : {
      name: error instanceof Error ? error.name : "UnknownError",
    });
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
