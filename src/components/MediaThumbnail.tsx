import { useEffect } from "react";
import { Play, X } from "lucide-react";
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
  onPreviewClick,
}: {
  url: string;
  className?: string;
  controls?: boolean;
  centerPlayIcon?: boolean;
  fit?: "cover" | "contain";
  onPreviewClick?: () => void;
}) {
  const frameClassName = fit === "contain"
    ? `relative flex max-w-full items-center justify-center overflow-hidden ${className}`
    : `relative overflow-hidden ${className}`;
  const mediaClassName = fit === "contain"
    ? "block max-h-[min(75vh,720px)] max-w-full object-contain"
    : "h-full w-full object-cover object-center";

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
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-label="Media preview"
        aria-modal="true"
        className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button
          aria-label="Close media preview"
          autoFocus
          className="absolute -right-2 -top-2 z-10 rounded-full bg-white/15 p-2 text-white transition-colors hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-2 sm:top-2"
          onClick={onClose}
          type="button"
        >
          <X size={22} />
        </button>
        {isVideoMedia(url) ? (
          <video
            aria-label={alt || "Video preview"}
            autoPlay
            className="max-h-[90vh] max-w-[90vw] object-contain"
            controls
            controlsList="nofullscreen"
            playsInline
            preload="metadata"
            src={url}
          />
        ) : (
          <img
            alt={alt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            src={url}
          />
        )}
      </section>
    </div>,
    document.body,
  );
}
