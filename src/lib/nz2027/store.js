// Local-first store for the 2027 two-person ledger.
// Records live in localStorage under their own key (separate from the 2026
// IndexedDB ledger). Unsynced changes stay queued until the server accepts them,
// so the tab works offline and before the Supabase migration is applied.
import { normalizeRecord, validateRecord } from "./ledger.js";

export const STORAGE_KEY = "nz2027-ledger-v1";

export function emptyState() {
  return { version: 1, records: {}, pendingIds: [], lastSyncAt: "" };
}

export function loadState(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (!parsed || parsed.version !== 1 || typeof parsed.records !== "object" || !Array.isArray(parsed.pendingIds)) {
      return emptyState();
    }
    const records = {};
    for (const record of Object.values(parsed.records)) {
      if (validateRecord(record).length === 0) records[record.id] = normalizeRecord(record);
    }
    return {
      version: 1,
      records,
      pendingIds: parsed.pendingIds.filter((id) => records[id]),
      lastSyncAt: typeof parsed.lastSyncAt === "string" ? parsed.lastSyncAt : "",
    };
  } catch {
    return emptyState();
  }
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function listRecords(state) {
  return Object.values(state.records).sort((left, right) => (
    (right.date || "").localeCompare(left.date || "") || right.updatedAt.localeCompare(left.updatedAt)
  ));
}

export function upsertLocal(state, record, now = new Date()) {
  const next = normalizeRecord({ ...record, updatedAt: nextTimestamp(state.records[record.id], now) });
  const errors = validateRecord(next);
  if (errors.length) throw new TypeError(errors.join("；"));
  return {
    ...state,
    records: { ...state.records, [next.id]: next },
    pendingIds: withId(state.pendingIds, next.id),
  };
}

export function deleteLocal(state, id, now = new Date()) {
  const current = state.records[id];
  if (!current) return state;
  const updatedAt = nextTimestamp(current, now);
  return {
    ...state,
    records: { ...state.records, [id]: { ...current, updatedAt, deletedAt: updatedAt } },
    pendingIds: withId(state.pendingIds, id),
  };
}

export function restoreLocal(state, record, now = new Date()) {
  return upsertLocal(state, { ...record, deletedAt: null }, now);
}

export function pendingRecords(state) {
  return state.pendingIds.map((id) => state.records[id]).filter(Boolean);
}

// Merge a server snapshot. A queued record is released only when the copy we
// sent is still the latest local copy; anything edited while the request was in
// flight stays queued. Server rows win for every record that is not queued.
export function applyServerSnapshot(state, { sent = [], expenses = [], serverTime = "" }) {
  const sentVersion = new Map(sent.map((record) => [record.id, record.updatedAt]));
  const pendingIds = state.pendingIds.filter((id) => sentVersion.get(id) !== state.records[id]?.updatedAt);
  const records = { ...state.records };
  for (const raw of expenses) {
    const record = normalizeRecord(raw);
    if (validateRecord(record).length) continue;
    if (pendingIds.includes(record.id)) continue;
    records[record.id] = record;
  }
  return { ...state, records, pendingIds, lastSyncAt: serverTime || state.lastSyncAt };
}

function nextTimestamp(current, now) {
  const candidate = now.getTime();
  const previous = current ? Date.parse(current.updatedAt) : 0;
  return new Date(Math.max(candidate, previous + 1)).toISOString();
}

function withId(ids, id) {
  return ids.includes(id) ? ids : [...ids, id];
}
