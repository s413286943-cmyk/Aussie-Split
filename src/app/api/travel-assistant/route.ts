import {
  assertSameOriginMutation,
  authenticationRequiredResponse,
  invalidRequestResponse,
  privateJsonResponse,
  RequestSecurityError,
  requestRejectedResponse,
} from "../../../lib/server/http.js";
import { isRequestAuthenticated } from "../../../lib/server/session.js";
import { buildBriefContext } from "../../../lib/server/travelAssistantContext.js";
import {
  requestTravelBrief,
  TravelAssistantProviderError,
} from "../../../lib/server/travelAssistantProvider.js";
import { consumeTravelAssistantCall } from "../../../lib/server/travelAssistantRateLimit.js";
import {
  parseTravelAssistantRequest,
  validateBriefOutput,
} from "../../../lib/server/travelAssistantSchema.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isRequestAuthenticated(request)) return authenticationRequiredResponse();

    assertSameOriginMutation(request);

    const rateLimit = consumeTravelAssistantCall(request);
    if (!rateLimit.allowed) {
      return privateJsonResponse(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const rawBody = await request.text();
    const input = parseTravelAssistantRequest(rawBody, { allowedModes: ["brief"] });
    const context = buildBriefContext(input);

    let rawBrief;
    try {
      rawBrief = await requestTravelBrief({ context });
    } catch (error) {
      return providerFailureResponse(error);
    }

    let brief;
    try {
      brief = validateBriefOutput(rawBrief, context);
    } catch {
      return assistantUnavailableResponse();
    }

    return privateJsonResponse({
      brief,
      sourceDayIds: context.sourceDayIds,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof RequestSecurityError) return requestRejectedResponse();
    if (error instanceof TypeError) return invalidRequestResponse();
    return assistantUnavailableResponse();
  }
}

function providerFailureResponse(error: unknown) {
  if (
    error instanceof TravelAssistantProviderError
    && error.code === "provider_timeout"
  ) {
    return privateJsonResponse({ error: "assistant_timeout" }, { status: 504 });
  }
  return assistantUnavailableResponse();
}

function assistantUnavailableResponse() {
  return privateJsonResponse({ error: "assistant_unavailable" }, { status: 502 });
}
