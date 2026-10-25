-- Reverts 20261025090000_allow_nzd_currency.sql.
-- Refuses to run while any NZD row exists (including soft-deleted rows),
-- because the old CNY/AUD checks would reject them.
begin;

do $guard$
begin
  if exists (select 1 from public.expenses where currency = 'NZD')
     or exists (select 1 from public.expense_activity where currency = 'NZD') then
    raise exception 'NZD rows exist; export and resolve them before removing NZD support'
      using errcode = '55000';
  end if;
end
$guard$;

alter table public.expenses drop constraint if exists expenses_currency_check;
alter table public.expense_activity drop constraint if exists expense_activity_currency_check;
alter table public.expenses
  add constraint expenses_currency_check check (currency in ('CNY', 'AUD'));
alter table public.expense_activity
  add constraint expense_activity_currency_check check (currency in ('CNY', 'AUD'));

do $restore_operation$
declare
  function_definition text;
begin
  select pg_catalog.pg_get_functiondef('public.apply_expense_operation(jsonb)'::regprocedure)
    into function_definition;
  if pg_catalog.strpos(function_definition, 'not in (''CNY'', ''AUD'', ''NZD'')') = 0 then
    raise notice 'apply_expense_operation already limited to CNY and AUD';
    return;
  end if;
  execute pg_catalog.replace(function_definition, 'not in (''CNY'', ''AUD'', ''NZD'')', 'not in (''CNY'', ''AUD'')');
end
$restore_operation$;

commit;
