import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "aussie_chill_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export class ServerConfigurationError extends Error {
  constructor() {
    super("Server access configuration is unavailable");
    this.name = "ServerConfigurationError";
    this.code = "server_configuration_error";
  }
}

export function readSessionConfig(env = process.env) {
  const tripCode = typeof env.TRIP_CODE === "string" ? env.TRIP_CODE.trim() : "";
  const sessionSecret = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET : "";

  if (!tripCode || !sessionSecret) throw new ServerConfigurationError();
  return { tripCode, sessionSecret };
}

export function createSessionToken(secret, now = Date.now()) {
  assertSecret(secret);
  const issuedAt = Math.floor(now / 1000);
  const payload = encodeBase64Url(JSON.stringify({
    version: 1,
    issuedAt,
    expiresAt: issuedAt + SESSION_MAX_AGE_SECONDS,
  }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  try {
    assertSecret(secret);
    if (typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

    const [payload, signature] = parts;
    if (!safeEqual(signature, sign(payload, secret))) return false;

    const decoded = JSON.parse(decodeBase64Url(payload));
    const nowSeconds = Math.floor(now / 1000);
    return decoded?.version === 1
      && Number.isInteger(decoded.issuedAt)
      && Number.isInteger(decoded.expiresAt)
      && decoded.expiresAt - decoded.issuedAt === SESSION_MAX_AGE_SECONDS
      && decoded.issuedAt <= nowSeconds
      && decoded.expiresAt > nowSeconds;
  } catch {
    return false;
  }
}

export function timingSafeTripCodeEqual(providedCode, configuredCode, secret) {
  assertSecret(secret);
  const providedDigest = createHmac("sha256", secret).update(String(providedCode ?? "")).digest();
  const configuredDigest = createHmac("sha256", secret).update(String(configuredCode ?? "")).digest();
  return timingSafeEqual(providedDigest, configuredDigest);
}

export function sessionCookieOptions(env = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function readSessionToken(request) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

export function isRequestAuthenticated(request, env = process.env, now = Date.now()) {
  const { sessionSecret } = readSessionConfig(env);
  return verifySessionToken(readSessionToken(request), sessionSecret, now);
}

export function serializeSessionCookie(value, options = sessionCookieOptions()) {
  const parts = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path}`);
  parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${capitalize(options.sameSite)}`);
  return parts.join("; ");
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function assertSecret(secret) {
  if (typeof secret !== "string" || !secret) throw new ServerConfigurationError();
}

function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
