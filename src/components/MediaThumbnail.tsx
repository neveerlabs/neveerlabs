import { useCallback, useEffect, useRef } from "react";
import { Play } from "lucide-react";
import { createPortal } from "react-dom";

const videoExtensions = [".mp4", ".webm", ".mov", ".m4v"];

export function isVideoMedia(url: string): boolean {
  const [path, ...fragments] = url.toLowerCase().split("#");
  const pathWithoutQuery = path.split("?", 1)[0];
  return videoExtensions.some((extension) =>
    pathWithoutQuery.endsWith(extension) ||
    fragments.some((fragment) => fragment.split("?", 1)[0].endsWith(extension)),
  );
}

export function isImageMedia(url: string): boolean {
  return !isVideoMedia(url);
}

export function MediaThumbnail({
  url,
  className = "",
  controls = false,
  centerPlayIcon = false,
  fit = "cover",
  contentClassName = "",
  onPreviewClick,
}: {
  url: string;
  className?: string;
  controls?: boolean;
  centerPlayIcon?: boolean;
  fit?: "cover" | "contain";
  contentClassName?: string;
  onPreviewClick?: () => void;
}) {
  const frameClassName = fit === "contain"
    ? `relative flex max-w-full items-center justify-center overflow-hidden ${className}`
    : `relative overflow-hidden ${className}`;
  const mediaClassName = fit === "contain"
    ? `block max-h-[min(75vh,720px)] max-w-full object-contain ${contentClassName}`
    : `h-full w-full object-cover object-center ${contentClassName}`;

  if (isVideoMedia(url)) {
    const videoPreview = (
      <>
        <video
          aria-label="Project video"
          className={mediaClassName}
          controls={controls}
          muted={!controls}
          playsInline
          preload="metadata"
          src={controls ? url : `${url}#t=0.5`}
        />
        {!controls && (
          <span
            aria-hidden="true"
            className={
              onPreviewClick
                ? "pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10"
                : centerPlayIcon
                  ? "pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10"
                  : "pointer-events-none absolute right-3 top-3 flex size-8 items-center justify-center rounded-full border border-white/50 bg-black/45 text-white backdrop-blur-sm"
            }
          >
            <span
              className={
                onPreviewClick
                  ? "flex size-11 items-center justify-center rounded-full border border-white/60 bg-black/50 text-white shadow-lg backdrop-blur-sm"
                  : centerPlayIcon
                    ? "flex size-7 items-center justify-center rounded-full border border-white/60 bg-black/50 text-white shadow-lg backdrop-blur-sm"
                    : ""
              }
            >
              <Play fill="currentColor" size={onPreviewClick ? 18 : 14} />
            </span>
          </span>
        )}
      </>
    );
    if (onPreviewClick && !controls) {
      return (
        <button
          aria-label="Preview project video"
          className={`${frameClassName} cursor-zoom-in bg-transparent p-0 text-left`}
          onClick={onPreviewClick}
          type="button"
        >
          {videoPreview}
        </button>
      );
    }
    return <div className={frameClassName}>{videoPreview}</div>;
  }

  const image = (
    <img
      alt="Project preview"
      className={`${mediaClassName} ${onPreviewClick ? "cursor-zoom-in" : ""} ${fit === "cover" ? className : ""}`}
      loading="lazy"
      onClick={onPreviewClick}
      src={url}
    />
  );
  return fit === "contain" ? (
    <div className={frameClassName}>{image}</div>
  ) : (
    image
  );
}

export function MediaLightbox({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt: string;
  onClose: () => void;
}) {
  const historyEntryRef = useRef(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const closeLightbox = useCallback(() => {
    if (historyEntryRef.current) {
      if (closingRef.current) return;
      closingRef.current = true;
      window.history.back();
      return;
    }

    onCloseRef.current();
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      const isMediaLightboxState =
        typeof state === "object" &&
        state !== null &&
        "neverlabsMediaLightbox" in state &&
        state.neverlabsMediaLightbox === true;
      const isMediaLightboxReturnState =
        typeof state === "object" &&
        state !== null &&
        "neverlabsMediaLightboxReturn" in state &&
        state.neverlabsMediaLightboxReturn === true;

      if (
        !historyEntryRef.current &&
        !isMediaLightboxState &&
        !isMediaLightboxReturnState
      ) {
        return;
      }

      historyEntryRef.current = isMediaLightboxState;
      if (isMediaLightboxReturnState) {
        const nextState = { ...state };
        delete nextState.neverlabsMediaLightboxReturn;
        window.history.replaceState(nextState, "", window.location.href);
        closingRef.current = false;
        onCloseRef.current();
      }
      event.stopImmediatePropagation();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLightbox();
    };

    window.addEventListener("popstate", handlePopState, true);
    document.addEventListener("keydown", handleKeyDown);
    if (!historyEntryRef.current) {
      const currentState = window.history.state;
      const currentHistoryState =
        typeof currentState === "object" && currentState !== null
          ? currentState
          : {};
      window.history.replaceState(
        { ...currentHistoryState, neverlabsMediaLightboxReturn: true },
        "",
        window.location.href,
      );
      window.history.pushState(
        { ...currentHistoryState, neverlabsMediaLightbox: true },
        "",
        window.location.href,
      );
      historyEntryRef.current = true;
    }

    return () => {
      window.removeEventListener("popstate", handlePopState, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeLightbox]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-0"
      onClick={closeLightbox}
      role="presentation"
    >
      <section
        aria-label="Media preview"
        aria-modal="true"
        className="relative flex h-full w-full items-center justify-center"
        role="dialog"
      >
        {isVideoMedia(url) ? (
          <video
            aria-label={alt || "Video preview"}
            autoPlay
            className="max-h-full max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
            controls
            controlsList="nofullscreen"
            playsInline
            preload="metadata"
            src={url}
          />
        ) : (
          <img
            alt={alt}
            className="max-h-full max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
            src={url}
          />
        )}
      </section>
    </div>,
    document.body,
  );
}
