// 2027 两人账本的纯函数：校验、合计、按天/城市汇总、CSV。
// 与 2026 分账账本（src/lib/ledger.js）完全独立，不共享数据或状态。

export const currencies = ["NZD", "CNY", "AUD"];

export const categories = [
  { id: "lodging", label: "住宿" },
  { id: "flight", label: "机票" },
  { id: "car", label: "租车" },
  { id: "transport", label: "油费 / 交通 / 停车" },
  { id: "activity", label: "门票 / 活动" },
  { id: "dining", label: "餐饮" },
  { id: "groceries", label: "超市补给" },
  { id: "shopping", label: "购物" },
  { id: "other", label: "其他" },
];

export const statuses = [
  { id: "paid", label: "已付" },
  { id: "pending", label: "待付" },
];

const currencyPrefixes = { NZD: "NZ$", CNY: "¥", AUD: "A$" };
const categoryIds = new Set(categories.map((category) => category.id));
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function categoryLabel(id) {
  return categories.find((category) => category.id === id)?.label || id || "其他";
}

export function statusLabel(id) {
  return statuses.find((status) => status.id === id)?.label || id;
}

export function formatMoney(currency, amount) {
  const value = Number(amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currencyPrefixes[currency] ?? `${currency} `}${value}`;
}

export function formatTotals(totals, field = "total") {
  const parts = currencies
    .filter((currency) => totals?.[currency]?.[field])
    .map((currency) => formatMoney(currency, totals[currency][field]));
  return parts.length ? parts.join(" + ") : "—";
}

// Returns a list of problems; an empty list means the record can be saved and synced.
export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["记录无效"];
  if (typeof record.id !== "string" || !idPattern.test(record.id)) errors.push("编号无效");
  if (typeof record.item !== "string" || !record.item.trim() || record.item.length > 200) errors.push("请填写项目（200字以内）");
  if (!categoryIds.has(record.category)) errors.push("类别无效");
  if (!currencies.includes(record.currency)) errors.push("币种无效");
  if (typeof record.amount !== "number" || !Number.isFinite(record.amount) || record.amount <= 0 || record.amount >= 1e10 || Math.abs(record.amount * 100 - Math.round(record.amount * 100)) > 1e-6) {
    errors.push("金额必须大于 0，最多两位小数");
  }
  if (!["paid", "pending"].includes(record.status)) errors.push("状态无效");
  if (typeof record.note !== "string" || record.note.length > 1000) errors.push("备注过长");
  if (!validDate(record.date)) errors.push("日期无效");
  if (!validTimestamp(record.updatedAt)) errors.push("更新时间无效");
  if (record.deletedAt !== null && record.deletedAt !== undefined && !validTimestamp(record.deletedAt)) errors.push("删除时间无效");
  return errors;
}

export function normalizeRecord(record) {
  return {
    id: record.id,
    date: record.date || "",
    category: record.category,
    item: String(record.item || "").trim(),
    currency: record.currency,
    amount: Math.round(Number(record.amount) * 100) / 100,
    status: record.status,
    note: String(record.note || ""),
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt || null,
  };
}

export function activeRecords(records) {
  return (records || []).filter((record) => !record.deletedAt);
}

export function calculateTotals(records) {
  const totals = {};
  for (const record of activeRecords(records)) {
    const bucket = totals[record.currency] || { paid: 0, pending: 0, total: 0, count: 0 };
    const amount = roundMoney(record.amount);
    if (record.status === "pending") bucket.pending = roundMoney(bucket.pending + amount);
    else bucket.paid = roundMoney(bucket.paid + amount);
    bucket.total = roundMoney(bucket.total + amount);
    bucket.count += 1;
    totals[record.currency] = bucket;
  }
  return Object.fromEntries(currencies.filter((currency) => totals[currency]).map((currency) => [currency, totals[currency]]));
}

// Groups by itinerary day; bookings dated before the trip (or undated) go first.
export function summarizeByDay(records, days = []) {
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const firstDate = days[0]?.date || "";
  const lastDate = days.at(-1)?.date || "";
  const groups = new Map();

  for (const record of activeRecords(records)) {
    const day = dayByDate.get(record.date);
    let group;
    if (day) {
      group = { key: day.date, label: `${day.label} · ${shortDate(day.date)} ${day.weekday}`, detail: day.city, base: day.base, order: day.date };
    } else if (record.date && lastDate && record.date > lastDate) {
      group = { key: "after", label: "行程结束后", detail: "", base: "行程结束后", order: "9999" };
    } else {
      group = { key: "before", label: record.date && firstDate && record.date < firstDate ? "行前预订" : "未填日期", detail: "", base: "行前 / 未归入行程日", order: "0000" };
    }
    addRecord(groups, group, record);
  }
  return [...groups.values()].sort((left, right) => left.order.localeCompare(right.order));
}

// Groups by the city where the two of you sleep that night.
export function summarizeByBase(records, days = []) {
  const groups = new Map();
  for (const dayGroup of summarizeByDay(records, days)) {
    const current = groups.get(dayGroup.base) || { key: dayGroup.base, label: dayGroup.base, order: dayGroup.order, count: 0, totals: {}, days: [] };
    current.count += dayGroup.count;
    if (/^D\d/.test(dayGroup.label)) current.days.push(dayGroup.label.split(" · ")[0]);
    for (const [currency, bucket] of Object.entries(dayGroup.totals)) {
      const target = current.totals[currency] || { paid: 0, pending: 0, total: 0 };
      target.paid = roundMoney(target.paid + bucket.paid);
      target.pending = roundMoney(target.pending + bucket.pending);
      target.total = roundMoney(target.total + bucket.total);
      current.totals[currency] = target;
    }
    groups.set(dayGroup.base, current);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, detail: group.days.join(" / ") }))
    .sort((left, right) => left.order.localeCompare(right.order));
}

export function toCsv(records) {
  const header = ["日期", "类别", "项目", "币种", "金额", "状态", "备注", "编号"];
  const rows = activeRecords(records)
    .slice()
    .sort((left, right) => (left.date || "").localeCompare(right.date || "") || left.id.localeCompare(right.id))
    .map((record) => [record.date, categoryLabel(record.category), record.item, record.currency, record.amount.toFixed(2), statusLabel(record.status), record.note, record.id]);
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function addRecord(groups, template, record) {
  const group = groups.get(template.key) || { ...template, count: 0, totals: {} };
  const bucket = group.totals[record.currency] || { paid: 0, pending: 0, total: 0 };
  const amount = roundMoney(record.amount);
  if (record.status === "pending") bucket.pending = roundMoney(bucket.pending + amount);
  else bucket.paid = roundMoney(bucket.paid + amount);
  bucket.total = roundMoney(bucket.total + amount);
  group.totals[record.currency] = bucket;
  group.count += 1;
  groups.set(template.key, group);
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function shortDate(date) {
  return date.slice(5).replace("-", ".");
}

function validDate(value) {
  if (value === "" || value === null || value === undefined) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}
