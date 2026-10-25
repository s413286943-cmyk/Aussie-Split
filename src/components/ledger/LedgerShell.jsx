"use client";

import Link from "next/link";

import AppNav from "@/components/AppNav";
import LedgerNav from "@/components/ledger/LedgerNav";

const viewTitles = {
  expenses: "费用明细",
  add: "记一笔",
  activity: "操作记录",
  summary: "按天 / 城市汇总",
};

const primaryActions = {
  expenses: { href: "/add", label: "记一笔" },
  add: { href: "/expenses", label: "看明细" },
  activity: { href: "/expenses", label: "看明细" },
  summary: { href: "/expenses?status=draft", label: "看待付" },
};

export default function LedgerShell({ view, syncState, onSync, notice, children, shellRef }) {
  const isSyncing = syncState === "正在同步";

  return (
    <div className="app-shell docket-shell" ref={shellRef}>
      {view === "dashboard" ? (
        <header className="hero ledger-hero" data-motion="hero">
          <div className="hero-copy">
            <span className="hero-kicker">Travel ledger · 澳新 2027</span>
            <h1>澳新 2027 · 两人账本</h1>
            <p>
              2027.02.01-02.17，悉尼 + 新西兰南北岛。两个人一本账，按原币种（NZD / CNY / AUD）分别累计，不换算合并。
            </p>
          </div>
          <aside className="hero-ticket" aria-label="旅行摘要">
            <span>旅行票夹</span>
            <strong>悉尼进 · Auckland 出</strong>
            <p>{syncState}</p>
          </aside>
          <div className="hero-actions">
            <Link className="button primary" href="/add">记一笔</Link>
            <Link className="button" href="/summary">看汇总</Link>
            <Link className="button" href="/">看行程</Link>
            <SyncButton syncState={syncState} onSync={onSync} disabled={isSyncing} />
          </div>
        </header>
      ) : (
        <CompactLedgerHeader view={view} syncState={syncState} onSync={onSync} />
      )}

      {view !== "add" && <LedgerNav activeView={view} />}
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
        <span className="hero-kicker">澳新 2027 · Travel ledger</span>
        <h1>{viewTitles[view] || "账本"}</h1>
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
