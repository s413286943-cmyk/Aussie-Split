import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dayFromRow,
  dayToRow,
  itemFromRow,
  itemToRow,
  mergeTravelData,
} from "../src/lib/travelStore.js";

describe("travel store mapping", () => {
  it("maps editable days to Supabase rows and back", () => {
    const day = {
      id: "d8",
      dayIndex: 8,
      date: "2026-08-05",
      weekday: "周三",
      city: "丹翠雨林",
      title: "丹翠雨林 + Cape Tribulation",
      focus: "雨林入海",
      lodging: "Southern Cross Atrium Apartments",
      climateNote: "17-26°C",
      clothingNote: "薄外套",
      backupNote: "简单晚餐",
      blocks: [{ id: "d8-early", period: "清晨", place: "酒店", activity: "集合", highlight: "省心", tip: "带水" }],
    };

    const row = dayToRow(day);
    assert.equal(row.id, "d8");
    assert.equal(row.day_index, 8);
    assert.deepEqual(row.blocks, day.blocks);
    assert.deepEqual(dayFromRow(row), day);
  });

  it("maps list items to Supabase rows and back", () => {
    const item = {
      id: "food-cafe-sydney",
      kind: "food",
      title: "Cafe Sydney",
      relatedDayId: "d15",
      city: "悉尼",
      status: "还没订",
      amount: 4000,
      currency: "CNY",
      note: "告别晚餐",
      link: "",
      sortOrder: 50,
    };

    const row = itemToRow(item);
    assert.equal(row.related_day_id, "d15");
    assert.equal(row.sort_order, 50);
    assert.deepEqual(itemFromRow(row), item);
  });

  it("uses remote content when available and seed content otherwise", () => {
    const seed = { days: [{ id: "d1", title: "seed" }], items: [{ id: "x", title: "seed" }] };
    assert.deepEqual(mergeTravelData(seed, { days: [], items: [] }), seed);
    assert.deepEqual(mergeTravelData(seed, { days: [{ id: "d1", title: "remote" }], items: [] }), {
      days: [{ id: "d1", title: "remote" }],
      items: seed.items,
    });
  });
});
