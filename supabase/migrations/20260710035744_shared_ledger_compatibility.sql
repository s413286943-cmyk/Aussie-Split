begin;

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

commit;
