import fs from "node:fs";
import path from "node:path";

import { runPython } from "../pythonRunner.mjs";

export const workbookPath = path.join("content", "nz2027-itinerary.xlsx");
export const outputPath = path.join("src", "data", "nz2027-itinerary.generated.json");
export const imageDirectory = path.join("public", "nz2027");
const imageExtensions = ["webp", "jpg", "jpeg", "png"];

// Theme pictures are picked up by file name: public/nz2027/d01.jpg … d17.jpg and cover.jpg.
export function findThemeImage(name, directory = imageDirectory) {
  for (const extension of imageExtensions) {
    if (fs.existsSync(path.join(directory, `${name}.${extension}`))) return `/nz2027/${name}.${extension}`;
  }
  return "";
}

export const expectedTrip = {
  dayCount: 17,
  firstDate: "2027-02-01",
  lastDate: "2027-02-17",
};

const requiredColumns = {
  Trip: ["key", "value"],
  Stages: ["stage_id", "title", "day_ids", "image_url", "summary"],
  Days: [
    "day_id",
    "day_label",
    "date",
    "weekday",
    "city",
    "base",
    "lat",
    "lon",
    "title",
    "focus",
    "lodging",
    "lodging_status",
    "climate_note",
    "clothing_note",
    "cover_image_url",
    "cover_image_alt",
    "transport",
    "leave_by",
    "lodging_resource_id",
    "primary_resource_id",
    "ticket_resource_id",
    "drive_id",
    "notes",
  ],
  Blocks: ["day_id", "sort_order", "period", "place", "activity", "highlight", "tip", "resource_ids"],
  Drives: ["drive_id", "day_id", "title", "duration", "sequence", "notes", "resource_ids"],
  DriveLegs: ["drive_id", "sort_order", "segment", "drive_time", "stop_note"],
  Lodgings: ["sort_order", "check_in", "check_out", "name", "room", "detail", "resource_id", "status", "free_cancel_until", "after_deadline"],
  Todos: ["todo_id", "sort_order", "kind", "due_date", "due_label", "title", "detail"],
  Advice: ["sort_order", "title", "verdict", "day_ids", "detail", "action", "resource_ids"],
  Resources: ["resource_id", "title", "type", "url", "image_url", "image_alt", "source_note"],
};
const resourceTypes = new Set(["map", "official", "booking", "restaurant", "photo", "note"]);
const lodgingStatuses = new Set(["已订", "待订", "无需住宿"]);
const todoKinds = new Set(["book", "pay", "deadline", "prep"]);

export function readWorkbook(sourcePath = workbookPath) {
  const workbook = JSON.parse(runPython(["scripts/itinerary_excel.py", "read_all", sourcePath]));
  const sheets = Object.fromEntries(
    Object.keys(requiredColumns).map((sheetName) => [sheetName, readSheet(workbook, sheetName, requiredColumns[sheetName])]),
  );
  return buildItinerary(sheets);
}

export function buildItinerary(sheets) {
  const resources = sheets.Resources.map(normalizeResource);
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
  const linkResources = (ids, owner) => ids.map((id) => {
    const resource = resourceMap.get(id);
    if (!resource) throw new Error(`Unknown resource_id ${id} in ${owner}`);
    return resource;
  });

  const tripRows = Object.fromEntries(sheets.Trip.map((row) => [text(row.key), text(row.value)]));
  const stages = sheets.Stages.map((row) => ({
    id: text(row.stage_id),
    title: text(row.title),
    dayIds: list(row.day_ids),
    imageUrl: text(row.image_url),
    summary: text(row.summary),
  }));

  const legsByDrive = groupBy(
    sheets.DriveLegs.map((row) => ({
      driveId: text(row.drive_id),
      sortOrder: Number(row.sort_order),
      segment: text(row.segment),
      driveTime: text(row.drive_time),
      stopNote: text(row.stop_note),
    })),
    (leg) => leg.driveId,
  );
  const drives = sheets.Drives.map((row) => {
    const id = text(row.drive_id);
    const legs = (legsByDrive.get(id) || []).sort(bySortOrder).map((leg) => {
      const next = { ...leg };
      delete next.driveId;
      return next;
    });
    return {
      id,
      dayId: text(row.day_id),
      title: text(row.title),
      duration: text(row.duration),
      sequence: text(row.sequence),
      notes: text(row.notes),
      legs,
      resources: linkResources(list(row.resource_ids), id),
    };
  });
  const driveMap = new Map(drives.map((drive) => [drive.id, drive]));

  const blocksByDay = groupBy(
    sheets.Blocks.map((row) => ({
      dayId: text(row.day_id),
      sortOrder: Number(row.sort_order),
      period: text(row.period),
      place: text(row.place),
      activity: text(row.activity),
      highlight: text(row.highlight),
      tip: text(row.tip),
      resources: linkResources(list(row.resource_ids), `${text(row.day_id)} block ${row.sort_order}`),
    })),
    (block) => block.dayId,
  );

  const days = sheets.Days.map((row) => {
    const id = text(row.day_id);
    const driveId = text(row.drive_id);
    return {
      id,
      label: text(row.day_label),
      date: normalizeDate(row.date),
      weekday: text(row.weekday),
      city: text(row.city),
      base: text(row.base),
      lat: Number(row.lat),
      lon: Number(row.lon),
      title: text(row.title),
      focus: text(row.focus),
      lodging: text(row.lodging),
      lodgingStatus: text(row.lodging_status),
      climateNote: text(row.climate_note),
      clothingNote: text(row.clothing_note),
      coverImageUrl: text(row.cover_image_url) || findThemeImage(text(row.day_label).toLowerCase()),
      coverImageAlt: text(row.cover_image_alt) || `${text(row.day_label)} ${text(row.title)}`,
      transport: text(row.transport),
      leaveBy: text(row.leave_by),
      notes: parseNotes(row.notes),
      lodgingResource: linkResources([text(row.lodging_resource_id)], `${id} lodging`)[0],
      primaryResource: linkResources([text(row.primary_resource_id)], `${id} primary`)[0],
      ticketResource: linkResources([text(row.ticket_resource_id)], `${id} ticket`)[0],
      drive: driveId ? driveMap.get(driveId) || null : null,
      blocks: (blocksByDay.get(id) || []).sort(bySortOrder),
    };
  });

  const lodgings = sheets.Lodgings.map((row) => ({
    sortOrder: Number(row.sort_order),
    checkIn: normalizeDate(row.check_in),
    checkOut: normalizeDate(row.check_out),
    name: text(row.name),
    room: text(row.room),
    detail: text(row.detail),
    resource: linkResources([text(row.resource_id)], `lodging ${text(row.name)}`)[0],
    status: text(row.status),
    freeCancelUntil: text(row.free_cancel_until),
    afterDeadline: text(row.after_deadline),
  })).sort(bySortOrder);

  const todos = sheets.Todos.map((row) => ({
    id: text(row.todo_id),
    sortOrder: Number(row.sort_order),
    kind: text(row.kind),
    dueDate: text(row.due_date) ? normalizeDate(row.due_date) : "",
    dueLabel: text(row.due_label),
    title: text(row.title),
    detail: text(row.detail),
  })).sort(bySortOrder);

  const advice = sheets.Advice.map((row) => ({
    sortOrder: Number(row.sort_order),
    title: text(row.title),
    verdict: text(row.verdict),
    dayIds: list(row.day_ids),
    detail: text(row.detail),
    action: text(row.action),
    resources: linkResources(list(row.resource_ids), `advice ${row.sort_order}`),
  })).sort(bySortOrder);

  const itinerary = {
    trip: {
      title: tripRows.title,
      subtitle: tripRows.subtitle,
      dates: tripRows.dates,
      startDate: tripRows.start_date,
      endDate: tripRows.end_date,
      travelers: tripRows.travelers,
      route: tripRows.route,
      summary: tripRows.summary,
      statusNote: tripRows.status_note,
      updatedAt: tripRows.updated_at,
      coverImageUrl: tripRows.cover_image_url || findThemeImage("cover"),
      coverImageAlt: tripRows.cover_image_alt || tripRows.title,
    },
    stages,
    days,
    lodgings,
    todos,
    advice,
    resources,
  };

  validateItinerary(itinerary);
  return itinerary;
}

export function writeItinerary(sourcePath = workbookPath, destinationPath = outputPath) {
  const itinerary = readWorkbook(sourcePath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, `${JSON.stringify(itinerary, null, 2)}\n`);
  return itinerary;
}

function validateItinerary(itinerary) {
  const { trip, stages, days, lodgings, todos, advice, resources } = itinerary;
  for (const field of ["title", "subtitle", "dates", "startDate", "endDate", "route"]) {
    if (!trip[field]) throw new Error(`Missing trip field ${field}`);
  }
  if (days.length !== expectedTrip.dayCount) throw new Error(`Expected ${expectedTrip.dayCount} days, got ${days.length}`);
  if (days[0].date !== expectedTrip.firstDate || days.at(-1).date !== expectedTrip.lastDate) {
    throw new Error(`Expected itinerary dates from ${expectedTrip.firstDate} to ${expectedTrip.lastDate}`);
  }
  if (trip.startDate !== days[0].date || trip.endDate !== days.at(-1).date) throw new Error("Trip dates do not match days");

  const dayIds = new Set(days.map((day) => day.id));
  for (let index = 1; index < days.length; index += 1) {
    if (days[index].date <= days[index - 1].date) throw new Error(`Days out of order at ${days[index].id}`);
  }

  for (const day of days) {
    for (const field of ["id", "label", "date", "weekday", "city", "base", "title", "focus", "lodging", "climateNote", "clothingNote", "transport", "leaveBy"]) {
      if (!day[field]) throw new Error(`Missing day field ${day.id}.${field}`);
    }
    if (!Number.isFinite(day.lat) || !Number.isFinite(day.lon)) throw new Error(`Missing coordinates for ${day.id}`);
    if (!lodgingStatuses.has(day.lodgingStatus)) throw new Error(`Invalid lodging status for ${day.id}`);
    if (day.lodgingStatus === "已订" && (day.lodgingResource.type !== "map" || day.lodgingResource.title !== day.lodging)) {
      throw new Error(`Lodging resource mismatch for ${day.id}`);
    }
    if (!day.blocks.length) throw new Error(`Missing blocks for ${day.id}`);
    if (day.blocks.filter((block) => block.period === "饮食").length !== 1) throw new Error(`Expected one meal block for ${day.id}`);
    if (day.drive && day.drive.dayId !== day.id) throw new Error(`Drive ${day.drive.id} belongs to ${day.drive.dayId}, not ${day.id}`);
    for (const note of day.notes) {
      if (!note.label || !note.text) throw new Error(`Invalid note in ${day.id}`);
    }
  }

  const stagedDays = stages.flatMap((stage) => stage.dayIds);
  if (stagedDays.length !== days.length || new Set(stagedDays).size !== days.length) {
    throw new Error("Every day must belong to exactly one stage");
  }
  for (const stage of stages) {
    if (!stage.id || !stage.title) throw new Error("Invalid stage");
    for (const dayId of stage.dayIds) {
      if (!dayIds.has(dayId)) throw new Error(`Unknown stage day ${dayId}`);
    }
  }

  for (const lodging of lodgings) {
    if (!lodging.name || !lodging.checkIn || !lodging.checkOut || !lodging.status) throw new Error(`Invalid lodging ${lodging.name}`);
    if (lodging.checkOut <= lodging.checkIn) throw new Error(`Lodging dates out of order for ${lodging.name}`);
  }
  const seenTodos = new Set();
  for (const todo of todos) {
    if (!todoKinds.has(todo.kind) || !todo.title || !todo.dueLabel) throw new Error(`Invalid todo ${todo.title}`);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(todo.id)) throw new Error(`Invalid todo id ${todo.id}`);
    if (seenTodos.has(todo.id)) throw new Error(`Duplicate todo id ${todo.id}`);
    seenTodos.add(todo.id);
  }
  for (const item of advice) {
    if (!item.title || !item.verdict || !item.detail) throw new Error(`Invalid advice ${item.title}`);
    for (const dayId of item.dayIds) {
      if (!dayIds.has(dayId)) throw new Error(`Unknown advice day ${dayId}`);
    }
  }

  const seenResources = new Set();
  for (const resource of resources) {
    if (!resource.id || !resource.title || !resourceTypes.has(resource.type)) throw new Error(`Invalid resource ${resource.id || resource.title}`);
    if (seenResources.has(resource.id)) throw new Error(`Duplicate resource ${resource.id}`);
    seenResources.add(resource.id);
    if (resource.type !== "note" && !/^https:\/\//.test(resource.url)) throw new Error(`Missing URL for ${resource.id}`);
  }
}

function readSheet(workbook, sheetName, columns) {
  const rows = workbook[sheetName];
  if (!rows) throw new Error(`Missing sheet: ${sheetName}`);
  for (const column of columns) {
    if (!rows[0] || !(column in rows[0])) throw new Error(`Missing ${sheetName}.${column}`);
  }
  return rows;
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

function parseNotes(value) {
  return text(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split("｜");
      return { label: label.trim(), text: rest.join("｜").trim() };
    });
}

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function bySortOrder(left, right) {
  return left.sortOrder - right.sortOrder;
}

function list(value) {
  return text(value).split(",").map((item) => item.trim()).filter(Boolean);
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
