import assert from "node:assert/strict";
import { describe, it } from "node:test";

import itinerary from "../src/data/itinerary.generated.json" with { type: "json" };
import { collectTodayResources, findTodayDay } from "../src/lib/today.js";
import { readWorkbook } from "../scripts/import-itinerary.mjs";

describe("itinerary data", () => {
  it("imports D0 through D16 from the Excel workbook", () => {
    const imported = readWorkbook();

    assert.equal(imported.days.length, 17);
    assert.equal(imported.days[0].id, "d0");
    assert.equal(imported.days[0].date, "2026-07-28");
    assert.equal(imported.days[16].id, "d16");
    assert.equal(imported.days[16].date, "2026-08-13");
  });

  it("keeps generated itinerary blocks linked to known resources", () => {
    const resourceIds = new Set(itinerary.resources.map((resource) => resource.id));

    for (const day of itinerary.days) {
      assert.ok(day.blocks.length > 0, `${day.id} has no blocks`);
      for (const block of day.blocks) {
        assert.ok(block.period);
        assert.ok(block.activity);
        for (const resource of block.resources) {
          assert.ok(resourceIds.has(resource.id), `unknown resource ${resource.id}`);
        }
      }
    }
  });

  it("has stage and image data for magazine-style browsing", () => {
    assert.deepEqual(itinerary.stages.map((stage) => stage.title), [
      "墨尔本 + 大洋路",
      "凯恩斯热带暖冬",
      "悉尼 + 南海岸",
    ]);
    assert.ok(itinerary.days.every((day) => day.coverImageUrl.startsWith("/itinerary/")));
  });

  it("selects the right control-panel day for pre-trip, in-trip, and post-trip dates", () => {
    assert.equal(findTodayDay(itinerary.days, new Date("2026-06-25T10:00:00+08:00")).id, "d0");
    assert.equal(findTodayDay(itinerary.days, new Date("2026-07-31T10:00:00+10:00")).id, "d3");
    assert.equal(findTodayDay(itinerary.days, new Date("2026-08-20T10:00:00+10:00")).id, "d16");
  });

  it("collects useful quick links for the selected travel day", () => {
    const day = itinerary.days.find((item) => item.id === "d1");
    const resources = collectTodayResources(day);

    assert.ok(resources.some((resource) => resource.type === "map"));
    assert.ok(resources.some((resource) => resource.type === "booking"));
    assert.ok(resources.some((resource) => resource.type === "restaurant"));
    assert.ok(resources.every((resource) => ["map", "booking", "restaurant", "official"].includes(resource.type)));
    assert.equal(new Set(resources.map((resource) => resource.id)).size, resources.length);
  });
});
