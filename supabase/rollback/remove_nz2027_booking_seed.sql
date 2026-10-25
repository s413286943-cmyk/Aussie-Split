-- Reverts 20261025091000_seed_nz2027_bookings.sql by soft-deleting the seeded rows.
-- Physical deletes are blocked by design. Rows someone already edited in the app
-- (mutation_version no longer the seed version) are left untouched.
begin;

with tombstoned as (
  update public.expenses
  set
    deleted_at = pg_catalog.now(),
    mutation_version = pg_catalog.lpad((pg_catalog.floor(extract(epoch from pg_catalog.now()) * 1000)::bigint)::text, 13, '0')
      || '-' || pg_catalog.substr(mutation_version, 15, 6) || '-rollback-nz2027'
  where id like 'nz27-%'
    and deleted_at is null
    and mutation_version like '1792886400000-%-seed-nz2027'
  returning id, item, amount, currency
)
insert into public.expense_activity (id, expense_id, action, item, amount, currency, summary, created_at)
select
  'activity-rollback-nz2027-' || tombstoned.id,
  tombstoned.id,
  'delete',
  tombstoned.item,
  tombstoned.amount,
  tombstoned.currency,
  '删除了 ' || tombstoned.item,
  pg_catalog.now()
from tombstoned
on conflict (id) do nothing;

commit;
