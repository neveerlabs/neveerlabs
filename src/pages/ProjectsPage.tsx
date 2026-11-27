import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  SlidersHorizontal,
  FolderOpen,
  Image as ImageIcon,
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
    filters: "Filters",
    platforms: "Platforms",
    keywords: "Keywords",
    allKeywords: "All keywords",
    closeKeywords: "Close keyword filter",
    searchPlaceholder: "Search projects",
    searchLabel: "Search projects",
    clearSearch: "Clear project search",
    reset: "Reset filters",
    loadMore: "Load more...",
    emptyTitle: "No projects yet",
    emptyDescription: "New projects will appear here once they are added.",
    noResultsTitle: "No matching projects",
    noResultsDescription: "Try another search or filter, or reset your selections.",
  },
  zh: {
    title: "项目",
    subtitle: "将想法逐步转化为实用数字作品。",
    all: "全部",
    filters: "筛选",
    platforms: "平台",
    keywords: "关键词",
    allKeywords: "所有关键词",
    closeKeywords: "关闭关键词筛选",
    searchPlaceholder: "搜索项目",
    searchLabel: "搜索项目",
    clearSearch: "清除项目搜索",
    reset: "重置筛选",
    loadMore: "加载更多...",
    emptyTitle: "暂无项目",
    emptyDescription: "添加新项目后，它们会显示在这里。",
    noResultsTitle: "没有找到匹配的项目",
    noResultsDescription: "尝试其他搜索或筛选条件，或重置当前选择。",
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
}: {
  project: Project;
  language: Language;
  onNavigate: (name: string) => void;
}) {
  const href = `/${language}/projects/${encodeURIComponent(project.name)}`;
  const description = projectDescription(project, language);
  const descriptionPreview = plainDescriptionPreview(description, project.name);
  const hasVideoPrimaryMedia =
    Boolean(project.primary_media) && isVideoMedia(project.primary_media ?? "");
  return (
    <article className="group relative isolate aspect-[4/3] overflow-hidden rounded-2xl border border-[#e6e5e3] bg-[#f3f2ef] shadow-[0_6px_18px_rgba(26,25,24,0.05)] lg:rounded-[20px] lg:shadow-[0_8px_24px_rgba(26,25,24,0.07)]">
      <a
        aria-label={`${project.name}: ${descriptionPreview}`}
        className="absolute inset-0 z-10"
        href={href}
        onClick={(event) => {
          event.preventDefault();
          onNavigate(project.name);
        }}
      >
        {project.primary_media ? (
          <div
            className={`absolute inset-0 overflow-hidden ${hasVideoPrimaryMedia ? "" : "transition-transform duration-500 group-hover:scale-[1.03]"}`}
          >
            <MediaThumbnail className="h-full w-full" url={project.primary_media} />
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden bg-[linear-gradient(to_right,#e6e5e3_1px,transparent_1px),linear-gradient(to_bottom,#e6e5e3_1px,transparent_1px)] bg-[size:28px_28px]"
          >
            <div className="absolute inset-0 flex items-center justify-center bg-[#f3f2ef]/70">
              <ImageIcon className="text-[#9a9ba0]" size={38} strokeWidth={1.5} />
            </div>
          </div>
        )}
        <span className="sr-only">{project.name}</span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2 pb-1.5 pt-16 text-left lg:px-3 lg:pb-3">
          <div className="flex min-w-0 items-center gap-1">
            <h2 className="min-w-0 truncate text-[17px] font-bold leading-snug text-white lg:text-[18px]">
              {project.name}
            </h2>
            {project.visibility && (
              <span className="inline-flex shrink-0 rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm">
                {project.visibility}
              </span>
            )}
          </div>
          <p className="relative top-0.5 mt-0 w-full max-w-none line-clamp-3 text-[13px] leading-relaxed text-white/80 lg:top-0 lg:mt-0.5">
            {descriptionPreview}
          </p>
        </div>
      </a>
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [keywordPickerOpen, setKeywordPickerOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 64rem)").matches,
  );
  const [loadMoreCount, setLoadMoreCount] = useState(0);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchContainerRef = useRef<HTMLDivElement>(null);
  const mobileFilterRef = useRef<HTMLDivElement>(null);
  const keywordPickerHistoryRef = useRef(false);
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
  const initialVisibleCount = isDesktop ? 6 : 4;
  const loadMoreStep = isDesktop ? 12 : 8;
  const visibleProjects = filteredProjects.slice(
    0,
    initialVisibleCount + loadMoreCount * loadMoreStep,
  );

  const resetFilters = () => {
    setPlatform("all");
    setKeyword("");
    setSearchTerm("");
    setFiltersOpen(false);
  };

  const openKeywordPicker = () => {
    setFiltersOpen(false);
    if (!keywordPickerHistoryRef.current) {
      const currentState = window.history.state;
      const currentHistoryState =
        typeof currentState === "object" && currentState !== null
          ? currentState
          : {};
      window.history.replaceState(
        { ...currentHistoryState, neverlabsKeywordPickerReturn: true },
        "",
        window.location.href,
      );
      window.history.pushState(
        { ...currentHistoryState, neverlabsKeywordPicker: true },
        "",
        window.location.href,
      );
      keywordPickerHistoryRef.current = true;
    }
    setKeywordPickerOpen(true);
  };

  const closeKeywordPicker = () => {
    setKeywordPickerOpen(false);
    if (keywordPickerHistoryRef.current) {
      window.history.back();
    }
  };

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 64rem)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
      setLoadMoreCount(0);
    };
    desktopQuery.addEventListener("change", handleViewportChange);
    return () => {
      desktopQuery.removeEventListener("change", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    setLoadMoreCount(0);
  }, [platform, keyword, normalizedSearch]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!mobileSearchContainerRef.current?.contains(target)) {
        mobileSearchRef.current?.blur();
      }
      if (!mobileFilterRef.current?.contains(target)) {
        setFiltersOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        mobileSearchRef.current?.blur();
        closeKeywordPicker();
        setFiltersOpen(false);
      }
    };
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      const isKeywordPickerState =
        typeof state === "object" &&
        state !== null &&
        "neverlabsKeywordPicker" in state &&
        state.neverlabsKeywordPicker === true;
      const isKeywordPickerReturnState =
        typeof state === "object" &&
        state !== null &&
        "neverlabsKeywordPickerReturn" in state &&
        state.neverlabsKeywordPickerReturn === true;

      if (
        !keywordPickerHistoryRef.current &&
        !isKeywordPickerState &&
        !isKeywordPickerReturnState
      ) {
        return;
      }

      keywordPickerHistoryRef.current = isKeywordPickerState;
      setKeywordPickerOpen(isKeywordPickerState);
      if (isKeywordPickerReturnState) {
        const nextState = { ...state };
        delete nextState.neverlabsKeywordPickerReturn;
        window.history.replaceState(nextState, "", window.location.href);
      }
      event.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState, true);
    };
  }, []);

  return (
    <div className="-mx-3 w-[calc(100%+24px)] max-w-[1120px] px-1 pb-6 pt-2 md:mx-auto md:mt-0 md:w-full md:px-8 md:pt-14 lg:-mt-4 lg:max-w-none lg:pl-5 lg:pr-[10px] lg:pt-0">
      <header className="mb-4 max-w-2xl lg:mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-[#1a1918] sm:text-[38px] lg:text-4xl">
          {text.title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[#76777c] lg:mt-2 lg:text-[15px]">
          {text.subtitle}
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 lg:hidden">
          <div className="relative min-w-0 flex-1" ref={mobileSearchContainerRef}>
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
              ref={mobileSearchRef}
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
          <div className="relative shrink-0" ref={mobileFilterRef}>
            <button
              aria-label={text.filters}
              aria-expanded={filtersOpen}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                filtersOpen || platform !== "all" || keyword
                  ? "border-[#1a1918] bg-[#1a1918] text-white"
                  : "border-[#e5e4e1] bg-white text-[#53545a] hover:border-[#b8b7b4]"
              }`}
              onClick={() => setFiltersOpen((open) => !open)}
              type="button"
            >
              <SlidersHorizontal aria-hidden="true" size={16} />
            </button>
            {filtersOpen && (
              <div className="absolute right-0 top-12 z-30 grid w-[calc(100vw-16px)] max-w-[374px] gap-3 rounded-xl border border-[#e5e4e1] bg-white p-3 shadow-[0_12px_30px_rgba(26,25,24,0.12)] lg:hidden">
                <div>
                  <span className="mb-2 block text-xs font-semibold text-[#76777c]">{text.platforms}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {platforms.map((option) => (
                      <button
                        aria-pressed={platform === option}
                        className={`flex h-8 items-center rounded-full border px-2.5 text-xs font-medium transition-colors ${
                          platform === option
                            ? "border-[#1a1918] bg-[#1a1918] text-white"
                            : "border-[#e5e4e1] bg-white text-[#6d6e73]"
                        }`}
                        key={option}
                        onClick={() => setPlatform(option)}
                        type="button"
                      >
                        {platformLabel(option, language)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-1.5 text-xs font-semibold text-[#76777c]">
                  {text.keywords}
                  <button
                    aria-label={language === "en" ? "Filter by keyword" : "按关键词筛选"}
                    aria-haspopup="dialog"
                    aria-expanded={keywordPickerOpen}
                    className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-[#e5e4e1] bg-white px-3 text-left text-sm font-normal text-[#53545a] focus:border-[#a9a8a4] focus:outline-none focus:ring-2 focus:ring-[#1a1918]/10"
                    onClick={openKeywordPicker}
                    type="button"
                  >
                    <span className="truncate">{keyword || text.allKeywords}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className="shrink-0 text-[#77787d]"
                      size={14}
                    />
                  </button>
                </div>
                {hasFilters && (
                  <button
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-[#e5e4e1] text-xs font-medium text-[#55565b]"
                    onClick={resetFilters}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={13} />
                    {text.reset}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="hidden max-w-full gap-2 overflow-x-auto lg:flex">
          {platforms.map((option) => (
            <button
              aria-pressed={platform === option}
              className={`flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
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

        <div className="hidden items-center gap-2 lg:flex lg:justify-end">
          <div className="relative w-[220px]">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8c91]"
              size={15}
            />
            <input
              aria-label={text.searchLabel}
              className="h-8 w-full rounded-full border border-[#e5e4e1] bg-white pl-8 pr-8 text-xs text-[#53545a] placeholder:text-[#9a9ba0] transition-colors hover:border-[#b8b7b4] focus:border-[#a9a8a4] focus:outline-none focus:ring-2 focus:ring-[#1a1918]/10"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={text.searchPlaceholder}
              type="text"
              value={searchTerm}
            />
            {searchTerm && (
              <button
                aria-label={text.clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#85868b] transition-colors hover:text-[#1a1918]"
                onClick={() => setSearchTerm("")}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            )}
          </div>
          <div className="relative w-[128px]">
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
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:mt-7 lg:grid-cols-3 lg:gap-5 lg:overflow-x-clip">
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                language={language}
                onNavigate={onNavigate}
                project={project}
              />
            ))}
          </div>
          {visibleProjects.length < filteredProjects.length && (
            <div className="mt-1 flex justify-center">
              <button
                className="inline-flex items-center justify-center py-1.5 text-xs font-medium text-[#55565b] transition-colors hover:text-[#1a1918] focus-visible:underline focus-visible:underline-offset-4"
                onClick={() => setLoadMoreCount((count) => count + 1)}
                type="button"
              >
                {text.loadMore}
              </button>
            </div>
          )}
        </>
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
      {keywordPickerOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-4 py-6 lg:hidden"
          onClick={closeKeywordPicker}
          role="presentation"
        >
          <section
            aria-labelledby="keyword-picker-title"
            aria-modal="true"
            className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-[#e5e4e1] bg-white shadow-[0_16px_48px_rgba(26,25,24,0.2)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#e6e5e3] px-4 py-3">
              <h2
                className="text-sm font-semibold text-[#1a1918]"
                id="keyword-picker-title"
              >
                {text.keywords}
              </h2>
              <button
                aria-label={text.closeKeywords}
                className="flex size-8 items-center justify-center rounded-full text-[#76777c] transition-colors hover:bg-[#f3f2ef] hover:text-[#1a1918] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4774ed]"
                onClick={closeKeywordPicker}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </header>
            <div
              aria-label={text.keywords}
              className="min-h-0 overflow-y-auto overscroll-contain p-2"
              role="group"
            >
              {[{ value: "", label: text.allKeywords }, ...keywords.map((value) => ({ value, label: value }))].map(
                (option) => (
                  <button
                    aria-pressed={keyword === option.value}
                    className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      keyword === option.value
                        ? "bg-[#f3f2ef] font-medium text-[#1a1918]"
                        : "text-[#53545a] hover:bg-[#f7f6f4]"
                    }`}
                    key={option.value || "all"}
                    onClick={() => {
                      setKeyword(option.value);
                      closeKeywordPicker();
                    }}
                    type="button"
                  >
                    <span className="truncate">{option.label}</span>
                    {keyword === option.value && (
                      <span
                        aria-hidden="true"
                        className="ml-3 size-1.5 shrink-0 rounded-full bg-[#4774ed]"
                      />
                    )}
                  </button>
                ),
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
