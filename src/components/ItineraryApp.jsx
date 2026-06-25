"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import itinerary from "@/data/itinerary.generated.json";
import { collectTodayResources, findTodayDay } from "@/lib/today";
import { fetchDayWeather, fallbackWeather } from "@/lib/weather";
import UnlockGate from "@/components/UnlockGate";

const resourceLabels = {
  map: "地图",
  official: "官网",
  booking: "预订",
  restaurant: "餐厅",
  photo: "图片参考",
  note: "备注",
};

export default function ItineraryApp() {
  return (
    <UnlockGate intro="输入旅行访问码后查看 Aussie Chill 行程。">
      <ItineraryContent />
    </UnlockGate>
  );
}

function ItineraryContent() {
  const [weatherByDay, setWeatherByDay] = useState(() => Object.fromEntries(
    itinerary.days.map((day) => [day.id, fallbackWeather(day)])
  ));
  const nextDay = useMemo(() => findNextDay(itinerary.days), []);
  const todayDay = useMemo(() => findTodayDay(itinerary.days), []);

  useEffect(() => {
    let cancelled = false;

    Promise.all(itinerary.days.map(async (day) => [day.id, await fetchDayWeather(day)]))
      .then((entries) => {
        if (!cancelled) setWeatherByDay(Object.fromEntries(entries));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="itinerary-shell">
      <Hero nextDay={nextDay} weather={weatherByDay[nextDay.id]} />
      <TodayConsole day={todayDay} weather={weatherByDay[todayDay.id]} />
      <DayJump days={itinerary.days} />
      <section className="stage-stack" aria-label="行程时间线">
        {itinerary.stages.map((stage) => (
          <StageSection
            key={stage.id}
            stage={stage}
            days={itinerary.days.filter((day) => stage.dayIds.includes(day.id))}
            weatherByDay={weatherByDay}
            eagerImage={stage.id === "melbourne-road"}
          />
        ))}
      </section>
      <section className="final-day">
        <DayCard day={itinerary.days.find((day) => day.id === "d0")} weather={weatherByDay.d0} compact />
        <DayCard day={itinerary.days.find((day) => day.id === "d16")} weather={weatherByDay.d16} compact />
      </section>
      <nav className="nav" aria-label="主导航">
        <Link className="active" href="/itinerary">行程</Link>
        <Link href="/">账本</Link>
        <Link href="/add">记一笔</Link>
      </nav>
    </main>
  );
}

function TodayConsole({ day, weather }) {
  const quickResources = collectTodayResources(day);

  return (
    <section className="today-console" aria-label="今日旅行控制台">
      <div className="today-summary">
        <span>今日旅行控制台</span>
        <h2>{day.label} · {day.date.slice(5).replace("-", ".")} {day.weekday} · {day.city}</h2>
        <p>{day.title}</p>
        <small>{day.focus}</small>
      </div>
      <div className="today-status-grid">
        <article>
          <span>今晚住宿</span>
          <strong>{day.lodging}</strong>
        </article>
        <article>
          <span>{weather?.status === "live" ? "实时天气" : weather?.status === "forecast" ? "天气预报" : "天气参考"}</span>
          <strong>{weather?.summary || day.climateNote}</strong>
        </article>
        <article>
          <span>穿衣提醒</span>
          <strong>{weather?.detail || day.clothingNote}</strong>
        </article>
      </div>
      <div className="today-detail-grid">
        <div className="today-plan">
          <h3>今天节奏</h3>
          {day.blocks.map((block) => (
            <div className="today-plan-row" key={`${day.id}-${block.sortOrder}`}>
              <span>{block.period}</span>
              <div>
                <strong>{block.place}</strong>
                <p>{block.activity}</p>
                {block.tip && <small>{block.tip}</small>}
              </div>
            </div>
          ))}
        </div>
        <div className="today-links">
          <h3>快捷入口</h3>
          {quickResources.map((resource) => (
            <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer">
              {resourceLabels[resource.type] || "链接"} · {resource.title}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function Hero({ nextDay, weather }) {
  return (
    <header className="itinerary-hero">
      <Image
        className="itinerary-hero-image"
        src={itinerary.trip.coverImageUrl}
        alt={itinerary.trip.coverImageAlt}
        fill
        loading="eager"
        priority
        sizes="(max-width: 1180px) 100vw, 1180px"
      />
      <div className="itinerary-hero-copy">
        <p>{itinerary.trip.route}</p>
        <h1>{itinerary.trip.title} · {itinerary.trip.subtitle}</h1>
        <div className="hero-meta">
          <span>{itinerary.trip.dates}</span>
          <span>2对夫妻</span>
          <span>城市风光 · 海岸自驾 · 大堡礁</span>
        </div>
      </div>
      <aside className="hero-weather">
        <span>下一站</span>
        <strong>{nextDay.label} · {nextDay.city}</strong>
        <p>{weather?.summary || nextDay.climateNote}</p>
        <small>{weather?.detail || nextDay.clothingNote}</small>
      </aside>
    </header>
  );
}

function DayJump({ days }) {
  return (
    <section className="day-jump" aria-label="快速跳转">
      {days.map((day) => (
        <a key={day.id} href={`#${day.id}`}>{day.label}</a>
      ))}
    </section>
  );
}

function StageSection({ stage, days, weatherByDay, eagerImage }) {
  return (
    <section className="stage-section">
      <div className="stage-head">
        <div>
          <span>{days[0].date.slice(5).replace("-", ".")} - {days.at(-1).date.slice(5).replace("-", ".")}</span>
          <h2>{stage.title}</h2>
        </div>
        <div className="stage-image">
          <Image
            src={stage.imageUrl}
            alt={stage.title}
            fill
            loading={eagerImage ? "eager" : "lazy"}
            sizes="(max-width: 860px) 100vw, 430px"
          />
        </div>
      </div>
      <div className="day-grid">
        {days.map((day) => (
          <DayCard key={day.id} day={day} weather={weatherByDay[day.id]} />
        ))}
      </div>
    </section>
  );
}

function DayCard({ day, weather, compact = false }) {
  if (!day) return null;

  return (
    <article className={compact ? "day-card compact" : "day-card"} id={day.id}>
      <div className="day-cover">
        <Image
          className="day-cover-image"
          src={day.coverImageUrl}
          alt={day.coverImageAlt}
          fill
          sizes="(max-width: 860px) 100vw, 560px"
        />
        <div>
          <span>{day.label}</span>
          <strong>{day.date.slice(5).replace("-", ".")} {day.weekday}</strong>
        </div>
      </div>
      <div className="day-body">
        <div className="day-title-row">
          <div>
            <p>{day.city}</p>
            <h3>{day.title}</h3>
          </div>
          <span>{day.lodging === "-" ? "返程" : day.lodging}</span>
        </div>
        <p className="focus">{day.focus}</p>
        <WeatherStrip weather={weather || fallbackWeather(day)} />
        <details>
          <summary>查看当天安排</summary>
          <div className="timeline">
            {day.blocks.map((block) => (
              <div className="time-block" key={`${day.id}-${block.sortOrder}`}>
                <span>{block.period}</span>
                <div>
                  <h4>{block.place}</h4>
                  <p>{block.activity}</p>
                  <small>{block.highlight}</small>
                  {block.tip && <em>{block.tip}</em>}
                  <ResourceLinks resources={block.resources} />
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>
    </article>
  );
}

function WeatherStrip({ weather }) {
  const label = weather.status === "live" ? "实时天气" : weather.status === "forecast" ? "天气预报" : "天气参考";
  return (
    <div className={weather.status === "fallback" ? "weather-strip" : `weather-strip ${weather.status}`}>
      <strong>{label}</strong>
      <p>{weather.summary}</p>
      <small>{weather.detail}</small>
    </div>
  );
}

function ResourceLinks({ resources }) {
  if (!resources?.length) return null;

  return (
    <div className="resource-links">
      {resources.map((resource) => (
        <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer">
          {resourceLabels[resource.type] || "链接"} · {resource.title}
        </a>
      ))}
    </div>
  );
}

function findNextDay(days) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return days.find((day) => {
    const [year, month, date] = day.date.split("-").map(Number);
    return new Date(year, month - 1, date).getTime() >= today;
  }) || days.at(-1);
}
