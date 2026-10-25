"use client";

import Link from "next/link";
import { useMemo } from "react";

import TripBoard from "@/components/nz2027/TripBoard";
import { activeRecords, calculateTotals, formatTotals } from "@/lib/nz2027/ledger";

const resourceLabels = {
  map: "地图",
  official: "官网",
  booking: "预订",
  restaurant: "餐厅",
  photo: "图片",
  note: "备注",
};

export default function Nz2027Schedule({ itinerary, records, now = new Date() }) {
  const today = localDate(now);
  const phase = today < itinerary.days[0].date ? "before" : today > itinerary.days.at(-1).date ? "after" : "during";
  const currentDay = itinerary.days.find((day) => day.date === today) || null;
  const recordsByDate = useMemo(() => groupByDate(activeRecords(records)), [records]);

  return (
    <>
      <section className="nz27-card nz27-overview" aria-label="2027 行程总览">
        <p className="nz27-route">{itinerary.trip.route}</p>
        <p>{itinerary.trip.summary}</p>
        <p className="muted">{itinerary.trip.statusNote}</p>
        <TripClock phase={phase} today={today} firstDate={itinerary.days[0].date} currentDay={currentDay} />
        <div className="nz27-stage-links">
          {itinerary.stages.map((stage) => {
            const stageDays = itinerary.days.filter((day) => stage.dayIds.includes(day.id));
            return (
              <div key={stage.id}>
                <strong>{stage.title}</strong>
                <span>
                  {stageDays.map((day) => <a key={day.id} href={`#nz-${day.id}`}>{day.label}</a>)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {phase === "before" && <TripBoard itinerary={itinerary} now={now} />}

      {itinerary.stages.map((stage) => (
        <section className="nz27-stage" key={stage.id} aria-label={stage.title}>
          <div className="nz27-stage-head">
            <h2>{stage.title}</h2>
            <p>{stage.summary}</p>
          </div>
          {itinerary.days.filter((day) => stage.dayIds.includes(day.id)).map((day) => (
            <DayCard key={day.id} day={day} current={day.date === today} records={recordsByDate.get(day.date) || []} />
          ))}
        </section>
      ))}

      {phase !== "before" && <TripBoard itinerary={itinerary} now={now} />}
    </>
  );
}

function TripClock({ phase, today, firstDate, currentDay }) {
  if (phase === "before") {
    const days = Math.round((Date.parse(`${firstDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    return <p className="nz27-clock"><strong>距出发 {days} 天</strong>先看下方的付款和取消截止。</p>;
  }
  if (phase === "during" && currentDay) {
    return <p className="nz27-clock"><strong>今天 {currentDay.label}</strong><a href={`#nz-${currentDay.id}`}>{currentDay.city} · {currentDay.title}</a></p>;
  }
  return <p className="nz27-clock"><strong>旅程已结束</strong><Link href="/nz2027/ledger">去账本核对待付项目</Link></p>;
}

function DayCard({ day, current, records }) {
  const timeline = day.blocks.filter((block) => block.period !== "饮食");
  const meals = day.blocks.find((block) => block.period === "饮食");
  const totals = calculateTotals(records);

  return (
    <article id={`nz-${day.id}`} className={current ? "nz27-day is-current" : "nz27-day"}>
      <details open={current}>
        <summary>
          <span className="nz27-day-label">{day.label}</span>
          <span className="nz27-day-date">{day.date.slice(5).replace("-", "/")} {day.weekday}</span>
          <strong>{day.title}</strong>
          <small>{day.city}</small>
        </summary>
        <div className="nz27-day-body">
          <p className="nz27-focus">{day.focus}</p>
          <dl className="nz27-facts">
            <div><dt>当晚住宿</dt><dd>{day.lodging === "-" ? "返程，无需住宿" : day.lodging}{day.lodgingStatus === "待订" ? " · 待订" : ""}</dd></div>
            <div><dt>交通</dt><dd>{day.transport}</dd></div>
            <div><dt>时间要求</dt><dd>{day.leaveBy}</dd></div>
            <div><dt>天气 / 穿衣</dt><dd>{day.climateNote} {day.clothingNote}</dd></div>
          </dl>
          <ol className="nz27-timeline" aria-label={`${day.label} 时间线`}>
            {timeline.map((block) => (
              <li key={block.sortOrder}>
                <span>{block.period}</span>
                <div>
                  <strong>{block.place}</strong>
                  <p>{block.activity}</p>
                  {block.tip && <small>{block.tip}</small>}
                  <ResourceLinks resources={block.resources} />
                </div>
              </li>
            ))}
          </ol>
          {meals && <p className="nz27-meals"><strong>餐饮</strong>{meals.activity}</p>}
          {day.notes.length > 0 && (
            <section className="day-notes" aria-label="当天说明">
              {day.notes.map((note) => (
                <p key={`${note.label}-${note.text.slice(0, 12)}`} className={note.label === "路线建议" || note.label === "长周末" ? "is-advice" : ""}>
                  <strong>{note.label}</strong>
                  <span>{note.text}</span>
                </p>
              ))}
            </section>
          )}
          {day.drive && <DriveGuide drive={day.drive} />}
          <div className="nz27-day-ledger">
            <span>当天账本：{records.length ? `${records.length} 笔 · ${formatTotals(totals)}` : "未记账"}</span>
            <Link href={`/nz2027/ledger?date=${day.date}`}>记一笔</Link>
          </div>
        </div>
      </details>
    </article>
  );
}

function DriveGuide({ drive }) {
  return (
    <section className="drive-guide" aria-label={drive.title}>
      <div className="drive-guide-head">
        <span>自驾导航</span>
        <h4>{drive.title}</h4>
        <p>{drive.duration}</p>
      </div>
      <p className="drive-sequence"><strong>道路顺序</strong>{drive.sequence}</p>
      <div className="drive-legs" role="table" aria-label="分段驾驶">
        <div className="drive-leg drive-leg-head" role="row">
          <span role="columnheader">路段 / 到达点</span>
          <span role="columnheader">纯驾驶</span>
          <span role="columnheader">停车与停留</span>
        </div>
        {drive.legs.map((leg) => (
          <div className="drive-leg" role="row" key={`${drive.id}-${leg.sortOrder}`}>
            <strong role="cell">{leg.segment}</strong>
            <span role="cell">{leg.driveTime}</span>
            <small role="cell">{leg.stopNote}</small>
          </div>
        ))}
      </div>
      {drive.notes && <p className="drive-notes">{drive.notes}</p>}
      <ResourceLinks resources={drive.resources} />
      <small className="drive-disclaimer">Google Maps链接按已知地址和途经点生成，不是2027实时路况；出发前看NZTA路况并下载离线地图。</small>
    </section>
  );
}

function ResourceLinks({ resources }) {
  const linked = (resources || []).filter((resource) => resource.url);
  if (!linked.length) return null;
  return (
    <div className="resource-links">
      {linked.map((resource) => (
        <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer">
          {resourceLabels[resource.type] || "链接"} · {resource.title}
        </a>
      ))}
    </div>
  );
}

function groupByDate(records) {
  const map = new Map();
  for (const record of records) {
    if (!map.has(record.date)) map.set(record.date, []);
    map.get(record.date).push(record);
  }
  return map;
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
