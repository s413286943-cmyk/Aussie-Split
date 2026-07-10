# Aussie Visual System Design

## Summary

Unify Aussie Chill into one visual system across ledger, activity, settlement, add, and itinerary pages. The app should feel like a travel document wallet: fast to scan during the trip, grounded in receipts and route cards, and less like a generic rounded dashboard.

## Direction

- Use ticket paper, deep ink, sea green, sunset ochre, red earth, and mist green as the shared palette.
- Keep ledger pages dense and operational.
- Keep itinerary pages image-led, but align card, tag, button, and nav treatment with the ledger.
- Spend the visual risk on a narrow file-tab stripe used on major panels.

## Non-Goals

- Do not change expense math, split rules, Supabase sync, access code behavior, or itinerary data.
- Do not add new pages or schema fields.
- Do not add heavy new animation.

## Verification

- Run test, lint, and build.
- Check `/`, `/expenses`, `/add`, `/activity`, `/settlement`, and `/itinerary` locally.
