import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import itinerary from "../src/data/nz2027-itinerary.generated.json" with { type: "json" };
import {
  MEALS_KEY,
  applyMealSnapshot,
  emptyMeals,
  loadMeals,
  mealNoteId,
  parseMealPlan,
  pendingMealNotes,
  saveMeals,
  setMealNote,
} from "../src/lib/nz2027/meals.js";
import { parseMealBatch } from "../src/lib/server/nz2027Meals.js";
import { GET as getMeals, POST as postMeals } from "../src/app/api/nz2027/meals/route.ts";
import { createSessionToken } from "../src/lib/server/session.js";

describe("2027 meal plan", () => {
  it("reads each day's breakfast, lunch and dinner and lists the key bookings", () => {
    for (const day of itinerary.days) {
      const plan = parseMealPlan(day.blocks.find((block) => block.period === "饮食").activity);
      assert.ok(plan.dinner || day.id === "d17" || plan.lunch, day.id);
    }
    assert.deepEqual(parseMealPlan("早餐：A；午餐：B：C；晚餐：D"), { breakfast: "A", lunch: "B：C", dinner: "D" });
    const booked = itinerary.dining.filter((meal) => meal.status === "已订").map((meal) => `${meal.dayId}-${meal.meal}:${meal.bookingRef}`);
    assert.deepEqual(booked, ["d9-dinner:51115222", "d11-dinner:51350801", "d12-dinner:51689789", "d16-lunch:6S3X8H48MF4W"]);
    assert.ok(itinerary.dining.some((meal) => meal.dayId === "d3" && meal.status === "待订"));
  });
});

describe("2027 meal notes store", () => {
  it("queues notes until the server confirms and keeps edits made in flight", () => {
    let state = setMealNote(emptyMeals(), mealNoteId("d9", "dinner"), { note: " 羊肩 ", rating: 5 }, new Date("2026-11-01T00:00:00Z"));
    assert.equal(state.notes["d9-dinner"].note, "羊肩");
    const sent = pendingMealNotes(state);
    state = setMealNote(state, "d9-dinner", { note: "羊肩很好吃", rating: 5 }, new Date("2026-11-01T00:00:01Z"));
    state = applyMealSnapshot(state, { sent, notes: sent });
    assert.deepEqual(state.pendingIds, ["d9-dinner"]);
    assert.equal(state.notes["d9-dinner"].note, "羊肩很好吃");
  });

  it("rejects bad ids and ratings, and survives corrupt storage", () => {
    assert.throws(() => setMealNote(emptyMeals(), "d18-dinner", { note: "" }));
    assert.throws(() => setMealNote(emptyMeals(), "d9-dinner", { note: "", rating: 6 }));
    const values = new Map();
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    storage.setItem(MEALS_KEY, "{broken");
    assert.deepEqual(loadMeals(storage), emptyMeals());
    const state = setMealNote(emptyMeals(), "d7-lunch", { note: "刺身", rating: null });
    saveMeals(storage, state);
    assert.deepEqual(loadMeals(storage), state);
  });
});

describe("2027 meals API", () => {
  const originalFetch = globalThis.fetch;
  const saved = {};
  beforeEach(() => {
    for (const key of ["TRIP_CODE", "SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) saved[key] = process.env[key];
    process.env.TRIP_CODE = "shared-code";
    process.env.SESSION_SECRET = "meals-route-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("requires the session and same-origin writes, and validates notes", async () => {
    globalThis.fetch = async () => assert.fail("Supabase must not be called");
    assert.equal((await getMeals(new Request("https://aussie.example/api/nz2027/meals"))).status, 401);
    const crossSite = await postMeals(authenticated({ method: "POST", headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }, body: "{}" }));
    assert.equal(crossSite.status, 403);
    assert.equal((await postMeals(sameOrigin({ notes: [{ id: "d9-dinner", note: "x", rating: 9, updatedAt: "2026-11-01T00:00:00Z" }] }))).status, 400);
    assert.throws(() => parseMealBatch({ notes: [note(), note()] }));
  });

  it("writes through the meal-note RPC only", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).includes("/rpc/nz2027_set_meal_note")) return Response.json({ id: JSON.parse(options.body).note.id, status: "applied" });
      return Response.json([{ id: "d9-dinner", note: "羊肩", rating: 5, updated_at: "2026-11-01T00:00:00+00:00" }]);
    };
    const response = await postMeals(sameOrigin({ notes: [note()] }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.notes, [{ id: "d9-dinner", note: "羊肩", rating: 5, updatedAt: "2026-11-01T00:00:00.000Z" }]);
    assert.ok(calls.every((url) => /\/rest\/v1\/(rpc\/nz2027_set_meal_note|nz2027_meal_notes\?)/.test(url)));
  });
});

function note() {
  return { id: "d9-dinner", note: "羊肩", rating: 5, updatedAt: "2026-11-01T00:00:00.000Z" };
}

function authenticated(init = {}) {
  const token = createSessionToken(process.env.SESSION_SECRET);
  return new Request("https://aussie.example/api/nz2027/meals", { ...init, headers: { Cookie: `aussie_chill_session=${token}`, ...(init.headers || {}) } });
}

function sameOrigin(body) {
  return authenticated({
    method: "POST",
    headers: { Origin: "https://aussie.example", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
