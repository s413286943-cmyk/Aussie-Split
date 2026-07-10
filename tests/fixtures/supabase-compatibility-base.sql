\set ON_ERROR_STOP on

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres') then
    create role postgres nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$roles$;

alter role anon nobypassrls;
alter role authenticated nobypassrls;
alter role service_role bypassrls;

create table public.trips (
  id text primary key,
  name text not null,
  starts_on date,
  ends_on date,
  split_rule text not null default 'couple_50_50'
);

create table public.members (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  name text not null
);

create table public.expenses (
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

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id text references public.expenses(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table public.expense_activity (
  id text primary key,
  expense_id text not null,
  action text not null check (action in ('add', 'edit', 'confirm', 'delete')),
  item text not null,
  amount numeric(12, 2) not null,
  currency text not null check (currency in ('CNY', 'AUD')),
  summary text not null,
  created_at timestamptz not null default now()
);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on table
  public.trips,
  public.members,
  public.expenses,
  public.attachments,
  public.expense_activity
to anon, authenticated, service_role;

insert into public.trips (id, name, starts_on, ends_on)
values ('fixture-trip', 'Fixture trip', '2026-07-01', '2026-07-15');

insert into public.members (id, trip_id, name)
values ('fixture-member', 'fixture-trip', 'Fixture member');

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
  attachment_name,
  created_at
)
values (
  'legacy-expense',
  'dining',
  'Legacy dinner',
  '2026-07-02',
  'AUD',
  42.50,
  'us',
  'confirmed',
  'Legacy note',
  'legacy-receipt.jpg',
  '2026-07-01 00:00:00+00'
);

insert into public.attachments (id, expense_id, storage_path, created_at)
values (
  '11111111-1111-1111-1111-111111111111',
  'legacy-expense',
  'receipts/legacy-receipt.jpg',
  '2026-07-01 00:00:00+00'
);

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
  'legacy-activity',
  'legacy-expense',
  'add',
  'Legacy dinner',
  42.50,
  'AUD',
  'Added legacy dinner',
  '2026-07-01 00:00:00+00'
);
