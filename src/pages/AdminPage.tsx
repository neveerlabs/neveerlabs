import {
  useCallback,
  useEffect,
  useMemo,
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
  FileText,
  Folder,
  FolderKanban,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  Language,
  Project,
  ProjectChangelog,
  ProjectContributor,
  ProjectPlatform,
} from "../types/projects";
import { MarkdownContent } from "../components/MarkdownContent";
import { isVideoMedia } from "../components/MediaThumbnail";
import "./AdminPage.css";

type TableName = "projects" | "project_changelogs";
type SectionName = "projects" | "changelogs";
type Operation = "insert" | "update" | "delete";
type ProjectRow = Omit<Project, "changelogs">;
type ProjectDraft = Omit<ProjectRow, "id"> & { id?: string };
type ChangelogDraft = Omit<ProjectChangelog, "id"> & { id?: string };
type DraftRecord = ProjectDraft | ChangelogDraft;

interface VisibleRow {
  key: string;
  record: ProjectRow | ProjectChangelog | DraftRecord;
  operation?: Operation;
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
  "stable",
  "latest",
  "pre-release",
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
  record: ProjectRow | ProjectChangelog | DraftRecord,
): string {
  if (isProjectTable(table)) return (record as ProjectRow | ProjectDraft).name || "Untitled project";
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
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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

function parseContributors(
  value: string,
  previous: ProjectContributor[] | null | undefined,
): ProjectContributor[] {
  const existing = new Map((previous ?? []).map((contributor) => [contributor.name, contributor]));
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const contributor = existing.get(name);
      return contributor?.url ? { name, url: contributor.url } : { name };
    });
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

function MediaPreview({
  value,
  pendingUploads,
}: {
  value: string;
  pendingUploads: Map<string, PendingUpload>;
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
    : isVideoMedia(source);
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
    <Field label={label} hint="Images are uploaded from Storage only when you commit.">
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
    <Field label={label} hint="Use a raw file URL or select a file from Storage.">
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
    </Field>
  );
}

function ProjectEditor({
  initial,
  isNew,
  pendingUploads,
  onChange,
  onBrowseMedia,
}: {
  initial: ProjectDraft;
  isNew: boolean;
  pendingUploads: Map<string, PendingUpload>;
  onChange: (record: ProjectDraft) => void;
  onBrowseMedia: (onPick: (reference: string) => void) => void;
}) {
  const [record, setRecord] = useState<ProjectDraft>(() => structuredClone(initial));
  const [contributorsText, setContributorsText] = useState(() =>
    initial.contributors?.map((contributor) => contributor.name).join(", ") ?? "",
  );
  const update = (patch: Partial<ProjectDraft>) => {
    const next = { ...record, ...patch };
    setRecord(next);
    onChange({
      ...next,
      contributors: parseContributors(contributorsText, initial.contributors),
    });
  };
  const updateDescription = (language: Language, value: string) =>
    update({ description: { ...record.description, [language]: value } });
  const updateContributors = (value: string) => {
    setContributorsText(value);
    onChange({
      ...record,
      contributors: parseContributors(value, initial.contributors),
    });
  };

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
          <Field label="Contributors" hint="Separate names with commas">
            <input className="admin-input" value={contributorsText} onChange={(event) => updateContributors(event.target.value)} placeholder="neverlabs, Sara" />
          </Field>
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
  pendingUploads,
  onChange,
  onBrowseMedia,
}: {
  initial: ChangelogDraft;
  isNew: boolean;
  projects: ProjectRow[];
  pendingUploads: Map<string, PendingUpload>;
  onChange: (record: ChangelogDraft) => void;
  onBrowseMedia: (onPick: (reference: string) => void) => void;
}) {
  const [record, setRecord] = useState<ChangelogDraft>(() => structuredClone(initial));
  const [contributorsText, setContributorsText] = useState(() =>
    initial.contributors?.map((contributor) => contributor.name).join(", ") ?? "",
  );
  const update = (patch: Partial<ChangelogDraft>) => {
    const next = { ...record, ...patch };
    setRecord(next);
    onChange({
      ...next,
      contributors: parseContributors(contributorsText, initial.contributors),
    });
  };
  const updateDescription = (language: Language, value: string) =>
    update({ description: { ...record.description, [language]: value } });
  const updateContributors = (value: string) => {
    setContributorsText(value);
    onChange({
      ...record,
      contributors: parseContributors(value, initial.contributors),
    });
  };

  return (
    <div className="admin-editor">
      <div className="admin-form-section">
        <h3>{isNew ? "New changelog" : "Release details"}</h3>
        <div className="admin-form-grid">
          <Field label="Project">
            <select className="admin-input" value={record.project_id} onChange={(event) => update({ project_id: event.target.value })}>
              <option value="">Choose a project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
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
          <Field label="Contributors" hint="Separate names with commas">
            <input className="admin-input" value={contributorsText} onChange={(event) => updateContributors(event.target.value)} placeholder="neverlabs, Sara" />
          </Field>
        </div>
        <Field label="Description">
          <MarkdownEditor value={record.description} onChange={updateDescription} />
        </Field>
      </div>

      <div className="admin-form-section">
        <h3>Media</h3>
        <MediaListEditor
          label="Release media"
          value={record.media}
          pendingUploads={pendingUploads}
          onChange={(media) => update({ media })}
          onBrowse={onBrowseMedia}
        />
      </div>

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

function getRowSubtitle(
  section: SectionName,
  record: ProjectRow | ProjectChangelog | DraftRecord,
  projects: ProjectRow[],
): string {
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
  const [expandedSections, setExpandedSections] = useState<Record<SectionName, boolean>>({
    projects: true,
    changelogs: true,
  });
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
  const [staged, setStaged] = useState<Map<string, StagedChange>>(new Map());
  const [pendingUploads, setPendingUploads] = useState<Map<string, PendingUpload>>(new Map());
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [mediaPicker, setMediaPicker] = useState<((reference: string) => void) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [commitPromptOpen, setCommitPromptOpen] = useState(false);
  const [commitOutcomeUnknown, setCommitOutcomeUnknown] = useState(false);

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
    ])
      .then(([projectRows, changelogRows]) => {
        if (!active) return;
        setProjects(projectRows);
        setChangelogs(changelogRows);
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

  const rows = section === "projects" ? visibleProjects : visibleChangelogs;
  const activeProjectId = editor?.table === "projects"
    ? editor.record.id ?? null
    : editor?.table === "project_changelogs"
      ? editor.record.project_id || null
      : null;
  const availableProjects = visibleProjects
    .map((row) => row.record as ProjectRow)
    .filter((project) => project.id);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matchesRecord = (table: TableName, row: VisibleRow) => {
    if (!normalizedSearch) return true;
    const recordSection = table === "projects" ? "projects" : "changelogs";
    const searchableText = [
      getDisplayName(table, row.record),
      getRowSubtitle(recordSection, row.record, availableProjects),
    ].join(" ").toLocaleLowerCase();
    return searchableText.includes(normalizedSearch);
  };
  const matchingRows = rows.filter((row) =>
    matchesRecord(section === "projects" ? "projects" : "project_changelogs", row),
  );
  const sidebarRowsFor = (table: TableName) => {
    const tableRows = table === "projects"
      ? visibleProjects
      : activeProjectId
        ? visibleChangelogs.filter(
            (row) => (row.record as ProjectChangelog | ChangelogDraft).project_id === activeProjectId,
          )
        : visibleChangelogs;
    return tableRows.filter((row) => matchesRecord(table, row));
  };
  const stagedCount = staged.size;

  const openEditor = (nextEditor: EditorState, preserveFeedback = false) => {
    const nextSection = nextEditor.table === "projects" ? "projects" : "changelogs";
    setSection(nextSection);
    setExpandedSections((current) => ({ ...current, [nextSection]: true }));
    setSelectedKey(nextEditor.key);
    setEditor(nextEditor);
    setMediaPicker(null);
    if (!preserveFeedback) {
      setError("");
      setNotice("");
    }
  };

  const requestEditorNavigation = (nextEditor: EditorState) => {
    if (editor?.table === nextEditor.table && editor.key === nextEditor.key) return;
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
      const [projectRows, changelogRows] = await Promise.all([
        adminRequest<ProjectRow[]>("/api/admin/projects"),
        adminRequest<ProjectChangelog[]>("/api/admin/changelogs"),
      ]);
      setProjects(projectRows);
      setChangelogs(changelogRows);
      setNotice(commitOutcomeUnknown
        ? "Data refreshed. Verify the previous commit in Supabase before allowing a retry."
        : "Data refreshed from Supabase.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to refresh data.");
    } finally {
      setDataLoading(false);
    }
  };

  const startNewRecord = (table: TableName) => {
    const key = `new:${crypto.randomUUID()}`;
    const draft = changelogDraft();
    if (activeProjectId) draft.project_id = activeProjectId;
    requestEditorNavigation(table === "projects"
      ? { table, key, operation: "insert", record: projectDraft() }
      : { table, key, operation: "insert", record: draft });
  };

  const startEditRecord = (table: TableName, row: VisibleRow) => {
    const operation = row.operation === "insert" ? "insert" : "update";
    requestEditorNavigation(table === "projects"
      ? {
          table,
          key: row.key,
          operation,
          record: projectDraft(row.record as ProjectRow),
        }
      : {
          table,
          key: row.key,
          operation,
          record: changelogDraft(row.record as ProjectChangelog),
        });
  };

  const saveRecord = (table: TableName, key: string, operation: Operation, record: DraftRecord) => {
    const next = new Map(staged);
    const index = compoundKey(table, key);
    const existing = next.get(index);
    const isNew = operation === "insert" || existing?.operation === "insert";
    const serverRecord = table === "projects"
      ? projects.find((item) => item.id === key)
      : changelogs.find((item) => item.id === key);
    if (!isNew && serverRecord && JSON.stringify(serverRecord) === JSON.stringify(record)) {
      next.delete(index);
    } else {
      next.set(index, {
        table,
        operation: isNew ? "insert" : "update",
        key,
        id: isNew ? undefined : key,
        record,
        label: getDisplayName(table, record),
      });
    }
    setStaged(next);
    setSelectedKey(key);
    setError("");
    setNotice("");
  };

  const requestDeleteRecord = (table: TableName, row: VisibleRow) => {
    setDeleteTarget({ table, row });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const { table, row } = deleteTarget;
    const label = getDisplayName(table, row.record);
    const next = new Map(staged);
    const key = compoundKey(table, row.key);
    const current = next.get(key);
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
      const reference = `${pendingPrefix}${crypto.randomUUID()}`;
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
            throw new Error(`Storage upload failed (${response.status}) for ${upload.file.name}.`);
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
    if (staged.size === 0 || commitOutcomeUnknown || actionBusy) return false;
    if (staged.size > 500) {
      setError("A single database commit supports up to 500 row changes.");
      return false;
    }
    const invalidChange = [...staged.values()].find((change) => {
      if (change.operation === "delete" || !change.record) return false;
      if ("name" in change.record) return !change.record.name.trim();
      return !change.record.project_id || !change.record.title.trim() || !change.record.version.trim();
    });
    if (invalidChange) {
      setError(invalidChange.table === "projects"
        ? "Project name is required before committing."
        : "A changelog needs a project, title, and version before committing.");
      return false;
    }
    setActionBusy(true);
    setError("");
    setNotice("");
    const changes = [...staged.values()];
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

    const payload = changes.map((change) =>
      change.operation === "delete"
        ? { table: change.table, operation: "delete", id: change.id }
        : {
            table: change.table,
            operation: change.operation,
            record: replacePendingReferences(change.record, pendingUploads),
          },
    );

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
    setPendingUploads(new Map());
    setEditor(null);
    setSelectedKey(null);
    setNotice("All staged rows were committed in one database transaction.");
    await refresh();
    setActionBusy(false);
    return true;
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
    if (target.table === "projects") {
      const record = replacePendingReferences(target.record, uploads);
      if (target.operation === "insert") {
        if (!record.id) {
          setError("The committed record is missing its ID. Refresh the table before editing it.");
          setEditor(null);
          setSelectedKey(null);
          return;
        }
        openEditor({ table: "projects", key: record.id, operation: "update", record }, true);
      } else {
        openEditor({ ...target, record }, true);
      }
      return;
    }
    const record = replacePendingReferences(target.record, uploads);
    if (target.operation === "insert") {
      if (!record.id) {
        setError("The committed record is missing its ID. Refresh the table before editing it.");
        setEditor(null);
        setSelectedKey(null);
        return;
      }
      openEditor({ table: "project_changelogs", key: record.id, operation: "update", record }, true);
      return;
    }
    openEditor({ ...target, record }, true);
  };

  const discardAndContinue = () => {
    if (!pendingNavigation || actionBusy) return;
    const target = pendingNavigation;
    const targetChange = staged.get(compoundKey(target.table, target.key));
    let targetEditor = target;
    if (targetChange?.operation === "insert") {
      const key = `new:${crypto.randomUUID()}`;
      targetEditor = target.table === "projects"
        ? { table: "projects", key, operation: "insert", record: projectDraft() }
        : { table: "project_changelogs", key, operation: "insert", record: changelogDraft() };
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
    }
    setStaged(new Map());
    setPendingUploads(new Map());
    setPendingNavigation(null);
    setError("");
    setNotice("Staged changes discarded.");
    openEditor(targetEditor, true);
  };

  const discardAll = () => {
    if (staged.size === 0) return;
    if (!window.confirm("Discard every staged change? No database changes have been made yet.")) return;
    setStaged(new Map());
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
    `${change.table === "projects" ? "Project" : "Changelog"} · ${
      change.operation === "insert" ? "New" : change.operation === "update" ? "Edited" : "Delete"
    } · ${change.label}`;
  const pendingTargetIsInsert = pendingNavigation
    ? staged.get(compoundKey(pendingNavigation.table, pendingNavigation.key))?.operation === "insert"
    : false;

  return (
    <main className="admin-app">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/admin/" aria-label="Neverlabs admin home">
          <img src="/images/logo.png" alt="neverlabs" />
        </a>
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
          {([
            { section: "projects" as const, table: "projects" as const, label: "Projects", icon: <FolderKanban size={15} /> },
            { section: "changelogs" as const, table: "project_changelogs" as const, label: "Changelogs", icon: <FileText size={15} /> },
          ]).map((item) => {
            const tableRows = sidebarRowsFor(item.table);
            const expanded = expandedSections[item.section];
            return (
              <div className={`admin-tree-group${section === item.section ? " current" : ""}`} key={item.table}>
                <div className="admin-tree-table-row">
                  <button
                    aria-expanded={expanded}
                    className="admin-tree-table"
                    onClick={() => setExpandedSections((current) => ({
                      ...current,
                      [item.section]: !current[item.section],
                    }))}
                    type="button"
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {item.icon}
                    <span>{item.label}</span>
                    <small>{authenticated ? (item.section === "projects" ? visibleProjects.length : visibleChangelogs.length) : "—"}</small>
                  </button>
                  <button
                    aria-label={`Add ${item.section === "projects" ? "project" : "changelog"}`}
                    className="admin-tree-add"
                    disabled={!authenticated || actionBusy}
                    onClick={() => startNewRecord(item.table)}
                    title={`Add ${item.section === "projects" ? "project" : "changelog"}`}
                    type="button"
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {expanded && authenticated && (
                  <div className="admin-tree-children">
                    {tableRows.length === 0 ? (
                      <span className="admin-tree-empty">
                        {search
                          ? "No matches"
                          : item.table === "project_changelogs" && activeProjectId
                            ? "No changelogs for this project"
                            : "No records"}
                      </span>
                    ) : tableRows.map((row) => (
                      <div className={`admin-tree-record${editor?.table === item.table && selectedKey === row.key ? " selected" : ""}`} key={row.key}>
                        <button
                          className="admin-tree-record-select"
                          onClick={() => {
                            startEditRecord(item.table, row);
                          }}
                          type="button"
                        >
                          <span className="admin-tree-guide" />
                          <span className="admin-tree-record-copy">
                            <strong>{getDisplayName(item.table, row.record)}</strong>
                            <small>{getRowSubtitle(item.section, row.record, availableProjects)}</small>
                          </span>
                          {row.operation && <span className={`admin-row-state admin-row-${row.operation}`}>{row.operation === "insert" ? "new" : row.operation}</span>}
                        </button>
                        <button
                          aria-label={`Stage delete ${getDisplayName(item.table, row.record)}`}
                          className="admin-tree-delete"
                          onClick={() => requestDeleteRecord(item.table, row)}
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
            );
          })}
        </nav>
        <div className="admin-sidebar-footer">
          {authenticated && <button className="admin-lock-button" onClick={logout} type="button"><LogOut size={14} /> Lock workspace</button>}
          <a href="/" target="_blank" rel="noreferrer"><ArrowUpRight size={15} /> Open website</a>
        </div>
      </aside>

      <section className="admin-workspace">
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
              ) : editor?.table === "projects" ? (
                  <ProjectEditor
                    key={editor.key}
                    initial={editor.record}
                    isNew={editor.operation === "insert"}
                    pendingUploads={pendingUploads}
                    onChange={(record) => saveRecord("projects", editor.key, editor.operation, record)}
                    onBrowseMedia={(onPick) => setMediaPicker(() => onPick)}
                  />
                ) : editor?.table === "project_changelogs" ? (
                  <ChangelogEditor
                    key={editor.key}
                    initial={editor.record}
                    isNew={editor.operation === "insert"}
                    projects={availableProjects}
                    pendingUploads={pendingUploads}
                    onChange={(record) => saveRecord("project_changelogs", editor.key, editor.operation, record)}
                    onBrowseMedia={(onPick) => setMediaPicker(() => onPick)}
                  />
                ) : (
                  <div className="admin-detail-empty">
                    <div><ArrowDownToLine size={21} /></div>
                      <strong>{matchingRows.length ? "Choose a record to edit" : search ? "No records match" : "No records yet"}</strong>
                      <span>{matchingRows.length ? "Select a file in the sidebar to open its editor." : search ? "Try a different search." : "Add a record with the plus button beside its table."}</span>
                  </div>
                )}
            </section>

            <footer className="admin-commit-bar">
              <div className="admin-commit-summary">
                <span className={`admin-change-count${stagedCount ? " has-changes" : ""}`}>{stagedCount}</span>
                <span><strong>{stagedCount ? "staged changes" : "No pending changes"}</strong><small>Edits stay local until committed</small></span>
              </div>
              {stagedCount > 0 && (
                <details className="admin-change-review">
                  <summary>Review changes</summary>
                  <div className="admin-change-review-list">
                    {[...staged.values()].map((change) => (
                      <div key={stageKey(change)}>
                        <span>{stageDescription(change)}</span>
                        <button type="button" onClick={() => removeStagedChange(change)} aria-label={`Discard ${change.label}`}><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className="admin-commit-actions">
                {stagedCount > 0 && <button className="admin-button admin-button-quiet" type="button" onClick={discardAll} disabled={actionBusy}>Discard all</button>}
                <button className="admin-button admin-button-primary" type="button" disabled={!stagedCount || actionBusy} onClick={() => commitOutcomeUnknown ? allowCommitRetry() : setCommitPromptOpen(true)}>
                  {actionBusy ? <LoaderCircle className="admin-spinning" size={16} /> : <Check size={16} />}
                  {actionBusy ? "Committing…" : commitOutcomeUnknown ? "Review uncertain commit" : "Commit changes"}
                </button>
              </div>
            </footer>
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
            <p>
              Commit {stagedCount} staged change{stagedCount === 1 ? "" : "s"} to the database in one transaction.
            </p>
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
            </p>
            <div className="admin-confirm-actions">
              <button className="admin-button admin-button-quiet" onClick={() => setDeleteTarget(null)} type="button">Cancel</button>
              <button className="admin-button admin-button-danger" onClick={confirmDelete} type="button">Stage removal</button>
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
                  ? pendingNavigation.table === "projects" ? "a new project" : "a new changelog"
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
    };

type PendingNavigation = EditorState;
