-- Allow NZD alongside CNY and AUD for the 2027 New Zealand trip.
-- Only widens checks; no existing row, grant, policy or RLS setting changes.
-- Safe to apply before the new web build: the current build never sends NZD.
begin;

-- 1. Replace every currency check on the two ledger tables.
do $currency_checks$
declare
  constraint_record record;
begin
  for constraint_record in
    select relation.relname as table_name, check_constraint.conname as constraint_name
    from pg_catalog.pg_constraint as check_constraint
    join pg_catalog.pg_class as relation on relation.oid = check_constraint.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('expenses', 'expense_activity')
      and check_constraint.contype = 'c'
      and pg_catalog.pg_get_constraintdef(check_constraint.oid) ilike '%currency%'
  loop
    execute pg_catalog.format(
      'alter table public.%I drop constraint %I',
      constraint_record.table_name,
      constraint_record.constraint_name
    );
  end loop;
end
$currency_checks$;

alter table public.expenses
  add constraint expenses_currency_check check (currency in ('CNY', 'AUD', 'NZD'));
alter table public.expense_activity
  add constraint expense_activity_currency_check check (currency in ('CNY', 'AUD', 'NZD'));

-- 2. Patch the currency allow-list inside apply_expense_operation in place.
-- Rewriting from the live definition keeps any later production edits, the owner and the grants.
do $patch_operation$
declare
  function_definition text;
  patched_definition text;
  old_list constant text := 'not in (''CNY'', ''AUD'')';
  new_list constant text := 'not in (''CNY'', ''AUD'', ''NZD'')';
  occurrences integer;
begin
  select pg_catalog.pg_get_functiondef('public.apply_expense_operation(jsonb)'::regprocedure)
    into function_definition;

  if pg_catalog.strpos(function_definition, new_list) > 0 then
    raise notice 'apply_expense_operation already accepts NZD';
    return;
  end if;

  occurrences := (pg_catalog.length(function_definition)
    - pg_catalog.length(pg_catalog.replace(function_definition, old_list, '')))
    / pg_catalog.length(old_list);
  if occurrences <> 2 then
    raise exception 'apply_expense_operation currency checks changed: expected 2, found %', occurrences
      using errcode = '55000';
  end if;

  patched_definition := pg_catalog.replace(function_definition, old_list, new_list);
  execute patched_definition;
end
$patch_operation$;

commit;
