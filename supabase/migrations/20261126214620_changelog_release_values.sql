alter table public.project_changelogs
  drop constraint if exists project_changelogs_release_check;

update public.project_changelogs
set release = 'latest'
where release = 'stable';

alter table public.project_changelogs
  add constraint project_changelogs_release_check
  check (release in ('latest', 'pre-release', 'none'));
