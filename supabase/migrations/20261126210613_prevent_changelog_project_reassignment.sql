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
