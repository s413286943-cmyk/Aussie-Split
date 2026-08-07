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
  d6: "初到凯恩斯：热带花园、海滨与夜市",
  d7: "奔赴外礁：Reef Magic 大堡礁一日",
  d8: "深入丹翠：雨林、河流与 Cape Tribulation",
  d9: "从雨林小镇到高原瀑布：Kuranda、Skybury 与 Millaa Millaa",
  d10: "慢享凯恩斯：Rusty's Market 与 Palm Cove",
  d11: "从热带飞抵海港：Barangaroo、The Rocks 与 Circular Quay",
  d12: "海港晨光与城市经典：Mrs Macquarie's Chair、歌剧院与 QVB",
  d13: "动物园与海岸：Taronga、Bondi 与 Totti's",
  d14: "南海岸环线：Sea Cliff Bridge、Kiama 与 Kangaroo Valley",
  d15: "悉尼告别日：Bondi 补位、Manly 备选与 Cafe Sydney",
  d16: "告别澳洲：TRS 退税与返程",
};

const expectedFocus = {
  d0: "经香港转机，夜航前往墨尔本。",
  d1: "下午抵达墨尔本，入住稍作休整，晚上在 QVM Winter Night Market 边逛边吃，轻松开启南半球旅程。",
  d2: "上午走过 Degraves Street、Flinders Street 与 Hosier Lane，在州立图书馆俯瞰圆顶阅览室；午后乘 Puffing Billy 穿行山林，返城后去 Fitzroy 散步吃晚餐。",
  d3: "把大箱寄存在机场，取车后到 Torquay 买好今晚的 BBQ 食材，再沿海经过 Bells Beach、Lorne 与 Kennett River，傍晚抵达 Apollo Bay。",
  d4: "上午从 Apollo Bay 补给出发，走进 Maits Rest 与 The Redwoods；下午回到 Gibson Steps、十二使徒岩和 Loch Ard Gorge 的海岸线，傍晚在 Port Campbell 收住这一天。",
  d5: "清晨沿十二使徒岩、Gibson Steps 与 Loch Ard Gorge 追着晨光看海岸，回别墅早餐退房后去 Wildlife Park，午后经 Colac 返回墨尔本机场。",
  d6: "早班机抵达凯恩斯后先寄存行李与休息，午后视体力走进热带花园，再沿 Esplanade 到 Marina，晚上在 Night Markets 边逛边吃。",
  d7: "在 Reef Magic 外礁平台体验浮潜、半潜艇与大堡礁海上风景，返港后到码头边吃一顿海鲜晚餐。",
  d8: "清晨从酒店出发，沿丹翠河进入雨林，在 Cape Tribulation 看雨林与海相接，傍晚回城后简单用餐。",
  d9: "从 Cairns 沿 Kuranda Range 北上，经过 Kuranda 与 Mareeba，在 Skybury 看咖啡园景并享用早午餐；下午走过 Lake Eacham、Yungaburra 与 Curtain Fig Tree，最后以 Millaa Millaa Falls 收尾。",
  d10: "上午逛 Rusty's Market，午间回酒店洗衣打包，下午沿 Palm Cove 海滨与 Jetty 散步，在蓝调时刻用一顿早晚餐收尾。",
  d11: "清晨从凯恩斯飞抵悉尼，午后充分休息，再沿 Barangaroo 与 Wulugul Walk 走进 The Rocks，在 Circular Quay 看日落与蓝调。",
  d12: "清晨先到 Mrs Macquarie's Chair 拍下歌剧院与海港桥同框，再穿过皇家植物园参加 09:30 中文导览，午后在 QVB 与 CBD 从容逛街。",
  d13: "上午搭 F2 渡轮前往 Taronga；下午视天气直接前往 Bondi，若风雨仍大则回酒店休息，17:30 到 Totti's Bondi 用餐。",
  d14: "08:00 取车后沿海岸南下，经过 Bald Hill、Sea Cliff Bridge、Kiama 与 Werri Beach，再由 Kangaroo Valley 内陆返回悉尼。",
  d15: "若 8/10 未完成 Bondi，上午优先补走 Bondi；若已完成且天气与体力都好，再选 Manly，否则留在 CBD 慢慢收尾。下午采购、整理 TRS，17:30 在 Cafe Sydney 告别。",
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
        { rank: 5, dayId: "d11", title: "Barangaroo 至 Circular Quay 海港步行", status: "必去" },
        { rank: 6, dayId: "d12", title: "Mrs Macquarie's Chair + 歌剧院中文导览", status: "必去" },
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

  it("keeps unaffected days stable during the D11-D15 Sydney update", () => {
    const unchangedDays = itinerary.days.filter((day) => !["d9", "d11", "d12", "d13", "d14", "d15"].includes(day.id));
    const overview = {
      trip: itinerary.trip,
      stages: itinerary.stages,
      priorities: itinerary.priorities.filter((priority) => !["d11", "d12"].includes(priority.dayId)),
    };

    assert.equal(
      createHash("sha256").update(JSON.stringify(unchangedDays)).digest("hex"),
      "25ec30b7f916a7dc85f9e808e7b0c22aa2979e7b5bc1ca284274c0d615d47035",
    );
    assert.equal(
      createHash("sha256").update(JSON.stringify(overview)).digest("hex"),
      "9dafa8bab31098b004dca08d125128b7becf54f8c725072bbd4917d094678377",
    );
  });

  it("updates D6 for the Lagoon closure and a relaxed Cairns arrival", () => {
    const d6 = itinerary.days.find((day) => day.id === "d6");
    const d6Text = [d6.title, d6.focus, d6.leaveBy, ...d6.blocks.flatMap((block) => [block.period, block.place, block.activity, block.highlight, block.tip])].join(" ");
    assert.match(d6Text, /06:25/);
    assert.match(d6Text, /09:50/);
    assert.match(d6Text, /Cairns Botanic Gardens/);
    assert.match(d6Text, /Esplanade Boardwalk/);
    assert.match(d6Text, /Marina/);
    assert.match(d6Text, /Night Markets/);
    assert.match(d6Text, /7 月 13 日至 8 月 16 日.*维护关闭/);
    assert.doesNotMatch(d6Text, /免费泻湖泳池|Esplanade Lagoon 放松/);
    const resourceIds = new Set(d6.blocks.flatMap((block) => block.resources.map((resource) => resource.id)));
    for (const resourceId of ["cairns-lagoon-closure-official", "cairns-botanic-gardens-map", "cairns-esplanade-boardwalk-map"]) {
      assert.ok(resourceIds.has(resourceId), `d6 is missing ${resourceId}`);
    }
  });

  it("uses the official Reef Magic timetable on D7", () => {
    const d7 = itinerary.days.find((day) => day.id === "d7");
    const d7Text = [d7.focus, d7.leaveBy, ...d7.blocks.flatMap((block) => [block.period, block.place, block.activity, block.tip])].join(" ");
    assert.match(d7Text, /08:15/);
    assert.match(d7Text, /08:45/);
    assert.match(d7Text, /09:00/);
    assert.match(d7Text, /10:30/);
    assert.match(d7Text, /15:30/);
    assert.match(d7Text, /17:00/);
    assert.match(d7Text, /Prawn Star/);
    assert.match(d7Text, /Salt House/);
    assert.ok(
      d7.blocks.some((block) => block.resources.some((resource) => resource.id === "reef-magic-schedule-official")),
    );
  });

  it("keeps the booked Billy Tea pickup and an easy D8 evening", () => {
    const d8 = itinerary.days.find((day) => day.id === "d8");
    const d8Text = [d8.focus, d8.leaveBy, ...d8.blocks.flatMap((block) => [block.period, block.place, block.activity, block.tip])].join(" ");
    assert.match(d8Text, /06:55/);
    assert.match(d8Text, /18:30/);
    assert.match(d8Text, /Daintree River Cruise/);
    assert.match(d8Text, /Cape Tribulation/);
    assert.match(d8Text, /冰淇淋/);
    assert.match(d8Text, /酒店附近简餐|Night Markets 外带/);
    assert.ok(
      d8.blocks.some((block) => block.resources.some((resource) => resource.id === "billy-tea-official")),
    );
  });

  it("gives D9 an executable Kuranda, Skybury, and Atherton Tablelands timeline", () => {
    const d9 = itinerary.days.find((day) => day.id === "d9");
    const d9Places = d9.blocks.filter((block) => block.period !== "饮食").map((block) => block.place);
    assert.deepEqual(d9Places, [
      "Southern Cross Atrium Apartments",
      "凯恩斯取车点",
      "Cairns → Kuranda Village",
      "Kuranda Village",
      "Kuranda → Mareeba",
      "Mareeba",
      "Mareeba → Skybury",
      "Skybury Cafe & Roastery",
      "Skybury → Lake Eacham",
      "Lake Eacham Day Use Area",
      "Lake Eacham → Yungaburra",
      "Yungaburra Village",
      "Yungaburra → Curtain Fig Tree",
      "Curtain Fig Tree",
      "Curtain Fig Tree → Millaa Millaa",
      "Millaa Millaa Public Toilets",
      "Millaa Millaa Falls",
      "返回 Cairns / 凯恩斯还车点",
    ]);
    assert.equal(d9.primaryResource.id, "d9-core-route-map");
    assert.match(d9.transport, /约 285 km/);
    assert.match(d9.leaveBy, /08:00.*11:30.*15:35/);
    assert.match(d9.blocks.find((block) => block.place === "Skybury Cafe & Roastery").period, /10:20–11:30/);
    assert.match(d9.blocks.find((block) => block.place === "Mareeba").tip, /短停|20 分钟/);
    assert.match(d9.blocks.find((block) => block.place === "Millaa Millaa Public Toilets").tip, /瀑布.*厕所.*关闭|厕所.*关闭/);
    assert.match(d9.blocks.find((block) => block.place === "Millaa Millaa Falls").tip, /施工|停车/);
    assert.match(d9.blocks.find((block) => /还车点/.test(block.place)).period, /15:35–18:00/);
    const resourceIds = new Set(d9.blocks.flatMap((block) => block.resources.map((resource) => resource.id)));
    for (const resourceId of [
      "d9-core-route-map",
      "d9-north-route-map",
      "d9-highlands-route-map",
      "kuranda-village-map",
      "mareeba-town-map",
      "skybury-map",
      "skybury-official",
      "lake-eacham-day-use-map",
      "yungaburra-village-map",
      "curtain-fig-map",
      "millaa-public-toilets-map",
      "millaa-map",
      "d9-return-from-millaa-map",
    ]) {
      assert.ok(resourceIds.has(resourceId), `d9 is missing ${resourceId}`);
    }
    for (const block of d9.blocks.filter((block) => block.period !== "饮食")) {
      assert.ok(
        block.resources.some((resource) => resource.type === "map" && /google\.com\/maps/.test(resource.url)),
        `${block.place} is missing a direct Google Maps entry`,
      );
    }
    const d9Text = [d9.title, d9.focus, d9.transport, d9.leaveBy, ...d9.blocks.flatMap((block) => [block.activity, block.highlight, block.tip])].join(" ");
    assert.match(d9Text, /约 5 小时/);
    assert.match(d9Text, /9\.5–10 小时/);
    assert.doesNotMatch(d9Text, /Gallo Dairyland|Platypus Viewing Platform|Ellinjaa Falls|Skyberry/);
    assert.doesNotMatch(d9Text, /硬节点|硬目标|执行原则|直接取消|落后时|先删|不删|D9.*成立|开发|版本/);
  });

  it("uses D10 for Rusty's Market, packing, and Palm Cove", () => {
    const d10 = itinerary.days.find((day) => day.id === "d10");
    const d10Text = [d10.focus, d10.leaveBy, ...d10.blocks.flatMap((block) => [block.period, block.place, block.activity, block.highlight, block.tip])].join(" ");
    assert.match(d10Text, /08:30–10:30/);
    assert.match(d10Text, /10:45–14:30/);
    assert.match(d10Text, /15:00/);
    assert.match(d10Text, /15:40–17:30/);
    assert.match(d10Text, /17:30–18:45/);
    assert.match(d10Text, /19:30–19:45/);
    assert.match(d10Text, /Williams Esplanade/);
    assert.match(d10Text, /Palm Cove Jetty/);
    assert.match(d10Text, /行李|称重|在线值机/);
    assert.doesNotMatch(d10Text, /Cairns Night Markets|Esplanade Lagoon/);
    const resourceIds = new Set(d10.blocks.flatMap((block) => block.resources.map((resource) => resource.id)));
    for (const resourceId of ["rustys-official", "williams-esplanade-map", "palm-cove-jetty-map"]) {
      assert.ok(resourceIds.has(resourceId), `d10 is missing ${resourceId}`);
    }
  });

  it("keeps resources outside the Cairns and Sydney updates stable", () => {
    const changedResourceIds = new Set([
      "cairns-lagoon-closure-official",
      "cairns-botanic-gardens-map",
      "cairns-botanic-gardens-official",
      "cairns-cbd-map",
      "cairns-esplanade-boardwalk-map",
      "cairns-marlin-marina-map",
      "cairns-night-markets-official",
      "reef-magic-schedule-official",
      "d9-tablelands-route-map",
      "cairns-car-rental-search-map",
      "d9-core-route-map",
      "d9-north-route-map",
      "d9-highlands-route-map",
      "kuranda-village-map",
      "mareeba-town-map",
      "skybury-map",
      "skybury-official",
      "d9-cairns-lake-eacham-route-map",
      "d9-waterfall-route-map",
      "d9-return-from-millaa-map",
      "d9-return-from-ellinjaa-map",
      "lake-eacham-day-use-map",
      "lake-eacham-official",
      "yungaburra-village-map",
      "platypus-viewing-platform-map",
      "peterson-creek-tracks-official",
      "curtain-fig-map",
      "curtain-fig-official",
      "gallo-hours-official",
      "millaa-public-toilets-map",
      "millaa-map",
      "millaa-upgrade-official",
      "millaa-falls-official",
      "ellinjaa-falls-official",
      "cairns-sunset-august-2026",
      "rustys-official",
      "williams-esplanade-map",
      "palm-cove-jetty-map",
      "d11-harbour-walk-map",
      "d12-hotel-to-mrs-map",
      "d12-harbour-morning-walk-map",
      "d13-taronga-to-bondi-map",
      "d15-bondi-fallback-route-map",
      "sixt-sydney-city-map",
      "sixt-sydney-city-official",
      "d14-hotel-to-sixt-map",
      "d14-south-coast-loop-map",
      "d14-coastal-route-map",
      "d14-inland-return-map",
      "bald-hill-map",
      "sea-cliff-map",
      "kiama-map",
      "kiama-lighthouse-map",
      "gerringong-map",
      "hampden-bridge-map",
    ]);
    const unchangedResources = itinerary.resources.filter((resource) => !changedResourceIds.has(resource.id));
    assert.equal(
      createHash("sha256").update(JSON.stringify(unchangedResources)).digest("hex"),
      "c4807496d3942183f4d57817829d98010dc7c5652f86627d020a51fa4375bb66",
    );
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

  it("uses Taronga, the weather-triggered Bondi leg, and Totti's on D13", () => {
    const d13 = itinerary.days.find((day) => day.id === "d13");
    const d13Text = [
      d13.title,
      d13.focus,
      ...d13.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`),
    ].join(" ");

    assert.equal(d13.coverImageUrl, "/itinerary/d14-taronga-bondi.png");
    assert.match(d13.coverImageAlt, /Taronga|Bondi|悉尼港/);
    assert.match(d13.primaryResource.title, /Taronga Zoo/);
    assert.match(d13.ticketResource.title, /Taronga Zoo/);
    assert.match(d13Text, /F2|公共渡轮|Ferry/);
    assert.match(d13Text, /Taronga.*(?:正门|上门).*Bondi|Bondi.*天气/s);
    assert.match(d13Text, /风雨|天气/);
    assert.match(d13Text, /Tamarama/);
    assert.match(d13Text, /Totti/);
    assert.match(d13Text, /17:30/);
    assert.doesNotMatch(d13Text, /Captain Cook|观鲸|whale/i);
  });

  it("uses the booked full South Coast loop on D14", () => {
    const d14 = itinerary.days.find((day) => day.id === "d14");
    const d14Text = [
      d14.title,
      d14.focus,
      ...d14.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`),
    ].join(" ");

    assert.equal(d14.coverImageUrl, "/itinerary/d13-south-coast-kiama-gerringong.png");
    assert.match(d14.coverImageAlt, /南海岸|Kiama|Kangaroo Valley/);
    assert.match(d14.transport, /SIXT|自驾/);
    assert.match(d14.primaryResource.title, /完整环线|南海岸环线/);
    assert.match(d14.primaryResource.url, /waypoints=.*Bald.*Sea.*Kiama.*Werri.*Hampden/i);
    assert.match(d14Text, /SIXT Sydney City/);
    assert.match(d14Text, /Bald Hill/);
    assert.match(d14Text, /Sea Cliff Bridge/);
    assert.match(d14Text, /Kiama/);
    assert.match(d14Text, /Werri Beach/);
    assert.match(d14Text, /Kangaroo Valley/);
    assert.match(d14Text, /Hampden Bridge/);
    assert.match(d14Text, /14:00/);
    assert.match(d14Text, /15:30/);
    assert.match(d14Text, /18:50/);
    assert.equal(d14.blocks.some((block) => /Wollongong|Fitzroy Falls/.test(block.place)), false);
    assert.doesNotMatch(d14Text, /可选|视情况延伸/);
  });

  it("does not let a cancelled same-day activity override the D13 Taronga ticket", () => {
    const d13 = itinerary.days.find((day) => day.id === "d13");
    const docket = buildDayDocket(d13, [{
      id: "cancelled-whale-tour",
      category: "活动",
      item: "Captain Cook Whale Watching",
      date: d13.date,
      currency: "AUD",
      amount: 340.2,
      status: "confirmed",
      note: "旧记录",
    }]);
    const ticket = docket.find((item) => item.id === "ticket");

    assert.match(ticket.title, /Taronga Zoo/);
    assert.doesNotMatch(`${ticket.title} ${ticket.detail}`, /Captain Cook|观鲸|whale/i);
  });

  it("uses Bondi as the D15 fallback before optional Manly, shopping, and Cafe Sydney", () => {
    const d15 = itinerary.days.find((day) => day.id === "d15");
    const d15Text = [
      d15.title,
      d15.focus,
      ...d15.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`),
    ].join(" ");

    assert.equal(d15.coverImageUrl, "/itinerary/d15-manly-flex-farewell.png");
    assert.match(d15.coverImageAlt, /海岸|悉尼港|告别/);
    assert.match(d15.transport, /F1 Ferry.*(?:可选|仅在选择)/);
    assert.match(d15.primaryResource.title, /QVB/);
    assert.equal(d15.ticketResource.id, "no-fixed-ticket");
    assert.match(d15Text, /Manly/);
    assert.match(d15Text, /8\/10.*未完成.*Bondi|Bondi.*补/);
    assert.match(d15Text, /已完成.*Manly|Manly.*备选/);
    assert.match(d15Text, /QVB/);
    assert.match(d15Text, /Chemist Warehouse/);
    assert.match(d15Text, /TRS/);
    assert.match(d15Text, /Cafe Sydney/);
    assert.match(d15Text, /17:30/);
    assert.doesNotMatch(d15Text, /Taronga Zoo/);
  });

  it("keeps Totti's on D13 and Cafe Sydney on D15 in the meal plan", () => {
    const d13Text = itinerary.days.find((day) => day.id === "d13").blocks
      .map((block) => `${block.place} ${block.activity} ${block.tip}`)
      .join(" ");
    const d15Text = itinerary.days.find((day) => day.id === "d15").blocks
      .map((block) => `${block.place} ${block.activity} ${block.tip}`)
      .join(" ");

    assert.match(d13Text, /Totti/);
    assert.match(d13Text, /Bondi/);
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

  it("uses a rested D11 harbor walk and puts D12 outdoor stops before the Opera House tour", () => {
    const d11 = itinerary.days.find((day) => day.id === "d11");
    const d12 = itinerary.days.find((day) => day.id === "d12");
    const d11Text = [d11.focus, d11.leaveBy, ...d11.blocks.flatMap((block) => [block.period, block.place, block.activity, block.tip])].join(" ");
    const d12Text = [d12.focus, d12.leaveBy, ...d12.blocks.flatMap((block) => [block.period, block.place, block.activity, block.tip])].join(" ");
    const restIndex = d11.blocks.findIndex((block) => block.place === "酒店" && /补觉/.test(block.activity));
    const barangarooIndex = d11.blocks.findIndex((block) => /Barangaroo Reserve \/ Wulugul Walk/.test(block.place));
    const rocksIndex = d11.blocks.findIndex((block) => block.place === "The Rocks");
    const quayIndex = d11.blocks.findIndex((block) => block.place === "Circular Quay");
    const chairIndex = d12.blocks.findIndex((block) => block.place === "Mrs Macquarie's Chair");
    const gardenIndex = d12.blocks.findIndex((block) => block.place === "Royal Botanic Garden");
    const tourIndex = d12.blocks.findIndex((block) => /中文内部导览/.test(block.activity));

    assert.match(d11Text, /06:45–09:45/);
    assert.match(d11Text, /12:30–14:45/);
    assert.match(d11Text, /17:00–17:45/);
    assert.ok(restIndex < barangarooIndex);
    assert.ok(barangarooIndex < rocksIndex);
    assert.ok(rocksIndex < quayIndex);
    assert.equal(d11.primaryResource.id, "d11-harbour-walk-map");
    assert.match(d11.primaryResource.url, /google\.com\/maps\/dir/);

    assert.ok(chairIndex < gardenIndex);
    assert.ok(gardenIndex < tourIndex);
    assert.match(d12Text, /07:30–07:45/);
    assert.match(d12Text, /09:30–10:30/);
    assert.match(d12Text, /12:15–15:30/);
    assert.match(d12Text, /明显下雨.*歌剧院/);
    assert.match(d12Text, /QVB/);
    assert.match(d12Text, /Westfield/);
    assert.equal(d12.primaryResource.id, "d12-harbour-morning-walk-map");
    assert.doesNotMatch(d12Text, /The Rocks Markets|IMAX|Odyssey/);
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
    assert.match(actionsFor("d13").find((action) => action.label === "打开晚餐").title, /Totti/);
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
    const meals = parseMealPlan(itinerary.days.find((item) => item.id === "d13"));

    assert.match(meals.dinner, /Totti|Icebergs|Bondi/);
    assert.ok(meals.breakfast.length > 0);
    assert.ok(meals.lunch.length > 0);
  });
});
