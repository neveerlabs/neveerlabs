import { useEffect } from "react";
import { Play, X } from "lucide-react";
import { createPortal } from "react-dom";

const videoExtensions = [".mp4", ".webm", ".mov", ".m4v"];

export function isVideoMedia(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0].toLowerCase();
  return videoExtensions.some((extension) => path.endsWith(extension));
}

export function isImageMedia(url: string): boolean {
  return !isVideoMedia(url);
}

export function MediaThumbnail({
  url,
  className = "",
  controls = false,
  onImageClick,
}: {
  url: string;
  className?: string;
  controls?: boolean;
  onImageClick?: () => void;
}) {
  if (isVideoMedia(url)) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <video
          aria-label="Project video"
          className="h-full w-full object-cover"
          controls={controls}
          muted={!controls}
          playsInline
          preload="metadata"
          src={controls ? url : `${url}#t=0.5`}
        />
        {!controls && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-3 flex size-8 items-center justify-center rounded-full border border-white/50 bg-black/45 text-white backdrop-blur-sm"
          >
            <Play size={14} fill="currentColor" />
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      alt="Project preview"
      className={`h-full w-full object-cover ${onImageClick ? "cursor-zoom-in" : ""} ${className}`}
      loading="lazy"
      onClick={onImageClick}
      src={url}
    />
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
