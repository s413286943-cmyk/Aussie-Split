import "server-only";

import itinerary from "../../data/itinerary.generated.json" with { type: "json" };
import { buildDayCarryChecklist, parseMealPlan } from "../today.js";

const DAY_ID_PATTERN = /^d(?:[0-9]|1[0-6])$/;
const WEATHER_STATUSES = new Set(["live", "forecast", "fallback"]);
const MAX_EXTRA_ROUTED_DAYS = 3;
const DAY_ORDER = new Map(itinerary.days.map((day, index) => [day.id, index]));
const ROUTING_STAGES = [
  { id: "melbourne-road", aliases: ["melbourne", "墨尔本"] },
  { id: "cairns", aliases: ["cairns", "凯恩斯"] },
  { id: "sydney", aliases: ["sydney", "悉尼"] },
].map((entry) => ({
  ...entry,
  dayIds: itinerary.stages.find((stage) => stage.id === entry.id)?.dayIds || [],
}));
const ENGLISH_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const ROUTING_WORDS_TO_IGNORE = new Set([
  "all", "and", "arrange", "at", "can", "day", "days", "do", "does",
  "for", "get", "go", "how", "if", "in", "is", "itinerary", "on", "or",
  "plan", "should", "the", "to", "today", "tomorrow", "trip", "visit", "we",
  "what", "when", "where", "which", "whole",
  ...ENGLISH_MONTHS,
  ...ENGLISH_MONTHS.map((month) => month.slice(0, 3)),
  ...ROUTING_STAGES.flatMap((stage) => stage.aliases.filter((alias) => /^[a-z]+$/.test(alias))),
]);
const ROUTING_PHRASES_TO_IGNORE = [
  "导航顺序", "提前准备", "当天无", "整个行程", "所有天", "哪一天", "哪两天", "怎么安排",
  "怎么调整", "怎么去", "怎么走", "放在哪里", "最适合", "最轻松", "今天", "明天",
  "下雨", "太累", "可以", "午餐", "晚餐", "早餐", "准备", "安排", "调整", "什么",
  "哪里", "在哪", "哪天", "最累", "最松", "最顺", "会去", "如果", "全程", "整趟",
  "都看看", "一天", "几天", "提前", "路线", "导航", "顺序", "放在", "如何", "要", "的", "呢", "吗", "去",
];

/**
 * @param {{
 *   dayId: string,
 *   weather?: {
 *     status?: string,
 *     summary?: string,
 *     adviceLabel?: string,
 *     detail?: string,
 *   },
 *   checkedKitItemIds?: string[],
 * }} input
 */
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

export function routeTravelQuestion({ currentDayId, question }) {
  const currentDay = findDay(currentDayId);
  const rawQuestion = normalizeRoutingSource(question);
  const normalizedQuestion = normalizeRoutingText(rawQuestion);
  const matchedIds = new Set();
  const priorities = new Map();
  const invalidDayReference = collectDayReferences(normalizedQuestion, matchedIds, priorities);
  const unmatchedDateReference = collectDateReferences(rawQuestion, normalizedQuestion, matchedIds, priorities);
  const matchedStages = ROUTING_STAGES.filter((stage) => (
    stage.aliases.some((alias) => hasRoutingAlias(rawQuestion, normalizedQuestion, alias))
  ));

  for (const stage of matchedStages) {
    for (const dayId of stage.dayIds) {
      matchedIds.add(dayId);
      setRoutingPriority(priorities, dayId, 0);
    }
  }

  const terms = extractRoutingTerms(normalizedQuestion, rawQuestion);
  const hasResidualRoutingTarget = terms.english.length > 0 || terms.chinese.length > 0;
  const hasNamedRoutingTerm = terms.english.some((term) => !["rest", "relax"].includes(term))
    || terms.chinese.some((term) => term.length >= 3);
  let hasCityMatch = false;

  for (const day of itinerary.days) {
    if (!routingCityMatches(day.city, terms)) continue;
    hasCityMatch = true;
    matchedIds.add(day.id);
    setRoutingPriority(priorities, day.id, 15);
  }

  const stageDayIds = new Set(matchedStages.flatMap((stage) => stage.dayIds));
  const searchableDays = matchedStages.length > 0
    ? itinerary.days.filter((day) => stageDayIds.has(day.id))
    : itinerary.days;
  let hasNamedEntityMatch = false;

  for (const day of searchableDays) {
    const score = routingMatchScore(day, terms);
    if (score === 0) continue;
    if (hasNamedRoutingTerm) hasNamedEntityMatch = true;
    matchedIds.add(day.id);
    setRoutingPriority(priorities, day.id, matchedStages.length > 0 ? score : 10);
  }

  const matchedDayIds = itinerary.days
    .filter((day) => matchedIds.has(day.id))
    .map((day) => day.id);
  const explicitlyScoped = invalidDayReference
    || unmatchedDateReference
    || matchedStages.length > 0
    || hasCityMatch
    || hasNamedEntityMatch
    || [...priorities.values()].some((priority) => priority === 20);
  const wholeTrip = /全程|整趟|整个行程|所有天/u.test(normalizedQuestion)
    || (/哪(?:一|两|些)?天/u.test(normalizedQuestion) && !explicitlyScoped);

  if (wholeTrip) {
    return {
      scope: "trip",
      sourceDayIds: [currentDay.id],
      matchedDayIds,
      unmatched: invalidDayReference
        || unmatchedDateReference
        || (hasResidualRoutingTarget && matchedDayIds.length === 0),
      currentDay: projectRoutedDay(currentDay),
      matchedDays: [],
      tripIndex: buildTripIndex(),
    };
  }

  const extraDayIds = matchedDayIds
    .filter((dayId) => dayId !== currentDay.id)
    .sort((left, right) => (
      (priorities.get(right) || 0) - (priorities.get(left) || 0)
      || DAY_ORDER.get(left) - DAY_ORDER.get(right)
    ))
    .slice(0, MAX_EXTRA_ROUTED_DAYS);
  const unmatched = matchedDayIds.length === 0 && (
    invalidDayReference
    || unmatchedDateReference
    || (hasResidualRoutingTarget && /怎么\s*(?:走|去|到)|路线|导航/u.test(normalizedQuestion))
  );

  return {
    scope: matchedStages.length > 0 || hasCityMatch ? "city" : "day",
    sourceDayIds: [currentDay.id, ...extraDayIds],
    matchedDayIds,
    unmatched,
    currentDay: projectRoutedDay(currentDay),
    matchedDays: extraDayIds.map((dayId) => projectRoutedDay(findDay(dayId))),
    tripIndex: [],
  };
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

function projectRoutedDay(day) {
  return {
    ...projectDay(day),
    facts: buildBlockFacts(day),
  };
}

function collectDayReferences(question, matchedIds, priorities) {
  const patterns = [
    /(?:^|[^a-z0-9])d\s*(\d{1,2})(?![a-z0-9])/gu,
    /(?:^|[^a-z0-9])day\s*(\d{1,2})(?![a-z0-9])/gu,
    /第\s*(\d{1,2})\s*天/gu,
  ];
  let invalid = false;

  for (const pattern of patterns) {
    for (const match of question.matchAll(pattern)) {
      const dayId = `d${Number(match[1])}`;
      if (!DAY_ORDER.has(dayId)) {
        invalid = true;
        continue;
      }
      matchedIds.add(dayId);
      setRoutingPriority(priorities, dayId, 20);
    }
  }

  return invalid;
}

function collectDateReferences(question, normalizedQuestion, matchedIds, priorities) {
  const sawReference = /\d{4}\s+\d{1,2}\s+\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/u.test(normalizedQuestion)
    || /\d{1,2}\s*月\s*\d{1,2}\s*[日号]/u.test(question);
  const explicitYears = new Set(
    [...normalizedQuestion.matchAll(/(?:^|[^\d])(\d{4})(?!\d)/gu)].map((match) => match[1]),
  );
  let matched = false;

  for (const day of itinerary.days) {
    const [year, monthText, dayText] = day.date.split("-");
    const month = Number(monthText);
    const date = Number(dayText);
    const monthName = ENGLISH_MONTHS[month - 1];
    const isoPattern = new RegExp(`(?:^|[^\\d])${year}\\s+0?${month}\\s+0?${date}(?!\\d)`, "u");
    const chinesePattern = new RegExp(`(?:^|[^\\d])0?${month}\\s*月\\s*0?${date}\\s*[日号](?!\\d)`, "u");
    const englishPattern = new RegExp(`(?:^|[^a-z0-9])(?:${monthName.slice(0, 3)}|${monthName})\\s+0?${date}(?!\\d)`, "u");

    const yearMatches = explicitYears.size === 0 || explicitYears.has(year);
    if (!isoPattern.test(normalizedQuestion)
      && !(yearMatches && chinesePattern.test(question))
      && !(yearMatches && englishPattern.test(normalizedQuestion))) continue;
    matched = true;
    matchedIds.add(day.id);
    setRoutingPriority(priorities, day.id, 20);
  }

  return sawReference && !matched;
}

function extractRoutingTerms(question, sourceQuestion) {
  const englishGroups = sourceQuestion
    .split(/[、,，;；/|]|\b(?:and|or)\b|[和与及或]/gu)
    .map((part) => [...normalizeRoutingText(part).matchAll(/[a-z][a-z0-9]*/gu)]
      .map((match) => match[0])
      .filter(isMeaningfulEnglishRoutingWord))
    .filter((group) => group.length > 0);
  const english = englishGroups.flat();
  let chinese = question.replace(/[^\p{Script=Han}\s]+/gu, " ");

  for (const alias of ROUTING_STAGES.flatMap((stage) => stage.aliases)) {
    if (/\p{Script=Han}/u.test(alias)) chinese = chinese.replaceAll(alias, " ");
  }
  for (const phrase of ROUTING_PHRASES_TO_IGNORE) chinese = chinese.replaceAll(phrase, " ");
  chinese = chinese.replace(/[和与及或]/gu, " ");

  return {
    english: [...new Set(english)],
    englishGroups: englishGroups.map((group) => [...new Set(group)]),
    chinese: [...new Set(chinese.split(/\s+/u).filter((term) => term.length >= 2))],
  };
}

function isMeaningfulEnglishRoutingWord(word) {
  return !ROUTING_WORDS_TO_IGNORE.has(word)
    && !/^(?:d|day)\d{1,2}$/u.test(word)
    && (word.length >= 3 || /^[a-z]\d$/u.test(word));
}

function routingMatchScore(day, terms) {
  const fields = [
    { value: day.title, score: 3 },
    ...(day.blocks || []).filter((block) => block.period !== "饮食").flatMap((block) => [
      { value: block.place, score: 2 },
      { value: block.activity, score: 1 },
      ...(block.resources || []).filter(isSpecificRoutingResource).map((resource) => ({
        value: resource.title,
        score: 2,
      })),
    ]),
    ...[day.lodgingResource, day.primaryResource, day.ticketResource]
      .filter(isSpecificRoutingResource)
      .map((resource) => ({ value: resource.title, score: 2 })),
  ];
  const matchedEnglish = new Set();
  let englishScore = 0;
  let chineseScore = 0;

  for (const field of fields) {
    const normalized = normalizeRoutingText(field.value);
    const englishWords = new Set(normalized.match(/[a-z][a-z0-9]*/gu) || []);
    for (const term of terms.english) {
      if (!englishWords.has(term)) continue;
      matchedEnglish.add(term);
      englishScore = Math.max(englishScore, field.score);
    }

    const compact = normalized.replace(/\s+/gu, "");
    if (/休息|休整/u.test(compact)) {
      for (const term of terms.english.filter((entry) => ["rest", "relax"].includes(entry))) {
        matchedEnglish.add(term);
        englishScore = Math.max(englishScore, field.score);
      }
    }
    if (terms.chinese.some((term) => compact.includes(term))) {
      chineseScore = Math.max(chineseScore, field.score);
    }
  }
  const englishGroupMatched = terms.englishGroups.some((group) => (
    group.every((term) => matchedEnglish.has(term))
  ));
  return Math.max(englishGroupMatched ? englishScore : 0, chineseScore);
}

function routingCityMatches(value, terms) {
  const cityTerms = normalizeRoutingText(value).split(/\s+/u);
  return terms.englishGroups.some((group) => group.every((term) => cityTerms.includes(term)))
    || terms.chinese.some((term) => cityTerms.includes(term));
}

function isSpecificRoutingResource(resource) {
  return Boolean(resource && resource.id !== "no-fixed-ticket");
}

function hasRoutingAlias(question, normalizedQuestion, alias) {
  if (/^[a-z]+$/u.test(alias)) {
    return new RegExp(`(?:^|[^a-z0-9])${alias}(?![a-z0-9])`, "u").test(normalizedQuestion);
  }
  return question.includes(alias);
}

function setRoutingPriority(priorities, dayId, priority) {
  priorities.set(dayId, Math.max(priorities.get(dayId) || 0, priority));
}

function normalizeRoutingSource(value) {
  return typeof value === "string" ? value.normalize("NFKC").toLocaleLowerCase("en-US") : "";
}

function normalizeRoutingText(value) {
  return normalizeRoutingSource(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
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
