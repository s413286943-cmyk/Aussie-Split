// "吃什么" notes: one short note and an optional 1–5 rating per meal, shared by
// both phones. Local-first like the checklist: stored under its own key and
// synced through /api/nz2027/meals, last write wins.

export const MEALS_KEY = "nz2027-meals-v1";
export const MEALS = [
  { id: "breakfast", label: "早餐" },
  { id: "lunch", label: "午餐" },
  { id: "dinner", label: "晚餐" },
];
const idPattern = /^d([1-9]|1[0-7])-(breakfast|lunch|dinner)$/;

export function mealNoteId(dayId, meal) {
  return `${dayId}-${meal}`;
}

export function validMealNote(note) {
  return Boolean(note)
    && typeof note === "object"
    && typeof note.id === "string"
    && idPattern.test(note.id)
    && typeof note.note === "string"
    && note.note.length <= 500
    && (note.rating === null || (Number.isInteger(note.rating) && note.rating >= 1 && note.rating <= 5))
    && typeof note.updatedAt === "string"
    && note.updatedAt.length <= 40
    && Number.isFinite(Date.parse(note.updatedAt));
}

export function emptyMeals() {
  return { version: 1, notes: {}, pendingIds: [] };
}

export function loadMeals(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(MEALS_KEY) || "null");
    if (!parsed || parsed.version !== 1 || typeof parsed.notes !== "object" || !Array.isArray(parsed.pendingIds)) return emptyMeals();
    const notes = {};
    for (const note of Object.values(parsed.notes)) if (validMealNote(note)) notes[note.id] = clean(note);
    return { version: 1, notes, pendingIds: parsed.pendingIds.filter((id) => notes[id]) };
  } catch {
    return emptyMeals();
  }
}

export function saveMeals(storage, state) {
  storage.setItem(MEALS_KEY, JSON.stringify(state));
}

export function setMealNote(state, id, { note, rating }, now = new Date()) {
  const previous = state.notes[id];
  const updatedAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
  const next = { id, note: String(note ?? "").trim(), rating: rating ?? null, updatedAt };
  if (!validMealNote(next)) throw new TypeError("Invalid meal note");
  return {
    ...state,
    notes: { ...state.notes, [id]: next },
    pendingIds: state.pendingIds.includes(id) ? state.pendingIds : [...state.pendingIds, id],
  };
}

export function pendingMealNotes(state) {
  return state.pendingIds.map((id) => state.notes[id]).filter(Boolean);
}

export function applyMealSnapshot(state, { sent = [], notes = [] }) {
  const sentVersion = new Map(sent.map((note) => [note.id, note.updatedAt]));
  const pendingIds = state.pendingIds.filter((id) => sentVersion.get(id) !== state.notes[id]?.updatedAt);
  const next = { ...state.notes };
  for (const note of notes) {
    if (!validMealNote(note) || pendingIds.includes(note.id)) continue;
    next[note.id] = clean(note);
  }
  return { ...state, notes: next, pendingIds };
}

function clean(note) {
  return { id: note.id, note: note.note, rating: note.rating ?? null, updatedAt: note.updatedAt };
}

// Reads a day's "饮食" line ("早餐：…；午餐：…；晚餐：…") into { breakfast, lunch, dinner }.
export function parseMealPlan(text) {
  const plan = { breakfast: "", lunch: "", dinner: "" };
  const byLabel = Object.fromEntries(MEALS.map((meal) => [meal.label, meal.id]));
  for (const part of String(text || "").split(/[；;]/)) {
    const [label, ...rest] = part.split(/[：:]/);
    const id = byLabel[label?.trim()];
    if (id && rest.length) plan[id] = rest.join("：").trim();
  }
  return plan;
}
