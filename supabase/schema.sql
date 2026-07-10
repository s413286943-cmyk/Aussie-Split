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
  operation jsonb not null,
  result_status text check (result_status in ('applied', 'stale')),
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
grant select, insert, update on table app_private.expense_operations to service_role;
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

  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id, 0));
  elsif tg_op = 'UPDATE' then
    if (new.mutation_version collate "C") <= (old.mutation_version collate "C") then
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
  request_payload jsonb := operation;
  requested_op_id text;
  op_type text;
  incoming_version text;
  expense_payload jsonb;
  activity_payload jsonb;
  requested_expense_id text;
  existing_operation jsonb;
  existing_result_status text;
  existing_version text;
  existing_item text;
  existing_amount numeric(12, 2);
  existing_currency text;
  expense_exists boolean := false;
  inserted_operations integer;
  expense_date date;
  expense_amount numeric(12, 2);
  activity_amount numeric(12, 2);
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
  requested_expense_id := operation ->> 'expenseId';

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
  if requested_expense_id is null or requested_expense_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'invalid_expense_payload' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(activity_payload) is distinct from 'object' then
    raise exception 'invalid_activity_payload' using errcode = '22023';
  end if;

  if coalesce(activity_payload ->> 'id', '') = ''
     or activity_payload ->> 'expenseId' is distinct from requested_expense_id
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
    if pg_catalog.jsonb_typeof(expense_payload) is distinct from 'object'
       or expense_payload ->> 'id' is distinct from requested_expense_id
       or coalesce(expense_payload ->> 'category', '') = ''
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

    if coalesce(activity_payload ->> 'action', '') not in ('add', 'edit', 'confirm') then
      raise exception 'invalid_activity_payload' using errcode = '22023';
    end if;

    if activity_payload ->> 'item' is distinct from expense_payload ->> 'item'
       or activity_amount is distinct from expense_amount
       or activity_payload ->> 'currency' is distinct from expense_payload ->> 'currency' then
      raise exception 'invalid_activity_payload' using errcode = '22023';
    end if;
  elsif op_type = 'delete' then
    if not (operation ? 'expense') then
      raise exception 'invalid_expense_payload' using errcode = '22023';
    end if;

    if not (
      pg_catalog.jsonb_typeof(expense_payload) = 'null'
      or (
        pg_catalog.jsonb_typeof(expense_payload) = 'object'
        and expense_payload ->> 'id' is not distinct from requested_expense_id
      )
    ) then
      raise exception 'invalid_expense_payload' using errcode = '22023';
    end if;

    if activity_payload ->> 'action' is distinct from 'delete' then
      raise exception 'invalid_activity_payload' using errcode = '22023';
    end if;
  end if;

  insert into app_private.expense_operations (
    op_id,
    operation_type,
    expense_id,
    mutation_version,
    operation,
    result_status
  )
  values (
    requested_op_id,
    op_type,
    requested_expense_id,
    incoming_version,
    request_payload,
    null
  )
  on conflict (op_id) do nothing;

  get diagnostics inserted_operations = row_count;
  if inserted_operations = 0 then
    select logged.operation, logged.result_status
    into existing_operation, existing_result_status
    from app_private.expense_operations as logged
    where logged.op_id = requested_op_id;

    if existing_operation is distinct from request_payload then
      raise exception 'operation_id_conflict' using errcode = '23505';
    end if;
    if existing_result_status is null then
      raise exception 'operation_result_unavailable' using errcode = '40001';
    end if;

    return pg_catalog.jsonb_build_object(
      'opId', requested_op_id,
      'status', existing_result_status
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(requested_expense_id, 0));

  select
    true,
    current_expense.mutation_version,
    current_expense.item,
    current_expense.amount,
    current_expense.currency
  into
    expense_exists,
    existing_version,
    existing_item,
    existing_amount,
    existing_currency
  from public.expenses as current_expense
  where current_expense.id = requested_expense_id
  for update;

  expense_exists := coalesce(expense_exists, false);
  if expense_exists
     and (incoming_version collate "C") <= (existing_version collate "C") then
    update app_private.expense_operations
    set result_status = 'stale'
    where op_id = requested_op_id;

    return pg_catalog.jsonb_build_object('opId', requested_op_id, 'status', 'stale');
  end if;

  if op_type = 'delete'
     and expense_exists
     and (
       activity_payload ->> 'item' is distinct from existing_item
       or activity_amount is distinct from existing_amount
       or activity_payload ->> 'currency' is distinct from existing_currency
     ) then
    raise exception 'invalid_activity_payload' using errcode = '22023';
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

  update app_private.expense_operations
  set result_status = 'applied'
  where op_id = requested_op_id;

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

-- Private receipt storage, upload intent, finalization, and bounded cleanup.
begin;

alter table public.attachments
  add column if not exists cleanup_claimed_at timestamptz,
  add column if not exists cleanup_claim_token text;

do $constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.attachments'::regclass
      and conname = 'attachments_receipt_metadata_check'
  ) then
    alter table public.attachments
      add constraint attachments_receipt_metadata_check
      check (
        receipt_id is null
        or (
          receipt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
          and expense_id is not null
          and original_name <> ''
          and pg_catalog.length(original_name) <= 255
          and pg_catalog.strpos(original_name, '/') = 0
          and pg_catalog.strpos(original_name, chr(92)) = 0
          and mime_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp')
          and size_bytes between 1 and 10485760
          and storage_path <> ''
          and storage_path !~ '(^/|//|(^|/)\.\.(/|$))'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.attachments'::regclass
      and conname = 'attachments_cleanup_claim_check'
  ) then
    alter table public.attachments
      add constraint attachments_cleanup_claim_check
      check (
        (cleanup_claimed_at is null and cleanup_claim_token is null)
        or (
          cleanup_claimed_at is not null
          and cleanup_claim_token ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
        )
      );
  end if;
end
$constraint$;

create unique index if not exists attachments_active_expense_unique
  on public.attachments (expense_id)
  where receipt_id is not null
    and deleted_at is null;

create index if not exists attachments_pending_cleanup_idx
  on public.attachments (created_at)
  where receipt_id is not null
    and deleted_at is null
    and finalized_at is null;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app_private.block_expense_restore_during_receipt_cleanup()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if old.deleted_at is not null
     and new.deleted_at is null
     and exists (
       select 1
       from public.attachments
       where expense_id = new.id
         and receipt_id is not null
         and deleted_at is null
         and cleanup_claim_token is not null
     ) then
    raise exception 'receipt_cleanup_in_progress' using errcode = '55000';
  end if;
  return new;
end
$function$;

alter function app_private.block_expense_restore_during_receipt_cleanup() owner to postgres;
revoke all on function app_private.block_expense_restore_during_receipt_cleanup()
  from public, anon, authenticated;
drop trigger if exists block_expense_restore_during_receipt_cleanup on public.expenses;
create trigger block_expense_restore_during_receipt_cleanup
before update of deleted_at on public.expenses
for each row
execute function app_private.block_expense_restore_during_receipt_cleanup();

create or replace function public.create_receipt_upload_intent(receipt jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  requested_expense_id text := receipt ->> 'expenseId';
  requested_receipt_id text := receipt ->> 'receiptId';
  requested_original_name text := receipt ->> 'originalName';
  requested_mime_type text := receipt ->> 'mimeType';
  requested_size_bytes bigint;
  requested_storage_path text := receipt ->> 'storagePath';
  expense_deleted_at timestamptz;
  existing_attachment public.attachments%rowtype;
begin
  if receipt is null
     or pg_catalog.jsonb_typeof(receipt) is distinct from 'object'
     or requested_expense_id is null
     or requested_expense_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or requested_receipt_id is null
     or requested_receipt_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or requested_original_name is null
     or requested_original_name = ''
     or pg_catalog.length(requested_original_name) > 255
     or pg_catalog.strpos(requested_original_name, '/') > 0
     or pg_catalog.strpos(requested_original_name, chr(92)) > 0
     or requested_mime_type not in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp')
     or pg_catalog.jsonb_typeof(receipt -> 'sizeBytes') is distinct from 'number'
     or receipt ->> 'sizeBytes' !~ '^[0-9]+$'
     or requested_storage_path is null
     or requested_storage_path = ''
     or requested_storage_path !~ (
       '^' || pg_catalog.regexp_replace(requested_expense_id, '([.\\+*?\[\](){}|^$])', '\\\1', 'g')
       || '/' || pg_catalog.regexp_replace(requested_receipt_id, '([.\\+*?\[\](){}|^$])', '\\\1', 'g')
       || '-[a-z0-9][a-z0-9-]{0,63}\.(jpg|png|heic|heif|webp)$'
     ) then
    raise exception 'invalid_receipt_payload' using errcode = '22023';
  end if;

  begin
    requested_size_bytes := (receipt ->> 'sizeBytes')::bigint;
  exception
    when others then
      raise exception 'invalid_receipt_payload' using errcode = '22023';
  end;
  if requested_size_bytes < 1 or requested_size_bytes > 10485760 then
    raise exception 'invalid_receipt_payload' using errcode = '22023';
  end if;

  select deleted_at
  into expense_deleted_at
  from public.expenses
  where id = requested_expense_id
  for update;
  if not found or expense_deleted_at is not null then
    raise exception 'receipt_expense_unavailable' using errcode = 'P0002';
  end if;

  select *
  into existing_attachment
  from public.attachments
  where expense_id = requested_expense_id
    and receipt_id is not null
    and deleted_at is null
  for update;

  if found then
    if existing_attachment.cleanup_claim_token is not null then
      raise exception 'receipt_cleanup_in_progress' using errcode = '55000';
    end if;
    if existing_attachment.receipt_id is distinct from requested_receipt_id
       or existing_attachment.original_name is distinct from requested_original_name
       or existing_attachment.mime_type is distinct from requested_mime_type
       or existing_attachment.size_bytes is distinct from requested_size_bytes
       or existing_attachment.storage_path is distinct from requested_storage_path then
      raise exception 'receipt_conflict' using errcode = '23505';
    end if;
    return pg_catalog.to_jsonb(existing_attachment);
  end if;

  select *
  into existing_attachment
  from public.attachments
  where receipt_id = requested_receipt_id
  for update;

  if found then
    if existing_attachment.cleanup_claim_token is not null then
      raise exception 'receipt_cleanup_in_progress' using errcode = '55000';
    end if;
    if existing_attachment.expense_id is distinct from requested_expense_id
       or existing_attachment.original_name is distinct from requested_original_name
       or existing_attachment.mime_type is distinct from requested_mime_type
       or existing_attachment.size_bytes is distinct from requested_size_bytes
       or existing_attachment.storage_path is distinct from requested_storage_path then
      raise exception 'receipt_conflict' using errcode = '23505';
    end if;

    update public.attachments
    set deleted_at = null,
        finalized_at = null,
        created_at = pg_catalog.now(),
        cleanup_claimed_at = null,
        cleanup_claim_token = null
    where id = existing_attachment.id
    returning * into existing_attachment;
    return pg_catalog.to_jsonb(existing_attachment);
  end if;

  begin
    insert into public.attachments (
      expense_id,
      receipt_id,
      original_name,
      mime_type,
      size_bytes,
      storage_path
    )
    values (
      requested_expense_id,
      requested_receipt_id,
      requested_original_name,
      requested_mime_type,
      requested_size_bytes,
      requested_storage_path
    )
    returning * into existing_attachment;
  exception
    when unique_violation then
      raise exception 'receipt_conflict' using errcode = '23505';
  end;

  return pg_catalog.to_jsonb(existing_attachment);
end
$function$;

create or replace function public.finalize_receipt_upload(
  requested_expense_id text,
  requested_receipt_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  expense_deleted_at timestamptz;
  finalized_attachment public.attachments%rowtype;
begin
  if requested_expense_id is null
     or requested_expense_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or requested_receipt_id is null
     or requested_receipt_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'invalid_receipt_payload' using errcode = '22023';
  end if;

  select deleted_at
  into expense_deleted_at
  from public.expenses
  where id = requested_expense_id
  for update;
  if not found or expense_deleted_at is not null then
    raise exception 'receipt_expense_unavailable' using errcode = 'P0002';
  end if;

  select *
  into finalized_attachment
  from public.attachments
  where expense_id = requested_expense_id
    and receipt_id = requested_receipt_id
    and deleted_at is null
  for update;
  if not found then
    raise exception 'receipt_not_found' using errcode = 'P0002';
  end if;
  if finalized_attachment.cleanup_claim_token is not null then
    raise exception 'receipt_cleanup_in_progress' using errcode = '55000';
  end if;

  update public.attachments
  set finalized_at = coalesce(finalized_at, pg_catalog.now())
  where id = finalized_attachment.id
  returning * into finalized_attachment;

  return pg_catalog.to_jsonb(finalized_attachment);
end
$function$;

alter function public.create_receipt_upload_intent(jsonb) owner to postgres;
alter function public.finalize_receipt_upload(text, text) owner to postgres;
revoke all on function public.create_receipt_upload_intent(jsonb) from public;
revoke all on function public.finalize_receipt_upload(text, text) from public;
revoke execute on function public.create_receipt_upload_intent(jsonb) from public, anon, authenticated;
revoke execute on function public.finalize_receipt_upload(text, text) from public, anon, authenticated;
grant execute on function public.create_receipt_upload_intent(jsonb) to service_role;
grant execute on function public.finalize_receipt_upload(text, text) to service_role;

create or replace function public.claim_receipt_cleanup(
  claim_token text,
  max_rows integer default 10
)
returns table (
  attachment_id uuid,
  receipt_id text,
  expense_id text,
  storage_path text,
  cleanup_reason text
)
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if claim_token is null
     or claim_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'invalid_cleanup_claim_token' using errcode = '22023';
  end if;
  if max_rows is null or max_rows < 1 or max_rows > 25 then
    raise exception 'invalid_cleanup_batch_size' using errcode = '22023';
  end if;

  return query
  with candidates as materialized (
    select
      a.id,
      case
        when a.finalized_at is null then 'pending'
        else 'tombstoned'
      end as reason
    from public.attachments as a
    left join public.expenses as e on e.id = a.expense_id
    where a.receipt_id is not null
      and a.deleted_at is null
      and (
        a.cleanup_claimed_at is null
        or a.cleanup_claimed_at < pg_catalog.now() - interval '30 minutes'
      )
      and (
        (
          a.finalized_at is null
          and a.created_at < pg_catalog.now() - interval '24 hours'
        )
        or (
          a.finalized_at is not null
          and e.deleted_at < pg_catalog.now() - interval '7 days'
        )
      )
    order by a.created_at, a.id
    for update of a skip locked
    limit max_rows
  ),
  claimed as (
    update public.attachments as a
    set
      cleanup_claimed_at = pg_catalog.now(),
      cleanup_claim_token = claim_receipt_cleanup.claim_token
    from candidates as c
    where a.id = c.id
    returning
      a.id,
      a.receipt_id,
      a.expense_id,
      a.storage_path,
      c.reason
  )
  select
    claimed.id,
    claimed.receipt_id,
    claimed.expense_id,
    claimed.storage_path,
    claimed.reason
  from claimed;
end
$function$;

create or replace function public.verify_receipt_cleanup_claim(
  requested_attachment_id uuid,
  requested_claim_token text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  claimed_attachment public.attachments%rowtype;
  claimed_expense_id text;
  expense_deleted_at timestamptz;
  still_eligible boolean;
begin
  if requested_attachment_id is null
     or requested_claim_token is null
     or requested_claim_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'invalid_cleanup_claim' using errcode = '22023';
  end if;

  select expense_id
  into claimed_expense_id
  from public.attachments
  where id = requested_attachment_id;
  if not found then
    return null;
  end if;

  select deleted_at
  into expense_deleted_at
  from public.expenses
  where id = claimed_expense_id
  for update;

  select *
  into claimed_attachment
  from public.attachments
  where id = requested_attachment_id
  for update;
  if not found
     or claimed_attachment.cleanup_claim_token is distinct from requested_claim_token
     or claimed_attachment.deleted_at is not null then
    return null;
  end if;

  still_eligible := coalesce((
    claimed_attachment.finalized_at is null
    and claimed_attachment.created_at < pg_catalog.now() - interval '24 hours'
  ), false) or coalesce((
    claimed_attachment.finalized_at is not null
    and expense_deleted_at < pg_catalog.now() - interval '7 days'
  ), false);

  if not still_eligible then
    update public.attachments
    set cleanup_claimed_at = null,
        cleanup_claim_token = null
    where id = requested_attachment_id;
    return null;
  end if;

  return pg_catalog.to_jsonb(claimed_attachment);
end
$function$;

create or replace function public.finish_receipt_cleanup_claim(
  requested_attachment_id uuid,
  requested_claim_token text,
  mark_deleted boolean
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  current_claim_token text;
begin
  if requested_attachment_id is null
     or requested_claim_token is null
     or requested_claim_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or mark_deleted is null then
    raise exception 'invalid_cleanup_claim' using errcode = '22023';
  end if;

  select cleanup_claim_token
  into current_claim_token
  from public.attachments
  where id = requested_attachment_id
  for update;
  if not found or current_claim_token is distinct from requested_claim_token then
    return false;
  end if;

  update public.attachments
  set deleted_at = case when mark_deleted then coalesce(deleted_at, pg_catalog.now()) else deleted_at end,
      created_at = case when mark_deleted then created_at else pg_catalog.now() end,
      cleanup_claimed_at = null,
      cleanup_claim_token = null
  where id = requested_attachment_id;
  return true;
end
$function$;

alter function public.claim_receipt_cleanup(text, integer) owner to postgres;
alter function public.verify_receipt_cleanup_claim(uuid, text) owner to postgres;
alter function public.finish_receipt_cleanup_claim(uuid, text, boolean) owner to postgres;
revoke all on function public.claim_receipt_cleanup(text, integer) from public;
revoke all on function public.verify_receipt_cleanup_claim(uuid, text) from public;
revoke all on function public.finish_receipt_cleanup_claim(uuid, text, boolean) from public;
revoke execute on function public.claim_receipt_cleanup(text, integer) from public, anon, authenticated;
revoke execute on function public.verify_receipt_cleanup_claim(uuid, text) from public, anon, authenticated;
revoke execute on function public.finish_receipt_cleanup_claim(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_receipt_cleanup(text, integer) to service_role;
grant execute on function public.verify_receipt_cleanup_claim(uuid, text) to service_role;
grant execute on function public.finish_receipt_cleanup_claim(uuid, text, boolean) to service_role;

commit;
