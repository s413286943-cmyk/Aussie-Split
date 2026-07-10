import "server-only";

import {
  accessDeniedResponse,
  assertSameOriginMutation,
  privateJsonResponse,
  requestRejectedResponse,
  upstreamUnavailableResponse,
} from "../../../lib/server/http.js";
import { consumeAccessAttempt, resetAccessAttempt } from "../../../lib/server/rateLimit.js";
import {
  createSessionToken,
  isRequestAuthenticated,
  readSessionConfig,
  serializeSessionCookie,
  sessionCookieOptions,
  timingSafeTripCodeEqual,
} from "../../../lib/server/session.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return privateJsonResponse({ authenticated: isRequestAuthenticated(request) });
  } catch {
    return upstreamUnavailableResponse();
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginMutation(request);
  } catch {
    return requestRejectedResponse();
  }

  try {
    const config = readSessionConfig();
    const throttle = await consumeAccessAttempt(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return accessDeniedResponse();
    }
    const suppliedCode = isRecord(body) && typeof body.code === "string" ? body.code.trim() : "";
    if (!throttle.allowed || !timingSafeTripCodeEqual(suppliedCode, config.tripCode, config.sessionSecret)) {
      return accessDeniedResponse();
    }

    await resetAccessAttempt(request);
    const token = createSessionToken(config.sessionSecret);
    return privateJsonResponse(
      { authenticated: true },
      { headers: { "Set-Cookie": serializeSessionCookie(token) } },
    );
  } catch {
    return upstreamUnavailableResponse();
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginMutation(request);
  } catch {
    return requestRejectedResponse();
  }

  const options = { ...sessionCookieOptions(), maxAge: 0 };
  return privateJsonResponse(
    { authenticated: false },
    { headers: { "Set-Cookie": serializeSessionCookie("", options) } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
