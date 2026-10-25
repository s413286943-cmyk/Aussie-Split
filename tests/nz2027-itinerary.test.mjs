import assert from "node:assert/strict";
import fs from "node:fs";
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
    assert.match(dayById("d15").leaveBy, /13:30前.*报到/);
    assert.match(dayById("d15").transport, /交通待定/);
    assert.ok(dayById("d15").blocks.some((block) => /13:50/.test(block.period) && /Mandarin/.test(block.activity)));
  });

  it("attaches all 11 driving guides with their segments", () => {
    assert.deepEqual(
      itinerary.days.filter((day) => day.drive).map((day) => [day.date.slice(5), day.drive.id, day.drive.legs.length]),
      [
        ["02-04", "nav01", 3], ["02-05", "nav02", 5], ["02-06", "nav03", 4], ["02-07", "nav04", 4],
        ["02-08", "nav05", 4], ["02-09", "nav06", 3], ["02-10", "nav07", 5], ["02-12", "nav08", 4],
        ["02-13", "nav09", 4], ["02-14", "nav10", 3], ["02-15", "nav11", 5],
      ],
    );
    assert.match(dayById("d10").drive.sequence, /Crown Range Summit → Arrow Junction \/ Arrowtown/);
    assert.ok(dayById("d10").drive.resources.some((resource) => /备选：经Cromwell/.test(resource.title)));
  });

  it("lists free-cancellation deadlines and payment dates", () => {
    const deadlines = Object.fromEntries(itinerary.lodgings.map((lodging) => [lodging.name, lodging.freeCancelUntil]));
    assert.equal(deadlines["山景独立单间公寓Fernhill"], "2027-01-13 15:00");
    assert.equal(deadlines["Great Southern Hotel Sydney"], "2027-02-01 14:00");
    assert.equal(deadlines["Metropolitan Motel on Riccarton"], "2027-02-03 14:00");
    assert.equal(deadlines["Hikuwai Haven 1"], "2027-02-03 16:00");
    assert.equal(deadlines["Private Ensuite in the Heart of Te Anau"], "2027-02-05 15:00");
    assert.deepEqual(
      itinerary.todos.filter((todo) => todo.kind === "payment").map((todo) => todo.dueDate),
      ["2027-01-05", "2027-01-26", "2027-01-28"],
    );
  });

  it("documents route advice without changing booked lodging", () => {
    assert.equal(itinerary.advice.length, 5);
    assert.ok(itinerary.advice.some((item) => /Crown Range/.test(item.title)));
    assert.ok(itinerary.advice.some((item) => /Hobbiton/.test(item.title)));
    assert.ok(itinerary.advice.some((item) => /Waitangi/.test(item.title)));
    assert.equal(itinerary.advice.find((item) => /已订住宿/.test(item.title)).verdict, "不改订单");
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
