"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import itinerary from "@/data/itinerary.generated.json";
import { applyLedgerOperations } from "@/lib/apiClient";
import { pulseElement, revealOnScroll, revealPage } from "@/lib/motion";
import {
  closeOfflineLedger,
  initializeOfflineLedger,
  syncOfflineLedger,
} from "@/lib/offlineLedger";
import { buildDayDocket, buildDayTimeline, collectMapActions, parseMealPlan, travelMode } from "@/lib/today";
import { fetchDayWeather, fallbackWeather } from "@/lib/weather";
import UnlockGate from "@/components/UnlockGate";
import LazyDayDetails from "@/components/itinerary/LazyDayDetails";
import StageNavigator from "@/components/itinerary/StageNavigator";
import TodayConsole from "@/components/itinerary/TodayConsole";

const checklistStorageKey = "aussie-chill-day-kit-v1";

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
  const shellRef = useRef(null);
  const [weatherByDay, setWeatherByDay] = useState(() => Object.fromEntries(
    itinerary.days.map((day) => [day.id, fallbackWeather(day)])
  ));
  const [ledgerExpenses, setLedgerExpenses] = useState([]);
  const [ledgerFreshness, setLedgerFreshness] = useState("checking");
  const [checkedKitByDay, setCheckedKitByDay] = useState(readLocalChecklist);
  const mode = useMemo(() => travelMode(itinerary.days, itinerary.stages), []);
  const todayDay = mode.currentDay;
  const [selectedStageId, setSelectedStageId] = useState(mode.currentStage?.id || itinerary.stages[0].id);
  const [showAllStages, setShowAllStages] = useState(mode.phase !== "during");

  useEffect(() => {
    let cancelled = false;
    let context = null;
    let syncPromise = null;
    let retryTimer = null;

    async function syncLedger() {
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (!context) return;
      if (!navigator.onLine) {
        if (!cancelled) setLedgerFreshness("cached");
        return;
      }
      if (syncPromise) return syncPromise;

      if (!cancelled) setLedgerFreshness("checking");
      syncPromise = syncOfflineLedger(context, {
        sendOperations: applyLedgerOperations,
        now: Date.now,
      })
        .then((synced) => {
          if (cancelled) return;
          setLedgerExpenses(synced.state.expenses);
          setLedgerFreshness(synced.result.completed ? "current" : "cached");
          if (synced.result.reason === "lease_unavailable") {
            retryTimer = window.setTimeout(syncLedger, 500);
          }
        })
        .catch(() => {
          if (!cancelled) setLedgerFreshness("cached");
        })
        .finally(() => {
          syncPromise = null;
        });
      return syncPromise;
    }

    async function initializeLedger() {
      try {
        const initialized = await initializeOfflineLedger({ storage: localStorage });
        if (cancelled) {
          closeOfflineLedger(initialized);
          return;
        }

        context = initialized;
        setLedgerExpenses(initialized.state.expenses);
        setLedgerFreshness("cached");
        await syncLedger();
      } catch {
        if (!cancelled) {
          setLedgerExpenses([]);
          setLedgerFreshness("unavailable");
        }
      }
    }

    initializeLedger();

    const handleOnline = () => syncLedger();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") syncLedger();
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (retryTimer) window.clearTimeout(retryTimer);
      Promise.resolve(syncPromise).finally(() => closeOfflineLedger(context));
    };
  }, []);

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

  useEffect(() => {
    const pageCleanup = revealPage(shellRef, [
      { selector: "[data-motion='itinerary-hero']", y: 16 },
      { selector: "[data-motion='today-console']", y: 14 },
      { selector: "[data-motion='day-jump']", y: 10 },
      { selector: "[data-motion='nav']", y: 10 },
    ]);
    const scrollCleanup = revealOnScroll(shellRef, "[data-motion='stage-head'], [data-motion='day-card']");

    return () => {
      pageCleanup?.();
      scrollCleanup?.();
    };
  }, []);

  function toggleKitItem(dayId, itemId) {
    setCheckedKitByDay((current) => {
      const checked = new Set(current[dayId] || []);
      if (checked.has(itemId)) {
        checked.delete(itemId);
      } else {
        checked.add(itemId);
      }

      const next = {
        ...current,
        [dayId]: [...checked],
      };

      try {
        localStorage.setItem(checklistStorageKey, JSON.stringify(next));
      } catch {
        // The checklist remains usable for the current session.
      }

      return next;
    });
  }

  const heroDay = mode.nextDay || todayDay;
  const visibleStages = mode.phase === "during" && !showAllStages
    ? itinerary.stages.filter((stage) => stage.id === selectedStageId)
    : itinerary.stages;
  const currentIsBookend = ["d0", "d16"].includes(todayDay.id);

  return (
    <main className={`itinerary-shell route-atlas travel-mode-${mode.phase}`} ref={shellRef}>
      <Hero nextDay={heroDay} weather={weatherByDay[heroDay.id]} compact={mode.phase !== "before"} />
      {mode.phase === "before" && <RouteManifest days={itinerary.days} stages={itinerary.stages} />}
      {mode.phase === "after" && <PostTripSummary expenses={ledgerExpenses} />}
      <TodayConsole
        day={todayDay}
        weather={weatherByDay[todayDay.id]}
        ledgerExpenses={ledgerExpenses}
        ledgerFreshness={ledgerFreshness}
        checkedKitItems={checkedKitByDay[todayDay.id] || []}
        onToggleKitItem={toggleKitItem}
      />
      {mode.phase === "during" ? (
        <StageNavigator
          stages={itinerary.stages}
          days={itinerary.days}
          currentDay={todayDay}
          selectedStageId={selectedStageId}
          onSelectStage={setSelectedStageId}
          showAll={showAllStages}
          onToggleAll={() => setShowAllStages((current) => !current)}
        />
      ) : <DayJump days={itinerary.days} />}
      {mode.phase === "during" && currentIsBookend && (
        <section className="final-day current-bookend">
          <DayCard day={todayDay} weather={weatherByDay[todayDay.id]} ledgerExpenses={ledgerExpenses} compact current />
        </section>
      )}
      <section className="stage-stack" aria-label="行程时间线">
        {visibleStages.map((stage) => (
          <StageSection
            key={stage.id}
            stage={stage}
            days={itinerary.days.filter((day) => stage.dayIds.includes(day.id))}
            weatherByDay={weatherByDay}
            ledgerExpenses={ledgerExpenses}
            eagerImage={stage.id === "melbourne-road"}
            currentDayId={mode.phase === "during" ? todayDay.id : ""}
          />
        ))}
      </section>
      {(mode.phase !== "during" || showAllStages) && (
        <section className="final-day">
          <DayCard day={itinerary.days.find((day) => day.id === "d0")} weather={weatherByDay.d0} ledgerExpenses={ledgerExpenses} compact />
          <DayCard day={itinerary.days.find((day) => day.id === "d16")} weather={weatherByDay.d16} ledgerExpenses={ledgerExpenses} compact />
        </section>
      )}
      <nav className="nav" aria-label="主导航" data-motion="nav">
        <Link className="active" href="/itinerary">行程</Link>
        <Link href="/">账本</Link>
        <Link href="/add">记一笔</Link>
      </nav>
    </main>
  );
}

function Hero({ nextDay, weather, compact = false }) {
  return (
    <header className={compact ? "itinerary-hero route-hero is-compact" : "itinerary-hero route-hero"} data-motion="itinerary-hero">
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
        <h1>
          <span>{itinerary.trip.title} ·</span>
          <span>{itinerary.trip.subtitle}</span>
        </h1>
        <div className="hero-meta">
          <span>{itinerary.trip.dates}</span>
          <span>好友出行</span>
          <span>城市风光 · 海岸自驾 · 大堡礁</span>
        </div>
        <div className="hero-route-strip" aria-label="行程阶段">
          {itinerary.stages.map((stage) => (
            <span key={stage.id}>{stage.title}</span>
          ))}
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

function PostTripSummary({ expenses }) {
  const pendingSplit = expenses.filter((expense) => expense.status === "confirmed" && !expense.splitSettled).length;
  const drafts = expenses.filter((expense) => expense.status === "draft").length;
  return (
    <section className="post-trip-summary" aria-label="返程后账本收尾" data-motion="today-console">
      <div>
        <span className="section-kicker">Return checkpoint</span>
        <h2>旅程结束，先把账本收尾</h2>
        <p>核对待分摊与待确认项目，再完成最终结算。</p>
      </div>
      <div className="post-trip-metrics">
        <Link href="/expenses?split=pending"><span>待分摊</span><strong>{pendingSplit}</strong></Link>
        <Link href="/expenses"><span>待确认</span><strong>{drafts}</strong></Link>
        <Link className="post-trip-primary" href="/settlement">查看最终结算</Link>
      </div>
    </section>
  );
}

function RouteManifest({ days, stages }) {
  const bookendDays = days.filter((day) => day.id === "d0" || day.id === "d16");

  return (
    <section className="route-manifest" aria-label="路线总览" data-motion="day-jump">
      <div className="manifest-lead">
        <span>Route atlas</span>
        <h2>D0-D16 每日路书</h2>
        <p>先看今天怎么走，再按阶段翻每日安排。</p>
      </div>
      <div className="manifest-stages">
        <article className="manifest-stage manifest-bookends">
          <span>出发 / 返程</span>
          <h3>上海往返</h3>
          <p>{bookendDays.map((day) => day.city).join(" → ")}</p>
          <div className="manifest-days">
            {bookendDays.map((day) => (
              <a key={day.id} href={`#${day.id}`}>
                <strong>{day.label}</strong>
                <small>{formatShortDate(day)}</small>
              </a>
            ))}
          </div>
        </article>
        {stages.map((stage, index) => {
          const stageDays = days.filter((day) => stage.dayIds.includes(day.id));
          return (
            <article className={`manifest-stage stage-tone-${index + 1}`} key={stage.id}>
              <span>{formatStageRange(stageDays)}</span>
              <h3>{stage.title}</h3>
              <p>{stageDays[0].city} → {stageDays.at(-1).city}</p>
              <div className="manifest-days">
                {stageDays.map((day) => (
                  <a key={day.id} href={`#${day.id}`}>
                    <strong>{day.label}</strong>
                    <small>{formatShortDate(day)}</small>
                  </a>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DayJump({ days }) {
  return (
    <section className="day-jump route-jump" aria-label="快速跳转" data-motion="day-jump">
      {days.map((day) => (
        <a key={day.id} href={`#${day.id}`}>{day.label}</a>
      ))}
    </section>
  );
}

function StageSection({ stage, days, weatherByDay, ledgerExpenses, eagerImage, currentDayId = "" }) {
  const stageStops = days.map((day) => day.city).join(" / ");

  return (
    <section className="stage-section route-stage">
      <div className="stage-head" data-motion="stage-head">
        <div>
          <span>{formatStageRange(days)}</span>
          <h2>{stage.title}</h2>
          <p>{stageStops}</p>
          <div className="stage-days">
            {days.map((day) => <a key={day.id} href={`#${day.id}`}>{day.label}</a>)}
          </div>
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
          <DayCard key={day.id} day={day} weather={weatherByDay[day.id]} ledgerExpenses={ledgerExpenses} current={day.id === currentDayId} />
        ))}
      </div>
    </section>
  );
}

function DayCard({ day, weather, ledgerExpenses = [], compact = false, current = false }) {
  const foodPulseRef = useRef({ tween: null, timeout: null });

  useEffect(() => {
    const pulse = foodPulseRef.current;
    return () => {
      pulse.tween?.kill();
      if (pulse.timeout) window.clearTimeout(pulse.timeout);
    };
  }, []);

  if (!day) return null;

  const dayWeather = weather || fallbackWeather(day);
  const keyStops = primaryBlocks(day).slice(0, 4);
  const foodBlock = day.blocks.find((block) => block.period === "饮食");
  const resourcesCount = day.blocks.reduce((total, block) => total + (block.resources?.length || 0), 0);
  const timeline = buildDayTimeline(day);
  const docket = buildDayDocket(day, ledgerExpenses);
  const mapActions = collectMapActions(day);
  const meals = parseMealPlan(day);

  function handleDetailsOpen(detailsElement) {
    const foodBlock = detailsElement.querySelector("[data-food-block='true']");
    foodPulseRef.current.tween?.kill();
    if (foodPulseRef.current.timeout) window.clearTimeout(foodPulseRef.current.timeout);

    const tween = pulseElement(foodBlock);
    foodPulseRef.current.tween = tween || null;
    foodPulseRef.current.timeout = tween
      ? window.setTimeout(() => {
        tween.kill();
        foodPulseRef.current.tween = null;
        foodPulseRef.current.timeout = null;
      }, 900)
      : null;
  }

  return (
    <article className={["day-card route-day-card", compact ? "compact" : "", current ? "is-current" : ""].filter(Boolean).join(" ")} id={day.id} data-motion="day-card">
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
          <strong>{formatShortDate(day)} {day.weekday}</strong>
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
        <div className="day-brief-grid">
          <WeatherStrip weather={dayWeather} />
          <article className="day-brief-card">
            <span>路书重点</span>
            <strong>{keyStops.length ? `${keyStops.length} 个主要停靠` : "机动安排"}</strong>
            <small>{resourcesCount ? `${resourcesCount} 个快捷链接` : "无外部链接"}</small>
          </article>
        </div>
        <div className="route-stop-list" aria-label={`${day.label} 主要停靠`}>
          {keyStops.map((block) => (
            <span key={`${day.id}-stop-${block.sortOrder}`}>{block.place}</span>
          ))}
        </div>
        {foodBlock && (
          <div className="food-brief" data-food-block="true">
            <span>饮食安排</span>
            <p>{foodBlock.activity}</p>
            {foodBlock.tip && <small>{foodBlock.tip}</small>}
          </div>
        )}
        <DayExecutionGrid timeline={timeline} />
        <DayDocket docket={docket} />
        <DayMapActions actions={mapActions} meals={meals} />
        <LazyDayDetails defaultOpen={current} onOpen={handleDetailsOpen}>
          <div className="timeline">
            {day.blocks.map((block) => (
              <div
                className="time-block"
                key={`${day.id}-${block.sortOrder}`}
                data-food-block={block.period === "饮食" ? "true" : undefined}
              >
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
        </LazyDayDetails>
      </div>
    </article>
  );
}

function DayExecutionGrid({ timeline }) {
  return (
    <section className="day-execution-grid" aria-label="每日时间轴">
      {timeline.map((slot) => (
        <article className={`slot-${slot.id}`} key={slot.id}>
          <span>{slot.label}</span>
          {slot.blocks.slice(0, 2).map((block) => (
            <div key={`${block.dayId}-${block.sortOrder}`}>
              <strong>{block.place}</strong>
              <p>{block.activity}</p>
            </div>
          ))}
        </article>
      ))}
    </section>
  );
}

function DayDocket({ docket }) {
  return (
    <section className="day-docket" aria-label="住宿交通门票票夹">
      {docket.map((item) => (
        <a className={[`docket-${item.id}`, !item.href ? "is-disabled" : ""].filter(Boolean).join(" ")} key={item.id} href={item.href || undefined} target={item.href ? "_blank" : undefined} rel={item.href ? "noreferrer" : undefined}>
          <span>{item.label}</span>
          <strong>{item.title}</strong>
          <small>{item.status} · {item.detail}</small>
        </a>
      ))}
    </section>
  );
}

function DayMapActions({ actions, meals }) {
  return (
    <section className="day-map-actions" aria-label="每日地图快捷入口">
      <div>
        <span>地图快捷</span>
        <strong>{meals.dinner}</strong>
      </div>
      {actions.map((action) => (
        <a key={action.id} href={action.url} target="_blank" rel="noreferrer">
          {action.label}
        </a>
      ))}
    </section>
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

function primaryBlocks(day) {
  return day.blocks.filter((block) => block.period !== "饮食");
}

function formatShortDate(day) {
  return day.date.slice(5).replace("-", ".");
}

function formatStageRange(days) {
  if (!days.length) return "";
  return `${days[0].label}-${days.at(-1).label} · ${formatShortDate(days[0])}-${formatShortDate(days.at(-1))}`;
}

function readLocalChecklist() {
  if (typeof window === "undefined") return {};

  try {
    const savedChecklist = localStorage.getItem(checklistStorageKey);
    return savedChecklist ? JSON.parse(savedChecklist) : {};
  } catch {
    return {};
  }
}
