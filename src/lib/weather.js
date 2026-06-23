const places = [
  { match: /墨尔本|Apollo Bay|Port Campbell|大洋路/i, name: "Melbourne", latitude: -37.8136, longitude: 144.9631, timezone: "Australia/Melbourne" },
  { match: /凯恩斯/i, name: "Cairns", latitude: -16.9186, longitude: 145.7781, timezone: "Australia/Brisbane" },
  { match: /丹翠|Daintree|Cape Tribulation/i, name: "Daintree", latitude: -16.25, longitude: 145.32, timezone: "Australia/Brisbane" },
  { match: /阿瑟顿|Atherton/i, name: "Atherton", latitude: -17.2686, longitude: 145.4752, timezone: "Australia/Brisbane" },
  { match: /蓝山|Katoomba/i, name: "Blue Mountains", latitude: -33.7125, longitude: 150.3119, timezone: "Australia/Sydney" },
  { match: /南海岸|Kiama|Wollongong|Grand Pacific/i, name: "Kiama", latitude: -34.668, longitude: 150.8527, timezone: "Australia/Sydney" },
  { match: /悉尼|Sydney|Bondi|Manly/i, name: "Sydney", latitude: -33.8688, longitude: 151.2093, timezone: "Australia/Sydney" },
];

const dailyFields = "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max";

export function getWeatherPlace(city) {
  return places.find((place) => place.match.test(city)) || places[0];
}

export function buildForecastUrl(place, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    daily: dailyFields,
    timezone: place.timezone,
    start_date: startDate,
    end_date: endDate,
  });

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function forecastCanCoverDate(todayIso, targetIso) {
  const today = new Date(`${todayIso}T00:00:00Z`);
  const target = new Date(`${targetIso}T00:00:00Z`);
  const diffDays = Math.floor((target - today) / 86400000);

  return diffDays >= 0 && diffDays <= 16;
}

export function makeClothingAdvice(weather, manualNote = "") {
  const parts = [];

  if (weather.maxTemp <= 14) parts.push("偏冷");
  else if (weather.maxTemp >= 26) parts.push("白天热，注意防晒");
  else parts.push("温度舒服");

  if (weather.windKph >= 30) parts[0] = `${parts[0]}又有风`;
  if (weather.maxTemp <= 14 || weather.windKph >= 30) parts[0] = `${parts[0]}，穿防风外套`;
  if (weather.rainMm > 0) parts.push("可能下雨，鞋子尽量防水");
  if (weather.uvIndex >= 7) parts.push("紫外线强，带帽子和墨镜");

  const sentence = `${parts.join("；")}。`;
  return manualNote ? `${sentence}${manualNote}` : sentence;
}

export async function fetchDayWeather(day, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!forecastCanCoverDate(todayIso, day.date)) return null;

  const place = getWeatherPlace(day.city);
  const response = await fetch(buildForecastUrl(place, day.date, day.date));
  if (!response.ok) throw new Error("Unable to load weather");

  const data = await response.json();

  return {
    place: place.name,
    maxTemp: Number(data.daily.temperature_2m_max[0]),
    minTemp: Number(data.daily.temperature_2m_min[0]),
    rainMm: Number(data.daily.precipitation_sum[0]),
    windKph: Number(data.daily.wind_speed_10m_max[0]),
    uvIndex: Number(data.daily.uv_index_max[0]),
  };
}
