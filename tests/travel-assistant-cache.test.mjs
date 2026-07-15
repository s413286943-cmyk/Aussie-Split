import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTravelAssistantFingerprint,
  clearTravelBriefCache,
  readTravelBriefCache,
  writeTravelBriefCache,
} from "../src/lib/travelAssistantCache.js";

const d14 = {
  id: "d14",
  date: "2026-08-11",
  city: "悉尼",
  title: "Taronga Zoo + Bondi",
  focus: "动物与海岸",
  transport: "F2 Ferry + 步行",
  leaveBy: "08:30",
  lodging: "Sydney hotel",
  blocks: [
    {
      sortOrder: 10,
      period: "上午",
      place: "Taronga Zoo",
      activity: "看澳洲动物",
      highlight: "Harbour view",
      tip: "穿舒适步行鞋",
    },
  ],
};

const weather = {
  status: "forecast",
  summary: "晴 · 9-18°C",
  detail: "长袖 + 薄外套",
  adviceLabel: "预报穿衣建议",
};

describe("travel assistant local brief cache", () => {
  it("returns fresh for the same day fingerprint after refresh", () => {
    const values = new Map();
    const fingerprint = fingerprintFor();
    const entry = entryFor(fingerprint, "D14 brief");

    assert.equal(writeTravelBriefCache(storageFor(values), "d14", entry), true);

    const refreshedStorage = storageFor(values);
    assert.deepEqual(readTravelBriefCache(refreshedStorage, "d14", fingerprint), {
      state: "fresh",
      entry,
    });
  });

  it("returns stale while retaining the old brief when weather or checklist changes", () => {
    const storage = storageFor(new Map());
    const originalFingerprint = fingerprintFor();
    const entry = entryFor(originalFingerprint, "Original brief");
    writeTravelBriefCache(storage, "d14", entry);

    const changedWeather = fingerprintFor({
      weather: { ...weather, summary: "阵雨 · 8-16°C" },
    });
    const changedChecklist = fingerprintFor({
      checkedKitItemIds: ["power", "weather-shell", "tickets"],
    });

    assert.deepEqual(readTravelBriefCache(storage, "d14", changedWeather), {
      state: "stale",
      entry,
    });
    assert.deepEqual(readTravelBriefCache(storage, "d14", changedChecklist), {
      state: "stale",
      entry,
    });
  });

  it("keeps D14 and D15 cache entries separate", () => {
    const values = new Map();
    const storage = storageFor(values);
    const d14Fingerprint = fingerprintFor();
    const d15Day = { ...d14, id: "d15", date: "2026-08-12", title: "Manly" };
    const d15Fingerprint = fingerprintFor({ day: d15Day });
    const d14Entry = entryFor(d14Fingerprint, "D14 brief", ["d14"]);
    const d15Entry = entryFor(d15Fingerprint, "D15 brief", ["d15"]);

    writeTravelBriefCache(storage, "d14", d14Entry);
    writeTravelBriefCache(storage, "d15", d15Entry);

    assert.equal(values.size, 2);
    assert.deepEqual(readTravelBriefCache(storage, "d14", d14Fingerprint).entry, d14Entry);
    assert.deepEqual(readTravelBriefCache(storage, "d15", d15Fingerprint).entry, d15Entry);
  });

  it("returns empty for malformed, wrong-version, or wrong-shape stored values", () => {
    const values = new Map();
    const storage = storageFor(values);
    const fingerprint = fingerprintFor();
    const entry = entryFor(fingerprint, "D14 brief");
    writeTravelBriefCache(storage, "d14", entry);
    const [key] = values.keys();

    for (const stored of [
      "{not-json",
      JSON.stringify({ version: 2, entry }),
      JSON.stringify({ version: 1, entry: { fingerprint } }),
    ]) {
      values.set(key, stored);
      assert.deepEqual(readTravelBriefCache(storage, "d14", fingerprint), {
        state: "empty",
        entry: null,
      });
    }

    const throwingStorage = {
      getItem() {
        throw new Error("storage unavailable");
      },
    };
    assert.deepEqual(readTravelBriefCache(throwingStorage, "d14", fingerprint), {
      state: "empty",
      entry: null,
    });
  });

  it("clears only the selected day", () => {
    const storage = storageFor(new Map());
    const d14Fingerprint = fingerprintFor();
    const d15Fingerprint = fingerprintFor({ day: { ...d14, id: "d15" } });
    const d15Entry = entryFor(d15Fingerprint, "D15 brief", ["d15"]);
    writeTravelBriefCache(storage, "d14", entryFor(d14Fingerprint, "D14 brief"));
    writeTravelBriefCache(storage, "d15", d15Entry);

    assert.equal(clearTravelBriefCache(storage, "d14"), true);
    assert.deepEqual(readTravelBriefCache(storage, "d14", d14Fingerprint), {
      state: "empty",
      entry: null,
    });
    assert.deepEqual(readTravelBriefCache(storage, "d15", d15Fingerprint), {
      state: "fresh",
      entry: d15Entry,
    });
  });

  it("uses a stable allowlisted fingerprint and serializes only brief cache fields", () => {
    const baseFingerprint = fingerprintFor({
      checkedKitItemIds: ["weather-shell", "power"],
    });
    const privateExtrasFingerprint = fingerprintFor({
      day: {
        ...d14,
        expenses: [{ payer: "private", amount: 99 }],
        receipt: { path: "private.jpg" },
        supabase: { token: "private" },
        blocks: d14.blocks.map((block) => ({ ...block, ledger: "private" })),
      },
      weather: { ...weather, receipt: "private", supabase: "private" },
      checkedKitItemIds: ["power", "not valid", "weather-shell", "power"],
    });

    assert.match(baseFingerprint, /^[0-9a-f]{8}$/);
    assert.equal(privateExtrasFingerprint, baseFingerprint);

    const values = new Map();
    writeTravelBriefCache(storageFor(values), "d14", {
      ...entryFor(baseFingerprint, "D14 brief"),
      expenses: [{ amount: 99 }],
      receipt: { payer: "private" },
      supabase: { operation: "private" },
    });
    const serialized = [...values.values()][0];
    const stored = JSON.parse(serialized);

    assert.deepEqual(Object.keys(stored).sort(), ["entry", "version"]);
    assert.deepEqual(
      Object.keys(stored.entry).sort(),
      ["brief", "fingerprint", "generatedAt", "sourceDayIds"],
    );
    assert.doesNotMatch(serialized, /expenses|ledger|payer|amount|receipt|operation|supabase/i);
  });

  it("rejects invalid day ids without accessing storage", () => {
    const values = new Map();
    const storage = storageFor(values);
    const fingerprint = fingerprintFor();

    assert.equal(writeTravelBriefCache(storage, "../d14", entryFor(fingerprint, "brief")), false);
    assert.deepEqual(readTravelBriefCache(storage, "", fingerprint), {
      state: "empty",
      entry: null,
    });
    assert.equal(clearTravelBriefCache(storage, "d17"), false);
    assert.equal(values.size, 0);
  });
});

function fingerprintFor(overrides = {}) {
  return buildTravelAssistantFingerprint({
    day: overrides.day || d14,
    weather: overrides.weather || weather,
    checkedKitItemIds: overrides.checkedKitItemIds || ["power", "weather-shell"],
  });
}

function entryFor(fingerprint, note, sourceDayIds = ["d14"]) {
  return {
    fingerprint,
    generatedAt: "2026-07-15T00:00:00.000Z",
    brief: { pace: { level: "balanced", note } },
    sourceDayIds,
  };
}

function storageFor(values) {
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
