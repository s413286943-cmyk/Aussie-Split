const weekdayByDate = new Map([
  ["2026-07-28", "周二"],
  ["2026-07-29", "周三"],
  ["2026-07-30", "周四"],
  ["2026-07-31", "周五"],
  ["2026-08-01", "周六"],
  ["2026-08-02", "周日"],
  ["2026-08-03", "周一"],
  ["2026-08-04", "周二"],
  ["2026-08-05", "周三"],
  ["2026-08-06", "周四"],
  ["2026-08-07", "周五"],
  ["2026-08-08", "周六"],
  ["2026-08-09", "周日"],
  ["2026-08-10", "周一"],
  ["2026-08-11", "周二"],
  ["2026-08-12", "周三"],
  ["2026-08-13", "周四"],
]);

const foodIdAliases = new Map([
  ["prawn-star-cairns", "food-prawn-star"],
]);

export function parseTravelMarkdown(markdown) {
  const lines = markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    days: parseDays(lines),
    items: [...parseBookingItems(lines), ...parseFoodItems(lines)],
  };
}

function parseDays(lines) {
  const overview = parseOverviewDays(lines);
  const details = parseDailyDetails(lines);
  const byId = new Map(overview.map((day) => [day.id, day]));

  for (const detail of details) {
    byId.set(detail.id, mergeParsedDay(byId.get(detail.id), detail));
  }

  return Array.from(byId.values()).sort((a, b) => a.dayIndex - b.dayIndex);
}

function parseOverviewDays(lines) {
  return lines
    .filter((line) => /^D\d+\t/.test(line))
    .map((line) => {
      const [dayLabel, , city, focus, lodging] = line.split("\t");
      const dayIndex = Number(dayLabel.slice(1));
      const date = dateFromDayIndex(dayIndex);

      return {
        id: `d${dayIndex}`,
        dayIndex,
        date,
        weekday: weekdayByDate.get(date) || "",
        city: city || "",
        title: focus || city || `D${dayIndex}`,
        focus: focus || "",
        lodging: lodging || "",
        climateNote: "",
        clothingNote: "",
        backupNote: "",
        blocks: [],
      };
    });
}

function parseDailyDetails(lines) {
  const days = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^D(\d+)｜.+?｜(.+)$/);
    if (!match) continue;

    const dayIndex = Number(match[1]);
    const id = `d${dayIndex}`;
    const blocks = [];
    let focus = "";

    for (let cursor = index + 1; cursor < lines.length && !/^D\d+｜/.test(lines[cursor]); cursor += 1) {
      if (lines[cursor] === "今日定位") {
        focus = lines[cursor + 1] || "";
      }

      if (lines[cursor].startsWith("时间段\t")) {
        for (let row = cursor + 1; row < lines.length && !isSectionBoundary(lines[row]); row += 1) {
          const columns = lines[row].split("\t");
          if (columns.length < 3) break;

          const [period, place, activity, highlight = "", tip = ""] = columns;
          blocks.push({ id: `${id}-import-${blocks.length + 1}`, period, place, activity, highlight, tip });
        }
      }
    }

    days.push({
      id,
      dayIndex,
      date: dateFromDayIndex(dayIndex),
      weekday: weekdayByDate.get(dateFromDayIndex(dayIndex)) || "",
      title: match[2],
      focus,
      blocks,
    });
  }

  return days;
}

function parseBookingItems(lines) {
  const items = [];
  let inBookings = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes("需要提前预订的项目")) inBookings = true;
    if (inBookings && lines[index].includes("七、美食地图")) break;

    const match = inBookings ? lines[index].match(/^\d+\.\s+(.+)$/) : null;
    if (!match) continue;

    const noteLines = [];
    let relatedDayId = "";

    for (let cursor = index + 1; cursor < lines.length && !/^\d+\.\s+/.test(lines[cursor]); cursor += 1) {
      if (lines[cursor].includes("使用日期：")) {
        relatedDayId = dayIdFromText(lines[cursor]);
      }

      if (lines[cursor].startsWith("⸻") || lines[cursor].includes("七、美食地图")) break;
      noteLines.push(lines[cursor].replace(/^\*\s*/, "").trim());
    }

    items.push(
      item(slug(`booking-${match[1]}`), "booking", match[1], relatedDayId, "", "还没订", noteLines.join(" "), items.length + 1)
    );
  }

  return items;
}

function parseFoodItems(lines) {
  const start = lines.findIndex((line) => line.includes("具体店 / 地点"));
  if (start < 0) return [];

  const items = [];
  for (let index = start + 1; index < lines.length && !isSectionBoundary(lines[index]); index += 1) {
    if (!lines[index].includes("\t")) continue;

    const [, title, food, why, bestDay] = lines[index].split("\t");
    items.push(
      item(
        foodItemId(title),
        "food",
        title,
        dayIdFromText(bestDay),
        "",
        "到时再看",
        [food, why, bestDay].filter(Boolean).join("。"),
        items.length + 1
      )
    );
  }

  return items;
}

export function buildImportPreview(current, imported) {
  const preview = { added: [], updated: [], unchanged: [], unrecognized: [] };

  compareEntries(preview, current.days || [], imported.days || [], (entry) => `${entry.id.toUpperCase()} ${entry.title}`);
  compareEntries(preview, current.items || [], imported.items || [], (entry) => entry.title);

  return preview;
}

export function mergeImportedTravelData(current, imported) {
  return {
    days: mergeById(current.days || [], imported.days || [], mergeDay),
    items: mergeById(current.items || [], imported.items || [], mergeItem),
  };
}

function mergeById(currentEntries, importedEntries, mergeEntry) {
  const byId = new Map(currentEntries.map((entry) => [entry.id, entry]));

  for (const imported of importedEntries) {
    byId.set(imported.id, byId.has(imported.id) ? mergeEntry(byId.get(imported.id), imported) : imported);
  }

  return Array.from(byId.values());
}

function mergeDay(current, imported) {
  return {
    ...current,
    ...imported,
    city: imported.city || current.city || "",
    focus: imported.focus || current.focus || "",
    lodging: imported.lodging || current.lodging || "",
    climateNote: imported.climateNote || current.climateNote || "",
    clothingNote: imported.clothingNote || current.clothingNote || "",
    backupNote: imported.backupNote || current.backupNote || "",
    blocks: imported.blocks?.length ? imported.blocks : current.blocks || [],
  };
}

function mergeItem(current, imported) {
  return {
    ...current,
    ...imported,
    status: current.status || imported.status,
    link: current.link || imported.link || "",
    note: imported.note || current.note || "",
  };
}

function mergeParsedDay(current = {}, imported) {
  return {
    ...current,
    ...imported,
    city: imported.city || current.city || "",
    focus: imported.focus || current.focus || "",
    lodging: imported.lodging || current.lodging || "",
    climateNote: imported.climateNote || current.climateNote || "",
    clothingNote: imported.clothingNote || current.clothingNote || "",
    backupNote: imported.backupNote || current.backupNote || "",
    blocks: imported.blocks?.length ? imported.blocks : current.blocks || [],
  };
}

function compareEntries(preview, currentEntries, importedEntries, labelFor) {
  const currentById = new Map(currentEntries.map((entry) => [entry.id, entry]));

  for (const imported of importedEntries) {
    const current = currentById.get(imported.id);
    const bucket = !current ? "added" : JSON.stringify(current) === JSON.stringify(imported) ? "unchanged" : "updated";
    preview[bucket].push({ id: imported.id, label: labelFor(imported) });
  }
}

function item(id, kind, title, relatedDayId, city, status, note, sortOrder) {
  return { id, kind, title, relatedDayId, city, status, amount: 0, currency: "", note, link: "", sortOrder };
}

function foodItemId(title) {
  const titleSlug = slug(title);
  return foodIdAliases.get(titleSlug) || `food-${titleSlug}`;
}

function isSectionBoundary(line) {
  return (
    /^D\d+｜/.test(line) ||
    /^\S+、/.test(line) ||
    line.includes("预算总表") ||
    line.includes("需要提前预订") ||
    line.includes("美食地图") ||
    line.startsWith("⸻")
  );
}

function dateFromDayIndex(dayIndex) {
  const start = new Date("2026-07-28T00:00:00Z");
  start.setUTCDate(start.getUTCDate() + dayIndex);
  return start.toISOString().slice(0, 10);
}

function dayIdFromText(text = "") {
  const match = text.match(/D(\d+)/);
  return match ? `d${Number(match[1])}` : "";
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
