import Link from "next/link";

const navigationItems = [
  { id: "dashboard", href: "/ledger", label: "总览" },
  { id: "expenses", href: "/expenses", label: "明细" },
  { id: "add", href: "/add", label: "新增" },
  { id: "activity", href: "/activity", label: "操作" },
  { id: "settlement", href: "/settlement", label: "结算" },
  { id: "itinerary", href: "/", label: "行程" },
];

export default function AppNav({ activeView }) {
  return (
    <nav className="nav" aria-label="主导航" data-motion="nav">
      {navigationItems.map((item) => {
        const active = item.id === activeView;
        return (
          <Link
            className={active ? "active" : ""}
            href={item.href}
            aria-current={active ? "page" : undefined}
            key={item.id}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
