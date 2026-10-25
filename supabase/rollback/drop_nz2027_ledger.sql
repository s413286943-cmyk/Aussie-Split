-- Reverts 20261025090000_create_nz2027_ledger.sql.
-- 只删除 2027 两人账本自己的表和函数；2026 分账账本不受影响。
-- 会永久删除 2027 账本里的全部记录：执行前先在 /nz2027/ledger 页面导出 CSV，或用
--   select * from public.nz2027_expenses;
-- 保存一份。
begin;

drop function if exists public.nz2027_upsert_expense(jsonb);
drop table if exists public.nz2027_expenses;

commit;
