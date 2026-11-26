import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Project } from "../src/types/projects";
import { attachContributorAssignments } from "../src/server/contributor-data";

interface ApiRequest {
  method?: string;
  url?: string;
  headers: { host?: string };
}

interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string | number | readonly string[]): ApiResponse;
  json(body: unknown): ApiResponse;
}
type Environment = Record<string, string | undefined>;

const cacheControl = "s-maxage=30, stale-while-revalidate=60";

export async function handleProjectsRequest(
  request: ApiRequest,
  response: ApiResponse,
  env: Environment = process.env,
): Promise<void> {
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Projects API requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    response.status(500).json({ error: "Projects are temporarily unavailable." });
    return;
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const requestUrl = new URL(
      request.url ?? "/api/projects",
      `https://${request.headers.host ?? "localhost"}`,
    );
    const name = requestUrl.searchParams.get("name");

    if (name !== null) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("visibility", "public")
        .ilike("name", name)
        .maybeSingle();

      if (projectError) throw projectError;
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }

      const { data: changelogs, error: changelogError } = await supabase
        .from("project_changelogs")
        .select("*")
        .eq("project_id", project.id)
        .order("released_at", { ascending: false });

      if (changelogError) throw changelogError;
      const [projectWithContributors] = await attachContributorAssignments(
        supabase,
        [project],
        "project",
      );
      const changelogsWithContributors = await attachContributorAssignments(
        supabase,
        changelogs ?? [],
        "changelog",
      );
      response.status(200).json({
        ...projectWithContributors,
        changelogs: changelogsWithContributors,
      } satisfies Project);
      return;
    }

    const { data: projects, error: projectsError } = await supabase
      .from("projects")
      .select("*")
      .eq("visibility", "public")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (projectsError) throw projectsError;
    const projectRows = projects ?? [];
    if (projectRows.length === 0) {
      response.status(200).json([]);
      return;
    }

    const projectIds = projectRows.map((project) => project.id);
    const { data: changelogs, error: changelogError } = await supabase
      .from("project_changelogs")
      .select("*")
      .in("project_id", projectIds)
      .order("released_at", { ascending: false });

    if (changelogError) throw changelogError;

    const projectsWithContributors = await attachContributorAssignments(
      supabase,
      projectRows,
      "project",
    );
    const changelogsWithContributors = await attachContributorAssignments(
      supabase,
      changelogs ?? [],
      "changelog",
    );
    const changelogsByProject = new Map<string, Project["changelogs"]>();
    for (const changelog of changelogsWithContributors) {
      const rows = changelogsByProject.get(changelog.project_id) ?? [];
      rows.push(changelog);
      changelogsByProject.set(changelog.project_id, rows);
    }

    response.status(200).json(
      projectsWithContributors.map((project) => ({
        ...project,
        changelogs: changelogsByProject.get(project.id) ?? [],
      })) satisfies Project[],
    );
  } catch (error) {
    console.error("Projects API request failed:", error);
    response.status(500).json({ error: "Projects are temporarily unavailable." });
  }
}

export default async function projectsHandler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  await handleProjectsRequest(request, response);
}
