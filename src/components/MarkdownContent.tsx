import { useState } from "react";
import type { CSSProperties } from "react";
import { Play } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { Root, RootContent } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { isVideoMedia, MediaLightbox } from "./MediaThumbnail";

const cssLength =
  /^(?:0|(?:\d{1,4}(?:\.\d{1,2})?)(?:px|%|em|rem|vw|vh))$/i;
const namedColors = new Set([
  "aqua",
  "black",
  "blue",
  "fuchsia",
  "gray",
  "green",
  "grey",
  "lime",
  "maroon",
  "navy",
  "olive",
  "orange",
  "purple",
  "red",
  "silver",
  "teal",
  "transparent",
  "white",
  "yellow",
]);

function isSafeLength(value: string, allowAuto = false): boolean {
  const normalized = value.trim().toLowerCase();
  if (allowAuto && ["auto", "fit-content", "max-content", "min-content"].includes(normalized)) {
    return true;
  }
  if (!cssLength.test(normalized)) return false;

  const amount = Number.parseFloat(normalized);
  const unit = normalized.match(/[a-z%]+$/)?.[0];
  const maximum = unit === "px" ? 4096 : 100;
  return amount <= maximum;
}

function isPercentage(value: CSSProperties["width"]): value is string {
  return typeof value === "string" && /^\d+(?:\.\d+)?%$/.test(value);
}

function isSafeColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    namedColors.has(normalized) ||
    /^#[\da-f]{3,8}$/i.test(normalized) ||
    /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%/+()-]+\)$/i.test(normalized)
  );
}

function isSafeMargin(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return (
    parts.length <= 4 &&
    parts.every((part) => part === "auto" || isSafeLength(part))
  );
}

function getMarginStyles(
  style: CSSProperties,
): Pick<
  CSSProperties,
  "marginBottom" | "marginLeft" | "marginRight" | "marginTop"
> {
  const parts =
    style.margin === undefined ? [] : String(style.margin).trim().split(/\s+/);
  const [top, right = top, bottom = top, left = right] = parts;

  return {
    marginBottom: style.marginBottom ?? bottom,
    marginLeft: style.marginLeft ?? left,
    marginRight: style.marginRight ?? right,
    marginTop: style.marginTop ?? top,
  };
}

const safeStyleValues: Record<string, (value: string) => boolean> = {
  "background-color": isSafeColor,
  color: isSafeColor,
  display: (value) => ["block", "inline", "inline-block"].includes(value),
  float: (value) => ["left", "right", "none"].includes(value),
  "font-size": (value) => isSafeLength(value) && Number.parseFloat(value) <= 96,
  "font-style": (value) => ["normal", "italic", "oblique"].includes(value),
  "font-weight": (value) =>
    ["normal", "bold", "bolder", "lighter"].includes(value) || /^[1-9]00$/.test(value),
  height: (value) => isSafeLength(value, true),
  "line-height": (value) =>
    isSafeLength(value, true) ||
    (/^(?:\d+(?:\.\d{1,2})?)$/.test(value) && Number.parseFloat(value) <= 4),
  margin: isSafeMargin,
  "margin-bottom": (value) => value === "auto" || isSafeLength(value),
  "margin-left": (value) => value === "auto" || isSafeLength(value),
  "margin-right": (value) => value === "auto" || isSafeLength(value),
  "margin-top": (value) => value === "auto" || isSafeLength(value),
  "max-height": (value) => isSafeLength(value),
  "max-width": (value) => isSafeLength(value),
  "min-height": (value) => isSafeLength(value),
  "min-width": (value) => isSafeLength(value),
  "object-fit": (value) =>
    ["contain", "cover", "fill", "none", "scale-down"].includes(value),
  "object-position": (value) =>
    /^(?:(?:left|center|right|top|bottom|\d+(?:\.\d+)?%)(?:\s+|$)){1,2}$/i.test(value),
  padding: (value) =>
    value
      .trim()
      .split(/\s+/)
      .every((part) => isSafeLength(part)),
  "padding-bottom": (value) => isSafeLength(value),
  "padding-left": (value) => isSafeLength(value),
  "padding-right": (value) => isSafeLength(value),
  "padding-top": (value) => isSafeLength(value),
  "text-align": (value) =>
    ["center", "end", "justify", "left", "right", "start"].includes(value),
  "text-decoration": (value) =>
    ["line-through", "none", "overline", "underline"].includes(value),
  "vertical-align": (value) =>
    ["baseline", "bottom", "middle", "sub", "super", "text-bottom", "text-top", "top"].includes(value),
  width: (value) => isSafeLength(value, true),
};

function sanitizeStyleAttribute(style: string): string {
  return style
    .split(";")
    .flatMap((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 1) return [];

      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim().toLowerCase();
      const validate = safeStyleValues[property];
      return validate?.(value) ? [`${property}: ${value}`] : [];
    })
    .join("; ");
}

function sanitizeInlineStyles(node: Root | RootContent): void {
  if (node.type === "element") {
    const style = typeof node.properties.style === "string" ? node.properties.style : "";
    const alignment =
      node.tagName === "img" || node.tagName === "video"
        ? node.properties.align
        : undefined;
    const alignmentStyle =
      alignment === "center"
        ? "display: block; margin-left: auto; margin-right: auto"
        : alignment === "left" || alignment === "right"
          ? `float: ${alignment}`
          : "";

    if (alignment !== undefined) {
      delete node.properties.align;
    }

    const combinedStyle = [style, alignmentStyle].filter(Boolean).join("; ");
    if (combinedStyle) {
      const safeStyle = sanitizeStyleAttribute(combinedStyle);
      if (safeStyle) {
        node.properties.style = safeStyle;
      } else {
        delete node.properties.style;
      }
    } else if (node.properties.style !== undefined) {
      delete node.properties.style;
    }
  }

  if ("children" in node) {
    node.children.forEach(sanitizeInlineStyles);
  }
}

const rehypeSafeStyles = () => (tree: Root) => sanitizeInlineStyles(tree);
const safeHtmlSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "style"],
    img: [...(defaultSchema.attributes?.img ?? []), "style"],
    video: ["src", "poster", "width", "height", "style"],
  },
  protocols: {
    ...defaultSchema.protocols,
    poster: ["http", "https"],
  },
  strip: [...(defaultSchema.strip ?? []), "style", "iframe", "object", "embed"],
  tagNames: [...(defaultSchema.tagNames ?? []), "figcaption", "figure", "video"],
};

function MarkdownMedia({
  alt,
  height,
  poster,
  src,
  style,
  width,
}: {
  alt: string;
  height?: number | string;
  poster?: string;
  src: string;
  style?: CSSProperties;
  width?: number | string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isVideo = isVideoMedia(src);
  const previewLabel = alt || (isVideo ? "video" : "image");
  const mediaWidth = style?.width ?? width;
  const mediaHeight = style?.height ?? height;
  const maxHeight =
    style?.maxHeight ?? (mediaHeight === undefined ? "360px" : undefined);
  const mediaWidthStyle = isPercentage(mediaWidth) ? "100%" : mediaWidth;
  const mediaHeightStyle = isPercentage(mediaHeight) ? "100%" : mediaHeight;
  const mediaMaxWidth = isPercentage(style?.maxWidth)
    ? "100%"
    : style?.maxWidth ?? "100%";
  const mediaMaxHeight = isPercentage(style?.maxHeight)
    ? "100%"
    : maxHeight;
  const hasAutoHorizontalMargin =
    style?.marginLeft === "auto" ||
    style?.marginRight === "auto" ||
    (typeof style?.margin === "string" &&
      /^(?:auto(?:\s+0)?|(?:0\s+)?auto(?:\s+0)?)$/.test(
        style.margin.trim(),
      ));
  const buttonStyle: CSSProperties = {
    display: style?.display ?? (hasAutoHorizontalMargin ? "block" : undefined),
    float: style?.float,
    height: mediaHeight,
    ...getMarginStyles(style ?? {}),
    maxHeight: style?.maxHeight,
    maxWidth: style?.maxWidth ?? "100%",
    verticalAlign: style?.verticalAlign,
    width: mediaWidth ?? (hasAutoHorizontalMargin ? "fit-content" : undefined),
  };
  const mediaStyle: CSSProperties = {
    height: mediaHeightStyle,
    maxHeight: mediaMaxHeight,
    maxWidth: mediaMaxWidth,
    objectFit: style?.objectFit ?? "contain",
    objectPosition: style?.objectPosition,
    width: mediaWidthStyle,
  };

  return (
    <>
      <button
        aria-label={`Preview ${previewLabel}`}
        className="my-4 inline-flex max-w-full cursor-zoom-in rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4774ed]"
        onClick={() => setIsOpen(true)}
        style={buttonStyle}
        type="button"
      >
        {isVideo ? (
          <span
            className="relative inline-flex max-w-full overflow-hidden rounded-lg border border-[#e6e5e3] bg-[#f3f2ef]"
            style={{
              height: mediaHeightStyle,
              maxHeight: mediaMaxHeight,
              maxWidth: mediaMaxWidth,
              width: mediaWidthStyle,
            }}
          >
            <video
              aria-label={previewLabel}
              className="block max-w-full"
              muted
              playsInline
              preload="metadata"
              poster={poster}
              src={`${src}#t=0.5`}
              style={mediaStyle}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10"
            >
              <span className="flex size-11 items-center justify-center rounded-full border border-white/60 bg-black/50 text-white shadow-lg backdrop-blur-sm">
                <Play fill="currentColor" size={18} />
              </span>
            </span>
          </span>
        ) : (
          <img
            alt={alt}
            className="block h-auto max-w-full w-auto rounded-lg border border-[#e6e5e3]"
            loading="lazy"
            src={src}
            style={mediaStyle}
          />
        )}
      </button>
      {isOpen && (
        <MediaLightbox
          alt={previewLabel}
          onClose={() => setIsOpen(false)}
          url={src}
        />
      )}
    </>
  );
}

const components: Components = {
  a: ({ children, href }) => {
    if (href && isVideoMedia(href) && typeof children === "string") {
      return <MarkdownMedia alt={children} src={href} />;
    }

    return (
      <a className="font-medium text-[#4774ed] underline decoration-[#b8c8f7] underline-offset-2 hover:decoration-[#4774ed]" href={href}>
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-[#d8d7d4] pl-4 text-[#76777c]">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code
      className={
        className
          ? "font-mono text-[0.9em]"
          : "rounded bg-[#f0efed] px-1.5 py-0.5 font-mono text-[0.9em] text-[#3d3c39]"
      }
    >
      {children}
    </code>
  ),
  del: ({ children }) => <del className="text-[#76777c]">{children}</del>,
  h1: ({ children }) => (
    <h1 className="mb-4 mt-8 border-b border-[#e6e5e3] pb-2 text-3xl font-semibold tracking-tight text-[#1a1918] first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-4 mt-8 border-b border-[#e6e5e3] pb-2 text-2xl font-semibold tracking-tight text-[#1a1918] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-3 mt-6 text-xl font-semibold tracking-tight text-[#1a1918] first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-5 text-lg font-semibold text-[#1a1918] first:mt-0">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-2 mt-4 text-base font-semibold text-[#1a1918] first:mt-0">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-2 mt-4 text-sm font-semibold text-[#76777c] first:mt-0">
      {children}
    </h6>
  ),
  hr: () => <hr className="my-6 border-0 border-t border-[#e6e5e3]" />,
  img: ({ alt, height, src, style, width }) =>
    src ? (
      <MarkdownMedia
        alt={alt ?? ""}
        height={height}
        src={src}
        style={style}
        width={width}
      />
    ) : null,
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input
        aria-label="Task"
        checked={Boolean(checked)}
        className="mr-2 accent-[#4774ed]"
        disabled
        readOnly
        type="checkbox"
      />
    ) : null,
  li: ({ children, style }) => <li style={style}>{children}</li>,
  ol: ({ children, style }) => (
    <ol className="my-4 list-decimal space-y-1 pl-6" style={style}>
      {children}
    </ol>
  ),
  p: ({ children }) => (
    <p className="my-4 leading-7 text-[#454440] first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  pre: ({ children }) => (
    <pre className="my-5 overflow-x-auto rounded-lg border border-[#e6e5e3] bg-[#f6f8fa] p-4 leading-6">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  video: ({ height, poster, src, style, width }) =>
    src && isVideoMedia(src) ? (
      <MarkdownMedia
        alt="video"
        height={height}
        poster={poster}
        src={src}
        style={style}
        width={width}
      />
    ) : null,
  th: ({ children }) => (
    <th className="border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 font-semibold text-[#1a1918]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[#d0d7de] px-3 py-2 text-[#454440]">{children}</td>
  ),
  ul: ({ children, className, style }) => {
    const isTaskList = className?.split(/\s+/).includes("contains-task-list");
    return (
      <ul
        className={`my-4 space-y-1 ${isTaskList ? "list-none pl-0" : "list-disc pl-6"}`}
        style={style}
      >
        {children}
      </ul>
    );
  },
};

export function MarkdownContent({ source }: { source: string }) {
  return (
    <div className="min-w-0 break-words text-[15px] leading-7 text-[#454440] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        components={components}
        rehypePlugins={[
          rehypeRaw,
          rehypeSafeStyles,
          [rehypeSanitize, safeHtmlSchema],
        ]}
        remarkPlugins={[remarkGfm]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
