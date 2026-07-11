"use client";

import Link from "next/link";

import AppNav from "@/components/AppNav";

const viewTitles = {
  expenses: "费用明细",
  add: "记一笔",
  activity: "操作记录",
  settlement: "结算",
};

const primaryActions = {
  expenses: { href: "/add", label: "记一笔" },
  add: { href: "/expenses", label: "看明细" },
  activity: { href: "/expenses", label: "看明细" },
  settlement: { href: "/expenses?split=pending", label: "待分摊" },
};

export default function LedgerShell({ view, syncState, onSync, notice, children, shellRef }) {
  const isSyncing = syncState === "正在同步";

  return (
    <div className="app-shell docket-shell" ref={shellRef}>
      {view === "dashboard" ? (
        <header className="hero ledger-hero" data-motion="hero">
          <div className="hero-copy">
            <span className="hero-kicker">Travel docket · Australia 2026</span>
            <h1>Aussie Chill</h1>
            <p>
              2026.07.28-08.13，好友澳洲旅行账本。机票已单独 split，本账本只记录旅行中共同费用，按币种分别结算。
            </p>
          </div>
          <aside className="hero-ticket" aria-label="旅行摘要">
            <span>共享票夹</span>
            <strong>墨尔本进 · 悉尼出</strong>
            <p>{syncState}</p>
          </aside>
          <div className="hero-actions">
            <Link className="button primary" href="/add">记一笔</Link>
            <Link className="button" href="/settlement">看结算</Link>
            <Link className="button" href="/itinerary">看行程</Link>
            <SyncButton syncState={syncState} onSync={onSync} disabled={isSyncing} />
          </div>
        </header>
      ) : (
        <CompactLedgerHeader view={view} syncState={syncState} onSync={onSync} />
      )}

      <ActionNotice notice={notice} />
      {children}

      <AppNav activeView={view} />
    </div>
  );
}

function CompactLedgerHeader({ view, syncState, onSync }) {
  const primary = primaryActions[view] || primaryActions.expenses;
  return (
    <header className="ledger-compact-header" data-motion="hero">
      <div>
        <span className="hero-kicker">Aussie Chill · Shared ledger</span>
        <h1>{viewTitles[view] || "共享账本"}</h1>
        <p>{syncState}</p>
      </div>
      <div className="compact-header-actions">
        <Link className="button primary" href={primary.href}>{primary.label}</Link>
        <SyncButton syncState={syncState} onSync={onSync} disabled={syncState === "正在同步"} compact />
      </div>
    </header>
  );
}

function SyncButton({ syncState, onSync, disabled, compact = false }) {
  return (
    <button
      className={compact ? "button sync-button" : "button"}
      type="button"
      onClick={onSync}
      disabled={disabled}
      aria-label={syncState === "同步失败，可重试" ? "重试同步" : "立即同步账本"}
    >
      {compact ? "同步" : syncState}
    </button>
  );
}

function ActionNotice({ notice }) {
  if (!notice) return null;
  return (
    <div className={`action-toast ${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
      <span>{notice.message}</span>
      {notice.actionLabel && (
        <button className="toast-action" type="button" onClick={notice.onAction}>
          {notice.actionLabel}
        </button>
      )}
    </div>
  );
}
