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

  it("keeps fallback clothing advice when no weather warning applies", () => {
    assert.equal(
      buildWeatherAdvice({ rain: 10, uv: 2, wind: 10, fallback: "带薄外套" }),
      "带薄外套"
    );
  });
});
