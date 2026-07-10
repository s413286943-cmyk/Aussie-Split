# Aussie Chill Production Baseline

Recorded on 2026-07-10 before reliability hardening.

## Recovery Points

- Production alias: `https://aussie-split.vercel.app`
- Verified Vercel deployment: `dpl_7tWP5SfbybJvRHadS6TM1vGB8roj`
- Tombstone-aware bridge deployment: `dpl_DpLybLYhvNtb3DzYpHUha43RTn5h`
- Current compatible bridge deployment: `dpl_J6g3jtS15zY7ACkcJGBKaouW4FyC`
- Supabase project ref: `ycbkpkqrucukyyfjphiu`
- Local safety branch: `codex/aussie-reliability-hardening`
- Local safety commit: `ecf6db8d220108bb79edb799ff8f2fd6e4d150ff`
- Implementation branch: `codex/aussie-reliability-implementation`

The safety commit preserves the exact working tree that passed the baseline checks. It must remain available until the protected production deployment, database migration, offline replay, and rollback rehearsal are all verified.

The bridge deployment was built with the production environment and aliased on 2026-07-10 before compatibility DDL. The current compatible build keeps that rollback path and excludes `已分摊` expenses from the current settlement balance while retaining historical confirmed totals.

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

## Pre-Migration Backup

The read-only export created before compatibility DDL is stored outside Git at:

```text
.backups/20260710T040547Z/
```

Its manifest records 13 expenses, 13 activity entries, no attachments, one private `receipts` bucket, no stored objects, 196 relevant grant rows, and SHA-256 hashes for nine source files. All nine hashes were independently recomputed after writing the export.

Immediately before compatibility DDL, a refreshed export was written to `.backups/20260710T080427Z/`. It preserves the same 13 expenses and currency totals, plus all 19 activity entries then present. It also records no attachments, one private empty `receipts` bucket, zero policies, 196 relevant grant rows, and nine independently verified file hashes.

Supabase Advisor baseline at the same checkpoint:

- Security: five `rls_disabled_in_public` errors, one for each public application table.
- Performance: missing foreign-key indexes on `attachments.expense_id` and `members.trip_id`.

The compatibility migration is expected to remove the two index notices while leaving the five legacy-table RLS notices until the final lockdown migration.

## Compatibility Migration Checkpoint

- Applied migration: `20260710080657_shared_ledger_compatibility`
- Active bridge deployment: `dpl_J6g3jtS15zY7ACkcJGBKaouW4FyC`
- Pre-settlement-fix bridge rollback: `dpl_DpLybLYhvNtb3DzYpHUha43RTn5h`
- Post-migration live expenses: 13 of 13 rows
- Post-migration activity entries: 19
- Post-migration attachments: 0
- CNY total: 5 rows, `¥20,377.63`
- AUD total: 8 rows, `A$4,908.95`

Production-role checks covered a versioned add, newer edit, stale-write rejection, soft-delete visibility, Undo restoration, physical-delete rejection, unversioned legacy-write rejection, activity insertion, duplicate-activity rejection, and test-row cleanup. Safari then reloaded the production alias from the compatible schema, showed `已同步`, and retained the original ledger totals. No QA rows remain.

After the migration, Supabase Advisor no longer reports missing foreign-key indexes. It reports the five intentionally deferred public-table RLS errors, two expected private-table `RLS enabled, no policy` informational notices, and two new-index `unused` informational notices. Final public-table RLS remains gated on the protected server API and offline release.
