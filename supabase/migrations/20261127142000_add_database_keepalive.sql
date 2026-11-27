create table if not exists public.cache (
  cache_key text primary key check (cache_key in ('activity', 'pulse')),
  last_activity_at timestamptz,
  last_keepalive_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (cache_key = 'activity' and last_activity_at is not null) or
    (cache_key = 'pulse' and last_activity_at is null and last_keepalive_at is null)
  )
);

alter table public.cache enable row level security;
revoke all on table public.cache from public, anon, authenticated;

insert into public.cache (cache_key, last_activity_at)
values ('activity', clock_timestamp())
on conflict (cache_key) do nothing;

create or replace function public.record_database_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cache
  set last_activity_at = clock_timestamp()
  where cache_key = 'activity';

  return null;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects',
    'project_changelogs',
    'contributors',
    'project_contributors',
    'changelog_contributors'
  ]
  loop
    execute format(
      'drop trigger if exists cache_track_activity on public.%I',
      table_name
    );
    execute format(
      'create trigger cache_track_activity after insert or update or delete on public.%I for each statement execute function public.record_database_activity()',
      table_name
    );
  end loop;
end;
$$;

revoke all on function public.record_database_activity() from public, anon, authenticated;

create or replace function public.touch_database_activity()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the server can record database activity.';
  end if;

  update public.cache
  set last_activity_at = clock_timestamp()
  where cache_key = 'activity';

  if not found then
    raise exception 'Database activity tracking is not initialized.';
  end if;
end;
$$;

revoke all on function public.touch_database_activity() from public, anon, authenticated;
grant execute on function public.touch_database_activity() to service_role;

create or replace function public.run_database_keepalive()
returns table (
  pinged boolean,
  idle_days numeric,
  last_activity_at timestamptz,
  last_keepalive_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  activity_state public.cache%rowtype;
  checked_at timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the scheduled server task can run database keepalive.';
  end if;

  select * into activity_state
  from public.cache
  where cache_key = 'activity'
  for update;

  if not found then
    raise exception 'Database activity tracking is not initialized.';
  end if;

  if activity_state.last_activity_at <= checked_at - interval '5 days'
    and (
      activity_state.last_keepalive_at is null
      or activity_state.last_keepalive_at <= checked_at - interval '5 days'
    ) then
    insert into public.cache (cache_key) values ('pulse');
    delete from public.cache where cache_key = 'pulse';

    update public.cache
    set last_keepalive_at = checked_at
    where cache_key = 'activity'
    returning * into activity_state;

    return query
    select
      true,
      round(extract(epoch from (checked_at - activity_state.last_activity_at)) / 86400, 2),
      activity_state.last_activity_at,
      activity_state.last_keepalive_at;
  else
    return query
    select
      false,
      round(extract(epoch from (checked_at - activity_state.last_activity_at)) / 86400, 2),
      activity_state.last_activity_at,
      activity_state.last_keepalive_at;
  end if;
end;
$$;

revoke all on function public.run_database_keepalive() from public, anon, authenticated;
grant execute on function public.run_database_keepalive() to service_role;
