alter table public.projects
  add column if not exists contributors jsonb;

alter table public.project_changelogs
  add column if not exists contributors jsonb;

update public.project_changelogs as changelog
set contributors = parent_project.contributors
from public.projects as parent_project
where changelog.project_id = parent_project.id
  and changelog.contributors is null
  and jsonb_typeof(parent_project.contributors) = 'array';

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

alter table public.project_changelogs
  drop column if exists framework;
