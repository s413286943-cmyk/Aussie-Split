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
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id text references public.expenses(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

insert into public.trips (id, name, starts_on, ends_on, split_rule)
values ('aussie-chill-2026', 'Aussie Chill · 南十字星下的十六日', '2026-07-28', '2026-08-13', 'couple_50_50')
on conflict (id) do nothing;

insert into public.members (id, trip_id, name)
values
  ('us', 'aussie-chill-2026', '我方夫妻'),
  ('them', 'aussie-chill-2026', '另一对夫妻')
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

create table if not exists public.travel_days (
  id text primary key,
  day_index integer not null unique,
  date date not null,
  weekday text not null,
  city text not null,
  title text not null,
  focus text not null default '',
  lodging text not null default '',
  climate_note text not null default '',
  clothing_note text not null default '',
  backup_note text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_items (
  id text primary key,
  kind text not null check (kind in ('lodging', 'booking', 'budget', 'food', 'activity')),
  title text not null,
  related_day_id text not null default '',
  city text not null default '',
  status text not null check (status in ('已订好', '还没订', '到时再看')),
  amount numeric(12, 2) not null default 0,
  currency text not null default '',
  note text not null default '',
  link text not null default '',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Create a private Storage bucket named "receipts" in the Supabase dashboard.
-- For this quick shared-link v1, use the Vercel URL and shared access code as the practical access boundary.
