# Offline Ledger Rollout Record

## Candidate status

The protected offline ledger is implemented on `codex/aussie-reliability-implementation` but is not yet released to production. Production remains on the tombstone-aware compatibility bridge until private receipt upload is complete and `SUPABASE_SERVICE_ROLE_KEY` is configured in Vercel.

## Durable behavior

- IndexedDB database: `aussie-chill-v2`.
- Stores: `expenses`, `activity`, `outbox`, `receiptBlobs`, and `meta`.
- Every ledger mutation and Delete Undo is committed atomically before React state changes.
- One fenced lease drains at most 100 operations per batch; applied and stale acknowledgements are idempotent.
- Timestamp-less legacy rows receive lowest-priority deterministic versions, so they cannot overwrite a newer remote edit or tombstone.
- Service Worker caches are scoped to a build release. A failed install cannot mutate the active release's application shell.
- API requests remain network-only; navigations and itinerary assets use explicit offline strategies.

## Verification evidence

- Full Node and PostgreSQL integration suite: 183 passed, 0 failed.
- ESLint: passed.
- Next.js production build: passed.
- Focused IndexedDB, synchronization, API-client, operation, and PWA tests: passed.
- Real Chromium mobile viewport: opened online, reloaded in flight mode, closed, and reopened in flight mode with the itinerary title and cached assets present.
- Independent specification and code-quality reviews: passed after addressing manual-add defaults, legacy version priority, atomic Undo, stale activity, cross-tab edits, and release-specific caches.

## Rollback

1. Revert the offline candidate commit and redeploy the current production bridge.
2. Do not clear IndexedDB or the legacy localStorage keys during rollback; pending operations remain recoverable.
3. Do not apply the lockdown/RLS migration until protected API, offline replay, and signed receipt flows pass preview and production verification.
4. Release-specific caches are removed only when a replacement worker activates successfully; a failed install leaves the active release intact.
