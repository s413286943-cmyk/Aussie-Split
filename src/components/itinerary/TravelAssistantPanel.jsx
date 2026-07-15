"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { generateTravelBrief } from "@/lib/apiClient";
import {
  buildTravelAssistantFingerprint,
  readTravelBriefCache,
  writeTravelBriefCache,
} from "@/lib/travelAssistantCache";

const paceLabels = {
  easy: "轻松",
  balanced: "均衡",
  full: "充实",
};

export default function TravelAssistantPanel({ day, weather, checkedKitItems }) {
  const dayId = typeof day?.id === "string" ? day.id : "";
  const checkedKitItemIds = useMemo(
    () => normalizeCheckedKitItemIds(checkedKitItems),
    [checkedKitItems],
  );
  const fingerprint = useMemo(() => buildTravelAssistantFingerprint({
    day,
    weather,
    checkedKitItemIds,
  }), [day, weather, checkedKitItemIds]);
  const [cacheView, setCacheView] = useState({ dayId: "", state: "empty", entry: null });
  const [notice, setNotice] = useState("idle");
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  const activeDayRef = useRef(dayId);

  useEffect(() => {
    let cancelled = false;
    activeDayRef.current = dayId;
    const cached = readTravelBriefCache(browserStorage(), dayId, fingerprint);
    queueMicrotask(() => {
      if (cancelled) return;
      setCacheView({ dayId, ...cached });
      setNotice("idle");
    });
    return () => {
      cancelled = true;
    };
  }, [dayId, fingerprint]);

  const activeView = cacheView.dayId === dayId
    ? cacheView
    : { dayId, state: "empty", entry: null };
  const entry = activeView.entry;
  const status = panelStatus({ state: activeView.state, notice, loading, entry });

  async function handleGenerate() {
    if (loading || inFlightRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNotice("offline");
      return;
    }

    const requestDayId = dayId;
    const requestFingerprint = fingerprint;
    inFlightRef.current = true;
    setLoading(true);
    setNotice("loading");

    try {
      const response = await generateTravelBrief({
        dayId: requestDayId,
        weather: safeWeather(weather),
        checkedKitItemIds,
      });
      const nextEntry = {
        fingerprint: requestFingerprint,
        generatedAt: response.generatedAt,
        brief: response.brief,
        sourceDayIds: response.sourceDayIds,
      };

      writeTravelBriefCache(browserStorage(), requestDayId, nextEntry);
      if (activeDayRef.current === requestDayId) {
        setCacheView({ dayId: requestDayId, state: "fresh", entry: nextEntry });
        setNotice("generated");
      }
    } catch {
      if (activeDayRef.current === requestDayId) setNotice("error");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <section className="travel-assistant-panel" aria-labelledby={`travel-assistant-title-${dayId}`}>
      <header className="travel-assistant-head">
        <div className="travel-assistant-heading">
          <span>AI 行程调度</span>
          <h3 id={`travel-assistant-title-${dayId}`}>今日节奏与取舍</h3>
          <p>基于当前行程、天气与出门清单提供建议；确定信息仍以原行程为准。</p>
        </div>
        <div className="travel-assistant-actions">
          <span className={`travel-assistant-stamp is-${status.tone}`}>{status.stamp}</span>
          <button type="button" className="travel-assistant-generate" onClick={handleGenerate} disabled={loading}>
            {generateButtonLabel({ entry, loading, notice })}
          </button>
        </div>
      </header>

      <div className={`travel-assistant-status is-${status.tone}`} role="status" aria-live="polite">
        {status.message}
      </div>

      {loading && !entry ? <TravelAssistantLoading /> : null}
      {entry ? <TravelAssistantBrief brief={entry.brief} /> : null}
      {!entry && !loading ? (
        <p className="travel-assistant-empty">生成今日简报后，可快速确认节奏、前三优先事项与最先删减项。</p>
      ) : null}
    </section>
  );
}

function TravelAssistantBrief({ brief }) {
  const priorities = list(brief?.priorities).slice(0, 3);
  const tradeoffs = list(brief?.tradeoffs);
  const tomorrowPrep = list(brief?.tomorrowPrep);
  const questions = list(brief?.suggestedQuestions);

  return (
    <div className="travel-assistant-brief">
      <section className="travel-assistant-section is-wide" aria-label="今日节奏">
        <h4>节奏</h4>
        <div className="travel-assistant-pace">
          <strong>{paceLabels[brief?.pace?.level] || "今日"}</strong>
          <p>{brief?.pace?.note || "按原行程稳步推进。"}</p>
        </div>
      </section>

      <section className="travel-assistant-section is-wide" aria-label="今日前三优先事项">
        <h4>优先顺序</h4>
        <div className="travel-assistant-priorities">
          {priorities.map((item, index) => (
            <article className="travel-assistant-priority" key={item.factId || `${item.title}-${index}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.reason}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="travel-assistant-section" aria-label="风险与取舍">
        <h4>风险与取舍</h4>
        {tradeoffs.length ? (
          <ul>{tradeoffs.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : <p className="travel-assistant-muted">暂无额外风险提示。</p>}
      </section>

      <section className="travel-assistant-section is-split" aria-label="最先删减项">
        <h4>最先删减</h4>
        {brief?.firstCut ? (
          <div className="travel-assistant-first-cut">
            <strong>{brief.firstCut.title}</strong>
            <p>{brief.firstCut.reason}</p>
          </div>
        ) : <p className="travel-assistant-muted">暂无删减建议。</p>}
      </section>

      <section className="travel-assistant-section is-wide" aria-label="明日准备">
        <h4>明日准备</h4>
        {tomorrowPrep.length ? (
          <div className="travel-assistant-prep">
            {tomorrowPrep.map((item) => (
              <div key={item.id || item.label}>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </div>
            ))}
          </div>
        ) : <p className="travel-assistant-muted">明日暂无额外准备项。</p>}
      </section>

      <section className="travel-assistant-section is-wide" aria-label="建议继续询问的问题">
        <h4>建议继续问</h4>
        {questions.length ? (
          <div className="travel-assistant-questions">
            {questions.map((question) => <span key={question}>{question}</span>)}
          </div>
        ) : <p className="travel-assistant-muted">暂无延伸问题。</p>}
      </section>
    </div>
  );
}

function TravelAssistantLoading() {
  return (
    <div className="travel-assistant-loading" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function panelStatus({ state, notice, loading, entry }) {
  if (loading || notice === "loading") {
    return { tone: "loading", stamp: "生成中", message: "正在整理今日节奏与取舍建议…" };
  }
  if (notice === "offline") {
    return { tone: "offline", stamp: "当前离线", message: "当前设备离线，联网后可生成简报；原行程仍可正常查看。" };
  }
  if (notice === "error") {
    return { tone: "error", stamp: "可重试", message: "AI 暂不可用，原行程仍可正常查看" };
  }
  if (state === "stale") {
    return { tone: "stale", stamp: "待更新", message: "资料已更新，可重新生成" };
  }
  if (entry) {
    return {
      tone: "ready",
      stamp: "已生成",
      message: `生成于 ${formatGeneratedTime(entry.generatedAt)} · 参考范围 ${formatSourceDays(entry.sourceDayIds)}`,
    };
  }
  return { tone: "empty", stamp: "待生成", message: "尚未生成建议，不影响下方清单与原行程。" };
}

function generateButtonLabel({ entry, loading, notice }) {
  if (loading) return "正在生成…";
  if (notice === "error" || notice === "offline") return "重试生成";
  if (entry) return "重新生成";
  return "生成今日简报";
}

function normalizeCheckedKitItemIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => (
    typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value)
  )))].sort();
}

function safeWeather(weather) {
  return Object.fromEntries(["status", "summary", "detail", "adviceLabel"].map((key) => [
    key,
    typeof weather?.[key] === "string" ? weather[key].trim().slice(0, 160) : "",
  ]));
}

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function formatGeneratedTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "刚刚";
  }
}

function formatSourceDays(values) {
  const days = list(values).filter((value) => /^d(?:[0-9]|1[0-6])$/.test(value));
  return days.length ? days.map((value) => value.toUpperCase()).join(" / ") : "当前日";
}

function list(value) {
  return Array.isArray(value) ? value : [];
}
