const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = "aussie-chill-travel-brief-v1:";
const DAY_ID_PATTERN = /^d(?:[0-9]|1[0-6])$/;
const CHECKED_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const WEATHER_KEYS = ["status", "summary", "detail", "adviceLabel"];

export function buildTravelAssistantFingerprint({
  day,
  weather,
  checkedKitItemIds,
} = {}) {
  const projection = {
    day: projectDay(day),
    weather: projectWeather(weather),
    checkedKitItemIds: normalizeCheckedIds(checkedKitItemIds),
  };

  return fnv1a(JSON.stringify(projection));
}

export function readTravelBriefCache(storage, dayId, fingerprint) {
  if (!isValidDayId(dayId) || typeof fingerprint !== "string" || !fingerprint) {
    return emptyResult();
  }

  try {
    if (typeof storage?.getItem !== "function") return emptyResult();
    const raw = storage.getItem(cacheKey(dayId));
    if (typeof raw !== "string" || !raw) return emptyResult();

    const stored = JSON.parse(raw);
    if (!isRecord(stored) || stored.version !== CACHE_VERSION) {
      return emptyResult();
    }

    const entry = projectEntry(stored.entry, dayId);
    if (!entry) return emptyResult();
    return {
      state: entry.fingerprint === fingerprint ? "fresh" : "stale",
      entry,
    };
  } catch {
    return emptyResult();
  }
}

export function writeTravelBriefCache(storage, dayId, entry) {
  if (!isValidDayId(dayId) || typeof storage?.setItem !== "function") {
    return false;
  }
  const projectedEntry = projectEntry(entry, dayId);
  if (!projectedEntry) return false;

  try {
    storage.setItem(cacheKey(dayId), JSON.stringify({
      version: CACHE_VERSION,
      entry: projectedEntry,
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearTravelBriefCache(storage, dayId) {
  if (!isValidDayId(dayId) || typeof storage?.removeItem !== "function") return false;

  try {
    storage.removeItem(cacheKey(dayId));
    return true;
  } catch {
    return false;
  }
}

function projectDay(day) {
  return {
    id: stringValue(day?.id),
    date: stringValue(day?.date),
    city: stringValue(day?.city),
    title: stringValue(day?.title),
    focus: stringValue(day?.focus),
    transport: stringValue(day?.transport),
    leaveBy: stringValue(day?.leaveBy),
    lodging: stringValue(day?.lodging),
    blocks: Array.isArray(day?.blocks) ? day.blocks.map(projectBlock) : [],
  };
}

function projectBlock(block) {
  return {
    sortOrder: Number.isFinite(block?.sortOrder) ? block.sortOrder : null,
    period: stringValue(block?.period),
    place: stringValue(block?.place),
    activity: stringValue(block?.activity),
    highlight: stringValue(block?.highlight),
    tip: stringValue(block?.tip),
  };
}

function projectWeather(weather) {
  return Object.fromEntries(WEATHER_KEYS.map((key) => [
    key,
    typeof weather?.[key] === "string" ? weather[key].trim().slice(0, 160) : "",
  ]));
}

function normalizeCheckedIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => (
    typeof value === "string" && CHECKED_ID_PATTERN.test(value)
  )))].sort();
}

function projectEntry(entry, dayId) {
  if (
    !isRecord(entry)
    || !isNonEmptyString(entry.fingerprint)
    || !isNonEmptyString(entry.generatedAt)
    || !Array.isArray(entry.sourceDayIds)
    || entry.sourceDayIds.length !== 1
    || entry.sourceDayIds[0] !== dayId
  ) {
    return null;
  }
  const brief = projectBrief(entry.brief, dayId);
  if (!brief) return null;

  return {
    fingerprint: entry.fingerprint,
    generatedAt: entry.generatedAt,
    brief,
    sourceDayIds: [dayId],
  };
}

function projectBrief(brief, dayId) {
  if (
    !isRecord(brief)
    || !isRecord(brief.pace)
    || !["easy", "balanced", "full"].includes(brief.pace.level)
    || !isNonEmptyString(brief.pace.note)
    || !Array.isArray(brief.priorities)
    || brief.priorities.length !== 3
    || !isStringList(brief.tradeoffs, 1, 3)
    || !Array.isArray(brief.tomorrowPrep)
    || brief.tomorrowPrep.length > 4
    || !isStringList(brief.suggestedQuestions, 1, 4)
    || !Array.isArray(brief.sourceDayIds)
    || brief.sourceDayIds.length !== 1
    || brief.sourceDayIds[0] !== dayId
  ) {
    return null;
  }

  const priorities = brief.priorities.map(projectFactAdvice);
  const firstCut = projectFactAdvice(brief.firstCut);
  const tomorrowPrep = brief.tomorrowPrep.map(projectPrepItem);
  if (priorities.some((item) => !item) || !firstCut || tomorrowPrep.some((item) => !item)) {
    return null;
  }

  return {
    pace: { level: brief.pace.level, note: brief.pace.note },
    priorities,
    tradeoffs: [...brief.tradeoffs],
    firstCut,
    tomorrowPrep,
    suggestedQuestions: [...brief.suggestedQuestions],
    sourceDayIds: [dayId],
  };
}

function projectFactAdvice(item) {
  if (
    !isRecord(item)
    || !isNonEmptyString(item.factId)
    || !isNonEmptyString(item.title)
    || !isNonEmptyString(item.reason)
  ) {
    return null;
  }
  return { factId: item.factId, title: item.title, reason: item.reason };
}

function projectPrepItem(item) {
  if (
    !isRecord(item)
    || !isNonEmptyString(item.id)
    || !isNonEmptyString(item.label)
    || !isNonEmptyString(item.detail)
  ) {
    return null;
  }
  return { id: item.id, label: item.label, detail: item.detail };
}

function isStringList(value, min, max) {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= max
    && value.every(isNonEmptyString);
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isValidDayId(value) {
  return typeof value === "string" && DAY_ID_PATTERN.test(value);
}

function cacheKey(dayId) {
  return `${CACHE_KEY_PREFIX}${dayId}`;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emptyResult() {
  return { state: "empty", entry: null };
}
