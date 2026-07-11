export function createRecordId(prefix, randomUUID = defaultRandomUUID) {
  if (typeof prefix !== "string" || !/^[a-z][a-z0-9-]*$/.test(prefix)) {
    throw new TypeError("Invalid record id prefix");
  }
  const value = randomUUID();
  if (typeof value !== "string" || !value) throw new Error("Unable to create record id");
  return `${prefix}-${value}`;
}

function defaultRandomUUID() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Web Crypto randomUUID is unavailable");
  return globalThis.crypto.randomUUID();
}
