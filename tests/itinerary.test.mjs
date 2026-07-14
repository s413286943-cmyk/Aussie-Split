import assert from "node:assert/strict";
import { describe, it } from "node:test";

import itinerary from "../src/data/itinerary.generated.json" with { type: "json" };
import {
  buildDayDocket,
  buildDayTimeline,
  buildTodayCommand,
  collectMapActions,
  collectTodayResources,
  findTodayDay,
  parseMealPlan,
  travelMode,
} from "../src/lib/today.js";
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

  it("uses explicit daily transport, departure, lodging, primary, and ticket controls", () => {
    for (const day of itinerary.days) {
      assert.ok(day.transport, `${day.id} is missing transport`);
      assert.ok(day.leaveBy, `${day.id} is missing leaveBy`);
      assert.ok(day.lodgingResource?.id, `${day.id} is missing lodgingResource`);
      assert.ok(day.primaryResource?.id, `${day.id} is missing primaryResource`);
      assert.ok(day.ticketResource?.id, `${day.id} is missing ticketResource`);
    }

    const d2 = itinerary.days.find((day) => day.id === "d2");
    const d3 = itinerary.days.find((day) => day.id === "d3");
    const d4 = itinerary.days.find((day) => day.id === "d4");
    const d13 = itinerary.days.find((day) => day.id === "d13");
    assert.match(d2.transport, /接驳|团车/);
    assert.match(d2.ticketResource.title, /Puffing Billy/);
    assert.match(d3.transport, /自驾/);
    assert.doesNotMatch(d3.transport, /机场转场/);
    assert.doesNotMatch(d4.leaveBy, /集合/);
    assert.doesNotMatch(d13.leaveBy, /集合/);
  });

  it("links each non-flight lodging to its exact hotel resource", () => {
    for (const day of itinerary.days.filter((item) => !["d0", "d16"].includes(item.id))) {
      assert.equal(day.lodgingResource.title, day.lodging, `${day.id} lodging resource mismatch`);
      assert.equal(day.lodgingResource.type, "map", `${day.id} lodging resource is not a map`);
    }
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

  it("keeps the four fixed stops without replacing D1's QVM night market", () => {
    const expectations = [
      { dayId: "d1", place: /Carlton/, detail: /Lygon Street|Little Italy/, resourceId: "carlton-lygon-map" },
      { dayId: "d2", place: /Fitzroy/, detail: /Brunswick Street|Gertrude Street/, resourceId: "fitzroy-map" },
      { dayId: "d10", place: /Palm Cove/, detail: /棕榈|海滨|Esplanade/, resourceId: "palm-cove-map" },
      { dayId: "d11", place: /Barangaroo Reserve/, detail: /Wulugul Walk|海滨步道/, resourceId: "barangaroo-reserve-map" },
    ];

    for (const expectation of expectations) {
      const day = itinerary.days.find((item) => item.id === expectation.dayId);
      const dayText = [
        day.title,
        day.focus,
        ...day.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`),
      ].join(" ");
      const block = day.blocks.find((item) => expectation.place.test(item.place));

      assert.match(dayText, expectation.detail);
      assert.ok(block, `${expectation.dayId} is missing ${expectation.place}`);
      assert.ok(block.resources.some((resource) => resource.id === expectation.resourceId));
      assert.doesNotMatch(
        `${block.period} ${block.activity} ${block.tip}`,
        /可选|触发|状态好|体力好|如果.*才去/,
      );
    }

    const d1 = itinerary.days.find((day) => day.id === "d1");
    const d1Text = [d1.focus, ...d1.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`)].join(" ");
    assert.match(d1Text, /Carlton/);
    assert.match(d1Text, /QVM Winter Night Market/);
  });

  it("keeps D3 visually before the Twelve Apostles route", () => {
    const d3 = itinerary.days.find((day) => day.id === "d3");
    const d4 = itinerary.days.find((day) => day.id === "d4");

    assert.equal(d3.coverImageUrl, "/itinerary/d3-great-ocean-road-lorne.png");
    assert.notEqual(d3.coverImageUrl, d4.coverImageUrl);
    assert.doesNotMatch(d3.coverImageUrl, /twelve|apostles|gorge/i);
    assert.match(d3.coverImageAlt, /Lorne|Apollo Bay|灯塔|大洋路早段/);
  });

  it("uses the fixed South Coast plan on D13 without Blue Mountains leftovers", () => {
    const d13 = itinerary.days.find((day) => day.id === "d13");
    const d13Text = [
      d13.title,
      d13.focus,
      ...d13.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`),
    ].join(" ");

    assert.equal(d13.coverImageUrl, "/itinerary/d13-south-coast-kiama-gerringong.png");
    assert.match(d13.coverImageAlt, /南海岸|Kiama|Gerringong/);
    assert.match(d13.transport, /自驾/);
    assert.match(d13.primaryResource.title, /Sea Cliff Bridge/);
    assert.match(d13Text, /Kiama/);
    assert.match(d13Text, /Gerringong/);
    assert.match(d13Text, /Kangaroo Valley/);
    assert.match(d13Text, /可选|允许|视时间|判断/);
    assert.doesNotMatch(d13Text, /Blue Mountains|蓝山|Scenic World/i);
  });

  it("uses Taronga and Bondi on D14 without whale-watching leftovers", () => {
    const d14 = itinerary.days.find((day) => day.id === "d14");
    const d14Text = [
      d14.title,
      d14.focus,
      ...d14.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`),
    ].join(" ");

    assert.equal(d14.coverImageUrl, "/itinerary/d14-taronga-bondi.png");
    assert.match(d14.coverImageAlt, /Taronga|Bondi|悉尼港/);
    assert.match(d14.primaryResource.title, /Taronga Zoo/);
    assert.match(d14.ticketResource.title, /Taronga Zoo/);
    assert.match(d14Text, /Taronga Zoo/);
    assert.match(d14Text, /F2|公共渡轮|Ferry/);
    assert.match(d14Text, /Bondi/);
    assert.match(d14Text, /Tamarama/);
    assert.match(d14Text, /Totti/);
    assert.match(d14Text, /18:30/);
    assert.doesNotMatch(d14Text, /Captain Cook|观鲸|whale/i);
  });

  it("does not let a cancelled same-day activity override the D14 Taronga ticket", () => {
    const d14 = itinerary.days.find((day) => day.id === "d14");
    const docket = buildDayDocket(d14, [{
      id: "cancelled-whale-tour",
      category: "活动",
      item: "Captain Cook Whale Watching",
      date: d14.date,
      currency: "AUD",
      amount: 340.2,
      status: "confirmed",
      note: "旧记录",
    }]);
    const ticket = docket.find((item) => item.id === "ticket");

    assert.match(ticket.title, /Taronga Zoo/);
    assert.doesNotMatch(`${ticket.title} ${ticket.detail}`, /Captain Cook|观鲸|whale/i);
  });

  it("keeps Manly optional on D15 before shopping and Cafe Sydney", () => {
    const d15 = itinerary.days.find((day) => day.id === "d15");
    const d15Text = [
      d15.title,
      d15.focus,
      ...d15.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`),
    ].join(" ");

    assert.equal(d15.coverImageUrl, "/itinerary/d15-manly-flex-farewell.png");
    assert.match(d15.coverImageAlt, /Manly|悉尼港|告别/);
    assert.match(d15.transport, /可选/);
    assert.match(d15.primaryResource.title, /QVB/);
    assert.equal(d15.ticketResource.id, "no-fixed-ticket");
    assert.match(d15Text, /Manly/);
    assert.match(d15Text, /状态|体力|可选/);
    assert.match(d15Text, /QVB/);
    assert.match(d15Text, /Chemist Warehouse/);
    assert.match(d15Text, /TRS/);
    assert.match(d15Text, /Cafe Sydney/);
    assert.match(d15Text, /17:30/);
    assert.doesNotMatch(d15Text, /Taronga Zoo/);
  });

  it("keeps Totti's on D14 and Cafe Sydney on D15 in the meal plan", () => {
    const d14Text = itinerary.days.find((day) => day.id === "d14").blocks
      .map((block) => `${block.place} ${block.activity} ${block.tip}`)
      .join(" ");
    const d15Text = itinerary.days.find((day) => day.id === "d15").blocks
      .map((block) => `${block.place} ${block.activity} ${block.tip}`)
      .join(" ");

    assert.match(d14Text, /Totti/);
    assert.match(d14Text, /Bondi/);
    assert.match(d15Text, /Cafe Sydney/);
  });

  it("adds the 2026 QVM Winter Night Market to D1", () => {
    const d1 = itinerary.days.find((day) => day.id === "d1");
    const marketBlock = d1.blocks.find((block) => /QVM Winter Night Market/.test(block.activity));
    const mealBlock = d1.blocks.find((block) => block.period === "饮食" && block.place === "饮食安排");
    const officialResource = marketBlock?.resources.find((resource) => resource.type === "official");

    assert.match(d1.focus, /QVM Winter Night Market/);
    assert.ok(marketBlock);
    assert.match(marketBlock.tip, /17:00-22:00/);
    assert.match(marketBlock.tip, /免费.*免预约/);
    assert.equal(
      officialResource?.url,
      "https://whatson.melbourne.vic.gov.au/things-to-do/winter-night-market",
    );
    assert.match(mealBlock.activity, /QVM Winter Night Market/);
  });

  it("includes a daily meal-map block from D1 through D16", () => {
    for (const dayId of Array.from({ length: 16 }, (_, index) => `d${index + 1}`)) {
      const day = itinerary.days.find((item) => item.id === dayId);
      assert.ok(
        day.blocks.some((block) => block.period === "饮食" && block.place === "饮食安排"),
        `${dayId} is missing daily meal-map block`,
      );
    }
  });

  it("selects the right control-panel day for pre-trip, in-trip, and post-trip dates", () => {
    assert.equal(findTodayDay(itinerary.days, new Date("2026-06-25T10:00:00+08:00")).id, "d0");
    assert.equal(findTodayDay(itinerary.days, new Date("2026-07-31T10:00:00+10:00")).id, "d3");
    assert.equal(findTodayDay(itinerary.days, new Date("2026-08-20T10:00:00+10:00")).id, "d16");
  });

  it("selects the date-aware route mode and current stage", () => {
    const before = travelMode(itinerary.days, itinerary.stages, new Date("2026-07-20T10:00:00+08:00"));
    const during = travelMode(itinerary.days, itinerary.stages, new Date("2026-07-31T10:00:00+10:00"));
    const after = travelMode(itinerary.days, itinerary.stages, new Date("2026-08-20T10:00:00+10:00"));

    assert.equal(before.phase, "before");
    assert.equal(before.currentDay.id, "d0");
    assert.equal(during.phase, "during");
    assert.equal(during.currentDay.id, "d3");
    assert.equal(during.currentStage.id, "melbourne-road");
    assert.equal(during.nextDay.id, "d4");
    assert.equal(after.phase, "after");
    assert.equal(after.currentDay.id, "d16");
    assert.equal(after.nextDay, null);
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

  it("builds a richer today command panel from itinerary data", () => {
    const day = itinerary.days.find((item) => item.id === "d7");
    const command = buildTodayCommand(day);

    assert.match(command.transport, /船|码头/);
    assert.ok(command.leaveBy.length > 0);
    assert.ok(command.meals.dinner.length > 0);
    assert.ok(command.notes.length > 0);
  });

  it("uses explicit controls instead of unrelated first-resource fallbacks", () => {
    const d3 = itinerary.days.find((item) => item.id === "d3");
    const command = buildTodayCommand(d3);
    const docket = buildDayDocket(d3);
    const actions = collectMapActions(d3);

    assert.equal(command.transport, d3.transport);
    assert.equal(command.leaveBy, d3.leaveBy);
    assert.equal(docket.find((item) => item.id === "lodging").href, d3.lodgingResource.url);
    assert.equal(actions.find((item) => item.label === "打开第一站").url, d3.primaryResource.url);
  });

  it("links dinner actions to the dinner plan instead of breakfast or lunch resources", () => {
    const actionsFor = (dayId) => collectMapActions(itinerary.days.find((day) => day.id === dayId));
    assert.equal(actionsFor("d5").some((action) => action.label === "打开晚餐"), false);
    assert.match(actionsFor("d14").find((action) => action.label === "打开晚餐").title, /Totti/);
    assert.match(actionsFor("d15").find((action) => action.label === "打开晚餐").title, /Cafe Sydney/);
    assert.equal(actionsFor("d16").find((action) => action.label === "打开第一站").title, "悉尼机场");
  });

  it("turns each day into timeline, docket, and map actions", () => {
    const day = itinerary.days.find((item) => item.id === "d3");

    assert.ok(buildDayTimeline(day).some((slot) => slot.label === "上午"));
    assert.equal(buildDayDocket(day).length, 3);
    assert.ok(collectMapActions(day).some((action) => action.url.includes("google.com/maps")));
  });

  it("parses daily meal plans into breakfast, lunch, and dinner", () => {
    const meals = parseMealPlan(itinerary.days.find((item) => item.id === "d14"));

    assert.match(meals.dinner, /Totti|Icebergs|Bondi/);
    assert.ok(meals.breakfast.length > 0);
    assert.ok(meals.lunch.length > 0);
  });
});
