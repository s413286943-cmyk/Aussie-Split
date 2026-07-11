# Aussie Operations UI Refinement Design

## Summary

Refine Aussie Chill into a calmer, faster travel operations surface for four friends sharing one Australia itinerary and ledger. Preserve the existing Route Atlas and travel-docket identity, but remove accumulated decoration and reduce the distance between opening a page and completing a common travel action.

The single job of the system is: **help a traveler understand today, record a cost, and settle shared money with minimal scanning on a phone.**

## Chosen Direction

Use an **Australian field docket** direction rather than a generic warm dashboard. Route signage, luggage tags, ferry timetables, receipts, and national-park field notes provide the visual vocabulary.

Keep one signature device: a stage-aware route spine. It may mark page edges, stage headers, current-day cards, and semantic expense states. Perforation belongs only to ticket or receipt surfaces. Grid paper, multicolor stripes, left rails, perforation, and shadows must not all appear on the same component.

## Token System

### Color

- Eucalyptus paper: `#eef3ee` for the application background.
- Ticket white: `#fcfbf5` for primary surfaces.
- Deep ink: `#132522` for headings and body text.
- Harbor green: `#08766f` for primary actions and pending work.
- Sydney water: `#1b6075` for navigation and external links.
- Wattle / red earth: `#dda13a` and `#a54b3b` for time-sensitive and destructive states.

Warm sand remains a local meal or ticket accent, not the dominant page color.

### Type

- Display: `Avenir Next Condensed`, `DIN Condensed`, then Chinese system sans fallbacks. Use for the brand, day numbers, route titles, and page titles.
- Body: `Avenir Next`, `PingFang SC`, `Noto Sans CJK SC`, then system sans.
- Utility: `SFMono-Regular`, `SF Mono`, `Roboto Mono`, then monospace for money, dates, route codes, and counters.

Do not scale type continuously with viewport width. Use fixed desktop and mobile steps. Utility text must not fall below 12px; operational body text must not fall below 14px.

## Layout

### Desktop

```text
┌──────┐  ┌──────────────────────────────────────────┐
│ route│  │ compact page identity / primary command │
│ dock │  ├──────────────────────────────────────────┤
│      │  │ dense operational content               │
│      │  │ repeated rows, not oversized tiles      │
└──────┘  └──────────────────────────────────────────┘
```

The side dock remains. Page headers become compact on work pages. Repeated rows should use width for comparison instead of creating vertical whitespace.

### Mobile

```text
┌───────────────────────┐
│ compact identity      │
│ current task / status │
├───────────────────────┤
│ operational content   │
│ progressive sections  │
└───────────────────────┘
┌───────────────────────┐
│ stable bottom dock    │
└───────────────────────┘
```

The mobile dashboard must expose trip status and pending work in the first viewport. Filters, parsers, full timelines, and secondary actions use progressive disclosure. The bottom dock stays stable and consistent between ledger and itinerary.

## Page Changes

### Shared Navigation And Headers

- Use one navigation order and treatment across ledger and itinerary.
- Keep all existing destinations; use a stable six-column mobile dock and desktop side rail.
- Reduce duplicated hero commands on mobile. Navigation handles navigation; the hero keeps only the most important contextual command.
- Make focus states, active states, numbers, and sync status visually consistent.

### Dashboard

- Keep the travel-docket identity but shorten the mobile hero.
- Bring trip countdown, pending split, drafts, and activity count into the first viewport.
- Render currency summaries in a compact two-column mobile grid when width permits.
- Keep three recent operations, but reduce decorative borders and prioritize action text and time.

### Expense List

- Keep search visible on mobile; hide category, currency, split, payer, and date controls behind `More filters` by default.
- Place amount and actions in a two-column action grid so rows no longer become tall empty cards.
- Use the route spine semantically: pending, draft, and settled states receive distinct restrained colors.
- Keep receipt access and delete available without changing behavior.

### Add Expense

- Make manual entry the primary flow.
- Move bank-message parsing into a collapsed `Message recognition` section.
- Keep common templates in a horizontal strip on mobile instead of six full-width rows.
- Style receipt upload as a clear upload control and keep the save action visually dominant near the form end.
- Display Chinese category labels while preserving stored category values.

### Settlement

- Treat the settlement summary as the primary transfer instruction: currency, amount, and direction are one coherent slip.
- Convert category subtotals into compact comparison rows.
- Preserve all current calculations and the exclusion of already-settled expenses.

### Activity

- Render the full feed as a quiet chronological timeline rather than a stack of ticket cards.
- Keep backup tools on the page, but visually demote them below the operation history.

### Itinerary

- Preserve the image-led hero and Route Atlas.
- Reduce mobile hero metadata height while keeping a visible hint of Route Atlas.
- Fully style the Today field kit: carry checklist, ledger metrics, quick actions, recent expenses, and status text.
- On mobile, use a compact status grid rather than five full-width cards.
- For non-current days, keep cover, title, focus, weather, key stops, and meals visible. Move execution grid, docket, map actions, and full timeline into `View day plan`.
- The current day remains open by default.

## Motion

- Keep one restrained page-entry sequence and the existing action feedback.
- Preserve reduced-motion behavior.
- Avoid adding decorative looping motion. Route-stage changes and successful actions are the only moments that need emphasis.
- Remove persistent `will-change` where an element is no longer animating if verification shows unnecessary compositing.

## Non-Goals

- Do not change ledger math, split rules, settlement calculations, Undo behavior, receipt persistence, offline behavior, or sync contracts.
- Do not change Supabase schema, API routes, access behavior, or service-worker strategy.
- Do not change itinerary workbook data or generated itinerary JSON.
- Do not split the itinerary into new routes or add new navigation destinations.

## Acceptance Criteria

- Today carry checklist and ledger dock are aligned and visually complete at 390px and desktop widths.
- At 390px, the expense page shows search plus a filter disclosure before the first expense; advanced filters do not occupy the initial viewport.
- Expense actions use available card width and do not leave a large empty right column.
- At 390px, common templates do not render as six stacked full-width rows.
- At 390px, the dashboard shows trip status and pending metrics in the first viewport.
- Settlement category rows are materially shorter than expense cards.
- Non-current itinerary day cards do not render execution, docket, and map sections until opened.
- Ledger and itinerary navigation expose the same destinations in the same order.
- No page has horizontal overflow or clipped operational text at 390px, 768px, 1200px, and 1440px.
- Unit tests, lint, build, local end-to-end tests, and production smoke tests pass.

