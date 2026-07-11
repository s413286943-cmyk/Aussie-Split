begin;

alter table public.trips enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.attachments enable row level security;
alter table public.expense_activity enable row level security;

do $application_policies$
declare
  policy_record record;
begin
  for policy_record in
    select
      policy.polname as policy_name,
      namespace.nspname as schema_name,
      relation.relname as table_name
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation
      on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any (
        array['trips'::name, 'members'::name, 'expenses'::name, 'attachments'::name, 'expense_activity'::name]
      )
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on %I.%I',
      policy_record.policy_name,
      policy_record.schema_name,
      policy_record.table_name
    );
  end loop;
end
$application_policies$;

revoke all privileges on schema public from public, anon, authenticated;
grant usage on schema public to service_role;

revoke all privileges on table
  public.trips,
  public.members,
  public.expenses,
  public.attachments,
  public.expense_activity
from public, anon, authenticated, service_role;

grant select on table public.trips, public.members to service_role;
grant select, insert, update on table public.expenses, public.attachments to service_role;
grant select, insert on table public.expense_activity to service_role;

revoke execute on function public.apply_expense_operation(jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_expense_operation(jsonb) to service_role;

revoke execute on function public.consume_access_attempt(text)
  from public, anon, authenticated;
grant execute on function public.consume_access_attempt(text) to service_role;

revoke execute on function public.reset_access_attempt(text)
  from public, anon, authenticated;
grant execute on function public.reset_access_attempt(text) to service_role;

revoke execute on function public.create_receipt_upload_intent(jsonb)
  from public, anon, authenticated;
grant execute on function public.create_receipt_upload_intent(jsonb) to service_role;

revoke execute on function public.finalize_receipt_upload(text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_receipt_upload(text, text) to service_role;

revoke execute on function public.claim_receipt_cleanup(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_receipt_cleanup(text, integer) to service_role;

revoke execute on function public.verify_receipt_cleanup_claim(uuid, text)
  from public, anon, authenticated;
grant execute on function public.verify_receipt_cleanup_claim(uuid, text) to service_role;

revoke execute on function public.finish_receipt_cleanup_claim(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_receipt_cleanup_claim(uuid, text, boolean) to service_role;

alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from public, anon, authenticated, service_role;

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

do $storage_rls_guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and relation.relrowsecurity
  ) then
    raise exception using
      errcode = '55000',
      message = 'storage_objects_rls_required';
  end if;
end
$storage_rls_guard$;

do $storage_policies$
declare
  policy_record record;
  applicable_expressions text[];
  policy_expression text;
  bucket_match text[];
  restricted_to_other_bucket boolean;
begin
  for policy_record in
    select
      policy.polname as policy_name,
      policy.polcmd as command,
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) as using_expression,
      pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) as check_expression
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation
      on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and (
        0 = any (policy.polroles)
        or exists (
          select 1
          from pg_catalog.unnest(policy.polroles) as policy_role(role_oid)
          join pg_catalog.pg_roles as role
            on role.oid = policy_role.role_oid
          where role.rolname in ('anon', 'authenticated')
        )
      )
  loop
    applicable_expressions := case policy_record.command
      when 'r' then array[policy_record.using_expression]
      when 'd' then array[policy_record.using_expression]
      when 'a' then array[policy_record.check_expression]
      else array[
        policy_record.using_expression,
        coalesce(policy_record.check_expression, policy_record.using_expression)
      ]
    end;
    restricted_to_other_bucket := true;

    foreach policy_expression in array applicable_expressions
    loop
      bucket_match := pg_catalog.regexp_match(
        policy_expression,
        '\mbucket_id\M[[:space:]]*=[[:space:]]*''([^'']+)''(?:::text)?',
        'i'
      );
      if bucket_match is null then
        bucket_match := pg_catalog.regexp_match(
          policy_expression,
          '''([^'']+)''(?:::text)?[[:space:]]*=[[:space:]]*\mbucket_id\M',
          'i'
        );
      end if;

      if policy_expression is null
         or policy_expression ~* '\m(or|not)\M'
         or bucket_match is null
         or bucket_match[1] = 'receipts' then
        restricted_to_other_bucket := false;
        exit;
      end if;
    end loop;

    if not restricted_to_other_bucket then
      execute pg_catalog.format(
        'drop policy if exists %I on storage.objects',
        policy_record.policy_name
      );
    end if;
  end loop;
end
$storage_policies$;

commit;
