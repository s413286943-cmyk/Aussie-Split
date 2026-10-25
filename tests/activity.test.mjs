import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  actionFeedbackMessage,
  activityDisplaySummary,
  createActivityEntry,
  dashboardActivityPreview,
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
    assert.equal(createActivityEntry("confirm", expense).summary, "标记已付 晚餐");
    assert.equal(
      createActivityEntry("add", { ...expense, currency: "NZD", amount: 186.5 }, new Date("2027-02-09T06:00:00.000Z")).summary,
      "新增了 NZ$186.50 晚餐",
    );
    assert.equal(createActivityEntry("delete", expense).summary, "删除了 晚餐");
  });

  it("uses collision-resistant activity ids even at the same fixed clock time", () => {
    const ids = ["uuid-one", "uuid-two"];
    const randomUUID = () => ids.shift();
    const now = new Date("2026-07-30T10:00:00.000Z");

    const first = createActivityEntry("add", expense, now, null, { randomUUID });
    const second = createActivityEntry("add", expense, now, null, { randomUUID });

    assert.equal(first.id, "activity-uuid-one");
    assert.equal(second.id, "activity-uuid-two");
    assert.notEqual(first.id, second.id);
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
      "编辑了 晚餐：金额 ¥100.00 → ¥128.50，日期 2026-08-01 → 2026-08-02，类别 餐饮 → 交通，状态 待付 → 已付，备注已更新",
    );
  });

  it("no longer reports payer or split changes in the two-person ledger", () => {
    assert.equal(
      createActivityEntry(
        "edit",
        { ...expense, splitSettled: true, payer: "them" },
        new Date("2026-07-30T10:00:00.000Z"),
        { ...expense, splitSettled: false, payer: "us" },
      ).summary,
      "编辑了 晚餐：金额 ¥100.00",
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

  it("normalizes old split-settled activity wording at display time", () => {
    assert.equal(
      activityDisplaySummary({
        action: "edit",
        item: "晚餐",
        amount: 100,
        currency: "CNY",
        summary: "编辑了 晚餐：分摊状态 未分摊 → 已分摊",
      }),
      "编辑了 晚餐：分摊状态 待分摊 → 已分摊",
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

  it("collapses repeated edits on the same expense inside one minute", () => {
    const entries = [
      createActivityEntry("edit", { ...expense, amount: 128 }, new Date("2026-07-30T10:00:45.000Z"), expense),
      createActivityEntry("edit", { ...expense, amount: 120 }, new Date("2026-07-30T10:00:10.000Z"), expense),
      createActivityEntry("edit", { ...expense, amount: 110 }, new Date("2026-07-30T09:58:00.000Z"), expense),
    ];

    const recent = recentActivity(entries);

    assert.equal(recent.length, 2);
    assert.equal(recent[0].amount, 128);
    assert.equal(recent[1].amount, 110);
  });

  it("keeps the dashboard activity preview newest-first and capped at three", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      createActivityEntry("edit", { ...expense, id: `expense-${index}`, item: `项目${index}` }, new Date(`2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`)),
    );

    const preview = dashboardActivityPreview(entries);

    assert.equal(preview.length, 3);
    assert.deepEqual(preview.map((entry) => entry.item), ["项目4", "项目3", "项目2"]);
  });

  it("formats user-facing success feedback after ledger actions", () => {
    assert.equal(actionFeedbackMessage("add", expense), "已保存：晚餐 ¥100.00");
    assert.equal(actionFeedbackMessage("edit", expense), "已保存修改：晚餐");
    assert.equal(actionFeedbackMessage("confirm", expense), "已标记已付：晚餐");
    assert.equal(actionFeedbackMessage("delete", expense), "已删除：晚餐");
  });
});
