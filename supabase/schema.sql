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
  contributors jsonb null,
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
  release text not null check (release in ('stable', 'latest', 'pre-release')),
  description jsonb not null default '{"en": "", "zh": ""}'::jsonb,
  contributors jsonb null,
  media jsonb not null default '[]'::jsonb,
  released_at timestamptz not null default now()
);

alter table public.project_changelogs
  add column if not exists title text;
update public.project_changelogs
set title = version
where title is null or btrim(title) = '';
alter table public.project_changelogs
  alter column title set not null;
alter table public.project_changelogs
  add column if not exists contributors jsonb;
update public.project_changelogs as changelog
set contributors = parent_project.contributors
from public.projects as parent_project
where changelog.project_id = parent_project.id
  and changelog.contributors is null
  and jsonb_typeof(parent_project.contributors) = 'array';
alter table public.project_changelogs
  drop column if exists framework;

update public.projects as source
set contributors = (
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'name', btrim(item.value ->> 'name'),
        'url', case
          when jsonb_typeof(item.value -> 'url') = 'string'
            then nullif(btrim(item.value ->> 'url'), '')
          else null
        end
      ))
      order by item.ordinality
    ) filter (
      where jsonb_typeof(item.value -> 'name') = 'string'
        and nullif(btrim(item.value ->> 'name'), '') is not null
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(source.contributors) with ordinality as item(value, ordinality)
)
where jsonb_typeof(source.contributors) = 'array';

update public.project_changelogs as source
set contributors = (
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'name', btrim(item.value ->> 'name'),
        'url', case
          when jsonb_typeof(item.value -> 'url') = 'string'
            then nullif(btrim(item.value ->> 'url'), '')
          else null
        end
      ))
      order by item.ordinality
    ) filter (
      where jsonb_typeof(item.value -> 'name') = 'string'
        and nullif(btrim(item.value ->> 'name'), '') is not null
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(source.contributors) with ordinality as item(value, ordinality)
)
where jsonb_typeof(source.contributors) = 'array';

alter table public.projects enable row level security;
alter table public.project_changelogs enable row level security;

insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can read project media" on storage.objects;
create policy "Public can read project media"
  on storage.objects for select
  using (bucket_id = 'project-media');

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
