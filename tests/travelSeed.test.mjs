import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  initialTravelDays,
  initialTripItems,
  listSections,
  tripItemStatuses,
} from "../src/lib/travelSeed.js";

describe("travel workspace seed data", () => {
  it("seeds D0 through D16 as editable days", () => {
    assert.equal(initialTravelDays.length, 17);
    assert.deepEqual(initialTravelDays.map((day) => day.id), [
      "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8",
      "d9", "d10", "d11", "d12", "d13", "d14", "d15", "d16",
    ]);
    assert.equal(initialTravelDays[0].date, "2026-07-28");
    assert.equal(initialTravelDays[16].date, "2026-08-13");
  });

  it("keeps daily content structured instead of one long text blob", () => {
    const d8 = initialTravelDays.find((day) => day.id === "d8");
    assert.equal(d8.city, "丹翠");
    assert.equal(d8.title, "丹翠");
    assert.ok(Array.isArray(d8.blocks));
    assert.ok(d8.blocks.length >= 2);
    assert.ok(d8.blocks.every((block) => block.id && block.period && block.activity));
    assert.ok(d8.blocks.some((block) => block.photoSpot === "📍雨林海岸"));
  });

  it("keeps text-only markdown days visible as day blocks", () => {
    const d0 = initialTravelDays.find((day) => day.id === "d0");
    const d13 = initialTravelDays.find((day) => day.id === "d13");
    const d16 = initialTravelDays.find((day) => day.id === "d16");

    assert.ok(d0.blocks.some((block) => block.activity.includes("出发")));
    assert.ok(d13.blocks.some((block) => block.activity.includes("蓝山 / 南海岸")));
    assert.ok(d16.blocks.some((block) => block.activity.includes("TRS退税")));
  });

  it("seeds lodging, booking, budget, food, and activity list sections", () => {
    assert.deepEqual(listSections.map((section) => section.kind), [
      "lodging",
      "booking",
      "budget",
      "food",
      "activity",
    ]);
    for (const kind of listSections.map((section) => section.kind)) {
      assert.ok(initialTripItems.some((item) => item.kind === kind), `missing ${kind}`);
    }
  });

  it("marks budget as ready to fill from the newer guide", () => {
    const budgetTitles = initialTripItems
      .filter((item) => item.kind === "budget")
      .map((item) => item.title);

    assert.ok(budgetTitles.includes("预算待补"));
  });

  it("uses only traveler-facing item statuses", () => {
    assert.deepEqual(tripItemStatuses, ["已订好", "还没订", "到时再看"]);
    assert.ok(initialTripItems.every((item) => tripItemStatuses.includes(item.status)));
  });

  it("includes key supplied guide details", () => {
    assert.ok(initialTripItems.some((item) => item.title.includes("Cafe Sydney")));
    assert.ok(initialTripItems.some((item) => item.title.includes("Reef Magic")));
    assert.ok(initialTripItems.some((item) => item.title === "Oaks"));
    assert.ok(initialTripItems.some((item) => item.title === "Sydney"));
    assert.ok(initialTripItems.some((item) => item.title.includes("Prawn Star")));
    assert.ok(initialTripItems.some((item) => item.title.includes("大洋路自驾")));
  });
});
