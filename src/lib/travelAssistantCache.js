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
    if (!isRecord(stored) || stored.version !== CACHE_VERSION || !isValidEntry(stored.entry)) {
      return emptyResult();
    }

    const entry = projectEntry(stored.entry);
    return {
      state: entry.fingerprint === fingerprint ? "fresh" : "stale",
      entry,
    };
  } catch {
    return emptyResult();
  }
}

export function writeTravelBriefCache(storage, dayId, entry) {
  if (!isValidDayId(dayId) || !isValidEntry(entry) || typeof storage?.setItem !== "function") {
    return false;
  }

  try {
    storage.setItem(cacheKey(dayId), JSON.stringify({
      version: CACHE_VERSION,
      entry: projectEntry(entry),
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

function projectEntry(entry) {
  return {
    fingerprint: entry.fingerprint,
    generatedAt: entry.generatedAt,
    brief: entry.brief,
    sourceDayIds: [...entry.sourceDayIds],
  };
}

function isValidEntry(entry) {
  return isRecord(entry)
    && typeof entry.fingerprint === "string"
    && Boolean(entry.fingerprint)
    && typeof entry.generatedAt === "string"
    && Boolean(entry.generatedAt)
    && isRecord(entry.brief)
    && Array.isArray(entry.sourceDayIds)
    && entry.sourceDayIds.length > 0
    && entry.sourceDayIds.every(isValidDayId);
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
