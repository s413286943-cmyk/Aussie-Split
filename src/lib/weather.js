const forecastDays = 16;

export function buildWeatherUrl(day) {
  if (!hasCoordinates(day)) return "";
  const params = new URLSearchParams({
    latitude: String(day.lat),
    longitude: String(day.lon),
    current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,weather_code",
    timezone: "auto",
    forecast_days: String(forecastDays),
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function isForecastAvailable(date, now = new Date()) {
  return getWeatherStatus(date, now) !== "fallback";
}

export function getWeatherStatus(date, now = new Date()) {
  const target = parseDate(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "live";
  if (diffDays > 0 && diffDays < forecastDays) return "forecast";
  return "fallback";
}

export function fallbackWeather(day) {
  return {
    status: "fallback",
    summary: day.climateNote,
    detail: day.clothingNote,
  };
}

export async function fetchDayWeather(day, now = new Date(), fetcher = fetch) {
  if (getWeatherStatus(day.date, now) === "fallback" || !hasCoordinates(day)) return fallbackWeather(day);

  try {
    const response = await fetcher(buildWeatherUrl(day));
    if (!response.ok) return fallbackWeather(day);
    const data = await response.json();
    return summarizeWeather(day, data, now);
  } catch {
    return fallbackWeather(day);
  }
}

export function summarizeWeather(day, data, now = new Date()) {
  const status = getWeatherStatus(day.date, now);
  const current = data.current || {};
  const daily = data.daily || {};
  const index = Math.max(0, (daily.time || []).indexOf(day.date));
  const max = readArray(daily.temperature_2m_max, index);
  const min = readArray(daily.temperature_2m_min, index);
  const rain = readArray(daily.precipitation_probability_max, index);
  const uv = readArray(daily.uv_index_max, index);
  const wind = status === "live" ? current.wind_speed_10m : undefined;
  const currentTemp = status === "live" ? current.temperature_2m : undefined;
  const apparent = status === "live" ? current.apparent_temperature : undefined;
  const condition = weatherCodeLabel(status === "live" ? current.weather_code ?? readArray(daily.weather_code, index) : readArray(daily.weather_code, index));
  const range = Number.isFinite(min) && Number.isFinite(max) ? `${Math.round(min)}-${Math.round(max)}°C` : "";
  const nowText = Number.isFinite(currentTemp) ? `现在 ${Math.round(currentTemp)}°C` : "";
  const feelsText = Number.isFinite(apparent) ? `体感 ${Math.round(apparent)}°C` : "";

  return {
    status,
    summary: [condition, range, nowText].filter(Boolean).join(" · "),
    detail: buildWeatherAdvice({ rain, uv, wind, feelsText, fallback: day.clothingNote }),
  };
}

export function buildWeatherAdvice({ rain, uv, wind, feelsText, fallback }) {
  const advice = [];
  if (feelsText) advice.push(feelsText);
  if (Number.isFinite(rain) && rain >= 50) advice.push("有雨，鞋子尽量防水");
  if (Number.isFinite(wind) && wind >= 25) advice.push("风大，防风外套更重要");
  if (Number.isFinite(uv) && uv >= 6) advice.push("UV 偏高，防晒衣和帽子要带");
  return advice.length ? advice.join("，") : fallback;
}

function hasCoordinates(day) {
  return Number.isFinite(Number(day.lat)) && Number.isFinite(Number(day.lon));
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function readArray(values, index) {
  if (!Array.isArray(values)) return undefined;
  return Number(values[index]);
}

function weatherCodeLabel(code) {
  if (code === 0) return "晴";
  if ([1, 2, 3].includes(code)) return "多云";
  if ([45, 48].includes(code)) return "有雾";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "有雨";
  if ([95, 96, 99].includes(code)) return "雷阵雨";
  return "天气";
}
