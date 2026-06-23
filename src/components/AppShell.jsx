"use client";

import Link from "next/link";

import UnlockGate from "./UnlockGate";

const navItems = [
  { view: "today", href: "/", label: "今日" },
  { view: "itinerary", href: "/itinerary", label: "行程" },
  { view: "lists", href: "/lists", label: "清单" },
  { view: "ledger", href: "/ledger", label: "账本" },
];

export default function AppShell({ view, children, status = "" }) {
  return (
    <UnlockGate>
      <div className="app-shell">
        <header className="hero">
          <div>
            <p className="eyebrow">2026.07.28-08.13</p>
            <h1>Aussie Chill</h1>
            <p>南十字星下的十六日。上海出发，墨尔本进，悉尼出。</p>
          </div>
          {status && <span className="button">{status}</span>}
        </header>

        {children}

        <nav className="nav" aria-label="主导航">
          {navItems.map((item) => (
            <Link className={view === item.view ? "active" : ""} href={item.href} key={item.view}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </UnlockGate>
  );
}
