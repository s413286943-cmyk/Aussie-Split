# Aussie Operations UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing travel-docket UI into a calmer mobile-first operations surface without changing ledger, sync, receipt, or itinerary data behavior.

**Architecture:** Keep the current Next.js routes and protected data flow. Introduce one shared navigation component, add small disclosure states to existing ledger components, move non-current itinerary secondary content behind the existing lazy details boundary, and refine the existing CSS layers rather than adding another override stylesheet.

**Tech Stack:** Next.js 16, React 19, plain CSS, GSAP, Node test runner, Playwright.

---

### Task 1: Add Layout Regression Coverage

**Files:**
- Modify: `e2e/ledger.spec.js`
- Modify: `e2e/itinerary.spec.js`
- Modify: `e2e/fixtures/layout.js`

- [ ] **Step 1: Add mobile ledger assertions**

Add a test that opens the dashboard at `390x844` and verifies `.docket-status` plus `.docket-metrics` intersect the initial viewport. Add a second test that opens `/expenses`, verifies the search field and filter disclosure are visible, verifies `.advanced-filters` is hidden, expands it, and then verifies the advanced controls are visible.

```js
test("mobile ledger exposes work before advanced controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".docket-status")).toBeInViewport();
  await expect(page.locator(".docket-metrics")).toBeInViewport();

  await page.goto("/expenses");
  await expect(page.getByLabel("搜索项目或备注")).toBeVisible();
  await expect(page.locator(".advanced-filters")).toBeHidden();
  await page.getByRole("button", { name: /更多筛选/ }).click();
  await expect(page.locator(".advanced-filters")).toBeVisible();
});
```

- [ ] **Step 2: Add mobile form and action-grid assertions**

Verify the message-recognition disclosure is closed by default, the template strip is shorter than two button rows, and a mobile expense row uses most of its width for the action grid.

```js
await page.goto("/add");
await expect(page.locator(".message-capture[open]")).toHaveCount(0);
const templateHeight = await page.locator(".quick-templates").evaluate((element) => element.getBoundingClientRect().height);
expect(templateHeight).toBeLessThan(64);
```

- [ ] **Step 3: Add itinerary disclosure and field-kit assertions**

Verify the Today checklist checkbox is no wider than `28px`, its label text remains in the same row, and a non-current day does not mount `.day-execution-grid` until `查看当天安排` is opened.

```js
const checkboxWidth = await page.locator(".carry-check-item input").first().evaluate((element) => element.getBoundingClientRect().width);
expect(checkboxWidth).toBeLessThanOrEqual(28);
await expect(page.locator("#d1 .day-execution-grid")).toHaveCount(0);
await page.locator("#d1").getByText("查看当天安排").click();
await expect(page.locator("#d1 .day-execution-grid")).toBeVisible();
```

- [ ] **Step 4: Run the focused tests and confirm RED**

Run:

```bash
npm run test:e2e -- --grep "mobile ledger exposes|message recognition|field kit"
```

Expected: failures because the current filters are always open, templates stack vertically, field-kit styles are absent, and itinerary summary modules mount outside details.

- [ ] **Step 5: Commit the tests after the implementation tasks make them green**

The test changes remain uncommitted until Tasks 2-4 satisfy them, so every implementation commit includes green coverage.

### Task 2: Unify Foundation And Navigation

**Files:**
- Create: `src/components/AppNav.jsx`
- Modify: `src/components/ledger/LedgerShell.jsx`
- Modify: `src/components/ItineraryApp.jsx`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/docket.css`
- Modify: `src/styles/motion.css`

- [ ] **Step 1: Create one shared navigation model**

Create `AppNav` with the existing six destinations in this order: overview, expenses, add, activity, settlement, itinerary. Accept `activeView` and render the existing accessible `主导航` label and `data-motion="nav"` hook.

```jsx
const items = [
  ["dashboard", "/", "总览"],
  ["expenses", "/expenses", "明细"],
  ["add", "/add", "新增"],
  ["activity", "/activity", "操作"],
  ["settlement", "/settlement", "结算"],
  ["itinerary", "/itinerary", "行程"],
];
```

Replace the duplicated navigation markup in `LedgerShell` and `ItineraryApp` with this component.

- [ ] **Step 2: Apply the refined token and typography system**

Update root tokens to eucalyptus paper, ticket white, deep ink, harbor green, Sydney water, wattle, and red earth. Set body, display, and utility font stacks from the design spec. Apply utility typography to money, dates, day labels, and counters.

- [ ] **Step 3: Restrict signature decoration**

Keep the route spine on page edges, major headers, current-day cards, and semantic expense states. Remove perforation from activity rows and non-ticket summary surfaces. Reduce card shadows to one quiet elevation level.

- [ ] **Step 4: Remove persistent compositing hints**

Delete the global `[data-motion] { will-change: ... }` rule. Keep reduced-motion declarations and existing GSAP lifecycle cleanup.

- [ ] **Step 5: Run lint and the navigation E2E subset**

Run:

```bash
npm run lint
npm run test:e2e -- --grep "navigation|mobile ledger exposes"
```

Expected: lint passes and both ledger and itinerary expose the same six labels without overflow.

### Task 3: Refine Ledger Work Surfaces

**Files:**
- Modify: `src/components/ledger/ExpenseList.jsx`
- Modify: `src/components/ledger/ExpenseForm.jsx`
- Modify: `src/components/TripLedgerApp.jsx`
- Modify: `src/lib/ledger.js`
- Modify: `src/styles/docket.css`
- Modify: `src/styles/ledger-focus.css`
- Test: `tests/ledger.test.mjs`
- Test: `e2e/ledger.spec.js`

- [ ] **Step 1: Add a tested Chinese category presenter**

Export `formatCategoryLabel(category)` from `src/lib/ledger.js`. It returns `餐饮` for the stored `dining` value and returns existing Chinese categories unchanged. Add unit coverage before using it in form options, expense tags, and settlement rows.

```js
assert.equal(formatCategoryLabel("dining"), "餐饮");
assert.equal(formatCategoryLabel("酒店"), "酒店");
```

- [ ] **Step 2: Split search from advanced filters**

Add local `filtersOpen` state in `ExpenseListPage`. Keep search and a `更多筛选` button visible; wrap category, currency, split, payer, and date controls in `.advanced-filters`. The button must expose `aria-expanded` and show an active-filter count when non-default controls are set.

- [ ] **Step 3: Compact expense actions and semantic state**

Add `is-settled`, `is-draft`, and `is-pending` classes through `rowClassName`. Style `.row-actions` as a two-column grid with the amount spanning both columns. Use full available width on mobile and a bounded right column on desktop.

- [ ] **Step 4: Make message parsing secondary**

Wrap the bank-message textarea and parser button in a closed `<details className="message-capture">` with summary `短信识别`. Keep common templates outside the disclosure and style them as a single horizontal strip on mobile. Add `.receipt-upload` styling around the existing file input without changing accepted formats.

- [ ] **Step 5: Compact dashboard and settlement**

Shorten the dashboard hero on mobile, hide redundant secondary hero commands there, use two-column summary metrics, add `.settlement-breakdown` to category rows, and style settlement summaries as transfer slips. Do not add new settlement behavior.

- [ ] **Step 6: Convert the full activity feed to a quiet timeline**

Use one chronological axis on `.activity-page .activity-list`, remove per-row perforation and heavy card treatment, and keep backup tools visually secondary.

- [ ] **Step 7: Run ledger unit and E2E tests**

Run:

```bash
node --conditions=react-server --test tests/ledger.test.mjs tests/activity.test.mjs
npm run test:e2e -- --grep "ledger|activity|backup|message recognition|mobile ledger exposes"
```

Expected: all focused tests pass, including existing add/edit/split/delete/Undo flows.

- [ ] **Step 8: Commit the ledger refinement**

```bash
git add src/components/AppNav.jsx src/components/ledger src/components/TripLedgerApp.jsx src/lib/ledger.js src/styles tests/ledger.test.mjs e2e/ledger.spec.js
git commit -m "feat: refine mobile ledger operations"
```

### Task 4: Refine Today Console And Daily Disclosure

**Files:**
- Modify: `src/components/ItineraryApp.jsx`
- Modify: `src/components/itinerary/TodayConsole.jsx`
- Modify: `src/styles/route-atlas.css`
- Modify: `src/styles/live-route.css`
- Modify: `src/styles/itinerary.css`
- Test: `e2e/itinerary.spec.js`

- [ ] **Step 1: Move secondary day modules behind the lazy boundary**

For each non-current day, keep weather, key stops, and meal brief before `LazyDayDetails`. Move `DayExecutionGrid`, `DayDocket`, `DayMapActions`, and the full timeline inside `LazyDayDetails`. Because current days pass `defaultOpen`, they continue to mount and display the full operational view.

- [ ] **Step 2: Build the missing Today field-kit layout**

Add styles for `.today-field-kit`, `.carry-checklist`, `.carry-check-item`, `.field-kit-head`, `.today-ledger-dock`, `.ledger-dock-metrics`, `.ledger-dock-actions`, and `.ledger-dock-recent`. Desktop uses a two-column field kit; mobile uses one column. Checkboxes remain `22px` and align with their label and detail.

- [ ] **Step 3: Compress mobile command status**

At mobile widths, use a two-column Today status grid, allow the final clothing card to span both columns, reduce minimum card height, and keep weather/clothing text readable. Keep desktop at five columns.

- [ ] **Step 4: Shorten mobile hero metadata**

Render hero metadata in a compact two-column grid and make stage chips a horizontal strip rather than full-width rows. Preserve the hero image and ensure the Route Atlas remains visible at the bottom of the first `844px` viewport.

- [ ] **Step 5: Run itinerary E2E tests**

Run:

```bash
npm run test:e2e -- --grep "itinerary|field kit|direct D15"
```

Expected: direct D15 remains within the viewport, non-current details mount only after opening, and no operational text clips.

- [ ] **Step 6: Commit the itinerary refinement**

```bash
git add src/components/ItineraryApp.jsx src/components/itinerary/TodayConsole.jsx src/styles/itinerary.css src/styles/route-atlas.css src/styles/live-route.css e2e/itinerary.spec.js
git commit -m "feat: streamline the live itinerary"
```

### Task 5: Full Responsive Critique And Cleanup

**Files:**
- Modify only files touched in Tasks 2-4 when screenshots reveal a verified defect.
- Test: `e2e/fixtures/layout.js`
- Test: `e2e/ledger.spec.js`
- Test: `e2e/itinerary.spec.js`

- [ ] **Step 1: Capture all routes at four widths**

Inspect `/`, `/expenses`, `/add`, `/activity`, `/settlement`, and `/itinerary` at `390x844`, `768x1024`, `1200x900`, and `1440x1000`. Verify first viewport hierarchy, text wrapping, fixed navigation, and control reachability.

- [ ] **Step 2: Run overflow and clipped-text checks**

Extend `findClippedText` with the new field-kit, settlement, filters, and form selectors. Assert no horizontal document overflow and no clipped operational text.

- [ ] **Step 3: Remove one redundant visual device per surface**

During screenshot review, each component may use at most one of: route spine, ticket perforation, ruled grid, multicolor stripe, or elevated shadow. Remove any combination that violates this rule.

- [ ] **Step 4: Run the complete local verification suite**

Run:

```bash
npm test
npm run lint
npm run build
npm run test:e2e
git diff --check
```

Expected: `0` test failures, lint exits `0`, build completes, all E2E tests pass, and `git diff --check` is clean. PostgreSQL integration tests may remain conditionally skipped when their documented test environment is absent.

- [ ] **Step 5: Commit final visual cleanup**

```bash
git add src e2e tests package.json package-lock.json
git commit -m "style: finish the travel operations system"
```

Only stage files that actually changed; omit package files when no dependency was added.

### Task 6: Push And Verify Production

**Files:**
- No source changes expected.

- [ ] **Step 1: Fast-forward local main and push**

Verify `main` is an ancestor, update it to the completed branch, and push `main:main` without force.

- [ ] **Step 2: Wait for Vercel Ready**

Inspect the newest `aussie-split` production deployment and confirm the `https://aussie-split.vercel.app` alias points to it.

- [ ] **Step 3: Run production smoke**

Run:

```bash
npm run test:e2e:production
```

Expected: the production smoke project passes without issuing unintended mutation requests.

- [ ] **Step 4: Verify the deployed visual shell**

Open the production dashboard and itinerary in an authenticated browser session. Check mobile navigation, dashboard first viewport, expense filters, Today field kit, and one non-current day disclosure.

