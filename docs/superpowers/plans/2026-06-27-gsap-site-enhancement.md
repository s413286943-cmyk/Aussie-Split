# GSAP Site Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restrained GSAP motion layer to the ledger and itinerary pages without changing trip data, ledger math, Supabase sync, or navigation.

**Architecture:** Keep GSAP usage client-side in the existing client components. Add one small motion helper for scoped GSAP setup, reduced-motion checks, reveal timelines, and operation feedback pulses. Components add refs and `data-motion` markers, then call the helper from `useEffect`.

**Tech Stack:** Next.js 16, React 19, GSAP, existing CSS in `src/app/globals.css`, existing Node test/lint/build scripts.

---

### File Structure

- Modify: `package.json` and `package-lock.json`
  - Add `gsap` as a runtime dependency only.
  - Do not stage the pre-existing local Playwright dependency changes.
- Create: `src/lib/motion.js`
  - Owns GSAP imports, reduced-motion fallback, scoped reveal timelines, scroll reveals, and highlight pulses.
- Modify: `src/components/TripLedgerApp.jsx`
  - Adds refs and `data-motion` markers to the ledger shell, hero, summary cards, recent activity, expense rows, form, settlement cards, and nav.
  - Triggers a short recent-activity pulse after add/edit/confirm/delete.
- Modify: `src/components/ItineraryApp.jsx`
  - Adds refs and `data-motion` markers to the itinerary shell, hero, Today Travel Console, day jump, stage sections, day cards, final-day cards, and nav.
  - Adds a native `details` open handler for a subtle food-map emphasis.
- Modify: `src/app/globals.css`
  - Adds small `will-change` and reduced-motion cleanup rules for motion targets.

---

### Task 1: Add GSAP Dependency and Motion Helper

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/motion.js`

- [ ] **Step 1: Install GSAP locally**

Run:

```bash
npm install gsap
```

Expected:
- `node_modules/gsap` exists.
- `package.json` has `"gsap"` under `dependencies`.
- Existing Playwright local changes may still be present in the working tree.

- [ ] **Step 2: Create the motion helper**

Add `src/lib/motion.js`:

```javascript
import gsap from "gsap";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function withMotion(scopeRef, setup) {
  if (!scopeRef.current || prefersReducedMotion()) return undefined;

  const context = gsap.context(() => setup(gsap), scopeRef);
  return () => context.revert();
}

export function revealPage(scopeRef, groups) {
  return withMotion(scopeRef, (motion) => {
    const timeline = motion.timeline({ defaults: { duration: 0.52, ease: "power2.out" } });

    groups.forEach((group, index) => {
      const targets = scopeRef.current.querySelectorAll(group.selector);
      if (!targets.length) return;

      timeline.from(
        targets,
        {
          autoAlpha: 0,
          y: group.y ?? 18,
          scale: group.scale ?? 1,
          stagger: group.stagger ?? 0.06,
          clearProps: "all",
        },
        index === 0 ? 0 : "<0.12",
      );
    });
  });
}

export function revealOnScroll(scopeRef, selector) {
  return withMotion(scopeRef, (motion) => {
    const items = Array.from(scopeRef.current.querySelectorAll(selector));
    const observers = items.map((item) => {
      motion.set(item, { autoAlpha: 0, y: 18 });
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          motion.to(item, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out", clearProps: "all" });
          observer.disconnect();
        },
        { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
      );
      observer.observe(item);
      return observer;
    });

    return () => observers.forEach((observer) => observer.disconnect());
  });
}

export function pulseElement(element) {
  if (!element || prefersReducedMotion()) return;

  gsap.fromTo(
    element,
    { boxShadow: "0 0 0 0 rgba(20, 125, 114, 0.28)" },
    { boxShadow: "0 0 0 10px rgba(20, 125, 114, 0)", duration: 0.72, ease: "power2.out", clearProps: "boxShadow" },
  );
}
```

- [ ] **Step 3: Run the fast baseline**

Run:

```bash
npm test
```

Expected: all existing tests pass.

---

### Task 2: Add Ledger Page Motion

**Files:**
- Modify: `src/components/TripLedgerApp.jsx`

- [ ] **Step 1: Import refs and motion helpers**

Change the React import and add the helper import:

```javascript
import { useEffect, useMemo, useRef, useState } from "react";
import { pulseElement, revealPage } from "@/lib/motion";
```

- [ ] **Step 2: Add the ledger shell ref and page reveal**

Inside `TripLedgerApp`, add:

```javascript
const shellRef = useRef(null);
const [activityPulseKey, setActivityPulseKey] = useState(0);

useEffect(() => {
  if (!ready) return undefined;
  return revealPage(shellRef, [
    { selector: "[data-motion='hero']", y: 16 },
    { selector: "[data-motion='summary-card']", y: 14, stagger: 0.05 },
    { selector: "[data-motion='section']", y: 16, stagger: 0.08 },
    { selector: "[data-motion='row']", y: 12, stagger: 0.04 },
    { selector: "[data-motion='nav']", y: 10 },
  ]);
}, [ready, view]);

useEffect(() => {
  if (!activityPulseKey) return;
  pulseElement(shellRef.current?.querySelector("[data-motion='activity-panel']"));
}, [activityPulseKey]);
```

- [ ] **Step 3: Trigger feedback after operations**

At the end of `recordActivity(entry)`, after the remote insert attempt block, increment the pulse key:

```javascript
setActivityPulseKey((key) => key + 1);
```

- [ ] **Step 4: Add ledger motion markers**

Add these attributes without changing layout:

```jsx
<div className="app-shell" ref={shellRef}>
<header className="hero" data-motion="hero">
<section className="section summary-grid" data-motion="section">
<article className="card" data-motion="summary-card" key={currency}>
<section className="section" data-motion="activity-panel">
<article className="activity-row" data-motion="row" key={entry.id}>
<section className="section" data-motion="section">
<article className="expense-row" data-motion="row" key={expense.id}>
<section className="section form-card" data-motion="section">
<nav className="nav" data-motion="nav" aria-label="主导航">
```

Use the same `data-motion="row"` marker for non-editing and editing expense rows.

- [ ] **Step 5: Verify ledger pages**

Run:

```bash
npm run lint
```

Expected: lint passes with no React hook dependency errors.

Manual check:
- `/` loads with hero, totals, recent activity, and recent records revealed.
- `/expenses` rows reveal and edit form still opens.
- `/add` form still saves a new expense.
- `/settlement` settlement cards reveal.

---

### Task 3: Add Itinerary Page Motion

**Files:**
- Modify: `src/components/ItineraryApp.jsx`

- [ ] **Step 1: Import refs and motion helpers**

Change the React import and add the helper import:

```javascript
import { useEffect, useMemo, useRef, useState } from "react";
import { pulseElement, revealOnScroll, revealPage } from "@/lib/motion";
```

- [ ] **Step 2: Add the itinerary shell ref and reveals**

Inside `ItineraryContent`, add:

```javascript
const shellRef = useRef(null);

useEffect(() => {
  const pageCleanup = revealPage(shellRef, [
    { selector: "[data-motion='itinerary-hero']", y: 16 },
    { selector: "[data-motion='today-console']", y: 14 },
    { selector: "[data-motion='day-jump']", y: 10 },
    { selector: "[data-motion='nav']", y: 10 },
  ]);
  const scrollCleanup = revealOnScroll(shellRef, "[data-motion='stage'], [data-motion='day-card']");

  return () => {
    pageCleanup?.();
    scrollCleanup?.();
  };
}, []);
```

- [ ] **Step 3: Add itinerary motion markers**

Add these attributes without changing layout:

```jsx
<main className="itinerary-shell" ref={shellRef}>
<header className="itinerary-hero" data-motion="itinerary-hero">
<section className="today-console" data-motion="today-console" aria-label="今日旅行控制台">
<section className="day-jump" data-motion="day-jump" aria-label="快速跳转">
<section className="stage-section" data-motion="stage">
<article className={compact ? "day-card compact" : "day-card"} data-motion="day-card" id={day.id}>
<nav className="nav" data-motion="nav" aria-label="主导航">
```

- [ ] **Step 4: Add details-open emphasis for food-map blocks**

In `DayCard`, add a details open handler:

```javascript
function handleDetailsToggle(event) {
  if (!event.currentTarget.open) return;
  const foodBlock = event.currentTarget.querySelector("[data-food-block='true']");
  pulseElement(foodBlock);
}
```

Mark the food block rows:

```jsx
<details onToggle={handleDetailsToggle}>
...
<div
  className="time-block"
  data-food-block={block.period === "饮食" ? "true" : undefined}
  key={`${day.id}-${block.sortOrder}`}
>
```

- [ ] **Step 5: Verify itinerary page**

Run:

```bash
npm run lint
```

Expected: lint passes.

Manual check:
- `/itinerary` hero, Today Travel Console, jump links, stage sections, and day cards reveal.
- Opening a daily card with a `饮食` block gives a short emphasis.
- Image hover zoom still works.

---

### Task 4: Add Minimal CSS Support

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add scoped motion support rules**

Add near the existing global UI styles:

```css
[data-motion] {
  will-change: transform, opacity;
}

[data-food-block="true"] {
  border-radius: 12px;
}

@media (prefers-reduced-motion: reduce) {
  [data-motion],
  .day-cover-image {
    transition: none !important;
    animation: none !important;
    transform: none !important;
    opacity: 1 !important;
    visibility: visible !important;
  }
}
```

- [ ] **Step 2: Verify reduced-motion fallback**

Manual check in browser devtools or system settings:
- Enable reduced motion.
- Refresh `/` and `/itinerary`.
- Expected: content is visible immediately, no blank panels, no layout shift.

---

### Task 5: Full Verification and Focused Commit

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run full checks**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 2: Review changed files**

Run:

```bash
git status --short
git diff -- src/lib/motion.js src/components/TripLedgerApp.jsx src/components/ItineraryApp.jsx src/app/globals.css package.json package-lock.json
```

Expected:
- GSAP-related changes are present.
- Existing Playwright and itinerary local changes are not accidentally staged.

- [ ] **Step 3: Stage only GSAP feature changes**

Because `package.json` and `package-lock.json` already contain unrelated local Playwright changes, stage carefully:

```bash
git add src/lib/motion.js src/components/TripLedgerApp.jsx src/components/ItineraryApp.jsx src/app/globals.css
git add -p package.json package-lock.json
```

Expected:
- Stage only the `gsap` dependency/lockfile hunks from package files.
- Leave Playwright and existing itinerary changes unstaged.

- [ ] **Step 4: Commit**

Run:

```bash
git diff --cached --stat
git commit -m "Add GSAP motion enhancements"
```

Expected:
- Commit contains only GSAP dependency, motion helper, page markers, motion effects, and CSS support.

