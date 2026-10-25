import assert from "node:assert/strict";
import { describe, it } from "node:test";

import itinerary from "../src/data/itinerary.generated.json" with { type: "json" };
import {
  buildDayCarryChecklist,
  buildDayDocket,
  buildDayTimeline,
  buildTodayCommand,
  collectMapActions,
  collectTodayResources,
  findTodayDay,
  parseMealPlan,
  summarizeDayLedger,
  travelMode,
} from "../src/lib/today.js";
import { readWorkbook } from "../scripts/import-itinerary.mjs";

const dayById = (id) => itinerary.days.find((day) => day.id === id);

describe("2027 New Zealand itinerary data", () => {
  it("imports D01 through D17 for 2027-02-01 to 2027-02-17 from the Excel workbook", () => {
    const imported = readWorkbook();

    assert.equal(imported.days.length, 17);
    assert.equal(imported.days[0].label, "D01");
    assert.equal(imported.days[0].date, "2027-02-01");
    assert.equal(imported.days[16].label, "D17");
    assert.equal(imported.days[16].date, "2027-02-17");
    assert.equal(imported.trip.title, "澳新 2027");
    assert.equal(imported.trip.travelers, "2位成人");
  });

  it("follows the booked night sequence: Sydney 3, Christchurch 1, Twizel 3, Wānaka 2, Te Anau 2, Queenstown 2, Auckland 2", () => {
    const nights = itinerary.days.slice(0, 15).map((day) => day.base);
    assert.deepEqual(nights, [
      "Sydney", "Sydney", "Sydney",
      "Christchurch",
      "Twizel", "Twizel", "Twizel",
      "Wānaka", "Wānaka",
      "Te Anau", "Te Anau",
      "Queenstown", "Queenstown",
      "Auckland", "Auckland",
    ]);
    assert.equal(dayById("d16").lodging, "飞机上");
    assert.equal(dayById("d17").lodging, "-");
  });

  it("marks only the Sydney 2/1 night and Auckland nights as still to book", () => {
    const pending = itinerary.days.filter((day) => day.lodgingStatus === "待订").map((day) => day.id);
    assert.deepEqual(pending, ["d1", "d14", "d15"]);
    for (const day of itinerary.days.filter((item) => item.lodgingStatus === "已订")) {
      assert.equal(day.lodgingResource.type, "map", day.id);
      assert.equal(day.lodgingResource.title, day.lodging, day.id);
      assert.match(day.lodgingResource.url, /^https:\/\/www\.google\.com\/maps\//);
    }
  });

  it("keeps the two booked activities with their check-in times", () => {
    const milford = dayById("d11");
    const hobbiton = dayById("d15");
    assert.equal(milford.ticketResource.type, "booking");
    assert.match(milford.leaveBy, /09:30前/);
    assert.ok(milford.blocks.some((block) => block.period === "09:50–17:00"));
    assert.equal(hobbiton.ticketResource.type, "booking");
    assert.match(hobbiton.leaveBy, /13:30前报到/);
    assert.ok(hobbiton.blocks.some((block) => /13:50/.test(block.period) && /Mandarin/.test(block.activity)));
  });

  it("attaches the 11 driving guides to the right days with every segment", () => {
    const drives = itinerary.days.filter((day) => day.drive).map((day) => [day.date.slice(5), day.drive.id, day.drive.legs.length]);
    assert.deepEqual(drives, [
      ["02-04", "nav01", 3],
      ["02-05", "nav02", 5],
      ["02-06", "nav03", 4],
      ["02-07", "nav04", 4],
      ["02-08", "nav05", 4],
      ["02-09", "nav06", 3],
      ["02-10", "nav07", 5],
      ["02-12", "nav08", 4],
      ["02-13", "nav09", 4],
      ["02-14", "nav10", 3],
      ["02-15", "nav11", 5],
    ]);
    assert.equal(dayById("d11").drive, null, "Milford uses the booked coach, not a self-drive guide");
    for (const day of itinerary.days.filter((item) => item.drive)) {
      assert.ok(day.drive.resources.some((resource) => /google\.com\/maps\/dir\/\?api=1/.test(resource.url)), day.drive.id);
    }
    assert.match(dayById("d10").drive.sequence, /Cromwell/);
  });

  it("puts every day into one of four stages", () => {
    assert.deepEqual(itinerary.stages.map((stage) => stage.id), ["sydney", "mackenzie", "southern-lakes", "north-return"]);
    assert.deepEqual(itinerary.stages.flatMap((stage) => stage.dayIds), itinerary.days.map((day) => day.id));
  });

  it("lists lodgings with free-cancellation deadlines in local time", () => {
    const deadlines = Object.fromEntries(itinerary.lodgings.map((lodging) => [lodging.name, lodging.freeCancelUntil]));
    assert.equal(deadlines["山景独立单间公寓Fernhill"], "2027-01-13 15:00");
    assert.equal(deadlines["Great Southern Hotel Sydney"], "2027-02-01 14:00");
    assert.equal(deadlines["Metropolitan Motel on Riccarton"], "2027-02-03 14:00");
    assert.equal(deadlines["Hikuwai Haven 1"], "2027-02-03 16:00");
    assert.equal(deadlines["Private Ensuite in the Heart of Te Anau"], "2027-02-05 15:00");
    assert.equal(deadlines["Twizel Holiday Park"], "");
  });

  it("keeps payment dates and pre-departure todos", () => {
    const payments = itinerary.todos.filter((todo) => todo.kind === "payment").map((todo) => `${todo.dueDate} ${todo.title}`);
    assert.deepEqual(payments, [
      "2027-01-05 Queenstown Fernhill付款 NZ$721.63",
      "2027-01-26 Wānaka Hikuwai尾款 NZ$346.84",
      "2027-01-28 Te Anau尾款 NZ$386.40",
    ]);
    const bookings = itinerary.todos.filter((todo) => todo.kind === "booking").map((todo) => todo.title);
    assert.deepEqual(bookings, ["四段机票", "悉尼新增一晚", "Auckland两晚", "南岛租车", "Hobbiton当天交通", "Twizel观星", "重点餐厅"]);
  });

  it("documents route advice without changing booked lodging", () => {
    const titles = itinerary.advice.map((item) => item.title);
    assert.equal(itinerary.advice.length, 5);
    assert.ok(titles.some((title) => /Crown Range/.test(title)));
    assert.ok(titles.some((title) => /Hobbiton/.test(title)));
    assert.ok(titles.some((title) => /Waitangi/.test(title)));
    assert.equal(itinerary.advice.find((item) => /已订住宿/.test(item.title)).verdict, "不改订单");
    assert.ok(itinerary.advice.every((item) => !/改订单$/.test(item.verdict) || item.verdict === "不改订单"));
    assert.ok(dayById("d10").notes.some((note) => note.label === "路线建议"));
  });

  it("links every non-note resource to https and every block resource exists", () => {
    const ids = new Set(itinerary.resources.map((resource) => resource.id));
    for (const resource of itinerary.resources) {
      if (resource.type !== "note") assert.match(resource.url, /^https:\/\//, resource.id);
    }
    for (const day of itinerary.days) {
      for (const block of day.blocks) {
        for (const resource of block.resources) assert.ok(ids.has(resource.id), `${day.id} ${resource.id}`);
      }
    }
  });

  it("includes exactly one meal block per day", () => {
    for (const day of itinerary.days) {
      assert.equal(day.blocks.filter((block) => block.period === "饮食").length, 1, day.id);
    }
  });
});

describe("travel day helpers", () => {
  it("selects the right control-panel day before, during, and after the trip", () => {
    assert.equal(findTodayDay(itinerary.days, new Date("2026-12-25T10:00:00+08:00")).id, "d1");
    assert.equal(findTodayDay(itinerary.days, new Date(2027, 1, 10, 9, 0)).id, "d10");
    assert.equal(findTodayDay(itinerary.days, new Date(2027, 2, 1, 9, 0)).id, "d17");
  });

  it("selects the date-aware route mode and current stage", () => {
    const before = travelMode(itinerary.days, itinerary.stages, new Date(2027, 0, 20, 10));
    const during = travelMode(itinerary.days, itinerary.stages, new Date(2027, 1, 6, 10));
    const after = travelMode(itinerary.days, itinerary.stages, new Date(2027, 1, 20, 10));

    assert.equal(before.phase, "before");
    assert.equal(before.currentDay.id, "d1");
    assert.equal(during.phase, "during");
    assert.equal(during.currentDay.id, "d6");
    assert.equal(during.currentStage.id, "mackenzie");
    assert.equal(during.nextDay.id, "d7");
    assert.equal(after.phase, "after");
    assert.equal(after.currentDay.id, "d17");
    assert.equal(after.nextDay, null);
  });

  it("sorts clock-time periods into the right timeline slots", () => {
    const slots = Object.fromEntries(buildDayTimeline(dayById("d2")).map((slot) => [slot.id, slot.blocks.map((block) => block.period)]));
    assert.deepEqual(slots.morning, ["09:00–10:00", "10:00–12:30"]);
    assert.deepEqual(slots.noon, ["12:30–14:00"]);
    assert.deepEqual(slots.afternoon, ["14:00–16:30"]);
    assert.deepEqual(slots.night, ["晚上"]);
  });

  it("collects useful quick links for a booked activity day", () => {
    const resources = collectTodayResources(dayById("d11"));
    assert.ok(resources.some((resource) => resource.type === "booking"));
    assert.ok(resources.some((resource) => resource.type === "restaurant"));
    assert.equal(new Set(resources.map((resource) => resource.id)).size, resources.length);
  });

  it("builds the today command from explicit day controls", () => {
    const day = dayById("d5");
    const command = buildTodayCommand(day);
    const docket = buildDayDocket(day);
    const actions = collectMapActions(day);

    assert.equal(command.transport, day.transport);
    assert.equal(command.leaveBy, day.leaveBy);
    assert.equal(docket.find((item) => item.id === "lodging").href, day.lodgingResource.url);
    assert.equal(docket.find((item) => item.id === "lodging").status, "已订");
    assert.equal(docket.find((item) => item.id === "transport").status, "看路况");
    assert.equal(actions.find((item) => item.label === "打开第一站").url, day.primaryResource.url);
  });

  it("shows pending lodging and booked tickets in the docket", () => {
    assert.equal(buildDayDocket(dayById("d14")).find((item) => item.id === "lodging").status, "待订");
    assert.equal(buildDayDocket(dayById("d15")).find((item) => item.id === "ticket").status, "已订");
    assert.equal(buildDayDocket(dayById("d7")).find((item) => item.id === "ticket").status, "待订");
  });

  it("links dinner actions to the dinner plan", () => {
    const dinnerFor = (id) => collectMapActions(dayById(id)).find((action) => action.label === "打开晚餐")?.title;
    assert.equal(dinnerFor("d9"), "Kika");
    assert.equal(dinnerFor("d11"), "The Redcliff");
    assert.equal(dinnerFor("d12"), "Blue Kanu");
    assert.equal(dinnerFor("d5"), undefined);
  });

  it("parses daily meal plans into breakfast, lunch, and dinner", () => {
    const meals = parseMealPlan(dayById("d11"));
    assert.match(meals.lunch, /自备路餐/);
    assert.equal(meals.dinner, "The Redcliff");
    assert.ok(meals.breakfast.length > 0);
  });

  it("builds a day-specific carry checklist", () => {
    const ids = (id) => buildDayCarryChecklist(dayById(id)).map((item) => item.id);
    assert.ok(ids("d6").includes("hike-kit"));
    assert.ok(ids("d6").includes("weather-shell"));
    assert.ok(ids("d11").includes("sea-kit"));
    assert.ok(ids("d7").includes("night-kit"));
    assert.ok(ids("d4").includes("passport-flight"));
    assert.ok(!ids("d17").includes("hotel-key"));
  });

  it("summarizes a day's ledger by currency with pending counts", () => {
    const summary = summarizeDayLedger(dayById("d10"), [
      { id: "a", date: "2027-02-10", currency: "NZD", amount: 96.6, status: "confirmed" },
      { id: "b", date: "2027-02-10", currency: "NZD", amount: 386.4, status: "draft" },
      { id: "c", date: "2027-02-10", currency: "NZD", amount: 5, status: "confirmed", deletedAt: "2027-02-10T00:00:00.000Z" },
    ]);
    assert.equal(summary.count, 2);
    assert.equal(summary.pendingCount, 1);
    assert.deepEqual(summary.totalsByCurrency, { NZD: 483 });
  });
});
