import "server-only";

const DEFAULT_TIMEOUT_MS = 20_000;
const PROVIDER_MESSAGES = {
  provider_configuration_error: "Travel assistant provider configuration is unavailable",
  provider_timeout: "Travel assistant provider timed out",
  provider_unavailable: "Travel assistant provider is unavailable",
};
const SYSTEM_PROMPT = "You are a travel operations advisor. Return only JSON matching the requested schema. Select only supplied fact IDs and checklist IDs. Do not invent or restate exact times, dates, bookings, prices, people, or places. Reasons must be generic and concise. Hard facts remain controlled by the website.";
const BRIEF_OUTPUT_SHAPE = {
  pace: { level: "easy | balanced | full", note: "string" },
  priorities: [
    { factId: "string", reason: "string" },
    { factId: "string", reason: "string" },
    { factId: "string", reason: "string" },
  ],
  tradeoffs: ["string"],
  firstCut: { factId: "string", reason: "string" },
  tomorrowPrepItemIds: ["string"],
  suggestedQuestions: ["string"],
};

export class TravelAssistantProviderError extends Error {
  constructor(code) {
    super(PROVIDER_MESSAGES[code] || PROVIDER_MESSAGES.provider_unavailable);
    this.name = "TravelAssistantProviderError";
    this.code = code;
  }
}

export function readTravelAssistantConfig(env = process.env) {
  if (!env || typeof env !== "object") throw configurationError();

  const apiKey = configString(env.TRAVEL_AI_API_KEY);
  const baseUrl = configString(env.TRAVEL_AI_BASE_URL);
  const model = configString(env.TRAVEL_AI_MODEL);
  if (!apiKey || !baseUrl || !model) throw configurationError();

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw configurationError();
  }
  if (
    parsedUrl.protocol !== "https:"
    || !parsedUrl.hostname
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
    || baseUrl.includes("?")
    || baseUrl.includes("#")
  ) {
    throw configurationError();
  }

  return {
    apiKey,
    baseUrl: parsedUrl.href.replace(/\/+$/, ""),
    model,
  };
}

export async function requestTravelBrief({
  context,
  env = process.env,
  fetcher = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const { apiKey, baseUrl, model } = readTravelAssistantConfig(env);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetcher(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              task: "daily_brief",
              outputSchema: BRIEF_OUTPUT_SHAPE,
              context,
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response?.ok) throw unavailableError();

    const envelope = await response.json();
    const content = envelope?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw unavailableError();

    const brief = JSON.parse(content);
    if (!isRecord(brief)) throw unavailableError();
    return brief;
  } catch (error) {
    if (timedOut) throw new TravelAssistantProviderError("provider_timeout");
    if (error instanceof TravelAssistantProviderError) throw error;
    throw unavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

function configString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function configurationError() {
  return new TravelAssistantProviderError("provider_configuration_error");
}

function unavailableError() {
  return new TravelAssistantProviderError("provider_unavailable");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
