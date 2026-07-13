import Link from "next/link";

const ledgerItems = [
  { id: "dashboard", href: "/ledger", label: "总览" },
  { id: "expenses", href: "/expenses", label: "明细" },
  { id: "activity", href: "/activity", label: "操作" },
  { id: "settlement", href: "/settlement", label: "结算" },
];

export default function LedgerNav({ activeView }) {
  return (
    <nav className="ledger-nav" aria-label="账本导航">
      {ledgerItems.map((item) => {
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
