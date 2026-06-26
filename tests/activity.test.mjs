import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createActivityEntry,
  recentActivity,
} from "../src/lib/activity.js";

const expense = {
  id: "dinner-1",
  item: "晚餐",
  currency: "CNY",
  amount: 100,
};

describe("expense activity", () => {
  it("formats add, edit, confirm, and delete summaries", () => {
    assert.equal(
      createActivityEntry("add", expense, new Date("2026-07-30T10:00:00.000Z")).summary,
      "新增了 ¥100.00 晚餐",
    );
    assert.equal(createActivityEntry("edit", expense).summary, "编辑了 晚餐");
    assert.equal(createActivityEntry("confirm", expense).summary, "确认了 晚餐");
    assert.equal(createActivityEntry("delete", expense).summary, "删除了 晚餐");
  });

  it("keeps the recent activity list newest-first and capped at eight", () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      createActivityEntry("edit", { ...expense, id: `expense-${index}`, item: `项目${index}` }, new Date(`2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`)),
    );

    const recent = recentActivity(entries);

    assert.equal(recent.length, 8);
    assert.equal(recent[0].item, "项目9");
    assert.equal(recent.at(-1).item, "项目2");
  });
});
