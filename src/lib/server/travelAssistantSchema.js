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
const SENSITIVE_PATTERN = /(?:\b(?:ledger|payer|amount|receipt|attachment|operation|supabase|currency|payment|dollars?|AUD|CNY|RMB)\b|付款人|分摊|小票|收据|金额|支付|澳元|A\$\s*\d|[$¥€£])/i;
const EXACT_TIME_PATTERN = /\b(?:[01]?\d|2[0-3])[:：][0-5]\d(?:\s*[ap]m)?\b/i;
const EXACT_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b|\d{1,2}月\d{1,2}日|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:0?[1-9]|[12]\d|3[01])\b/i;

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

  if (
    body.mode === "brief"
    && (Object.hasOwn(body, "question") || Object.hasOwn(body, "history"))
  ) {
    throw new TypeError("Invalid request");
  }

  const question = normalizeQuestion(body.question);
  const history = normalizeHistory(body.history);
  if (body.mode === "chat") {
    if (!question || history.length % 2 !== 0) throw new TypeError("Invalid request");
    for (let index = 0; index < history.length; index += 1) {
      const expectedRole = index % 2 === 0 ? "user" : "assistant";
      if (history[index].role !== expectedRole) throw new TypeError("Invalid request");
    }
  }

  return {
    mode: body.mode,
    dayId: body.dayId,
    weather: normalizeWeather(body.weather),
    checkedKitItemIds: uniqueIds(body.checkedKitItemIds),
    question,
    history,
  };
}

export function validateBriefOutput(raw, context) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new TypeError("Invalid brief output");
    }
  }
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

export function validateChatAnswer(raw, context) {
  return safeChatAdvice(raw, context, 3_000);
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

function safeChatAdvice(value, context, maxLength) {
  if (typeof value !== "string") throw new TypeError("Invalid advice text");
  const text = value.trim();
  if (!text || text.length > maxLength || SENSITIVE_PATTERN.test(text)) {
    throw new TypeError("Invalid advice text");
  }

  const contextText = JSON.stringify(context || {});
  const allowedTimes = new Set(
    collectExactMatches(EXACT_TIME_PATTERN, contextText).map(normalizeExactTime),
  );
  const allowedDates = collectAllowedDates(contextText);
  const hasUnsupportedTime = collectExactMatches(EXACT_TIME_PATTERN, text)
    .some((token) => !allowedTimes.has(normalizeExactTime(token)));
  const hasUnsupportedDate = collectExactMatches(EXACT_DATE_PATTERN, text)
    .some((token) => !allowedDates.has(normalizeExactDate(token)));

  if (hasUnsupportedTime || hasUnsupportedDate) {
    throw new TypeError("Invalid advice text");
  }
  return text;
}

function collectExactMatches(pattern, text) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].map((match) => match[0]);
}

function collectAllowedDates(contextText) {
  const allowed = new Set();
  for (const token of collectExactMatches(EXACT_DATE_PATTERN, contextText)) {
    const normalized = normalizeExactDate(token);
    allowed.add(normalized);
    if (normalized.startsWith("iso:")) {
      const [, , month, day] = normalized.match(/^iso:(\d{4})-(\d{2})-(\d{2})$/) || [];
      if (month && day) allowed.add(`md:${Number(month)}-${Number(day)}`);
    }
  }
  return allowed;
}

function normalizeExactTime(token) {
  const match = token
    .toLowerCase()
    .replace("：", ":")
    .replace(/\s+/g, "")
    .match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (!match) return token;
  let hour = Number(match[1]);
  if (match[3] === "am") hour %= 12;
  if (match[3] === "pm") hour = (hour % 12) + 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function normalizeExactDate(token) {
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `iso:${iso[1]}-${iso[2]}-${iso[3]}`;

  const chinese = token.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (chinese) return `md:${Number(chinese[1])}-${Number(chinese[2])}`;

  const english = token.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (english) {
    const months = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];
    return `md:${months.indexOf(english[1].toLowerCase()) + 1}-${Number(english[2])}`;
  }
  return token;
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
  if (!Array.isArray(value) || value.length % 2 !== 0) throw new TypeError("Invalid request");
  const history = value.map((entry, index) => {
    if (
      !isRecord(entry)
      || Object.keys(entry).some((key) => !HISTORY_KEYS.has(key))
      || !["user", "assistant"].includes(entry.role)
      || entry.role !== (index % 2 === 0 ? "user" : "assistant")
      || typeof entry.content !== "string"
      || !entry.content.trim()
      || entry.content.length > 2_000
    ) {
      throw new TypeError("Invalid request");
    }
    return { role: entry.role, content: entry.content.trim() };
  });
  return history.slice(-16);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
