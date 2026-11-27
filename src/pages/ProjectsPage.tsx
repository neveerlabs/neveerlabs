import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  FolderOpen,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import type { Language, Project, ProjectPlatform } from "../types/projects";
import { isVideoMedia, MediaThumbnail } from "../components/MediaThumbnail";

const platforms: Array<ProjectPlatform | "all"> = [
  "all",
  "web",
  "mobile application",
  "desktop application",
  "cli",
  "other",
];

const labels = {
  en: {
    title: "Projects",
    subtitle: "A collection of ideas shaped into useful digital work.",
    all: "All",
    searchPlaceholder: "Search projects",
    searchLabel: "Search projects",
    clearSearch: "Clear project search",
    reset: "Reset filters",
    emptyTitle: "No projects yet",
    emptyDescription: "New projects will appear here once they are added.",
    noResultsTitle: "No matching projects",
    noResultsDescription: "Try another search or filter, or reset your selections.",
    untitled: "Neverlabs project",
  },
  zh: {
    title: "项目",
    subtitle: "将想法逐步转化为实用数字作品。",
    all: "全部",
    searchPlaceholder: "搜索项目",
    searchLabel: "搜索项目",
    clearSearch: "清除项目搜索",
    reset: "重置筛选",
    emptyTitle: "暂无项目",
    emptyDescription: "添加新项目后，它们会显示在这里。",
    noResultsTitle: "没有找到匹配的项目",
    noResultsDescription: "尝试其他搜索或筛选条件，或重置当前选择。",
    untitled: "Neverlabs 项目",
  },
} as const;

function platformLabel(platform: ProjectPlatform | "all", language: Language) {
  if (platform === "all") return labels[language].all;
  return platform === "mobile application"
    ? language === "en"
      ? "Mobile"
      : "移动应用"
    : platform === "desktop application"
      ? language === "en"
        ? "Desktop"
        : "桌面应用"
      : platform.toUpperCase();
}

function projectDescription(project: Project, language: Language): string {
  return project.description?.[language] || project.description?.en || "";
}

function plainDescriptionPreview(description: string, projectName: string): string {
  const heading = description.match(/^[ \t]{0,3}#{1,6}[ \t]+([^\r\n]+)[ \t]*(?:\r?\n|$)/);
  const source =
    heading &&
    heading[1].replace(/[*_~`]/g, "").trim() === projectName.trim()
      ? description.slice(heading[0].length)
      : description;

  return source
    .replace(/<(script|style|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, " ")
    .replace(/<(https?:\/\/[^>\s]+)>/gi, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/`+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/gm, " ")
    .replace(/^\s*(?:[-*_]){3,}\s*$/gm, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\[[ xX]\]/g, " ")
    .replace(/\\([\\`*_{}\[\]()#+.!>~-])/g, "$1")
    .replace(/[*_~`#|]/g, " ")
    .replace(/\s+([,.;:!?，。！？；：])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function ProjectCard({
  project,
  language,
  onNavigate,
  onFilter,
}: {
  project: Project;
  language: Language;
  onNavigate: (name: string) => void;
  onFilter: (kind: "platform" | "keyword", value: string) => void;
}) {
  const href = `/${language}/projects/${encodeURIComponent(project.name)}`;
  const description = projectDescription(project, language);
  const descriptionPreview = plainDescriptionPreview(description, project.name);
  const hasVideoPrimaryMedia =
    Boolean(project.primary_media) && isVideoMedia(project.primary_media ?? "");
  const tags = [
    ...(project.platform ? [{ kind: "platform" as const, label: platformLabel(project.platform, language) }] : []),
    ...(project.keyword ?? []).slice(0, 2).map((label) => ({ kind: "keyword" as const, label })),
  ];

  return (
    <article className="group relative isolate aspect-[4/3] overflow-hidden rounded-[20px] border border-[#e6e5e3] bg-[#f3f2ef] shadow-[0_8px_24px_rgba(26,25,24,0.07)] lg:rounded-2xl lg:shadow-[0_6px_18px_rgba(26,25,24,0.06)]">
      {project.primary_media ? (
        <div
          className={`absolute inset-0 ${hasVideoPrimaryMedia ? "" : "transition-transform duration-500 group-hover:scale-[1.03]"}`}
        >
          <MediaThumbnail className="h-full w-full" url={project.primary_media} />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_right,#e6e5e3_1px,transparent_1px),linear-gradient(to_bottom,#e6e5e3_1px,transparent_1px)] bg-[size:28px_28px]"
        >
          <div className="absolute inset-0 flex items-center justify-center bg-[#f3f2ef]/70">
            <span className="text-sm font-semibold tracking-wide text-[#9a9ba0]">
              {labels[language].untitled}
            </span>
          </div>
        </div>
      )}

      <a
        aria-label={`${project.name}: ${descriptionPreview}`}
        className="absolute inset-0 z-10"
        href={href}
        onClick={(event) => {
          event.preventDefault();
          onNavigate(project.name);
        }}
      >
        <span className="sr-only">{project.name}</span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pb-[4.5rem] pt-16 sm:px-5 sm:pb-[4.75rem] lg:px-3 lg:pb-3">
          <div className="flex min-w-0 items-center gap-2 lg:gap-1">
            <h2 className="min-w-0 truncate text-[17px] font-bold leading-snug text-white sm:text-[18px]">
              {project.name}
            </h2>
            {project.visibility && (
              <span className="shrink-0 rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm">
                {project.visibility}
              </span>
            )}
          </div>
          <p className="mt-1 w-full max-w-none line-clamp-2 text-[13px] leading-relaxed text-white/80 lg:line-clamp-3">
            {descriptionPreview}
          </p>
        </div>
        <ArrowUpRight
          aria-hidden="true"
          className="absolute right-4 top-4 rounded-full bg-black/35 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 lg:hidden"
          size={30}
        />
      </a>

      {tags.length > 0 && (
        <div className="absolute bottom-3 left-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap gap-1.5 sm:left-5 lg:hidden">
          {tags.map(({ kind, label }) => (
            <button
              className="max-w-full truncate rounded-full border border-white/30 bg-black/35 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-sm transition-colors hover:bg-white/25"
              key={`${kind}-${label}`}
              onClick={() => onFilter(kind, kind === "platform" ? project.platform ?? label : label)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

export function ProjectsPage({
  language,
  projects,
  onNavigate,
}: {
  language: Language;
  projects: Project[];
  onNavigate: (name: string) => void;
}) {
  const text = labels[language];
  const params = new URLSearchParams(window.location.search);
  const [platform, setPlatform] = useState<ProjectPlatform | "all">(
    (platforms.includes(params.get("platform") as ProjectPlatform)
      ? params.get("platform")
      : "all") as ProjectPlatform | "all",
  );
  const [keyword, setKeyword] = useState(params.get("keyword") ?? "");
  const [searchTerm, setSearchTerm] = useState(params.get("q") ?? "");
  const keywords = useMemo(
    () => [...new Set(projects.flatMap((project) => project.keyword ?? []))].sort(),
    [projects],
  );
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase(language);
  const filteredProjects = projects.filter(
    (project) =>
      (platform === "all" || project.platform === platform) &&
      (!keyword || project.keyword?.includes(keyword)) &&
      (!normalizedSearch ||
        project.name.toLocaleLowerCase(language).includes(normalizedSearch)),
  );
  const hasFilters = platform !== "all" || Boolean(keyword) || Boolean(normalizedSearch);

  const applyTagFilter = (
    kind: "platform" | "keyword",
    value: string,
  ) => {
    if (kind === "platform") {
      setPlatform(value as ProjectPlatform);
      return;
    }
    setKeyword(value);
  };

  const resetFilters = () => {
    setPlatform("all");
    setKeyword("");
    setSearchTerm("");
  };

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-10 md:px-8 md:pt-14 lg:pt-0">
      <header className="mb-8 max-w-2xl lg:mb-6">
        <h1 className="text-[30px] font-bold tracking-[-0.03em] text-[#1a1918] sm:text-[38px] lg:text-4xl">
          {text.title}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[#76777c] lg:mt-2 lg:text-[15px]">
          {text.subtitle}
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar flex max-w-full gap-2 overflow-x-auto">
          {platforms.map((option) => (
            <button
              aria-pressed={platform === option}
              className={`flex h-10 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium transition-colors lg:h-8 lg:px-3 lg:text-xs ${
                platform === option
                  ? "border-[#1a1918] bg-[#1a1918] text-white"
                  : "border-[#e5e4e1] bg-white text-[#6d6e73] hover:border-[#b8b7b4] hover:text-[#1a1918]"
              }`}
              key={option}
              onClick={() => setPlatform(option)}
              type="button"
            >
              {platformLabel(option, language)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end lg:gap-2">
          <div className="relative min-w-[180px] flex-1 lg:w-[220px] lg:flex-none">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8b8c91] lg:left-3"
              size={15}
            />
            <input
              aria-label={text.searchLabel}
              className="h-10 w-full rounded-full border border-[#e5e4e1] bg-white pl-10 pr-9 text-sm text-[#53545a] placeholder:text-[#9a9ba0] transition-colors hover:border-[#b8b7b4] focus:border-[#a9a8a4] focus:outline-none focus:ring-2 focus:ring-[#1a1918]/10 lg:h-8 lg:pl-8 lg:pr-8 lg:text-xs"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={text.searchPlaceholder}
              type="text"
              value={searchTerm}
            />
            {searchTerm && (
              <button
                aria-label={text.clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#85868b] transition-colors hover:text-[#1a1918] lg:right-2"
                onClick={() => setSearchTerm("")}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            )}
          </div>
          <div className="relative w-[148px] lg:w-[128px]">
            <select
              aria-label={language === "en" ? "Filter by keyword" : "按关键词筛选"}
              className="h-10 w-full appearance-none rounded-full border border-[#e5e4e1] bg-white pl-3.5 pr-9 text-sm text-[#53545a] transition-colors hover:border-[#b8b7b4] focus:border-[#a9a8a4] focus:outline-none focus:ring-2 focus:ring-[#1a1918]/10 lg:h-8 lg:pl-3 lg:text-xs"
              onChange={(event) => setKeyword(event.target.value)}
              value={keyword}
            >
              <option value="">{language === "en" ? "All keywords" : "所有关键词"}</option>
              {keywords.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#77787d]"
              size={14}
            />
          </div>
        </div>
      </div>

      {filteredProjects.length > 0 ? (
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:mt-7 lg:grid-cols-3 lg:gap-5">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              language={language}
              onFilter={applyTagFilter}
              onNavigate={onNavigate}
              project={project}
            />
          ))}
        </div>
      ) : (
        <section
          aria-live="polite"
          className="mt-8 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-[#e6e5e3] bg-white px-6 py-12 text-center shadow-[0_8px_24px_rgba(26,25,24,0.03)] lg:mt-7 lg:min-h-[300px]"
        >
          <div className="mb-4 flex size-11 items-center justify-center rounded-full border border-[#e6e5e3] bg-[#f7f6f4] text-[#77787d]">
            {projects.length === 0 ? (
              <FolderOpen aria-hidden="true" size={19} strokeWidth={1.7} />
            ) : (
              <Search aria-hidden="true" size={19} strokeWidth={1.7} />
            )}
          </div>
          <h2 className="text-base font-semibold tracking-[-0.01em] text-[#242321]">
            {projects.length === 0 ? text.emptyTitle : text.noResultsTitle}
          </h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[#76777c]">
            {projects.length === 0
              ? text.emptyDescription
              : text.noResultsDescription}
          </p>
          {hasFilters && (
            <button
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-full border border-[#e5e4e1] bg-white px-3.5 text-sm font-medium text-[#55565b] transition-colors hover:border-[#b8b7b4] hover:bg-[#f7f6f4] hover:text-[#1a1918]"
              onClick={resetFilters}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} />
              {text.reset}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
