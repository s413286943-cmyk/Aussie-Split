-- 撤销 20261026090000_create_nz2027_activity.sql：只删更新记录表、触发器和函数，记账和清单数据不动。
begin;
drop trigger if exists nz2027_expenses_activity on public.nz2027_expenses;
drop trigger if exists nz2027_checklist_activity on public.nz2027_checklist;
drop function if exists public.nz2027_log_expense();
drop function if exists public.nz2027_log_check();
drop table if exists public.nz2027_activity;
commit;
