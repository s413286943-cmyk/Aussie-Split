import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const expectedTitles = {
  d0: "启程澳洲：香港转机，夜航墨尔本",
  d1: "延误抵达墨尔本：QVM 冬季夜市",
  d2: "墨尔本 City Walk + Puffing Billy + Fitzroy",
  d3: "驶上大洋路：Torquay、Lorne 到 Apollo Bay",
  d4: "红杉林到海岸：The Redwoods、十二使徒岩与 Loch Ard Gorge",
  d5: "海岸地貌到野生动物：大洋路返程日",
  d6: "抵达凯恩斯：Esplanade Lagoon 与热带夜市",
  d7: "奔赴外礁：Reef Magic 大堡礁一日",
  d8: "深入丹翠：雨林、河流与 Cape Tribulation",
  d9: "阿瑟顿高原：火山湖、巨树与瀑布",
  d10: "慢享凯恩斯：Rusty's Market 与 Palm Cove",
  d11: "初到悉尼：Barangaroo、The Rocks 与海港夜景",
  d12: "悉尼经典一日：歌剧院、The Rocks Markets、植物园与 QVB",
  d13: "悉尼南海岸：Sea Cliff Bridge、Kiama 与 Gerringong",
  d14: "动物园到海岸：Taronga、Bondi 与 Totti's",
  d15: "悉尼告别日：可选 Manly、最后采购与 Cafe Sydney",
  d16: "告别澳洲：TRS 退税与返程",
};

const expectedFocus = {
  d0: "经香港转机，夜航前往墨尔本。",
  d1: "15:15 抵达 MEL；入境、进城并入住后，只安排 QVM Winter Night Market，夜市用餐后回酒店休息。",
  d2: "上午完成 Degraves Lane、Flinders Street、Hosier Lane 与 State Library 精华 city walk；11:30–17:00 参加 Puffing Billy + Sassafras 半日团，返城后去 Fitzroy 晚餐。",
  d3: "机场取车后沿海向西，途经 Torquay、Lorne，傍晚住进 Apollo Bay。",
  d4: "先走进 The Redwoods Otways，再回到海岸看十二使徒岩、Loch Ard Gorge 与 The Razorback。",
  d5: "清晨补看海岸，再经 The Grotto、London Arch 与 Great Ocean Road Wildlife Park 走内陆线返回机场。",
  d6: "从墨尔本飞到凯恩斯，下午在 Esplanade Lagoon 放松，晚上逛夜市。",
  d7: "在 Reef Magic 外礁平台体验浮潜、半潜艇与大堡礁海上风景。",
  d8: "沿丹翠河进入雨林，在 Cape Tribulation 看雨林与海相接。",
  d9: "自驾串联 Lake Eacham、Curtain Fig Tree、高原小镇与瀑布。",
  d10: "上午逛 Rusty's Market，午后休整，傍晚去 Palm Cove 看海。",
  d11: "飞抵悉尼后休息片刻，沿 Barangaroo、The Rocks 走到 Circular Quay 夜景。",
  d12: "从歌剧院中文导览出发，逛 The Rocks Markets，再沿植物园走到经典海港机位与 QVB。",
  d13: "沿 Grand Pacific Drive 南下，经过 Sea Cliff Bridge、Kiama 与 Gerringong，视情况延伸袋鼠谷。",
  d14: "搭渡轮看 Taronga 的澳洲动物，下午走 Bondi 海岸，晚上在 Totti's 用餐。",
  d15: "上午悠闲安排 Manly 或 CBD，下午采购并整理行李，傍晚在 Cafe Sydney 告别。",
  d16: "完成 TRS 与机场手续，带着旅程回家。",
};

const itineraryUiSource = readFileSync(
  new URL("../src/components/ItineraryApp.jsx", import.meta.url),
  "utf8",
);

describe("itinerary data", () => {
  it("imports D0 through D16 from the Excel workbook", () => {
    const imported = readWorkbook();

    assert.equal(imported.days.length, 17);
    assert.equal(imported.days[0].id, "d0");
    assert.equal(imported.days[0].date, "2026-07-28");
    assert.equal(imported.days[16].id, "d16");
    assert.equal(imported.days[16].date, "2026-08-13");
  });

  it("keeps every day-card focus to the approved rhythm sentence", () => {
    for (const day of itinerary.days) {
      assert.equal(day.focus, expectedFocus[day.id], `${day.id} focus is not concise`);
    }
  });

  it("uses one traveller-facing title style across D0 through D16", () => {
    for (const day of itinerary.days) {
      assert.equal(day.title, expectedTitles[day.id], `${day.id} title is not traveller-facing`);
      assert.doesNotMatch(day.title, /Road Trip Day\s*\d+/i);
    }
  });

  it("uses half-width apostrophes inside English names", () => {
    assert.doesNotMatch(
      JSON.stringify(itinerary),
      /[A-Za-z][‘’][A-Za-z]/,
      "English names still contain full-width curly apostrophes",
    );
  });

  it("keeps planning-revision language out of traveller-facing card copy", () => {
    const revisionLanguage = /固定站点|固定步行|先删|仍作为|不再另排|路线已确定|不增加收费项目|不再叠加|不再加|主采购点|补偿日|状态触发项|升级餐厅|不折腾/;

    for (const day of itinerary.days) {
      const cardCopy = [
        day.title,
        day.focus,
        day.clothingNote,
        ...day.blocks.flatMap((block) => [block.activity, block.highlight, block.tip]),
      ].filter(Boolean).join(" ");

      assert.doesNotMatch(cardCopy, revisionLanguage, `${day.id} still uses planning-revision language`);
    }
  });

  it("labels the overview with traveller-facing language", () => {
    assert.match(itineraryUiSource, />路线速览</);
    assert.match(itineraryUiSource, /先看 \$\{keyStops\.length\} 个重点/);
    assert.match(itineraryUiSource, /地图与官网入口/);
    assert.match(itineraryUiSource, />餐食建议</);
    assert.doesNotMatch(itineraryUiSource, />路书重点|快捷链接/);
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

  it("keeps the rescheduled city stops and D1's QVM night market", () => {
    const expectations = [
      { dayId: "d2", place: /State Library/, detail: /La Trobe|圆顶|六楼/, resourceId: "state-library-map" },
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
    assert.match(d1Text, /QVM Winter Night Market/);
    assert.doesNotMatch(d1Text, /Carlton|Point Ormond|State Library|Hosier Lane|Degraves Street/);
  });

  it("keeps Fitzroy as D2's fixed post-tour stop", () => {
    const d2 = itinerary.days.find((day) => day.id === "d2");
    const fitzroy = d2.blocks.find((block) => /Fitzroy/.test(block.place));

    assert.match(d2.title, /Fitzroy/);
    assert.ok(fitzroy, "D2 is missing Fitzroy");
    assert.doesNotMatch(fitzroy.period, /备选|可选/);
    assert.match(`${fitzroy.period} ${fitzroy.activity} ${fitzroy.tip}`, /17:15|晚餐|直接/);
    assert.ok(fitzroy.resources.some((resource) => resource.id === "fitzroy-map"));
  });

  it("replaces D1's city plan with the delayed arrival and QVM night market", () => {
    const d1 = itinerary.days.find((day) => day.id === "d1");
    const arrival = d1.blocks.find((block) => /墨尔本机场/.test(block.place));
    const qvm = d1.blocks.find((block) => /Queen Victoria Market/.test(block.place));
    const d1Text = [d1.title, d1.focus, d1.leaveBy, ...d1.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`)].join(" ");

    assert.ok(arrival, "D1 is missing the delayed MEL arrival");
    assert.ok(qvm, "D1 is missing QVM");
    assert.match(d1Text, /15:15/);
    assert.ok(arrival.sortOrder < qvm.sortOrder);
    assert.doesNotMatch(d1Text, /Point Ormond|Carlton|State Library|Hosier Lane|Degraves Street/);
  });

  it("keeps the ranked Top 7 mapped to their itinerary days", () => {
    assert.deepEqual(
      itinerary.priorities.map(({ rank, dayId, title, status }) => ({ rank, dayId, title, status })),
      [
        { rank: 1, dayId: "d1", title: "QVM Winter Night Market", status: "必去" },
        { rank: 2, dayId: "d4", title: "The Redwoods Otways", status: "必去" },
        { rank: 3, dayId: "d2", title: "Fitzroy", status: "必去" },
        { rank: 4, dayId: "d10", title: "Palm Cove", status: "必去" },
        { rank: 5, dayId: "d11", title: "Barangaroo Reserve", status: "必去" },
        { rank: 6, dayId: "d12", title: "The Rocks Markets", status: "必去" },
        { rank: 7, dayId: "d4", title: "The Razorback", status: "必去" },
      ],
    );

    for (const priority of itinerary.priorities) {
      const day = itinerary.days.find((item) => item.id === priority.dayId);
      assert.ok(day, `unknown priority day ${priority.dayId}`);
      assert.ok(
        day.blocks.some((block) => block.resources.some((resource) => resource.id === priority.resource.id)),
        `${priority.title} is not represented in ${priority.dayId}`,
      );
    }
  });

  it("runs D4 through The Redwoods and The Razorback in route order", () => {
    const d4 = itinerary.days.find((day) => day.id === "d4");
    const redwoods = d4.blocks.find((block) => /The Redwoods/.test(block.place));
    const apostles = d4.blocks.find((block) => /Twelve Apostles/.test(block.place));
    const lochArd = d4.blocks.find((block) => block.place === "Loch Ard Gorge");
    const razorback = d4.blocks.find((block) => /The Razorback/.test(block.place));
    const portCampbell = d4.blocks.find((block) => block.place === "Port Campbell");
    const dinner = d4.blocks.find((block) => block.period === "晚上");

    assert.equal(d4.primaryResource.id, "redwoods-otways-map");
    assert.equal(new Set(d4.blocks.map((block) => block.sortOrder)).size, d4.blocks.length);
    assert.ok(redwoods, "D4 is missing The Redwoods Otways");
    assert.ok(razorback, "D4 is missing The Razorback");
    assert.ok(redwoods.sortOrder < apostles.sortOrder);
    assert.ok(apostles.sortOrder < lochArd.sortOrder);
    assert.ok(lochArd.sortOrder < razorback.sortOrder);
    assert.ok(razorback.sortOrder < portCampbell.sortOrder);
    assert.equal(dinner.sortOrder, 80);
    assert.match(`${razorback.activity} ${razorback.tip}`, /Loch Ard Gorge|同一景区|步行/);
  });

  it("routes D5 through Great Ocean Road Wildlife Park instead of Bay of Islands", () => {
    const d5 = itinerary.days.find((day) => day.id === "d5");
    const grotto = d5.blocks.find((block) => block.place === "The Grotto");
    const londonArch = d5.blocks.find((block) => /London (Arch|Bridge)/.test(block.place));
    const wildlifePark = d5.blocks.find((block) => block.place === "Great Ocean Road Wildlife Park");
    const colac = d5.blocks.find((block) => block.place === "Colac");
    const d5Text = d5.blocks
      .map((block) => `${block.place} ${block.activity} ${block.tip}`)
      .join(" ");

    assert.ok(grotto, "D5 is missing The Grotto");
    assert.ok(londonArch, "D5 is missing London Arch");
    assert.ok(wildlifePark, "D5 is missing Great Ocean Road Wildlife Park");
    assert.ok(colac, "D5 is missing Colac");
    assert.ok(grotto.sortOrder < londonArch.sortOrder);
    assert.ok(londonArch.sortOrder < wildlifePark.sortOrder);
    assert.ok(wildlifePark.sortOrder < colac.sortOrder);
    assert.equal(d5.primaryResource.id, "great-ocean-road-wildlife-park-map");
    assert.equal(d5.ticketResource.id, "great-ocean-road-wildlife-park-booking");
    assert.equal(d5.ticketResource.type, "booking");
    assert.match(`${wildlifePark.activity} ${wildlifePark.tip}`, /60-75|饲料|另付费/);
    assert.ok(
      wildlifePark.resources.some((resource) => resource.id === "great-ocean-road-wildlife-park-official"),
    );
    assert.doesNotMatch(d5Text, /Bay of Islands/);
  });

  it("keeps the ranked list out of the route overview", () => {
    assert.doesNotMatch(itineraryUiSource, />旅程 Top 7</);
    assert.doesNotMatch(itineraryUiSource, /priorities\.map/);
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

    assert.match(d1.focus, /QVM (?:冬季夜市|Winter Night Market)/);
    assert.ok(marketBlock);
    assert.match(marketBlock.tip, /17:00[–-]22:00/);
    assert.match(marketBlock.tip, /免费.*免预约/);
    assert.equal(
      officialResource?.url,
      "https://whatson.melbourne.vic.gov.au/things-to-do/winter-night-market",
    );
    assert.match(mealBlock.activity, /QVM Winter Night Market/);
  });

  it("adds The Rocks Markets after the D12 Opera House tour", () => {
    const d12 = itinerary.days.find((day) => day.id === "d12");
    const tourIndex = d12.blocks.findIndex((block) => /中文内部导览/.test(block.activity));
    const walkIndex = d12.blocks.findIndex((block) => /Opera House → The Rocks/.test(block.place));
    const marketIndex = d12.blocks.findIndex((block) => block.place === "The Rocks Markets");
    const marketBlock = d12.blocks[marketIndex];
    const mealBlock = d12.blocks.find((block) => block.period === "饮食" && block.place === "饮食安排");
    const officialResource = marketBlock?.resources.find((resource) => resource.type === "official");

    assert.match(d12.title, /The Rocks Markets/);
    assert.match(d12.focus, /The Rocks Markets/);
    assert.equal(walkIndex, tourIndex + 1);
    assert.equal(marketIndex, walkIndex + 1);
    assert.match(d12.blocks[walkIndex].activity, /导览结束后.*步行前往/);
    assert.match(marketBlock.tip, /10:00–17:00/);
    assert.match(marketBlock.tip, /45–60 分钟/);
    assert.match(marketBlock.highlight, /悉尼老城区/);
    assert.match(marketBlock.highlight, /手作市集/);
    assert.match(marketBlock.highlight, /Harbour Bridge/);
    assert.match(marketBlock.highlight, /本地周末氛围/);
    assert.equal(
      officialResource?.url,
      "https://therocks.com/whats-on/market-overview",
    );
    assert.match(mealBlock.activity, /The Rocks Markets/);
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
    assert.ok(resources.some((resource) => resource.type === "official"));
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
