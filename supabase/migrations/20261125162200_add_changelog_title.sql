alter table public.project_changelogs
  add column if not exists title text;

update public.project_changelogs
set title = version
where title is null or btrim(title) = '';

alter table public.project_changelogs
  alter column title set not null;
