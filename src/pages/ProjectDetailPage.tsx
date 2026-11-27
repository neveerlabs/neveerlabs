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
const galleryProjectTagClass =
  "whitespace-nowrap rounded-md bg-[#edf4ff] px-1.5 py-0 text-[10px] font-medium leading-3 text-[#4774ed] transition-colors hover:bg-[#e0ecff]";

const detailText = {
  en: {
    back: "Back to Projects",
    created: "Created",
    completed: "Completed",
    ongoing: "Ongoing",
    about: "About",
    selectAbout: "Select project information",
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
    selectAbout: "选择项目信息",
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

type GalleryItem =
  | { kind: "media"; id: string; url: string }
  | { kind: "about"; id: "about" };

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

function hasProjectMetadata(project: Project): boolean {
  return Boolean(
    project.url ||
      project.keyword?.length ||
      project.changelogs.length ||
      project.contributors?.length ||
      project.framework?.length,
  );
}

function MediaGallery({
  project,
  language,
  onOpenDialog,
}: {
  project: Project;
  language: Language;
  onOpenDialog: (dialog: ProjectInfoDialogData) => void;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const media = [...new Set([project.primary_media, ...(project.media ?? [])].filter(
    (item): item is string => Boolean(item),
  ))];
  const hasMetadata = hasProjectMetadata(project);
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 64rem)").matches,
  );
  const galleryItems: GalleryItem[] = media.map((url) => ({
    kind: "media",
    id: url,
    url,
  }));
  if (!isDesktop && hasMetadata) {
    galleryItems.push({ kind: "about", id: "about" });
  }
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const thumbnailsRef = useRef<HTMLDivElement>(null);
  const mediaTrackRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const pendingMediaIndexRef = useRef<number | null>(null);
  const lastSwipeAtRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [previewMediaIndex, setPreviewMediaIndex] = useState<number | null>(null);
  const [swipePhase, setSwipePhase] = useState<
    "idle" | "dragging" | "settling" | "resetting"
  >("idle");
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useLayoutEffect(() => {
    if (swipePhase !== "resetting") return;
    mediaTrackRef.current?.getBoundingClientRect();
    setSwipePhase("idle");
  }, [swipePhase]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 64rem)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
    };
    desktopQuery.addEventListener("change", handleViewportChange);
    return () => {
      desktopQuery.removeEventListener("change", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    setActiveItemIndex((index) =>
      Math.min(index, Math.max(0, galleryItems.length - 1)),
    );
    setPreviewMediaIndex(null);
    pendingMediaIndexRef.current = null;
    swipeStartRef.current = null;
    setDragOffset(0);
    setSwipePhase("idle");
  }, [galleryItems.length]);

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

  if (galleryItems.length === 0) return null;
  const activeIndex = Math.min(
    activeItemIndex,
    Math.max(0, galleryItems.length - 1),
  );
  const displayedItem = galleryItems[activeIndex];
  const hasMultipleItems = galleryItems.length > 1;
  const adjacentItems = [
    galleryItems[(activeIndex - 1 + galleryItems.length) % galleryItems.length],
    displayedItem,
    galleryItems[(activeIndex + 1) % galleryItems.length],
  ];
  const activeIndicatorWidth = Math.max(
    12,
    24 - Math.max(0, galleryItems.length - 2) * 2,
  );

  return (
    <>
      <div className="w-full">
        <div
          className="aspect-video w-full touch-pan-y overflow-hidden rounded-2xl border border-[#e6e5e3] bg-[#f3f2ef]"
          onClickCapture={(event) => {
            if (Date.now() - lastSwipeAtRef.current < 400) {
              event.preventDefault();
              event.stopPropagation();
              lastSwipeAtRef.current = 0;
            }
          }}
          onPointerCancel={() => {
            swipeStartRef.current = null;
            setPreviewMediaIndex(null);
            if (swipePhase === "dragging") {
              setSwipePhase("settling");
              setDragOffset(0);
            }
          }}
          onPointerDown={(event) => {
            if (
              event.pointerType !== "touch" ||
              !hasMultipleItems ||
              swipePhase !== "idle"
            ) {
              return;
            }
            swipeStartRef.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              dragging: false,
            };
          }}
          onPointerMove={(event) => {
            const start = swipeStartRef.current;
            if (!start || start.pointerId !== event.pointerId) return;

            const deltaX = event.clientX - start.x;
            const deltaY = event.clientY - start.y;
            if (!start.dragging) {
              if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
              if (Math.abs(deltaX) <= Math.abs(deltaY)) {
                swipeStartRef.current = null;
                return;
              }
              start.dragging = true;
              setSwipePhase("dragging");
            }

            const width = event.currentTarget.clientWidth;
            setDragOffset(Math.max(-width, Math.min(width, deltaX)));
            if (Math.abs(deltaX) >= Math.max(40, width * 0.18)) {
              const direction = deltaX < 0 ? 1 : -1;
              setPreviewMediaIndex(
                (activeIndex + direction + galleryItems.length) %
                  galleryItems.length,
              );
            } else {
              setPreviewMediaIndex(null);
            }
          }}
          onPointerUp={(event) => {
            const start = swipeStartRef.current;
            swipeStartRef.current = null;
            if (!start || start.pointerId !== event.pointerId || !start.dragging) {
              return;
            }

            const deltaX = event.clientX - start.x;
            const deltaY = event.clientY - start.y;
            const threshold = Math.max(40, event.currentTarget.clientWidth * 0.18);
            if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY)) {
              setPreviewMediaIndex(null);
              setSwipePhase("settling");
              setDragOffset(0);
              return;
            }

            lastSwipeAtRef.current = Date.now();
            const direction = deltaX < 0 ? 1 : -1;
            pendingMediaIndexRef.current =
              (activeIndex + direction + galleryItems.length) %
              galleryItems.length;
            setPreviewMediaIndex(pendingMediaIndexRef.current);
            setSwipePhase("settling");
            setDragOffset(direction < 0 ? event.currentTarget.clientWidth : -event.currentTarget.clientWidth);
          }}
        >
          <div
            className={`flex h-full ${hasMultipleItems ? "w-[300%]" : "w-full"}`}
            ref={mediaTrackRef}
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget || event.propertyName !== "transform") {
                return;
              }

              const nextMediaIndex = pendingMediaIndexRef.current;
              if (nextMediaIndex === null) {
                setPreviewMediaIndex(null);
                setSwipePhase("idle");
                return;
              }

              pendingMediaIndexRef.current = null;
              setActiveItemIndex(nextMediaIndex);
              setPreviewMediaIndex(null);
              setSwipePhase("resetting");
              setDragOffset(0);
            }}
            style={{
              transform:
                hasMultipleItems
                  ? `translate3d(calc(-33.333333% + ${dragOffset}px), 0, 0)`
                  : undefined,
              transition:
                swipePhase === "dragging" || swipePhase === "resetting"
                  ? "none"
                  : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {(hasMultipleItems ? adjacentItems : [displayedItem]).map(
              (item, index) =>
                item.kind === "about" ? (
                  <div
                    className={`h-full ${
                      hasMultipleItems ? "w-1/3 shrink-0" : "w-full"
                    } overflow-hidden bg-white`}
                    key={`${index}-${item.id}`}
                  >
                    <ProjectMetadata
                      language={language}
                      onOpenDialog={onOpenDialog}
                      project={project}
                      variant="gallery"
                    />
                  </div>
                ) : (
                  <MediaThumbnail
                    className={`h-full ${
                      hasMultipleItems ? "w-1/3 shrink-0" : "w-full"
                    }`}
                    contentClassName="!max-h-full !max-w-full"
                    fit="contain"
                    key={`${index}-${item.id}`}
                    onPreviewClick={() => setLightboxUrl(item.url)}
                    url={item.url}
                  />
                ),
            )}
          </div>
        </div>
        {media.length > 1 && (
          <div className="relative mt-3 hidden lg:block">
            <div
              className="no-scrollbar flex w-full gap-2 overflow-x-auto overscroll-x-contain scroll-smooth"
              ref={thumbnailsRef}
            >
              {media.map((url, index) => (
                <button
                  aria-label={`${detailText[language].selectMedia} ${index + 1}`}
                  aria-pressed={
                    displayedItem.kind === "media" &&
                    displayedItem.url === url
                  }
                  className={`aspect-video w-24 shrink-0 overflow-hidden rounded-lg border-2 bg-[#f3f2ef] transition ${
                    displayedItem.kind === "media" && displayedItem.url === url
                      ? "border-[#1a1918]"
                      : "border-transparent opacity-75 hover:border-[#b8b7b4] hover:opacity-100"
                  }`}
                  key={url}
                  onClick={() => setActiveItemIndex(index)}
                  onFocus={() => setActiveItemIndex(index)}
                  onMouseEnter={() => setActiveItemIndex(index)}
                  type="button"
                >
                  <MediaThumbnail
                    centerPlayIcon
                    className="h-full w-full"
                    contentClassName="!max-h-full !max-w-full"
                    fit="contain"
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
        {galleryItems.length > 1 && (
          <div
            aria-label={detailText[language].selectMedia}
            className="mt-3 flex w-full items-center justify-center gap-1.5 lg:hidden"
            role="group"
          >
            {galleryItems.map((item, index) => {
              const isActive = (previewMediaIndex ?? activeIndex) === index;
              const label =
                item.kind === "about"
                  ? detailText[language].selectAbout
                  : `${detailText[language].selectMedia} ${index + 1}`;
              return (
                <button
                  aria-label={label}
                  aria-pressed={isActive}
                  className={`h-1.5 rounded-full transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4774ed] ${
                    isActive
                      ? "bg-[#1a1918]"
                      : "w-1.5 shrink-0 bg-[#d2d1cf] hover:bg-[#9a9ba0]"
                  }`}
                  key={item.id}
                  onClick={() => setActiveItemIndex(index)}
                  style={isActive ? { width: activeIndicatorWidth } : undefined}
                  type="button"
                >
                  <span className="sr-only">
                    {label}
                  </span>
                </button>
              );
            })}
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
  variant?: "default" | "github" | "gallery";
}) {
  const className =
    variant === "gallery"
      ? galleryProjectTagClass
      : variant === "github"
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
  variant = "github",
}: {
  items: string[];
  kind: "framework" | "keyword";
  language: Language;
  showAllLabel: string;
  onShowAll: () => void;
  variant?: "github" | "gallery";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const tagClassName =
    variant === "gallery" ? galleryProjectTagClass : compactProjectTagClass;
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
      <div
        className={`flex flex-wrap ${
          variant === "gallery" ? "gap-0.5" : "gap-1"
        }`}
        ref={containerRef}
      >
        {items.slice(0, visibleCount).map((item) => (
          <ProjectTag
            key={item}
            kind={kind}
            language={language}
            value={item}
            variant={variant}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            aria-label={showAllLabel}
            className={`${tagClassName} shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4774ed]`}
            onClick={onShowAll}
            type="button"
          >
            +{hiddenCount}
          </button>
        )}
      </div>
      <div
        aria-hidden="true"
        className={`pointer-events-none invisible absolute left-0 top-0 flex h-0 flex-col items-start overflow-hidden ${
          variant === "gallery" ? "gap-0.5" : "gap-1"
        }`}
        ref={measurementRef}
      >
        {items.map((item) => (
          <span className={tagClassName} data-tag-measure key={item}>
            {item}
          </span>
        ))}
        {items.map((_, index) => (
          <span
            className={tagClassName}
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
  variant = "sidebar",
}: {
  project: Project;
  language: Language;
  onOpenDialog: (dialog: ProjectInfoDialogData) => void;
  variant?: "sidebar" | "gallery";
}) {
  const text = detailText[language];
  const isGalleryCard = variant === "gallery";
  const sectionHeadingClass = isGalleryCard
    ? "text-[9px] font-semibold uppercase tracking-[0.08em] text-[#9a9ba0]"
    : "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ba0]";
  const latestRelease = [...project.changelogs].sort(
    (first, second) =>
      new Date(second.released_at).getTime() - new Date(first.released_at).getTime(),
  )[0];

  if (!hasProjectMetadata(project)) return null;

  const websiteSection = project.url ? (
    <section className="min-w-0">
      <h3 className={sectionHeadingClass}>{text.url}</h3>
      <a
        className={`mt-0.5 inline-flex max-w-full min-w-0 items-center gap-1 text-[#454440] hover:text-[#1a1918] ${
          isGalleryCard ? "text-xs" : "text-[13px]"
        }`}
        href={project.url}
        rel="noreferrer"
        target="_blank"
        title={project.url}
      >
        <span className="min-w-0 truncate">{project.url}</span>
        <ArrowUpRight className="shrink-0" size={13} />
      </a>
    </section>
  ) : null;

  const keywordsSection = project.keyword?.length ? (
    <section className="min-w-0">
      <h3 className={sectionHeadingClass}>{text.keywords}</h3>
      <CompactProjectTags
        items={project.keyword}
        kind="keyword"
        language={language}
        onShowAll={() => onOpenDialog({ kind: "keyword", items: project.keyword ?? [] })}
        showAllLabel={`${text.showAll} ${text.keywords.toLowerCase()}`}
        variant={isGalleryCard ? "gallery" : "github"}
      />
    </section>
  ) : null;

  const latestReleaseSection = latestRelease ? (
    <section className="min-w-0">
      <h3 className={sectionHeadingClass}>{text.latestRelease}</h3>
      <div
        className={`mt-0.5 flex items-center gap-1.5 ${
          isGalleryCard ? "min-w-0 flex-nowrap" : "flex-wrap"
        }`}
      >
        <span
          className={`font-medium text-[#1a1918] ${
            isGalleryCard ? "min-w-0 flex-1 truncate text-[11px]" : "text-sm"
          }`}
          title={latestRelease.title || latestRelease.version}
        >
          {latestRelease.title || latestRelease.version}
        </span>
        {latestRelease.release !== "none" && (
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
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
  ) : null;

  const contributorsSection = project.contributors?.length ? (
    <section className="min-w-0">
      <h3 className={sectionHeadingClass}>{text.contributors}</h3>
      <div
        className={`mt-1 flex min-w-0 items-center gap-1 font-medium text-[#1a1918] ${
          isGalleryCard ? "text-[10px]" : "text-xs"
        }`}
      >
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
  ) : null;

  const frameworksSection = project.framework?.length ? (
    <section className="min-w-0">
      <h3 className={sectionHeadingClass}>{text.frameworks}</h3>
      <CompactProjectTags
        items={project.framework}
        kind="framework"
        language={language}
        onShowAll={() => onOpenDialog({ kind: "framework", items: project.framework ?? [] })}
        showAllLabel={`${text.showAll} ${text.frameworks.toLowerCase()}`}
        variant={isGalleryCard ? "gallery" : "github"}
      />
    </section>
  ) : null;

  const hasLeftColumn = Boolean(
    project.url || latestRelease || project.contributors?.length,
  );
  const hasRightColumn = Boolean(project.keyword?.length || project.framework?.length);
  const useGalleryColumns =
    isGalleryCard && hasLeftColumn && hasRightColumn;

  return (
    <aside
      className={
        isGalleryCard
          ? "h-full min-w-0 overflow-hidden p-1.5"
          : "h-fit min-w-0"
      }
    >
      <h2
        className={`font-semibold text-[#1a1918] ${
          isGalleryCard ? "text-[11px]" : "text-sm"
        }`}
      >
        {text.about}
      </h2>
      <div
        className={
          isGalleryCard
            ? `mt-0.5 ${
                useGalleryColumns
                  ? "grid grid-cols-2 items-start gap-x-2"
                  : "flex flex-col gap-y-0.5"
              }`
            : "mt-3 space-y-3"
        }
      >
        {useGalleryColumns ? (
          <>
            <div className="flex min-w-0 flex-col gap-y-0.5">
              {websiteSection}
              {latestReleaseSection}
              {contributorsSection}
            </div>
            <div className="flex min-w-0 flex-col gap-y-0.5">
              {keywordsSection}
              {frameworksSection}
            </div>
          </>
        ) : (
          <>
            {websiteSection}
            {keywordsSection}
            {latestReleaseSection}
            {contributorsSection}
            {frameworksSection}
          </>
        )}
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

  const hasMedia = Boolean(project.primary_media || project.media.length > 0);
  const hasMetadata = hasProjectMetadata(project);

  return (
    <>
    <article className="project-detail mx-auto w-full max-w-none px-0 pb-20 pt-3 md:px-5 md:pt-5 lg:-mt-2 lg:pt-0">
      <header className="border-b-0 pb-0 lg:border-b lg:border-[#e6e5e3] lg:pb-1">
        <div className="flex flex-col gap-0 lg:flex-row lg:items-end lg:justify-between lg:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <h1 className="text-[26px] font-bold tracking-tight text-[#1a1918] sm:text-[32px] lg:leading-none">
              {project.name}
            </h1>
            {project.visibility && (
              <span className="inline-flex items-center rounded-full border border-[#e6e5e3] bg-white px-2 py-0.5 text-[11px] font-medium text-[#76777c]">
                {project.visibility}
              </span>
            )}
          </div>
          <dl className="-mt-1 flex items-center gap-1 text-xs text-[#76777c] lg:hidden">
            <div className="flex items-center gap-1">
              <dt>{text.created}</dt>
              <dd className="text-[#454440]">
                <time dateTime={project.created_at}>
                  {dateLabel(project.created_at, language)}
                </time>
                <span aria-hidden="true">-</span>
                {project.completed_at ? (
                  <time dateTime={project.completed_at}>
                    {dateLabel(project.completed_at, language)}
                  </time>
                ) : (
                  text.ongoing
                )}
              </dd>
            </div>
          </dl>
          <dl className="hidden flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[#76777c] lg:flex lg:justify-end">
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
        className={`mt-2 grid grid-cols-1 items-start gap-6 lg:mt-6 ${
          hasMedia
            ? "lg:grid-cols-[minmax(0,690px)_minmax(280px,1fr)]"
            : ""
        }`}
      >
        {(hasMedia || hasMetadata) && (
          <MediaGallery
            key={project.id}
            language={language}
            onOpenDialog={setDialog}
            project={project}
          />
        )}
        {hasMetadata && (
          <div className="hidden lg:block">
            <ProjectMetadata
              language={language}
              onOpenDialog={setDialog}
              project={project}
            />
          </div>
        )}
      </div>

      <section
        className={`mt-4 pb-3 ${
          project.changelogs.length > 0 ? "border-b border-[#e6e5e3]" : ""
        }`}
      >
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
