import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBriefContext,
  buildTripIndex,
  routeTravelQuestion,
} from "../src/lib/server/travelAssistantContext.js";

describe("travel assistant allowlisted context", () => {
  it("keeps an ordinary question on the current full day", () => {
    const routed = routeTravelQuestion({
      currentDayId: "d14",
      question: "今天下雨怎么调整？",
    });

    assert.equal(routed.scope, "day");
    assert.deepEqual(routed.sourceDayIds, ["d14"]);
    assert.deepEqual(routed.matchedDayIds, []);
    assert.equal(routed.unmatched, false);
    assert.equal(routed.currentDay.id, "d14");
    assert.equal(routed.currentDay.facts.length > 0, true);
    assert.deepEqual(routed.matchedDays, []);
    assert.deepEqual(routed.tripIndex, []);
  });

  it("matches exact day aliases without digit-prefix collisions", () => {
    for (const question of ["D13 如果下雨呢？", "day13 如果下雨呢？", "第13天如果下雨呢？", "Ｄ－１３ 如果下雨呢？"]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });
      assert.deepEqual(routed.sourceDayIds, ["d14", "d13"]);
      assert.deepEqual(routed.matchedDayIds, ["d13"]);
    }

    const d1 = routeTravelQuestion({ currentDayId: "d14", question: "D1 怎么安排？" });
    const laterDays = routeTravelQuestion({ currentDayId: "d14", question: "D10 和 D16 怎么安排？" });
    assert.deepEqual(d1.matchedDayIds, ["d1"]);
    assert.deepEqual(laterDays.matchedDayIds, ["d10", "d16"]);
    assert.equal(laterDays.matchedDayIds.includes("d1"), false);
  });

  it("deduplicates repeated and current-day matches", () => {
    const repeated = routeTravelQuestion({
      currentDayId: "d14",
      question: "D13、day13、第13天都看看",
    });
    const current = routeTravelQuestion({
      currentDayId: "d14",
      question: "D14 的 Taronga 和 Bondi 怎么排？",
    });

    assert.deepEqual(repeated.matchedDayIds, ["d13"]);
    assert.deepEqual(repeated.sourceDayIds, ["d14", "d13"]);
    assert.deepEqual(current.matchedDayIds, ["d14"]);
    assert.deepEqual(current.sourceDayIds, ["d14"]);
    assert.deepEqual(current.matchedDays, []);
  });

  it("marks an out-of-itinerary day reference unmatched", () => {
    const routed = routeTravelQuestion({ currentDayId: "d14", question: "D17 怎么安排？" });

    assert.deepEqual(routed.sourceDayIds, ["d14"]);
    assert.deepEqual(routed.matchedDayIds, []);
    assert.equal(routed.unmatched, true);
  });

  it("preserves unresolved targets when whole-trip context is requested", () => {
    for (const question of ["火星基地哪天去？", "全程和 D17 怎么安排？"]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });

      assert.equal(routed.scope, "trip", question);
      assert.equal(routed.unmatched, true, question);
      assert.equal(routed.tripIndex.length, 17, question);
    }
  });

  it("keeps general whole-trip topics resolved", () => {
    const results = [
      "全程交通怎么安排？",
      "整个行程有什么需要注意的？",
      "全程怎么规划？",
    ].map((question) => routeTravelQuestion({ currentDayId: "d14", question }));

    assert.deepEqual(results.map(({ scope, unmatched, tripIndex }) => ({
      scope,
      unmatched,
      tripDays: tripIndex.length,
    })), Array.from({ length: 3 }, () => ({ scope: "trip", unmatched: false, tripDays: 17 })));
  });

  it("recognizes an English whole-trip which-day question", () => {
    const routed = routeTravelQuestion({
      currentDayId: "d14",
      question: "whole trip which day is hardest?",
    });

    assert.equal(routed.scope, "trip");
    assert.equal(routed.unmatched, false);
    assert.equal(routed.tripIndex.length, 17);
  });

  it("keeps partial day and place references unmatched", () => {
    const days = routeTravelQuestion({ currentDayId: "d14", question: "D13 和 D17 怎么安排？" });
    const place = routeTravelQuestion({ currentDayId: "d14", question: "Cairns Mars Beach 怎么走？" });

    assert.deepEqual(days.matchedDayIds, ["d13"]);
    assert.deepEqual(days.sourceDayIds, ["d14", "d13"]);
    assert.equal(days.unmatched, true);
    assert.equal(place.scope, "city");
    assert.deepEqual(place.matchedDayIds, ["d6", "d7", "d8", "d9", "d10"]);
    assert.equal(place.unmatched, true);
  });

  it("matches Chinese, ISO, and English dates", () => {
    for (const question of [
      "8月12日要准备什么？",
      "8月12号要准备什么？",
      "2026年8月12日要准备什么？",
      "2026-08-12 要准备什么？",
      "2026—08—12 要准备什么？",
      "Aug 12 要准备什么？",
      "August 12 要准备什么？",
      "August 12, 2026 要准备什么？",
      "ＡＵＧＵＳＴ　１２ 要准备什么？",
    ]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });
      assert.deepEqual(routed.sourceDayIds, ["d14", "d15"]);
      assert.deepEqual(routed.matchedDayIds, ["d15"]);
    }
  });

  it("rejects explicit dates from outside the itinerary year", () => {
    for (const question of ["2025年8月12日要准备什么？", "August 12, 2025 要准备什么？"]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });

      assert.deepEqual(routed.matchedDayIds, [], question);
      assert.deepEqual(routed.sourceDayIds, ["d14"], question);
      assert.equal(routed.unmatched, true, question);
    }
  });

  it("binds each explicit year to its own date reference", () => {
    const routed = routeTravelQuestion({
      currentDayId: "d14",
      question: "2025年8月12日和2026年8月11日",
    });

    assert.deepEqual(routed.matchedDayIds, ["d14"]);
    assert.deepEqual(routed.sourceDayIds, ["d14"]);
    assert.equal(routed.unmatched, true);
  });

  it("maps Cairns aliases to only the five stage days", () => {
    for (const question of ["Cairns 怎么安排？", "凯恩斯怎么安排？"]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });
      assert.equal(routed.scope, "city");
      assert.deepEqual(routed.matchedDayIds, ["d6", "d7", "d8", "d9", "d10"]);
      assert.equal(routed.matchedDayIds.includes("d5"), false);
      assert.equal(routed.matchedDayIds.includes("d11"), false);
    }
  });

  it("prioritizes answer-bearing stage days inside the context cap", () => {
    for (const question of ["凯恩斯哪天最适合休息？", "Cairns rest day?"]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });

      assert.equal(routed.scope, "city");
      assert.deepEqual(routed.matchedDayIds, ["d6", "d7", "d8", "d9", "d10"]);
      assert.equal(routed.sourceDayIds[0], "d14");
      assert.equal(routed.sourceDayIds.includes("d10"), true);
      assert.equal(routed.sourceDayIds.length, 4);
      assert.deepEqual(routed.matchedDays.map((day) => day.id), routed.sourceDayIds.slice(1));
    }
  });

  it("keeps a city-scoped which-day question in city scope", () => {
    const routed = routeTravelQuestion({
      currentDayId: "d14",
      question: "凯恩斯哪天安排最轻松？",
    });

    assert.equal(routed.scope, "city");
    assert.deepEqual(routed.matchedDayIds, ["d6", "d7", "d8", "d9", "d10"]);
    assert.deepEqual(routed.tripIndex, []);
  });

  it("matches non-stage city names without turning which-day into trip scope", () => {
    const atherton = routeTravelQuestion({ currentDayId: "d14", question: "阿瑟顿高原哪天？" });
    const hongKong = routeTravelQuestion({ currentDayId: "d14", question: "香港哪天？" });

    assert.equal(atherton.scope, "city");
    assert.deepEqual(atherton.matchedDayIds, ["d9"]);
    assert.deepEqual(atherton.sourceDayIds, ["d14", "d9"]);
    assert.deepEqual(atherton.tripIndex, []);
    assert.equal(hongKong.scope, "city");
    assert.deepEqual(hongKong.matchedDayIds, ["d0", "d16"]);
    assert.deepEqual(hongKong.sourceDayIds, ["d14", "d0", "d16"]);
    assert.deepEqual(hongKong.tripIndex, []);
  });

  it("matches canonical itinerary places and shared stops", () => {
    const cases = new Map([
      ["Taronga 怎么走？", ["d14"]],
      ["Bondi 怎么走？", ["d14"]],
      ["QVM 怎么走？", ["d1"]],
      ["Carlton 怎么走？", ["d1"]],
      ["Palm Cove 怎么走？", ["d10"]],
      ["Fitzroy 怎么走？", ["d2"]],
      ["Barangaroo 怎么走？", ["d11"]],
      ["Twelve Apostles 哪两天会去？", ["d4", "d5"]],
      ["QVB 哪两天会去？", ["d12", "d15"]],
    ]);

    for (const [question, expectedDayIds] of cases) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });
      assert.deepEqual(routed.matchedDayIds, expectedDayIds, question);
    }
  });

  it("matches complete multiword targets instead of generic suffixes", () => {
    for (const question of ["Mars Beach 怎么走？", "Fake Hotel 怎么走？"]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });

      assert.deepEqual(routed.matchedDayIds, [], question);
      assert.equal(routed.unmatched, true, question);
    }

    const sameDay = routeTravelQuestion({ currentDayId: "d13", question: "Taronga Bondi 怎么安排？" });
    assert.deepEqual(sameDay.matchedDayIds, ["d14"]);
    assert.deepEqual(sameDay.sourceDayIds, ["d13", "d14"]);
  });

  it("matches two-character alphanumeric place ids without accepting two-letter words", () => {
    const routed = routeTravelQuestion({ currentDayId: "d14", question: "T2 怎么走？" });
    const stopWord = routeTravelQuestion({ currentDayId: "d14", question: "to 怎么走？" });

    assert.deepEqual(routed.matchedDayIds, ["d11"]);
    assert.deepEqual(routed.sourceDayIds, ["d14", "d11"]);
    assert.equal(routed.unmatched, false);
    assert.deepEqual(stopWord.matchedDayIds, []);
  });

  it("normalizes Unicode width, case, and punctuation", () => {
    const routed = routeTravelQuestion({
      currentDayId: "d14",
      question: "ｑｖｍ！！！QvM？？？",
    });

    assert.deepEqual(routed.matchedDayIds, ["d1"]);
    assert.deepEqual(routed.sourceDayIds, ["d14", "d1"]);
  });

  it("keeps every match ordered while capping full extra days at three", () => {
    const routed = routeTravelQuestion({
      currentDayId: "d14",
      question: "Twelve Apostles、Palm Cove、Barangaroo、QVB、Taronga",
    });

    assert.deepEqual(routed.matchedDayIds, ["d4", "d5", "d10", "d11", "d12", "d14", "d15"]);
    assert.deepEqual(routed.sourceDayIds, ["d14", "d4", "d5", "d10"]);
    assert.deepEqual(routed.matchedDays.map((day) => day.id), ["d4", "d5", "d10"]);
    assert.equal(routed.sourceDayIds.length, 4);
  });

  it("returns one full day plus the compact index for trip questions", () => {
    for (const question of ["全程哪天最累？", "整趟怎么调整？", "整个行程怎么安排？", "所有天里哪天最松？", "哪天最累？", "哪天休息？"]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });
      assert.equal(routed.scope, "trip", question);
      assert.deepEqual(routed.sourceDayIds, ["d14"]);
      assert.equal(routed.currentDay.id, "d14");
      assert.deepEqual(routed.matchedDays, []);
      assert.equal(routed.tripIndex.length, 17);
      assert.equal(routed.tripIndex.some((day) => "facts" in day || "resources" in day), false);
    }
  });

  it("does not route from meal blocks or generic ticket notes", () => {
    const mealOnly = routeTravelQuestion({ currentDayId: "d14", question: "Pho Tùng 怎么走？" });
    const genericTicket = routeTravelQuestion({ currentDayId: "d14", question: "当天无固定票券怎么走？" });

    assert.deepEqual(mealOnly.matchedDayIds, []);
    assert.equal(mealOnly.unmatched, true);
    assert.deepEqual(genericTicket.matchedDayIds, []);
    assert.equal(genericTicket.unmatched, true);
  });

  it("distinguishes an unknown target from ordinary quick prompts", () => {
    const unknown = routeTravelQuestion({ currentDayId: "d14", question: "火星基地怎么走？" });
    assert.equal(unknown.unmatched, true);
    assert.deepEqual(unknown.sourceDayIds, ["d14"]);

    for (const question of [
      "下雨怎么调整？",
      "今天太累可以删什么？",
      "午餐放在哪里最顺？",
      "明天要提前准备什么？",
      "今天怎么走？",
      "今天路线怎么安排？",
      "今天导航顺序是什么？",
    ]) {
      const routed = routeTravelQuestion({ currentDayId: "d14", question });
      assert.equal(routed.unmatched, false, question);
      assert.deepEqual(routed.sourceDayIds, ["d14"], question);
      assert.deepEqual(routed.matchedDayIds, [], question);
    }
  });

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
