# Aussie Chill Production Baseline

Recorded on 2026-07-10 before reliability hardening.

## Recovery Points

- Production alias: `https://aussie-split.vercel.app`
- Verified Vercel deployment: `dpl_7tWP5SfbybJvRHadS6TM1vGB8roj`
- Supabase project ref: `ycbkpkqrucukyyfjphiu`
- Local safety branch: `codex/aussie-reliability-hardening`
- Local safety commit: `ecf6db8d220108bb79edb799ff8f2fd6e4d150ff`
- Implementation branch: `codex/aussie-reliability-implementation`

The safety commit preserves the exact working tree that passed the baseline checks. It must remain available until the protected production deployment, database migration, offline replay, and rollback rehearsal are all verified.

## Live Data Snapshot

| Table | Rows |
| --- | ---: |
| `trips` | 1 |
| `members` | 2 |
| `expenses` | 13 |
| `expense_activity` | 13 |
| `attachments` | 0 |

Confirmed expense totals at the baseline:

- CNY: 5 rows, `¥20,377.63`
- AUD: 8 rows, `A$4,908.95`

All 13 expenses were confirmed and still pending split. The database migration must preserve these row counts and totals.

## Baseline Verification

The preserved tree passed:

```text
npm test      46 passed, 0 failed
npm run lint  exit 0
npm run build exit 0
```

The build emitted one configuration warning because Next.js selected `/Users/SeanSun/package-lock.json` as the workspace root. The implementation branch sets `outputFileTracingRoot` to this project so the warning cannot hide an incorrect production trace.

## Known Production Risks

- The shared access code is validated in the browser.
- Browser code talks directly to Supabase with a public key.
- RLS is disabled on all five public tables and anonymous roles have write privileges.
- Receipt upload has no working Storage policy and only stores a filename on failure.
- Local changes have no durable outbox and can be overwritten or resurrected after a failed delete.
- Offline reload fails because no app shell is cached.

The hardening rollout must deploy and verify the protected server API before revoking database access from browser roles.
