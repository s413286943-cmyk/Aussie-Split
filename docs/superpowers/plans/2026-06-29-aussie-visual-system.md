# Aussie Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a unified travel-document visual system to the existing Aussie Chill app.

**Architecture:** Keep the current React component structure. Use CSS tokens and scoped class additions for the visual system, with minimal JSX changes where structure needs clearer hooks.

**Tech Stack:** Next.js App Router, React, CSS, existing GSAP helpers.

---

### Task 1: Ledger Visual System

**Files:**
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/components/TripLedgerApp.jsx`
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/app/globals.css`

- [ ] Add small class hooks for ledger sections, summary cards, row metadata, activity page, and settlement cards.
- [ ] Replace generic rounded dashboard styling with travel-wallet styling in CSS.
- [ ] Verify the dashboard, expenses, add, activity, and settlement views still render the same data and controls.

### Task 2: Itinerary Alignment

**Files:**
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/components/ItineraryApp.jsx`
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/app/globals.css`

- [ ] Reuse the shared visual tokens for itinerary cards, weather strips, resource links, and nav.
- [ ] Keep hero imagery and existing motion behavior intact.
- [ ] Verify the itinerary page still shows the daily console, stages, day cards, weather, and food map.

### Task 3: Verification

**Files:**
- Test current project only.

- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Start local preview and inspect core pages in a browser-sized viewport.
