import "server-only";

const MAX_BODY_BYTES = 16_384;
const SAFE_MODES = new Set(["brief", "chat"]);
const WEATHER_KEYS = new Set(["status", "summary", "detail", "adviceLabel"]);
const REQUEST_KEYS = new Set([
  "mode",
  "dayId",
  "weather",
  "checkedKitItemIds",
  "question",
  "history",
]);
const HISTORY_KEYS = new Set(["role", "content"]);
const SENSITIVE_PATTERN = /(?:ledger|payer|amount|receipt|attachment|operation|supabase|currency|付款人|分摊|小票|收据|金额|A\$\s*\d|[$¥€£]|\b(?:AUD|CNY|RMB)\b)/i;
const EXACT_TIME_PATTERN = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/;
const EXACT_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b|\d{1,2}月\d{1,2}日/;

export function parseTravelAssistantRequest(rawBody, { allowedModes = ["brief", "chat"] } = {}) {
  if (typeof rawBody !== "string" || Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    throw new TypeError("Invalid request");
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new TypeError("Invalid request");
  }

  if (!isRecord(body) || Object.keys(body).some((key) => !REQUEST_KEYS.has(key))) {
    throw new TypeError("Invalid request");
  }
  if (!SAFE_MODES.has(body.mode) || !allowedModes.includes(body.mode)) {
    throw new TypeError("Invalid request");
  }
  if (!/^d(?:[0-9]|1[0-6])$/.test(body.dayId || "")) {
    throw new TypeError("Invalid request");
  }
  if (body.weather !== undefined && (
    !isRecord(body.weather)
    || Object.keys(body.weather).some((key) => !WEATHER_KEYS.has(key))
  )) {
    throw new TypeError("Invalid request");
  }
  if (body.checkedKitItemIds !== undefined && (
    !Array.isArray(body.checkedKitItemIds)
    || body.checkedKitItemIds.length > 12
  )) {
    throw new TypeError("Invalid request");
  }

  return {
    mode: body.mode,
    dayId: body.dayId,
    weather: normalizeWeather(body.weather),
    checkedKitItemIds: uniqueIds(body.checkedKitItemIds),
    question: normalizeQuestion(body.question),
    history: normalizeHistory(body.history),
  };
}

export function validateBriefOutput(raw, context) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    !isRecord(value)
    || !isRecord(value.pace)
    || !["easy", "balanced", "full"].includes(value.pace.level)
  ) {
    throw new TypeError("Invalid brief output");
  }

  const facts = new Map(context.facts.map((fact) => [fact.id, fact]));
  const tomorrowItems = new Map(
    (context.tomorrow?.checklist || []).map((item) => [item.id, item]),
  );

  if (!Array.isArray(value.priorities) || value.priorities.length !== 3) {
    throw new TypeError("Invalid brief output");
  }
  const priorities = value.priorities.map((item) => enrichFactAdvice(item, facts));

  if (
    !Array.isArray(value.tradeoffs)
    || value.tradeoffs.length < 1
    || value.tradeoffs.length > 3
  ) {
    throw new TypeError("Invalid brief output");
  }
  const tradeoffs = value.tradeoffs.map((text) => safeAdvice(text, 120));
  const firstCut = enrichFactAdvice(value.firstCut, facts);

  if (!Array.isArray(value.tomorrowPrepItemIds) || value.tomorrowPrepItemIds.length > 4) {
    throw new TypeError("Invalid brief output");
  }
  const tomorrowPrep = value.tomorrowPrepItemIds.map((id) => {
    const item = tomorrowItems.get(id);
    if (!item) throw new TypeError("Invalid brief output");
    return item;
  });

  if (
    !Array.isArray(value.suggestedQuestions)
    || value.suggestedQuestions.length < 1
    || value.suggestedQuestions.length > 4
  ) {
    throw new TypeError("Invalid brief output");
  }

  return {
    pace: { level: value.pace.level, note: safeAdvice(value.pace.note, 140) },
    priorities,
    tradeoffs,
    firstCut,
    tomorrowPrep,
    suggestedQuestions: value.suggestedQuestions.map((text) => safeAdvice(text, 80)),
    sourceDayIds: context.sourceDayIds,
  };
}

function enrichFactAdvice(item, facts) {
  if (!isRecord(item) || typeof item.factId !== "string" || !facts.has(item.factId)) {
    throw new TypeError("Invalid brief output");
  }
  return {
    factId: item.factId,
    title: facts.get(item.factId).title,
    reason: safeAdvice(item.reason, 100),
  };
}

function safeAdvice(value, maxLength) {
  if (typeof value !== "string") throw new TypeError("Invalid advice text");
  const text = value.trim();
  if (
    !text
    || text.length > maxLength
    || SENSITIVE_PATTERN.test(text)
    || EXACT_TIME_PATTERN.test(text)
    || EXACT_DATE_PATTERN.test(text)
  ) {
    throw new TypeError("Invalid advice text");
  }
  return text;
}

function normalizeWeather(weather) {
  if (!isRecord(weather)) return undefined;
  return Object.fromEntries(Object.entries(weather).map(([key, value]) => [
    key,
    typeof value === "string" ? value.trim().slice(0, 160) : "",
  ]));
}

function uniqueIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => (
    typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value)
  )))];
}

function normalizeQuestion(value) {
  if (value === undefined) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > 400) {
    throw new TypeError("Invalid request");
  }
  return value.trim();
}

function normalizeHistory(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("Invalid request");
  return value.map((entry) => {
    if (
      !isRecord(entry)
      || Object.keys(entry).some((key) => !HISTORY_KEYS.has(key))
      || !["user", "assistant"].includes(entry.role)
      || typeof entry.content !== "string"
      || entry.content.length > 2_000
    ) {
      throw new TypeError("Invalid request");
    }
    return { role: entry.role, content: entry.content.trim() };
  });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
