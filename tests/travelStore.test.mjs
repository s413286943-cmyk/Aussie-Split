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

  it("replaces one remote day while preserving other seed days", () => {
    const seed = {
      days: [
        { id: "d1", dayIndex: 1, title: "seed day 1" },
        { id: "d2", dayIndex: 2, title: "seed day 2" },
      ],
      items: [],
    };

    assert.deepEqual(mergeTravelData(seed, { days: [{ id: "d2", dayIndex: 2, title: "remote day 2" }] }), {
      days: [
        { id: "d1", dayIndex: 1, title: "seed day 1" },
        { id: "d2", dayIndex: 2, title: "remote day 2" },
      ],
      items: [],
    });
  });

  it("replaces one remote item while preserving other seed items", () => {
    const seed = {
      days: [],
      items: [
        { id: "lodging", sortOrder: 10, title: "seed lodging" },
        { id: "food", sortOrder: 20, title: "seed food" },
      ],
    };

    assert.deepEqual(mergeTravelData(seed, { items: [{ id: "food", sortOrder: 20, title: "remote food" }] }), {
      days: [],
      items: [
        { id: "lodging", sortOrder: 10, title: "seed lodging" },
        { id: "food", sortOrder: 20, title: "remote food" },
      ],
    });
  });

  it("appends remote-only rows", () => {
    const seed = {
      days: [{ id: "d1", dayIndex: 1, title: "seed day 1" }],
      items: [{ id: "lodging", sortOrder: 10, title: "seed lodging" }],
    };

    assert.deepEqual(mergeTravelData(seed, {
      days: [{ id: "d99", dayIndex: 99, title: "remote day" }],
      items: [{ id: "remote-food", sortOrder: 99, title: "remote food" }],
    }), {
      days: [
        { id: "d1", dayIndex: 1, title: "seed day 1" },
        { id: "d99", dayIndex: 99, title: "remote day" },
      ],
      items: [
        { id: "lodging", sortOrder: 10, title: "seed lodging" },
        { id: "remote-food", sortOrder: 99, title: "remote food" },
      ],
    });
  });
});
