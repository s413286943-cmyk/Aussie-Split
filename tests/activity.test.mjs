import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activityDisplaySummary,
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
    assert.equal(createActivityEntry("edit", expense).summary, "编辑了 晚餐：金额 ¥100.00");
    assert.equal(createActivityEntry("confirm", expense).summary, "确认了 晚餐");
    assert.equal(createActivityEntry("delete", expense).summary, "删除了 晚餐");
  });

  it("describes changed fields for edited expenses", () => {
    const original = {
      ...expense,
      date: "2026-08-01",
      category: "dining",
      payer: "us",
      status: "draft",
      note: "旧备注",
    };
    const updated = {
      ...original,
      amount: 128.5,
      date: "2026-08-02",
      category: "交通",
      payer: "them",
      status: "confirmed",
      note: "新备注",
    };

    assert.equal(
      createActivityEntry("edit", updated, new Date("2026-07-30T10:00:00.000Z"), original).summary,
      "编辑了 晚餐：金额 ¥100.00 → ¥128.50，日期 2026-08-01 → 2026-08-02，类别 dining → 交通，付款方 孙张付款 → 胡董付款，状态 待确认 → 已确认，备注已更新",
    );
  });

  it("keeps edit activity informative when detailed changes are unavailable", () => {
    assert.equal(
      createActivityEntry("edit", expense, new Date("2026-07-30T10:00:00.000Z")).summary,
      "编辑了 晚餐：金额 ¥100.00",
    );
    assert.equal(
      activityDisplaySummary({
        action: "edit",
        item: "晚餐",
        amount: 100,
        currency: "CNY",
        summary: "编辑了 晚餐",
      }),
      "编辑了 晚餐：金额 ¥100.00",
    );
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