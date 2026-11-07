"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { activeRecords, calculateTotals, formatTotals } from "@/lib/nz2027/ledger";
import { MEALS, mealNoteId, parseMealPlan } from "@/lib/nz2027/meals";

const statusClass = { 已订: "is-booked", 待订: "is-todo", 不用订: "is-walkin" };
const foodCategories = new Set(["dining", "groceries"]);

export default function Nz2027Dining({ itinerary, records, meals }) {
  const [today, setToday] = useState("");
  useEffect(() => {
    const now = new Date();
    Promise.resolve().then(() => setToday(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`));
  }, []);

  const bookings = useMemo(() => new Map((itinerary.dining || []).map((item) => [mealNoteId(item.dayId, item.meal), item])), [itinerary.dining]);
  const foodByDate = useMemo(() => {
    const map = new Map();
    for (const record of activeRecords(records)) {
      if (!record.date || !foodCategories.has(record.category)) continue;
      map.set(record.date, [...(map.get(record.date) || []), record]);
    }
    return map;
  }, [records]);
  const todayDay = itinerary.days.find((day) => day.date === today);
  const toBook = (itinerary.dining || []).filter((item) => item.status === "待订");

  return (
    <section className="nz-dining" aria-labelledby="nz-dining-title">
      <header className="nz-page-head">
        <h1 id="nz-dining-title">吃什么</h1>
        <p>每天早午晚的安排，订好的餐厅时间和订位号都在这里。吃完写一句、打个分，两部手机都能看到。</p>
        <p className="nz-dining-sync" role="status">{meals.syncLabel}</p>
        {todayDay && <a className="nz-dining-jump" href={`#nz-dining-${todayDay.id}`}>跳到今天</a>}
      </header>

      {toBook.length > 0 && (
        <section className="nz-dining-todo" aria-label="还没订的">
          <h2>还没订的</h2>
          <ul>
            {toBook.map((item) => {
              const day = itinerary.days.find((entry) => entry.id === item.dayId);
              return <li key={`${item.dayId}-${item.meal}`}>{day ? `${day.label} ${shortDate(day.date)}` : item.dayId} · {item.place}{item.time ? ` · ${item.time}` : ""}</li>;
            })}
          </ul>
        </section>
      )}

      <ol className="nz-dining-days">
        {itinerary.days.map((day) => {
          const plan = parseMealPlan(day.blocks.find((block) => block.period === "饮食")?.activity);
          const spent = foodByDate.get(day.date) || [];
          return (
            <li key={day.id} id={`nz-dining-${day.id}`} className={`nz-dining-day${day.date === today ? " is-today" : ""}`}>
              <header>
                <span>{day.label} · {shortDate(day.date)} {day.weekday}</span>
                <strong>{day.base}</strong>
              </header>
              <ul className="nz-meals">
                {MEALS.map((meal) => {
                  const id = mealNoteId(day.id, meal.id);
                  return (
                    <MealRow
                      key={id}
                      label={meal.label}
                      plan={plan[meal.id]}
                      booking={bookings.get(id)}
                      note={meals.notes[id]}
                      onSave={(value) => meals.save(id, value)}
                    />
                  );
                })}
              </ul>
              <footer className="nz-dining-spend">
                <span>{spent.length ? `这天吃饭和超市花了 ${formatTotals(calculateTotals(spent))}` : "这天还没记吃饭的账"}</span>
                <Link href={`/nz2027/ledger?date=${day.date}`}>记一笔</Link>
              </footer>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function MealRow({ label, plan, booking, note, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [rating, setRating] = useState(null);
  const hasNote = Boolean(note && (note.note || note.rating));

  const startEdit = () => {
    setText(note?.note || "");
    setRating(note?.rating ?? null);
    setEditing(true);
  };
  const save = (event) => {
    event.preventDefault();
    onSave({ note: text, rating });
    setEditing(false);
  };

  return (
    <li className="nz-meal">
      <div className="nz-meal-head">
        <span className="nz-meal-label">{label}</span>
        <p>{booking ? booking.place : plan || "随意"}</p>
      </div>
      {booking && (
        <div className="nz-meal-booking">
          <span className={`nz-meal-status ${statusClass[booking.status] || ""}`}>{booking.status}</span>
          {booking.time && <span>{booking.time}</span>}
          {booking.bookingRef && <span>订位号 {booking.bookingRef}</span>}
          {booking.note && <small>{booking.note}</small>}
          {booking.resources?.length > 0 && (
            <span className="nz-meal-links">
              {booking.resources.map((resource) => <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer">{resource.type === "map" ? "地图" : "餐厅"}</a>)}
            </span>
          )}
        </div>
      )}
      {booking && plan && !plan.includes(booking.place) && <small className="nz-meal-plan">原计划：{plan}</small>}

      {editing ? (
        <form className="nz-meal-form" onSubmit={save} aria-label={`${label}笔记`}>
          <div className="nz-stars" role="radiogroup" aria-label="好不好吃">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} 星`}
                className={rating && value <= rating ? "is-on" : ""}
                onClick={() => setRating(rating === value ? null : value)}
              >★</button>
            ))}
          </div>
          <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={500} rows={2} placeholder="吃了什么、好不好吃" aria-label="吃了什么" />
          <div className="nz-meal-actions">
            <button type="submit">保存</button>
            <button type="button" onClick={() => setEditing(false)}>取消</button>
          </div>
        </form>
      ) : (
        <div className="nz-meal-note">
          {hasNote && (
            <p>
              {note.rating ? <span className="nz-stars-read" aria-label={`${note.rating} 星`}>{"★".repeat(note.rating)}<span>{"★".repeat(5 - note.rating)}</span></span> : null}
              {note.note}
            </p>
          )}
          <button type="button" onClick={startEdit}>{hasNote ? "改笔记" : "写笔记"}</button>
        </div>
      )}
    </li>
  );
}

function shortDate(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}
