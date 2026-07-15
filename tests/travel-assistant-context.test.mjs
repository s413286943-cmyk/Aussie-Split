import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBriefContext,
  buildTripIndex,
} from "../src/lib/server/travelAssistantContext.js";

describe("travel assistant allowlisted context", () => {
  it("builds D14 facts from itinerary, weather, and valid checklist ids", () => {
    const context = buildBriefContext({
      dayId: "d14",
      weather: {
        status: "forecast",
        summary: "晴 · 9-18°C",
        adviceLabel: "预报穿衣建议",
        detail: "长袖 + 薄外套",
      },
      checkedKitItemIds: ["power", "weather-shell", "not-a-real-item"],
    });

    assert.equal(context.day.id, "d14");
    assert.equal(context.day.city, "悉尼");
    assert.equal(context.weather.summary, "晴 · 9-18°C");
    assert.equal(context.checklist.find((item) => item.id === "power").checked, true);
    assert.equal(context.checklist.some((item) => item.id === "not-a-real-item"), false);
    assert.equal(context.facts.every((fact) => /^block:d14:\d+$/.test(fact.id)), true);
    assert.equal(context.tomorrow.dayId, "d15");
  });

  it("contains no private ledger or storage fields", () => {
    const serialized = JSON.stringify(buildBriefContext({ dayId: "d14" }));

    assert.doesNotMatch(serialized, /ledger|payer|amount|receipt|operation|supabase/i);
    assert.doesNotMatch(serialized, /attachment|splitSettled|recentExpenses/i);
  });

  it("returns a compact D0-D16 index", () => {
    const index = buildTripIndex();
    const expectedKeys = ["city", "date", "focus", "id", "stops", "title", "transport"];

    assert.equal(index.length, 17);
    for (const entry of index) {
      assert.deepEqual(Object.keys(entry).sort(), expectedKeys);
    }
  });

  it("rejects an unknown day id", () => {
    assert.throws(() => buildBriefContext({ dayId: "d17" }), /Invalid day id/);
  });
});
