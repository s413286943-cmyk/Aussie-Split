import { roundMoney } from "./ledger.js";

// Records dated before this belong to the 2026 Australia trip. They stay in the
// database and in backups, but the 2027 ledger does not show or total them.
export const TRIP_LEDGER_SINCE = "2026-09-01";

export function scopeTripExpenses(expenses, since = TRIP_LEDGER_SINCE) {
  return (expenses || []).filter((expense) => !expense.deletedAt && (!expense.date || expense.date >= since));
}

export function countLegacyExpenses(expenses, since = TRIP_LEDGER_SINCE) {
  return (expenses || []).filter((expense) => !expense.deletedAt && expense.date && expense.date < since).length;
}

// Groups expenses by itinerary day. Records outside the trip window fall into
// "行前" (bookings paid before departure, or undated) and "行程后".
export function summarizeByDay(expenses, days = []) {
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const firstDate = days[0]?.date || "";
  const lastDate = days.at(-1)?.date || "";
  const groups = new Map();

  for (const expense of expenses || []) {
    const day = dayByDate.get(expense.date);
    let key;
    let group;
    if (day) {
      key = day.date;
      group = { key, label: `${day.label} · ${shortDate(day.date)} ${day.weekday || ""}`.trim(), detail: day.city, base: day.base || day.city, order: day.date };
    } else if (expense.date && lastDate && expense.date > lastDate) {
      key = "after";
      group = { key, label: "行程结束后", detail: "返程后补记", base: "行程结束后", order: "9999" };
    } else {
      key = "before";
      group = {
        key,
        label: expense.date && firstDate && expense.date < firstDate ? "行前预订" : "未填日期",
        detail: "出发前付款或日期待补",
        base: "行前 / 未归入行程日",
        order: "0000",
      };
    }
    addToGroup(groups, key, group, expense);
  }

  return sortGroups(groups);
}

// Groups by where the two of you sleep that night (day.base), so transfer days
// count toward the destination city.
export function summarizeByBase(expenses, days = []) {
  const byDay = summarizeByDay(expenses, days);
  const groups = new Map();

  for (const dayGroup of byDay) {
    const key = dayGroup.base;
    const current = groups.get(key) || { key, label: key, detail: "", order: dayGroup.order, count: 0, totals: {}, dayLabels: [] };
    current.count += dayGroup.count;
    current.dayLabels.push(dayGroup.label.split(" · ")[0]);
    for (const [currency, totals] of Object.entries(dayGroup.totals)) {
      const bucket = current.totals[currency] || { paid: 0, pending: 0, total: 0 };
      bucket.paid = roundMoney(bucket.paid + totals.paid);
      bucket.pending = roundMoney(bucket.pending + totals.pending);
      bucket.total = roundMoney(bucket.total + totals.total);
      current.totals[currency] = bucket;
    }
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, detail: group.dayLabels.filter((label) => /^D\d/.test(label)).join(" / ") || group.detail }))
    .sort((left, right) => left.order.localeCompare(right.order));
}

export function buildDayLookup(itinerary) {
  return Array.isArray(itinerary?.days)
    ? itinerary.days.map((day) => ({ date: day.date, label: day.label, weekday: day.weekday, city: day.city, base: day.base || day.city }))
    : [];
}

function addToGroup(groups, key, template, expense) {
  const group = groups.get(key) || { ...template, count: 0, totals: {} };
  const amount = roundMoney(Number(expense.amount || 0));
  const bucket = group.totals[expense.currency] || { paid: 0, pending: 0, total: 0 };
  if (expense.status === "draft") bucket.pending = roundMoney(bucket.pending + amount);
  else bucket.paid = roundMoney(bucket.paid + amount);
  bucket.total = roundMoney(bucket.total + amount);
  group.totals[expense.currency] = bucket;
  group.count += 1;
  groups.set(key, group);
}

function sortGroups(groups) {
  return [...groups.values()].sort((left, right) => left.order.localeCompare(right.order));
}

function shortDate(date) {
  return date.slice(5).replace("-", ".");
}
