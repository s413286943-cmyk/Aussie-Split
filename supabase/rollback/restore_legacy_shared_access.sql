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

revoke all privileges on table
  public.trips,
  public.members,
  public.expenses,
  public.attachments,
  public.expense_activity
from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update on table public.expenses to anon, authenticated;
grant select, insert on table public.expense_activity to anon, authenticated;

revoke execute on function public.apply_expense_operation(jsonb)
  from public, anon, authenticated;
revoke execute on function public.consume_access_attempt(text)
  from public, anon, authenticated;
revoke execute on function public.reset_access_attempt(text)
  from public, anon, authenticated;
revoke execute on function public.create_receipt_upload_intent(jsonb)
  from public, anon, authenticated;
revoke execute on function public.finalize_receipt_upload(text, text)
  from public, anon, authenticated;
revoke execute on function public.claim_receipt_cleanup(text, integer)
  from public, anon, authenticated;
revoke execute on function public.verify_receipt_cleanup_claim(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.finish_receipt_cleanup_claim(uuid, text, boolean)
  from public, anon, authenticated;

create policy legacy_shared_expenses_select
on public.expenses
for select
to anon, authenticated
using (
  deleted_at is null
  or (
    pg_catalog.current_setting('request.method', true) = 'PATCH'
    and pg_catalog.current_setting('request.headers', true) ilike '%return=minimal%'
  )
);

create policy legacy_shared_expenses_insert
on public.expenses
for insert
to anon, authenticated
with check (deleted_at is null);

create policy legacy_shared_expenses_update
on public.expenses
for update
to anon, authenticated
using (deleted_at is null)
with check (true);

create policy legacy_shared_expense_activity_select
on public.expense_activity
for select
to anon, authenticated
using (true);

create policy legacy_shared_expense_activity_insert
on public.expense_activity
for insert
to anon, authenticated
with check (true);

commit;
