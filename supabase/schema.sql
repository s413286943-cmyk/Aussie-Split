create table if not exists public.trips (
  id text primary key,
  name text not null,
  starts_on date,
  ends_on date,
  split_rule text not null default 'couple_50_50'
);

create table if not exists public.members (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  name text not null
);

create table if not exists public.expenses (
  id text primary key,
  category text not null,
  item text not null,
  date date,
  currency text not null check (currency in ('CNY', 'AUD')),
  amount numeric(12, 2) not null,
  payer text not null check (payer in ('us', 'them')),
  status text not null check (status in ('confirmed', 'draft')),
  note text not null default '',
  attachment_name text not null default '',
  split_settled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.expenses
  add column if not exists split_settled boolean not null default false;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id text references public.expenses(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.expense_activity (
  id text primary key,
  expense_id text not null,
  action text not null check (action in ('add', 'edit', 'confirm', 'delete')),
  item text not null,
  amount numeric(12, 2) not null,
  currency text not null check (currency in ('CNY', 'AUD')),
  summary text not null,
  created_at timestamptz not null default now()
);

insert into public.trips (id, name, starts_on, ends_on, split_rule)
values ('aussie-chill-2026', 'Aussie Chill · 南十字星下的十六日', '2026-07-28', '2026-08-13', 'couple_50_50')
on conflict (id) do nothing;

insert into public.members (id, trip_id, name)
values
  ('us', 'aussie-chill-2026', '孙张'),
  ('them', 'aussie-chill-2026', '胡董')
on conflict (id) do nothing;

insert into public.expenses (id, category, item, date, currency, amount, payer, status, note)
values
  ('hotel-oaks-melbourne', '酒店', 'Oaks Melbourne on Market Hotel', '2026-07-29', 'CNY', 2534.86, 'us', 'confirmed', '墨尔本 CBD，2晚'),
  ('hotel-seaview', '酒店', 'Seaview Motel & Apartments', '2026-07-31', 'CNY', 906.28, 'us', 'confirmed', 'Apollo Bay，1晚'),
  ('hotel-southern-ocean', '酒店', 'Southern Ocean Villas', '2026-08-01', 'CNY', 1691.52, 'us', 'confirmed', 'Port Campbell，1晚'),
  ('hotel-holiday-inn', '酒店', 'Holiday Inn Melbourne Airport', '2026-08-02', 'CNY', 1581.12, 'us', 'confirmed', '墨尔本机场，1晚，2间房'),
  ('hotel-southern-cross', '酒店', 'Southern Cross Atrium Apartments', '2026-08-03', 'CNY', 9669.66, 'us', 'confirmed', '凯恩斯，5晚'),
  ('hotel-oaks-sydney', '酒店', 'Oaks Sydney Goldsbrough Suites', '2026-08-08', 'CNY', 9661.82, 'us', 'confirmed', '悉尼，5晚'),
  ('car-great-ocean', '租车', '墨尔本—大洋路租车，含保险', '2026-07-31', 'CNY', 2746.00, 'us', 'confirmed', '已锁定，含保险'),
  ('car-atherton', '租车', '凯恩斯阿瑟顿租车，不含保险', '2026-08-06', 'CNY', 752.00, 'us', 'confirmed', '不含保险，后续如补保险另算'),
  ('tour-daintree', '活动', 'Billy Tea Daintree Rainforest & Cape Tribulation Tour', '2026-08-05', 'AUD', 956.00, 'us', 'confirmed', '4 adults，按原币记录'),
  ('tour-whale', '活动', 'Captain Cook Whale Watching', '2026-08-11', 'AUD', 340.20, 'us', 'confirmed', '已付款，含 fuel surcharge / card surcharge')
on conflict (id) do nothing;

-- Create a private Storage bucket named "receipts" in the Supabase dashboard.
-- For this quick shared-link v1, use the Vercel URL and shared access code as the practical access boundary.

-- Shared-ledger compatibility objects are applied after the legacy seed rows so
-- existing and freshly seeded expenses receive the same deterministic backfill.

alter table public.expenses
  add column if not exists updated_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists mutation_version text;

alter table public.expenses
  alter column updated_at set default now();

update public.expenses
set
  updated_at = coalesce(updated_at, created_at),
  mutation_version = coalesce(
    mutation_version,
    lpad((floor(extract(epoch from created_at) * 1000)::bigint)::text, 13, '0')
      || '-000000-server'
  )
where updated_at is null
   or mutation_version is null;

alter table public.expenses
  alter column updated_at set not null,
  alter column mutation_version set not null;

do $constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_mutation_version_format_check'
  ) then
    alter table public.expenses
      add constraint expenses_mutation_version_format_check
      check (mutation_version ~ '^[0-9]{13}-[0-9]{6}-[a-z0-9]+(?:-[a-z0-9]+)*$');
  end if;
end
$constraint$;

alter table public.attachments
  add column if not exists receipt_id text,
  add column if not exists original_name text not null default '',
  add column if not exists mime_type text not null default '',
  add column if not exists size_bytes bigint not null default 0,
  add column if not exists finalized_at timestamptz,
  add column if not exists deleted_at timestamptz;

do $constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.attachments'::regclass
      and conname = 'attachments_size_bytes_check'
  ) then
    alter table public.attachments
      add constraint attachments_size_bytes_check
      check (size_bytes between 0 and 10485760);
  end if;
end
$constraint$;

create unique index if not exists attachments_receipt_id_unique
  on public.attachments (receipt_id)
  where receipt_id is not null;

create unique index if not exists attachments_storage_path_unique
  on public.attachments (storage_path)
  where storage_path is not null;

create index if not exists attachments_expense_id_idx on public.attachments (expense_id);
create index if not exists members_trip_id_idx on public.members (trip_id);

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

create table app_private.expense_operations (
  op_id text primary key,
  operation_type text not null check (operation_type in ('upsert', 'delete')),
  expense_id text not null,
  mutation_version text not null,
  created_at timestamptz not null default now()
);

create table app_private.access_attempts (
  address_hash text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table app_private.expense_operations owner to postgres;
alter table app_private.access_attempts owner to postgres;
alter table app_private.expense_operations enable row level security;
alter table app_private.access_attempts enable row level security;

revoke all on table app_private.expense_operations from public, anon, authenticated;
revoke all on table app_private.access_attempts from public, anon, authenticated;
grant select, insert on table app_private.expense_operations to service_role;
grant select, insert, update, delete on table app_private.access_attempts to service_role;

create or replace function app_private.enforce_expense_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.mutation_version is null
     or new.mutation_version !~ '^[0-9]{13}-[0-9]{6}-[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid_mutation_version' using errcode = '22023';
  end if;

  if substring(new.mutation_version from 1 for 13)::bigint
       > floor(extract(epoch from (pg_catalog.now() + interval '5 minutes')) * 1000)::bigint then
    raise exception 'mutation_version_in_future' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if new.mutation_version <= old.mutation_version then
      raise exception 'stale_mutation_version' using errcode = '40001';
    end if;
    new.attachment_name := old.attachment_name;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end
$function$;

create or replace function app_private.reject_physical_expense_delete()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception 'physical_delete_disabled' using errcode = '55000';
end
$function$;

alter function app_private.enforce_expense_mutation() owner to postgres;
alter function app_private.reject_physical_expense_delete() owner to postgres;
revoke execute on function app_private.enforce_expense_mutation() from public, anon, authenticated;
revoke execute on function app_private.reject_physical_expense_delete() from public, anon, authenticated;

drop trigger if exists enforce_expense_mutation on public.expenses;
create trigger enforce_expense_mutation
before insert or update on public.expenses
for each row
execute function app_private.enforce_expense_mutation();

drop trigger if exists reject_physical_expense_delete on public.expenses;
create trigger reject_physical_expense_delete
before delete on public.expenses
for each row
execute function app_private.reject_physical_expense_delete();

create or replace function public.apply_expense_operation(operation jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  requested_op_id text;
  op_type text;
  incoming_version text;
  expense_payload jsonb;
  activity_payload jsonb;
  requested_expense_id text;
  existing_version text;
  expense_exists boolean := false;
  inserted_operations integer;
  expense_date date;
  expense_amount numeric;
  activity_amount numeric;
  activity_created_at timestamptz;
begin
  if operation is null or pg_catalog.jsonb_typeof(operation) is distinct from 'object' then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;

  requested_op_id := operation ->> 'opId';
  op_type := operation ->> 'type';
  incoming_version := operation ->> 'mutationVersion';
  expense_payload := operation -> 'expense';
  activity_payload := operation -> 'activity';

  if requested_op_id is null or requested_op_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'invalid_op_id' using errcode = '22023';
  end if;
  if op_type is null or op_type not in ('upsert', 'delete') then
    raise exception 'invalid_operation_type' using errcode = '22023';
  end if;
  if incoming_version is null
     or incoming_version !~ '^[0-9]{13}-[0-9]{6}-[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid_mutation_version' using errcode = '22023';
  end if;
  if substring(incoming_version from 1 for 13)::bigint
       > floor(extract(epoch from (pg_catalog.now() + interval '5 minutes')) * 1000)::bigint then
    raise exception 'mutation_version_in_future' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(expense_payload) is distinct from 'object' then
    raise exception 'invalid_expense_payload' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(activity_payload) is distinct from 'object' then
    raise exception 'invalid_activity_payload' using errcode = '22023';
  end if;

  requested_expense_id := expense_payload ->> 'id';
  if requested_expense_id is null or requested_expense_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'invalid_expense_payload' using errcode = '22023';
  end if;

  if coalesce(activity_payload ->> 'id', '') = ''
     or activity_payload ->> 'expenseId' is distinct from requested_expense_id
     or coalesce(activity_payload ->> 'action', '') not in ('add', 'edit', 'confirm', 'delete')
     or coalesce(activity_payload ->> 'item', '') = ''
     or pg_catalog.jsonb_typeof(activity_payload -> 'amount') is distinct from 'number'
     or coalesce(activity_payload ->> 'currency', '') not in ('CNY', 'AUD')
     or pg_catalog.jsonb_typeof(activity_payload -> 'summary') is distinct from 'string'
     or pg_catalog.jsonb_typeof(activity_payload -> 'createdAt') is distinct from 'string' then
    raise exception 'invalid_activity_payload' using errcode = '22023';
  end if;

  begin
    activity_amount := (activity_payload ->> 'amount')::numeric;
    activity_created_at := (activity_payload ->> 'createdAt')::timestamptz;
  exception
    when others then
      raise exception 'invalid_activity_payload' using errcode = '22023';
  end;

  if op_type = 'upsert' then
    if coalesce(expense_payload ->> 'category', '') = ''
       or coalesce(expense_payload ->> 'item', '') = ''
       or coalesce(expense_payload ->> 'currency', '') not in ('CNY', 'AUD')
       or pg_catalog.jsonb_typeof(expense_payload -> 'amount') is distinct from 'number'
       or coalesce(expense_payload ->> 'payer', '') not in ('us', 'them')
       or coalesce(expense_payload ->> 'status', '') not in ('confirmed', 'draft')
       or pg_catalog.jsonb_typeof(expense_payload -> 'note') is distinct from 'string'
       or pg_catalog.jsonb_typeof(expense_payload -> 'splitSettled') is distinct from 'boolean'
       or (
         expense_payload ? 'date'
         and pg_catalog.jsonb_typeof(expense_payload -> 'date') not in ('string', 'null')
       ) then
      raise exception 'invalid_expense_payload' using errcode = '22023';
    end if;

    begin
      expense_date := nullif(expense_payload ->> 'date', '')::date;
      expense_amount := (expense_payload ->> 'amount')::numeric;
    exception
      when others then
        raise exception 'invalid_expense_payload' using errcode = '22023';
    end;
  end if;

  insert into app_private.expense_operations (
    op_id,
    operation_type,
    expense_id,
    mutation_version
  )
  values (
    requested_op_id,
    op_type,
    requested_expense_id,
    incoming_version
  )
  on conflict (op_id) do nothing;

  get diagnostics inserted_operations = row_count;
  if inserted_operations = 0 then
    return pg_catalog.jsonb_build_object('opId', requested_op_id, 'status', 'duplicate');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(requested_expense_id, 0));

  select true, current_expense.mutation_version
  into expense_exists, existing_version
  from public.expenses as current_expense
  where current_expense.id = requested_expense_id
  for update;

  expense_exists := coalesce(expense_exists, false);
  if expense_exists and incoming_version <= existing_version then
    return pg_catalog.jsonb_build_object('opId', requested_op_id, 'status', 'stale');
  end if;

  if op_type = 'upsert' and expense_exists then
    update public.expenses
    set
      category = expense_payload ->> 'category',
      item = expense_payload ->> 'item',
      date = expense_date,
      currency = expense_payload ->> 'currency',
      amount = expense_amount,
      payer = expense_payload ->> 'payer',
      status = expense_payload ->> 'status',
      note = expense_payload ->> 'note',
      split_settled = (expense_payload ->> 'splitSettled')::boolean,
      deleted_at = null,
      mutation_version = incoming_version
    where id = requested_expense_id;
  elsif op_type = 'upsert' then
    insert into public.expenses (
      id,
      category,
      item,
      date,
      currency,
      amount,
      payer,
      status,
      note,
      split_settled,
      mutation_version
    )
    values (
      requested_expense_id,
      expense_payload ->> 'category',
      expense_payload ->> 'item',
      expense_date,
      expense_payload ->> 'currency',
      expense_amount,
      expense_payload ->> 'payer',
      expense_payload ->> 'status',
      expense_payload ->> 'note',
      (expense_payload ->> 'splitSettled')::boolean,
      incoming_version
    );
  elsif expense_exists then
    update public.expenses
    set
      deleted_at = pg_catalog.now(),
      mutation_version = incoming_version
    where id = requested_expense_id;
  else
    raise exception 'expense_not_found' using errcode = 'P0002';
  end if;

  begin
    insert into public.expense_activity (
      id,
      expense_id,
      action,
      item,
      amount,
      currency,
      summary,
      created_at
    )
    values (
      activity_payload ->> 'id',
      requested_expense_id,
      activity_payload ->> 'action',
      activity_payload ->> 'item',
      activity_amount,
      activity_payload ->> 'currency',
      activity_payload ->> 'summary',
      activity_created_at
    );
  exception
    when unique_violation then
      raise exception 'activity_id_conflict' using errcode = '23505';
  end;

  return pg_catalog.jsonb_build_object('opId', requested_op_id, 'status', 'applied');
end
$function$;

alter function public.apply_expense_operation(jsonb) owner to postgres;
revoke execute on function public.apply_expense_operation(jsonb) from public, anon, authenticated;
grant execute on function public.apply_expense_operation(jsonb) to service_role;

create or replace function public.consume_access_attempt(address_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  normalized_hash text := address_hash;
  attempted_at timestamptz := pg_catalog.clock_timestamp();
  returned_count integer;
  returned_blocked_until timestamptz;
begin
  if normalized_hash is null or normalized_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_address_hash' using errcode = '22023';
  end if;

  insert into app_private.access_attempts as attempts (
    address_hash,
    window_started_at,
    attempt_count,
    blocked_until,
    updated_at
  )
  values (
    normalized_hash,
    attempted_at,
    1,
    null,
    attempted_at
  )
  on conflict on constraint access_attempts_pkey do update
  set
    attempt_count = case
      when attempts.blocked_until > excluded.updated_at then attempts.attempt_count
      when attempts.blocked_until is not null then 1
      when attempts.window_started_at <= excluded.updated_at - interval '15 minutes' then 1
      else attempts.attempt_count + 1
    end,
    window_started_at = case
      when attempts.blocked_until is not null
        or attempts.window_started_at <= excluded.updated_at - interval '15 minutes'
        then excluded.window_started_at
      else attempts.window_started_at
    end,
    blocked_until = case
      when attempts.blocked_until > excluded.updated_at then attempts.blocked_until
      when attempts.blocked_until is not null then null
      when attempts.window_started_at <= excluded.updated_at - interval '15 minutes' then null
      when attempts.attempt_count + 1 >= 6 then excluded.updated_at + interval '15 minutes'
      else null
    end,
    updated_at = excluded.updated_at
  returning attempts.attempt_count, attempts.blocked_until
  into returned_count, returned_blocked_until;

  return pg_catalog.jsonb_build_object(
    'allowed', returned_blocked_until is null or returned_blocked_until <= attempted_at,
    'remaining', greatest(5 - returned_count, 0),
    'blockedUntil', returned_blocked_until
  );
end
$function$;

create or replace function public.reset_access_attempt(address_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  normalized_hash text := address_hash;
begin
  if normalized_hash is null or normalized_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_address_hash' using errcode = '22023';
  end if;

  delete from app_private.access_attempts
  where app_private.access_attempts.address_hash = normalized_hash;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'remaining', 5,
    'blockedUntil', null
  );
end
$function$;

alter function public.consume_access_attempt(text) owner to postgres;
alter function public.reset_access_attempt(text) owner to postgres;
revoke execute on function public.consume_access_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_access_attempt(text) to service_role;
revoke execute on function public.reset_access_attempt(text) from public, anon, authenticated;
grant execute on function public.reset_access_attempt(text) to service_role;
