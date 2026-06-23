const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const travelSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const travelStorageKey = "aussie-chill-travel-v2";

export function dayToRow(day) {
  return {
    id: day.id,
    day_index: day.dayIndex,
    date: day.date,
    weekday: day.weekday,
    city: day.city,
    title: day.title,
    focus: day.focus,
    lodging: day.lodging,
    climate_note: day.climateNote,
    clothing_note: day.clothingNote,
    backup_note: day.backupNote || "",
    blocks: day.blocks || [],
  };
}

export function dayFromRow(row) {
  return {
    id: row.id,
    dayIndex: Number(row.day_index),
    date: row.date,
    weekday: row.weekday,
    city: row.city,
    title: row.title,
    focus: row.focus,
    lodging: row.lodging || "",
    climateNote: row.climate_note || "",
    clothingNote: row.clothing_note || "",
    backupNote: row.backup_note || "",
    blocks: row.blocks || [],
  };
}

export function itemToRow(item) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    related_day_id: item.relatedDayId || "",
    city: item.city || "",
    status: item.status,
    amount: item.amount || 0,
    currency: item.currency || "",
    note: item.note || "",
    link: item.link || "",
    sort_order: item.sortOrder || 0,
  };
}

export function itemFromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    relatedDayId: row.related_day_id || "",
    city: row.city || "",
    status: row.status,
    amount: Number(row.amount || 0),
    currency: row.currency || "",
    note: row.note || "",
    link: row.link || "",
    sortOrder: Number(row.sort_order || 0),
  };
}

export function mergeTravelData(seed, remote) {
  return {
    days: mergeRows(seed.days, remote?.days, "dayIndex"),
    items: mergeRows(seed.items, remote?.items, "sortOrder"),
  };
}

function mergeRows(seedRows, remoteRows, sortKey) {
  if (!remoteRows?.length) return seedRows;

  const mergedById = new Map(seedRows.map((row) => [row.id, row]));
  for (const row of remoteRows) {
    mergedById.set(row.id, row);
  }

  return Array.from(mergedById.values()).sort((a, b) => compareOptionalNumber(a, b, sortKey));
}

function compareOptionalNumber(a, b, key) {
  const aValue = Number(a[key]);
  const bValue = Number(b[key]);
  const aHasValue = Number.isFinite(aValue);
  const bHasValue = Number.isFinite(bValue);

  if (aHasValue && bHasValue) return aValue - bValue;
  if (aHasValue) return -1;
  if (bHasValue) return 1;
  return 0;
}

export async function fetchRemoteTravelData() {
  if (!travelSupabaseConfigured) return null;

  const [daysResponse, itemsResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/travel_days?select=*&order=day_index.asc`, { headers: authHeaders() }),
    fetch(`${SUPABASE_URL}/rest/v1/trip_items?select=*&order=sort_order.asc`, { headers: authHeaders() }),
  ]);

  if (!daysResponse.ok || !itemsResponse.ok) {
    throw new Error("Unable to load travel workspace");
  }

  return {
    days: (await daysResponse.json()).map(dayFromRow),
    items: (await itemsResponse.json()).map(itemFromRow),
  };
}

export async function saveRemoteDay(day) {
  if (!travelSupabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/travel_days`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(dayToRow(day)),
  });

  if (!response.ok) throw new Error("Unable to save travel day");
}

export async function saveRemoteItem(item) {
  if (!travelSupabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/trip_items`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(itemToRow(item)),
  });

  if (!response.ok) throw new Error("Unable to save trip item");
}

export async function deleteRemoteItem(id) {
  if (!travelSupabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/trip_items?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!response.ok) throw new Error("Unable to delete trip item");
}

function authHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}
