"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { activeRecords, calculateTotals, formatTotals } from "@/lib/nz2027/ledger";

const linkLabels = {
  map: "地图",
  official: "官网",
  booking: "订单",
  restaurant: "餐厅",
  photo: "图片",
};

export default function Nz2027Schedule({ itinerary, records, checklist }) {
  const [today, setToday] = useState("");
  useEffect(() => setToday(localDate(new Date())), []);

  const days = itinerary.days;
  const phase = !today ? "before" : today < days[0].date ? "before" : today > days.at(-1).date ? "after" : "during";
  const focusDay = phase === "during" ? days.find((day) => day.date === today) : phase === "before" ? days[0] : days.at(-1);
  const recordsByDate = useMemo(() => groupByDate(activeRecords(records)), [records]);

  return (
    <>
      <Hero itinerary={itinerary} day={focusDay} phase={phase} today={today} />
      <CityStrip days={days} today={phase === "during" ? today : ""} />
      <ToDoBox todos={itinerary.todos} checklist={checklist} today={today} />

      {itinerary.stages.map((stage) => (
        <section className="nz-stage" key={stage.id} aria-label={stage.title}>
          <header className="nz-stage-head">
            <h2>{stage.title}</h2>
            <p>{stage.summary}</p>
          </header>
          <ol className="nz-days">
            {days.filter((day) => stage.dayIds.includes(day.id)).map((day) => (
              <DayCard key={day.id} day={day} current={phase === "during" && day.date === today} records={recordsByDate.get(day.date) || []} />
            ))}
          </ol>
        </section>
      ))}

      <Tips advice={itinerary.advice} days={days} />
      <Stays lodgings={itinerary.lodgings} />
      <PastTrips />
    </>
  );
}

function Hero({ itinerary, day, phase, today }) {
  const daysToGo = today ? Math.round((Date.parse(`${itinerary.days[0].date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
  const badge = phase === "during" ? `第 ${dayNumber(day)} 天 / 17` : phase === "after" ? "旅行结束啦" : daysToGo !== null ? `还有 ${daysToGo} 天` : "出发倒计时";
  const eyebrow = `${phase === "during" ? "今天 · " : ""}DAY ${day.label.slice(1)} · ${monthDay(day.date)} ${day.weekday}`;
  const image = phase === "during"
    ? day.coverImageUrl || itinerary.trip.coverImageUrl
    : itinerary.trip.coverImageUrl || day.coverImageUrl;

  return (
    <section className="nz-hero" aria-label="今天的行程">
      {image
        ? <Image className="nz-hero-photo" src={image} alt={day.coverImageAlt} fill priority sizes="(max-width: 640px) 100vw, 640px" />
        : <div className="nz-hero-photo nz-photo-fallback" aria-hidden="true" />}
      <div className="nz-hero-bar">
        <span>澳新 2027</span>
        <span>{badge}</span>
      </div>
      <div className="nz-hero-copy">
        <p className="nz-eyebrow">{eyebrow}</p>
        <h1>{day.title}</h1>
        <p className="nz-hero-sub">
          {day.lodgingStatus !== "无需住宿" && <span className="nz-hero-stay">今晚住 {day.base}</span>}
          <span>{shortTransport(day)}</span>
        </p>
        <a className="nz-hero-cta" href={`#nz-${day.id}`}>看{phase === "during" ? "今天" : "这一天"}的安排</a>
      </div>
    </section>
  );
}

function CityStrip({ days, today }) {
  const stops = [];
  for (const day of days) {
    if (day.lodgingStatus === "无需住宿") continue;
    const last = stops.at(-1);
    if (last && last.base === day.base) {
      last.nights += 1;
      last.end = day.date;
    } else {
      stops.push({ base: day.base, nights: 1, id: day.id, start: day.date, end: day.date, image: day.coverImageUrl });
    }
  }
  return (
    <nav className="nz-cities" aria-label="住哪儿">
      <ol>
        {stops.map((stop) => {
          const here = today && today >= stop.start && today <= stop.end;
          return (
            <li key={stop.id} className={here ? "is-here" : ""}>
              <a href={`#nz-${stop.id}`}>
                <span className="nz-city-photo">
                  {stop.image ? <Image src={stop.image} alt="" fill sizes="104px" /> : <span className="nz-photo-fallback" />}
                </span>
                <b>{stop.base}</b>
                <small>{shortDate(stop.start)} · {stop.nights} 晚</small>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ToDoBox({ todos, checklist, today }) {
  const open = todos.filter((todo) => !checklist.isDone(todo.id));
  const upcoming = open.filter((todo) => todo.dueDate).sort((left, right) => left.dueDate.localeCompare(right.dueDate)).slice(0, 3);
  return (
    <section className={open.length ? "nz-todo-box" : "nz-todo-box is-clear"} aria-label="出发前清单">
      <header>
        <h2>{open.length ? `出发前还有 ${open.length} 件` : "清单全部办完了"}</h2>
        <Link href="/nz2027/checklist">清单 →</Link>
      </header>
      {upcoming.length > 0 && (
        <ul>
          {upcoming.map((todo) => (
            <li key={todo.id} className={today && todo.dueDate < today ? "is-late" : ""}>
              <i aria-hidden="true" />
              <span>{todo.title}</span>
              <em>{todo.dueLabel}</em>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DayCard({ day, current, records }) {
  const [open, setOpen] = useState(current);
  useEffect(() => {
    if (current) setOpen(true);
    const openFromHash = () => {
      if (window.location.hash === `#nz-${day.id}`) setOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [current, day.id]);

  const timeline = day.blocks.filter((block) => block.period !== "饮食");
  const meals = parseMeals(day.blocks.find((block) => block.period === "饮食")?.activity || "");
  const totals = calculateTotals(records);

  return (
    <li id={`nz-${day.id}`} className={["nz-day", current ? "is-today" : "", open ? "is-open" : ""].filter(Boolean).join(" ")}>
      <button type="button" className="nz-day-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="nz-day-photo">
          {day.coverImageUrl
            ? <Image src={day.coverImageUrl} alt="" fill sizes="(max-width: 640px) 100vw, 640px" />
            : <span className="nz-photo-fallback" />}
        </span>
        <span className="nz-day-cover">
          <small>
            {current && <em>今天</em>}
            DAY {day.label.slice(1)} · {monthDay(day.date)} {day.weekday}
          </small>
          <strong>{day.title}</strong>
          <span className="nz-day-route">{day.city}</span>
        </span>
      </button>
      <div className="nz-day-tags">
        {day.lodgingStatus !== "无需住宿" && <span>今晚 {day.base}{day.lodgingStatus === "待订" ? " · 还没订" : ""}</span>}
        <span>{shortTransport(day)}</span>
      </div>

      {open && (
        <div className="nz-day-body">
          <p className="nz-day-focus">{day.focus}</p>

          <dl className="nz-facts">
            <div><dt>出发</dt><dd>{day.leaveBy}</dd></div>
            <div><dt>怎么走</dt><dd>{day.transport}</dd></div>
            <div><dt>天气</dt><dd>{day.climateNote}</dd></div>
            <div><dt>穿什么</dt><dd>{day.clothingNote}</dd></div>
            <div className="is-wide">
              <dt>住哪儿</dt>
              <dd>
                {day.lodging === "-" ? "回家" : day.lodging}
                {day.lodgingStatus === "待订" ? "（还没订）" : ""}
                {day.lodgingResource?.url && <> · <a href={day.lodgingResource.url} target="_blank" rel="noreferrer">地图</a></>}
              </dd>
            </div>
          </dl>

          <h3 className="nz-sub">时间线</h3>
          <ol className="nz-timeline" aria-label={`${day.label} 时间线`}>
            {timeline.map((block) => (
              <li key={block.sortOrder}>
                <time>{block.period}</time>
                <strong>{block.place}</strong>
                <p>{block.activity}</p>
                {block.tip && <small>{block.tip}</small>}
                <Links resources={block.resources} />
              </li>
            ))}
          </ol>

          {meals.length > 0 && (
            <>
              <h3 className="nz-sub">吃什么</h3>
              <dl className="nz-meals" aria-label="吃什么">
                {meals.map(([meal, place]) => <div key={meal}><dt>{meal}</dt><dd>{place}</dd></div>)}
              </dl>
            </>
          )}

          {day.notes.length > 0 && (
            <>
              <h3 className="nz-sub">提醒</h3>
              <ul className="nz-notes" aria-label="当天提醒">
                {day.notes.map((note) => (
                  <li key={`${note.label}-${note.text.slice(0, 10)}`}><b>{note.label}</b>{note.text}</li>
                ))}
              </ul>
            </>
          )}

          {day.drive && <DriveGuide drive={day.drive} />}

          <div className="nz-day-ledger">
            <span>{records.length ? `这天花了 ${formatTotals(totals)} · ${records.length} 笔` : "这天还没记账"}</span>
            <Link href={`/nz2027/ledger?date=${day.date}`}>记一笔</Link>
          </div>
        </div>
      )}
    </li>
  );
}

function DriveGuide({ drive }) {
  return (
    <section className="nz-drive" aria-label={drive.title}>
      <h3 className="nz-sub">开车</h3>
      <p className="nz-drive-title">{routeName(drive)}</p>
      <p className="nz-drive-time">{drive.duration}</p>
      <div className="nz-legs" role="table" aria-label="分段驾驶">
        <div className="nz-leg nz-leg-head" role="row">
          <span role="columnheader">路段</span>
          <span role="columnheader">开车</span>
          <span role="columnheader">停车与停留</span>
        </div>
        {drive.legs.map((leg) => (
          <div className="nz-leg" role="row" key={leg.sortOrder}>
            <strong role="cell">{leg.segment}</strong>
            <span role="cell">{leg.driveTime}</span>
            <small role="cell">{leg.stopNote}</small>
          </div>
        ))}
      </div>
      {drive.notes && <p className="nz-drive-notes">{drive.notes}</p>}
      <p className="nz-drive-roads">{drive.sequence}</p>
      <Links resources={drive.resources} />
      <small className="nz-drive-hint">路线时间按平常路况，出发前看一眼 NZTA 路况，山里提前下载离线地图。</small>
    </section>
  );
}

function Tips({ advice, days }) {
  const dayFor = new Map(days.map((day) => [day.id, day]));
  return (
    <section className="nz-section" aria-label="出行提示">
      <h2>出行提示</h2>
      <div className="nz-tips">
        {advice.map((item) => (
          <article key={item.sortOrder} className="nz-tip">
            <p className="nz-tip-when">
              {item.verdict}
              {item.dayIds.length > 0 && ` · ${item.dayIds.map((id) => dayFor.get(id)?.label).join(" ")}`}
            </p>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            {item.action && <p className="nz-tip-do">{item.action}</p>}
            <Links resources={item.resources} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Stays({ lodgings }) {
  return (
    <section className="nz-section" aria-label="住哪儿">
      <h2>住哪儿</h2>
      <ul className="nz-stays">
        {lodgings.map((stay) => (
          <li key={stay.sortOrder} className={/待订/.test(stay.status) ? "is-pending" : ""}>
            <span className="nz-stays-dates">{shortDate(stay.checkIn)}<i>–</i>{shortDate(stay.checkOut)}</span>
            <div>
              <strong>{stay.name}</strong>
              <small>{[stay.room, stay.detail].filter((value) => value && value !== "—").join(" · ")}</small>
              {stay.freeCancelUntil && <small className="nz-stays-cancel">免费取消到 {formatDeadline(stay.freeCancelUntil)}</small>}
              {!stay.freeCancelUntil && stay.afterDeadline && <small>{stay.afterDeadline}</small>}
              {stay.resource?.url && <a href={stay.resource.url} target="_blank" rel="noreferrer">地图</a>}
            </div>
            <span className="nz-stays-status">{stay.status.replace("待订", "还没订")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PastTrips() {
  return (
    <details className="nz-past">
      <summary>已结束的旅行</summary>
      <div>
        <strong>澳洲 2026 · 2026年7月28日 – 8月13日</strong>
        <p>墨尔本、大洋路、凯恩斯、悉尼，和胡董夫妇一起。</p>
        <span>
          <Link href="/itinerary">看那次的行程</Link>
          <Link href="/ledger">看那次的账本</Link>
        </span>
      </div>
    </details>
  );
}

function Links({ resources }) {
  const linked = (resources || []).filter((resource) => resource.url);
  if (!linked.length) return null;
  return (
    <span className="nz-links">
      {linked.map((resource) => (
        <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer">
          {linkLabels[resource.type] || "链接"} · {resource.title}
        </a>
      ))}
    </span>
  );
}

function routeName(drive) {
  return drive.title.replace(/^导航\d+ · /, "").replace(/^（若租车）/, "");
}

function shortTransport(day) {
  if (day.drive) {
    const hours = day.transport.match(/约?([\d.–]+)小时/);
    return hours ? `开车 ${hours[1]} 小时` : "当天开车";
  }
  return day.transport.split(" · ")[0];
}

function dayNumber(day) {
  return Number(day.label.slice(1));
}

function parseMeals(text) {
  return text.split(/[；;]/).map((part) => part.split(/[：:]/)).filter((pair) => pair.length > 1 && pair[1].trim()).map(([meal, ...rest]) => [meal.trim(), rest.join("：").trim()]);
}

function groupByDate(records) {
  const map = new Map();
  for (const record of records) {
    if (!map.has(record.date)) map.set(record.date, []);
    map.get(record.date).push(record);
  }
  return map;
}

function monthDay(date) {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

function shortDate(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function formatDeadline(value) {
  const [date, time] = value.split(" ");
  return `${shortDate(date)}${time ? ` ${time}` : ""}`;
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
