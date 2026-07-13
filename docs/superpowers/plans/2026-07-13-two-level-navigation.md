# Two-Level Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed six-item global navigation with a three-item primary navigation and a four-item ledger-only secondary navigation.

**Architecture:** `AppNav` owns only site-level destinations and maps every ledger view to the `账本` active state. A new `LedgerNav` owns ledger reporting views and is rendered by `LedgerShell` on every ledger page except the add form. Existing routes and business components stay unchanged.

**Tech Stack:** Next.js App Router, React 19, CSS, Playwright

---

### Task 1: Lock The Navigation Hierarchy With Browser Tests

**Files:**
- Modify: `e2e/ledger.spec.js`

- [ ] **Step 1: Write the failing primary-navigation test**

Replace the old shared six-label assertion with checks that `/` and `/ledger` both render exactly `行程`, `账本`, and `记一笔`, and that each page highlights the correct destination.

```js
test("primary navigation separates itinerary, ledger, and quick capture", async ({ page }) => {
  await page.goto("/");
  const primary = page.getByRole("navigation", { name: "主导航" });
  await expect(primary.getByRole("link")).toHaveText(["行程", "账本", "记一笔"]);
  await expect(primary.getByRole("link", { name: "行程" })).toHaveAttribute("aria-current", "page");

  await page.goto("/ledger");
  await expect(primary.getByRole("link", { name: "账本" })).toHaveAttribute("aria-current", "page");

  await page.goto("/add");
  await expect(primary.getByRole("link", { name: "记一笔" })).toHaveAttribute("aria-current", "page");
});
```

- [ ] **Step 2: Write the failing ledger-navigation test**

```js
test("ledger pages expose their own overview and reporting navigation", async ({ page }) => {
  await page.goto("/ledger");
  const ledgerNav = page.getByRole("navigation", { name: "账本导航" });
  await expect(ledgerNav.getByRole("link")).toHaveText(["总览", "明细", "操作", "结算"]);
  await expect(ledgerNav.getByRole("link", { name: "总览" })).toHaveAttribute("aria-current", "page");

  await page.goto("/expenses");
  await expect(ledgerNav.getByRole("link", { name: "明细" })).toHaveAttribute("aria-current", "page");

  await page.goto("/add");
  await expect(page.getByRole("navigation", { name: "账本导航" })).toHaveCount(0);
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
node e2e/run-tests.mjs e2e/ledger.spec.js --project=local-chrome --grep "primary navigation|ledger pages expose"
```

Expected: FAIL because the primary navigation still has six items and no `账本导航` exists.

### Task 2: Implement The Two Navigation Levels

**Files:**
- Modify: `src/components/AppNav.jsx`
- Create: `src/components/ledger/LedgerNav.jsx`
- Modify: `src/components/ledger/LedgerShell.jsx`

- [ ] **Step 1: Reduce `AppNav` to primary destinations**

Use these destinations:

```js
const navigationItems = [
  { id: "itinerary", href: "/", label: "行程" },
  { id: "ledger", href: "/ledger", label: "账本" },
  { id: "add", href: "/add", label: "记一笔" },
];
```

Map `dashboard`, `expenses`, `activity`, and `settlement` to the `ledger` active state; preserve `itinerary` and `add` directly. Use `aria-current="page"` on the exact primary destination and `aria-current="location"` on the primary `账本` parent while a ledger child view is open.

- [ ] **Step 2: Create `LedgerNav`**

```jsx
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
          <Link href={item.href} aria-current={active ? "page" : undefined} key={item.id}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Render the ledger navigation in `LedgerShell`**

Import `LedgerNav` and render `<LedgerNav activeView={view} />` after the ledger header only when `view !== "add"`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the focused command from Task 1. Expected: both tests PASS.

### Task 3: Style And Verify The Hierarchy

**Files:**
- Modify: `src/styles/ledger-focus.css`
- Modify: `e2e/layout-matrix.spec.js`

- [ ] **Step 1: Add the quiet ledger tab treatment**

Style `.ledger-nav` as a stable four-column tab row below the header. Use the current token palette, a restrained bottom rule, clear active underline, 44px mobile targets, visible keyboard focus, and no floating-card treatment.

- [ ] **Step 2: Keep responsive checks covering every route**

Retain `/`, `/ledger`, `/expenses`, `/add`, `/activity`, `/settlement`, and `/itinerary` in the layout matrix so both navigation levels are checked for clipping at 390, 768, 1200, and 1440 pixels.

- [ ] **Step 3: Run full verification**

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: 0 failures; PostgreSQL integration tests may remain skipped when their local environment is not configured.

- [ ] **Step 4: Commit and deploy**

```bash
git add src/components/AppNav.jsx src/components/ledger/LedgerNav.jsx src/components/ledger/LedgerShell.jsx src/styles/ledger-focus.css e2e/ledger.spec.js e2e/layout-matrix.spec.js
git commit -m "feat: separate site and ledger navigation"
git push origin HEAD:main
vercel --prod --yes
npm run test:e2e:production
```

Expected: production alias `https://aussie-split.vercel.app` is Ready and the production smoke test passes.
