create schema if not exists extensions;
create schema if not exists vault;

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  visibility text null check (visibility in ('public', 'private')),
  platform text null check (
    platform in ('web', 'mobile application', 'desktop application', 'cli', 'other')
  ),
  description jsonb not null default '{"en": "", "zh": ""}'::jsonb,
  framework text[] null,
  keyword text[] null,
  primary_media text null,
  media jsonb not null default '[]'::jsonb,
  url text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  sort_order integer not null default 0
);

create table if not exists public.project_changelogs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  version text not null,
  release text not null check (release in ('latest', 'pre-release', 'none')),
  description jsonb not null default '{"en": "", "zh": ""}'::jsonb,
  media jsonb not null default '[]'::jsonb,
  released_at timestamptz not null default now()
);

create table if not exists public.contributors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  url text null,
  created_at timestamptz not null default now()
);

create unique index if not exists contributors_name_url_unique
  on public.contributors (lower(btrim(name)), btrim(coalesce(url, '')));

create table if not exists public.project_contributors (
  project_id uuid not null references public.projects(id) on delete cascade,
  contributor_id uuid not null references public.contributors(id) on delete cascade,
  position integer not null default 0,
  primary key (project_id, contributor_id)
);

create index if not exists project_contributors_contributor_id_idx
  on public.project_contributors (contributor_id);

create table if not exists public.changelog_contributors (
  changelog_id uuid not null references public.project_changelogs(id) on delete cascade,
  contributor_id uuid not null references public.contributors(id) on delete cascade,
  position integer not null default 0,
  primary key (changelog_id, contributor_id)
);

create index if not exists changelog_contributors_contributor_id_idx
  on public.changelog_contributors (contributor_id);

alter table public.project_changelogs
  add column if not exists title text;
update public.project_changelogs
set title = version
where title is null or btrim(title) = '';
alter table public.project_changelogs
  alter column title set not null;
alter table public.project_changelogs
  drop column if exists framework;

create or replace function public.prevent_changelog_project_reassignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'A changelog cannot be moved to another project after creation.';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_changelog_project_reassignment() from public, anon, authenticated;

drop trigger if exists project_changelogs_prevent_project_reassignment on public.project_changelogs;
create trigger project_changelogs_prevent_project_reassignment
  before update of project_id on public.project_changelogs
  for each row execute function public.prevent_changelog_project_reassignment();

alter table public.projects enable row level security;
alter table public.project_changelogs enable row level security;
alter table public.contributors enable row level security;
alter table public.project_contributors enable row level security;
alter table public.changelog_contributors enable row level security;

insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can read project media" on storage.objects;

create or replace function public.project_media_object_path(media_url text)
returns text
language sql
immutable
strict
as $$
  select nullif(
    split_part(
      regexp_replace(
        media_url,
        '^https?://[^/]+/storage/v1/object/public/project-media/',
        ''
      ),
      '?',
      1
    ),
    ''
  )
  where media_url ~ '^https?://[^/]+/storage/v1/object/public/project-media/.+'
$$;

create or replace function public.request_project_media_cleanup(object_paths text[])
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  function_url text;
  service_role_key text;
begin
  if coalesce(cardinality(object_paths), 0) = 0 then
    return;
  end if;

  select decrypted_secret into function_url
  from vault.decrypted_secrets
  where name = 'project_media_cleanup_function_url'
  limit 1;

  select decrypted_secret into service_role_key
  from vault.decrypted_secrets
  where name = 'project_media_cleanup_service_role_key'
  limit 1;

  if function_url is null or service_role_key is null then
    raise exception
      'Project media cleanup is not configured. Add the Edge Function URL and service role key to Supabase Vault before deleting projects or changelogs.';
  end if;

  perform net.http_post(
    url := function_url,
    body := jsonb_build_object(
      'bucket', 'project-media',
      'paths', to_jsonb(object_paths)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    )
  );
end;
$$;

create or replace function public.cleanup_project_media_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  object_paths text[];
begin
  select array_agg(distinct paths.path)
  into object_paths
  from (
    select public.project_media_object_path(old.primary_media) as path
    union all
    select public.project_media_object_path(media_items.item)
    from jsonb_array_elements_text(coalesce(old.media, '[]'::jsonb)) as media_items(item)
    union all
    select public.project_media_object_path(media_items.item)
    from public.project_changelogs
    cross join lateral jsonb_array_elements_text(
      coalesce(project_changelogs.media, '[]'::jsonb)
    ) as media_items(item)
    where project_id = old.id
  ) as paths
  where paths.path is not null;

  perform public.request_project_media_cleanup(object_paths);
  return old;
end;
$$;

create or replace function public.cleanup_changelog_media_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  object_paths text[];
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;

  select array_agg(distinct public.project_media_object_path(media_items.item))
  into object_paths
  from jsonb_array_elements_text(coalesce(old.media, '[]'::jsonb)) as media_items(item);

  perform public.request_project_media_cleanup(object_paths);
  return old;
end;
$$;

revoke all on function public.request_project_media_cleanup(text[]) from public, anon, authenticated;
revoke all on function public.cleanup_project_media_before_delete() from public, anon, authenticated;
revoke all on function public.cleanup_changelog_media_after_delete() from public, anon, authenticated;

drop trigger if exists projects_cleanup_media_before_delete on public.projects;
create trigger projects_cleanup_media_before_delete
  before delete on public.projects
  for each row execute function public.cleanup_project_media_before_delete();

drop trigger if exists changelogs_cleanup_media_after_delete on public.project_changelogs;
create trigger changelogs_cleanup_media_after_delete
  after delete on public.project_changelogs
  for each row execute function public.cleanup_changelog_media_after_delete();

comment on function public.request_project_media_cleanup(text[]) is
  'Queues deletion through the Supabase Storage API. Configure project_media_cleanup_function_url and project_media_cleanup_service_role_key in Supabase Vault.';

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
