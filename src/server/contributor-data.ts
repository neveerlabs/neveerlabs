import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectContributor } from "../types/projects";

type AssignmentKind = "project" | "changelog";

export async function attachContributorAssignments<T extends { id: string }>(
  supabase: SupabaseClient,
  records: T[],
  kind: AssignmentKind,
): Promise<Array<T & { contributors: ProjectContributor[] }>> {
  if (records.length === 0) return [];

  const parentColumn = kind === "project" ? "project_id" : "changelog_id";
  const relationTable = kind === "project"
    ? "project_contributors"
    : "changelog_contributors";
  const { data: assignments, error: assignmentError } = await supabase
    .from(relationTable)
    .select(`${parentColumn}, contributor_id, position`)
    .in(parentColumn, records.map((record) => record.id))
    .order("position", { ascending: true });

  if (assignmentError) throw assignmentError;
  const contributorIds = [...new Set(
    (assignments ?? []).map((assignment) => assignment.contributor_id as string),
  )];
  if (contributorIds.length === 0) {
    return records.map((record) => ({ ...record, contributors: [] }));
  }

  const { data: contributors, error: contributorError } = await supabase
    .from("contributors")
    .select("id, name, url")
    .in("id", contributorIds);
  if (contributorError) throw contributorError;

  const contributorsById = new Map(
    (contributors ?? []).map((contributor) => [
      contributor.id as string,
      {
        id: contributor.id as string,
        name: contributor.name as string,
        url: contributor.url as string | null,
      },
    ]),
  );
  const contributorsByParent = new Map<string, ProjectContributor[]>();

  for (const assignment of assignments ?? []) {
    const contributor = contributorsById.get(assignment.contributor_id as string);
    if (!contributor) continue;
    const parentId = (
      kind === "project"
        ? (assignment as { project_id?: string }).project_id
        : (assignment as { changelog_id?: string }).changelog_id
    ) as string;
    const list = contributorsByParent.get(parentId) ?? [];
    list.push(contributor);
    contributorsByParent.set(parentId, list);
  }

  return records.map((record) => ({
    ...record,
    contributors: contributorsByParent.get(record.id) ?? [],
  }));
}
