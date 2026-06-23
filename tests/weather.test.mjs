import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildForecastUrl,
  forecastCanCoverDate,
  getWeatherPlace,
  makeClothingAdvice,
} from "../src/lib/weather.js";

describe("weather helpers", () => {
  it("maps trip cities to forecast places", () => {
    assert.equal(getWeatherPlace("凯恩斯").name, "Cairns");
    assert.equal(getWeatherPlace("丹翠雨林").name, "Daintree");
    assert.equal(getWeatherPlace("悉尼弹性一日游").name, "Sydney");
  });

  it("builds an Open-Meteo forecast URL without an API key", () => {
    const url = buildForecastUrl(getWeatherPlace("悉尼"), "2026-08-09", "2026-08-09");
    const params = new URL(url).searchParams;

    assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    assert.equal(params.get("daily"), "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max");
    assert.equal(params.get("timezone"), "Australia/Sydney");
  });

  it("only treats near-term forecasts as live", () => {
    assert.equal(forecastCanCoverDate("2026-07-20", "2026-07-28"), true);
    assert.equal(forecastCanCoverDate("2026-06-23", "2026-07-28"), false);
  });

  it("creates traveler-facing clothing advice", () => {
    assert.equal(
      makeClothingAdvice({ maxTemp: 13, rainMm: 2, windKph: 38, uvIndex: 2 }, "海边风大"),
      "偏冷又有风，穿防风外套；可能下雨，鞋子尽量防水。海边风大",
    );
    assert.equal(
      makeClothingAdvice({ maxTemp: 27, rainMm: 0, windKph: 12, uvIndex: 8 }, "船舱空调可能冷"),
      "白天热，注意防晒；紫外线强，带帽子和墨镜。船舱空调可能冷",
    );
  });
});
