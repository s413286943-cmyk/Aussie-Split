import {
  compareMutationVersions,
  nextMutationVersion,
  parseMutationVersion,
} from "./mutationVersion.js";

export const mutationClientIdStorageKey = "aussie-chill-mutation-client-id-v1";
export const mutationHighWaterStorageKey = "aussie-chill-mutation-high-water-v1";
export const mutationClockLockName = "aussie-chill-mutation-clock-v1";

const fallbackMutationLockRunner = createSerialMutationLockRunner();

export function shouldUploadLocalCache(localExpenses, remoteExpenses) {
  if (!Array.isArray(localExpenses) || localExpenses.length === 0) return false;
  if (!Array.isArray(remoteExpenses) || remoteExpenses.length === 0) return true;
  return false;
}

export function createSerialMutationLockRunner() {
  return createSerialQueue();
}

export function createSerialLedgerActionQueue() {
  return createSerialQueue();
}

function createSerialQueue() {
  let tail = Promise.resolve();

  return function runSerially(task) {
    const result = tail.then(() => task());
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function createSyncRequestCoordinator() {
  let nextTokenId = 0;
  const expenseStates = new Map();

  function current() {
    for (const state of expenseStates.values()) {
      if (state.failed) return "failed";
    }
    for (const state of expenseStates.values()) {
      if (state.pending) return "syncing";
    }
    return "synced";
  }

  return {
    begin(expenseId) {
      if (typeof expenseId !== "string" || !expenseId) {
        throw new TypeError("A sync request requires an expense id");
      }

      nextTokenId += 1;
      const previous = expenseStates.get(expenseId);
      expenseStates.set(expenseId, {
        latestTokenId: nextTokenId,
        pending: true,
        failed: previous?.failed ?? false,
      });
      return { expenseId, id: nextTokenId };
    },
    settle(token, outcome) {
      if (outcome !== "synced" && outcome !== "failed") {
        throw new TypeError("Invalid sync request outcome");
      }

      const state = token && expenseStates.get(token.expenseId);
      if (!state || state.latestTokenId !== token.id) {
        return { accepted: false, state: current() };
      }

      state.pending = false;
      state.failed = outcome === "failed";
      return { accepted: true, state: current() };
    },
    current,
    snapshot() {
      return {
        state: current(),
        expenses: Object.fromEntries(
          Array.from(expenseStates, ([expenseId, state]) => [
            expenseId,
            { failed: state.failed, pending: state.pending },
          ])
        ),
      };
    },
  };
}

export function parseStoredArray(serialized, fallback = []) {
  if (!serialized) return fallback;
  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function withTimeout(promise, options = {}) {
  const timeoutMs = options.timeoutMs ?? 7000;
  const setTimer = options.setTimer ?? globalThis.setTimeout;
  const clearTimer = options.clearTimer ?? globalThis.clearTimeout;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timerId = setTimer(() => {
      if (settled) return;
      settled = true;
      reject(new InitialExpenseReadTimeoutError());
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(timerId);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimer(timerId);
        reject(error);
      }
    );
  });
}

export function prependExpenseToList(expenses, expense) {
  return [expense, ...(Array.isArray(expenses) ? expenses : [])];
}

export function replaceExpenseInList(expenses, expense) {
  const input = Array.isArray(expenses) ? expenses : [];
  if (!input.some((item) => item.id === expense.id)) return input;
  return input.map((item) => (item.id === expense.id ? expense : item));
}

export function removeExpenseFromList(expenses, id) {
  const input = Array.isArray(expenses) ? expenses : [];
  return input.filter((expense) => expense.id !== id);
}

export function restoreExpenseInList(expenses, expense, index) {
  const input = Array.isArray(expenses) ? expenses : [];
  if (input.some((item) => item.id === expense.id)) return input;
  const restored = [...input];
  restored.splice(Math.min(Math.max(index, 0), restored.length), 0, expense);
  return restored;
}

export function runWithMutationClockLock(task) {
  if (typeof globalThis.navigator?.locks?.request === "function") {
    return globalThis.navigator.locks.request(mutationClockLockName, task);
  }
  return fallbackMutationLockRunner(task);
}

export function createMutationTabId(randomUUID = defaultRandomUUID) {
  const tabId = `tab-${String(randomUUID()).toLowerCase()}`;
  if (!isClientId(tabId)) throw new TypeError("Unable to create mutation tab id");
  return tabId;
}

export function loadMutationState(storage, options = {}) {
  const storedClientId = storage.getItem(mutationClientIdStorageKey);
  const clientId = isClientId(storedClientId)
    ? storedClientId
    : createBrowserClientId(options.randomUUID ?? defaultRandomUUID);
  const storedHighWater = storage.getItem(mutationHighWaterStorageKey);
  const highWater = isMutationVersion(storedHighWater) ? storedHighWater : "";
  const state = {
    clientId,
    highWater,
    ...(options.tabId ? { tabId: options.tabId } : {}),
  };

  return saveMutationState(storage, state);
}

export function saveMutationState(storage, state) {
  assertMutationState(state);
  const storedClientId = storage.getItem(mutationClientIdStorageKey);
  const clientId = isClientId(storedClientId) ? storedClientId : state.clientId;
  const storedHighWater = storage.getItem(mutationHighWaterStorageKey);
  const highWater = greaterMutationVersion(
    state.highWater,
    isMutationVersion(storedHighWater) ? storedHighWater : ""
  );
  const persistedState = { ...state, clientId, highWater };

  storage.setItem(mutationClientIdStorageKey, clientId);
  if (highWater) storage.setItem(mutationHighWaterStorageKey, highWater);
  return persistedState;
}

export function observeExpenseMutationVersions(state, expenses) {
  assertMutationState(state);
  let highWater = state.highWater;

  for (const expense of Array.isArray(expenses) ? expenses : []) {
    const candidate = expense?.mutationVersion;
    if (!isMutationVersion(candidate)) continue;
    highWater = greaterMutationVersion(highWater, candidate);
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
    clientId: allocatorClientId(state),
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

export async function allocatePersistedExpenseMutation(expense, state, options) {
  const {
    storage,
    lockRunner = runWithMutationClockLock,
    randomUUID = defaultRandomUUID,
    ...allocationOptions
  } = options;

  return lockRunner(() => {
    const tabState = state.tabId ? state : { ...state, tabId: createMutationTabId(randomUUID) };
    const persistedState = mergePersistedMutationState(storage, tabState);
    const observedState = observeExpenseMutationVersions(persistedState, [expense]);
    const allocated = allocateExpenseMutation(expense, observedState, allocationOptions);
    return {
      expense: allocated.expense,
      state: saveMutationState(storage, allocated.state),
    };
  });
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

export async function preparePersistedBootstrapExpenses(expenses, options) {
  const {
    storage,
    tabId,
    lockRunner = runWithMutationClockLock,
    randomUUID = defaultRandomUUID,
    ...allocationOptions
  } = options;

  return lockRunner(() => {
    const state = loadMutationState(storage, { randomUUID, tabId });
    const prepared = prepareBootstrapExpenses(expenses, state, allocationOptions);
    return {
      expenses: prepared.expenses,
      state: saveMutationState(storage, prepared.state),
    };
  });
}

function mergePersistedMutationState(storage, state) {
  assertMutationState(state);
  const storedClientId = storage.getItem(mutationClientIdStorageKey);
  const storedHighWater = storage.getItem(mutationHighWaterStorageKey);
  return {
    ...state,
    clientId: isClientId(storedClientId) ? storedClientId : state.clientId,
    highWater: greaterMutationVersion(
      state.highWater,
      isMutationVersion(storedHighWater) ? storedHighWater : ""
    ),
  };
}

function greaterMutationVersion(left, right) {
  if (!left) return right;
  if (!right) return left;
  return compareMutationVersions(left, right) >= 0 ? left : right;
}

function allocatorClientId(state) {
  return state.tabId ? `${state.clientId}-${state.tabId}` : state.clientId;
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
  if (state.tabId && !isClientId(state.tabId)) throw new TypeError("Invalid mutation tab id");
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

class InitialExpenseReadTimeoutError extends Error {
  constructor() {
    super("Initial expense read timed out");
    this.name = "InitialExpenseReadTimeoutError";
    this.code = "initial_expense_read_timeout";
  }
}
