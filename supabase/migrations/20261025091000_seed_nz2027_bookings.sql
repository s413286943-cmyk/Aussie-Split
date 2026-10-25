-- Initial ledger records for the 2027 New Zealand trip: the bookings already made,
-- in their original currencies (CNY and NZD are never converted or merged).
-- Requires 20261025090000_allow_nzd_currency.sql. Re-running is a no-op.
-- Status mapping: confirmed = 已付, draft = 待付 (charged later or at checkout).
begin;

with seed (id, category, item, expense_date, currency, amount, status, note, sequence) as (
  values
    ('nz27-hotel-sydney-great-southern', '酒店', '悉尼 Great Southern Hotel 2/2–4（2晚）', date '2027-02-02', 'CNY', 1361.31::numeric(12, 2), 'draft',
      '离店扣款；免费取消至2/1 14:00（悉尼当地）', 1),
    ('nz27-hotel-chc-metropolitan', '酒店', '基督城 Metropolitan Motel 2/4–5（1晚）', date '2027-02-04', 'CNY', 601.43, 'draft',
      '离店扣款；另有NZ$200可退信用卡押金，不计房费；免费取消至2/3 14:00', 2),
    ('nz27-hotel-twizel', '酒店', 'Twizel Holiday Park 2/5–8（3晚）', date '2027-02-05', 'NZD', 525.00, 'confirmed',
      '已全付，沿用原确认记录', 3),
    ('nz27-hotel-wanaka-deposit', '酒店', 'Wānaka Hikuwai Haven 1 订金（2/8–10）', date '2027-02-08', 'NZD', 86.71, 'confirmed',
      '房费合计NZ$433.55，订金已付；免费取消至2/3 16:00', 4),
    ('nz27-hotel-wanaka-balance', '酒店', 'Wānaka Hikuwai Haven 1 尾款（2/8–10）', date '2027-02-08', 'NZD', 346.84, 'draft',
      '2027/1/26 Apple Pay扣款', 5),
    ('nz27-hotel-teanau-deposit', '酒店', 'Te Anau Private Ensuite 订金（2/10–12）', date '2027-02-10', 'NZD', 96.60, 'confirmed',
      '房费合计NZ$483.00，订金已付；免费取消至2/5 15:00', 6),
    ('nz27-hotel-teanau-balance', '酒店', 'Te Anau Private Ensuite 尾款（2/10–12）', date '2027-02-10', 'NZD', 386.40, 'draft',
      '2027/1/28 Apple Pay扣款', 7),
    ('nz27-hotel-queenstown-fernhill', '酒店', 'Queenstown Fernhill 山景单间（2/12–14，2晚）', date '2027-02-12', 'NZD', 721.63, 'draft',
      '邮件所列应付余额；2027/1/5 Apple Pay付款；免费取消至1/13 15:00', 8),
    ('nz27-tour-milford', '活动', 'Milford Sound RealNZ 大巴＋游船（2人）', date '2027-02-11', 'NZD', 578.00, 'confirmed',
      '已付，含Te Anau往返大巴；09:30前报到', 9),
    ('nz27-tour-hobbiton', '活动', 'Hobbiton 普通话团 13:50（2人）', date '2027-02-15', 'NZD', 260.00, 'confirmed',
      '已付；不含Auckland交通，13:30前报到', 10)
),
inserted as (
  insert into public.expenses (id, category, item, date, currency, amount, payer, status, note, split_settled, mutation_version)
  select
    seed.id,
    seed.category,
    seed.item,
    seed.expense_date,
    seed.currency,
    seed.amount,
    'us',
    seed.status,
    seed.note,
    false,
    '1792886400000-' || pg_catalog.lpad(seed.sequence::text, 6, '0') || '-seed-nz2027'
  from seed
  on conflict (id) do nothing
  returning id, item, amount, currency
)
insert into public.expense_activity (id, expense_id, action, item, amount, currency, summary, created_at)
select
  'activity-seed-nz2027-' || inserted.id,
  inserted.id,
  'add',
  inserted.item,
  inserted.amount,
  inserted.currency,
  '新增了 '
    || case inserted.currency when 'NZD' then 'NZ$' when 'AUD' then 'A$' else '¥' end
    || pg_catalog.to_char(inserted.amount, 'FM999,999,990.00')
    || ' ' || inserted.item,
  timestamptz '2026-10-25 00:00:00+00'
from inserted
on conflict (id) do nothing;

commit;
