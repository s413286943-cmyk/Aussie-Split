// "更新" tab: turns itinerary update notes and the ledger / checklist change log
// into one timeline, newest first, grouped by day.
import { formatMoney, statusLabel } from "./ledger.js";

export const UPDATES_CACHE_KEY = "nz2027-updates-v1";
export const UPDATES_SEEN_KEY = "nz2027-updates-seen";

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function buildTimeline({ releases = [], activity = [], todos = [] } = {}) {
  const todoTitles = new Map(todos.map((todo) => [todo.id, todo.title]));
  const entries = [];
  for (const release of releases) {
    if (!validTime(release?.at) || typeof release.title !== "string") continue;
    entries.push({
      key: `release:${release.id}`,
      at: new Date(release.at).toISOString(),
      kind: "release",
      tag: "行程",
      title: release.title,
      lines: Array.isArray(release.items) ? release.items.filter((item) => typeof item === "string") : [],
    });
  }
  for (const change of activity) {
    if (!validTime(change?.at)) continue;
    const described = change.kind === "check" ? describeCheck(change, todoTitles) : describeExpense(change);
    if (!described) continue;
    entries.push({ key: `activity:${change.id}`, at: new Date(change.at).toISOString(), ...described });
  }
  return entries.sort((left, right) => right.at.localeCompare(left.at) || left.key.localeCompare(right.key));
}

export function groupByDay(entries) {
  const groups = [];
  for (const entry of entries) {
    const date = new Date(entry.at);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

export function timeLabel(at) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function countUnseen(entries, seenAt) {
  if (!validTime(seenAt)) return 0;
  const seen = new Date(seenAt).toISOString();
  return entries.filter((entry) => entry.at > seen).length;
}

export function latestAt(entries) {
  return entries[0]?.at || "";
}

export function validUpdates(value) {
  return Boolean(value) && Array.isArray(value.releases) && Array.isArray(value.activity);
}

function describeExpense(change) {
  const detail = change.detail || {};
  const item = detail.item || "一笔账";
  const money = moneyOf(detail);
  const base = { kind: "expense", tag: "记账" };
  if (change.action === "added") {
    return { ...base, title: `记了一笔：${item}`, lines: [joinParts([money, detail.status && statusLabel(detail.status), shortDate(detail.date)])] };
  }
  if (change.action === "removed") {
    return { ...base, title: `删了一笔：${item}`, lines: money ? [money] : [] };
  }
  if (change.action === "restored") {
    return { ...base, title: `恢复了一笔：${item}`, lines: money ? [money] : [] };
  }
  if (change.action === "changed") {
    const before = detail.before || {};
    const lines = [];
    const beforeMoney = moneyOf(before);
    if (beforeMoney && money && beforeMoney !== money) lines.push(`${beforeMoney} → ${money}`);
    if (before.status && detail.status && before.status !== detail.status) lines.push(`${statusLabel(before.status)} → ${statusLabel(detail.status)}`);
    if (before.item && before.item !== detail.item) lines.push(`原来叫“${before.item}”`);
    if ((before.date || "") !== (detail.date || "") && (before.date || detail.date)) lines.push(`日期 ${shortDate(before.date) || "未填"} → ${shortDate(detail.date) || "未填"}`);
    if (!lines.length) lines.push("改了备注或类别");
    return { ...base, title: `改了一笔：${item}`, lines };
  }
  return null;
}

function describeCheck(change, todoTitles) {
  const title = todoTitles.get(change.refId) || "一项清单";
  if (change.action === "done") return { kind: "check", tag: "清单", title: `勾掉：${title}`, lines: [] };
  if (change.action === "undone") return { kind: "check", tag: "清单", title: `取消勾选：${title}`, lines: [] };
  return null;
}

function moneyOf(value) {
  return value && value.currency && Number.isFinite(value.amount) ? formatMoney(value.currency, value.amount) : "";
}

function shortDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function joinParts(parts) {
  return parts.filter(Boolean).join(" · ");
}

function validTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
