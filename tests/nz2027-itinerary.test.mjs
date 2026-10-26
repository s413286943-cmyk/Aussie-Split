import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import itinerary from "../src/data/nz2027-itinerary.generated.json" with { type: "json" };
import aussie from "../src/data/itinerary.generated.json" with { type: "json" };
import { readWorkbook } from "../scripts/nz2027/import-itinerary.mjs";

const dayById = (id) => itinerary.days.find((day) => day.id === id);

describe("2027 two-person itinerary data", () => {
  it("keeps the generated JSON identical to its own Excel source", () => {
    assert.deepEqual(itinerary, readWorkbook(), "2027 itinerary JSON is stale; run npm run nz2027:import");
  });

  it("lives beside the 2026 itinerary without replacing it", () => {
    assert.equal(aussie.trip.title, "Aussie Chill");
    assert.equal(aussie.days[0].date, "2026-07-28");
    assert.ok(fs.existsSync("content/aussie-itinerary.xlsx"));
    assert.ok(fs.existsSync("content/nz2027-itinerary.xlsx"));
    assert.equal(itinerary.trip.title, "澳新 2027");
  });

  it("covers D01-D17 from 2027-02-01 to 2027-02-17 for two adults", () => {
    assert.equal(itinerary.days.length, 17);
    assert.equal(itinerary.days[0].label, "D01");
    assert.equal(itinerary.days[0].date, "2027-02-01");
    assert.equal(itinerary.days[16].date, "2027-02-17");
    assert.equal(itinerary.trip.travelers, "2位成人");
  });

  it("follows the booked night sequence", () => {
    assert.deepEqual(itinerary.days.slice(0, 15).map((day) => day.base), [
      "Sydney", "Sydney", "Sydney",
      "Christchurch",
      "Twizel", "Twizel", "Twizel",
      "Wānaka", "Wānaka",
      "Te Anau", "Te Anau",
      "Queenstown", "Queenstown",
      "Auckland", "Auckland",
    ]);
    assert.deepEqual(itinerary.days.filter((day) => day.lodgingStatus === "待订").map((day) => day.id), ["d14", "d15"]);
    for (const day of itinerary.days.filter((item) => item.lodgingStatus === "已订")) {
      assert.equal(day.lodgingResource.title, day.lodging, day.id);
      assert.match(day.lodgingResource.url, /^https:\/\/www\.google\.com\/maps\//);
    }
  });

  it("keeps both booked activities with their check-in times", () => {
    assert.equal(dayById("d11").ticketResource.type, "booking");
    assert.match(dayById("d11").leaveBy, /09:30前/);
    assert.ok(dayById("d11").blocks.some((block) => block.period === "09:50–17:00"));
    assert.match(dayById("d15").transport, /06:00出发，约17:30回到Auckland/);
    assert.equal(dayById("d15").drive, null);
    assert.equal(dayById("d15").ticketResource.id, "waitomo-hobbiton-booking");
    assert.deepEqual(dayById("d15").blocks.filter((block) => /Waitomo|Hobbiton/.test(block.place)).map((block) => block.place), ["Waitomo Glowworm Caves", "Hobbiton Movie Set"]);
  });

  it("attaches all 9 driving guides with their segments", () => {
    assert.deepEqual(
      itinerary.days.filter((day) => day.drive).map((day) => [day.date.slice(5), day.drive.id, day.drive.legs.length]),
      [
        ["02-05", "nav02", 5], ["02-06", "nav03", 4], ["02-07", "nav04", 5],
        ["02-08", "nav05", 4], ["02-09", "nav06", 3], ["02-10", "nav07", 5], ["02-12", "nav08", 5],
        ["02-13", "nav09", 5], ["02-14", "nav10", 3],
      ],
    );
    assert.match(dayById("d10").drive.sequence, /Crown Range Summit → Arrow Junction \/ Arrowtown/);
    assert.ok(dayById("d10").drive.resources.some((resource) => /备选：经Cromwell/.test(resource.title)));
  });

  it("follows the booked flights, rental car and Sydney hotel", () => {
    const text = (id) => JSON.stringify(dayById(id));
    assert.match(text("d1"), /CZ3864/);
    assert.match(dayById("d1").transport, /CZ601 06:35/);
    assert.match(dayById("d4").transport, /EK412 悉尼 09:00 → 基督城 14:15/);
    assert.equal(dayById("d4").drive, null);
    assert.equal(dayById("d4").lodging, "HOTEL GIVE");
    for (const place of ["Christchurch Botanic Gardens", "Riverside Market", "Bridge of Remembrance / Cathedral Square"]) {
      assert.ok(dayById("d4").blocks.some((block) => block.place === place), place);
    }
    assert.ok(!JSON.stringify(itinerary).includes("NZ224"));
    assert.match(dayById("d1").transport, /打车进城/);
    assert.ok(!JSON.stringify(itinerary).includes("SkyBus"));
    assert.ok(!JSON.stringify(itinerary).includes("Metropolitan"));
    assert.match(text("d5"), /10:00 基督城机场/);
    assert.match(dayById("d5").drive.duration, /10:00 机场取车/);
    assert.match(dayById("d14").transport, /JQ296 13:30 → 15:20/);
    assert.match(text("d14"), /20kg/);
    assert.match(dayById("d16").transport, /CZ306 22:25/);
    assert.match(dayById("d17").transport, /CZ3803 09:10 → 杭州 11:10/);
    const sydney = itinerary.lodgings.filter((lodging) => lodging.name.startsWith("Great Southern"));
    assert.deepEqual(sydney.map((lodging) => [lodging.checkIn, lodging.checkOut]), [["2027-02-01", "2027-02-04"]]);
    const all = JSON.stringify(itinerary);
    for (const phrase of ["待购", "（补订）", "换房"]) assert.ok(!all.includes(phrase), phrase);
  });

  it("uses the late February evenings for lakeside walks", () => {
    const has = (id, pattern) => dayById(id).blocks.some((block) => pattern.test(`${block.place} ${block.activity}`));
    assert.ok(has("d5", /Lake Ruataniwha.*日落/));
    assert.ok(has("d8", /Diamond Lake/));
    assert.ok(has("d12", /Kelvin Peninsula Sculpture Trail/));
    assert.ok(dayById("d12").blocks.some((block) => block.period === "16:30–18:30" && /Luge/.test(block.place)));
    assert.equal(dayById("d12").ticketResource.id, "skyline-booking");
    assert.ok(!itinerary.todos.some((todo) => todo.id === "skyline"));
    assert.ok(has("d13", /Moke Lake/));
    assert.ok(has("d1", /Barangaroo/));
    assert.ok(has("d2", /Mrs Macquarie/));
    assert.ok(has("d3", /渡轮/));
    assert.ok(has("d7", /Pukaki.*日落/));
    assert.ok(has("d9", /That Wānaka Tree.*日落/));
    assert.ok(has("d10", /Lakefront.*日落/));
    assert.ok(!JSON.stringify(dayById("d10")).includes("萤火虫"));
    assert.ok(has("d12", /Earnslaw Park/));
    assert.ok(has("d14", /Wynyard Quarter/));
    assert.ok(!has("d15", /Mt Eden/));
    assert.ok(dayById("d2").blocks[1].place.startsWith("Coogee"));
    assert.match(dayById("d12").blocks.find((block) => /Kelvin/.test(block.place)).period, /晚了就跳过/);
    assert.match(dayById("d13").blocks.find((block) => block.place === "Moke Lake").period, /可选/);
    const ids = itinerary.todos.map((todo) => todo.id);
    for (const id of ["tour-0215-pickup", "dinner-valentine"]) assert.ok(ids.includes(id), id);
    assert.match(JSON.stringify(dayById("d13").notes), /Glenorchy–Paradise Road/);
  });

  it("lists free-cancellation deadlines and payment dates", () => {
    const deadlines = Object.fromEntries(itinerary.lodgings.map((lodging) => [lodging.name, lodging.freeCancelUntil]));
    assert.equal(deadlines["山景独立单间公寓Fernhill"], "2027-01-13 15:00");
    assert.equal(deadlines["Great Southern Hotel Sydney"], "2027-02-01 14:00");
    assert.equal(deadlines["HOTEL GIVE"], "2027-02-02 23:59");
    assert.equal(deadlines["Hikuwai Haven 1"], "2027-02-03 16:00");
    assert.equal(deadlines["Private Ensuite in the Heart of Te Anau"], "2027-02-05 15:00");
    assert.deepEqual(
      itinerary.todos.filter((todo) => todo.kind === "pay").map((todo) => todo.dueDate),
      ["2027-01-05", "2027-01-26", "2027-01-28"],
    );
  });

  it("gives every to-do a stable id so ticks survive content edits", () => {
    const ids = itinerary.todos.map((todo) => todo.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)));
    for (const id of ["visa", "licence", "cancel-hotelgive", "nztd", "hooker-alerts", "baggage-jq296", "auckland-hotel", "stargazing", "dinner-kika", "milford-terms", "pay-fernhill", "cancel-teanau"]) {
      assert.ok(ids.includes(id), id);
    }
    assert.ok(itinerary.todos.every((todo) => ["book", "pay", "deadline", "prep"].includes(todo.kind)));
  });

  it("keeps travel tips in the travellers' own voice", () => {
    assert.deepEqual(itinerary.advice.map((item) => item.dayIds), [["d10"], ["d15"], ["d5", "d6", "d7", "d8"]]);
    const text = JSON.stringify({ trip: itinerary.trip, days: itinerary.days, todos: itinerary.todos, advice: itinerary.advice, lodgings: itinerary.lodgings });
    for (const phrase of ["行程文件", "原行程", "主线", "主案", "已采用", "不涉及订单", "规划窗口", "分账"]) {
      assert.ok(!text.includes(phrase), phrase);
    }
  });

  it("picks up theme pictures by file name", async () => {
    const { findThemeImage } = await import("../scripts/nz2027/import-itinerary.mjs");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nz2027-images-"));
    try {
      fs.writeFileSync(path.join(directory, "d03.jpg"), "");
      assert.equal(findThemeImage("d03", directory), "/nz2027/d03.jpg");
      assert.equal(findThemeImage("d04", directory), "");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses https for every linked resource and one meal block per day", () => {
    for (const resource of itinerary.resources) {
      if (resource.type !== "note") assert.match(resource.url, /^https:\/\//, resource.id);
    }
    for (const day of itinerary.days) {
      assert.equal(day.blocks.filter((block) => block.period === "饮食").length, 1, day.id);
    }
  });
});
