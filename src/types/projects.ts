export type Language = "en" | "zh";

export type ProjectPlatform =
  | "web"
  | "mobile application"
  | "desktop application"
  | "cli"
  | "other";

export type LocalizedText = Record<Language, string>;

export interface ProjectContributor {
  name: string;
  url?: string | null;
}

export interface ProjectChangelog {
  id: string;
  project_id: string;
  title: string;
  version: string;
  release: "stable" | "latest" | "pre-release";
  description: LocalizedText;
  contributors?: ProjectContributor[] | null;
  media: string[];
  released_at: string;
}

export interface Project {
  id: string;
  name: string;
  visibility: "public" | "private" | null;
  platform: ProjectPlatform | null;
  description: LocalizedText;
  framework: string[] | null;
  keyword: string[] | null;
  contributors: ProjectContributor[] | null;
  primary_media: string | null;
  media: string[];
  url: string | null;
  created_at: string;
  completed_at: string | null;
  sort_order: number;
  changelogs: ProjectChangelog[];
}
