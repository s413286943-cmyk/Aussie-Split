-- 撤销 20261107090000_create_nz2027_meal_notes.sql：删除吃后笔记表和函数（笔记会永久删除），其他数据不动。
begin;
drop function if exists public.nz2027_set_meal_note(jsonb);
drop table if exists public.nz2027_meal_notes;
commit;
