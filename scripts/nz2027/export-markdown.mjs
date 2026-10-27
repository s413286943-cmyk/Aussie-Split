// Export the 2027 itinerary (and recent update notes) as one Markdown file.
// Usage: npm run nz2027:md [-- output.md]
// Default output: outputs/澳新2027-行程-YYYYMMDD.md (today's date, Asia/Shanghai).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
const output = process.argv[2] || join(root, "outputs", `澳新2027-行程-${today}.md`);
const j = JSON.parse(readFileSync(join(root, "src/data/nz2027-itinerary.generated.json"), "utf8"));
const releases = JSON.parse(readFileSync(join(root, "content/nz2027-updates.json"), "utf8"));
const cell = (v) => String(v ?? "").replaceAll("|", "／").replaceAll("\n", " ");
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const link = (r) => (r?.url ? `[${r.title}](${r.url})` : "");
const out = [];
const t = j.trip;

out.push(`# ${t.title} · ${t.subtitle}`, "");
out.push(`- **日期**：${t.dates}（${t.travelers}）`);
out.push(`- **路线**：${t.route}`);
out.push(`- **每天的重点**：${t.summary}`);
out.push(`- ${t.statusNote}`, "");

out.push("## 最近更新", "");
for (const release of releases.slice(0, 5)) {
  const at = new Date(release.at);
  const stamp = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  out.push(`- **${stamp}** ${release.title}`);
  for (const item of release.items) out.push(`  - ${item}`);
}
out.push("");

out.push("## 总览", "", "| 天 | 日期 | 城市 | 当天 | 住 |", "|---|---|---|---|---|");
for (const d of j.days) out.push(`| ${d.label} | ${md(d.date)} ${d.weekday} | ${cell(d.city)} | ${cell(d.title)} | ${cell(d.lodging || "—")} |`);
out.push("");

const dayById = new Map(j.days.map((d) => [d.id, d]));
out.push("## 每日行程", "");
for (const stage of j.stages) {
  out.push(`### ${stage.title}`, "", `> ${stage.summary}`, "");
  for (const id of stage.dayIds) {
    const d = dayById.get(id);
    out.push(`#### ${d.label} · ${md(d.date)} ${d.weekday} · ${d.title}`, "");
    if (d.focus) out.push(`*${d.focus}*`, "");
    out.push(`- **城市**：${d.city}`);
    if (d.lodging) out.push(`- **住**：${d.lodging}${d.lodgingStatus ? `（${d.lodgingStatus}）` : ""}`);
    out.push(`- **交通**：${d.transport}`);
    if (d.leaveBy) out.push(`- **时间点**：${d.leaveBy}`);
    if (d.climateNote) out.push(`- **天气**：${d.climateNote}`);
    if (d.clothingNote) out.push(`- **穿什么**：${d.clothingNote}`);
    out.push("");
    if (d.notes?.length) {
      for (const n of d.notes) out.push(`- **${n.label}**：${n.text}`);
      out.push("");
    }
    const meals = d.blocks.filter((b) => b.period === "饮食");
    const blocks = d.blocks.filter((b) => b.period !== "饮食");
    if (blocks.length) {
      out.push("| 时间 | 地点 | 安排 |", "|---|---|---|");
      for (const b of blocks) {
        const extra = [b.highlight && `**${b.highlight}**`, b.tip && `提示：${b.tip}`, b.miss && `选这个会错过：${b.miss}`].filter(Boolean).join("；");
        const period = b.choice ? `${b.period}<br>**${b.choice}**` : b.period;
        out.push(`| ${cell(period)} | ${cell(b.place)} | ${cell(b.activity)}${extra ? `<br>${cell(extra)}` : ""} |`);
      }
      out.push("");
    }
    for (const b of meals) out.push(`🍽 ${b.activity}`, "");
    if (d.drive) {
      const v = d.drive;
      out.push(`**🚗 ${v.title}**`, "", `- ${v.duration}`, `- 路线：${v.sequence}`);
      for (const leg of v.legs) out.push(`  - ${leg.segment}（${leg.driveTime}）${leg.stopNote ? `：${leg.stopNote}` : ""}`);
      if (v.notes) out.push(`- ${v.notes}`);
      const nav = v.resources.map(link).filter(Boolean);
      if (nav.length) out.push(`- 导航：${nav.join(" · ")}`);
      out.push("");
    }
    const driveIds = new Set(d.drive ? d.drive.resources.map((r) => r.id) : []);
    const links = [d.lodgingResource, d.primaryResource, d.ticketResource, ...d.blocks.flatMap((b) => b.resources || [])]
      .filter((r) => r?.url && !driveIds.has(r.id));
    const unique = [...new Map(links.map((r) => [r.id, r])).values()];
    if (unique.length) out.push(`链接：${unique.map(link).join(" · ")}`, "");
  }
}

out.push("## 住宿", "", "| 入住 | 退房 | 住宿 | 房型 / 费用 | 状态 | 免费取消截止 |", "|---|---|---|---|---|---|");
for (const l of j.lodgings) out.push(`| ${md(l.checkIn)} | ${md(l.checkOut)} | ${cell(l.name)} | ${cell(l.room)} | ${cell(l.status)} | ${cell(l.freeCancelUntil || "—")} |`);
out.push("");

out.push("## 出发前清单", "");
const groups = [
  ["有日期的", j.todos.filter((x) => x.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))],
  ["要订的", j.todos.filter((x) => !x.dueDate && x.kind === "book")],
  ["要准备的", j.todos.filter((x) => !x.dueDate && x.kind !== "book")],
];
for (const [title, items] of groups) {
  if (!items.length) continue;
  out.push(`### ${title}`, "");
  for (const x of items) out.push(`- [ ] **${x.title}**（${x.dueLabel}）${x.detail ? `：${x.detail}` : ""}`);
  out.push("");
}

out.push("## 路上提醒", "");
for (const a of j.advice) {
  out.push(`### ${a.title}（${a.verdict}）`, "", a.detail, "");
  if (a.action) out.push(`👉 ${a.action}`, "");
  const nav = (a.resources || []).map(link).filter(Boolean);
  if (nav.length) out.push(`链接：${nav.join(" · ")}`, "");
}

out.push("---", "", `*更新于 ${t.updatedAt}*`, "");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, out.join("\n"));
console.log(`Wrote ${output}`);
