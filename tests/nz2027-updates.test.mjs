import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import releases from "../content/nz2027-updates.json" with { type: "json" };
import { buildTimeline, countUnseen, groupByDay, latestAt } from "../src/lib/nz2027/updates.js";
import { GET as getUpdates } from "../src/app/api/nz2027/updates/route.ts";
import { createSessionToken } from "../src/lib/server/session.js";

describe("2027 update notes", () => {
  it("keeps itinerary notes valid, newest first and in the travellers' voice", () => {
    assert.ok(releases.length > 0);
    assert.equal(new Set(releases.map((release) => release.id)).size, releases.length);
    for (const release of releases) {
      assert.match(release.id, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
      assert.ok(Number.isFinite(Date.parse(release.at)), release.id);
      assert.ok(release.title.trim(), release.id);
      assert.ok(Array.isArray(release.items) && release.items.every((item) => typeof item === "string" && item.trim()), release.id);
    }
    const times = releases.map((release) => Date.parse(release.at));
    assert.deepEqual(times, [...times].sort((left, right) => right - left));
    const text = JSON.stringify(releases);
    for (const phrase of ["分账", "本机", "接口", "数据库", "行程文件", "主线", "PR", "部署", "迁移", "commit"]) {
      assert.ok(!text.includes(phrase), phrase);
    }
  });
});

describe("2027 updates timeline", () => {
  const todos = [{ id: "licence", title: "两人的驾照英文翻译件" }];
  const activity = [
    { id: "1", at: "2026-10-26T10:00:00.000Z", kind: "expense", action: "added", refId: "a", detail: { item: "Skyline", currency: "CNY", amount: 644, status: "paid", date: "2027-02-12" } },
    { id: "2", at: "2026-10-26T11:00:00.000Z", kind: "expense", action: "changed", refId: "b", detail: { item: "悉尼酒店", currency: "CNY", amount: 2027.36, status: "pending", before: { item: "悉尼酒店", currency: "CNY", amount: 1361.31, status: "pending" } } },
    { id: "3", at: "2026-10-26T12:00:00.000Z", kind: "expense", action: "removed", refId: "c", detail: { item: "Hobbiton", currency: "NZD", amount: 260, status: "paid" } },
    { id: "4", at: "2026-10-26T13:00:00.000Z", kind: "check", action: "done", refId: "licence", detail: {} },
    { id: "5", at: "2026-10-26T14:00:00.000Z", kind: "check", action: "undone", refId: "gone", detail: {} },
    { id: "6", at: "not a time", kind: "check", action: "done", refId: "x", detail: {} },
  ];

  it("describes ledger and checklist changes in plain words, newest first", () => {
    const entries = buildTimeline({ releases: [{ id: "r", at: "2026-10-26T09:00:00Z", title: "行程调整", items: ["2/2 改走 Coogee"] }], activity, todos });
    assert.deepEqual(entries.map((entry) => entry.title), [
      "取消勾选：一项清单",
      "勾掉：两人的驾照英文翻译件",
      "删了一笔：Hobbiton",
      "改了一笔：悉尼酒店",
      "记了一笔：Skyline",
      "行程调整",
    ]);
    assert.deepEqual(entries.find((entry) => entry.key === "activity:2").lines, ["¥1,361.31 → ¥2,027.36"]);
    assert.deepEqual(entries.find((entry) => entry.key === "activity:1").lines, ["¥644.00 · 已付 · 2/12"]);
    assert.deepEqual(entries.find((entry) => entry.key === "activity:3").lines, ["NZ$260.00"]);
    assert.equal(entries.at(-1).tag, "行程");
  });

  it("groups by day and counts what is new since the last visit", () => {
    const entries = buildTimeline({ activity, todos });
    const groups = groupByDay(entries);
    assert.equal(groups.reduce((sum, group) => sum + group.entries.length, 0), entries.length);
    assert.match(groups[0].label, /^\d+月\d+日 周./);
    assert.equal(latestAt(entries), "2026-10-26T14:00:00.000Z");
    assert.equal(countUnseen(entries, "2026-10-26T12:30:00.000Z"), 2);
    assert.equal(countUnseen(entries, ""), 0, "no badge before the first visit");
  });
});

describe("2027 updates API", () => {
  const originalFetch = globalThis.fetch;
  const saved = {};
  beforeEach(() => {
    for (const key of ["TRIP_CODE", "SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) saved[key] = process.env[key];
    process.env.TRIP_CODE = "shared-code";
    process.env.SESSION_SECRET = "updates-route-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("requires the session", async () => {
    globalThis.fetch = async () => assert.fail("Supabase must not be called");
    assert.equal((await getUpdates(new Request("https://aussie.example/api/nz2027/updates"))).status, 401);
  });

  it("reads the change log newest first and returns the itinerary notes", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return Response.json([{ id: 7, at: "2026-10-26T10:00:00+00:00", kind: "expense", action: "changed", ref_id: "x", detail: { item: "A", currency: "NZD", amount: "12.50", status: "paid", before: { amount: "10.00", currency: "NZD" }, secret: "dropped" } }]);
    };
    const response = await getUpdates(authenticated());
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.activityAvailable, true);
    assert.deepEqual(payload.activity, [{
      id: "7", at: "2026-10-26T10:00:00.000Z", kind: "expense", action: "changed", refId: "x",
      detail: { item: "A", currency: "NZD", amount: 12.5, status: "paid", before: { currency: "NZD", amount: 10 } },
    }]);
    assert.equal(payload.releases.length, releases.length);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/rest\/v1\/nz2027_activity\?select=\*&order=at\.desc,id\.desc&limit=200$/);
  });

  it("still shows itinerary notes before the change log exists or when it is down", async () => {
    globalThis.fetch = async () => Response.json({ code: "PGRST205", message: "missing" }, { status: 404 });
    let payload = await (await getUpdates(authenticated())).json();
    assert.deepEqual([payload.activityAvailable, payload.activity.length, payload.releases.length], [false, 0, releases.length]);

    globalThis.fetch = async () => { throw new Error("offline"); };
    const response = await getUpdates(authenticated());
    payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual([payload.activityAvailable, payload.releases.length], [false, releases.length]);
  });
});

function authenticated() {
  const token = createSessionToken(process.env.SESSION_SECRET);
  return new Request("https://aussie.example/api/nz2027/updates", { headers: { Cookie: `aussie_chill_session=${token}` } });
}
