import "server-only";

import { createHmac } from "node:crypto";

import { readSessionConfig, ServerConfigurationError } from "./session.js";

export class AccessThrottleError extends Error {
  constructor() {
    super("Access throttle is unavailable");
    this.name = "AccessThrottleError";
    this.code = "access_throttle_unavailable";
  }
}

export function trustedSourceAddress(request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-forwarded-for")
    || request.headers.get("x-real-ip")
    || "unavailable";
  return forwarded.split(",", 1)[0].trim() || "unavailable";
}

export function hashSourceAddress(address, secret) {
  return createHmac("sha256", secret).update(String(address)).digest("hex");
}

export async function consumeAccessAttempt(request, env = process.env) {
  return callThrottleRpc(
    "consume_access_attempt",
    hashRequestAddress(request, env),
    env,
  );
}

export async function resetAccessAttempt(request, env = process.env) {
  return callThrottleRpc(
    "reset_access_attempt",
    hashRequestAddress(request, env),
    env,
  );
}

function hashRequestAddress(request, env) {
  const { sessionSecret } = readSessionConfig(env);
  return hashSourceAddress(trustedSourceAddress(request), sessionSecret);
}

async function callThrottleRpc(functionName, addressHash, env) {
  const url = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.replace(/\/$/, "") : "";
  const serviceRole = typeof env.SUPABASE_SERVICE_ROLE_KEY === "string"
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : "";
  if (!url || !serviceRole) throw new ServerConfigurationError();

  let response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address_hash: addressHash }),
      cache: "no-store",
    });
  } catch {
    throw new AccessThrottleError();
  }
  if (!response.ok) throw new AccessThrottleError();

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AccessThrottleError();
  }
  if (!payload || typeof payload.allowed !== "boolean") throw new AccessThrottleError();
  return payload;
}
