import Link from "next/link";

const navigationItems = [
  { id: "itinerary", href: "/", label: "行程" },
  { id: "ledger", href: "/ledger", label: "账本" },
  { id: "add", href: "/add", label: "记一笔" },
];

export default function AppNav({ activeView }) {
  const activeItemId = ["itinerary", "add"].includes(activeView) ? activeView : "ledger";

  return (
    <nav className="nav" aria-label="主导航" data-motion="nav">
      {navigationItems.map((item) => {
        const active = item.id === activeItemId;
        const current = active && item.id === "ledger" && activeView !== "dashboard"
          ? "location"
          : active ? "page" : undefined;
        return (
          <Link
            className={active ? "active" : ""}
            href={item.href}
            aria-current={current}
            key={item.id}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
