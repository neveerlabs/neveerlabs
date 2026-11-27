create or replace function public.apply_projects_commit(p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  change jsonb;
  table_name text;
  operation_name text;
  record_data jsonb;
  target_id uuid;
  target_project_id uuid;
  description_value jsonb;
  media_value jsonb;
  framework_value text[];
  keyword_value text[];
  applied jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Changes must be a JSON array.';
  end if;

  if jsonb_array_length(p_changes) = 0 then
    raise exception 'There are no staged changes to commit.';
  end if;

  if jsonb_array_length(p_changes) > 500 then
    raise exception 'A commit cannot contain more than 500 row changes.';
  end if;

  for change in
    select item.value
    from jsonb_array_elements(p_changes) with ordinality as item(value, sequence_no)
    order by
      case
        when item.value ->> 'table' = 'contributors'
          and item.value ->> 'operation' <> 'delete' then 0
        when item.value ->> 'table' = 'projects'
          and item.value ->> 'operation' <> 'delete' then 1
        when item.value ->> 'table' = 'project_changelogs'
          and item.value ->> 'operation' <> 'delete' then 2
        when item.value ->> 'table' = 'project_changelogs'
          and item.value ->> 'operation' = 'delete' then 3
        when item.value ->> 'table' = 'projects'
          and item.value ->> 'operation' = 'delete' then 4
        else 5
      end,
      item.sequence_no
  loop
    if jsonb_typeof(change) is distinct from 'object' then
      raise exception 'Each change must be a JSON object.';
    end if;

    table_name := change ->> 'table';
    operation_name := change ->> 'operation';

    if table_name is null
      or table_name not in ('projects', 'project_changelogs', 'contributors') then
      raise exception 'Unsupported table: %.', table_name;
    end if;

    if operation_name is null
      or operation_name not in ('insert', 'update', 'delete') then
      raise exception 'Unsupported operation: %.', operation_name;
    end if;

    if operation_name = 'delete' then
      target_id := nullif(change ->> 'id', '')::uuid;
      if target_id is null then
        raise exception 'A row ID is required for delete.';
      end if;

      if table_name = 'projects' then
        delete from public.projects where id = target_id;
      elsif table_name = 'project_changelogs' then
        delete from public.project_changelogs where id = target_id;
      else
        delete from public.contributors where id = target_id;
      end if;

      if not found then
        raise exception 'No row found in % with ID %.', table_name, target_id;
      end if;

      applied := applied || jsonb_build_array(jsonb_build_object(
        'table', table_name,
        'operation', operation_name,
        'id', target_id
      ));
      continue;
    end if;

    record_data := change -> 'record';
    if jsonb_typeof(record_data) is distinct from 'object' then
      raise exception 'The record for % must be a JSON object.', operation_name;
    end if;

    target_id := nullif(record_data ->> 'id', '')::uuid;
    if operation_name = 'update' and target_id is null then
      raise exception 'A row ID is required for update.';
    elsif operation_name = 'insert' then
      target_id := coalesce(target_id, gen_random_uuid());
    end if;

    if table_name = 'contributors' then
      if jsonb_typeof(record_data -> 'name') is distinct from 'string'
        or nullif(btrim(record_data ->> 'name'), '') is null then
        raise exception 'A contributor name is required.';
      end if;
      if record_data ? 'url'
        and record_data -> 'url' <> 'null'::jsonb
        and jsonb_typeof(record_data -> 'url') is distinct from 'string' then
        raise exception 'A contributor URL must be a string or null.';
      end if;

      if operation_name = 'insert' then
        insert into public.contributors (id, name, url)
        values (
          target_id,
          btrim(record_data ->> 'name'),
          nullif(btrim(record_data ->> 'url'), '')
        );
      else
        update public.contributors
        set
          name = btrim(record_data ->> 'name'),
          url = nullif(btrim(record_data ->> 'url'), '')
        where id = target_id;

        if not found then
          raise exception 'No contributor found with ID %.', target_id;
        end if;
      end if;

      applied := applied || jsonb_build_array(jsonb_build_object(
        'table', table_name,
        'operation', operation_name,
        'id', target_id
      ));
      continue;
    end if;

    if jsonb_typeof(record_data -> 'media') not in ('array', 'null')
      and record_data ? 'media' then
      raise exception 'The media field must be a JSON array or null.';
    end if;
    if jsonb_typeof(record_data -> 'media') = 'array'
      and exists (
        select 1
        from jsonb_array_elements(record_data -> 'media') as item(value)
        where jsonb_typeof(item.value) <> 'string'
      ) then
      raise exception 'Each media item must be a URL string.';
    end if;
    if jsonb_typeof(record_data -> 'description') not in ('object', 'null')
      and record_data ? 'description' then
      raise exception 'The description field must be a JSON object.';
    end if;
    if record_data ? 'description'
      and jsonb_typeof(record_data -> 'description') = 'object'
      and (
        jsonb_typeof(record_data -> 'description' -> 'en') is distinct from 'string'
        or jsonb_typeof(record_data -> 'description' -> 'zh') is distinct from 'string'
      ) then
      raise exception 'The description must contain string values for en and zh.';
    end if;
    if jsonb_typeof(record_data -> 'contributors') not in ('array', 'null')
      and record_data ? 'contributors' then
      raise exception 'Contributor IDs must be a JSON array or null.';
    end if;
    if jsonb_typeof(record_data -> 'contributors') = 'array'
      and exists (
        select 1
        from jsonb_array_elements(record_data -> 'contributors') as item(value)
        where jsonb_typeof(item.value) <> 'string'
          or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) then
      raise exception 'Each contributor must be a valid contributor ID.';
    end if;

    description_value := coalesce(
      nullif(record_data -> 'description', 'null'::jsonb),
      '{"en": "", "zh": ""}'::jsonb
    );
    media_value := coalesce(
      nullif(record_data -> 'media', 'null'::jsonb),
      '[]'::jsonb
    );
    if table_name = 'projects' then
      if jsonb_typeof(record_data -> 'framework') not in ('array', 'null')
        and record_data ? 'framework' then
        raise exception 'The framework field must be a JSON array or null.';
      end if;
      if jsonb_typeof(record_data -> 'framework') = 'array'
        and exists (
          select 1
          from jsonb_array_elements(record_data -> 'framework') as item(value)
          where jsonb_typeof(item.value) <> 'string'
        ) then
        raise exception 'Each framework must be a string.';
      end if;
      if jsonb_typeof(record_data -> 'keyword') not in ('array', 'null')
        and record_data ? 'keyword' then
        raise exception 'The keyword field must be a JSON array or null.';
      end if;
      if jsonb_typeof(record_data -> 'keyword') = 'array'
        and exists (
          select 1
          from jsonb_array_elements(record_data -> 'keyword') as item(value)
          where jsonb_typeof(item.value) <> 'string'
        ) then
        raise exception 'Each keyword must be a string.';
      end if;
      if nullif(btrim(record_data ->> 'name'), '') is null then
        raise exception 'A project name is required.';
      end if;

      if record_data -> 'keyword' is null
        or record_data -> 'keyword' = 'null'::jsonb then
        keyword_value := null;
      else
        keyword_value := array(
          select jsonb_array_elements_text(record_data -> 'keyword')
        );
      end if;
      if record_data -> 'framework' is null
        or record_data -> 'framework' = 'null'::jsonb then
        framework_value := null;
      else
        framework_value := array(
          select jsonb_array_elements_text(record_data -> 'framework')
        );
      end if;

      if operation_name = 'insert' then
        insert into public.projects (
          id, name, visibility, platform, description, framework, keyword,
          primary_media, media, url, created_at, completed_at,
          sort_order
        )
        values (
          target_id,
          btrim(record_data ->> 'name'),
          nullif(record_data ->> 'visibility', ''),
          nullif(record_data ->> 'platform', ''),
          description_value,
          framework_value,
          keyword_value,
          nullif(record_data ->> 'primary_media', ''),
          media_value,
          nullif(record_data ->> 'url', ''),
          coalesce(nullif(record_data ->> 'created_at', '')::timestamptz, now()),
          nullif(record_data ->> 'completed_at', '')::timestamptz,
          coalesce(nullif(record_data ->> 'sort_order', '')::integer, 0)
        );
      else
        update public.projects
        set
          name = btrim(record_data ->> 'name'),
          visibility = nullif(record_data ->> 'visibility', ''),
          platform = nullif(record_data ->> 'platform', ''),
          description = description_value,
          framework = framework_value,
          keyword = keyword_value,
          primary_media = nullif(record_data ->> 'primary_media', ''),
          media = media_value,
          url = nullif(record_data ->> 'url', ''),
          completed_at = nullif(record_data ->> 'completed_at', '')::timestamptz,
          sort_order = coalesce(nullif(record_data ->> 'sort_order', '')::integer, 0)
        where id = target_id;

        if not found then
          raise exception 'No project found with ID %.', target_id;
        end if;
      end if;

      delete from public.project_contributors
      where project_id = target_id;
      insert into public.project_contributors (project_id, contributor_id, position)
      select
        target_id,
        item.value::uuid,
        (item.ordinality - 1)::integer
      from jsonb_array_elements_text(
        coalesce(nullif(record_data -> 'contributors', 'null'::jsonb), '[]'::jsonb)
      ) with ordinality as item(value, ordinality)
      on conflict on constraint project_contributors_pkey
      do update set position = excluded.position;
    else
      target_project_id := nullif(record_data ->> 'project_id', '')::uuid;
      if target_project_id is null then
        raise exception 'A project_id is required for a changelog.';
      end if;
      if nullif(btrim(record_data ->> 'title'), '') is null then
        raise exception 'A changelog title is required.';
      end if;
      if nullif(btrim(record_data ->> 'version'), '') is null then
        raise exception 'A changelog version is required.';
      end if;
      if record_data ? 'framework' then
        raise exception 'Frameworks are stored on projects, not changelogs.';
      end if;

      if operation_name = 'insert' then
        insert into public.project_changelogs (
          id, project_id, title, version, release, description, media, released_at
        )
        values (
          target_id,
          target_project_id,
          btrim(record_data ->> 'title'),
          btrim(record_data ->> 'version'),
          record_data ->> 'release',
          description_value,
          media_value,
          coalesce(nullif(record_data ->> 'released_at', '')::timestamptz, now())
        );
      else
        update public.project_changelogs
        set
          project_id = target_project_id,
          title = btrim(record_data ->> 'title'),
          version = btrim(record_data ->> 'version'),
          release = record_data ->> 'release',
          description = description_value,
          media = media_value,
          released_at = coalesce(
            nullif(record_data ->> 'released_at', '')::timestamptz,
            now()
          )
        where id = target_id;

        if not found then
          raise exception 'No changelog found with ID %.', target_id;
        end if;
      end if;

      delete from public.changelog_contributors
      where changelog_id = target_id;
      insert into public.changelog_contributors (changelog_id, contributor_id, position)
      select
        target_id,
        item.value::uuid,
        (item.ordinality - 1)::integer
      from jsonb_array_elements_text(
        coalesce(nullif(record_data -> 'contributors', 'null'::jsonb), '[]'::jsonb)
      ) with ordinality as item(value, ordinality)
      on conflict on constraint changelog_contributors_pkey
      do update set position = excluded.position;
    end if;

    applied := applied || jsonb_build_array(jsonb_build_object(
      'table', table_name,
      'operation', operation_name,
      'id', target_id
    ));
  end loop;

  return jsonb_build_object('applied', applied);
end;
$$;

revoke all on function public.apply_projects_commit(jsonb) from public, anon, authenticated;
grant execute on function public.apply_projects_commit(jsonb) to service_role;

comment on function public.apply_projects_commit(jsonb) is
  'Applies a staged batch of project and changelog inserts, updates, and deletes in one database transaction. Execute only through the trusted service role.';
