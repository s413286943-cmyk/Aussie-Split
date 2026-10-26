"use client";

import { useMemo } from "react";

import { buildTimeline, groupByDay, timeLabel } from "@/lib/nz2027/updates";

export default function Nz2027Updates({ updates, todos }) {
  const groups = useMemo(
    () => groupByDay(buildTimeline({ releases: updates.data?.releases, activity: updates.data?.activity, todos })),
    [updates.data, todos],
  );

  return (
    <section className="nz-updates" aria-labelledby="nz-updates-title">
      <header className="nz-page-head">
        <h1 id="nz-updates-title">最近的改动</h1>
        <p>记账、勾清单和行程的调整都记在这里，最新的在最上面。</p>
      </header>

      {updates.state === "loading" && !updates.data && <p className="nz-updates-note" role="status">正在读取…</p>}
      {updates.state === "offline" && <p className="nz-updates-note" role="status">现在没联网，显示的是上次看到的内容。</p>}
      {updates.state === "failed" && <p className="nz-updates-note" role="status">没连上，联网后再看。</p>}
      {updates.data && !updates.data.activityAvailable && (
        <p className="nz-updates-note" role="status">记账和清单的改动暂时读不到，下面只有行程的调整。</p>
      )}

      {groups.length === 0 && updates.data && <p className="nz-updates-note">还没有改动。</p>}

      {groups.map((group) => (
        <section key={group.key} className="nz-updates-day" aria-label={group.label}>
          <h2>{group.label}</h2>
          <ol>
            {group.entries.map((entry) => (
              <li key={entry.key} className={`nz-update is-${entry.kind}`}>
                <time dateTime={entry.at}>{timeLabel(entry.at)}</time>
                <div>
                  <span className="nz-update-tag">{entry.tag}</span>
                  <strong>{entry.title}</strong>
                  {entry.lines.length > 0 && (
                    <ul>
                      {entry.lines.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </section>
  );
}
