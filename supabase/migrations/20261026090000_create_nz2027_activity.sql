-- 2027 更新记录：记账和清单每次在服务器上生效的改动，各记一行，只增不改。
-- 只新增表、函数和触发器，不改动 nz2027_expenses / nz2027_checklist 的数据，也不碰 2026 账本。
-- 重复执行安全：if not exists / or replace / drop trigger if exists；回填只在记录表为空时做一次。
begin;

create table if not exists public.nz2027_activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default pg_catalog.now(),
  kind text not null check (kind in ('expense', 'check')),
  action text not null check (action in ('added', 'changed', 'removed', 'restored', 'done', 'undone')),
  ref_id text not null check (pg_catalog.char_length(ref_id) between 1 and 128),
  detail jsonb not null default '{}'::jsonb
);

create index if not exists nz2027_activity_at_idx on public.nz2027_activity (at desc, id desc);

alter table public.nz2027_activity enable row level security;
-- Supabase default privileges grant new tables to every API role; reset them first.
-- The server only reads this table; rows are written by the triggers below.
revoke all privileges on table public.nz2027_activity from public, anon, authenticated, service_role;
grant select on table public.nz2027_activity to service_role;

create or replace function public.nz2027_log_expense()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  change text;
begin
  if tg_op = 'INSERT' then
    change := case when new.deleted_at is null then 'added' else 'removed' end;
  elsif old.deleted_at is null and new.deleted_at is not null then
    change := 'removed';
  elsif old.deleted_at is not null and new.deleted_at is null then
    change := 'restored';
  elsif new.deleted_at is not null then
    return new;
  elsif (old.date, old.category, old.item, old.currency, old.amount, old.status, old.note)
        is not distinct from (new.date, new.category, new.item, new.currency, new.amount, new.status, new.note) then
    return new;
  else
    change := 'changed';
  end if;

  insert into public.nz2027_activity (kind, action, ref_id, detail)
  values ('expense', change, new.id, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'item', new.item,
    'currency', new.currency,
    'amount', new.amount,
    'status', new.status,
    'date', new.date,
    'before', case when change = 'changed' then pg_catalog.jsonb_build_object(
      'item', old.item, 'currency', old.currency, 'amount', old.amount, 'status', old.status, 'date', old.date
    ) end
  )));
  return new;
end
$function$;

create or replace function public.nz2027_log_check()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if (tg_op = 'INSERT' and not new.done) or (tg_op = 'UPDATE' and old.done is not distinct from new.done) then
    return new;
  end if;
  insert into public.nz2027_activity (kind, action, ref_id)
  values ('check', case when new.done then 'done' else 'undone' end, new.item_id);
  return new;
end
$function$;

revoke execute on function public.nz2027_log_expense() from public, anon, authenticated, service_role;
revoke execute on function public.nz2027_log_check() from public, anon, authenticated, service_role;

drop trigger if exists nz2027_expenses_activity on public.nz2027_expenses;
create trigger nz2027_expenses_activity
  after insert or update on public.nz2027_expenses
  for each row execute function public.nz2027_log_expense();

drop trigger if exists nz2027_checklist_activity on public.nz2027_checklist;
create trigger nz2027_checklist_activity
  after insert or update on public.nz2027_checklist
  for each row execute function public.nz2027_log_check();

-- 回填：每条现有记账按最新状态记一行（新增 / 改过 / 删了），已勾选的清单项各记一行。
insert into public.nz2027_activity (at, kind, action, ref_id, detail)
select at, kind, action, ref_id, detail
from (
  select
    case
      when e.deleted_at is not null then e.deleted_at
      when e.updated_at > e.created_at + interval '1 minute' then e.updated_at
      else e.created_at
    end as at,
    'expense' as kind,
    case
      when e.deleted_at is not null then 'removed'
      when e.updated_at > e.created_at + interval '1 minute' then 'changed'
      else 'added'
    end as action,
    e.id as ref_id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'item', e.item, 'currency', e.currency, 'amount', e.amount, 'status', e.status, 'date', e.date
    )) as detail
  from public.nz2027_expenses e
  union all
  select c.updated_at, 'check', 'done', c.item_id, '{}'::jsonb
  from public.nz2027_checklist c
  where c.done
) backfill
where not exists (select 1 from public.nz2027_activity)
order by at, ref_id;

commit;
