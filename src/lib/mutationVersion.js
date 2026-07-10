const VERSION_PATTERN = /^(\d{13})-(\d{6})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const MAX_MILLIS = 9_999_999_999_999;
const MAX_COUNTER = 999_999;

export function parseMutationVersion(value) {
  const match = typeof value === "string" ? VERSION_PATTERN.exec(value) : null;
  if (!match) throw new TypeError("Invalid mutation version");

  return {
    millis: Number(match[1]),
    counter: Number(match[2]),
    clientId: match[3],
  };
}

export function compareMutationVersions(left, right) {
  const parsedLeft = parseMutationVersion(left);
  const parsedRight = parseMutationVersion(right);

  if (parsedLeft.millis !== parsedRight.millis) return parsedLeft.millis < parsedRight.millis ? -1 : 1;
  if (parsedLeft.counter !== parsedRight.counter) return parsedLeft.counter < parsedRight.counter ? -1 : 1;
  if (parsedLeft.clientId === parsedRight.clientId) return 0;
  return parsedLeft.clientId < parsedRight.clientId ? -1 : 1;
}

export function nextMutationVersion({ previous = "", observed = "", now = Date.now(), clientId }) {
  assertMillis(now);
  const parsedVersions = [previous, observed]
    .filter((value) => value !== "")
    .map(parseMutationVersion);
  let millis = now;
  let counter = -1;

  for (const version of parsedVersions) {
    if (version.millis > millis) {
      millis = version.millis;
      counter = version.counter;
    } else if (version.millis === millis) {
      counter = Math.max(counter, version.counter);
    }
  }

  counter += 1;
  if (counter > MAX_COUNTER) {
    if (millis === MAX_MILLIS) throw new RangeError("Mutation version space exhausted");
    millis += 1;
    counter = 0;
  }

  return formatMutationVersion(millis, counter, normalizeClientId(clientId));
}

export function legacyMutationVersion({ createdAt, index, clientId = "legacy" }) {
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_COUNTER) {
    throw new RangeError("Invalid legacy index");
  }

  return formatMutationVersion(legacyMillis(createdAt), index, normalizeClientId(clientId));
}

function legacyMillis(createdAt) {
  let millis = Number.NaN;

  if (createdAt instanceof Date) millis = createdAt.getTime();
  else if (typeof createdAt === "number") millis = createdAt;
  else if (typeof createdAt === "string" && createdAt.trim()) millis = Date.parse(createdAt);

  return isMillis(millis) ? millis : 0;
}

function normalizeClientId(clientId) {
  if (typeof clientId !== "string") throw new TypeError("Invalid client id");

  const normalized = clientId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) throw new TypeError("Invalid client id");
  return normalized;
}

function assertMillis(value) {
  if (!isMillis(value)) throw new RangeError("Invalid mutation time");
}

function isMillis(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MILLIS;
}

function formatMutationVersion(millis, counter, clientId) {
  return `${String(millis).padStart(13, "0")}-${String(counter).padStart(6, "0")}-${clientId}`;
}
