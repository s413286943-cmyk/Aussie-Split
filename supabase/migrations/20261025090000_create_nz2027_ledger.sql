-- 2027 澳新两人账本和出发前清单：独立新表，只新增，不修改任何现有表、函数、权限或数据。
-- 与 2026 分账账本（public.expenses / expense_activity）完全分开。
-- 重复执行安全：表、函数用 if not exists / or replace，种子记录 on conflict do nothing。
begin;

create table if not exists public.nz2027_expenses (
  id text primary key
    check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  date date,
  category text not null check (pg_catalog.char_length(category) between 1 and 40),
  item text not null check (pg_catalog.char_length(item) between 1 and 200),
  currency text not null check (currency in ('NZD', 'CNY', 'AUD')),
  amount numeric(12, 2) not null check (amount > 0),
  status text not null check (status in ('paid', 'pending')),
  note text not null default '' check (pg_catalog.char_length(note) <= 1000),
  updated_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists nz2027_expenses_date_idx on public.nz2027_expenses (date);

alter table public.nz2027_expenses enable row level security;
-- Supabase default privileges grant new tables to every API role; reset them first.
revoke all privileges on table public.nz2027_expenses from public, anon, authenticated, service_role;
grant select, insert, update on table public.nz2027_expenses to service_role;

-- Last-write-wins upsert used by the protected /api/nz2027/expenses route.
-- Physical deletes are not offered; a delete is a record with deleted_at set.
create or replace function public.nz2027_upsert_expense(record jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  incoming_updated_at timestamptz;
  incoming_deleted_at timestamptz;
  incoming_date date;
  incoming_amount numeric(12, 2);
  affected integer;
begin
  if record is null or pg_catalog.jsonb_typeof(record) is distinct from 'object'
     or coalesce(record ->> 'id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or coalesce(record ->> 'currency', '') not in ('NZD', 'CNY', 'AUD')
     or coalesce(record ->> 'status', '') not in ('paid', 'pending')
     or pg_catalog.jsonb_typeof(record -> 'amount') is distinct from 'number'
     or pg_catalog.jsonb_typeof(record -> 'item') is distinct from 'string'
     or pg_catalog.jsonb_typeof(record -> 'category') is distinct from 'string'
     or pg_catalog.jsonb_typeof(record -> 'note') is distinct from 'string'
     or pg_catalog.jsonb_typeof(record -> 'updatedAt') is distinct from 'string' then
    raise exception 'invalid_nz2027_expense' using errcode = '22023';
  end if;

  begin
    incoming_updated_at := (record ->> 'updatedAt')::timestamptz;
    incoming_deleted_at := nullif(record ->> 'deletedAt', '')::timestamptz;
    incoming_date := nullif(record ->> 'date', '')::date;
    incoming_amount := (record ->> 'amount')::numeric;
  exception
    when others then
      raise exception 'invalid_nz2027_expense' using errcode = '22023';
  end;

  if incoming_updated_at > pg_catalog.now() + interval '5 minutes' then
    raise exception 'nz2027_expense_in_future' using errcode = '22023';
  end if;

  insert into public.nz2027_expenses as current_row (
    id, date, category, item, currency, amount, status, note, updated_at, deleted_at
  )
  values (
    record ->> 'id',
    incoming_date,
    record ->> 'category',
    record ->> 'item',
    record ->> 'currency',
    incoming_amount,
    record ->> 'status',
    record ->> 'note',
    incoming_updated_at,
    incoming_deleted_at
  )
  on conflict (id) do update
  set
    date = excluded.date,
    category = excluded.category,
    item = excluded.item,
    currency = excluded.currency,
    amount = excluded.amount,
    status = excluded.status,
    note = excluded.note,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at
  where current_row.updated_at < excluded.updated_at;

  get diagnostics affected = row_count;
  return pg_catalog.jsonb_build_object(
    'id', record ->> 'id',
    'status', case when affected = 1 then 'applied' else 'stale' end
  );
end
$function$;

revoke execute on function public.nz2027_upsert_expense(jsonb) from public, anon, authenticated;
grant execute on function public.nz2027_upsert_expense(jsonb) to service_role;

-- 出发前清单的勾选状态：两个人共用，后写覆盖先写。
create table if not exists public.nz2027_checklist (
  item_id text primary key check (item_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  done boolean not null,
  updated_at timestamptz not null
);

alter table public.nz2027_checklist enable row level security;
revoke all privileges on table public.nz2027_checklist from public, anon, authenticated, service_role;
grant select, insert, update on table public.nz2027_checklist to service_role;

create or replace function public.nz2027_set_check(item jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  incoming_updated_at timestamptz;
  affected integer;
begin
  if item is null or pg_catalog.jsonb_typeof(item) is distinct from 'object'
     or coalesce(item ->> 'id', '') !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     or pg_catalog.jsonb_typeof(item -> 'done') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(item -> 'updatedAt') is distinct from 'string' then
    raise exception 'invalid_nz2027_check' using errcode = '22023';
  end if;

  begin
    incoming_updated_at := (item ->> 'updatedAt')::timestamptz;
  exception
    when others then
      raise exception 'invalid_nz2027_check' using errcode = '22023';
  end;

  if incoming_updated_at > pg_catalog.now() + interval '5 minutes' then
    raise exception 'nz2027_check_in_future' using errcode = '22023';
  end if;

  insert into public.nz2027_checklist as current_row (item_id, done, updated_at)
  values (item ->> 'id', (item ->> 'done')::boolean, incoming_updated_at)
  on conflict (item_id) do update
  set done = excluded.done, updated_at = excluded.updated_at
  where current_row.updated_at < excluded.updated_at;

  get diagnostics affected = row_count;
  return pg_catalog.jsonb_build_object(
    'id', item ->> 'id',
    'status', case when affected = 1 then 'applied' else 'stale' end
  );
end
$function$;

revoke execute on function public.nz2027_set_check(jsonb) from public, anon, authenticated;
grant execute on function public.nz2027_set_check(jsonb) to service_role;

-- 已订费用作为初始记录，按原币种，不换算合并。paid = 已付，pending = 待付（之后扣款或离店扣款）。
-- CNY 待付 ¥1,962.74；NZD 已付 NZ$1,546.31、待付 NZ$1,454.87（合计 NZ$3,001.18）。
insert into public.nz2027_expenses (id, date, category, item, currency, amount, status, note, updated_at)
values
  ('nz27-hotel-sydney-great-southern', '2027-02-02', 'lodging', '悉尼 Great Southern Hotel 2/2–4（2晚）', 'CNY', 1361.31, 'pending',
    '离店扣款；免费取消至2/1 14:00（悉尼当地）', '2026-10-25 00:00:00+00'),
  ('nz27-hotel-chc-metropolitan', '2027-02-04', 'lodging', '基督城 Metropolitan Motel 2/4–5（1晚）', 'CNY', 601.43, 'pending',
    '离店扣款；另有NZ$200可退信用卡押金，不计房费；免费取消至2/3 14:00', '2026-10-25 00:00:00+00'),
  ('nz27-hotel-twizel', '2027-02-05', 'lodging', 'Twizel Holiday Park 2/5–8（3晚）', 'NZD', 525.00, 'paid',
    '已全付，沿用原确认记录', '2026-10-25 00:00:00+00'),
  ('nz27-hotel-wanaka-deposit', '2027-02-08', 'lodging', 'Wānaka Hikuwai Haven 1 订金（2/8–10）', 'NZD', 86.71, 'paid',
    '房费合计NZ$433.55，订金已付；免费取消至2/3 16:00', '2026-10-25 00:00:00+00'),
  ('nz27-hotel-wanaka-balance', '2027-02-08', 'lodging', 'Wānaka Hikuwai Haven 1 尾款（2/8–10）', 'NZD', 346.84, 'pending',
    '2027/1/26 Apple Pay扣款', '2026-10-25 00:00:00+00'),
  ('nz27-hotel-teanau-deposit', '2027-02-10', 'lodging', 'Te Anau Private Ensuite 订金（2/10–12）', 'NZD', 96.60, 'paid',
    '房费合计NZ$483.00，订金已付；免费取消至2/5 15:00', '2026-10-25 00:00:00+00'),
  ('nz27-hotel-teanau-balance', '2027-02-10', 'lodging', 'Te Anau Private Ensuite 尾款（2/10–12）', 'NZD', 386.40, 'pending',
    '2027/1/28 Apple Pay扣款', '2026-10-25 00:00:00+00'),
  ('nz27-hotel-queenstown-fernhill', '2027-02-12', 'lodging', 'Queenstown Fernhill 山景单间（2/12–14，2晚）', 'NZD', 721.63, 'pending',
    '邮件所列应付余额；2027/1/5 Apple Pay付款；免费取消至1/13 15:00', '2026-10-25 00:00:00+00'),
  ('nz27-tour-milford', '2027-02-11', 'activity', 'Milford Sound RealNZ 大巴＋游船（2人）', 'NZD', 578.00, 'paid',
    '已付，含Te Anau往返大巴；09:30前报到', '2026-10-25 00:00:00+00'),
  ('nz27-tour-hobbiton', '2027-02-15', 'activity', 'Hobbiton 普通话团 13:50（2人）', 'NZD', 260.00, 'paid',
    '已付；不含Auckland交通，13:30前报到', '2026-10-25 00:00:00+00')
on conflict (id) do nothing;

commit;
