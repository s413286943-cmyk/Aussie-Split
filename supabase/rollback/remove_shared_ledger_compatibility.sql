begin;

drop trigger if exists enforce_expense_mutation on public.expenses;
drop trigger if exists reject_physical_expense_delete on public.expenses;

drop function if exists public.apply_expense_operation(jsonb);
drop function if exists public.consume_access_attempt(text);
drop function if exists public.reset_access_attempt(text);

drop schema if exists app_private cascade;

commit;
