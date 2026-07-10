# Travel Docket UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the visible UI into a unified travel docket system across the ledger and itinerary.

**Architecture:** Keep the existing Next.js routes and React data flow. Add small presentational components and CSS hooks only where they make the UI clearer.

---

### Task 1: Ledger Command Surface

**Files:**
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/components/TripLedgerApp.jsx`
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/app/globals.css`

- [x] Add a dashboard docket panel with trip status, pending split count, draft count, and recent activity count.
- [x] Restyle summary cards, activity feed, receipt rows, filters, form, and settlement as one ticket-wallet system.
- [x] Keep all current controls and data visible.

### Task 2: Shared Navigation And Itinerary Alignment

**Files:**
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/components/ItineraryApp.jsx`
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/app/globals.css`

- [x] Turn the shared nav into a compact side dock on desktop and bottom dock on mobile.
- [x] Align itinerary hero, today console, stage headers, day cards, weather, and resource links to the docket tokens.
- [x] Preserve existing imagery, daily blocks, weather fetching, and motion behavior.

### Task 3: Verification

- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Start local preview and inspect dashboard, expenses, add, activity, settlement, and itinerary.
