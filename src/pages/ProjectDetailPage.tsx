import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  MediaLightbox,
  MediaThumbnail,
} from "../components/MediaThumbnail";
import { MarkdownContent } from "../components/MarkdownContent";
import type {
  Language,
  Project,
  ProjectChangelog,
  ProjectContributor,
} from "../types/projects";

const releaseClass: Record<Exclude<ProjectChangelog["release"], "none">, string> = {
  latest: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "pre-release": "border-amber-200 bg-amber-50 text-amber-700",
};
const compactProjectTagClass =
  "whitespace-nowrap rounded-md bg-[#edf4ff] px-2 py-0.5 text-xs font-medium leading-4 text-[#4774ed] transition-colors hover:bg-[#e0ecff]";

const detailText = {
  en: {
    back: "Back to Projects",
    created: "Created",
    completed: "Completed",
    ongoing: "Ongoing",
    about: "About",
    url: "Website",
    latestRelease: "Latest release",
    selectMedia: "Select media",
    frameworks: "Frameworks",
    keywords: "Keywords",
    contributors: "Contributors",
    showAll: "Show all",
    updatedBy: "Updated by",
    showAllContributors: "Show all contributors",
    previousMedia: "Previous media",
    nextMedia: "Next media",
    close: "Close",
    changelog: "Changelog",
    notFound: "Project not found",
    notFoundDescription: "This project may have moved or is not publicly available.",
    releases: { latest: "Latest", "pre-release": "Pre-release" },
  },
  zh: {
    back: "返回项目列表",
    created: "创建时间",
    completed: "完成时间",
    ongoing: "进行中",
    about: "关于",
    url: "项目链接",
    latestRelease: "最新版本",
    selectMedia: "选择媒体",
    frameworks: "框架",
    keywords: "关键词",
    contributors: "贡献者",
    showAll: "显示全部",
    updatedBy: "更新者",
    showAllContributors: "显示所有贡献者",
    previousMedia: "上一项媒体",
    nextMedia: "下一项媒体",
    close: "关闭",
    changelog: "更新日志",
    notFound: "未找到项目",
    notFoundDescription: "该项目可能已移动或当前未公开。",
    releases: { latest: "最新版本", "pre-release": "预发布" },
  },
} as const;

function localize(project: Project, language: Language): string {
  return project.description?.[language] || project.description?.en || "";
}

function projectDescription(project: Project, language: Language): string {
  const lines = localize(project, language).split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  const heading = lines[firstContentIndex]?.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);

  if (heading?.[1].trim() === project.name.trim()) {
    lines.splice(firstContentIndex, 1);
    return lines.join("\n").trimStart();
  }

  return lines.join("\n");
}

type ProjectInfoDialogData =
  | { kind: "keyword" | "framework"; items: string[] }
  | { kind: "contributors"; items: ProjectContributor[] };

function dateLabel(date: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "en" ? "en" : "zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function relativeTimeLabel(date: string, language: Language): string {
  const timestamp = new Date(date).getTime();
  const elapsedSeconds = Math.abs(Date.now() - timestamp) / 1000;
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
    { unit: "year", seconds: 31_557_600 },
    { unit: "month", seconds: 2_629_800 },
    { unit: "week", seconds: 604_800 },
    { unit: "day", seconds: 86_400 },
    { unit: "hour", seconds: 3_600 },
    { unit: "minute", seconds: 60 },
  ];
  const { unit, seconds } =
    units.find((candidate) => elapsedSeconds >= candidate.seconds) ?? {
      unit: "minute",
      seconds: 60,
    };
  const amount = Math.max(1, Math.round(elapsedSeconds / seconds));
  const value = timestamp > Date.now() ? amount : -amount;

  return new Intl.RelativeTimeFormat(language === "en" ? "en" : "zh-CN", {
    numeric: "always",
  }).format(value, unit);
}

function MediaGallery({ project, language }: { project: Project; language: Language }) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const media = [...new Set([project.primary_media, ...(project.media ?? [])].filter(
    (item): item is string => Boolean(item),
  ))];
  const [activeMedia, setActiveMedia] = useState<string | null>(null);
  const thumbnailsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const thumbnails = thumbnailsRef.current;
    if (!thumbnails || media.length < 2) return;

    const updateScrollButtons = () => {
      const maxScroll = thumbnails.scrollWidth - thumbnails.clientWidth;
      setCanScrollLeft(thumbnails.scrollLeft > 1);
      setCanScrollRight(maxScroll - thumbnails.scrollLeft > 1);
    };

    updateScrollButtons();
    thumbnails.addEventListener("scroll", updateScrollButtons, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollButtons);
    resizeObserver.observe(thumbnails);

    return () => {
      thumbnails.removeEventListener("scroll", updateScrollButtons);
      resizeObserver.disconnect();
    };
  }, [media.length]);

  const scrollThumbnails = (direction: -1 | 1) => {
    const thumbnails = thumbnailsRef.current;
    if (!thumbnails) return;
    const firstThumbnail = thumbnails.querySelector("button");
    if (!firstThumbnail) return;
    const gap = Number.parseFloat(getComputedStyle(thumbnails).columnGap) || 0;
    thumbnails.scrollBy({
      left: direction * (firstThumbnail.getBoundingClientRect().width + gap),
      behavior: "smooth",
    });
  };

  if (media.length === 0) return null;
  const displayedMedia = media.find((url) => url === activeMedia) ?? media[0];

  return (
    <>
      <div className="w-full">
        <div className="flex w-full justify-center">
          <MediaThumbnail
            className="rounded-2xl border border-[#e6e5e3] bg-[#f3f2ef]"
            fit="contain"
            onPreviewClick={() => setLightboxUrl(displayedMedia)}
            url={displayedMedia}
          />
        </div>
        {media.length > 1 && (
          <div className="relative mt-3">
            <div
              className="no-scrollbar flex w-full gap-2 overflow-x-auto overscroll-x-contain scroll-smooth"
              ref={thumbnailsRef}
            >
              {media.map((url, index) => (
                <button
                  aria-label={`${detailText[language].selectMedia} ${index + 1}`}
                  aria-pressed={displayedMedia === url}
                  className={`h-[60px] w-24 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                    displayedMedia === url
                      ? "border-[#1a1918]"
                      : "border-transparent opacity-75 hover:border-[#b8b7b4] hover:opacity-100"
                  }`}
                  key={url}
                  onClick={() => setActiveMedia(url)}
                  onFocus={() => setActiveMedia(url)}
                  onMouseEnter={() => setActiveMedia(url)}
                  type="button"
                >
                  <MediaThumbnail
                    centerPlayIcon
                    className="h-full w-full object-cover"
                    url={url}
                  />
                </button>
              ))}
            </div>
            {canScrollLeft && (
              <button
                aria-label={detailText[language].previousMedia}
                className="absolute left-2 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/55 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => scrollThumbnails(-1)}
                type="button"
              >
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
            )}
            {canScrollRight && (
              <button
                aria-label={detailText[language].nextMedia}
                className="absolute right-2 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/55 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => scrollThumbnails(1)}
                type="button"
              >
                <ChevronRight aria-hidden="true" size={20} />
              </button>
            )}
          </div>
        )}
      </div>
      {lightboxUrl && (
        <MediaLightbox
          alt="Project media"
          onClose={() => setLightboxUrl(null)}
          url={lightboxUrl}
        />
      )}
    </>
  );
}

function ProjectTag({
  language,
  kind,
  value,
  variant = "default",
}: {
  language: Language;
  kind: "framework" | "keyword";
  value: string;
  variant?: "default" | "github";
}) {
  const className =
    variant === "github"
      ? compactProjectTagClass
      : "rounded-full border border-[#e6e5e3] bg-[#faf9f8] px-2.5 py-1 text-xs text-[#6d6e73] transition-colors hover:border-[#b8b7b4] hover:text-[#1a1918]";
  if (kind === "framework") {
    return <span className={className}>{value}</span>;
  }

  const params = new URLSearchParams();
  params.set("keyword", value);
  return (
    <a
      className={className}
      href={`/${language}/projects?${params.toString()}`}
    >
      {value}
    </a>
  );
}

function fitsWithinTwoRows(
  widths: number[],
  containerWidth: number,
  gap: number,
): boolean {
  let row = 1;
  let rowWidth = 0;

  for (const width of widths) {
    if (width > containerWidth) return false;
    if (rowWidth > 0 && rowWidth + gap + width > containerWidth) {
      row += 1;
      rowWidth = width;
    } else {
      rowWidth = rowWidth === 0 ? width : rowWidth + gap + width;
    }
    if (row > 2) return false;
  }

  return true;
}

function CompactProjectTags({
  items,
  kind,
  language,
  showAllLabel,
  onShowAll,
}: {
  items: string[];
  kind: "framework" | "keyword";
  language: Language;
  showAllLabel: string;
  onShowAll: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const hiddenCount = items.length - visibleCount;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurement = measurementRef.current;
    if (!container || !measurement) return;

    const measure = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) return;

      const tagWidths = [
        ...measurement.querySelectorAll<HTMLElement>("[data-tag-measure]"),
      ].map((element) => element.getBoundingClientRect().width);
      const overflowWidths = [
        ...measurement.querySelectorAll<HTMLElement>("[data-overflow-measure]"),
      ].map((element) => element.getBoundingClientRect().width);
      const gap = Number.parseFloat(getComputedStyle(container).columnGap) || 0;
      let nextVisibleCount = items.length;

      if (!fitsWithinTwoRows(tagWidths, containerWidth, gap)) {
        nextVisibleCount = 0;
        for (let count = items.length - 1; count >= 0; count -= 1) {
          const hidden = items.length - count;
          if (
            fitsWithinTwoRows(
              [...tagWidths.slice(0, count), overflowWidths[hidden - 1]],
              containerWidth,
              gap,
            )
          ) {
            nextVisibleCount = count;
            break;
          }
        }
      }

      setVisibleCount((current) =>
        current === nextVisibleCount ? current : nextVisibleCount,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [items]);

  return (
    <div className="relative mt-1">
      <div className="flex flex-wrap gap-1" ref={containerRef}>
        {items.slice(0, visibleCount).map((item) => (
          <ProjectTag key={item} kind={kind} language={language} value={item} variant="github" />
        ))}
        {hiddenCount > 0 && (
          <button
            aria-label={showAllLabel}
            className={`${compactProjectTagClass} shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4774ed]`}
            onClick={onShowAll}
            type="button"
          >
            +{hiddenCount}
          </button>
        )}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 flex flex-col items-start"
        ref={measurementRef}
      >
        {items.map((item) => (
          <span className={compactProjectTagClass} data-tag-measure key={item}>
            {item}
          </span>
        ))}
        {items.map((_, index) => (
          <span
            className={compactProjectTagClass}
            data-overflow-measure
            key={`overflow-${index + 1}`}
          >
            +{index + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContributorName({
  contributor,
  className,
}: {
  contributor: ProjectContributor;
  className: string;
}) {
  if (!contributor.url) {
    return <span className={className}>{contributor.name}</span>;
  }

  return (
    <a
      className={`${className} hover:underline`}
      href={contributor.url}
      rel="noreferrer"
      target="_blank"
    >
      {contributor.name}
    </a>
  );
}

function ProjectMetadata({
  project,
  language,
  onOpenDialog,
}: {
  project: Project;
  language: Language;
  onOpenDialog: (dialog: ProjectInfoDialogData) => void;
}) {
  const text = detailText[language];
  const latestRelease = [...project.changelogs].sort(
    (first, second) =>
      new Date(second.released_at).getTime() - new Date(first.released_at).getTime(),
  )[0];
  const hasMetadata = Boolean(
    project.url ||
      project.keyword?.length ||
      latestRelease ||
      project.contributors?.length ||
      project.framework?.length,
  );

  if (!hasMetadata) return null;

  return (
    <aside className="h-fit min-w-0">
      <h2 className="text-sm font-semibold text-[#1a1918]">{text.about}</h2>
      <div className="mt-3 space-y-3">
        {project.url && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ba0]">
              {text.url}
            </h3>
            <a
              className="mt-0.5 inline-flex max-w-full items-center gap-1 text-[13px] text-[#454440] hover:text-[#1a1918]"
              href={project.url}
              rel="noreferrer"
              target="_blank"
              title={project.url}
            >
              <span className="truncate">{project.url}</span>
              <ArrowUpRight className="shrink-0" size={13} />
            </a>
          </section>
        )}

        {project.keyword?.length ? (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ba0]">
              {text.keywords}
            </h3>
            <CompactProjectTags
              items={project.keyword}
              kind="keyword"
              language={language}
              onShowAll={() => onOpenDialog({ kind: "keyword", items: project.keyword ?? [] })}
              showAllLabel={`${text.showAll} ${text.keywords.toLowerCase()}`}
            />
          </section>
        ) : null}

        {latestRelease && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ba0]">
              {text.latestRelease}
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-[#1a1918]">
                {latestRelease.title || latestRelease.version}
              </span>
              {latestRelease.release !== "none" && (
                <span
                  className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
                    releaseClass[latestRelease.release]
                  }`}
                >
                  {text.releases[latestRelease.release]}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#76777c]">
              <span>{latestRelease.version}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={latestRelease.released_at}>
                {relativeTimeLabel(latestRelease.released_at, language)}
              </time>
            </div>
          </section>
        )}

        {project.contributors?.length ? (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ba0]">
              {text.contributors}
            </h3>
            <div className="mt-1 flex min-w-0 items-center gap-1 text-xs font-medium text-[#1a1918]">
              <ContributorName
                className="min-w-0 truncate text-[#1a1918]"
                contributor={project.contributors[0]}
              />
              {project.contributors.length > 1 && (
                <button
                  aria-label={text.showAllContributors}
                  className="shrink-0 text-[#4774ed] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4774ed]"
                  onClick={() =>
                    onOpenDialog({
                      kind: "contributors",
                      items: project.contributors ?? [],
                    })
                  }
                  type="button"
                >
                  +{project.contributors.length - 1}
                </button>
              )}
            </div>
          </section>
        ) : null}

        {project.framework?.length ? (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ba0]">
              {text.frameworks}
            </h3>
            <CompactProjectTags
              items={project.framework}
              kind="framework"
              language={language}
              onShowAll={() => onOpenDialog({ kind: "framework", items: project.framework ?? [] })}
              showAllLabel={`${text.showAll} ${text.frameworks.toLowerCase()}`}
            />
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function ProjectChangelogList({
  changelogs,
  projectContributors,
  language,
  onOpenDialog,
}: {
  changelogs: ProjectChangelog[];
  projectContributors: Project["contributors"];
  language: Language;
  onOpenDialog: (dialog: ProjectInfoDialogData) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(
    () =>
      [...changelogs].sort(
        (first, second) =>
          new Date(second.released_at).getTime() -
          new Date(first.released_at).getTime(),
      )[0]?.id ?? null,
  );
  const text = detailText[language];
  const openEntry = changelogs.find((entry) => entry.id === openId);
  const contributors =
    openEntry?.contributors ?? projectContributors ?? [];
  const description = openEntry
    ? openEntry.description?.[language] || openEntry.description?.en || ""
    : "";

  return (
    <section className="pt-3 md:pt-0">
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-[minmax(190px,0.32fr)_minmax(0,1fr)]">
        <ol className="space-y-1 md:-mt-px md:sticky md:top-0 md:self-start md:border-t md:border-[#e6e5e3] md:pt-3">
          {changelogs.map((entry) => {
            const isOpen = entry.id === openId;

            return (
              <li key={entry.id}>
                <button
                  aria-controls={isOpen ? `changelog-${entry.id}` : undefined}
                  aria-expanded={isOpen}
                  className="inline-flex min-w-0 text-left"
                  onClick={() => setOpenId(isOpen ? null : entry.id)}
                  type="button"
                >
                  <span
                    className={`min-w-0 break-words text-base leading-snug text-[#1a1918] ${
                      isOpen ? "font-bold" : "font-medium"
                    }`}
                  >
                    {entry.title || entry.version}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {openEntry && (
          <div className="min-w-0 md:pt-3" id={`changelog-${openEntry.id}`}>
            <div className="mb-1 flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 flex-nowrap items-center gap-2">
                <h3 className="min-w-0 break-words text-base font-semibold leading-snug text-[#1a1918]">
                  {openEntry.title || openEntry.version}
                </h3>
                {openEntry.release !== "none" && (
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${releaseClass[openEntry.release]}`}>
                    {text.releases[openEntry.release]}
                  </span>
                )}
              </div>
              <span className="shrink-0 text-right text-xs font-medium text-[#76777c]">
                {openEntry.version}
              </span>
            </div>
            {description && <MarkdownContent source={description} />}
            <div className="mt-4 flex flex-col items-end border-t border-[#e6e5e3] pt-2.5 text-xs">
              {contributors.length > 0 && (
                <div className="flex items-center gap-1 text-right text-[#76777c]">
                  <span>{text.updatedBy}</span>
                  <ContributorName
                    className="font-medium text-[#454440]"
                    contributor={contributors[0]}
                  />
                  {contributors.length > 1 && (
                    <button
                      aria-label={text.showAllContributors}
                      className="font-medium text-[#4774ed] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4774ed]"
                      onClick={() =>
                        onOpenDialog({
                          kind: "contributors",
                          items: contributors,
                        })
                      }
                      type="button"
                    >
                      +{contributors.length - 1}
                    </button>
                  )}
                </div>
              )}
              <time
                className="mt-1.5 text-right text-xs text-[#9a9ba0]"
                dateTime={openEntry.released_at}
              >
                {dateLabel(openEntry.released_at, language)}
              </time>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function ProjectDetailPage({
  language,
  project,
  loading,
  error,
  onBack,
}: {
  language: Language;
  project: Project | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
}) {
  const text = detailText[language];
  const [dialog, setDialog] = useState<ProjectInfoDialogData | null>(null);

  if (loading) {
    return (
      <div aria-live="polite" className="mx-auto min-h-[50vh] w-full max-w-5xl px-5 py-20 text-sm text-[#76777c]">
        {language === "en" ? "Loading project…" : "正在加载项目…"}
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-3xl flex-col items-start justify-center px-5 py-16">
        <h1 className="text-3xl font-bold tracking-tight text-[#1a1918]">{text.notFound}</h1>
        <p className="mt-3 text-[#76777c]">{text.notFoundDescription}</p>
        <button
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#e6e5e3] bg-white px-4 py-2 text-sm text-[#1a1918]"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={16} />
          {text.back}
        </button>
      </div>
    );
  }

  return (
    <>
    <article className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-9 md:px-8 md:pt-12 lg:pt-0">
      <button
        className="inline-flex items-center gap-2 text-sm text-[#76777c] transition-colors hover:text-[#1a1918]"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft size={16} />
        {text.back}
      </button>

      <header className="mt-2 border-b border-[#e6e5e3] pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:gap-1">
            <h1 className="text-[26px] font-bold tracking-tight text-[#1a1918] sm:text-[32px]">
              {project.name}
            </h1>
            {project.visibility && (
              <span className="inline-flex items-center rounded-full border border-[#e6e5e3] bg-white px-2 py-0.5 text-[11px] font-medium text-[#76777c]">
                {project.visibility}
              </span>
            )}
          </div>
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[#76777c] lg:justify-end">
            <div className="flex items-center gap-1.5">
              <dt>{text.created}</dt>
              <dd className="text-[#454440]">{dateLabel(project.created_at, language)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>{text.completed}</dt>
              <dd className="text-[#454440]">
                {project.completed_at ? dateLabel(project.completed_at, language) : text.ongoing}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div
        className={`mt-6 grid grid-cols-1 items-start gap-6 ${
          project.primary_media || project.media.length > 0
            ? "lg:grid-cols-[minmax(0,690px)_minmax(280px,1fr)]"
            : ""
        }`}
      >
        {(project.primary_media || project.media.length > 0) && (
          <MediaGallery key={project.id} language={language} project={project} />
        )}
        <ProjectMetadata
          language={language}
          onOpenDialog={setDialog}
          project={project}
        />
      </div>

      <section className="mt-10 border-b border-[#e6e5e3] pb-3">
        <MarkdownContent source={projectDescription(project, language)} />
      </section>

      {project.changelogs.length > 0 && (
        <ProjectChangelogList
          changelogs={project.changelogs}
          key={project.id}
          language={language}
          onOpenDialog={setDialog}
          projectContributors={project.contributors}
        />
      )}
    </article>
    <ProjectInfoDialog
      dialog={dialog}
      language={language}
      onClose={() => setDialog(null)}
    />
    </>
  );
}

function ProjectInfoDialog({
  dialog,
  language,
  onClose,
}: {
  dialog: ProjectInfoDialogData | null;
  language: Language;
  onClose: () => void;
}) {
  const text = detailText[language];

  useEffect(() => {
    if (!dialog) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialog, onClose]);

  if (!dialog) return null;

  const title =
    dialog.kind === "keyword"
      ? text.keywords
      : dialog.kind === "framework"
        ? text.frameworks
        : text.contributors;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-labelledby="project-info-dialog-title"
        aria-modal="true"
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-[#e6e5e3] bg-white p-4 shadow-xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="mb-4 flex items-center justify-between gap-4">
          <h2
            className="text-base font-semibold text-[#1a1918]"
            id="project-info-dialog-title"
          >
            {title}
          </h2>
          <button
            aria-label={text.close}
            autoFocus
            className="rounded-md p-1 text-[#76777c] transition-colors hover:bg-[#f3f2ef] hover:text-[#1a1918] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4774ed]"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        {dialog.kind === "contributors" ? (
          <ul className="space-y-2">
            {dialog.items.map((contributor) => (
              <li
                className="text-sm font-medium text-[#454440]"
                key={`${contributor.name}-${contributor.url ?? ""}`}
              >
                <ContributorName
                  className="text-[#454440]"
                  contributor={contributor}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap gap-2">
            {dialog.items.map((item) => (
              <ProjectTag
                key={item}
                kind={dialog.kind}
                language={language}
                value={item}
                variant="github"
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
