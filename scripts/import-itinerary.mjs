import fs from "node:fs";
import path from "node:path";

import { runPython } from "./pythonRunner.mjs";

export const workbookPath = path.join("content", "aussie-itinerary.xlsx");
export const outputPath = path.join("src", "data", "itinerary.generated.json");

const requiredDayColumns = [
  "day_id",
  "day_label",
  "date",
  "weekday",
  "city",
  "lat",
  "lon",
  "title",
  "focus",
  "lodging",
  "climate_note",
  "clothing_note",
  "cover_image_url",
  "cover_image_alt",
];
const requiredBlockColumns = ["day_id", "sort_order", "period", "place", "activity", "highlight", "tip", "resource_ids"];
const requiredResourceColumns = ["resource_id", "title", "type", "url", "image_url", "image_alt", "source_note"];
const resourceTypes = new Set(["map", "official", "booking", "restaurant", "photo", "note"]);

export function readWorkbook(sourcePath = workbookPath) {
  const workbook = JSON.parse(runPython(["scripts/itinerary_excel.py", "read", sourcePath]));
  const days = readSheet(workbook, "Days", requiredDayColumns).map(normalizeDay);
  const blocks = readSheet(workbook, "Blocks", requiredBlockColumns).map(normalizeBlock);
  const resources = readSheet(workbook, "Resources", requiredResourceColumns).map(normalizeResource);

  return buildItinerary(days, blocks, resources);
}

export function buildItinerary(days, blocks, resources) {
  validateRows(days, blocks, resources);

  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
  const blockGroups = new Map();
  for (const block of blocks) {
    const linkedResources = block.resourceIds.map((id) => resourceMap.get(id));
    const next = { ...block, resources: linkedResources };
    delete next.resourceIds;
    if (!blockGroups.has(block.dayId)) blockGroups.set(block.dayId, []);
    blockGroups.get(block.dayId).push(next);
  }

  const itineraryDays = days.map((day) => ({
    ...day,
    blocks: (blockGroups.get(day.id) || []).sort((left, right) => left.sortOrder - right.sortOrder),
  }));

  return {
    trip: {
      title: "Aussie Chill",
      subtitle: "南十字星下的十六日",
      dates: "2026.07.28-08.13",
      route: "上海出发 · 墨尔本进 · 悉尼出",
      coverImageUrl: "/itinerary/cover-australia-editorial.png",
      coverImageAlt: "澳洲十六日旅行封面",
    },
    stages: [
      { id: "melbourne-road", title: "墨尔本 + 大洋路", dayIds: ["d1", "d2", "d3", "d4", "d5"], imageUrl: "/itinerary/great-ocean-road-coast.png" },
      { id: "cairns", title: "凯恩斯热带暖冬", dayIds: ["d6", "d7", "d8", "d9", "d10"], imageUrl: "/itinerary/cairns-reef-lagoon.png" },
      { id: "sydney", title: "悉尼 + 南海岸", dayIds: ["d11", "d12", "d13", "d14", "d15"], imageUrl: "/itinerary/sydney-harbor-evening.png" },
    ],
    days: itineraryDays,
    resources,
  };
}

export function writeItinerary(sourcePath = workbookPath, destinationPath = outputPath) {
  const itinerary = readWorkbook(sourcePath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, `${JSON.stringify(itinerary, null, 2)}\n`);
  return itinerary;
}

function readSheet(workbook, sheetName, requiredColumns) {
  const rows = workbook[sheetName];
  if (!rows) throw new Error(`Missing sheet: ${sheetName}`);
  for (const column of requiredColumns) {
    if (!rows[0] || !(column in rows[0])) throw new Error(`Missing ${sheetName}.${column}`);
  }
  return rows;
}

function normalizeDay(row) {
  return {
    id: text(row.day_id),
    label: text(row.day_label),
    date: normalizeDate(row.date),
    weekday: text(row.weekday),
    city: text(row.city),
    lat: Number(row.lat),
    lon: Number(row.lon),
    title: text(row.title),
    focus: text(row.focus),
    lodging: text(row.lodging),
    climateNote: text(row.climate_note),
    clothingNote: text(row.clothing_note),
    coverImageUrl: text(row.cover_image_url),
    coverImageAlt: text(row.cover_image_alt),
  };
}

function normalizeBlock(row) {
  return {
    dayId: text(row.day_id),
    sortOrder: Number(row.sort_order),
    period: text(row.period),
    place: text(row.place),
    activity: text(row.activity),
    highlight: text(row.highlight),
    tip: text(row.tip),
    resourceIds: text(row.resource_ids).split(",").map((item) => item.trim()).filter(Boolean),
  };
}

function normalizeResource(row) {
  return {
    id: text(row.resource_id),
    title: text(row.title),
    type: text(row.type),
    url: text(row.url),
    imageUrl: text(row.image_url),
    imageAlt: text(row.image_alt),
    sourceNote: text(row.source_note),
  };
}

function validateRows(days, blocks, resources) {
  const ids = days.map((day) => day.id);
  if (days.length !== 17) throw new Error(`Expected 17 days, got ${days.length}`);
  if (ids[0] !== "d0" || ids[16] !== "d16") throw new Error("Expected D0-D16 day ids");
  if (days[0].date !== "2026-07-28" || days[16].date !== "2026-08-13") {
    throw new Error("Expected itinerary dates from 2026-07-28 to 2026-08-13");
  }

  const dayIds = new Set(ids);
  const resourceIds = new Set(resources.map((resource) => resource.id));

  for (const day of days) {
    for (const field of ["id", "label", "date", "weekday", "city", "title", "focus", "climateNote", "clothingNote", "coverImageUrl"]) {
      if (!day[field]) throw new Error(`Missing day field ${day.id}.${field}`);
    }
    if (!Number.isFinite(day.lat) || !Number.isFinite(day.lon)) throw new Error(`Missing coordinates for ${day.id}`);
  }

  for (const resource of resources) {
    if (!resource.id || !resource.title || !resourceTypes.has(resource.type)) throw new Error(`Invalid resource ${resource.id || resource.title}`);
    if (resource.type !== "note" && !resource.url) throw new Error(`Missing URL for ${resource.id}`);
  }

  for (const block of blocks) {
    if (!dayIds.has(block.dayId)) throw new Error(`Unknown block day_id ${block.dayId}`);
    if (!Number.isFinite(block.sortOrder)) throw new Error(`Invalid sort_order for ${block.dayId}`);
    for (const resourceId of block.resourceIds) {
      if (!resourceIds.has(resourceId)) throw new Error(`Unknown resource_id ${resourceId} in ${block.dayId}`);
    }
  }
}

function normalizeDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
}

function text(value) {
  return String(value ?? "").trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const itinerary = writeItinerary();
  console.log(`Imported ${itinerary.days.length} days to ${outputPath}`);
}
