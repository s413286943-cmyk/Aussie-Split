# GSAP Site Enhancement Design

## Summary

Use GSAP to add a restrained motion layer to Aussie Chill Split Bill. The site should feel smoother and more responsive, but still behave like a practical travel tool for fast check-ins, itinerary review, and split-bill edits.

## Goals

- Add light entrance motion across the ledger and itinerary pages.
- Make dashboard totals, recent activity, expense rows, itinerary stages, and daily cards easier to scan.
- Add small operation feedback after ledger changes so users can see that a save, edit, confirm, or delete action landed.
- Keep the app fast on mobile and respectful of reduced-motion settings.

## Non-Goals

- Do not change ledger calculation, split rules, Supabase sync, itinerary data, or access-code behavior.
- Do not add new pages or navigation entries.
- Do not create heavy cinematic travel animations.
- Do not mix unrelated local Playwright dependency changes into the implementation.

## Approach

Install GSAP as a runtime dependency and keep animation setup client-side. Add a small local animation helper that can:

- skip animations when `prefers-reduced-motion: reduce` is active,
- scope selectors to the current mounted page,
- clean up timelines on unmount,
- use only transform and opacity-based motion.

The implementation should use GSAP timelines and staggered entrances instead of many independent delays.

## Ledger Experience

On the ledger pages:

- The top hero fades in with a short upward motion.
- Summary cards stagger in after the hero.
- Recent activity and expense rows reveal with subtle y-offset and opacity.
- After add, edit, confirm, or delete, the activity section gets a short highlight pulse. This is visual feedback only and must not affect data flow.
- Buttons can get a small press response through CSS or GSAP, but should not delay the actual action.

## Itinerary Experience

On the itinerary page:

- The itinerary hero image and copy enter together, with the weather panel following slightly after.
- The Today Travel Console appears as one compact group.
- Stage headers and day cards reveal as they approach the viewport.
- Food-map blocks inside daily cards can receive a small emphasis when details open, but the details interaction remains native and quick.
- The existing image hover zoom stays in CSS; GSAP should complement it, not replace it.

## Bottom Navigation

The fixed bottom nav should mount softly and give a small active-state emphasis. The animation must not move the nav enough to make tapping unreliable.

## Accessibility and Performance

- Honor `prefers-reduced-motion`.
- Animate only `opacity`, `x`, `y`, `scale`, or CSS variables if needed.
- Avoid animating layout properties such as `height`, `width`, `top`, or `left`.
- Avoid infinite animations.
- Ensure timelines are cleaned up on route/page changes.

## Verification

- `npm test`
- `npm run lint`
- `npm run build`
- Manual local check on `/`, `/expenses`, `/add`, `/settlement`, and `/itinerary`.
- Verify reduced-motion mode falls back cleanly without blank or hidden content.

