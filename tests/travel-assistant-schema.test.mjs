import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildBriefContext } from "../src/lib/server/travelAssistantContext.js";
import {
  parseTravelAssistantRequest,
  validateBriefOutput,
} from "../src/lib/server/travelAssistantSchema.js";

const context = buildBriefContext({ dayId: "d14" });
const factIds = context.facts.map((fact) => fact.id);
const validBrief = {
  pace: { level: "balanced", note: "按体力走。" },
  priorities: factIds.slice(0, 3).map((factId) => ({ factId, reason: "主线项目。" })),
  tradeoffs: ["保留主线。"],
  firstCut: { factId: factIds.at(-1), reason: "先删次要段。" },
  tomorrowPrepItemIds: [],
  suggestedQuestions: ["下雨怎么调整？"],
};

describe("travel assistant schema", () => {
  it("accepts only the V1 brief request shape", () => {
    const parsed = parseTravelAssistantRequest(JSON.stringify({
      mode: "brief",
      dayId: "d14",
      weather: {
        status: "forecast",
        summary: "晴",
        detail: "薄外套",
        adviceLabel: "预报穿衣建议",
      },
      checkedKitItemIds: ["power"],
    }), { allowedModes: ["brief"] });

    assert.equal(parsed.mode, "brief");
    assert.equal(parsed.dayId, "d14");
    assert.deepEqual(parsed.weather, {
      status: "forecast",
      summary: "晴",
      detail: "薄外套",
      adviceLabel: "预报穿衣建议",
    });
    assert.deepEqual(parsed.checkedKitItemIds, ["power"]);
  });

  it("rejects unknown fields and oversized bodies", () => {
    assert.throws(() => parseTravelAssistantRequest(JSON.stringify({
      mode: "brief",
      dayId: "d14",
      ledgerExpenses: [],
    }), { allowedModes: ["brief"] }));
    assert.throws(() => parseTravelAssistantRequest("x".repeat(16_385), { allowedModes: ["brief"] }));
  });

  it("enriches valid source ids with deterministic titles and labels", () => {
    const tomorrowItems = context.tomorrow.checklist.slice(0, 2);
    const output = validateBriefOutput({
      pace: { level: "balanced", note: "先完成固定项目，再按体力调整。" },
      priorities: factIds.slice(0, 3).map((factId) => ({
        factId,
        reason: "它决定今天的主线。",
      })),
      tradeoffs: ["下午只保留一段海岸步行。"],
      firstCut: { factId: factIds.at(-1), reason: "体力下降时先缩短这一段。" },
      tomorrowPrepItemIds: tomorrowItems.map((item) => item.id),
      suggestedQuestions: ["下雨怎么调整？", "午餐放在哪里最顺？"],
    }, context);

    assert.deepEqual(output.priorities.map(({ factId, title }) => ({ factId, title })), context.facts
      .slice(0, 3)
      .map(({ id, title }) => ({ factId: id, title })));
    assert.deepEqual(output.tomorrowPrep.map(({ id, label }) => ({ id, label })), tomorrowItems
      .map(({ id, label }) => ({ id, label })));
  });

  it("accepts benign advice containing an English keyword substring", () => {
    const output = validateBriefOutput({
      ...validBrief,
      tradeoffs: ["Safety is paramount."],
    }, context);

    assert.deepEqual(output.tradeoffs, ["Safety is paramount."]);
  });

  it("rejects unknown fact ids, money, private fields, and exact times in advice", () => {
    assert.throws(() => validateBriefOutput({
      ...validBrief,
      priorities: [
        { factId: "block:d14:999", reason: "未知" },
        ...validBrief.priorities.slice(1),
      ],
    }, context));
    assert.throws(() => validateBriefOutput({
      ...validBrief,
      tradeoffs: ["付款人先支付 A$99。"],
    }, context));
    assert.throws(() => validateBriefOutput({
      ...validBrief,
      tradeoffs: ["Currency details stay generic."],
    }, context));
    for (const advice of [
      "建议支付 99 澳元。",
      "The payment is 99 dollars.",
      "18：30",
      "9:05am",
      "August 11",
    ]) {
      assert.throws(() => validateBriefOutput({
        ...validBrief,
        tradeoffs: [advice],
      }, context));
    }
    assert.throws(() => validateBriefOutput({
      ...validBrief,
      pace: { level: "balanced", note: "18:30 出发。" },
    }, context));
  });

  it("returns a generic brief error for malformed raw JSON", () => {
    const marker = "PRIVATE_UPSTREAM_TEXT";

    assert.throws(
      () => validateBriefOutput(`{"pace":"${marker}"`, context),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, "Invalid brief output");
        assert.equal(error.message.includes(marker), false);
        return true;
      },
    );
  });
});
