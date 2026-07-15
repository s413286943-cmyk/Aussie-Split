import "server-only";

import { createHmac } from "node:crypto";

import { trustedSourceAddress } from "./rateLimit.js";
import { readSessionConfig, readSessionToken } from "./session.js";

const MIN_INTERVAL_MS = 3_000;
const LONG_WINDOW_MS = 10 * 60 * 1_000;
const MAX_CALLS_PER_WINDOW = 10;
const MAX_BUCKETS = 1_000;
const buckets = new Map();

export function consumeTravelAssistantCall(request, env = process.env, now = Date.now()) {
  pruneExpiredBuckets(now);

  const key = requestDigest(request, env);
  const calls = buckets.get(key)?.filter((timestamp) => timestamp > now - LONG_WINDOW_MS) || [];
  const shortRetryAt = calls.length > 0 && now - calls.at(-1) < MIN_INTERVAL_MS
    ? calls.at(-1) + MIN_INTERVAL_MS
    : 0;
  const longRetryAt = calls.length >= MAX_CALLS_PER_WINDOW
    ? calls[0] + LONG_WINDOW_MS
    : 0;
  const retryAt = Math.max(shortRetryAt, longRetryAt);

  if (retryAt > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1_000)),
    };
  }

  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    buckets.delete(buckets.keys().next().value);
  }
  buckets.set(key, [...calls, now]);
  return { allowed: true };
}

export function resetTravelAssistantRateLimitForTests() {
  buckets.clear();
}

function requestDigest(request, env) {
  const { sessionSecret } = readSessionConfig(env);
  return createHmac("sha256", sessionSecret)
    .update(readSessionToken(request))
    .update("\0")
    .update(trustedSourceAddress(request))
    .digest("hex");
}

function pruneExpiredBuckets(now) {
  const cutoff = now - LONG_WINDOW_MS;
  for (const [key, timestamps] of buckets) {
    const current = timestamps.filter((timestamp) => timestamp > cutoff);
    if (current.length === 0) buckets.delete(key);
    else if (current.length !== timestamps.length) buckets.set(key, current);
  }
}
