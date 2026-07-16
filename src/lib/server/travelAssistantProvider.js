import "server-only";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CHAT_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_SSE_BUFFER_BYTES = 32 * 1024;
const MAX_BRIEF_OUTPUT_CHARACTERS = 8 * 1024;
const MAX_CHAT_ANSWER_CHARACTERS = 3_000;
const MUTATION_ACTIONS_PATTERN = "(?:标注|勾选|修改|更新|添加|加入|删除|移除|保存|上传|记录|记账|预订|订票|取消|调整|更改)";
const CHINESE_CAPABILITY_CLAIM = new RegExp(
  `(?:我|助手|AI)\\s*(?:可以|能|会|将|要|已经|已|来|帮你|替你|为你)[^。！？\\n]{0,80}${MUTATION_ACTIONS_PATTERN}`,
  "iu",
);
const ENGLISH_CAPABILITY_CLAIM = /\b(?:i|we)\s+(?:can|could|will|would|already|have(?!\s+not\b)(?:\s+already)?|am\s+going\s+to)\b[^.!?\n]{0,100}\b(?:mark|check|add|remove|update|change|save|upload|record|book|cancel|edit)\b/iu;
const PROVIDER_MESSAGES = {
  provider_configuration_error: "Travel assistant provider configuration is unavailable",
  provider_timeout: "Travel assistant provider timed out",
  provider_unavailable: "Travel assistant provider is unavailable",
};
const SYSTEM_PROMPT = "You are a travel operations advisor. Return only JSON matching the requested schema. Write all user-facing prose in Simplified Chinese. Select only supplied fact IDs and checklist IDs. Do not invent or restate exact times, dates, bookings, prices, people, or places. Reasons must be generic and concise. Hard facts remain controlled by the website.";
const CHAT_SYSTEM_PROMPT = "Answer from the supplied itinerary context only. Write all user-facing prose in Simplified Chinese. Give advice, never claim to change itinerary, bookings, tickets, checklist, ledger, or receipts. Never offer to mark, check, add, remove, edit, update, save, upload, book, cancel, or record anything for the traveler. Phrase every action as something the traveler can do, never as something you can or will do. Do not invent exact times, dates, prices, people, bookings, or places. If the context does not contain an answer, say so. Hard facts shown by the website are authoritative.";
const UNMATCHED_CHAT_INSTRUCTION = "One or more requested place, date, or day references were not found in the supplied itinerary. Say that they were not found, do not infer or invent them, and answer any matched portion only from supplied facts.";
const BRIEF_OUTPUT_SHAPE = {
  pace: { level: "easy | balanced | full", note: "string" },
  priorities: [
    { factId: "string", reason: "string" },
    { factId: "string", reason: "string" },
    { factId: "string", reason: "string" },
  ],
  tradeoffs: ["string"],
  firstCut: { factId: "string", reason: "string" },
  tomorrowPrepItemIds: ["0-4 supplied checklist ID strings"],
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
        stream: true,
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
    if (!response?.ok || !response.body) throw unavailableError();

    const content = await readBufferedProviderStream(
      response.body,
      controller.signal,
      MAX_BRIEF_OUTPUT_CHARACTERS,
    );

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

export async function requestTravelChat({
  context,
  question,
  history,
  env = process.env,
  fetcher = fetch,
  timeoutMs = DEFAULT_CHAT_TIMEOUT_MS,
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
        stream: true,
        messages: [
          { role: "system", content: chatSystemPrompt(context) },
          {
            role: "user",
            content: JSON.stringify({ task: "travel_chat_context", context }),
          },
          ...(Array.isArray(history) ? history : []),
          { role: "user", content: question },
        ],
      }),
      signal: controller.signal,
    });
    if (!response?.ok || !response.body) throw unavailableError();

    const answer = await readBufferedProviderStream(
      response.body,
      controller.signal,
      MAX_CHAT_ANSWER_CHARACTERS,
    );
    assertChatCapabilityBoundary(answer);
    return answer;
  } catch (error) {
    if (timedOut) throw new TravelAssistantProviderError("provider_timeout");
    if (error instanceof TravelAssistantProviderError) throw error;
    throw unavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

function chatSystemPrompt(context) {
  return context?.unmatched === true
    ? `${CHAT_SYSTEM_PROMPT} ${UNMATCHED_CHAT_INSTRUCTION}`
    : CHAT_SYSTEM_PROMPT;
}

function assertChatCapabilityBoundary(answer) {
  if (CHINESE_CAPABILITY_CLAIM.test(answer) || ENGLISH_CAPABILITY_CLAIM.test(answer)) {
    throw unavailableError();
  }
}

async function readBufferedProviderStream(body, signal, maxOutputCharacters = Infinity) {
  if (signal.aborted) throw new Error("Provider stream aborted");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let sawDone = false;
  let streamClosed = false;
  let rejectOnAbort;
  const aborted = new Promise((_, reject) => {
    rejectOnAbort = () => reject(new Error("Provider stream aborted"));
    signal.addEventListener("abort", rejectOnAbort, { once: true });
  });

  try {
    while (!sawDone) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) {
        streamClosed = true;
        buffer += decoder.decode();
      } else {
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      const drained = drainSseEvents(buffer, streamClosed);
      buffer = drained.rest;
      if (Buffer.byteLength(buffer, "utf8") > MAX_PROVIDER_SSE_BUFFER_BYTES) {
        throw unavailableError();
      }
      for (const event of drained.events) {
        if (event.done) {
          sawDone = true;
          break;
        }
        answer += event.delta;
        if (answer.length > maxOutputCharacters) throw unavailableError();
      }

      if (streamClosed) break;
    }

    if (!sawDone || !answer.trim()) throw unavailableError();
    return answer;
  } finally {
    signal.removeEventListener("abort", rejectOnAbort);
    if (!streamClosed) await reader.cancel().catch(() => {});
  }
}

function drainSseEvents(input, includeRemainder) {
  const events = [];
  let rest = input;
  let separator = rest.match(/\r?\n\r?\n/);

  while (separator) {
    const eventText = rest.slice(0, separator.index);
    rest = rest.slice(separator.index + separator[0].length);
    assertSseEventWithinLimit(eventText);
    const event = parseSseEvent(eventText);
    if (event) events.push(event);
    separator = rest.match(/\r?\n\r?\n/);
  }

  if (includeRemainder && rest.trim()) {
    assertSseEventWithinLimit(rest);
    const event = parseSseEvent(rest);
    if (event) events.push(event);
    rest = "";
  }

  return { events, rest };
}

function assertSseEventWithinLimit(eventText) {
  if (Buffer.byteLength(eventText, "utf8") > MAX_PROVIDER_SSE_BUFFER_BYTES) {
    throw unavailableError();
  }
}

function parseSseEvent(eventText) {
  const dataLines = [];
  for (const line of eventText.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5);
    dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
  }
  if (dataLines.length === 0) return null;

  const data = dataLines.join("\n");
  if (data === "[DONE]") return { done: true, delta: "" };

  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    throw unavailableError();
  }

  if (
    isRecord(payload)
    && Array.isArray(payload.choices)
    && payload.choices.length === 0
    && isRecord(payload.usage)
  ) {
    return { done: false, delta: "" };
  }

  const choice = payload?.choices?.[0];
  const delta = choice?.delta;
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(choice) || !isRecord(delta)) {
    throw unavailableError();
  }
  if (
    delta.refusal !== undefined
    && delta.refusal !== null
    && (typeof delta.refusal !== "string" || delta.refusal.trim())
  ) {
    throw unavailableError();
  }
  if (delta.content !== undefined && delta.content !== null && typeof delta.content !== "string") {
    throw unavailableError();
  }
  return { done: false, delta: delta.content || "" };
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
