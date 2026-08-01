import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  d1: "初到墨尔本：QVM 冬季夜市",
  d2: "从城市巷弄到山林：Puffing Billy 与 Fitzroy",
  d3: "驶上大洋路：从 Torquay 海岸到 Apollo Bay",
  d4: "从雨林走向海岸：The Redwoods、十二使徒岩与 Loch Ard Gorge",
  d5: "晨光中的海岸：十二使徒岩、Loch Ard Gorge 与野生动物",
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
  d1: "下午抵达墨尔本，入住稍作休整，晚上在 QVM Winter Night Market 边逛边吃，轻松开启南半球旅程。",
  d2: "上午走过 Degraves Street、Flinders Street 与 Hosier Lane，在州立图书馆俯瞰圆顶阅览室；午后乘 Puffing Billy 穿行山林，返城后去 Fitzroy 散步吃晚餐。",
  d3: "把大箱寄存在机场，取车后到 Torquay 买好今晚的 BBQ 食材，再沿海经过 Bells Beach、Lorne 与 Kennett River，傍晚抵达 Apollo Bay。",
  d4: "上午从 Apollo Bay 补给出发，走进 Maits Rest 与 The Redwoods；下午回到 Gibson Steps、十二使徒岩和 Loch Ard Gorge 的海岸线，傍晚在 Port Campbell 收住这一天。",
  d5: "清晨沿十二使徒岩、Gibson Steps 与 Loch Ard Gorge 追着晨光看海岸，回别墅早餐退房后去 Wildlife Park，午后经 Colac 返回墨尔本机场。",
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

  it("keeps D1 and D2 in a traveller-facing voice", () => {
    const backstageLanguage = /延误抵达|航班延误|减少延误|只安排|按时间收口|硬截止|已确认团期|完整团期|团内节点|直接转场|服从团内节奏|集中放到 D\d+|给 D\d+|为 D\d+/;
    const copy = itinerary.days
      .filter((day) => ["d1", "d2"].includes(day.id))
      .flatMap((day) => [
        day.title,
        day.focus,
        day.transport,
        day.leaveBy,
        ...day.blocks.flatMap((block) => [block.activity, block.highlight, block.tip]),
      ])
      .filter(Boolean)
      .join(" ");

    assert.doesNotMatch(copy, backstageLanguage);
    assert.match(copy, /南半球旅程正式开始/);
    assert.match(copy, /从山林切换到墨尔本街区夜色/);
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

  it("keeps D1 focused on the afternoon arrival and QVM night market", () => {
    const d1 = itinerary.days.find((day) => day.id === "d1");
    const arrival = d1.blocks.find((block) => /墨尔本机场/.test(block.place));
    const qvm = d1.blocks.find((block) => /Queen Victoria Market/.test(block.place));
    const d1Text = [d1.title, d1.focus, d1.leaveBy, ...d1.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`)].join(" ");

    assert.ok(arrival, "D1 is missing the MEL arrival");
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

  it("runs D3 from luggage storage and car pickup through Torquay to Apollo Bay", () => {
    const d3 = itinerary.days.find((day) => day.id === "d3");
    const route = [
      { place: /Oaks Melbourne on Market/, time: "08:00", resourceId: "oaks-market-map" },
      { place: /Holiday Inn Melbourne Airport/, time: "08:40", resourceId: "holiday-inn-airport-map" },
      { place: /Melbourne Airport Car Rental Branch/, time: "08:40–09:30", resourceId: "mel-airport-car-rental-map" },
      { place: /Coles Torquay/, time: "10:45", resourceId: "coles-torquay-map" },
      { place: /Bells Beach/, time: "11:20", resourceId: "bells-map" },
      { place: /Split Point Lighthouse/, time: "12:00", resourceId: "split-point-map" },
      { place: /Great Ocean Road Memorial Arch/, time: "12:40", resourceId: "memorial-arch-map" },
      { place: /^Lorne$/, time: "13:00", resourceId: "lorne-map" },
      { place: /Teddy's Lookout/, time: "14:15", resourceId: "teddys-map" },
      { place: /Kennett River \/ Grey River Road/, time: "15:30", resourceId: "grey-river-road-map" },
      { place: /Cape Patton Lookout/, time: "16:15", resourceId: "cape-patton-map" },
      { place: /Seaview Motel & Apartments/, time: "17:00", resourceId: "seaview-motel-map" },
    ];

    const blocks = route.map(({ place, time, resourceId }) => {
      const block = d3.blocks.find((item) => place.test(item.place));
      assert.ok(block, `D3 is missing ${place}`);
      assert.match(block.period, new RegExp(time));
      assert.ok(block.resources.some((resource) => resource.id === resourceId));
      return block;
    });

    assert.deepEqual(blocks.map((block) => block.sortOrder), [...blocks.map((block) => block.sortOrder)].sort((a, b) => a - b));
    assert.equal(d3.city, "墨尔本 CBD → 墨尔本机场 → Apollo Bay");
    assert.equal(d3.transport, "Uber / Taxi 到机场 · 取车后自驾");
    assert.equal(d3.leaveBy, "08:00 从 Oaks 退房出发；09:30 从机场启程驶向 Torquay");
    assert.equal(d3.primaryResource.id, "holiday-inn-airport-map");

    const holidayInn = blocks[1];
    const rental = blocks[2];
    const coles = blocks[3];
    const splitPoint = blocks[5];
    const lorne = blocks[7];
    const kennettRiver = blocks[9];
    const dinner = d3.blocks.find((block) => block.period === "晚上");
    const d3Text = d3.blocks.map((block) => `${block.place} ${block.activity} ${block.highlight} ${block.tip}`).join(" ");

    assert.match(`${holidayInn.activity} ${holidayInn.tip}`, /4 个大箱|四个大箱/);
    assert.match(`${rental.activity} ${rental.tip}`, /车身划痕|轮毂|挡风玻璃|油量|Google Maps|右舵/);
    assert.match(`${coles.activity} ${coles.highlight} ${coles.tip}`, /BBQ|牛排|香肠|蔬菜|饮料/);
    assert.match(`${splitPoint.activity} ${splitPoint.highlight}`, /Eagle Rock/);
    assert.match(`${lorne.activity} ${lorne.tip}`, /午餐|海边|咖啡/);
    assert.match(`${kennettRiver.activity} ${kennettRiver.tip}`, /树冠|不喂/);
    assert.ok(dinner, "D3 is missing its BBQ dinner");
    assert.match(`${dinner.place} ${dinner.activity} ${dinner.highlight} ${dinner.tip}`, /Seaview Motel|BBQ/);
    assert.doesNotMatch(d3Text, /Marriners Lookout|Fishermen's Co-op/);
    assert.doesNotMatch(d3Text, /优先保留|可缩|时间目标|路线逻辑|开发|调整为|预计到达/);

    const d2 = itinerary.days.find((day) => day.id === "d2");
    const d2Text = d2.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`).join(" ");
    assert.match(d2Text, /第二天一起带到机场/);
    assert.doesNotMatch(d2Text, /四个大箱留在酒店/);
  });

  it("runs the complete traveller-facing D4 route with a Google Maps entry at every site", () => {
    const d4 = itinerary.days.find((day) => day.id === "d4");
    const routeBlocks = d4.blocks.filter((block) => block.period !== "饮食");
    const expectedPlaces = [
      "Seaview Motel & Apartments",
      "Apollo Bay 镇中心补给",
      "Maits Rest Rainforest Walk",
      "The Redwoods Otways",
      "Castle Cove Lookout",
      "Gibson Steps",
      "Twelve Apostles",
      "Loch Ard Gorge",
      "Tom and Eva Lookout",
      "The Razorback Lookout",
      "Port Campbell Foreshore",
      "Southern Ocean Villas",
      "Port Campbell 晚餐",
    ];

    assert.equal(d4.primaryResource.id, "d4-full-route-map");
    assert.match(d4.primaryResource.url, /google\.com\/maps\/dir/);
    assert.equal(new Set(d4.blocks.map((block) => block.sortOrder)).size, d4.blocks.length);
    assert.deepEqual(routeBlocks.map((block) => block.place), expectedPlaces);

    for (const block of routeBlocks) {
      assert.ok(
        block.resources.some((resource) =>
          resource.type === "map" && /google\.com\/maps/.test(resource.url),
        ),
        `${block.place} is missing a direct Google Maps entry`,
      );
    }

    const redwoods = routeBlocks.find((block) => block.place === "The Redwoods Otways");
    const lochArd = routeBlocks.find((block) => block.place === "Loch Ard Gorge");
    const razorback = routeBlocks.find((block) => block.place === "The Razorback Lookout");
    const dinner = routeBlocks.find((block) => block.place === "Port Campbell 晚餐");
    const d4Text = d4.blocks
      .map((block) => `${block.place} ${block.activity} ${block.highlight} ${block.tip}`)
      .join(" ");

    assert.match(`${redwoods.activity} ${redwoods.tip}`, /09:15|Castle Cove|下午/);
    assert.match(`${lochArd.activity} ${lochArd.tip}`, /台阶|关闭|上方|崖顶/);
    assert.match(`${razorback.activity} ${razorback.tip}`, /Loch Ard Gorge|同一景区|步行/);
    assert.match(`${dinner.activity} ${dinner.tip}`, /Port Campbell Hotel|12 Rocks|REAL Pizza|Sow & Piglets|18:30/);
    assert.doesNotMatch(d4Text, /删减顺序|优先保留|可缩|执行规则|开发|调整为|版本/);
  });

  it("keeps D6 through D16 byte-for-byte stable while D5 changes", () => {
    const laterDays = itinerary.days.filter((day) => Number(day.id.slice(1)) >= 6);
    const digest = createHash("sha256").update(JSON.stringify(laterDays)).digest("hex");

    assert.equal(digest, "a36c344778d7f482d69fa3417261d4cec6309601a2c4292a0c4d771bc607b12c");
  });

  it("runs the complete D5 sunrise loop and airport return with direct Google Maps entries", () => {
    const d5 = itinerary.days.find((day) => day.id === "d5");
    const routeBlocks = d5.blocks.filter((block) => block.period !== "饮食");
    const expectedPlaces = [
      "Southern Ocean Villas",
      "Twelve Apostles",
      "Gibson Steps",
      "Loch Ard Gorge",
      "Tom and Eva Lookout",
      "The Razorback Lookout",
      "London Arch",
      "The Grotto",
      "Southern Ocean Villas",
      "Great Ocean Road Wildlife Park",
      "Colac",
      "Holiday Inn Melbourne Airport",
    ];
    const d5Text = d5.blocks
      .map((block) => `${block.place} ${block.activity} ${block.highlight} ${block.tip}`)
      .join(" ");

    assert.deepEqual(routeBlocks.map((block) => block.place), expectedPlaces);
    assert.equal(d5.primaryResource.id, "d5-sunrise-route-map");
    assert.match(d5.primaryResource.url, /google\.com\/maps\/dir/);
    assert.equal(d5.ticketResource.id, "great-ocean-road-wildlife-park-booking");
    assert.equal(d5.ticketResource.type, "booking");
    assert.match(d5.leaveBy, /06:45|13:30|14:30/);

    for (const block of routeBlocks) {
      assert.ok(
        block.resources.some((resource) =>
          resource.type === "map" && /google\.com\/maps/.test(resource.url),
        ),
        `${block.place} is missing a direct Google Maps entry`,
      );
    }

    const lochArd = routeBlocks.find((block) => block.place === "Loch Ard Gorge");
    const wildlifePark = routeBlocks.find((block) => block.place === "Great Ocean Road Wildlife Park");
    const colac = routeBlocks.find((block) => block.place === "Colac");
    const returnToVilla = routeBlocks.filter((block) => block.place === "Southern Ocean Villas")[1];

    assert.match(`${lochArd.activity} ${lochArd.tip}`, /台阶|关闭|上方|崖顶/);
    assert.match(`${returnToVilla.activity} ${returnToVilla.tip}`, /早餐|退房/);
    assert.match(`${wildlifePark.activity} ${wildlifePark.tip}`, /45–60|75–90|饲料|另付费/);
    assert.match(`${colac.activity} ${colac.tip}`, /午餐|加油|14:00|14:30/);
    assert.ok(
      wildlifePark.resources.some((resource) => resource.id === "great-ocean-road-wildlife-park-official"),
    );
    assert.ok(
      routeBlocks.slice(8).some((block) =>
        block.resources.some((resource) => resource.id === "d5-return-route-map"),
      ),
      "D5 is missing the direct return route to Melbourne Airport",
    );
    assert.ok(
      routeBlocks.slice(3, 9).some((block) =>
        block.resources.some((resource) => resource.id === "d5-west-coast-loop-route-map"),
      ),
      "D5 is missing the direct western coast loop back to the villa",
    );
    assert.doesNotMatch(d5Text, /Bay of Islands|Timboon|补拍备选|只选一处|执行规则|优先保留|可缩|开发|调整为|版本/);
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
