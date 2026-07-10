# Itinerary Route Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/itinerary` feel like a dedicated route atlas and daily roadbook instead of a lightly styled extension of the ledger.

**Architecture:** Keep the existing itinerary JSON, weather fetching, motion helpers, and route structure. Add presentation-only React sections in `ItineraryApp.jsx` and itinerary-specific CSS in `globals.css`.

**Tech Stack:** Next.js App Router, React, CSS, existing generated itinerary data.

---

### Task 1: Route Atlas Structure

**Files:**
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/components/ItineraryApp.jsx`
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/app/globals.css`

- [x] Add a route manifest between the hero and today console that groups D0-D16 by stage.
- [x] Add helper functions for short dates, resource counts, key stops, and food summaries.
- [x] Keep `DayJump` as a compact index, but style it as a route ruler.

### Task 2: Daily Roadbook Cards

**Files:**
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/components/ItineraryApp.jsx`
- Modify: `/Users/SeanSun/Documents/Aussie/aussie-split-bill/src/app/globals.css`

- [x] Rework each day card to show an always-visible route brief: city, lodging, weather, key stops, food summary, and resource count.
- [x] Keep the existing expandable full timeline and all resource links.
- [x] Make compact D0/D16 cards still fit the same roadbook language.

### Task 3: Verification

- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Start local preview and inspect `/itinerary` on mobile and desktop.
