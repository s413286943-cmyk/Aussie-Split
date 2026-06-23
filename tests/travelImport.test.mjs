import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildImportPreview,
  mergeImportedTravelData,
  parseTravelMarkdown,
} from "../src/lib/travelImport.js";

describe("travel markdown import", () => {
  const markdown = `
# 新版攻略

Day\t日期\t城市 / 区域\t核心安排\t住宿
D7\t8/4 周二\t凯恩斯\t新版大堡礁安排\tSouthern Cross Atrium Apartments
D8\t8/5 周三\t丹翠雨林\t新版丹翠雨林安排\tSouthern Cross Atrium Apartments

D7｜8月4日 周二｜新版大堡礁外礁一日游
今日定位
天气好就出海，重点是外礁平台。
时间段\t地点\t活动\t亮点\t贴士
早上\t凯恩斯码头\t提前到码头换票\t不用赶\t带晕船药
全天\tOuter Reef Pontoon\t浮潜和半潜艇\t看珊瑚和热带鱼\t防晒衣优先

六、需要提前预订的项目
1. 大堡礁外礁一日游
* 使用日期：D7｜8/4
* 当前预算参考：约 ¥1,400/人，4人约 ¥5,600。
* 提前确认：
    * 是否含午餐；
    * 是否含半潜艇。

七、美食地图
优先级\t具体店 / 地点\t吃什么\t为什么值得标记\t放在哪天最顺
⭐⭐⭐\tPrawn Star Cairns\tSeafood platter\t新版海鲜提醒\tD7 晚餐
`;

  it("parses days and list items from a revised markdown guide", () => {
    const parsed = parseTravelMarkdown(markdown);

    assert.equal(parsed.days.length, 2);
    assert.equal(parsed.days[0].id, "d7");
    assert.equal(parsed.days[0].title, "新版大堡礁外礁一日游");
    assert.equal(parsed.days[0].blocks.length, 2);
    assert.equal(parsed.items.some((item) => item.title.includes("大堡礁外礁一日游")), true);
    assert.equal(parsed.items.some((item) => item.title.includes("Prawn Star Cairns")), true);
  });

  it("builds a traveler-facing preview before applying changes", () => {
    const current = {
      days: [{ id: "d7", title: "旧大堡礁", blocks: [] }],
      items: [{ id: "food-prawn-star-cairns", kind: "food", title: "Prawn Star Cairns", status: "已订好", note: "旧备注" }],
    };
    const preview = buildImportPreview(current, parseTravelMarkdown(markdown));

    assert.ok(preview.updated.some((entry) => entry.label.includes("D7")));
    assert.ok(preview.updated.some((entry) => entry.label.includes("Prawn Star Cairns")));
    assert.deepEqual(Object.keys(preview), ["added", "updated", "unchanged", "unrecognized"]);
  });

  it("merges imported guide changes while preserving manual status and link", () => {
    const current = {
      days: [{ id: "d7", title: "旧大堡礁", city: "凯恩斯", blocks: [], backupNote: "手写备选" }],
      items: [
        {
          id: "food-prawn-star-cairns",
          kind: "food",
          title: "Prawn Star Cairns",
          relatedDayId: "d7",
          city: "凯恩斯",
          status: "已订好",
          amount: 0,
          currency: "",
          note: "旧备注",
          link: "https://example.com",
          sortOrder: 1,
        },
      ],
    };

    const merged = mergeImportedTravelData(current, parseTravelMarkdown(markdown));
    const d7 = merged.days.find((day) => day.id === "d7");
    const prawnStar = merged.items.find((item) => item.title === "Prawn Star Cairns");

    assert.equal(d7.title, "新版大堡礁外礁一日游");
    assert.equal(d7.backupNote, "手写备选");
    assert.equal(prawnStar.status, "已订好");
    assert.equal(prawnStar.link, "https://example.com");
    assert.match(prawnStar.note, /新版海鲜提醒/);
  });
});
