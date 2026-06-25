const quickResourceTypes = new Set(["map", "booking", "restaurant", "official"]);

export function findTodayDay(days, now = new Date()) {
  if (!days.length) return null;

  const today = startOfLocalDay(now).getTime();
  const first = dayTime(days[0]);
  const last = dayTime(days.at(-1));

  if (today <= first) return days[0];
  if (today >= last) return days.at(-1);

  return days.find((day) => dayTime(day) === today) || days.find((day) => dayTime(day) > today) || days.at(-1);
}

export function collectTodayResources(day) {
  const seen = new Set();
  const resources = [];

  for (const block of day?.blocks || []) {
    for (const resource of block.resources || []) {
      if (!quickResourceTypes.has(resource.type) || seen.has(resource.id)) continue;
      seen.add(resource.id);
      resources.push(resource);
    }
  }

  return resources;
}

function dayTime(day) {
  const [year, month, date] = day.date.split("-").map(Number);
  return new Date(year, month - 1, date).getTime();
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
