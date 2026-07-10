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
