// Shared pre-trip checklist: which items are done. Local-first like the ledger,
// stored in its own localStorage key and synced through /api/nz2027/checklist.

export const CHECKLIST_KEY = "nz2027-checklist-v1";
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validCheck(item) {
  return Boolean(item)
    && typeof item === "object"
    && typeof item.id === "string"
    && idPattern.test(item.id)
    && typeof item.done === "boolean"
    && typeof item.updatedAt === "string"
    && item.updatedAt.length <= 40
    && Number.isFinite(Date.parse(item.updatedAt));
}

export function emptyChecklist() {
  return { version: 1, items: {}, pendingIds: [] };
}

export function loadChecklist(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(CHECKLIST_KEY) || "null");
    if (!parsed || parsed.version !== 1 || typeof parsed.items !== "object" || !Array.isArray(parsed.pendingIds)) return emptyChecklist();
    const items = {};
    for (const item of Object.values(parsed.items)) if (validCheck(item)) items[item.id] = { id: item.id, done: item.done, updatedAt: item.updatedAt };
    return { version: 1, items, pendingIds: parsed.pendingIds.filter((id) => items[id]) };
  } catch {
    return emptyChecklist();
  }
}

export function saveChecklist(storage, state) {
  storage.setItem(CHECKLIST_KEY, JSON.stringify(state));
}

export function setCheck(state, id, done, now = new Date()) {
  const previous = state.items[id];
  const updatedAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
  const item = { id, done, updatedAt };
  if (!validCheck(item)) throw new TypeError("Invalid checklist item");
  return {
    ...state,
    items: { ...state.items, [id]: item },
    pendingIds: state.pendingIds.includes(id) ? state.pendingIds : [...state.pendingIds, id],
  };
}

export function pendingChecks(state) {
  return state.pendingIds.map((id) => state.items[id]).filter(Boolean);
}

export function isDone(state, id) {
  return Boolean(state.items[id]?.done);
}

export function applyChecklistSnapshot(state, { sent = [], items = [] }) {
  const sentVersion = new Map(sent.map((item) => [item.id, item.updatedAt]));
  const pendingIds = state.pendingIds.filter((id) => sentVersion.get(id) !== state.items[id]?.updatedAt);
  const next = { ...state.items };
  for (const item of items) {
    if (!validCheck(item) || pendingIds.includes(item.id)) continue;
    next[item.id] = { id: item.id, done: item.done, updatedAt: item.updatedAt };
  }
  return { ...state, items: next, pendingIds };
}
