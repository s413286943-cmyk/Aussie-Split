import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWeatherAdvice,
  buildWeatherUrl,
  fetchDayWeather,
  getWeatherStatus,
  isForecastAvailable,
  summarizeWeather,
} from "../src/lib/weather.js";

const day = {
  date: "2026-08-04",
  lat: -16.9186,
  lon: 145.7781,
  climateNote: "凯恩斯约 17-26°C，旱季，阳光充足。",
  clothingNote: "短袖、防晒衣、墨镜、帽子、薄外套。",
};

async function withOnlineState(onLine, callback) {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine },
  });

  try {
    return await callback();
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    keys() {
      return [...values.keys()];
    },
  };
}

describe("itinerary weather", () => {
  it("builds an Open-Meteo forecast URL from day coordinates", () => {
    const url = buildWeatherUrl(day);

    assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast/);
    assert.match(url, /latitude=-16\.9186/);
    assert.match(url, /longitude=145\.7781/);
    assert.match(url, /current=/);
    assert.match(url, /forecast_days=16/);
  });

  it("uses live forecast only inside the forecast window", () => {
    assert.equal(isForecastAvailable("2026-08-04", new Date("2026-07-25T12:00:00")), true);
    assert.equal(isForecastAvailable("2026-08-04", new Date("2026-06-24T12:00:00")), false);
    assert.equal(isForecastAvailable("2026-08-04", new Date("2026-08-05T12:00:00")), false);
  });

  it("labels today as live, near future as forecast, and distant dates as fallback", () => {
    assert.equal(getWeatherStatus("2026-08-04", new Date("2026-08-04T12:00:00")), "live");
    assert.equal(getWeatherStatus("2026-08-04", new Date("2026-07-25T12:00:00")), "forecast");
    assert.equal(getWeatherStatus("2026-08-04", new Date("2026-06-24T12:00:00")), "fallback");
  });

  it("falls back to climate notes when the trip date is too far away", async () => {
    const result = await fetchDayWeather(day, new Date("2026-06-24T12:00:00"), async () => {
      throw new Error("should not fetch");
    });

    assert.equal(result.status, "fallback");
    assert.equal(result.summary, day.climateNote);
    assert.equal(result.detail, day.clothingNote);
  });

  it("keeps supporting a synchronous positional fetcher", async () => {
    const adelaideDay = {
      ...day,
      lat: -34.9285,
      lon: 138.6007,
    };
    const result = await fetchDayWeather(
      adelaideDay,
      new Date("2026-07-25T12:00:00"),
      () => ({
        ok: true,
        json: async () => ({
          daily: {
            time: [adelaideDay.date],
            temperature_2m_max: [20],
            temperature_2m_min: [9],
            precipitation_probability_max: [10],
            uv_index_max: [3],
            weather_code: [0],
          },
        }),
      })
    );

    assert.equal(result.status, "forecast");
    assert.equal(result.summary, "晴 · 9-20°C");
  });

  it("supports fetchDayWeather options without breaking positional calls", async () => {
    const canberraDay = {
      ...day,
      lat: -35.2809,
      lon: 149.13,
    };
    const request = fetchDayWeather(canberraDay, {
      now: new Date("2026-07-25T12:00:00"),
      online: true,
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          daily: {
            time: [canberraDay.date],
            temperature_2m_max: [17],
            temperature_2m_min: [4],
            precipitation_probability_max: [10],
            uv_index_max: [3],
            weather_code: [0],
          },
        }),
      }),
    });

    await assert.doesNotReject(request);
    const result = await request;
    assert.equal(result.status, "forecast");
    assert.equal(result.summary, "晴 · 4-17°C");
  });

  it("requests same-coordinate forecast days only once", async () => {
    const nextDay = {
      ...day,
      date: "2026-08-05",
    };
    let requestCount = 0;
    const fetcher = async () => {
      requestCount += 1;
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [day.date, nextDay.date],
            temperature_2m_max: [27, 29],
            temperature_2m_min: [18, 20],
            precipitation_probability_max: [10, 20],
            uv_index_max: [4, 5],
            weather_code: [1, 2],
          },
        }),
      };
    };

    const [first, second] = await Promise.all([
      fetchDayWeather(day, new Date("2026-07-25T12:00:00"), fetcher),
      fetchDayWeather(nextDay, new Date("2026-07-25T12:00:00"), fetcher),
    ]);

    assert.equal(requestCount, 1);
    assert.equal(first.summary, "多云 · 18-27°C");
    assert.equal(second.summary, "多云 · 20-29°C");
  });

  it("reuses a successful coordinate response inside six hours", async () => {
    const sydneyDay = {
      ...day,
      lat: -33.8688,
      lon: 151.2093,
    };
    let requestCount = 0;
    const fetcher = async () => {
      requestCount += 1;
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [sydneyDay.date],
            temperature_2m_max: [19],
            temperature_2m_min: [11],
            precipitation_probability_max: [10],
            uv_index_max: [3],
            weather_code: [0],
          },
        }),
      };
    };

    await fetchDayWeather(sydneyDay, new Date("2026-07-25T08:00:00"), fetcher);
    const cached = await fetchDayWeather(sydneyDay, new Date("2026-07-25T13:59:59"), fetcher);

    assert.equal(requestCount, 1);
    assert.equal(cached.summary, "晴 · 11-19°C");
  });

  it("refreshes a coordinate response after six hours", async () => {
    const melbourneDay = {
      ...day,
      lat: -37.8136,
      lon: 144.9631,
    };
    let requestCount = 0;
    const fetcher = async () => {
      requestCount += 1;
      const isRefresh = requestCount === 2;
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [melbourneDay.date],
            temperature_2m_max: [isRefresh ? 22 : 18],
            temperature_2m_min: [isRefresh ? 12 : 10],
            precipitation_probability_max: [20],
            uv_index_max: [3],
            weather_code: [2],
          },
        }),
      };
    };

    await fetchDayWeather(melbourneDay, new Date("2026-07-25T08:00:00.000"), fetcher);
    const refreshed = await fetchDayWeather(
      melbourneDay,
      new Date("2026-07-25T14:00:00.001"),
      fetcher
    );

    assert.equal(requestCount, 2);
    assert.equal(refreshed.summary, "多云 · 12-22°C");
  });

  it("reads a valid persisted coordinate cache after module reload", async () => {
    const goldCoastDay = {
      ...day,
      lat: -28.0167,
      lon: 153.4,
    };
    const storage = createMemoryStorage();
    let requestCount = 0;
    const fetcher = async () => {
      requestCount += 1;
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [goldCoastDay.date],
            temperature_2m_max: [23],
            temperature_2m_min: [13],
            precipitation_probability_max: [10],
            uv_index_max: [4],
            weather_code: [1],
          },
        }),
      };
    };

    await fetchDayWeather(goldCoastDay, {
      now: new Date("2026-07-25T08:00:00"),
      fetcher,
      online: true,
      storage,
    });

    const reloadedModuleUrl = new URL("../src/lib/weather.js", import.meta.url);
    reloadedModuleUrl.searchParams.set("cache-instance", String(Date.now()));
    const reloadedWeather = await import(reloadedModuleUrl);
    const cached = await reloadedWeather.fetchDayWeather(goldCoastDay, {
      now: new Date("2026-07-25T09:00:00"),
      fetcher,
      online: false,
      storage,
    });

    assert.equal(requestCount, 1);
    assert.equal(cached.status, "forecast");
    assert.equal(cached.summary, "多云 · 13-23°C");
  });

  it("prefers and preserves newer persisted cache entries across tabs", async () => {
    const aliceSpringsDay = {
      ...day,
      lat: -23.698,
      lon: 133.8807,
    };
    const storage = createMemoryStorage();
    const oldData = {
      daily: {
        time: [aliceSpringsDay.date],
        temperature_2m_max: [20],
        temperature_2m_min: [10],
        precipitation_probability_max: [10],
        uv_index_max: [3],
        weather_code: [0],
      },
    };
    const newerData = {
      daily: {
        time: [aliceSpringsDay.date],
        temperature_2m_max: [22],
        temperature_2m_min: [12],
        precipitation_probability_max: [20],
        uv_index_max: [4],
        weather_code: [2],
      },
    };
    const newestData = {
      daily: {
        time: [aliceSpringsDay.date],
        temperature_2m_max: [24],
        temperature_2m_min: [14],
        precipitation_probability_max: [30],
        uv_index_max: [5],
        weather_code: [1],
      },
    };
    const staleRefreshData = {
      daily: {
        time: [aliceSpringsDay.date],
        temperature_2m_max: [21],
        temperature_2m_min: [11],
        precipitation_probability_max: [10],
        uv_index_max: [3],
        weather_code: [0],
      },
    };

    await fetchDayWeather(aliceSpringsDay, {
      now: new Date("2026-07-25T08:00:00"),
      online: true,
      storage,
      fetcher: async () => ({ ok: true, json: async () => oldData }),
    });
    const [storageKey] = storage.keys();
    const newerCachedAt = new Date("2026-07-25T10:00:00").getTime();
    storage.setItem(storageKey, JSON.stringify({ cachedAt: newerCachedAt, data: newerData }));

    const fromPersistent = await fetchDayWeather(aliceSpringsDay, {
      now: new Date("2026-07-25T11:00:00"),
      online: false,
      storage,
    });
    assert.equal(fromPersistent.summary, "多云 · 12-22°C");

    storage.removeItem(storageKey);
    const fromUpdatedMemory = await fetchDayWeather(aliceSpringsDay, {
      now: new Date("2026-07-25T11:30:00"),
      online: false,
      storage,
    });
    assert.equal(fromUpdatedMemory.summary, "多云 · 12-22°C");

    let resolveStaleRefresh;
    const staleRefresh = fetchDayWeather(aliceSpringsDay, {
      now: new Date("2026-07-25T17:00:00"),
      online: true,
      storage,
      fetcher: () => new Promise((resolve) => {
        resolveStaleRefresh = resolve;
      }),
    });
    const newestCachedAt = new Date("2026-07-25T18:00:00").getTime();
    storage.setItem(storageKey, JSON.stringify({ cachedAt: newestCachedAt, data: newestData }));
    resolveStaleRefresh({ ok: true, json: async () => staleRefreshData });
    await staleRefresh;

    const stored = JSON.parse(storage.getItem(storageKey));
    assert.equal(stored.cachedAt, newestCachedAt);
    assert.deepEqual(stored.data, newestData);

    const afterStaleRefresh = await fetchDayWeather(aliceSpringsDay, {
      now: new Date("2026-07-25T18:30:00"),
      online: false,
      storage,
    });
    assert.equal(afterStaleRefresh.summary, "多云 · 14-24°C");
  });

  it("replaces an unchanged future-dated cache after a successful refresh", async () => {
    const townsvilleDay = {
      ...day,
      lat: -19.2589,
      lon: 146.8169,
    };
    const storage = createMemoryStorage();
    const futureData = {
      daily: {
        time: [townsvilleDay.date],
        temperature_2m_max: [32],
        temperature_2m_min: [22],
        precipitation_probability_max: [10],
        uv_index_max: [6],
        weather_code: [0],
      },
    };
    const refreshedData = {
      daily: {
        time: [townsvilleDay.date],
        temperature_2m_max: [25],
        temperature_2m_min: [15],
        precipitation_probability_max: [20],
        uv_index_max: [4],
        weather_code: [2],
      },
    };

    await fetchDayWeather(townsvilleDay, {
      now: new Date("2026-07-25T20:00:00"),
      online: true,
      storage,
      fetcher: async () => ({ ok: true, json: async () => futureData }),
    });
    let refreshCount = 0;
    const refreshed = await fetchDayWeather(townsvilleDay, {
      now: new Date("2026-07-25T12:00:00"),
      online: true,
      storage,
      fetcher: async () => {
        refreshCount += 1;
        return { ok: true, json: async () => refreshedData };
      },
    });

    const [storageKey] = storage.keys();
    const stored = JSON.parse(storage.getItem(storageKey));
    assert.equal(refreshCount, 1);
    assert.equal(refreshed.summary, "多云 · 15-25°C");
    assert.equal(stored.cachedAt, new Date("2026-07-25T12:00:00").getTime());
    assert.deepEqual(stored.data, refreshedData);
  });

  it("preserves a different persistent version written during future-cache refresh", async () => {
    const mackayDay = {
      ...day,
      lat: -21.1411,
      lon: 149.186,
    };
    const storage = createMemoryStorage();
    const futureData = {
      daily: {
        time: [mackayDay.date],
        temperature_2m_max: [31],
        temperature_2m_min: [21],
        precipitation_probability_max: [10],
        uv_index_max: [6],
        weather_code: [0],
      },
    };
    const otherTabData = {
      daily: {
        time: [mackayDay.date],
        temperature_2m_max: [27],
        temperature_2m_min: [17],
        precipitation_probability_max: [20],
        uv_index_max: [5],
        weather_code: [2],
      },
    };
    const refreshData = {
      daily: {
        time: [mackayDay.date],
        temperature_2m_max: [24],
        temperature_2m_min: [14],
        precipitation_probability_max: [30],
        uv_index_max: [4],
        weather_code: [1],
      },
    };

    await fetchDayWeather(mackayDay, {
      now: new Date("2026-07-25T20:00:00"),
      online: true,
      storage,
      fetcher: async () => ({ ok: true, json: async () => futureData }),
    });
    let resolveRefresh;
    const refresh = fetchDayWeather(mackayDay, {
      now: new Date("2026-07-25T12:00:00"),
      online: true,
      storage,
      fetcher: () => new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    });

    const [storageKey] = storage.keys();
    const otherTabCachedAt = new Date("2026-07-25T11:30:00").getTime();
    storage.setItem(storageKey, JSON.stringify({
      cachedAt: otherTabCachedAt,
      data: otherTabData,
    }));
    resolveRefresh({ ok: true, json: async () => refreshData });
    const result = await refresh;

    const stored = JSON.parse(storage.getItem(storageKey));
    assert.equal(result.summary, "多云 · 17-27°C");
    assert.equal(stored.cachedAt, otherTabCachedAt);
    assert.deepEqual(stored.data, otherTabData);
  });

  it("keeps weather behavior when persistent cache access fails", async () => {
    const brokenStorage = {
      getItem() {
        throw new Error("read unavailable");
      },
      setItem() {
        throw new Error("write unavailable");
      },
      removeItem() {
        throw new Error("remove unavailable");
      },
    };
    const newcastleDay = {
      ...day,
      lat: -32.9283,
      lon: 151.7817,
    };
    const fetched = await fetchDayWeather(newcastleDay, {
      now: new Date("2026-07-25T12:00:00"),
      online: true,
      storage: brokenStorage,
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          daily: {
            time: [newcastleDay.date],
            temperature_2m_max: [21],
            temperature_2m_min: [12],
            precipitation_probability_max: [10],
            uv_index_max: [3],
            weather_code: [0],
          },
        }),
      }),
    });
    let offlineRequests = 0;
    const offline = await fetchDayWeather({
      ...newcastleDay,
      lat: -32.93,
    }, {
      now: new Date("2026-07-25T12:00:00"),
      online: false,
      storage: brokenStorage,
      fetcher: async () => {
        offlineRequests += 1;
        throw new Error("should not fetch");
      },
    });

    assert.equal(fetched.summary, "晴 · 12-21°C");
    assert.equal(offlineRequests, 0);
    assert.equal(offline.status, "fallback");
  });

  it("refreshes an online cache that does not contain the target date", async () => {
    const perthDay = {
      ...day,
      lat: -31.9523,
      lon: 115.8613,
    };
    const nextDay = {
      ...perthDay,
      date: "2026-08-05",
    };
    let requestCount = 0;
    const fetcher = async () => {
      requestCount += 1;
      const requestedDay = requestCount === 1 ? perthDay : nextDay;
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [requestedDay.date],
            temperature_2m_max: [requestCount === 1 ? 20 : 22],
            temperature_2m_min: [requestCount === 1 ? 10 : 12],
            precipitation_probability_max: [10],
            uv_index_max: [3],
            weather_code: [requestCount === 1 ? 0 : 2],
          },
        }),
      };
    };

    await fetchDayWeather(perthDay, {
      now: new Date("2026-07-25T08:00:00"),
      fetcher,
      online: true,
      storage: null,
    });
    const refreshed = await fetchDayWeather(nextDay, {
      now: new Date("2026-07-25T09:00:00"),
      fetcher,
      online: true,
      storage: null,
    });

    assert.equal(requestCount, 2);
    assert.equal(refreshed.summary, "多云 · 12-22°C");
  });

  it("falls back offline when cached daily data omits the target date", async () => {
    const darwinDay = {
      ...day,
      lat: -12.4634,
      lon: 130.8456,
    };
    const nextDay = {
      ...darwinDay,
      date: "2026-08-05",
    };
    let requestCount = 0;
    const fetcher = async () => {
      requestCount += 1;
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [darwinDay.date],
            temperature_2m_max: [31],
            temperature_2m_min: [20],
            precipitation_probability_max: [10],
            uv_index_max: [7],
            weather_code: [0],
          },
        }),
      };
    };

    await fetchDayWeather(darwinDay, {
      now: new Date("2026-07-25T08:00:00"),
      fetcher,
      online: true,
      storage: null,
    });
    const offline = await fetchDayWeather(nextDay, {
      now: new Date("2026-07-25T09:00:00"),
      fetcher,
      online: false,
      storage: null,
    });

    assert.equal(requestCount, 1);
    assert.equal(offline.status, "fallback");
    assert.equal(offline.summary, nextDay.climateNote);
  });

  it("keeps a valid date cached after an offline same-coordinate date miss", async () => {
    const broomeDay = {
      ...day,
      lat: -17.9614,
      lon: 122.2359,
    };
    const nextDay = {
      ...broomeDay,
      date: "2026-08-05",
    };
    const storage = createMemoryStorage();
    let requestCount = 0;
    const fetcher = async () => {
      requestCount += 1;
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [broomeDay.date],
            temperature_2m_max: [29],
            temperature_2m_min: [18],
            precipitation_probability_max: [10],
            uv_index_max: [6],
            weather_code: [0],
          },
        }),
      };
    };

    await fetchDayWeather(broomeDay, {
      now: new Date("2026-07-25T08:00:00"),
      fetcher,
      online: true,
      storage,
    });
    const missingDate = await fetchDayWeather(nextDay, {
      now: new Date("2026-07-25T09:00:00"),
      fetcher,
      online: false,
      storage,
    });
    const originalDate = await fetchDayWeather(broomeDay, {
      now: new Date("2026-07-25T09:30:00"),
      fetcher,
      online: false,
      storage,
    });

    assert.equal(requestCount, 1);
    assert.equal(missingDate.status, "fallback");
    assert.equal(originalDate.status, "forecast");
    assert.equal(originalDate.summary, "晴 · 18-29°C");
  });

  it("uses a valid coordinate cache immediately while offline", async () => {
    const brisbaneDay = {
      ...day,
      lat: -27.4698,
      lon: 153.0251,
    };
    let requestCount = 0;
    const fetcher = async () => {
      requestCount += 1;
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [brisbaneDay.date],
            temperature_2m_max: [24],
            temperature_2m_min: [14],
            precipitation_probability_max: [10],
            uv_index_max: [4],
            weather_code: [1],
          },
        }),
      };
    };

    await fetchDayWeather(brisbaneDay, new Date("2026-07-25T08:00:00"), fetcher);
    const cached = await withOnlineState(false, () => (
      fetchDayWeather(brisbaneDay, new Date("2026-07-25T09:00:00"), fetcher)
    ));

    assert.equal(requestCount, 1);
    assert.equal(cached.summary, "多云 · 14-24°C");
  });

  it("falls back without requesting when offline and uncached", async () => {
    const hobartDay = {
      ...day,
      lat: -42.8821,
      lon: 147.3272,
    };
    let requestCount = 0;
    const result = await withOnlineState(false, () => (
      fetchDayWeather(hobartDay, new Date("2026-07-25T12:00:00"), async () => {
        requestCount += 1;
        return {
          ok: true,
          json: async () => ({}),
        };
      })
    ));

    assert.equal(requestCount, 0);
    assert.equal(result.status, "fallback");
    assert.equal(result.summary, hobartDay.climateNote);
  });

  it("summarizes live weather into traveler-facing text", () => {
    const result = summarizeWeather(day, {
      current: {
        temperature_2m: 25,
        apparent_temperature: 27,
        weather_code: 2,
        wind_speed_10m: 28,
      },
      daily: {
        time: ["2026-08-04"],
        temperature_2m_max: [27],
        temperature_2m_min: [18],
        precipitation_probability_max: [55],
        uv_index_max: [7],
        weather_code: [2],
      },
    }, new Date("2026-08-04T12:00:00"));

    assert.equal(result.status, "live");
    assert.equal(result.summary, "多云 · 18-27°C · 现在 25°C");
    assert.match(result.detail, /有雨/);
    assert.match(result.detail, /防风外套/);
    assert.match(result.detail, /防晒衣/);
  });

  it("summarizes future forecast without current temperature", () => {
    const result = summarizeWeather(day, {
      current: {
        temperature_2m: 25,
        apparent_temperature: 27,
        weather_code: 2,
        wind_speed_10m: 28,
      },
      daily: {
        time: ["2026-08-04"],
        temperature_2m_max: [27],
        temperature_2m_min: [18],
        precipitation_probability_max: [55],
        uv_index_max: [7],
        weather_code: [1],
      },
    }, new Date("2026-07-25T12:00:00"));

    assert.equal(result.status, "forecast");
    assert.equal(result.summary, "多云 · 18-27°C");
    assert.doesNotMatch(result.summary, /现在/);
    assert.doesNotMatch(result.detail, /体感/);
  });

  it("falls back when daily data does not contain the target date", () => {
    const result = summarizeWeather(day, {
      daily: {
        time: ["2026-08-03"],
        temperature_2m_max: [99],
        temperature_2m_min: [88],
        precipitation_probability_max: [100],
        uv_index_max: [12],
        weather_code: [95],
      },
    }, new Date("2026-07-25T12:00:00"));

    assert.equal(result.status, "fallback");
    assert.equal(result.summary, day.climateNote);
    assert.equal(result.detail, day.clothingNote);
  });

  it("keeps fallback clothing advice when no weather warning applies", () => {
    assert.equal(
      buildWeatherAdvice({ rain: 10, uv: 2, wind: 10, fallback: "带薄外套" }),
      "带薄外套"
    );
  });
});
