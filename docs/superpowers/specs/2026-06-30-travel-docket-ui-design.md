# Travel Docket UI Design

## Summary

Reshape Aussie Chill into a practical trip-control interface that feels like a shared travel docket: route sheet, receipt stack, and settlement slip in one system. The redesign is visual and structural only; expense math, Supabase sync, itinerary content, and access behavior stay unchanged.

## Design Tokens

- Paper: `#f7e9d0`
- Ink: `#10211f`
- Harbor green: `#006b64`
- Sunset orange: `#d9822b`
- Red earth: `#8f3b2f`
- Eucalyptus mist: `#dde7df`

## Type And Layout

- Display: system heavy sans, tight route-sign scale, used on page titles and money.
- Body: system sans for fast phone scanning.
- Utility: tabular numeric treatment for dates and money.
- Desktop: content sits beside a compact side dock.
- Mobile: page title first, high-frequency cards next, bottom dock stays reachable.

## Signature

Use a route-spine/file-tab stripe across hero, sections, rows, and itinerary cards. It should encode trip sequence, money status, and actions rather than acting as decoration.

## Non-Goals

- Do not add or remove itinerary days.
- Do not change expense split rules or settlement amounts.
- Do not touch Supabase schema or remote sync logic.
- Do not add a new dependency.
