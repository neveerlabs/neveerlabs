import { createClient } from "@supabase/supabase-js";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { basename, dirname, extname } from "node:path";

interface AdminRequest extends AsyncIterable<Uint8Array> {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface AdminResponse {
  status(code: number): AdminResponse;
  setHeader(
    name: string,
    value: string | number | readonly string[],
  ): AdminResponse;
  json(body: unknown): AdminResponse;
}

type Environment = Record<string, string | undefined>;

const cookieName = "neverlabs_admin_session";
const sessionDurationSeconds = 30 * 60;
const maxRequestBytes = 4 * 1024 * 1024;
const storageBucket = "project-media";
const uploadTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webm": "video/webm",
  ".webp": "image/webp",
};
const failedLogins = new Map<string, { count: number; resetAt: number }>();

function header(request: AdminRequest, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function respond(
  response: AdminResponse,
  status: number,
  body: unknown,
): void {
  response.status(status).json(body);
}

async function readJsonBody(request: AdminRequest): Promise<unknown> {
  if (request.body !== undefined) {
    if (typeof request.body === "string") {
      if (Buffer.byteLength(request.body) > maxRequestBytes) {
        throw new Error("Request body is too large.");
      }
      return JSON.parse(request.body);
    }
    if (Buffer.isBuffer(request.body)) {
      if (request.body.byteLength > maxRequestBytes) {
        throw new Error("Request body is too large.");
      }
      return JSON.parse(request.body.toString("utf8"));
    }
    if (Buffer.byteLength(JSON.stringify(request.body)) > maxRequestBytes) {
      throw new Error("Request body is too large.");
    }
    return request.body;
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > maxRequestBytes) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function requestUrl(request: AdminRequest): URL {
  return new URL(
    request.url ?? "/api/admin",
    `http://${header(request, "host") || "localhost"}`,
  );
}

function isSameOrigin(request: AdminRequest, env: Environment): boolean {
  const origin = header(request, "origin");
  const host = header(request, "host");
  if (!origin || !host) return false;

  try {
    const protocol =
      header(request, "x-forwarded-proto").split(",")[0] ||
      (env.NODE_ENV === "production" ? "https" : "http");
    const parsedOrigin = new URL(origin);
    return (
      parsedOrigin.host.toLowerCase() === host.toLowerCase() &&
      parsedOrigin.protocol === `${protocol}:`
    );
  } catch {
    return false;
  }
}

function sessionSecret(env: Environment): string | null {
  return env.ADMIN_SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sessionSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function getCookie(request: AdminRequest): string | null {
  const cookies = header(request, "cookie").split(";");
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name === cookieName) return valueParts.join("=") || null;
  }
  return null;
}

function hasValidSession(request: AdminRequest, env: Environment): boolean {
  const secret = sessionSecret(env);
  const token = getCookie(request);
  if (!secret || !token) return false;

  const [expiresAt, nonce, signature, ...rest] = token.split(".");
  if (
    rest.length > 0 ||
    !expiresAt ||
    !nonce ||
    !signature ||
    Number(expiresAt) <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  return safeEqual(
    signature,
    sessionSignature(`${expiresAt}.${nonce}`, secret),
  );
}

function setSessionCookie(
  request: AdminRequest,
  response: AdminResponse,
  env: Environment,
): void {
  const secret = sessionSecret(env);
  if (!secret) throw new Error("Admin session signing is not configured.");

  const expiresAt = Math.floor(Date.now() / 1000) + sessionDurationSeconds;
  const payload = `${expiresAt}.${randomUUID()}`;
  const token = `${payload}.${sessionSignature(payload, secret)}`;
  const secure =
    env.NODE_ENV === "production" ||
    header(request, "x-forwarded-proto").split(",")[0] === "https";
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${sessionDurationSeconds}${secure ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(
  request: AdminRequest,
  response: AdminResponse,
  env: Environment,
): void {
  const secure =
    env.NODE_ENV === "production" ||
    header(request, "x-forwarded-proto").split(",")[0] === "https";
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}

function getClientKey(request: AdminRequest): string {
  return (
    header(request, "x-forwarded-for").split(",")[0]?.trim() ||
    header(request, "x-real-ip") ||
    "unknown"
  );
}

function isLoginBlocked(request: AdminRequest): boolean {
  const entry = failedLogins.get(getClientKey(request));
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failedLogins.delete(getClientKey(request));
    return false;
  }
  return entry.count >= 5;
}

function recordFailedLogin(request: AdminRequest): void {
  const key = getClientKey(request);
  const current = failedLogins.get(key);
  if (!current || current.resetAt <= Date.now()) {
    failedLogins.set(key, {
      count: 1,
      resetAt: Date.now() + 15 * 60 * 1000,
    });
    return;
  }
  current.count += 1;
}

function validateStoragePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("admin/") &&
    !path.includes("\\") &&
    path.split("/").every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function getSupabase(env: Environment) {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server credentials are not configured.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getAllRows(
  supabase: ReturnType<typeof getSupabase>,
  table: "projects" | "project_changelogs",
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const query = supabase
      .from(table)
      .select("*")
      .order(table === "projects" ? "sort_order" : "released_at", {
        ascending: table === "projects",
      })
      .range(offset, offset + pageSize - 1);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

function getFileName(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 255) return null;
  const name = basename(value).replace(/[\\/]/g, "-").normalize("NFKC");
  const extension = extname(name).toLowerCase();
  if (!uploadTypes[extension]) return null;
  return name;
}

function safeStoragePrefix(value: string | null): string | null {
  if (!value) return "";
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return value;
}

function isCommitChange(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const change = value as Record<string, unknown>;
  if (
    !["projects", "project_changelogs"].includes(String(change.table)) ||
    !["insert", "update", "delete"].includes(String(change.operation))
  ) {
    return false;
  }

  if (change.operation === "delete") {
    return typeof change.id === "string";
  }
  return Boolean(change.record) && typeof change.record === "object" && !Array.isArray(change.record);
}

export async function handleAdminRequest(
  request: AdminRequest,
  response: AdminResponse,
  env: Environment = process.env,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");

  const url = requestUrl(request);
  const action = url.pathname.replace(/\/+$/, "").slice("/api/admin".length) || "/";
  const method = request.method ?? "GET";

  if (method === "POST" && !isSameOrigin(request, env)) {
    respond(response, 403, { error: "Request origin is not allowed." });
    return;
  }

  if (method === "POST" && action === "/login") {
    if (isLoginBlocked(request)) {
      respond(response, 429, { error: "Too many attempts. Try again in 15 minutes." });
      return;
    }

    const password = env.ADMIN_PASSWORD;
    const secret = sessionSecret(env);
    if (!password || !secret) {
      respond(response, 503, {
        error: "Admin access is not configured. Set ADMIN_PASSWORD in the server environment.",
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const suppliedPassword =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).password
          : null;
      if (
        typeof suppliedPassword !== "string" ||
        suppliedPassword.length > 1024 ||
        !safeEqual(suppliedPassword, password)
      ) {
        recordFailedLogin(request);
        respond(response, 401, { error: "Password is incorrect." });
        return;
      }

      failedLogins.delete(getClientKey(request));
      setSessionCookie(request, response, env);
      respond(response, 200, { authenticated: true });
    } catch (error) {
      respond(response, 400, {
        error: error instanceof Error ? error.message : "Invalid request body.",
      });
    }
    return;
  }

  if (method === "POST" && action === "/logout") {
    clearSessionCookie(request, response, env);
    respond(response, 200, { authenticated: false });
    return;
  }

  if (!hasValidSession(request, env)) {
    respond(response, 401, { error: "Admin authentication is required." });
    return;
  }

  try {
    const supabase = getSupabase(env);

    if (method === "GET" && action === "/projects") {
      respond(response, 200, await getAllRows(supabase, "projects"));
      return;
    }

    if (method === "GET" && action === "/changelogs") {
      respond(response, 200, await getAllRows(supabase, "project_changelogs"));
      return;
    }

    if (method === "GET" && action === "/media") {
      const prefix = safeStoragePrefix(url.searchParams.get("path"));
      if (prefix === null) {
        respond(response, 400, { error: "Invalid media folder." });
        return;
      }
      const parsedOffset = Number(url.searchParams.get("offset") ?? 0);
      const offset =
        Number.isSafeInteger(parsedOffset) && parsedOffset >= 0
          ? parsedOffset
          : 0;
      const { data, error } = await supabase.storage
        .from(storageBucket)
        .list(prefix, {
          limit: 100,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      if (error) throw error;

      const items = (data ?? []).map((item) => {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        const isFolder = item.id === null;
        return {
          name: item.name,
          path,
          type: isFolder ? "folder" : "file",
          size: item.metadata?.size ?? null,
          contentType: item.metadata?.mimetype ?? null,
          publicUrl: isFolder
            ? null
            : supabase.storage.from(storageBucket).getPublicUrl(path).data.publicUrl,
        };
      });
      respond(response, 200, {
        items,
        nextOffset: (data?.length ?? 0) === 100 ? offset + 100 : null,
      });
      return;
    }

    if (method === "POST" && action === "/media/prepare") {
      const body = await readJsonBody(request);
      const fileName =
        body && typeof body === "object" && !Array.isArray(body)
          ? getFileName((body as Record<string, unknown>).name)
          : null;
      if (!fileName) {
        respond(response, 400, {
          error: "Choose an image or video file with a supported extension.",
        });
        return;
      }

      const year = new Date().getUTCFullYear();
      const objectPath = `admin/${year}/${randomUUID()}-${fileName}`;
      const publicUrl = supabase.storage
        .from(storageBucket)
        .getPublicUrl(objectPath).data.publicUrl;
      respond(response, 200, {
        path: objectPath,
        publicUrl,
        contentType: uploadTypes[extname(fileName).toLowerCase()],
      });
      return;
    }

    if (method === "POST" && action === "/media/upload-url") {
      const body = await readJsonBody(request);
      const objectPath =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).path
          : null;
      if (!validateStoragePath(objectPath)) {
        respond(response, 400, { error: "Invalid pending media path." });
        return;
      }
      const extension = extname(objectPath.split("/").at(-1) ?? "").toLowerCase();
      const contentType = uploadTypes[extension];
      if (!contentType) {
        respond(response, 400, { error: "Unsupported media file type." });
        return;
      }

      const fileName = basename(objectPath);
      const folder = dirname(objectPath);
      const { data: existingFiles, error: listError } = await supabase.storage
        .from(storageBucket)
        .list(folder, { limit: 5, search: fileName });
      if (listError) throw listError;
      const publicUrl = supabase.storage
        .from(storageBucket)
        .getPublicUrl(objectPath).data.publicUrl;
      if (existingFiles?.some((file) => file.name === fileName && file.id !== null)) {
        respond(response, 200, {
          alreadyUploaded: true,
          contentType,
          publicUrl,
        });
        return;
      }

      const { data, error } = await supabase.storage
        .from(storageBucket)
        .createSignedUploadUrl(objectPath, { upsert: false });
      if (error) throw error;
      respond(response, 200, {
        signedUrl: data.signedUrl,
        contentType,
        publicUrl,
      });
      return;
    }

    if (method === "POST" && action === "/media/cleanup") {
      const body = await readJsonBody(request);
      const paths =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).paths
          : null;
      if (
        !Array.isArray(paths) ||
        paths.length > 1000 ||
        !paths.every(validateStoragePath)
      ) {
        respond(response, 400, { error: "Invalid media cleanup request." });
        return;
      }
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error } = await supabase.storage
          .from(storageBucket)
          .remove(paths.slice(offset, offset + 100));
        if (error) throw error;
      }
      respond(response, 200, { removed: paths.length });
      return;
    }

    if (method === "POST" && action === "/commit") {
      const body = await readJsonBody(request);
      const changes =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).changes
          : null;
      if (
        !Array.isArray(changes) ||
        changes.length === 0 ||
        changes.length > 500 ||
        !changes.every(isCommitChange)
      ) {
        respond(response, 400, {
          error: "Commit must contain between 1 and 500 valid row changes.",
        });
        return;
      }

      const { data, error } = await supabase.rpc("apply_projects_commit", {
        p_changes: changes,
      });
      if (error) {
        respond(response, 400, { error: `Database rejected the commit: ${error.message}` });
        return;
      }
      respond(response, 200, data);
      return;
    }

    if (method !== "GET" && method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      respond(response, 405, { error: "Method not allowed." });
      return;
    }

    respond(response, 404, { error: "Admin API endpoint not found." });
  } catch (error) {
    console.error(
      "Admin API request failed:",
      error instanceof Error ? error.message : String(error),
    );
    respond(response, 500, { error: "Admin request failed. Check the server logs." });
  }
}
