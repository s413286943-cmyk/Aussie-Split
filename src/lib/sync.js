import {
  compareMutationVersions,
  nextMutationVersion,
  parseMutationVersion,
} from "./mutationVersion.js";

export const mutationClientIdStorageKey = "aussie-chill-mutation-client-id-v1";
export const mutationHighWaterStorageKey = "aussie-chill-mutation-high-water-v1";

export function shouldUploadLocalCache(localExpenses, remoteExpenses) {
  if (!Array.isArray(localExpenses) || localExpenses.length === 0) return false;
  if (!Array.isArray(remoteExpenses) || remoteExpenses.length === 0) return true;
  return false;
}

export function loadMutationState(storage, options = {}) {
  const storedClientId = storage.getItem(mutationClientIdStorageKey);
  const clientId = isClientId(storedClientId)
    ? storedClientId
    : createBrowserClientId(options.randomUUID ?? defaultRandomUUID);
  const storedHighWater = storage.getItem(mutationHighWaterStorageKey);
  const highWater = isMutationVersion(storedHighWater) ? storedHighWater : "";
  const state = { clientId, highWater };

  saveMutationState(storage, state);
  return state;
}

export function saveMutationState(storage, state) {
  assertMutationState(state);
  storage.setItem(mutationClientIdStorageKey, state.clientId);
  if (state.highWater) storage.setItem(mutationHighWaterStorageKey, state.highWater);
}

export function observeExpenseMutationVersions(state, expenses) {
  assertMutationState(state);
  let highWater = state.highWater;

  for (const expense of Array.isArray(expenses) ? expenses : []) {
    const candidate = expense?.mutationVersion;
    if (!isMutationVersion(candidate)) continue;
    if (!highWater || compareMutationVersions(candidate, highWater) > 0) highWater = candidate;
  }

  return highWater === state.highWater ? state : { ...state, highWater };
}

export function allocateExpenseMutation(expense, state, options = {}) {
  assertMutationState(state);
  const now = options.now ?? Date.now();
  const mutationVersion = nextMutationVersion({
    previous: state.highWater,
    observed: isMutationVersion(expense?.mutationVersion) ? expense.mutationVersion : "",
    now,
    clientId: state.clientId,
  });
  const timestamp = new Date(now).toISOString();
  const deletedAt = options.deleted ? timestamp : null;

  return {
    expense: {
      ...expense,
      mutationVersion,
      updatedAt: timestamp,
      deletedAt,
    },
    state: {
      ...state,
      highWater: mutationVersion,
    },
  };
}

export function prepareBootstrapExpenses(expenses, state, options = {}) {
  const input = Array.isArray(expenses) ? expenses : [];
  let nextState = observeExpenseMutationVersions(state, input);
  let changed = false;
  const nextExpenses = input.map((expense) => {
    if (isMutationVersion(expense?.mutationVersion)) return expense;
    const allocated = allocateExpenseMutation(expense, nextState, options);
    nextState = allocated.state;
    changed = true;
    return allocated.expense;
  });

  return {
    expenses: changed ? nextExpenses : input,
    state: nextState,
  };
}

function createBrowserClientId(randomUUID) {
  const uuid = randomUUID();
  const clientId = `browser-${String(uuid).toLowerCase()}`;
  if (!isClientId(clientId)) throw new TypeError("Unable to create mutation client id");
  return clientId;
}

function defaultRandomUUID() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Web Crypto randomUUID is unavailable");
  return globalThis.crypto.randomUUID();
}

function assertMutationState(state) {
  if (!state || !isClientId(state.clientId)) throw new TypeError("Invalid mutation state");
  if (state.highWater && !isMutationVersion(state.highWater)) throw new TypeError("Invalid mutation high-water mark");
}

function isClientId(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isMutationVersion(value) {
  try {
    parseMutationVersion(value);
    return true;
  } catch {
    return false;
  }
}
