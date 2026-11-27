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

do $migration$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'contributors'
  ) then
    execute $sql$
      with legacy_contributors as (
        select
          btrim(item.value ->> 'name') as name,
          case
            when jsonb_typeof(item.value -> 'url') = 'string'
              then nullif(btrim(item.value ->> 'url'), '')
            else null
          end as url
        from public.projects as project
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(project.contributors) = 'array' then project.contributors
            else '[]'::jsonb
          end
        ) as item(value)
        where jsonb_typeof(item.value -> 'name') = 'string'
          and nullif(btrim(item.value ->> 'name'), '') is not null
      )
      insert into public.contributors (name, url)
      select distinct on (lower(name), btrim(coalesce(url, '')))
        name,
        url
      from legacy_contributors
      order by lower(name), btrim(coalesce(url, '')), name
      on conflict do nothing
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_changelogs'
      and column_name = 'contributors'
  ) then
    execute $sql$
      with legacy_contributors as (
        select
          btrim(item.value ->> 'name') as name,
          case
            when jsonb_typeof(item.value -> 'url') = 'string'
              then nullif(btrim(item.value ->> 'url'), '')
            else null
          end as url
        from public.project_changelogs as changelog
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(changelog.contributors) = 'array' then changelog.contributors
            else '[]'::jsonb
          end
        ) as item(value)
        where jsonb_typeof(item.value -> 'name') = 'string'
          and nullif(btrim(item.value ->> 'name'), '') is not null
      )
      insert into public.contributors (name, url)
      select distinct on (lower(name), btrim(coalesce(url, '')))
        name,
        url
      from legacy_contributors
      order by lower(name), btrim(coalesce(url, '')), name
      on conflict do nothing
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'contributors'
  ) then
    execute $sql$
      insert into public.project_contributors (project_id, contributor_id, position)
      select distinct on (project.id, contributor.id)
        project.id,
        contributor.id,
        (item.ordinality - 1)::integer
      from public.projects as project
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(project.contributors) = 'array' then project.contributors
          else '[]'::jsonb
        end
      ) with ordinality as item(value, ordinality)
      join public.contributors as contributor
        on lower(contributor.name) = lower(btrim(item.value ->> 'name'))
        and btrim(coalesce(contributor.url, '')) = btrim(coalesce(
          case
            when jsonb_typeof(item.value -> 'url') = 'string'
              then nullif(btrim(item.value ->> 'url'), '')
            else null
          end,
          ''
        ))
      where jsonb_typeof(item.value -> 'name') = 'string'
        and nullif(btrim(item.value ->> 'name'), '') is not null
      order by project.id, contributor.id, item.ordinality
      on conflict (project_id, contributor_id) do nothing
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_changelogs'
      and column_name = 'contributors'
  ) then
    execute $sql$
      insert into public.changelog_contributors (changelog_id, contributor_id, position)
      select distinct on (changelog.id, contributor.id)
        changelog.id,
        contributor.id,
        (item.ordinality - 1)::integer
      from public.project_changelogs as changelog
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(changelog.contributors) = 'array' then changelog.contributors
          else '[]'::jsonb
        end
      ) with ordinality as item(value, ordinality)
      join public.contributors as contributor
        on lower(contributor.name) = lower(btrim(item.value ->> 'name'))
        and btrim(coalesce(contributor.url, '')) = btrim(coalesce(
          case
            when jsonb_typeof(item.value -> 'url') = 'string'
              then nullif(btrim(item.value ->> 'url'), '')
            else null
          end,
          ''
        ))
      where jsonb_typeof(item.value -> 'name') = 'string'
        and nullif(btrim(item.value ->> 'name'), '') is not null
      order by changelog.id, contributor.id, item.ordinality
      on conflict (changelog_id, contributor_id) do nothing
    $sql$;

    execute $sql$
      insert into public.changelog_contributors (changelog_id, contributor_id, position)
      select
        changelog.id,
        project_assignment.contributor_id,
        project_assignment.position
      from public.project_changelogs as changelog
      join public.project_contributors as project_assignment
        on project_assignment.project_id = changelog.project_id
      where changelog.contributors is null
        or jsonb_typeof(changelog.contributors) = 'null'
      on conflict (changelog_id, contributor_id) do nothing
    $sql$;
  end if;
end;
$migration$;

alter table public.projects drop column if exists contributors;
alter table public.project_changelogs drop column if exists contributors;

alter table public.contributors enable row level security;
alter table public.project_contributors enable row level security;
alter table public.changelog_contributors enable row level security;
