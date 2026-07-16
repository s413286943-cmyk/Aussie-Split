import {
  assertSameOriginMutation,
  authenticationRequiredResponse,
  invalidRequestResponse,
  privateJsonResponse,
  RequestSecurityError,
  requestRejectedResponse,
} from "../../../lib/server/http.js";
import { isRequestAuthenticated } from "../../../lib/server/session.js";
import {
  buildBriefContext,
  buildChatContext,
  routeTravelQuestion,
} from "../../../lib/server/travelAssistantContext.js";
import {
  requestTravelBrief,
  requestTravelChat,
  TravelAssistantProviderError,
} from "../../../lib/server/travelAssistantProvider.js";
import { consumeTravelAssistantCall } from "../../../lib/server/travelAssistantRateLimit.js";
import {
  parseTravelAssistantRequest,
  validateBriefOutput,
  validateChatAnswer,
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
    const input = parseTravelAssistantRequest(rawBody, { allowedModes: ["brief", "chat"] });

    if (input.mode === "chat") {
      const routed = routeTravelQuestion({
        currentDayId: input.dayId,
        question: input.question,
      });
      const context = buildChatContext({
        routed,
        weather: input.weather,
        checkedKitItemIds: input.checkedKitItemIds,
      });
      let rawAnswer;
      try {
        rawAnswer = await requestTravelChat({
          context,
          question: input.question,
          history: input.history,
        });
      } catch (error) {
        return providerFailureResponse(error);
      }

      let answer;
      try {
        answer = validateChatAnswer(rawAnswer, context);
      } catch {
        return assistantUnavailableResponse();
      }

      return createChatSseResponse({
        answer,
        scope: context.scope,
        sourceDayIds: context.sourceDayIds,
      });
    }

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

function createChatSseResponse({
  answer,
  scope,
  sourceDayIds,
}: {
  answer: string;
  scope: string;
  sourceDayIds: string[];
}) {
  const events = [
    `event: scope\ndata: ${JSON.stringify({ scope, sourceDayIds })}\n\n`,
    ...chunkText(answer, 48).map((delta) => (
      `event: delta\ndata: ${JSON.stringify({ delta })}\n\n`
    )),
    "event: done\ndata: {}\n\n",
  ];
  const encoder = new TextEncoder();
  let index = 0;

  return new Response(new ReadableStream({
    pull(controller) {
      const event = events[index];
      index += 1;
      if (event === undefined) controller.close();
      else controller.enqueue(encoder.encode(event));
    },
  }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

function chunkText(text: string, size: number) {
  const characters = Array.from(text);
  const chunks = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(""));
  }
  return chunks;
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
