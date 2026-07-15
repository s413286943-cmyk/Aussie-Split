import "server-only";

import itinerary from "../../data/itinerary.generated.json" with { type: "json" };
import { buildDayCarryChecklist, parseMealPlan } from "../today.js";

const DAY_ID_PATTERN = /^d(?:[0-9]|1[0-6])$/;
const WEATHER_STATUSES = new Set(["live", "forecast", "fallback"]);

export function buildBriefContext({ dayId, weather, checkedKitItemIds = [] }) {
  const day = findDay(dayId);
  const dayIndex = itinerary.days.findIndex((entry) => entry.id === day.id);
  const tomorrowDay = itinerary.days[dayIndex + 1] || null;
  const allowedCheckedIds = new Set(Array.isArray(checkedKitItemIds) ? checkedKitItemIds : []);
  const checklist = buildDayCarryChecklist(day).map((item) => ({
    id: item.id,
    label: item.label,
    detail: item.detail,
    checked: allowedCheckedIds.has(item.id),
  }));

  return {
    scope: "today",
    sourceDayIds: [day.id],
    day: projectDay(day),
    weather: normalizeWeather(weather, day),
    checklist,
    facts: buildBlockFacts(day),
    tomorrow: tomorrowDay ? {
      dayId: tomorrowDay.id,
      title: tomorrowDay.title,
      checklist: buildDayCarryChecklist(tomorrowDay).map(projectChecklistItem),
    } : null,
  };
}

export function buildTripIndex() {
  return itinerary.days.map((day) => ({
    id: day.id,
    date: day.date,
    city: day.city,
    title: day.title,
    focus: day.focus,
    transport: day.transport,
    stops: buildBlockFacts(day).slice(0, 4).map((fact) => fact.title),
  }));
}

export function findDay(dayId) {
  if (typeof dayId !== "string" || !DAY_ID_PATTERN.test(dayId)) throw new TypeError("Invalid day id");
  const day = itinerary.days.find((entry) => entry.id === dayId);
  if (!day) throw new TypeError("Invalid day id");
  return day;
}

function projectDay(day) {
  return {
    id: day.id,
    label: day.label,
    date: day.date,
    weekday: day.weekday,
    city: day.city,
    title: day.title,
    focus: day.focus,
    transport: day.transport,
    leaveBy: day.leaveBy,
    lodging: day.lodging,
    climateNote: day.climateNote,
    clothingNote: day.clothingNote,
    meals: parseMealPlan(day),
    resources: collectAllowedResources(day),
  };
}

function buildBlockFacts(day) {
  return (day.blocks || []).filter((block) => block.period !== "饮食").map((block) => ({
    id: `block:${day.id}:${block.sortOrder}`,
    period: block.period,
    title: block.place,
    activity: block.activity,
    highlight: block.highlight,
    tip: block.tip,
  }));
}

function collectAllowedResources(day) {
  const resources = [
    day.lodgingResource,
    day.primaryResource,
    day.ticketResource,
    ...(day.blocks || []).flatMap((block) => block.resources || []),
  ];
  const seen = new Set();

  return resources.filter(Boolean).filter((resource) => {
    if (seen.has(resource.id)) return false;
    seen.add(resource.id);
    return true;
  }).map((resource) => ({ id: resource.id, title: resource.title, type: resource.type }));
}

function normalizeWeather(weather, day) {
  const fallback = {
    status: "fallback",
    summary: day.climateNote,
    adviceLabel: "季节穿衣参考",
    detail: day.clothingNote,
  };
  if (!weather || !WEATHER_STATUSES.has(weather.status)) return fallback;

  return {
    status: weather.status,
    summary: safeText(weather.summary, 120) || fallback.summary,
    adviceLabel: safeText(weather.adviceLabel, 40) || fallback.adviceLabel,
    detail: safeText(weather.detail, 160) || fallback.detail,
  };
}

function projectChecklistItem(item) {
  return { id: item.id, label: item.label, detail: item.detail };
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
