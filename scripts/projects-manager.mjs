import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storageBucket = "project-media";

const tableNames = {
  projects: "projects",
  changelogs: "project_changelogs",
  contributors: "contributors",
};
const platformValues = [
  "web",
  "mobile application",
  "desktop application",
  "cli",
  "other",
];
const releaseValues = ["latest", "pre-release", "none"];
const pendingPrefix = "__neverlabs_pending_upload__:";
const maxPageSize = 50;

const mediaTypes = {
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

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
const readline = createInterface({ input: stdin, output: stdout });
const staged = new Map();
const pendingUploads = new Map();
const pendingUploadByPath = new Map();
let commitOutcomeUnknown = false;

class InputClosedError extends Error {}

async function ask(prompt, { trim = true } = {}) {
  try {
    const answer = await readline.question(prompt);
    return trim ? answer.trim() : answer;
  } catch (error) {
    if (error instanceof Error && error.message === "readline was closed") {
      throw new InputClosedError();
    }
    throw error;
  }
}

function reportError(error) {
  return error instanceof Error ? error.message : String(error);
}

function stageKey(table, id) {
  return `${table}:${id}`;
}

function displayMediaReference(reference) {
  if (typeof reference !== "string") return String(reference);
  if (reference.startsWith(pendingPrefix)) {
    const upload = pendingUploads.get(reference);
    return upload ? `[unggah saat commit] ${upload.name}` : "[unggahan tertunda]";
  }

  try {
    return decodeURIComponent(basename(new URL(reference).pathname));
  } catch {
    return reference;
  }
}

async function askMultilineText(label, currentValue = "") {
  console.log(`\n${label}: tempel/ketik teks, lalu akhiri dengan :done.`);
  console.log("Ketik :keep untuk mempertahankan isi, atau :clear untuk mengosongkan.");
  const lines = [];
  let firstLine = true;
  while (true) {
    const line = await ask("  ", { trim: false });
    if (firstLine && line === ":keep") return currentValue;
    if (firstLine && line === ":clear") return "";
    if (line === ":done") return lines.join("\n");
    lines.push(line);
    firstLine = false;
  }
}

async function askDescription(currentValue = { en: "", zh: "" }) {
  const en = await askMultilineText("Deskripsi EN", currentValue.en);
  const zh = await askMultilineText("Deskripsi ZH", currentValue.zh);
  return { en, zh };
}

async function askStringArray(label, currentValue = []) {
  const current = currentValue === null ? "null" : currentValue.join(", ") || "—";
  const answer = await ask(
    `${label} [${current}] (pisahkan dengan koma, :clear untuk kosong): `,
  );
  if (!answer) return currentValue;
  if (answer.toLowerCase() === ":null") return null;
  if (answer.toLowerCase() === ":clear") return [];
  return answer.split(",").map((item) => item.trim()).filter(Boolean);
}

async function askText(label, current, { nullable = false } = {}) {
  const suffix = nullable ? " (ketik null untuk mengosongkan)" : "";
  const answer = await ask(`${label} [${current ?? ""}]${suffix}: `);
  if (!answer) return current;
  if (nullable && answer.toLowerCase() === "null") return null;
  return answer;
}

async function askChoice(label, values, current) {
  console.log(`${label}: ${values.join(" / ")}`);
  while (true) {
    const answer = await ask(`Pilih nilai [${current ?? "kosong"}]: `);
    if (!answer) return current;
    if (answer.toLowerCase() === "null") return null;
    if (values.includes(answer)) return answer;
    console.log("Nilai tidak dikenal.");
  }
}

async function askInteger(label, current) {
  while (true) {
    const answer = await ask(`${label} [${current}]: `);
    if (!answer) return current;
    const value = Number(answer);
    if (Number.isInteger(value)) return value;
    console.log("Masukkan angka bulat.");
  }
}

async function fetchPage(table, offset) {
  const orderColumn = table === tableNames.projects
    ? "created_at"
    : table === tableNames.changelogs
      ? "released_at"
      : "name";
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order(orderColumn, { ascending: table === tableNames.contributors })
    .order("id", { ascending: true })
    .range(offset, offset + maxPageSize - 1);

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function hydrateContributors(table, rows) {
  if (rows.length === 0 || table === tableNames.contributors) return rows;
  const relationTable = table === tableNames.projects
    ? "project_contributors"
    : "changelog_contributors";
  const parentColumn = table === tableNames.projects ? "project_id" : "changelog_id";
  const parentIds = rows.map((row) => row.id);
  const { data: assignments, error: assignmentError } = await supabase
    .from(relationTable)
    .select(`${parentColumn}, contributor_id, position`)
    .in(parentColumn, parentIds)
    .order("position", { ascending: true });
  if (assignmentError) throw new Error(assignmentError.message);

  const contributorIds = [...new Set((assignments ?? []).map((item) => item.contributor_id))];
  if (contributorIds.length === 0) {
    return rows.map((row) => ({ ...row, contributors: [] }));
  }
  const { data: contributors, error: contributorError } = await supabase
    .from(tableNames.contributors)
    .select("id, name, url")
    .in("id", contributorIds);
  if (contributorError) throw new Error(contributorError.message);
  const contributorsById = new Map((contributors ?? []).map((item) => [item.id, item]));
  const byParent = new Map();
  for (const assignment of assignments ?? []) {
    const contributor = contributorsById.get(assignment.contributor_id);
    if (!contributor) continue;
    const list = byParent.get(assignment[parentColumn]) ?? [];
    list.push(contributor);
    byParent.set(assignment[parentColumn], list);
  }
  return rows.map((row) => ({
    ...row,
    contributors: byParent.get(row.id) ?? [],
  }));
}

async function getWorkingRows(table) {
  const rowsById = new Map();
  let offset = 0;

  while (true) {
    const rows = await fetchPage(table, offset);
    for (const row of rows) rowsById.set(row.id, row);
    if (rows.length < maxPageSize) break;
    offset += maxPageSize;
  }

  const hydratedRows = await hydrateContributors(table, [...rowsById.values()]);
  rowsById.clear();
  for (const row of hydratedRows) rowsById.set(row.id, row);

  for (const change of staged.values()) {
    if (change.table !== table) continue;
    const id = change.id ?? change.record.id;
    if (change.operation === "delete") rowsById.delete(id);
    else rowsById.set(id, structuredClone(change.record));
  }

  let rows = [...rowsById.values()];
  if (table === tableNames.changelogs) {
    const deletedProjects = new Set(
      [...staged.values()]
        .filter((change) => change.table === tableNames.projects && change.operation === "delete")
        .map((change) => change.id),
    );
    rows = rows.filter((row) => !deletedProjects.has(row.project_id));
  }

  return rows;
}

function getProjectMediaCount(record) {
  return new Set([record.primary_media, ...(record.media ?? [])].filter(Boolean)).size;
}

function rowTitle(table, row) {
  if (table === tableNames.projects || table === tableNames.contributors) return row.name;
  return `${row.title} · ${row.version}`;
}

function rowSummary(table, row, projectNames) {
  if (table === tableNames.contributors) {
    return `${row.name} · ${row.url || "tanpa URL kontak"} · ${projectNames.get(row.id) ?? "0 project · 0 changelog"}`;
  }
  if (table === tableNames.projects) {
    const platform = row.platform ?? "platform belum diatur";
    const visibility = row.visibility ?? "tanpa visibility";
    return `${row.name} · ${visibility} · ${platform} · ${getProjectMediaCount(row)} media`;
  }

  const projectName = projectNames.get(row.project_id) ?? "proyek tidak tersedia";
  return `${row.title} · ${row.version} · ${row.release} · ${projectName}`;
}

function printRows(table, rows, projectNames = new Map()) {
  const title = table === tableNames.projects
    ? "Projects"
    : table === tableNames.changelogs
      ? "Changelogs"
      : "Contributors";
  console.log(`\n${title} — ${rows.length} data · ${staged.size} perubahan tertunda`);
  if (rows.length === 0) {
    console.log("  Belum ada data.");
  } else {
    rows.forEach((row, index) => {
      const change = staged.get(stageKey(table, row.id));
      const marker = change?.operation === "insert"
        ? "  [baru]"
        : change?.operation === "update"
          ? "  [diedit]"
          : "";
      console.log(`  ${String(index + 1).padStart(2)}. ${rowSummary(table, row, projectNames)}${marker}`);
    });
  }
  console.log("\n  [n] tambah  [v <no>] detail  [e <no>] edit  [d <no>] hapus");
  console.log("  [r] muat ulang  [c] commit semua  [b] kembali");
}

function printText(label, value) {
  console.log(`  ${label}:`);
  const lines = String(value ?? "").split(/\r?\n/);
  if (lines.length === 1 && !lines[0]) {
    console.log("    —");
    return;
  }
  for (const line of lines) console.log(`    ${line}`);
}

function printMedia(label, values) {
  const media = (values ?? []).filter((value) => typeof value === "string");
  console.log(`  ${label} (${media.length}):`);
  if (media.length === 0) {
    console.log("    —");
    return;
  }
  media.forEach((url, index) => {
    const pending = url.startsWith(pendingPrefix);
    console.log(`    ${index + 1}. ${pending ? displayMediaReference(url) : url}`);
    if (pending) {
      const upload = pendingUploads.get(url);
      if (upload?.url) console.log(`       URL setelah upload: ${upload.url}`);
    }
  });
}

function printDescription(description) {
  console.log("  Deskripsi:");
  printText("EN", description?.en);
  printText("ZH", description?.zh);
}

async function printRecordDetails(table, row, projectNames = new Map()) {
  console.log(`\n${rowTitle(table, row)}`);
  console.log("─".repeat(Math.min(72, Math.max(24, rowTitle(table, row).length + 4))));

  if (table === tableNames.contributors) {
    console.log(`  URL kontak: ${row.url || "—"}`);
    const [projects, changelogs] = await Promise.all([
      getWorkingRows(tableNames.projects),
      getWorkingRows(tableNames.changelogs),
    ]);
    const assignedProjects = projects.filter((project) =>
      project.contributors?.some((contributor) => contributor.id === row.id),
    );
    const assignedChangelogs = changelogs.filter((changelog) =>
      changelog.contributors?.some((contributor) => contributor.id === row.id),
    );
    console.log(`  Digunakan di ${assignedProjects.length} project dan ${assignedChangelogs.length} changelog:`);
    for (const project of assignedProjects) console.log(`    - Project: ${project.name}`);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    for (const changelog of assignedChangelogs) {
      console.log(`    - Changelog: ${changelog.title} · ${changelog.version} (${projectNames.get(changelog.project_id) ?? "project tidak tersedia"})`);
    }
    return;
  }

  if (table === tableNames.projects) {
    console.log(`  Visibility: ${row.visibility ?? "—"} · Platform: ${row.platform ?? "—"}`);
    console.log(`  Framework: ${(row.framework ?? []).join(", ") || "—"}`);
    console.log(`  Keywords: ${(row.keyword ?? []).join(", ") || "—"}`);
    console.log(`  URL: ${row.url || "—"}`);
    console.log(`  Dibuat: ${row.created_at || "—"} · Selesai: ${row.completed_at || "ongoing"}`);
    console.log(`  Urutan tampil: ${row.sort_order ?? 0}`);
    console.log(`  Kontributor (${row.contributors?.length ?? 0}):`);
    if (row.contributors?.length) {
      for (const contributor of row.contributors) {
        console.log(`    - ${contributor.name}${contributor.url ? ` · ${contributor.url}` : ""}`);
      }
    } else {
      console.log("    —");
    }
    printMedia("Media utama", row.primary_media ? [row.primary_media] : []);
    printMedia("Media tambahan", row.media);
    printDescription(row.description);
    return;
  }

  console.log(`  Project: ${projectNames.get(row.project_id) ?? "proyek tidak tersedia"}`);
  console.log(`  Rilis: ${row.release} · Dirilis: ${row.released_at}`);
  console.log(`  Kontributor (${row.contributors?.length ?? 0}):`);
  if (row.contributors?.length) {
    for (const contributor of row.contributors) {
      console.log(`    - ${contributor.name}${contributor.url ? ` · ${contributor.url}` : ""}`);
    }
  } else {
    console.log("    —");
  }
  printDescription(row.description);
}

function stageRecord(table, operation, record) {
  const key = stageKey(table, record.id);
  const previous = staged.get(key);
  const nextOperation = previous?.operation === "insert" ? "insert" : operation;
  staged.set(key, { table, operation: nextOperation, record });
  console.log(operation === "insert" ? "Data baru ditambahkan ke antrean." : "Perubahan ditambahkan ke antrean.");
}

function hasStagedContributorAssignments(contributorId) {
  return [...staged.values()].some((change) => {
    if (
      (change.table !== tableNames.projects && change.table !== tableNames.changelogs) ||
      change.operation === "delete" ||
      !change.record
    ) {
      return false;
    }
    return change.record.contributors?.some((contributor) => contributor.id === contributorId) ?? false;
  });
}

function stageDelete(table, record) {
  const { id } = record;
  const key = stageKey(table, id);
  const previous = staged.get(key);
  if (previous?.operation === "insert") {
    if (table === tableNames.contributors && hasStagedContributorAssignments(id)) {
      console.log("Hapus dulu kontributor ini dari project/changelog yang masih tertunda.");
      return;
    }
    staged.delete(key);
    if (table === tableNames.projects) {
      for (const [childKey, change] of staged) {
        if (
          change.table === tableNames.changelogs &&
          change.record?.project_id === id
        ) {
          staged.delete(childKey);
        }
      }
    }
    console.log("Pembuatan dibatalkan; data belum pernah dikirim ke Supabase.");
    return;
  }
  staged.set(key, { table, operation: "delete", id, label: rowTitle(table, record) });
  console.log("Penghapusan ditambahkan ke antrean.");
}

async function selectProjectId() {
  const rows = await getWorkingRows(tableNames.projects);
  if (rows.length === 0) {
    throw new Error("Buat atau simpan dulu satu proyek sebelum menambahkan catatan rilis.");
  }
  console.log("\nPilih proyek terkait:");
  rows.forEach((project, index) => {
    console.log(`  ${index + 1}. ${project.name}`);
  });
  const answer = await ask("Nomor proyek (0 untuk batal): ");
  const index = Number(answer);
  if (index === 0) return null;
  if (!Number.isInteger(index) || index < 1 || index > rows.length) {
    throw new Error("Nomor proyek tidak ditemukan.");
  }
  return rows[index - 1].id;
}

async function chooseContributors(current = []) {
  let selected = [...current];
  while (true) {
    const available = await getWorkingRows(tableNames.contributors);
    console.log("\nKontributor terpilih:");
    if (selected.length === 0) console.log("  —");
    selected.forEach((contributor) => console.log(`  - ${contributor.name}`));
    console.log("\nDaftar kontributor (pilih nomor untuk tambah/hapus):");
    if (available.length === 0) console.log("  Belum ada data kontributor.");
    available.forEach((contributor, index) => {
      const checked = selected.some((item) => item.id === contributor.id) ? "[x]" : "[ ]";
      console.log(`  ${index + 1}. ${checked} ${contributor.name}`);
    });
    console.log("  [n] tambah kontributor baru  [d] selesai  [0] kosongkan pilihan");
    const action = (await ask("Pilihan: ")).toLowerCase();
    if (action === "d") return selected;
    if (action === "0") {
      selected = [];
      continue;
    }
    if (action === "n") {
      const name = await ask("Nama kontributor: ");
      if (!name) {
        console.log("Nama kontributor wajib diisi.");
        continue;
      }
      let url = await askText("URL kontak (opsional; ketik null untuk kosong)", null, { nullable: true });
      while (url && !safeHttpUrl(url)) {
        console.log("URL harus menggunakan http atau https.");
        url = await askText("URL kontak", url, { nullable: true });
      }
      const existing = available.find(
        (item) => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase() &&
          (item.url ?? null) === (url ?? null),
      );
      if (existing) {
        console.log("Kontributor yang sama sudah ada; data yang ada dipilih.");
        if (!selected.some((item) => item.id === existing.id)) selected.push(existing);
      } else {
        const contributor = { id: randomUUID(), name: name.trim(), url: url || null };
        stageRecord(tableNames.contributors, "insert", contributor);
        selected.push(contributor);
      }
      continue;
    }
    const index = Number(action);
    if (!Number.isInteger(index) || index < 1 || index > available.length) {
      console.log("Pilihan tidak dikenal.");
      continue;
    }
    const contributor = available[index - 1];
    selected = selected.some((item) => item.id === contributor.id)
      ? selected.filter((item) => item.id !== contributor.id)
      : [...selected, contributor];
  }
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function safeFileName(filePath) {
  const name = basename(filePath)
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return name || "media";
}

async function registerUpload(rawPath) {
  const inputPath = rawPath.trim().replace(/^(['"])(.*)\1$/, "$2");
  let filePath = inputPath;
  if (filePath === "~") filePath = homedir();
  else if (filePath.startsWith("~/")) filePath = resolve(homedir(), filePath.slice(2));
  else filePath = resolve(filePath);

  const details = await stat(filePath);
  if (!details.isFile()) throw new Error("Path yang dipilih bukan file.");
  const extension = extname(filePath).toLowerCase();
  if (!mediaTypes[extension]) {
    throw new Error("Format tidak didukung. Pilih gambar atau video seperti JPG, PNG, WebP, MP4, MOV, atau WebM.");
  }

  let reference = pendingUploadByPath.get(filePath);
  if (!reference) {
    reference = `${pendingPrefix}${randomUUID()}`;
    const objectPath = `manager/${randomUUID()}-${safeFileName(filePath)}`;
    const url = supabase.storage.from(storageBucket).getPublicUrl(objectPath).data.publicUrl;
    pendingUploadByPath.set(filePath, reference);
    pendingUploads.set(reference, {
      filePath,
      name: basename(filePath),
      extension,
      contentType: mediaTypes[extension],
      objectPath,
      url,
    });
  }
  return reference;
}

async function listStorageMedia(prefix = "", output = []) {
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(storageBucket)
      .list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) throw new Error(error.message);

    for (const item of data ?? []) {
      if (item.name === ".emptyFolderPlaceholder") continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        await listStorageMedia(path, output);
      } else if (mediaTypes[extname(item.name).toLowerCase()]) {
        output.push({
          path,
          url: supabase.storage.from(storageBucket).getPublicUrl(path).data.publicUrl,
        });
      }
    }

    if (!data || data.length < 100) break;
    offset += data.length;
  }

  return output;
}

async function chooseAssets(label, current = [], maximum = Number.POSITIVE_INFINITY) {
  let selected = [...current];
  while (true) {
    console.log(`\n${label}:`);
    if (selected.length === 0) console.log("  (belum ada media dipilih)");
    selected.forEach((reference, index) => {
      console.log(`  ${index + 1}. ${displayMediaReference(reference)}`);
      if (reference.startsWith(pendingPrefix)) {
        const upload = pendingUploads.get(reference);
        if (upload?.url) console.log(`     URL setelah upload: ${upload.url}`);
      } else {
        console.log(`     ${reference}`);
      }
    });
    console.log("  [a] pilih media dari Storage");
    console.log("  [u] pilih file dari komputer untuk diunggah saat commit");
    console.log("  [r] hapus pilihan");
    console.log("  [d] selesai");

    const action = (await ask("Aksi: ")).toLowerCase();
    if (action === "d") return selected;

    if (action === "a") {
      const assets = await listStorageMedia();
      if (assets.length === 0) {
        console.log(`Belum ada gambar/video di bucket ${storageBucket}.`);
        continue;
      }
      console.log(`\nMedia di Storage (${assets.length}):`);
      assets.forEach((asset, index) => {
        console.log(`  ${index + 1}. ${asset.path}`);
        console.log(`     ${asset.url}`);
      });
      const indexes = (await ask("Nomor media (pisahkan dengan koma): "))
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((index) => Number.isInteger(index) && index >= 1 && index <= assets.length);
      const additions = indexes.map((index) => assets[index - 1].url);
      if (maximum === 1 && additions.length > 0) selected = [additions[0]];
      else {
        for (const reference of additions) {
          if (!selected.includes(reference) && selected.length < maximum) {
            selected.push(reference);
          }
        }
      }
      continue;
    }

    if (action === "u") {
      console.log("Masukkan path file satu per baris. Baris kosong untuk selesai.");
      const paths = [];
      while (true) {
        const path = await ask("Path file: ");
        if (!path) break;
        paths.push(path);
      }
      for (const path of paths) {
        try {
          const reference = await registerUpload(path);
          if (maximum === 1) {
            selected = [reference];
            break;
          }
          if (!selected.includes(reference) && selected.length < maximum) {
            selected.push(reference);
          }
        } catch (error) {
          console.log(`File dilewati: ${reportError(error)}`);
        }
      }
      continue;
    }

    if (action === "r") {
      if (selected.length === 0) continue;
      const indexes = (await ask("Nomor pilihan yang dihapus (pisahkan dengan koma): "))
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((index) => Number.isInteger(index) && index >= 1 && index <= selected.length);
      selected = selected.filter((_, index) => !indexes.includes(index + 1));
      continue;
    }

    console.log("Aksi tidak dikenal.");
  }
}

async function editProjectMedia(record) {
  while (true) {
    console.log("\nPengaturan media proyek");
    console.log(`1. Media utama: ${record.primary_media ? displayMediaReference(record.primary_media) : "(kosong)"}`);
    console.log(`2. Media tambahan: ${record.media?.length ?? 0} file`);
    console.log("0. Selesai");
    const action = await ask("Pilih: ");

    if (action === "0") return;
    if (action === "1") {
      const selected = await chooseAssets(
        "Pilih satu media utama",
        record.primary_media ? [record.primary_media] : [],
        1,
      );
      record.primary_media = selected[0] ?? null;
    } else if (action === "2") {
      record.media = await chooseAssets(
        "Pilih media tambahan",
        Array.isArray(record.media)
          ? record.media.filter((item) => typeof item === "string")
          : [],
      );
    }
  }
}

async function createProject() {
  const name = await ask("Nama proyek (harus unik): ");
  if (!name) throw new Error("Nama proyek tidak boleh kosong.");

  const record = {
    id: randomUUID(),
    name,
    visibility: await askChoice("Visibility", ["public", "private"], "public"),
    platform: await askChoice("Platform", platformValues, "web"),
    description: await askDescription(),
    framework: await askStringArray("Framework"),
    keyword: await askStringArray("Keyword"),
    contributors: await chooseContributors(),
    primary_media: null,
    media: [],
    url: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    sort_order: 0,
  };

  if ((await ask("Atur media sekarang? [y/N]: ")).toLowerCase() === "y") {
    await editProjectMedia(record);
  }
  record.url = await askText("URL proyek (opsional; Enter untuk kosong)", null, { nullable: true });
  record.sort_order = await askInteger("Urutan tampil", 0);
  stageRecord(tableNames.projects, "insert", record);
}

async function createChangelog() {
  const projectId = await selectProjectId();
  if (!projectId) return;
  const record = {
    id: randomUUID(),
    project_id: projectId,
    title: await ask("Judul rilis (misalnya Initial release): "),
    version: await ask("Versi (misalnya v1.0.0): "),
    release: await askChoice("Jenis rilis", releaseValues, "latest"),
    description: await askDescription(),
    contributors: await chooseContributors(),
    released_at: new Date().toISOString(),
  };
  if (!record.title.trim()) throw new Error("Judul rilis wajib diisi.");
  if (!record.version.trim()) throw new Error("Versi wajib diisi.");
  stageRecord(tableNames.changelogs, "insert", record);
}

async function createContributor() {
  const name = await ask("Nama kontributor: ");
  if (!name) throw new Error("Nama kontributor wajib diisi.");
  let url = await askText("URL kontak (opsional; ketik null untuk kosong)", null, { nullable: true });
  while (url && !safeHttpUrl(url)) {
    console.log("URL harus menggunakan http atau https.");
    url = await askText("URL kontak", url, { nullable: true });
  }
  stageRecord(tableNames.contributors, "insert", {
    id: randomUUID(),
    name: name.trim(),
    url: url || null,
  });
}

async function editContributor(record) {
  record.name = await askText("Nama", record.name);
  if (!record.name.trim()) throw new Error("Nama kontributor wajib diisi.");
  let url = await askText("URL kontak (opsional; ketik null untuk kosong)", record.url, { nullable: true });
  while (url && !safeHttpUrl(url)) {
    console.log("URL harus menggunakan http atau https.");
    url = await askText("URL kontak", url, { nullable: true });
  }
  record.url = url || null;
}

async function editProject(record) {
  while (true) {
    console.log("\nPilih yang ingin diedit:");
    console.log("  1. Nama             2. Visibility       3. Platform");
    console.log("  4. Deskripsi        5. Framework        6. Keyword");
    console.log("  7. Kontributor      8. Media            9. URL");
    console.log(" 10. Tanggal selesai 11. Urutan tampil    0. Selesai");
    const action = await ask("Aksi: ");
    switch (action) {
      case "0":
        return;
      case "1":
        record.name = await askText("Nama", record.name);
        break;
      case "2":
        record.visibility = await askChoice("Visibility", ["public", "private"], record.visibility);
        break;
      case "3":
        record.platform = await askChoice("Platform", platformValues, record.platform);
        break;
      case "4":
        record.description = await askDescription(record.description);
        break;
      case "5":
        record.framework = await askStringArray("Framework", record.framework);
        break;
      case "6":
        record.keyword = await askStringArray("Keyword", record.keyword);
        break;
      case "7":
        record.contributors = await chooseContributors(record.contributors ?? []);
        break;
      case "8":
        await editProjectMedia(record);
        break;
      case "9":
        record.url = await askText("URL proyek", record.url, { nullable: true });
        break;
      case "10":
        record.completed_at = await askText("Tanggal selesai (ISO timestamp)", record.completed_at, { nullable: true });
        break;
      case "11":
        record.sort_order = await askInteger("Urutan tampil", record.sort_order);
        break;
      default:
        console.log("Kolom tidak dikenal.");
    }
  }
}

async function editChangelog(record) {
  while (true) {
    console.log("\nPilih yang ingin diedit:");
    console.log("  1. Judul         2. Versi       3. Jenis rilis");
    console.log("  4. Deskripsi     5. Kontributor 6. Tanggal rilis");
    const action = await ask("Aksi: ");
    switch (action) {
      case "0":
        return;
      case "1":
        record.title = await askText("Judul", record.title);
        break;
      case "2":
        record.version = await askText("Versi", record.version);
        break;
      case "3":
        record.release = await askChoice("Jenis rilis", releaseValues, record.release);
        break;
      case "4":
        record.description = await askDescription(record.description);
        break;
      case "5":
        record.contributors = await chooseContributors(record.contributors ?? []);
        break;
      case "6":
        record.released_at = await askText("Tanggal rilis (ISO timestamp)", record.released_at);
        break;
      default:
        console.log("Kolom tidak dikenal.");
    }
  }
}

async function createRecord(table) {
  if (table === tableNames.projects) await createProject();
  else if (table === tableNames.changelogs) await createChangelog();
  else await createContributor();
}

async function updateRecord(table, row, projectNames) {
  await printRecordDetails(table, row, projectNames);
  const original = JSON.stringify(row);
  if (table === tableNames.projects) await editProject(row);
  else if (table === tableNames.changelogs) await editChangelog(row);
  else await editContributor(row);
  if (JSON.stringify(row) === original) {
    console.log("Tidak ada perubahan.");
    return;
  }
  await printRecordDetails(table, row, projectNames);
  stageRecord(table, "update", row);
}

async function deleteRecord(table, row, projectNames) {
  await printRecordDetails(table, row, projectNames);
  if ((await ask("Hapus data ini? [y/N]: ")).toLowerCase() !== "y") {
    console.log("Penghapusan dibatalkan.");
    return;
  }
  stageDelete(table, row);
}

function getIndexedRow(rows, action, command) {
  const match = action.match(new RegExp(`^${command}\\s+(\\d+)$`));
  if (!match) {
    console.log(`Gunakan ${command} <nomor>.`);
    return null;
  }
  const index = Number(match[1]);
  if (index < 1 || index > rows.length) {
    console.log("Nomor data tidak ditemukan.");
    return null;
  }
  return rows[index - 1];
}

async function manageTable(table) {
  while (true) {
    try {
      const rows = await getWorkingRows(table);
      let projectNames = new Map();
      if (table === tableNames.changelogs) {
        projectNames = new Map((await getWorkingRows(tableNames.projects)).map((project) => [project.id, project.name]));
      } else if (table === tableNames.contributors) {
        const [projects, changelogs] = await Promise.all([
          getWorkingRows(tableNames.projects),
          getWorkingRows(tableNames.changelogs),
        ]);
        for (const contributor of rows) {
          const projectCount = projects.filter((project) =>
            project.contributors?.some((item) => item.id === contributor.id),
          ).length;
          const changelogCount = changelogs.filter((changelog) =>
            changelog.contributors?.some((item) => item.id === contributor.id),
          ).length;
          projectNames.set(contributor.id, `${projectCount} project · ${changelogCount} changelog`);
        }
      }
      printRows(table, rows, projectNames);
      const action = (await ask("Aksi: ")).toLowerCase();

      if (action === "b") return;
      if (action === "r") continue;
      if (action === "n") {
        await createRecord(table);
        continue;
      }
      if (action === "c") {
        await commitChanges();
        continue;
      }
      if (action.startsWith("v ")) {
        const row = getIndexedRow(rows, action, "v");
        if (row) await printRecordDetails(table, row, projectNames);
        continue;
      }
      if (action.startsWith("e ")) {
        const row = getIndexedRow(rows, action, "e");
        if (row) await updateRecord(table, structuredClone(row), projectNames);
        continue;
      }
      if (action.startsWith("d ")) {
        const row = getIndexedRow(rows, action, "d");
        if (row) await deleteRecord(table, row, projectNames);
        continue;
      }
      console.log("Aksi tidak dikenal.");
    } catch (error) {
      console.error(`Aksi gagal: ${reportError(error)}`);
    }
  }
}

function listStagedChanges() {
  return [...staged.values()].map((change) => ({
    table: change.table,
    operation: change.operation,
    id: change.id ?? change.record.id,
    name: change.label ?? change.record?.name ?? `${change.record?.title ?? ""} ${change.record?.version ?? ""}`.trim(),
  }));
}

function printStagedChanges(rows = listStagedChanges()) {
  console.log(`\nPerubahan tertunda (${rows.length}):`);
  rows.forEach((row, index) => {
    const table = row.table === tableNames.projects
      ? "Project"
      : row.table === tableNames.changelogs
        ? "Changelog"
        : "Contributor";
    const operation = {
      insert: "baru",
      update: "edit",
      delete: "hapus",
    }[row.operation];
    console.log(`  ${index + 1}. ${table} · ${operation} · ${row.name || "tanpa judul"}`);
  });
}

async function reviewStagedChanges() {
  while (staged.size > 0) {
    const rows = listStagedChanges();
    printStagedChanges(rows);
    const answer = await ask("Nomor perubahan untuk dibuang, atau Enter untuk kembali: ");
    if (!answer) return;
    const index = Number(answer);
    if (!Number.isInteger(index) || index < 1 || index > rows.length) {
      console.log("Nomor tidak dikenal.");
      continue;
    }
    const row = rows[index - 1];
    const change = staged.get(stageKey(row.table, row.id));
    if (
      row.table === tableNames.contributors &&
      change?.operation === "insert" &&
      hasStagedContributorAssignments(row.id)
    ) {
      console.log("Hapus dulu kontributor ini dari project/changelog yang masih tertunda.");
      continue;
    }
    staged.delete(stageKey(row.table, row.id));
    console.log("Perubahan dibuang dari antrean.");
  }
  console.log("Tidak ada perubahan tertunda.");
}

function collectPendingReferences(value, references = new Set()) {
  if (typeof value === "string" && value.startsWith(pendingPrefix)) {
    references.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectPendingReferences(item, references);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectPendingReferences(item, references);
  }
  return references;
}

function replacePendingReferences(value, uploadedUrls) {
  if (typeof value === "string" && value.startsWith(pendingPrefix)) {
    const url = uploadedUrls.get(value);
    if (!url) throw new Error("Ada file tertunda yang belum berhasil diunggah.");
    return url;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePendingReferences(item, uploadedUrls));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replacePendingReferences(item, uploadedUrls),
      ]),
    );
  }
  return value;
}

async function removeUploadedObjects(uploadedObjects) {
  const paths = [...uploadedObjects.values()].map((item) => item.path);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(storageBucket).remove(paths);
  if (error) {
    console.error(
      `Pembersihan file gagal. Periksa file ini di Storage bucket ${storageBucket}:`,
      paths.join(", "),
    );
    console.error(error.message);
  }
}

async function uploadPendingFiles(references) {
  const entries = [...references].map((reference) => {
    const upload = pendingUploads.get(reference);
    if (!upload) throw new Error("File upload tertunda tidak ditemukan.");
    return { reference, upload };
  });
  const uploadedObjects = new Map();
  const failures = [];
  let nextIndex = 0;
  let completedUploads = 0;

  async function worker() {
    while (nextIndex < entries.length) {
      const entry = entries[nextIndex];
      nextIndex += 1;
      const { objectPath, url } = entry.upload;
      uploadedObjects.set(entry.reference, { path: objectPath, url });

      try {
        const file = await readFile(entry.upload.filePath);
        const { error } = await supabase.storage
          .from(storageBucket)
          .upload(objectPath, file, {
            cacheControl: "3600",
            contentType: entry.upload.contentType,
            upsert: false,
          });
        if (error) throw new Error(error.message);
        completedUploads += 1;
        console.log(`  Media siap diunggah (${completedUploads}/${entries.length}): ${entry.upload.name}`);
      } catch (error) {
        failures.push(`${entry.upload.name}: ${reportError(error)}`);
      }
    }
  }

  console.log(`Mengunggah ${entries.length} file ke Storage secara paralel...`);
  await Promise.all(
    Array.from({ length: Math.min(3, entries.length) }, () => worker()),
  );

  if (failures.length > 0) {
    await removeUploadedObjects(uploadedObjects);
    throw new Error(`Upload gagal:\n${failures.join("\n")}`);
  }

  return uploadedObjects;
}

async function commitChanges() {
  if (commitOutcomeUnknown) {
    console.log("Hasil commit sebelumnya belum pasti. Periksa ID data di Supabase, lalu buka ulang manager sebelum mencoba lagi.");
    return;
  }
  if (staged.size === 0) {
    console.log("Belum ada perubahan untuk di-commit.");
    return;
  }
  if (staged.size > 500) {
    console.log("Batas satu commit adalah 500 perubahan baris. Bagi antrean menjadi beberapa commit.");
    return;
  }

  const changes = [...staged.values()];
  printStagedChanges();
  if ((await ask("Ketik COMMIT untuk mengirim seluruh antrean: ")) !== "COMMIT") {
    console.log("Commit dibatalkan; antrean tetap tersimpan selama sesi ini.");
    return;
  }

  const references = collectPendingReferences(changes);
  let uploadedUrls = new Map();
  let uploadedObjects = new Map();
  try {
    if (references.size > 0) {
      uploadedObjects = await uploadPendingFiles(references);
      uploadedUrls = new Map(
        [...uploadedObjects].map(([reference, item]) => [reference, item.url]),
      );
    }

    const payload = changes.map((change) => {
      if (change.operation === "delete") {
        return { table: change.table, operation: change.operation, id: change.id };
      }
      const record = replacePendingReferences(change.record, uploadedUrls);
      if (change.table === tableNames.projects || change.table === tableNames.changelogs) {
        return {
          table: change.table,
          operation: change.operation,
          record: {
            ...record,
            contributors: (record.contributors ?? []).map((contributor) => contributor.id),
          },
        };
      }
      return {
        table: change.table,
        operation: change.operation,
        record,
      };
    });
    const { data, error } = await supabase.rpc("apply_projects_commit", {
      p_changes: payload,
    });

    if (error) {
      if (error.code === "FETCH_ERROR") {
        commitOutcomeUnknown = true;
        console.error("Koneksi terputus saat commit; status transaksi tidak dapat dipastikan.");
        console.error("File yang sudah diunggah dan antrean perubahan dibiarkan. Periksa ID data di Supabase sebelum mencoba lagi.");
      } else {
        await removeUploadedObjects(uploadedObjects);
      }
      if (error.code === "PGRST202") {
        throw new Error(
          "Fungsi commit belum tersedia. Jalankan supabase/commit_manager.sql di Supabase SQL Editor, lalu buka ulang manager.",
        );
      }
      throw new Error(error.message);
    }

    const appliedCount = Array.isArray(data?.applied) ? data.applied.length : changes.length;
    staged.clear();
    pendingUploads.clear();
    pendingUploadByPath.clear();
    console.log(`Commit berhasil: ${appliedCount} perubahan database diterapkan.`);
    if (uploadedObjects.size > 0) {
      console.log(`${uploadedObjects.size} file media berhasil ditautkan.`);
    }
  } catch (error) {
    console.error(`Commit gagal: ${reportError(error)}`);
  }
}

async function main() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diatur di .env pada folder utama proyek.",
    );
  }

  const { error } = await supabase
    .from(tableNames.projects)
    .select("id", { head: true, count: "exact" });
  if (error) {
    throw new Error(`Tidak bisa terhubung ke Supabase: ${error.message}`);
  }

  console.log("Terhubung ke Supabase. Data belum dikirim sampai kamu menjalankan commit.");
  while (true) {
    console.log(`\nNeverlabs Projects Manager — perubahan tertunda: ${staged.size}`);
    console.log("1. Buka tabel projects");
    console.log("2. Buka tabel project_changelogs");
    console.log("3. Buka tabel contributors");
    console.log("4. Tinjau/buang perubahan tertunda");
    console.log("5. Commit semua perubahan");
    console.log("0. Keluar");
    const action = await ask("Pilih: ");

    if (action === "0") {
      if (staged.size > 0 && (await ask("Perubahan belum di-commit. Ketik DISCARD untuk keluar: ")) !== "DISCARD") {
        continue;
      }
      return;
    }
    if (action === "1") await manageTable(tableNames.projects);
    else if (action === "2") await manageTable(tableNames.changelogs);
    else if (action === "3") await manageTable(tableNames.contributors);
    else if (action === "4") await reviewStagedChanges();
    else if (action === "5") await commitChanges();
    else console.log("Pilihan tidak dikenal.");
  }
}

main()
  .catch((error) => {
    if (error instanceof InputClosedError) {
      if (staged.size > 0) {
        console.log(`\nInput ditutup. ${staged.size} perubahan tertunda belum di-commit.`);
      }
    } else {
      console.error(`Manager berhenti: ${reportError(error)}`);
      process.exitCode = 1;
    }
  })
  .finally(() => readline.close());
