"use client";

import { initialTravelDays, initialTripItems, listSections } from "@/lib/travelSeed";

import AppShell from "./AppShell";

export default function TravelWorkspace({ view }) {
  const today = pickDisplayDay();

  return (
    <AppShell view={view}>
      {view === "today" && <TodayView day={today} />}
      {view === "itinerary" && <ItineraryView />}
      {view === "lists" && <ListsView />}
    </AppShell>
  );
}

function TodayView({ day }) {
  const relatedItems = initialTripItems.filter((item) => item.relatedDayId === day.id).slice(0, 6);

  return (
    <>
      <section className="section card">
        <span className="muted">今天去哪</span>
        <h2>{day.id.toUpperCase()} · {day.title}</h2>
        <p>{day.date} · {day.weekday} · {day.city}</p>
        <p className="muted">{day.focus}</p>
        <p className="muted">{day.clothingNote}</p>
      </section>
      <DayBlocks day={day} />
      <section className="section">
        <div className="section-head">
          <h2>今天顺手看</h2>
          <span className="muted">{relatedItems.length} 项</span>
        </div>
        <ItemGrid items={relatedItems} />
      </section>
    </>
  );
}

function ItineraryView() {
  return (
    <section className="section timeline">
      {initialTravelDays.map((day) => (
        <article className="card day-card" key={day.id}>
          <span className="muted">{day.id.toUpperCase()} · {day.date} · {day.weekday}</span>
          <h2>{day.title}</h2>
          <p>{day.city}</p>
          <p className="muted">{day.focus}</p>
          <DayBlocks day={day} compact />
          {day.backupNote && <p className="muted">备选：{day.backupNote}</p>}
        </article>
      ))}
    </section>
  );
}

function ListsView() {
  return (
    <>
      {listSections.map((section) => {
        const items = initialTripItems.filter((item) => item.kind === section.kind);

        return (
          <section className="section" key={section.kind}>
            <div className="section-head">
              <h2>{section.title}</h2>
              <span className="muted">{items.length} 项</span>
            </div>
            <ItemGrid items={items} />
          </section>
        );
      })}
    </>
  );
}

function DayBlocks({ day, compact = false }) {
  if (!day.blocks.length) {
    return (
      <section className={compact ? "day-blocks compact" : "section day-blocks"}>
        <article className="expense-row">
          <div>
            <h3>{day.backupNote || "安排待补"}</h3>
            <p className="muted">可以后续手动补细节，或导入新版攻略。</p>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className={compact ? "day-blocks compact" : "section day-blocks"}>
      {day.blocks.map((block) => (
        <article className="expense-row" key={block.id}>
          <div>
            <span className="tag">{block.period}</span>
            <h3>{block.place}</h3>
            <p>{block.activity}</p>
            <p className="muted">{block.highlight} · {block.tip}</p>
            {block.photoSpot && block.photoSpot !== "-" && <p className="muted">{block.photoSpot}</p>}
          </div>
        </article>
      ))}
    </section>
  );
}

function ItemGrid({ items }) {
  return (
    <div className="item-grid">
      {items.map((item) => (
        <article className="card" key={item.id}>
          <span className="tag">{item.status}</span>
          <h3>{item.title}</h3>
          <p className="muted">{item.city || "全程"}{item.relatedDayId ? ` · ${item.relatedDayId.toUpperCase()}` : ""}</p>
          <p>{item.note}</p>
        </article>
      ))}
    </div>
  );
}

function pickDisplayDay() {
  const todayIso = new Date().toISOString().slice(0, 10);
  return initialTravelDays.find((day) => day.date >= todayIso) || initialTravelDays[0];
}
