# Aussie Chill Two-Level Navigation Design

## Goal

Separate site-level destinations from ledger-only views so the homepage reads as the itinerary, while `总览` is clearly the overview inside the ledger.

## Information Architecture

The fixed primary navigation has three destinations:

- `行程` -> `/`
- `账本` -> `/ledger`
- `记一笔` -> `/add`

Ledger pages add a secondary navigation with four views:

- `总览` -> `/ledger`
- `明细` -> `/expenses`
- `操作` -> `/activity`
- `结算` -> `/settlement`

The secondary navigation appears only inside the ledger shell. `记一笔` remains a primary destination because it is a high-frequency travel action, not a ledger reporting view.

## Interaction And Layout

- The primary navigation remains fixed and keeps the existing travel-docket styling.
- On desktop it remains the compact left rail, now with three larger targets.
- On mobile it remains the bottom bar with three equal-width targets.
- The ledger secondary navigation sits below the ledger header and above page content. It uses a quiet segmented treatment so it reads as local navigation rather than a second global bar.
- Active states use `aria-current="page"`; both navigation groups keep distinct accessible labels.

## Compatibility

- Existing page URLs remain valid.
- `/itinerary` remains an itinerary alias.
- No expense, settlement, sync, Supabase, itinerary-data, or offline mutation behavior changes.

## Verification

- The homepage primary navigation contains exactly `行程 / 账本 / 记一笔`.
- The ledger overview contains the four ledger views and highlights `总览`.
- Expense, activity, and settlement pages highlight their matching ledger view.
- The add page highlights `记一笔` and does not show ledger secondary navigation.
- Desktop and mobile layouts do not overflow or clip labels.
