-- 2027 “吃什么”：每天早午晚的吃后笔记（吃了什么、好不好吃），两部手机同步，后写覆盖先写。
-- 只新增表和函数，不改动任何现有表、函数、权限或数据。重复执行安全。
begin;

create table if not exists public.nz2027_meal_notes (
  id text primary key check (id ~ '^d([1-9]|1[0-7])-(breakfast|lunch|dinner)$'),
  note text not null default '' check (pg_catalog.char_length(note) <= 500),
  rating smallint check (rating between 1 and 5),
  updated_at timestamptz not null
);

alter table public.nz2027_meal_notes enable row level security;
-- Supabase default privileges grant new tables to every API role; reset them first.
revoke all privileges on table public.nz2027_meal_notes from public, anon, authenticated, service_role;
grant select, insert, update on table public.nz2027_meal_notes to service_role;

create or replace function public.nz2027_set_meal_note(note jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  incoming_updated_at timestamptz;
  incoming_rating smallint;
  affected integer;
begin
  if note is null or pg_catalog.jsonb_typeof(note) is distinct from 'object'
     or coalesce(note ->> 'id', '') !~ '^d([1-9]|1[0-7])-(breakfast|lunch|dinner)$'
     or pg_catalog.jsonb_typeof(note -> 'note') is distinct from 'string'
     or pg_catalog.char_length(note ->> 'note') > 500
     or coalesce(pg_catalog.jsonb_typeof(note -> 'rating'), 'null') not in ('null', 'number')
     or pg_catalog.jsonb_typeof(note -> 'updatedAt') is distinct from 'string' then
    raise exception 'invalid_nz2027_meal_note' using errcode = '22023';
  end if;

  begin
    incoming_updated_at := (note ->> 'updatedAt')::timestamptz;
    incoming_rating := (note ->> 'rating')::smallint;
  exception
    when others then
      raise exception 'invalid_nz2027_meal_note' using errcode = '22023';
  end;

  if incoming_rating is not null and (incoming_rating < 1 or incoming_rating > 5 or (note ->> 'rating')::numeric <> incoming_rating) then
    raise exception 'invalid_nz2027_meal_note' using errcode = '22023';
  end if;

  if incoming_updated_at > pg_catalog.now() + interval '5 minutes' then
    raise exception 'nz2027_meal_note_in_future' using errcode = '22023';
  end if;

  insert into public.nz2027_meal_notes as current_row (id, note, rating, updated_at)
  values (note ->> 'id', note ->> 'note', incoming_rating, incoming_updated_at)
  on conflict (id) do update
  set note = excluded.note, rating = excluded.rating, updated_at = excluded.updated_at
  where current_row.updated_at < excluded.updated_at;

  get diagnostics affected = row_count;
  return pg_catalog.jsonb_build_object(
    'id', note ->> 'id',
    'status', case when affected = 1 then 'applied' else 'stale' end
  );
end
$function$;

revoke execute on function public.nz2027_set_meal_note(jsonb) from public, anon, authenticated;
grant execute on function public.nz2027_set_meal_note(jsonb) to service_role;

commit;
