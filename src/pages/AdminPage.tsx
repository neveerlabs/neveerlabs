import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CloudUpload,
  Code2,
  Copy,
  FileImage,
  Folder,
  FolderKanban,
  GitCommitHorizontal,
  ImagePlus,
  LoaderCircle,
  Lock,
  LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  Language,
  LocalizedText,
  Project,
  ProjectChangelog,
  ProjectContributor,
  ProjectPlatform,
} from "../types/projects";
import { MarkdownContent } from "../components/MarkdownContent";
import { isVideoMedia } from "../components/MediaThumbnail";
import "./AdminPage.css";

type TableName = "projects" | "project_changelogs" | "contributors";
type SectionName = "projects" | "changelogs" | "contributors" | "media";
type Operation = "insert" | "update" | "delete";
type ProjectRow = Omit<Project, "changelogs">;
type ProjectDraft = Omit<ProjectRow, "id"> & { id?: string };
type ChangelogDraft = Omit<ProjectChangelog, "id"> & { id?: string };
type ContributorDraft = Omit<ProjectContributor, "id"> & { id?: string };
type ContributorReference = {
  project: ProjectRow;
  projectAssigned: boolean;
  changelogs: ProjectChangelog[];
};
type DraftRecord = ProjectDraft | ChangelogDraft | ContributorDraft;

interface VisibleRow {
  key: string;
  record: ProjectRow | ProjectChangelog | ProjectContributor | DraftRecord;
  operation?: Operation;
}

function createUuid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function storageObjectPath(value: string | null): string | null {
  if (!value) return null;
  try {
    const pathname = new URL(value).pathname;
    const prefix = "/storage/v1/object/public/project-media/";
    const prefixIndex = pathname.indexOf(prefix);
    if (prefixIndex < 0) return null;
    return pathname
      .slice(prefixIndex + prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

function storagePathsInText(value: string): Set<string> {
  const paths = new Set<string>();
  const urls = value.match(/https?:\/\/[^\s<>"'`)\]]+/g) ?? [];
  for (const rawUrl of urls) {
    const path = storageObjectPath(rawUrl.replace(/[.,!?;:]+$/, ""));
    if (path) paths.add(path);
  }
  return paths;
}

function localizedStoragePaths(value: LocalizedText): Set<string> {
  return new Set(
    Object.values(value).flatMap((text) => [...storagePathsInText(text)]),
  );
}

function removeStorageReferencesFromText(value: string, targetPath: string): string {
  const urls = value.match(/https?:\/\/[^\s<>"'`)\]]+/g) ?? [];
  let next = value;
  for (const rawUrl of urls) {
    const url = rawUrl.replace(/[.,!?;:]+$/, "");
    if (storageObjectPath(url) !== targetPath) continue;
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const destination = `(?:<${escapedUrl}>|${escapedUrl})`;
    const title = `(?:\\s+(?:"[^"]*"|'[^']*'))?`;
    const referenceLabels: string[] = [];
    const definition = new RegExp(
      `^\\s*\\[([^\\]]+)\\]:\\s*${destination}${title}\\s*$`,
      "gim",
    );
    next = next.replace(definition, (_match, label: string) => {
      referenceLabels.push(label);
      return "";
    });
    if (referenceLabels.length > 0) {
      const labels = referenceLabels
        .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      next = next
        .replace(new RegExp(`!\\[[^\\]]*\\]\\[(${labels})\\]`, "gi"), "")
        .replace(new RegExp(`\\[([^\\]]+)\\]\\[(${labels})\\]`, "gi"), "$1")
        .replace(new RegExp(`!\\[(${labels})\\]`, "gi"), "")
        .replace(new RegExp(`\\[(${labels})\\]`, "gi"), "$1");
    }
    next = next
      .replace(
        new RegExp(`<img\\b(?=[^>]*\\bsrc\\s*=\\s*(?:"${escapedUrl}"|'${escapedUrl}'|${escapedUrl}))[^>]*>`, "gi"),
        "",
      )
      .replace(
        new RegExp(`!\\[[^\\]]*\\]\\(\\s*${destination}${title}\\s*\\)`, "g"),
        "",
      )
      .replace(
        new RegExp(`\\[([^\\]]+)\\]\\(\\s*${destination}${title}\\s*\\)`, "g"),
        "$1",
      )
      .replace(new RegExp(escapedUrl, "g"), "")
      .replace(/<\s*>/g, "")
      .replace(/!?\[\]\(\s*\)/g, "");
  }
  return next;
}

function removeLocalizedStorageReferences(
  value: LocalizedText,
  targetPath: string,
): LocalizedText {
  return {
    en: removeStorageReferencesFromText(value.en, targetPath),
    zh: removeStorageReferencesFromText(value.zh, targetPath),
  };
}

function projectAttachedStoragePaths(
  project: Pick<ProjectRow, "primary_media" | "media">,
): Set<string> {
  return new Set([
    ...[project.primary_media, ...(project.media ?? [])]
      .map(storageObjectPath)
      .filter((path): path is string => path !== null),
  ]);
}

function projectStoragePaths(
  project: Pick<ProjectRow, "primary_media" | "media" | "description">,
): Set<string> {
  return new Set([
    ...projectAttachedStoragePaths(project),
    ...localizedStoragePaths(project.description),
  ]);
}

function projectUsesStorageMedia(
  project: Pick<ProjectRow, "primary_media" | "media" | "description"> & { id?: string },
  path: string,
  changelogs: Array<Pick<ProjectChangelog, "project_id" | "description">> = [],
): boolean {
  return projectStoragePaths(project).has(path) || (
    Boolean(project.id) &&
    changelogs.some(
      (changelog) =>
        changelog.project_id === project.id &&
        localizedStoragePaths(changelog.description).has(path),
    )
  );
}

function allProjectStoragePaths(
  projects: Array<Pick<ProjectRow, "primary_media" | "media" | "description">>,
  changelogs: Array<Pick<ProjectChangelog, "description">>,
): Set<string> {
  return new Set([
    ...projects.flatMap((project) => [...projectStoragePaths(project)]),
    ...changelogs.flatMap((changelog) => [
      ...localizedStoragePaths(changelog.description),
    ]),
  ]);
}

function removedProjectStoragePaths(
  beforeProjects: Array<Pick<ProjectRow, "primary_media" | "media" | "description">>,
  afterProjects: Array<Pick<ProjectRow, "primary_media" | "media" | "description">>,
  beforeChangelogs: Array<Pick<ProjectChangelog, "description">>,
  afterChangelogs: Array<Pick<ProjectChangelog, "description">>,
): Set<string> {
  const remaining = allProjectStoragePaths(afterProjects, afterChangelogs);
  return new Set(
    [...allProjectStoragePaths(beforeProjects, beforeChangelogs)]
      .filter((path) => !remaining.has(path)),
  );
}

type DeleteTarget = { table: TableName; row: VisibleRow };

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

interface StagedChange {
  table: TableName;
  operation: Operation;
  key: string;
  id?: string;
  record?: DraftRecord;
  label: string;
}

interface PendingUpload {
  file: File;
  path: string;
  publicUrl: string;
  contentType: string;
}

interface MediaItem {
  name: string;
  path: string;
  type: "folder" | "file";
  size: number | null;
  contentType: string | null;
  publicUrl: string | null;
}

interface MediaResponse {
  items: MediaItem[];
  nextOffset: number | null;
}

type StorageMediaFile = MediaItem & {
  type: "file";
  publicUrl: string;
};

type AdminRequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

const pendingPrefix = "__neverlabs_pending_upload__:";
const acceptedMedia = ".jpg,.jpeg,.png,.gif,.webp,.avif,.mp4,.mov,.m4v,.webm";
const platforms: ProjectPlatform[] = [
  "web",
  "mobile application",
  "desktop application",
  "cli",
  "other",
];
const releaseValues: ProjectChangelog["release"][] = [
  "latest",
  "pre-release",
  "none",
];

async function adminRequest<T>(
  path: string,
  options: AdminRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, {
    ...options,
    headers,
    body,
    credentials: "same-origin",
  });
  const result = (await response.json()) as { error?: string } & T;
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("neverlabs-admin-locked"));
    }
    throw new Error(result.error ?? `Admin request failed (${response.status}).`);
  }
  return result;
}

async function clearAdminSession(): Promise<void> {
  const response = await fetch("/api/admin/logout", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
  });
  if (!response.ok) {
    throw new Error(`Unable to lock the admin session (${response.status}).`);
  }
}

function isProjectTable(table: TableName): table is "projects" {
  return table === "projects";
}

function compoundKey(table: TableName, key: string): string {
  return `${table}:${key}`;
}

function getDisplayName(
  table: TableName,
  record: ProjectRow | ProjectChangelog | ProjectContributor | DraftRecord,
): string {
  if (isProjectTable(table)) return (record as ProjectRow | ProjectDraft).name || "Untitled project";
  if (table === "contributors") {
    return (record as ProjectContributor | ContributorDraft).name || "Untitled contributor";
  }
  const changelog = record as ProjectChangelog | ChangelogDraft;
  return `${changelog.title || "Untitled changelog"} ${changelog.version ? `· ${changelog.version}` : ""}`.trim();
}

function isPendingReference(value: string): boolean {
  return value.startsWith(pendingPrefix);
}

function mediaUrl(value: string, pendingUploads: Map<string, PendingUpload>): string {
  if (!isPendingReference(value)) return value;
  return pendingUploads.get(value)?.publicUrl ?? value;
}

function referenceFromInput(
  value: string,
  pendingUploads: Map<string, PendingUpload>,
): string {
  const trimmed = value.trim();
  for (const [reference, pending] of pendingUploads) {
    if (pending.publicUrl === trimmed) return reference;
  }
  return trimmed;
}

function projectDraft(record?: ProjectRow): ProjectDraft {
  return record
    ? {
        ...record,
        description: { ...record.description },
        framework: record.framework,
        keyword: record.keyword,
        contributors: record.contributors,
        media: [...(record.media ?? [])],
      }
    : {
        id: createUuid(),
        name: "",
        visibility: "private",
        platform: "web",
        description: { en: "", zh: "" },
        framework: [],
        keyword: [],
        contributors: [],
        primary_media: null,
        media: [],
        url: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        sort_order: 0,
      };
}

function changelogDraft(record?: ProjectChangelog): ChangelogDraft {
  return record
    ? {
        ...record,
        description: { ...record.description },
        contributors: record.contributors,
        media: [...(record.media ?? [])],
      }
    : {
        id: createUuid(),
        project_id: "",
        title: "",
        version: "",
        release: "latest",
        description: { en: "", zh: "" },
        contributors: [],
        media: [],
        released_at: new Date().toISOString(),
      };
}

function contributorDraft(record?: ProjectContributor): ContributorDraft {
  return record
    ? { ...record }
    : { id: createUuid(), name: "", url: null };
}

function stageKey(change: StagedChange): string {
  return compoundKey(change.table, change.key);
}

function replacePendingReferences<T>(
  value: T,
  uploads: Map<string, PendingUpload>,
): T;
function replacePendingReferences(
  value: unknown,
  uploads: Map<string, PendingUpload>,
): unknown {
  if (typeof value === "string" && isPendingReference(value)) {
    const pending = uploads.get(value);
    if (!pending) throw new Error("A pending media file is no longer available.");
    return pending.publicUrl;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePendingReferences(item, uploads));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replacePendingReferences(item, uploads),
      ]),
    );
  }
  return value;
}

function collectPendingReferences(
  value: unknown,
  uploads: Map<string, PendingUpload>,
  references = new Set<string>(),
): Set<string> {
  if (typeof value === "string") {
    if (isPendingReference(value) && uploads.has(value)) references.add(value);
    for (const [reference, upload] of uploads) {
      if (value.includes(upload.publicUrl)) references.add(reference);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectPendingReferences(item, uploads, references));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) =>
      collectPendingReferences(item, uploads, references),
    );
  }
  return references;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function parseDateTimeInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function copyMediaUrl(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(value);
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      {children}
      {hint && <span className="admin-field-hint">{hint}</span>}
    </label>
  );
}

function useDismissOnOutsideClick<T extends HTMLElement>(
  ref: { current: T | null },
  open: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (ref.current && target instanceof Node && !ref.current.contains(target)) {
        onDismiss();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onDismiss, ref]);
}

function ContributorPicker({
  selected,
  options,
  onChange,
  onCreate,
}: {
  selected: ProjectContributor[];
  options: ProjectContributor[];
  onChange: (contributors: ProjectContributor[]) => void;
  onCreate: (name: string, url: string | null) => ProjectContributor;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useDismissOnOutsideClick(pickerRef, open, () => setOpen(false));

  const toggle = (contributor: ProjectContributor) => {
    const alreadySelected = selected.some((item) => item.id === contributor.id);
    onChange(
      alreadySelected
        ? selected.filter((item) => item.id !== contributor.id)
        : [...selected, contributor],
    );
  };

  const createContributor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      setFormError("Contributor name is required.");
      return;
    }
    if (trimmedUrl && !safeHttpUrl(trimmedUrl)) {
      setFormError("Enter a valid http or https contact URL.");
      return;
    }
    const contributor = onCreate(trimmedName, trimmedUrl || null);
    if (!selected.some((item) => item.id === contributor.id)) {
      onChange([...selected, contributor]);
    }
    setName("");
    setUrl("");
    setFormError("");
    setCreating(false);
  };

  return (
    <div className="admin-field admin-contributor-field">
      <div className="admin-contributor-picker" ref={pickerRef}>
        <button
          aria-controls="admin-contributor-picker-menu"
          aria-expanded={open}
          aria-label={`Contributors${selected.length ? `, ${selected.length} selected` : ""}`}
          className="admin-contributor-picker-trigger"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span>Contributors</span>
          {selected.length > 0 && (
            <span className="admin-contributor-selected-count">{selected.length} selected</span>
          )}
          <ChevronDown size={14} />
        </button>
        {open && (
          <div
            className="admin-contributor-picker-menu"
            id="admin-contributor-picker-menu"
          >
            <div aria-label="Select contributors" className="admin-contributor-options" role="group">
              {options.length ? options.map((contributor) => {
                const isSelected = selected.some((item) => item.id === contributor.id);
                return (
                  <label className="admin-contributor-option" key={contributor.id}>
                    <input
                      checked={isSelected}
                      onChange={() => toggle(contributor)}
                      type="checkbox"
                    />
                    <span>{contributor.name}</span>
                  </label>
                );
              }) : (
                <p className="admin-contributor-empty">No contributors yet.</p>
              )}
            </div>
            {creating ? (
              <form className="admin-contributor-create" onSubmit={createContributor}>
                <input
                  aria-label="New contributor name"
                  autoFocus
                  className="admin-input"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Name"
                  value={name}
                />
                <input
                  aria-label="New contributor contact URL"
                  className="admin-input"
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="Contact URL (optional)"
                  type="url"
                  value={url}
                />
                {formError && <span className="admin-field-error">{formError}</span>}
                <div>
                  <button
                    className="admin-button admin-button-quiet"
                    onClick={() => {
                      setCreating(false);
                      setFormError("");
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="admin-button admin-button-primary" disabled={!name.trim()} type="submit">
                    Add contributor
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="admin-contributor-add-option"
                onClick={() => setCreating(true)}
                type="button"
              >
                <Plus size={14} /> Add new contributor
              </button>
            )}
          </div>
        )}
      </div>
      <span className="admin-field-hint">Select from the shared contributor list.</span>
    </div>
  );
}

function MediaPreview({
  value,
  pendingUploads,
  contentType,
}: {
  value: string;
  pendingUploads: Map<string, PendingUpload>;
  contentType?: string | null;
}) {
  const pending = isPendingReference(value) ? pendingUploads.get(value) : undefined;
  const url = mediaUrl(value, pendingUploads);
  const safeUrl = safeHttpUrl(url);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) {
      setLocalUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(pending.file);
    setLocalUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [pending]);

  const source = localUrl ?? safeUrl;
  if (!source) {
    return <span className="admin-media-invalid"><FileImage size={20} />Invalid media URL</span>;
  }
  const isVideo = pending
    ? pending.contentType.startsWith("video/")
    : contentType?.startsWith("video/") || isVideoMedia(source);
  return isVideo
    ? <video controls preload="metadata" src={source} />
    : <img alt="" loading="lazy" src={source} />;
}

function MarkdownEditor({
  value,
  onChange,
}: {
  value: ProjectDraft["description"];
  onChange: (language: Language, next: string) => void;
}) {
  const [language, setLanguage] = useState<Language>("en");
  const [preview, setPreview] = useState(false);

  return (
    <div className="admin-markdown-field">
      <div className="admin-markdown-toolbar">
        <div className="admin-markdown-languages" aria-label="Description language">
          {(["en", "zh"] as const).map((item) => (
            <button
              aria-pressed={language === item}
              className={language === item ? "active" : ""}
              key={item}
              onClick={() => setLanguage(item)}
              type="button"
            >
              {item === "en" ? "English" : "中文"}
            </button>
          ))}
        </div>
        <button
          aria-pressed={preview}
          className="admin-markdown-mode"
          onClick={() => setPreview((current) => !current)}
          type="button"
        >
          {preview ? <Code2 size={14} /> : <Play size={14} />}
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="admin-markdown-preview">
          {value[language].trim() ? (
            <MarkdownContent source={value[language]} />
          ) : (
            <span className="admin-muted">Nothing to preview yet.</span>
          )}
        </div>
      ) : (
        <textarea
          aria-label={`Description ${language === "en" ? "English" : "Chinese"}`}
          className="admin-markdown-input"
          onChange={(event) => onChange(language, event.target.value)}
          placeholder="Write Markdown…"
          rows={12}
          spellCheck={false}
          value={value[language]}
        />
      )}
    </div>
  );
}

function MediaListEditor({
  label,
  value,
  pendingUploads,
  onChange,
  onBrowse,
}: {
  label: string;
  value: string[];
  pendingUploads: Map<string, PendingUpload>;
  onChange: (value: string[]) => void;
  onBrowse: (onPick: (reference: string) => void) => void;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [urlEditorOpen, setUrlEditorOpen] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const mediaEditorRef = useRef<HTMLDivElement>(null);

  useDismissOnOutsideClick(
    mediaEditorRef,
    urlEditorOpen || removeIndex !== null,
    () => {
      setUrlEditorOpen(false);
      setRemoveIndex(null);
    },
  );

  const addUrl = () => {
    const rawUrl = urlInput.trim();
    if (!safeHttpUrl(rawUrl)) {
      setCopyMessage("Enter a valid raw media URL.");
      return;
    }
    const reference = referenceFromInput(rawUrl, pendingUploads);
    onChange([...value, reference]);
    setUrlInput("");
    setUrlEditorOpen(false);
    setCopyMessage("");
  };
  const browseForMedia = () => {
    onBrowse((reference) => {
      onChange([...value, reference]);
      setUrlInput("");
      setUrlEditorOpen(false);
    });
  };

  return (
    <Field
      label={label}
      hint="Uploads are saved when you commit. Removing a Storage file deletes it after commit only if no other project uses it."
    >
      <div className="admin-media-editor-scope" ref={mediaEditorRef}>
        <div className="admin-media-editor-grid">
          {value.map((item, index) => (
            <div className="admin-media-card" key={`${item}-${index}`}>
              <MediaPreview pendingUploads={pendingUploads} value={item} />
              <div className="admin-media-card-actions">
                <button
                  aria-label="Copy media URL"
                  onClick={() => {
                    void copyMediaUrl(mediaUrl(item, pendingUploads))
                      .then(() => setCopyMessage("URL copied."))
                      .catch(() => setCopyMessage("Unable to copy the URL."));
                  }}
                  title="Copy URL"
                  type="button"
                >
                  <Copy size={14} />
                </button>
                <button
                  aria-label="Remove media"
                  onClick={() => setRemoveIndex(index)}
                  title="Remove media"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {removeIndex === index && (
                <div className="admin-media-card-confirm">
                  <strong>Remove this media?</strong>
                  <div>
                    <button onClick={() => setRemoveIndex(null)} type="button">Cancel</button>
                    <button
                      onClick={() => {
                        onChange(value.filter((_, itemIndex) => itemIndex !== index));
                        setRemoveIndex(null);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="admin-media-empty-slot">
            <span>Add media</span>
            <div>
              <button
                aria-label="Enter media URL"
                onClick={() => {
                  setUrlEditorOpen((open) => !open);
                  setCopyMessage("");
                }}
                title="Enter media URL"
                type="button"
              >
                <Pencil size={15} />
              </button>
              <button
                aria-label="Upload or choose media"
                onClick={browseForMedia}
                title="Upload or choose media"
                type="button"
              >
                <ImagePlus size={16} />
              </button>
            </div>
          </div>
        </div>
        {copyMessage && <span className="admin-field-hint" role="status">{copyMessage}</span>}
        {urlEditorOpen && (
          <div className="admin-media-url-entry">
            <input
              aria-label={`${label} raw media URL`}
              autoFocus
              className="admin-media-url-input"
              onChange={(event) => setUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addUrl();
                }
              }}
              placeholder="https://…/image.png"
              value={urlInput}
            />
            <button aria-label="Add media URL" disabled={!urlInput.trim()} onClick={addUrl} title="Add URL" type="button">
              <Check size={15} />
            </button>
            <button aria-label="Upload media instead" onClick={browseForMedia} title="Upload media" type="button">
              <ImagePlus size={16} />
            </button>
          </div>
        )}
      </div>
    </Field>
  );
}

function SingleMediaEditor({
  label,
  value,
  pendingUploads,
  onChange,
  onBrowse,
}: {
  label: string;
  value: string | null;
  pendingUploads: Map<string, PendingUpload>;
  onChange: (value: string | null) => void;
  onBrowse: (onPick: (reference: string) => void) => void;
}) {
  const [urlEditorOpen, setUrlEditorOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const mediaEditorRef = useRef<HTMLDivElement>(null);

  useDismissOnOutsideClick(
    mediaEditorRef,
    urlEditorOpen || removeConfirm,
    () => {
      setUrlEditorOpen(false);
      setRemoveConfirm(false);
    },
  );

  const addUrl = () => {
    const rawUrl = urlInput.trim();
    if (!safeHttpUrl(rawUrl)) {
      setCopyMessage("Enter a valid raw media URL.");
      return;
    }
    onChange(referenceFromInput(rawUrl, pendingUploads));
    setUrlInput("");
    setUrlEditorOpen(false);
    setCopyMessage("");
  };
  const browseForMedia = () => {
    onBrowse((reference) => {
      onChange(reference);
      setUrlInput("");
      setUrlEditorOpen(false);
    });
  };

  return (
    <Field
      label={label}
      hint="Use a raw file URL or select a file from Storage. Removing it deletes the Storage file after commit only if no other project uses it."
    >
      <div className="admin-media-single-scope" ref={mediaEditorRef}>
        <div className="admin-media-single-preview">
        {value ? (
          <div className="admin-media-card">
            <MediaPreview pendingUploads={pendingUploads} value={value} />
            <div className="admin-media-card-actions">
              <button
                aria-label="Copy media URL"
                onClick={() => {
                  void copyMediaUrl(mediaUrl(value, pendingUploads))
                    .then(() => setCopyMessage("URL copied."))
                    .catch(() => setCopyMessage("Unable to copy the URL."));
                }}
                title="Copy URL"
                type="button"
              >
                <Copy size={14} />
              </button>
              <button aria-label="Remove media" onClick={() => setRemoveConfirm(true)} title="Remove media" type="button">
                <Trash2 size={14} />
              </button>
            </div>
            {removeConfirm && (
              <div className="admin-media-card-confirm">
                <strong>Remove this media?</strong>
                <div>
                  <button onClick={() => setRemoveConfirm(false)} type="button">Cancel</button>
                  <button onClick={() => { onChange(null); setRemoveConfirm(false); }} type="button">Remove</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="admin-media-empty-slot">
            <span>Primary media</span>
            <div>
              <button
                aria-label="Enter primary media URL"
                onClick={() => {
                  setUrlEditorOpen((open) => !open);
                  setCopyMessage("");
                }}
                title="Enter media URL"
                type="button"
              >
                <Pencil size={15} />
              </button>
              <button
                aria-label="Upload or choose primary media"
                onClick={browseForMedia}
                title="Upload or choose media"
                type="button"
              >
                <ImagePlus size={16} />
              </button>
            </div>
          </div>
        )}
        </div>
        {copyMessage && <span className="admin-field-hint" role="status">{copyMessage}</span>}
        {urlEditorOpen && (
          <div className="admin-media-url-entry">
            <input
              aria-label={`${label} raw media URL`}
              autoFocus
              className="admin-media-url-input"
              onChange={(event) => setUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addUrl();
                }
              }}
              placeholder="https://…/image.png"
              value={urlInput}
            />
            <button aria-label="Set media URL" disabled={!urlInput.trim()} onClick={addUrl} title="Use URL" type="button">
              <Check size={15} />
            </button>
            <button aria-label="Upload media instead" onClick={browseForMedia} title="Upload media" type="button">
              <ImagePlus size={16} />
            </button>
          </div>
        )}
      </div>
    </Field>
  );
}

function ProjectEditor({
  initial,
  isNew,
  pendingUploads,
  contributors,
  onChange,
  onBrowseMedia,
  onCreateContributor,
}: {
  initial: ProjectDraft;
  isNew: boolean;
  pendingUploads: Map<string, PendingUpload>;
  contributors: ProjectContributor[];
  onChange: (record: ProjectDraft) => void;
  onBrowseMedia: (onPick: (reference: string) => void) => void;
  onCreateContributor: (name: string, url: string | null) => ProjectContributor;
}) {
  const [record, setRecord] = useState<ProjectDraft>(() => structuredClone(initial));
  const update = (patch: Partial<ProjectDraft>) => {
    const next = { ...record, ...patch };
    setRecord(next);
    onChange(next);
  };
  const updateDescription = (language: Language, value: string) =>
    update({ description: { ...record.description, [language]: value } });

  return (
    <div className="admin-editor">
      <div className="admin-form-section">
        <h3>{isNew ? "New project" : "Project details"}</h3>
        <div className="admin-form-grid">
          <Field label="Project name">
            <input className="admin-input" value={record.name} onChange={(event) => update({ name: event.target.value })} autoFocus />
          </Field>
          <Field label="Visibility">
            <select className="admin-input" value={record.visibility ?? ""} onChange={(event) => update({ visibility: (event.target.value || null) as ProjectDraft["visibility"] })}>
              <option value="private">Private</option>
              <option value="public">Public</option>
              <option value="">Unset</option>
            </select>
          </Field>
          <Field label="Platform">
            <select className="admin-input" value={record.platform ?? ""} onChange={(event) => update({ platform: (event.target.value || null) as ProjectPlatform | null })}>
              <option value="">Unset</option>
              {platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
            </select>
          </Field>
          <Field label="Project URL">
            <input className="admin-input" value={record.url ?? ""} onChange={(event) => update({ url: event.target.value || null })} placeholder="https://..." />
          </Field>
          <Field label="Frameworks" hint="Comma-separated">
            <input className="admin-input" value={record.framework?.join(", ") ?? ""} onChange={(event) => update({ framework: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Keywords" hint="Comma-separated">
            <input className="admin-input" value={record.keyword?.join(", ") ?? ""} onChange={(event) => update({ keyword: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Sort order">
            <input className="admin-input admin-sort-order" type="number" step="1" value={record.sort_order} onChange={(event) => update({ sort_order: Number(event.target.value) })} />
          </Field>
          <Field label="Created at">
            <input className="admin-input" type="datetime-local" value={formatDateTimeInput(record.created_at)} onChange={(event) => update({ created_at: parseDateTimeInput(event.target.value) ?? record.created_at })} />
          </Field>
          <Field label="Completed at">
            <input className="admin-input" type="datetime-local" value={formatDateTimeInput(record.completed_at)} onChange={(event) => update({ completed_at: parseDateTimeInput(event.target.value) })} />
          </Field>
          <ContributorPicker
            selected={record.contributors ?? []}
            options={contributors}
            onChange={(selected) => update({ contributors: selected })}
            onCreate={onCreateContributor}
          />
        </div>
        <Field label="Description">
          <MarkdownEditor value={record.description} onChange={updateDescription} />
        </Field>
      </div>

      <div className="admin-form-section">
        <h3>Media</h3>
        <SingleMediaEditor
          label="Primary media"
          value={record.primary_media}
          pendingUploads={pendingUploads}
          onChange={(primary_media) => update({ primary_media })}
          onBrowse={onBrowseMedia}
        />
        <MediaListEditor
          label="Additional media"
          value={record.media}
          pendingUploads={pendingUploads}
          onChange={(media) => update({ media })}
          onBrowse={onBrowseMedia}
        />
      </div>

    </div>
  );
}

function ChangelogEditor({
  initial,
  isNew,
  projects,
  contributors,
  onChange,
  onCreateContributor,
}: {
  initial: ChangelogDraft;
  isNew: boolean;
  projects: ProjectRow[];
  contributors: ProjectContributor[];
  onChange: (record: ChangelogDraft) => void;
  onCreateContributor: (name: string, url: string | null) => ProjectContributor;
}) {
  const [record, setRecord] = useState<ChangelogDraft>(() => structuredClone(initial));
  const update = (patch: Partial<ChangelogDraft>) => {
    const next = { ...record, ...patch };
    setRecord(next);
    onChange(next);
  };
  const updateDescription = (language: Language, value: string) =>
    update({ description: { ...record.description, [language]: value } });

  return (
    <div className="admin-editor">
      <div className="admin-form-section">
        <h3>{isNew ? "New changelog" : "Release details"}</h3>
        <div className="admin-form-grid">
          <Field label="Project">
            <span>{projects.find((project) => project.id === record.project_id)?.name ?? "Project unavailable"}</span>
          </Field>
          <Field label="Release status">
            <select className="admin-input" value={record.release} onChange={(event) => update({ release: event.target.value as ProjectChangelog["release"] })}>
              {releaseValues.map((release) => <option key={release} value={release}>{release}</option>)}
            </select>
          </Field>
          <Field label="Title">
            <input className="admin-input" value={record.title} onChange={(event) => update({ title: event.target.value })} autoFocus />
          </Field>
          <Field label="Version">
            <input className="admin-input" value={record.version} onChange={(event) => update({ version: event.target.value })} placeholder="v1.0.0" />
          </Field>
          <Field label="Released at">
            <input className="admin-input" type="datetime-local" value={formatDateTimeInput(record.released_at)} onChange={(event) => update({ released_at: parseDateTimeInput(event.target.value) ?? record.released_at })} />
          </Field>
          <ContributorPicker
            selected={record.contributors ?? []}
            options={contributors}
            onChange={(selected) => update({ contributors: selected })}
            onCreate={onCreateContributor}
          />
        </div>
        <Field label="Description">
          <MarkdownEditor value={record.description} onChange={updateDescription} />
        </Field>
      </div>
    </div>
  );
}

function ContributorEditor({
  initial,
  isNew,
  projects,
  changelogs,
  onChange,
}: {
  initial: ContributorDraft;
  isNew: boolean;
  projects: ProjectRow[];
  changelogs: ProjectChangelog[];
  onChange: (record: ContributorDraft) => void;
}) {
  const [record, setRecord] = useState<ContributorDraft>(() => structuredClone(initial));
  const update = (patch: Partial<ContributorDraft>) => {
    const next = { ...record, ...patch };
    setRecord(next);
    onChange(next);
  };
  const references: ContributorReference[] = projects.flatMap((project) => {
    const projectAssigned = project.contributors?.some(
      (contributor) => contributor.id === record.id,
    ) ?? false;
    const assignedChangelogs = changelogs.filter(
      (changelog) =>
        changelog.project_id === project.id &&
        changelog.contributors?.some((contributor) => contributor.id === record.id),
    );
    return projectAssigned || assignedChangelogs.length
      ? [{ project, projectAssigned, changelogs: assignedChangelogs }]
      : [];
  });

  return (
    <div className="admin-editor">
      <header className="admin-editor-header">
        <div>
          <span className="admin-eyebrow">Contributor</span>
          <h2>{record.name || (isNew ? "New contributor" : "Untitled contributor")}</h2>
        </div>
      </header>
      <section className="admin-form-section">
        <div className="admin-form-grid admin-contributor-fields">
          <Field label="Name">
            <input
              autoFocus
              className="admin-input"
              onChange={(event) => update({ name: event.target.value })}
              value={record.name}
            />
          </Field>
          <Field label="Contact URL" hint="Optional; use an http or https link.">
            <input
              className="admin-input"
              onChange={(event) => update({ url: event.target.value || null })}
              placeholder="https://..."
              type="url"
              value={record.url ?? ""}
            />
          </Field>
        </div>
        <div className="admin-contributor-tree">
          {references.length ? (
            <ul className="admin-contributor-tree-projects">
              {references.map(({ project, changelogs: releases }) => (
                <li className="admin-contributor-tree-project" key={project.id}>
                  <strong className="admin-contributor-tree-project-name">{project.name}</strong>
                  {releases.length > 0 && (
                    <ul className="admin-contributor-tree-changelogs">
                      {releases.map((release) => (
                        <li className="admin-contributor-tree-changelog" key={release.id}>
                          {release.title || release.version}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <span className="admin-contributor-empty">—</span>
          )}
        </div>
      </section>
    </div>
  );
}

function MediaPickerDialog({
  pendingUploads,
  onQueueUpload,
  onSelect,
  onClose,
}: {
  pendingUploads: Map<string, PendingUpload>;
  onQueueUpload: (files: FileList) => Promise<void>;
  onSelect: (reference: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [response, setResponse] = useState<MediaResponse>({ items: [], nextOffset: null });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async (folder: string, offset = 0, append = false) => {
    setLoading(true);
    setError("");
    try {
      const result = await adminRequest<MediaResponse>(
        `/api/admin/media?path=${encodeURIComponent(folder)}&offset=${offset}`,
      );
      setResponse((current) => ({
        items: append ? [...current.items, ...result.items] : result.items,
        nextOffset: result.nextOffset,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Storage media.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(path);
  }, [load, path]);

  const queueFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      await onQueueUpload(files);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to prepare media upload.");
    } finally {
      setUploading(false);
    }
  };

  const matchingItems = response.items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="admin-media-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-media-title">
        <header className="admin-dialog-header">
          <div>
            <span className="admin-eyebrow">Storage · project-media</span>
            <h2 id="admin-media-title">Choose media</h2>
          </div>
          <button className="admin-icon-button" type="button" onClick={onClose} aria-label="Close media picker"><X size={18} /></button>
        </header>

        <div className="admin-media-toolbar">
          <div className="admin-media-breadcrumb">
            <button type="button" onClick={() => setPath("")} aria-label="Storage root"><Folder size={15} /></button>
            {path.split("/").filter(Boolean).map((part, index, parts) => {
              const nextPath = parts.slice(0, index + 1).join("/");
              return <span key={nextPath}><ChevronRight size={13} /><button type="button" onClick={() => setPath(nextPath)}>{part}</button></span>;
            })}
          </div>
          <label className="admin-file-upload">
            <input
              type="file"
              multiple
              accept={acceptedMedia}
              onChange={(event) => {
                void queueFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {uploading ? <LoaderCircle className="admin-spinning" size={15} /> : <CloudUpload size={15} />}
            Queue files
          </label>
        </div>

        <div className="admin-media-search">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter this folder" />
          <button type="button" onClick={() => void load(path)} aria-label="Refresh media"><RefreshCw size={15} /></button>
        </div>

        <div className="admin-media-list">
          {loading && response.items.length === 0 ? (
            <div className="admin-empty-state"><LoaderCircle className="admin-spinning" size={20} />Loading media</div>
          ) : matchingItems.length === 0 ? (
            <div className="admin-empty-state">{search ? "No matching media." : "This folder is empty."}</div>
          ) : matchingItems.map((item) => (
            <div className="admin-media-item" key={item.path}>
              <span className="admin-media-item-icon">{item.type === "folder" ? <Folder size={18} /> : <FileImage size={18} />}</span>
              <span className="admin-media-item-copy">
                <strong>{item.name}</strong>
                <small>{item.type === "folder" ? "Folder" : [item.contentType, formatBytes(item.size)].filter(Boolean).join(" · ")}</small>
              </span>
              {item.type === "folder" ? (
                <button className="admin-inline-button" type="button" onClick={() => { setSearch(""); setPath(item.path); }}>Open <ChevronRight size={14} /></button>
              ) : (
                <button className="admin-inline-button" type="button" onClick={() => item.publicUrl && onSelect(item.publicUrl)}>Use file</button>
              )}
            </div>
          ))}
          {response.nextOffset !== null && (
            <button className="admin-load-more" type="button" disabled={loading} onClick={() => void load(path, response.nextOffset ?? 0, true)}>
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>

        <div className="admin-pending-uploads">
          <div className="admin-pending-heading">
            <span>Pending uploads</span>
            <span>{pendingUploads.size}</span>
          </div>
          {pendingUploads.size === 0 ? (
            <p>New files are prepared locally and uploaded only when you commit.</p>
          ) : (
            [...pendingUploads.entries()].map(([reference, file]) => (
              <div className="admin-pending-file" key={reference}>
                <span><CloudUpload size={15} /><strong>{file.file.name}</strong></span>
                <button className="admin-inline-button" type="button" onClick={() => onSelect(reference)}>Use file</button>
              </div>
            ))
          )}
        </div>

        {error && <p className="admin-form-error"><CircleAlert size={16} />{error}</p>}
      </section>
    </div>
  );
}

function MediaLibraryDetail({
  asset,
  projects,
  pendingUploads,
}: {
  asset: StorageMediaFile;
  projects: ProjectRow[];
  pendingUploads: Map<string, PendingUpload>;
}) {
  return (
    <div className="admin-media-library-detail">
      <section
        aria-label={`Preview of ${asset.name}`}
        className="admin-media-library-preview"
      >
        <MediaPreview
          contentType={asset.contentType}
          pendingUploads={pendingUploads}
          value={asset.publicUrl}
        />
      </section>
      <section className="admin-media-library-usage">
        <h3>Used by projects</h3>
        {projects.length === 0 ? (
          <p>No projects are using this media.</p>
        ) : (
          <ul>
            {projects.map((project) => <li key={project.id}>{project.name}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

function getRowSubtitle(
  section: SectionName,
  record: ProjectRow | ProjectChangelog | ProjectContributor | DraftRecord,
  projects: ProjectRow[],
): string {
  if (section === "contributors") {
    return (record as ProjectContributor | ContributorDraft).url || "No contact URL";
  }
  if (section === "projects") {
    const project = record as ProjectRow | ProjectDraft;
    return [
      project.platform,
      project.visibility ?? "visibility unset",
      `${(project.media?.length ?? 0) + (project.primary_media ? 1 : 0)} media`,
    ].filter(Boolean).join(" · ");
  }
  const changelog = record as ProjectChangelog | ChangelogDraft;
  const projectName = projects.find((project) => project.id === changelog.project_id)?.name;
  return [projectName, changelog.release].filter(Boolean).join(" · ");
}

export function AdminPage() {
  const [section, setSection] = useState<SectionName>("projects");
  const [expandedSections, setExpandedSections] = useState<Record<"projects" | "contributors", boolean>>({
    projects: true,
    contributors: true,
  });
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(272);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [changelogs, setChangelogs] = useState<ProjectChangelog[]>([]);
  const [contributors, setContributors] = useState<ProjectContributor[]>([]);
  const [staged, setStaged] = useState<Map<string, StagedChange>>(new Map());
  const [pendingUploads, setPendingUploads] = useState<Map<string, PendingUpload>>(new Map());
  const [mediaAssets, setMediaAssets] = useState<StorageMediaFile[] | null>(null);
  const [mediaLibraryLoading, setMediaLibraryLoading] = useState(false);
  const [mediaLibraryError, setMediaLibraryError] = useState("");
  const [selectedMediaPath, setSelectedMediaPath] = useState<string | null>(null);
  const [mediaDeleteTarget, setMediaDeleteTarget] = useState<StorageMediaFile | null>(null);
  const [stagedMediaDeletions, setStagedMediaDeletions] = useState<Set<string>>(new Set());
  const [retryMediaDeletions, setRetryMediaDeletions] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [mediaPicker, setMediaPicker] = useState<((reference: string) => void) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [commitPromptOpen, setCommitPromptOpen] = useState(false);
  const [commitOutcomeUnknown, setCommitOutcomeUnknown] = useState(false);
  const changeReviewRef = useRef<HTMLDetailsElement>(null);

  const loadMediaLibrary = useCallback(async () => {
    setMediaLibraryLoading(true);
    setMediaLibraryError("");
    try {
      const folders = [""];
      const visitedFolders = new Set<string>();
      const files: StorageMediaFile[] = [];
      while (folders.length > 0) {
        const folder = folders.pop();
        if (folder === undefined || visitedFolders.has(folder)) continue;
        visitedFolders.add(folder);
        let offset = 0;
        while (true) {
          const response = await adminRequest<MediaResponse>(
            `/api/admin/media?path=${encodeURIComponent(folder)}&offset=${offset}`,
          );
          for (const item of response.items) {
            if (item.type === "folder") {
              folders.push(item.path);
            } else if (item.publicUrl) {
              files.push({ ...item, type: "file", publicUrl: item.publicUrl });
            }
          }
          if (response.nextOffset === null) break;
          offset = response.nextOffset;
        }
      }
      setMediaAssets(files.sort((first, second) => first.path.localeCompare(second.path)));
    } catch (caught) {
      setMediaAssets(null);
      setMediaLibraryError(
        caught instanceof Error ? caught.message : "Unable to load Storage media.",
      );
    } finally {
      setMediaLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      authenticated &&
      mediaAssets === null &&
      !mediaLibraryLoading &&
      !mediaLibraryError
    ) {
      void loadMediaLibrary();
    }
  }, [
    authenticated,
    loadMediaLibrary,
    mediaAssets,
    mediaLibraryError,
    mediaLibraryLoading,
  ]);

  const openMediaSection = () => {
    setSection("media");
    setError("");
    setNotice("");
    if (mediaAssets === null && !mediaLibraryLoading) {
      void loadMediaLibrary();
    }
  };

  useDismissOnOutsideClick(
    changeReviewRef,
    sidebarOpen && authenticated && staged.size > 0,
    () => {
      if (changeReviewRef.current) changeReviewRef.current.open = false;
    },
  );

  useEffect(() => {
    document.title = "Admin — neverlabs";
    document.documentElement.lang = "en";
    if (window.location.pathname === "/admin") {
      window.history.replaceState(null, "", `/admin/${window.location.search}${window.location.hash}`);
    }
    let active = true;
    void clearAdminSession()
      .then(() => {
        if (active) setInitializing(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoginError(caught instanceof Error ? caught.message : "Unable to initialize the admin session.");
        setInitializing(false);
      });
    const handleForcedLock = () => {
      setAuthenticated(false);
      setPassword("");
      setLoginError("Session expired. Enter the password again.");
      setMediaDeleteTarget(null);
    };
    window.addEventListener("neverlabs-admin-locked", handleForcedLock);
    return () => {
      active = false;
      window.removeEventListener("neverlabs-admin-locked", handleForcedLock);
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let locking = false;
    const lockWhenHidden = () => {
      if (document.visibilityState !== "hidden" || locking) return;
      locking = true;
      setAuthenticated(false);
      setPassword("");
      setLoginError("This tab was hidden. Enter the password again to continue.");
      setMediaPicker(null);
      setMediaDeleteTarget(null);
      setInitializing(true);
      setNotice("");
      void clearAdminSession()
        .then(() => setInitializing(false))
        .catch((caught: unknown) => {
          setLoginError(caught instanceof Error ? caught.message : "Unable to lock the admin session.");
          setInitializing(false);
        });
    };
    document.addEventListener("visibilitychange", lockWhenHidden);
    return () => document.removeEventListener("visibilitychange", lockWhenHidden);
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    setDataLoading(true);
    setError("");
    void Promise.all([
      adminRequest<ProjectRow[]>("/api/admin/projects"),
      adminRequest<ProjectChangelog[]>("/api/admin/changelogs"),
      adminRequest<ProjectContributor[]>("/api/admin/contributors"),
    ])
      .then(([projectRows, changelogRows, contributorRows]) => {
        if (!active) return;
        setProjects(projectRows);
        setChangelogs(changelogRows);
        setContributors(contributorRows);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Unable to load admin data.");
      })
      .finally(() => {
        if (active) setDataLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated]);

  useEffect(() => {
    if (staged.size === 0) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [staged.size]);

  const visibleProjects = useMemo(() => {
    const rows: VisibleRow[] = [];
    for (const record of projects) {
      const change = staged.get(compoundKey("projects", record.id));
      if (change?.operation === "delete") continue;
      rows.push({
        key: record.id,
        record: change?.record ?? record,
        operation: change?.operation,
      });
    }
    for (const change of staged.values()) {
      if (change.table === "projects" && change.operation === "insert" && change.record) {
        rows.push({ key: change.key, record: change.record, operation: "insert" });
      }
    }
    return rows;
  }, [projects, staged]);

  const deletedProjectIds = useMemo(
    () =>
      new Set(
        [...staged.values()]
          .filter((change) => change.table === "projects" && change.operation === "delete")
          .map((change) => change.id)
          .filter((id): id is string => Boolean(id)),
      ),
    [staged],
  );

  const visibleChangelogs = useMemo(() => {
    const rows: VisibleRow[] = [];
    for (const record of changelogs) {
      if (deletedProjectIds.has(record.project_id)) continue;
      const change = staged.get(compoundKey("project_changelogs", record.id));
      if (change?.operation === "delete") continue;
      const nextRecord = change?.record ?? record;
      if (deletedProjectIds.has((nextRecord as ProjectChangelog).project_id)) continue;
      rows.push({
        key: record.id,
        record: nextRecord,
        operation: change?.operation,
      });
    }
    for (const change of staged.values()) {
      if (change.table === "project_changelogs" && change.operation === "insert" && change.record) {
        const record = change.record as ChangelogDraft;
        if (!deletedProjectIds.has(record.project_id)) {
          rows.push({ key: change.key, record, operation: "insert" });
        }
      }
    }
    return rows;
  }, [changelogs, deletedProjectIds, staged]);

  const visibleContributors = useMemo(() => {
    const rows: VisibleRow[] = [];
    for (const record of contributors) {
      const change = staged.get(compoundKey("contributors", record.id));
      if (change?.operation === "delete") continue;
      rows.push({
        key: record.id,
        record: change?.record ?? record,
        operation: change?.operation,
      });
    }
    for (const change of staged.values()) {
      if (change.table === "contributors" && change.operation === "insert" && change.record) {
        rows.push({ key: change.key, record: change.record, operation: "insert" });
      }
    }
    return rows;
  }, [contributors, staged]);

  const rows = section === "projects"
    ? visibleProjects
    : section === "changelogs"
      ? visibleChangelogs
      : section === "contributors"
        ? visibleContributors
        : [];
  const activeProjectId = editor?.table === "projects"
    ? editor.record.id ?? null
    : editor?.table === "project_changelogs"
      ? editor.record.project_id || null
      : null;
  const availableProjects = visibleProjects
    .map((row) => row.record as ProjectRow)
    .filter((project) => project.id);
  const availableChangelogs = visibleChangelogs
    .map((row) => row.record as ProjectChangelog)
    .filter((changelog) => changelog.id);
  const availableContributors = visibleContributors
    .map((row) => row.record as ProjectContributor)
    .filter((contributor) => contributor.id);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const availableMediaAssets = (mediaAssets ?? []).filter(
    (item) => !stagedMediaDeletions.has(item.path),
  );
  const mediaTreeRows = availableMediaAssets.filter((item) =>
    !normalizedSearch || `${item.name} ${item.path}`.toLocaleLowerCase().includes(normalizedSearch),
  );
  const selectedMedia = availableMediaAssets.find((item) => item.path === selectedMediaPath) ?? null;
  const selectedMediaProjects = selectedMedia
    ? availableProjects.filter((project) =>
        projectUsesStorageMedia(project, selectedMedia.path, availableChangelogs),
      )
    : [];
  const matchesRecord = (table: TableName, row: VisibleRow) => {
    if (!normalizedSearch) return true;
    const recordSection: SectionName = table === "projects"
      ? "projects"
      : table === "project_changelogs"
        ? "changelogs"
        : "contributors";
    const searchableText = [
      getDisplayName(table, row.record),
      getRowSubtitle(recordSection, row.record, availableProjects),
    ].join(" ").toLocaleLowerCase();
    return searchableText.includes(normalizedSearch);
  };
  const selectedTable: TableName | null = section === "projects"
    ? "projects"
    : section === "changelogs"
      ? "project_changelogs"
      : section === "contributors"
        ? "contributors"
        : null;
  const matchingRows = selectedTable
    ? rows.filter((row) => matchesRecord(selectedTable, row))
    : [];
  const projectTreeRows = visibleProjects.filter((row) => {
    const projectId = (row.record as ProjectRow | ProjectDraft).id;
    return matchesRecord("projects", row) || visibleChangelogs.some(
      (changelog) =>
        (changelog.record as ProjectChangelog | ChangelogDraft).project_id === projectId &&
        matchesRecord("project_changelogs", changelog),
    );
  });
  const changelogsForProject = (projectId: string) =>
    visibleChangelogs.filter(
      (row) =>
        (row.record as ProjectChangelog | ChangelogDraft).project_id === projectId &&
        matchesRecord("project_changelogs", row),
    );
  const contributorTreeRows = visibleContributors.filter((row) =>
    matchesRecord("contributors", row),
  );
  const stagedCount = staged.size;
  const pendingMediaDeletionPaths = new Set([
    ...stagedMediaDeletions,
    ...retryMediaDeletions,
  ]);
  const pendingActionCount = stagedCount + pendingMediaDeletionPaths.size;

  const openEditor = (nextEditor: EditorState, preserveFeedback = false) => {
    const nextSection: SectionName = nextEditor.table === "projects"
      ? "projects"
      : nextEditor.table === "project_changelogs"
        ? "changelogs"
        : "contributors";
    if (editor?.table === nextEditor.table && editor.key === nextEditor.key) {
      setSection(nextSection);
      setSelectedKey(nextEditor.key);
      setEditor(nextEditor);
      return;
    }
    setSection(nextSection);
    const rootSection = nextSection === "contributors" ? "contributors" : "projects";
    setExpandedSections((current) => ({ ...current, [rootSection]: true }));
    if (nextEditor.table === "project_changelogs") {
      setExpandedProjects((current) => new Set(current).add(nextEditor.record.project_id));
    }
    setSelectedKey(nextEditor.key);
    setEditor(nextEditor);
    setMediaPicker(null);
    if (!preserveFeedback) {
      setError("");
      setNotice("");
    }
  };

  const requestEditorNavigation = (nextEditor: EditorState) => {
    if (editor?.table === nextEditor.table && editor.key === nextEditor.key) {
      setSection(nextEditor.table === "projects"
        ? "projects"
        : nextEditor.table === "project_changelogs"
          ? "changelogs"
          : "contributors");
      setSelectedKey(nextEditor.key);
      setEditor(nextEditor);
      return;
    }
    if (actionBusy) return;
    if (staged.size > 0) {
      setError("");
      setPendingNavigation(nextEditor);
      return;
    }
    openEditor(nextEditor);
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      await adminRequest("/api/admin/login", {
        method: "POST",
        body: { password },
      });
      setPassword("");
      setAuthenticated(true);
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : "Unable to sign in.");
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = () => {
    setAuthenticated(false);
    setPassword("");
    setLoginError("");
    setMediaPicker(null);
    setMediaDeleteTarget(null);
    setInitializing(true);
    setNotice("");
    void clearAdminSession()
      .then(() => setInitializing(false))
      .catch((caught: unknown) => {
        setLoginError(caught instanceof Error ? caught.message : "Unable to lock the admin session.");
        setInitializing(false);
      });
  };

  const refresh = async () => {
    setDataLoading(true);
    setError("");
    try {
      const [projectRows, changelogRows, contributorRows] = await Promise.all([
        adminRequest<ProjectRow[]>("/api/admin/projects"),
        adminRequest<ProjectChangelog[]>("/api/admin/changelogs"),
        adminRequest<ProjectContributor[]>("/api/admin/contributors"),
      ]);
      setProjects(projectRows);
      setChangelogs(changelogRows);
      setContributors(contributorRows);
      setNotice(commitOutcomeUnknown
        ? "Data refreshed. Verify the previous commit in Supabase before allowing a retry."
        : "Data refreshed from Supabase.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to refresh data.");
    } finally {
      setDataLoading(false);
    }
  };

  const startNewRecord = (table: TableName, projectId?: string) => {
    const key = `new:${createUuid()}`;
    if (table === "projects") {
      requestEditorNavigation({ table, key, operation: "insert", record: projectDraft() });
    } else if (table === "project_changelogs") {
      const draft = changelogDraft();
      if (projectId !== undefined) draft.project_id = projectId;
      else if (activeProjectId) draft.project_id = activeProjectId;
      requestEditorNavigation({ table, key, operation: "insert", record: draft });
    } else {
      requestEditorNavigation({ table, key, operation: "insert", record: contributorDraft() });
    }
  };

  const startEditRecord = (table: TableName, row: VisibleRow) => {
    const operation = row.operation === "insert" ? "insert" : "update";
    if (table === "projects") {
      requestEditorNavigation({
          table,
          key: row.key,
          operation,
          record: projectDraft(row.record as ProjectRow),
        });
    } else if (table === "project_changelogs") {
      requestEditorNavigation({
          table,
          key: row.key,
          operation,
          record: changelogDraft(row.record as ProjectChangelog),
        });
    } else {
      requestEditorNavigation({
        table,
        key: row.key,
        operation,
        record: contributorDraft(row.record as ProjectContributor),
      });
    }
  };

  const stageRecordChange = (
    changes: Map<string, StagedChange>,
    table: TableName,
    key: string,
    operation: Operation,
    record: DraftRecord,
  ) => {
    const index = compoundKey(table, key);
    const existing = changes.get(index);
    const isNew = operation === "insert" || existing?.operation === "insert";
    const serverRecord = table === "projects"
      ? projects.find((item) => item.id === key)
      : table === "project_changelogs"
        ? changelogs.find((item) => item.id === key)
        : contributors.find((item) => item.id === key);
    if (!isNew && serverRecord && JSON.stringify(serverRecord) === JSON.stringify(record)) {
      changes.delete(index);
    } else {
      changes.set(index, {
        table,
        operation: isNew ? "insert" : "update",
        key,
        id: isNew ? undefined : key,
        record,
        label: getDisplayName(table, record),
      });
    }
  };

  const saveRecord = (table: TableName, key: string, operation: Operation, record: DraftRecord) => {
    const next = new Map(staged);
    stageRecordChange(next, table, key, operation, record);
    setStaged(next);
    setEditor((current) => {
      if (!current || current.table !== table || current.key !== key) return current;
      return { ...current, record } as EditorState;
    });
    setSelectedKey(key);
    setError("");
    setNotice("");
  };

  const requestDeleteRecord = (table: TableName, row: VisibleRow) => {
    setDeleteTarget({ table, row });
  };

  const confirmMediaDelete = () => {
    if (!mediaDeleteTarget) return;
    const next = new Map(staged);
    for (const row of visibleProjects) {
      const project = row.record as ProjectDraft;
      const description = removeLocalizedStorageReferences(
        project.description,
        mediaDeleteTarget.path,
      );
      if (
        !projectStoragePaths(project).has(mediaDeleteTarget.path) &&
        JSON.stringify(description) === JSON.stringify(project.description)
      ) continue;
      const updatedProject: ProjectDraft = {
        ...project,
        primary_media:
          storageObjectPath(project.primary_media) === mediaDeleteTarget.path
            ? null
            : project.primary_media,
        media: (project.media ?? []).filter(
          (url) => storageObjectPath(url) !== mediaDeleteTarget.path,
        ),
        description,
      };
      stageRecordChange(
        next,
        "projects",
        row.key,
        row.operation ?? "update",
        updatedProject,
      );
    }
    for (const row of visibleChangelogs) {
      const changelog = row.record as ProjectChangelog | ChangelogDraft;
      const description = removeLocalizedStorageReferences(
        changelog.description,
        mediaDeleteTarget.path,
      );
      if (JSON.stringify(description) === JSON.stringify(changelog.description)) continue;
      stageRecordChange(
        next,
        "project_changelogs",
        row.key,
        row.operation ?? "update",
        { ...changelog, description },
      );
    }
    setStaged(next);
    setStagedMediaDeletions((current) => new Set(current).add(mediaDeleteTarget.path));
    if (selectedMediaPath === mediaDeleteTarget.path) {
      setSelectedMediaPath(null);
    }
    setMediaDeleteTarget(null);
    setError("");
    setNotice(
      `Deletion staged for ${mediaDeleteTarget.name}. Commit changes to remove the file from Storage and all projects.`,
    );
  };

  const createContributor = (name: string, url: string | null): ProjectContributor => {
    const existing = availableContributors.find(
      (item) =>
        item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase() &&
        (item.url ?? null) === (url ?? null),
    );
    if (existing) return existing;
    const contributor = { id: createUuid(), name, url };
    saveRecord("contributors", contributor.id, "insert", contributorDraft(contributor));
    return contributor;
  };

  const hasStagedContributorAssignments = (
    changes: Map<string, StagedChange>,
    contributorId: string,
  ) =>
    [...changes.values()].some((change) => {
      if (
        (change.table !== "projects" && change.table !== "project_changelogs") ||
        !change.record ||
        change.operation === "delete"
      ) {
        return false;
      }
      const record = change.record as ProjectDraft | ChangelogDraft;
      return record.contributors?.some((contributor) => contributor.id === contributorId) ?? false;
    });

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const { table, row } = deleteTarget;
    const label = getDisplayName(table, row.record);
    const next = new Map(staged);
    const key = compoundKey(table, row.key);
    const current = next.get(key);
    if (
      table === "contributors" &&
      current?.operation === "insert" &&
      current.record &&
      hasStagedContributorAssignments(next, (current.record as ContributorDraft).id ?? "")
    ) {
      setError("Remove this new contributor from staged projects and changelogs before discarding it.");
      setDeleteTarget(null);
      return;
    }
    if (current?.operation === "insert") {
      next.delete(key);
    } else {
      next.set(key, {
        table,
        operation: "delete",
        key: row.key,
        id: row.key,
        label,
      });
    }
    if (table === "projects") {
      const projectId = (row.record as ProjectRow | ProjectDraft).id;
      for (const [changeKey, change] of next) {
        if (
          change.table === "project_changelogs" &&
          change.operation === "insert" &&
          (change.record as ChangelogDraft | undefined)?.project_id === projectId
        ) {
          next.delete(changeKey);
        }
      }
    }
    setStaged(next);
    if (editor?.table === table && editor.key === row.key) {
      setSelectedKey(null);
      setEditor(null);
    }
    setDeleteTarget(null);
    setNotice(current?.operation === "insert"
      ? "The new record and any dependent staged releases were removed."
      : "Deletion staged. Nothing has been sent to Supabase yet.");
  };

  const removeStagedChange = (change: StagedChange) => {
    const next = new Map(staged);
    if (
      change.table === "contributors" &&
      change.operation === "insert" &&
      change.record &&
      hasStagedContributorAssignments(next, (change.record as ContributorDraft).id ?? "")
    ) {
      setError("Remove this new contributor from staged projects and changelogs before discarding it.");
      return;
    }
    next.delete(stageKey(change));
    setStaged(next);
    if (selectedKey === change.key) {
      setSelectedKey(null);
      setEditor(null);
    }
  };

  const prepareUploads = async (files: FileList) => {
    const prepared = new Map(pendingUploads);
    for (const file of Array.from(files)) {
      const result = await adminRequest<{
        path: string;
        publicUrl: string;
        contentType: string;
      }>("/api/admin/media/prepare", {
        method: "POST",
        body: { name: file.name },
      });
      const reference = `${pendingPrefix}${createUuid()}`;
      prepared.set(reference, {
        file,
        path: result.path,
        publicUrl: result.publicUrl,
        contentType: result.contentType,
      });
    }
    setPendingUploads(prepared);
    setNotice("Files are queued locally and will upload when you commit.");
  };

  const uploadPendingFiles = async (
    references: Set<string>,
  ): Promise<string[]> => {
    const entries = [...references].map((reference) => {
      const upload = pendingUploads.get(reference);
      if (!upload) throw new Error("A pending media file is no longer available.");
      return upload;
    });
    const uploadedPaths = new Set<string>();
    const attemptedPaths = new Set<string>();
    const failures: string[] = [];
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < entries.length) {
        const upload = entries[nextIndex];
        nextIndex += 1;
        try {
          const signed = await adminRequest<{
            signedUrl?: string;
            contentType: string;
            alreadyUploaded?: boolean;
          }>("/api/admin/media/upload-url", {
            method: "POST",
            body: { path: upload.path },
          });
          if (signed.alreadyUploaded) continue;
          if (!signed.signedUrl) {
            throw new Error(`Storage did not return an upload URL for ${upload.file.name}.`);
          }
          attemptedPaths.add(upload.path);
          const response = await fetch(signed.signedUrl, {
            method: "PUT",
            headers: {
              "Content-Type": signed.contentType,
              "Cache-Control": "max-age=3600",
              "x-upsert": "false",
            },
            body: upload.file,
          });
          if (!response.ok) {
            const details = (await response.text()).trim().slice(0, 500);
            throw new Error(
              `Storage upload failed (${response.status}) for ${upload.file.name}${details ? `: ${details}` : "."}`,
            );
          }
          uploadedPaths.add(upload.path);
        } catch (caught) {
          failures.push(caught instanceof Error ? caught.message : String(caught));
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, entries.length) }, () => worker()),
    );
    if (failures.length > 0) {
      if (attemptedPaths.size > 0) {
        try {
          await adminRequest("/api/admin/media/cleanup", {
            method: "POST",
            body: { paths: [...attemptedPaths] },
          });
        } catch (cleanupError) {
          failures.push(
            `Storage cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          );
        }
      }
      throw new Error(failures.join("\n"));
    }
    return [...uploadedPaths];
  };

  const commit = async (): Promise<boolean> => {
    if (
      (staged.size === 0 &&
        stagedMediaDeletions.size === 0 &&
        retryMediaDeletions.size === 0) ||
      commitOutcomeUnknown ||
      actionBusy
    ) return false;
    if (staged.size > 500) {
      setError("A single database commit supports up to 500 row changes.");
      return false;
    }
    const remainingProjects = visibleProjects.map(
      (row) => row.record as ProjectRow | ProjectDraft,
    );
    const remainingChangelogs = visibleChangelogs.map(
      (row) => row.record as ProjectChangelog | ChangelogDraft,
    );
    const stillReferencedMedia = new Set([
      ...stagedMediaDeletions,
      ...retryMediaDeletions,
    ]);
    const referencedPaths = [...stillReferencedMedia].filter((path) =>
      remainingProjects.some((project) =>
        projectUsesStorageMedia(project, path, remainingChangelogs),
      ) ||
      remainingChangelogs.some((changelog) =>
        localizedStoragePaths(changelog.description).has(path),
      ),
    );
    if (referencedPaths.length > 0) {
      setError(
        `Cannot delete Storage media while a project still uses it: ${referencedPaths.map((path) => path.split("/").at(-1)).join(", ")}.`,
      );
      return false;
    }
    const invalidChange = [...staged.values()].find((change) => {
      if (change.operation === "delete" || !change.record) return false;
      if ("name" in change.record) {
        return !change.record.name.trim() ||
          (change.table === "contributors" &&
            change.record.url !== null &&
            typeof change.record.url === "string" &&
            !safeHttpUrl(change.record.url));
      }
      return !change.record.project_id || !change.record.title.trim() || !change.record.version.trim();
    });
    if (invalidChange) {
      setError(invalidChange.table === "projects"
        ? "Project name is required before committing."
        : invalidChange.table === "contributors"
          ? "Contributor name is required, and its contact URL must use http or https."
        : "A changelog needs a project, title, and version before committing.");
      return false;
    }
    setActionBusy(true);
    setError("");
    setNotice("");
    const changes = [...staged.values()];
    const pathsRemovedFromProjects = removedProjectStoragePaths(
      projects,
      remainingProjects,
      changelogs,
      remainingChangelogs,
    );
    const pathsHandledByProjectDeletes = new Set(
      [...staged.values()]
        .filter((change) => change.table === "projects" && change.operation === "delete")
        .flatMap((change) => {
          const project = projects.find((item) => item.id === change.id);
          return project ? [...projectAttachedStoragePaths(project)] : [];
        }),
    );
    const mediaPathsToDelete = new Set([
      ...stagedMediaDeletions,
      ...retryMediaDeletions,
      ...[...pathsRemovedFromProjects].filter(
        (path) => !pathsHandledByProjectDeletes.has(path),
      ),
    ]);
    const uploadReferences = collectPendingReferences(changes, pendingUploads);
    let uploadedPaths: string[] = [];
    try {
      if (uploadReferences.size > 0) {
        setNotice(`Uploading ${uploadReferences.size} media file${uploadReferences.size === 1 ? "" : "s"} in the background…`);
        uploadedPaths = await uploadPendingFiles(uploadReferences);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Media upload failed.");
      setActionBusy(false);
      return false;
    }

    const payload = changes.map((change) => {
      if (change.operation === "delete") {
        return { table: change.table, operation: "delete", id: change.id };
      }
      const record = replacePendingReferences(change.record, pendingUploads);
      if (change.table === "projects" || change.table === "project_changelogs") {
        const row = record as ProjectDraft | ChangelogDraft;
        return {
          table: change.table,
          operation: change.operation,
          record: {
            ...row,
            contributors: (row.contributors ?? []).map((contributor) => contributor.id),
          },
        };
      }
      return { table: change.table, operation: change.operation, record };
    });

    if (changes.length > 0) {
      let response: Response;
      try {
        response = await fetch("/api/admin/commit", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes: payload }),
        });
      } catch {
        setCommitOutcomeUnknown(true);
        setError("The connection ended during database commit. Its outcome is unknown; uploaded files and staged changes were kept. Refresh Supabase before retrying.");
        setActionBusy(false);
        return false;
      }

      let result: { error?: string };
      try {
        result = await response.json() as { error?: string };
      } catch {
        setCommitOutcomeUnknown(true);
        setError("The server response could not be read. The commit outcome is unknown; uploaded files and staged changes were kept.");
        setActionBusy(false);
        return false;
      }

      if (!response.ok) {
        let cleanupMessage = "";
        if (uploadedPaths.length > 0) {
          try {
            await adminRequest("/api/admin/media/cleanup", {
              method: "POST",
              body: { paths: uploadedPaths },
            });
          } catch (cleanupError) {
            cleanupMessage = ` Uploaded files could not be cleaned up: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
          }
        }
        setError(`${result.error ?? "Database commit failed."}${cleanupMessage}`);
        setActionBusy(false);
        return false;
      }

      setStaged(new Map());
      setStagedMediaDeletions(new Set());
      setPendingUploads(new Map());
      setEditor(null);
      setSelectedKey(null);
    }
    if (changes.length === 0) setStagedMediaDeletions(new Set());

    let mediaCleanupError = "";
    const failedMediaPaths = new Set<string>();
    const deletedMediaPaths = new Set<string>();
    if (mediaPathsToDelete.size > 0) {
      const paths = [...mediaPathsToDelete];
      const cleanupErrors: string[] = [];
      for (let offset = 0; offset < paths.length; offset += 1000) {
        const batch = paths.slice(offset, offset + 1000);
        try {
          await adminRequest("/api/admin/media/delete", {
            method: "POST",
            body: { paths: batch },
          });
          batch.forEach((path) => deletedMediaPaths.add(path));
        } catch (caught) {
          batch.forEach((path) => failedMediaPaths.add(path));
          cleanupErrors.push(caught instanceof Error ? caught.message : String(caught));
        }
      }
      setRetryMediaDeletions(failedMediaPaths);
      setMediaAssets((current) =>
        current?.filter((item) => !deletedMediaPaths.has(item.path)) ?? null,
      );
      if (selectedMediaPath && deletedMediaPaths.has(selectedMediaPath)) {
        setSelectedMediaPath(null);
      }
      if (cleanupErrors.length > 0) mediaCleanupError = cleanupErrors.join("; ");
    }

    if (changes.length > 0) await refresh();
    if (mediaCleanupError) {
      const names = [...failedMediaPaths]
        .map((path) => path.split("/").at(-1))
        .join(", ");
      setError(
        `${changes.length > 0 ? "Database changes were committed, but " : ""}Storage media could not be deleted (${names}): ${mediaCleanupError}. Use Commit changes to retry.`,
      );
    } else {
      setNotice(changes.length > 0
        ? "All staged changes were committed."
        : "Storage media deleted.");
    }
    setActionBusy(false);
    return !mediaCleanupError;
  };

  const commitAndContinue = async () => {
    if (!pendingNavigation || actionBusy) return;
    if (commitOutcomeUnknown) {
      setError("The previous commit outcome is unknown. Refresh and verify it before retrying.");
      return;
    }
    const target = pendingNavigation;
    const uploads = pendingUploads;
    if (!await commit()) return;
    setPendingNavigation(null);
    const record = replacePendingReferences(target.record, uploads);
    if (target.operation === "insert" && !record.id) {
      setError("The committed record is missing its ID. Refresh the table before editing it.");
      setEditor(null);
      setSelectedKey(null);
      return;
    }
    if (target.table === "projects") {
      openEditor({
        table: "projects",
        key: record.id ?? target.key,
        operation: target.operation === "insert" ? "update" : target.operation,
        record: record as ProjectDraft,
      }, true);
    } else if (target.table === "project_changelogs") {
      openEditor({
        table: "project_changelogs",
        key: record.id ?? target.key,
        operation: target.operation === "insert" ? "update" : target.operation,
        record: record as ChangelogDraft,
      }, true);
    } else {
      openEditor({
        table: "contributors",
        key: record.id ?? target.key,
        operation: target.operation === "insert" ? "update" : target.operation,
        record: record as ContributorDraft,
      }, true);
    }
  };

  const discardAndContinue = () => {
    if (!pendingNavigation || actionBusy) return;
    const target = pendingNavigation;
    const targetChange = staged.get(compoundKey(target.table, target.key));
    let targetEditor = target;
    if (targetChange?.operation === "insert") {
      const key = `new:${createUuid()}`;
      targetEditor = target.table === "projects"
        ? { table: "projects", key, operation: "insert", record: projectDraft() }
        : target.table === "project_changelogs"
          ? { table: "project_changelogs", key, operation: "insert", record: changelogDraft() }
          : { table: "contributors", key, operation: "insert", record: contributorDraft() };
    } else if (target.table === "projects" && target.operation !== "insert") {
      const record = projects.find((project) => project.id === target.key);
      if (record) {
        targetEditor = { table: "projects", key: record.id, operation: "update", record: projectDraft(record) };
      }
    } else if (target.table === "project_changelogs" && target.operation !== "insert") {
      const record = changelogs.find((changelog) => changelog.id === target.key);
      if (record) {
        targetEditor = {
          table: "project_changelogs",
          key: record.id,
          operation: "update",
          record: changelogDraft(record),
        };
      }
    } else if (target.table === "contributors" && target.operation !== "insert") {
      const record = contributors.find((contributor) => contributor.id === target.key);
      if (record) {
        targetEditor = {
          table: "contributors",
          key: record.id,
          operation: "update",
          record: contributorDraft(record),
        };
      }
    }
    setStaged(new Map());
    setPendingUploads(new Map());
    setPendingNavigation(null);
    setError("");
    setNotice("Staged changes discarded.");
    openEditor(targetEditor, true);
  };

  const discardAll = () => {
    if (staged.size === 0 && stagedMediaDeletions.size === 0) return;
    if (!window.confirm("Discard every staged database change and uncommitted media deletion?")) return;
    setStaged(new Map());
    setStagedMediaDeletions(new Set());
    setPendingUploads(new Map());
    setEditor(null);
    setSelectedKey(null);
    setNotice("Staged changes discarded.");
    setError("");
  };

  const allowCommitRetry = () => {
    if (!commitOutcomeUnknown) return;
    if (!window.confirm("Only continue if you have verified in Supabase that the previous commit did not apply. If it succeeded, discard the staged changes instead.")) return;
    setCommitOutcomeUnknown(false);
    setError("");
    setNotice("Retry unlocked. Verify staged rows before committing again.");
  };

  const stageDescription = (change: StagedChange) =>
    `${change.table === "projects" ? "Project" : change.table === "contributors" ? "Contributor" : "Changelog"} · ${
      change.operation === "insert" ? "New" : change.operation === "update" ? "Edited" : "Delete"
    } · ${change.label}`;
  const pendingTargetIsInsert = pendingNavigation
    ? staged.get(compoundKey(pendingNavigation.table, pendingNavigation.key))?.operation === "insert"
    : false;

  return (
    <main
      className="admin-app"
      style={{
        gridTemplateColumns: sidebarOpen ? `${sidebarWidth}px minmax(0, 1fr)` : "minmax(0, 1fr)",
      }}
    >
      {sidebarOpen && (
        <aside className="admin-sidebar">
          <div className="admin-sidebar-header">
            <a className="admin-brand" href="/admin/" aria-label="Neverlabs admin home">
              <img src="/images/logo.png" alt="neverlabs" />
            </a>
            <div className="admin-sidebar-header-actions">
              {authenticated && (
                <button
                  aria-label="Lock workspace"
                  className="admin-sidebar-lock"
                  onClick={logout}
                  title="Lock workspace"
                  type="button"
                >
                  <Lock size={15} />
                </button>
              )}
              <button
                aria-label="Close sidebar"
                className="admin-sidebar-close"
                onClick={() => setSidebarOpen(false)}
                title="Close sidebar"
                type="button"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
          <div className="admin-sidebar-tools">
            <div className="admin-list-toolbar">
              <Search size={15} />
              <input
                aria-label="Search records"
                disabled={!authenticated}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a record…"
                value={search}
              />
              {search && <button aria-label="Clear search" onClick={() => setSearch("")} type="button"><X size={14} /></button>}
            </div>
          </div>
          <nav className="admin-tree" aria-label="Database tables">
            <div className={`admin-tree-group${section === "media" ? " current" : ""}`}>
              <div className="admin-tree-table-row">
                <button
                  aria-current={section === "media" ? "page" : undefined}
                  className="admin-tree-table"
                  onClick={openMediaSection}
                  type="button"
                >
                  <FileImage size={15} />
                  <span>Media</span>
                  {authenticated && mediaAssets && <small>{availableMediaAssets.length}</small>}
                </button>
                <button
                  aria-label="Refresh media"
                  className="admin-tree-add"
                  disabled={!authenticated || mediaLibraryLoading}
                  onClick={() => void loadMediaLibrary()}
                  title="Refresh media"
                  type="button"
                >
                  {mediaLibraryLoading
                    ? <LoaderCircle className="admin-spinning" size={14} />
                    : <RefreshCw size={14} />}
                </button>
              </div>
              {authenticated && (
                <div className="admin-tree-media">
                  {mediaAssets === null && mediaLibraryError ? (
                    <span className="admin-tree-empty" role="alert">{mediaLibraryError}</span>
                  ) : mediaAssets === null ? (
                    <span className="admin-tree-empty"><LoaderCircle className="admin-spinning" size={12} /> Loading media</span>
                  ) : mediaTreeRows.length === 0 ? (
                    <span className="admin-tree-empty">{search ? "No matches" : "No media files"}</span>
                  ) : mediaTreeRows.map((item) => (
                    <div
                      className={`admin-tree-media-row${section === "media" && selectedMediaPath === item.path ? " selected" : ""}`}
                      key={item.path}
                    >
                      <button
                        className="admin-tree-media-select"
                        onClick={() => {
                          setSelectedMediaPath(item.path);
                          openMediaSection();
                        }}
                        title={item.path}
                        type="button"
                      >
                        <FileImage size={13} />
                        <span className="admin-tree-record-copy">
                          <strong>{item.name}</strong>
                          {item.path.includes("/") && <small>{item.path.slice(0, item.path.lastIndexOf("/"))}</small>}
                        </span>
                      </button>
                      <div className="admin-tree-media-actions">
                        <button
                          aria-label={`Copy raw URL for ${item.name}`}
                          disabled={actionBusy}
                          onClick={() => {
                            void copyMediaUrl(item.publicUrl)
                              .then(() => setNotice("Raw media URL copied."))
                              .catch((caught: unknown) => setError(
                                caught instanceof Error ? caught.message : "Unable to copy the media URL.",
                              ));
                          }}
                          title="Copy raw URL"
                          type="button"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          aria-label={`Delete ${item.name} from Storage`}
                          disabled={actionBusy}
                          onClick={() => setMediaDeleteTarget(item)}
                          title="Delete media"
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={`admin-tree-group${section === "projects" || section === "changelogs" ? " current" : ""}`}>
              <div className="admin-tree-table-row">
                <button
                  aria-expanded={expandedSections.projects}
                  className="admin-tree-table"
                  onClick={() => setExpandedSections((current) => ({
                    ...current,
                    projects: !current.projects,
                  }))}
                  type="button"
                >
                  {expandedSections.projects ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <FolderKanban size={15} />
                  <span>Projects</span>
                  {authenticated && <small>{visibleProjects.length}</small>}
                </button>
                <button
                  aria-label="Add project"
                  className="admin-tree-add"
                  disabled={!authenticated || actionBusy}
                  onClick={() => startNewRecord("projects")}
                  title="Add project"
                  type="button"
                >
                  <Plus size={15} />
                </button>
              </div>
              {expandedSections.projects && authenticated && (
                <div className="admin-tree-projects">
                  {projectTreeRows.length === 0 ? (
                    <span className="admin-tree-empty">{search ? "No matches" : "No projects"}</span>
                  ) : projectTreeRows.map((row) => {
                    const project = row.record as ProjectRow | ProjectDraft;
                    const projectId = project.id ?? row.key;
                    const projectChangelogs = project.id ? changelogsForProject(project.id) : [];
                    const projectExpanded = expandedProjects.has(projectId);
                    return (
                      <div className="admin-tree-project-group" key={row.key}>
                        <div className={`admin-tree-project-row${section === "projects" && editor?.table === "projects" && selectedKey === row.key ? " selected" : ""}`}>
                          {projectChangelogs.length > 0 ? (
                            <button
                              aria-expanded={projectExpanded}
                              aria-label={`${projectExpanded ? "Collapse" : "Expand"} changelogs for ${project.name}`}
                              className="admin-tree-project-toggle"
                              onClick={() => setExpandedProjects((current) => {
                                const next = new Set(current);
                                if (next.has(projectId)) next.delete(projectId);
                                else next.add(projectId);
                                return next;
                              })}
                              type="button"
                            >
                              {projectExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          ) : (
                            <span className="admin-tree-project-toggle-placeholder" />
                          )}
                          <button
                            className="admin-tree-project-select"
                            onClick={() => startEditRecord("projects", row)}
                            type="button"
                          >
                            <span className="admin-tree-record-copy">
                              <strong>{getDisplayName("projects", row.record)}</strong>
                              <small>{getRowSubtitle("projects", row.record, availableProjects)}</small>
                            </span>
                            {row.operation && <span className={`admin-row-state admin-row-${row.operation}`}>{row.operation === "insert" ? "new" : row.operation}</span>}
                          </button>
                          <button
                            aria-label={`Add changelog for ${project.name}`}
                            className="admin-tree-add admin-tree-add-child"
                            disabled={!authenticated || actionBusy}
                            onClick={() => startNewRecord("project_changelogs", project.id ?? row.key)}
                            title={`Add changelog for ${project.name}`}
                            type="button"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            aria-label={`Stage delete ${getDisplayName("projects", row.record)}`}
                            className="admin-tree-delete"
                            disabled={actionBusy}
                            onClick={() => requestDeleteRecord("projects", row)}
                            title="Stage delete"
                            type="button"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        {projectExpanded && projectChangelogs.length > 0 && (
                          <div className="admin-tree-changelog-list">
                            {projectChangelogs.map((changelog) => (
                              <div
                                className={`admin-tree-changelog-row${section === "changelogs" && editor?.table === "project_changelogs" && selectedKey === changelog.key ? " selected" : ""}`}
                                key={changelog.key}
                              >
                                <button
                                  className="admin-tree-changelog-select"
                                  onClick={() => startEditRecord("project_changelogs", changelog)}
                                  type="button"
                                >
                                  <span className="admin-tree-record-copy">
                                    <strong>{getDisplayName("project_changelogs", changelog.record)}</strong>
                                    <small>{(changelog.record as ProjectChangelog | ChangelogDraft).release}</small>
                                  </span>
                                  {changelog.operation && <span className={`admin-row-state admin-row-${changelog.operation}`}>{changelog.operation === "insert" ? "new" : changelog.operation}</span>}
                                </button>
                                <button
                                  aria-label={`Stage delete ${getDisplayName("project_changelogs", changelog.record)}`}
                                  className="admin-tree-delete"
                                  disabled={actionBusy}
                                  onClick={() => requestDeleteRecord("project_changelogs", changelog)}
                                  title="Stage delete"
                                  type="button"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={`admin-tree-group${section === "contributors" ? " current" : ""}`}>
              <div className="admin-tree-table-row">
                <button
                  aria-expanded={expandedSections.contributors}
                  className="admin-tree-table"
                  onClick={() => setExpandedSections((current) => ({
                    ...current,
                    contributors: !current.contributors,
                  }))}
                  type="button"
                >
                  {expandedSections.contributors ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Users size={15} />
                  <span>Contributors</span>
                  {authenticated && <small>{visibleContributors.length}</small>}
                </button>
                <button
                  aria-label="Add contributor"
                  className="admin-tree-add"
                  disabled={!authenticated || actionBusy}
                  onClick={() => startNewRecord("contributors")}
                  title="Add contributor"
                  type="button"
                >
                  <Plus size={15} />
                </button>
              </div>
              {expandedSections.contributors && authenticated && (
                <div className="admin-tree-contributors">
                  {contributorTreeRows.length === 0 ? (
                    <span className="admin-tree-empty">{search ? "No matches" : "No contributors"}</span>
                  ) : contributorTreeRows.map((row) => (
                    <div className={`admin-tree-contributor-row${section === "contributors" && editor?.table === "contributors" && selectedKey === row.key ? " selected" : ""}`} key={row.key}>
                      <button
                        className="admin-tree-contributor-select"
                        onClick={() => startEditRecord("contributors", row)}
                        type="button"
                      >
                        <span className="admin-tree-record-copy">
                          <strong>{getDisplayName("contributors", row.record)}</strong>
                          <small>{getRowSubtitle("contributors", row.record, availableProjects)}</small>
                        </span>
                        {row.operation && <span className={`admin-row-state admin-row-${row.operation}`}>{row.operation === "insert" ? "new" : row.operation}</span>}
                      </button>
                      <button
                        aria-label={`Stage delete ${getDisplayName("contributors", row.record)}`}
                        className="admin-tree-delete"
                        disabled={actionBusy}
                        onClick={() => requestDeleteRecord("contributors", row)}
                        title="Stage delete"
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </nav>
          <div className="admin-sidebar-footer">
            <a href="/" target="_blank" rel="noreferrer"><ArrowUpRight size={15} /> Open website</a>
            <div className="admin-sidebar-footer-actions">
              {authenticated && pendingActionCount > 0 && (
                <>
                  <details className="admin-change-review" ref={changeReviewRef}>
                    <summary aria-label={`Review ${pendingActionCount} pending changes`}>Changes {pendingActionCount}</summary>
                    <div className="admin-change-review-list">
                      {[...staged.values()].map((change) => (
                        <div key={stageKey(change)}>
                          <span>{stageDescription(change)}</span>
                          <button type="button" onClick={() => removeStagedChange(change)} aria-label={`Discard ${change.label}`}><X size={15} /></button>
                        </div>
                      ))}
                      {[...stagedMediaDeletions].map((path) => (
                        <div key={`media-delete:${path}`}>
                          <span>Storage media · Delete · {path.split("/").at(-1)}</span>
                          <button
                            aria-label={`Discard deletion of ${path.split("/").at(-1)}`}
                            onClick={() => setStagedMediaDeletions((current) => {
                              const next = new Set(current);
                              next.delete(path);
                              return next;
                            })}
                            type="button"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      {[...retryMediaDeletions]
                        .filter((path) => !stagedMediaDeletions.has(path))
                        .map((path) => (
                          <div key={`media-retry:${path}`}>
                            <span>Storage media · Retry delete · {path.split("/").at(-1)}</span>
                            <button
                              aria-label={`Cancel retry for ${path.split("/").at(-1)}`}
                              onClick={() => setRetryMediaDeletions((current) => {
                                const next = new Set(current);
                                next.delete(path);
                                return next;
                              })}
                              type="button"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ))}
                    </div>
                  </details>
                  {(stagedCount > 0 || stagedMediaDeletions.size > 0) && (
                    <button
                      aria-label="Discard all staged changes"
                      className="admin-sidebar-action"
                      onClick={discardAll}
                      title="Discard all staged changes"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              )}
              {authenticated && (
                <button
                  aria-label={actionBusy ? "Committing changes" : commitOutcomeUnknown ? "Review uncertain commit" : pendingActionCount ? "Commit changes" : "No pending changes"}
                  className="admin-sidebar-action"
                  disabled={!pendingActionCount || actionBusy}
                  onClick={() => commitOutcomeUnknown ? allowCommitRetry() : setCommitPromptOpen(true)}
                  title={actionBusy ? "Committing changes" : commitOutcomeUnknown ? "Review uncertain commit" : pendingActionCount ? "Commit changes" : "No pending changes"}
                  type="button"
                >
                  {actionBusy ? <LoaderCircle className="admin-spinning" size={16} /> : <GitCommitHorizontal size={16} />}
                </button>
              )}
            </div>
          </div>
          <button
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemax={480}
            aria-valuemin={220}
            aria-valuenow={sidebarWidth}
            className="admin-sidebar-resize"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setSidebarWidth((width) => Math.max(220, width - 16));
              if (event.key === "ArrowRight") setSidebarWidth((width) => Math.min(480, width + 16));
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return;
              setSidebarWidth(Math.min(480, Math.max(220, event.clientX)));
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            role="separator"
            tabIndex={0}
            title="Drag to resize sidebar"
            type="button"
          />
        </aside>
      )}

      <section className="admin-workspace">
        {!sidebarOpen && (
          <div className="admin-sidebar-open-row">
            <button
              aria-label="Open sidebar"
              className="admin-sidebar-open"
              onClick={() => setSidebarOpen(true)}
              title="Open sidebar"
              type="button"
            >
              <FolderKanban size={16} />
            </button>
            {authenticated && (
              <button
                aria-label={actionBusy ? "Committing changes" : commitOutcomeUnknown ? "Review uncertain commit" : pendingActionCount ? "Commit changes" : "No pending changes"}
                className="admin-sidebar-action"
                disabled={!pendingActionCount || actionBusy}
                onClick={() => commitOutcomeUnknown ? allowCommitRetry() : setCommitPromptOpen(true)}
                title={actionBusy ? "Committing changes" : commitOutcomeUnknown ? "Review uncertain commit" : pendingActionCount ? "Commit changes" : "No pending changes"}
                type="button"
              >
                {actionBusy ? <LoaderCircle className="admin-spinning" size={16} /> : <GitCommitHorizontal size={16} />}
              </button>
            )}
          </div>
        )}
        {!authenticated ? (
          <div className="admin-auth-wrap">
            <form className="admin-auth-card" onSubmit={(event) => void login(event)}>
              <h1>Welcome back</h1>
              <p>Enter the admin password to access the {section} workspace.</p>
              <label className="admin-field">
                <span className="admin-field-label">Admin password</span>
                <input
                  className="admin-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  autoFocus={!initializing}
                  required
                  disabled={initializing || loginBusy}
                />
              </label>
              {loginError && <p className="admin-form-error">{loginError}</p>}
              <button className="admin-button admin-button-primary admin-auth-submit" type="submit" disabled={initializing || loginBusy || !password}>
                {initializing ? "Preparing secure session…" : loginBusy ? "Checking…" : "Unlock workspace"}
              </button>
              {!initializing && loginError.includes("ADMIN_PASSWORD") && (
                <p className="admin-env-help">Set <code>ADMIN_PASSWORD</code> in the root <code>.env</code> file, then restart the dev server.</p>
              )}
            </form>
          </div>
        ) : (
          <>
            {error && <div className="admin-alert admin-alert-error"><CircleAlert size={17} /><span>{error}</span>{commitOutcomeUnknown && <button className="admin-alert-action" type="button" onClick={allowCommitRetry}>I verified; allow retry</button>}<button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
            {notice && !error && <div className="admin-alert admin-alert-notice"><Check size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={15} /></button></div>}

            <section className="admin-panel admin-detail-panel">
              {dataLoading ? (
                <div className="admin-detail-empty"><LoaderCircle className="admin-spinning" size={22} /><strong>Loading records</strong></div>
              ) : section === "media" ? (
                selectedMedia ? (
                  <MediaLibraryDetail
                    asset={selectedMedia}
                    projects={selectedMediaProjects}
                    pendingUploads={pendingUploads}
                  />
                ) : (
                  <div className="admin-detail-empty">
                    <div>{mediaLibraryLoading ? <LoaderCircle className="admin-spinning" size={21} /> : <FileImage size={21} />}</div>
                    <strong>{mediaLibraryLoading ? "Loading media" : mediaLibraryError ? "Unable to load media" : "Choose a media file"}</strong>
                    <span>{mediaLibraryError || "Select a file in the sidebar to preview it and see the projects that use it."}</span>
                  </div>
                )
              ) : editor?.table === "projects" ? (
                  <ProjectEditor
                    key={editor.key}
                    initial={editor.record}
                    isNew={editor.operation === "insert"}
                    pendingUploads={pendingUploads}
                    contributors={availableContributors}
                    onCreateContributor={createContributor}
                    onChange={(record) => saveRecord("projects", editor.key, editor.operation, record)}
                    onBrowseMedia={(onPick) => setMediaPicker(() => onPick)}
                  />
                ) : editor?.table === "project_changelogs" ? (
                  <ChangelogEditor
                    key={editor.key}
                    initial={editor.record}
                    isNew={editor.operation === "insert"}
                    projects={availableProjects}
                    contributors={availableContributors}
                    onCreateContributor={createContributor}
                    onChange={(record) => saveRecord("project_changelogs", editor.key, editor.operation, record)}
                  />
                ) : editor?.table === "contributors" ? (
                  <ContributorEditor
                    key={editor.key}
                    initial={editor.record}
                    isNew={editor.operation === "insert"}
                    projects={availableProjects}
                    changelogs={availableChangelogs}
                    onChange={(record) => saveRecord("contributors", editor.key, editor.operation, record)}
                  />
                ) : (
                  <div className="admin-detail-empty">
                    <div><ArrowDownToLine size={21} /></div>
                      <strong>{matchingRows.length ? "Choose a record to edit" : search ? "No records match" : "No records yet"}</strong>
                      <span>{matchingRows.length ? "Select a file in the sidebar to open its editor." : search ? "Try a different search." : "Add a record with the plus button beside its table."}</span>
                  </div>
                )}
            </section>

          </>
        )}
      </section>

      {authenticated && commitPromptOpen && (
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !actionBusy) {
              setCommitPromptOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="admin-commit-title"
            aria-modal="true"
            className="admin-confirm-dialog"
            role="dialog"
          >
            <h2 id="admin-commit-title">Commit changes?</h2>
            {stagedCount > 0 && (
              <p>
                Commit {stagedCount} staged database change{stagedCount === 1 ? "" : "s"} in one transaction.
              </p>
            )}
            {pendingMediaDeletionPaths.size > 0 && (
              <p>
                Delete or retry deletion of {pendingMediaDeletionPaths.size} media file{pendingMediaDeletionPaths.size === 1 ? "" : "s"} from Storage after confirming no project uses them.
              </p>
            )}
            <div className="admin-confirm-actions">
              <button
                className="admin-button admin-button-quiet"
                disabled={actionBusy}
                onClick={() => setCommitPromptOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="admin-button admin-button-primary"
                disabled={actionBusy}
                onClick={() => {
                  setCommitPromptOpen(false);
                  void commit();
                }}
                type="button"
              >
                Commit changes
              </button>
            </div>
          </section>
        </div>
      )}

      {authenticated && deleteTarget && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDeleteTarget(null);
        }}>
          <section aria-labelledby="admin-delete-title" aria-modal="true" className="admin-confirm-dialog" role="dialog">
            <h2 id="admin-delete-title">Stage this deletion?</h2>
            <p>
              “{getDisplayName(deleteTarget.table, deleteTarget.row.record)}” will be marked for deletion. It will not be removed from the database until you commit.
              {deleteTarget.table === "contributors" && (() => {
                const contributorId = (deleteTarget.row.record as ProjectContributor).id;
                const projectCount = projects.filter((project) =>
                  project.contributors?.some((contributor) => contributor.id === contributorId),
                ).length;
                const changelogCount = changelogs.filter((changelog) =>
                  changelog.contributors?.some((contributor) => contributor.id === contributorId),
                ).length;
                return (
                  <> Its project and changelog assignments ({projectCount} projects, {changelogCount} changelogs) will also be removed.</>
                );
              })()}
            </p>
            <div className="admin-confirm-actions">
              <button className="admin-button admin-button-quiet" onClick={() => setDeleteTarget(null)} type="button">Cancel</button>
              <button className="admin-button admin-button-danger" onClick={confirmDelete} type="button">Stage removal</button>
            </div>
          </section>
        </div>
      )}

      {authenticated && mediaDeleteTarget && (
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !actionBusy) {
              setMediaDeleteTarget(null);
            }
          }}
        >
          <section
            aria-labelledby="admin-media-delete-title"
            aria-modal="true"
            className="admin-confirm-dialog"
            role="dialog"
          >
            <h2 id="admin-media-delete-title">Delete this media?</h2>
            <p>
              “{mediaDeleteTarget.name}” will be removed from Storage and unlinked from{" "}
              {availableProjects.filter((project) =>
                projectUsesStorageMedia(
                  project,
                  mediaDeleteTarget.path,
                  availableChangelogs,
                ),
              ).length}{" "}
              project(s). The removal is staged and takes effect when you commit.
            </p>
            <div className="admin-confirm-actions">
              <button
                className="admin-button admin-button-quiet"
                disabled={actionBusy}
                onClick={() => setMediaDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="admin-button admin-button-danger"
                disabled={actionBusy}
                onClick={confirmMediaDelete}
                type="button"
              >
                Stage deletion
              </button>
            </div>
          </section>
        </div>
      )}

      {authenticated && pendingNavigation && (
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !actionBusy) {
              setPendingNavigation(null);
              setError("");
            }
          }}
        >
          <section
            aria-labelledby="admin-navigation-title"
            aria-modal="true"
            className="admin-confirm-dialog admin-navigation-dialog"
            role="dialog"
          >
            <h2 id="admin-navigation-title">Save changes before leaving?</h2>
            {pendingTargetIsInsert ? (
              <p>
                The selected new record is part of these {stagedCount} staged change{stagedCount === 1 ? "" : "s"}. Discarding will remove it and open a fresh blank form instead.
              </p>
            ) : (
              <p>
                You have {stagedCount} staged change{stagedCount === 1 ? "" : "s"}. Commit them before opening{" "}
                <strong>{pendingNavigation.operation === "insert"
                  ? pendingNavigation.table === "projects"
                    ? "a new project"
                    : pendingNavigation.table === "project_changelogs"
                      ? "a new changelog"
                      : "a new contributor"
                  : getDisplayName(pendingNavigation.table, pendingNavigation.record)}</strong>,
                or discard them and continue.
              </p>
            )}
            {commitOutcomeUnknown && (
              <p className="admin-navigation-warning">
                The previous commit outcome is unknown. Refresh and verify it before committing again.
              </p>
            )}
            {error && <p className="admin-form-error">{error}</p>}
            <div className="admin-confirm-actions">
              <button
                className="admin-button admin-button-quiet"
                disabled={actionBusy}
                onClick={() => {
                  setPendingNavigation(null);
                  setError("");
                }}
                type="button"
              >
                Stay here
              </button>
              <button
                className="admin-button admin-button-danger"
                disabled={actionBusy}
                onClick={discardAndContinue}
                type="button"
              >
                Discard &amp; continue
              </button>
              <button
                className="admin-button admin-button-primary"
                disabled={actionBusy || commitOutcomeUnknown}
                onClick={() => void commitAndContinue()}
                type="button"
              >
                {actionBusy ? "Committing…" : "Commit & continue"}
              </button>
            </div>
          </section>
        </div>
      )}

      {mediaPicker && (
        <MediaPickerDialog
          pendingUploads={pendingUploads}
          onQueueUpload={prepareUploads}
          onSelect={(reference) => {
            mediaPicker(reference);
            setMediaPicker(null);
          }}
          onClose={() => setMediaPicker(null)}
        />
      )}
    </main>
  );
}

type EditorState =
  | {
      table: "projects";
      key: string;
      operation: Operation;
      record: ProjectDraft;
    }
  | {
      table: "project_changelogs";
      key: string;
      operation: Operation;
      record: ChangelogDraft;
    }
  | {
      table: "contributors";
      key: string;
      operation: Operation;
      record: ContributorDraft;
    };

type PendingNavigation = EditorState;
