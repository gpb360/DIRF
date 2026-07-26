// src/state.js — the ONLY module that reads/writes DIRF canonical state.
// Central store layout (under storeHome()):
//   projects.json            project registry
//   projects/<slug>/
//     config.json            canonical config
//     HANDOFF.md             canonical handoff
//     attempts/<id>/         per-run state (layout unchanged)
//
// Every disk-touching function resolves the store root from storeHome().
// storeHome() = process.env.DIRF_HOME || ~/.dirf  — enables isolated tests.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const GIT_TIMEOUT = 30_000;

export function storeHome() {
  return process.env.DIRF_HOME || join(homedir(), ".dirf");
}

export function registryPath() {
  return join(storeHome(), "projects.json");
}

const EMPTY_REGISTRY = Object.freeze({ schema_version: 1, projects: {} });

export function readRegistry() {
  const path = registryPath();
  if (!existsSync(path)) return { ...EMPTY_REGISTRY, projects: {} };
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (data.schema_version !== 1) {
    throw new Error(`Unsupported DIRF project registry schema ${data.schema_version}`);
  }
  return { schema_version: 1, projects: data.projects || {} };
}

export function listProjects() {
  return Object.values(readRegistry().projects);
}

// Resolve git's common-dir for a path. Returns null if not a git repo.
// git rev-parse --git-common-dir can be relative (older git) — resolve it.
function gitCommonDir(targetPath) {
  try {
    let out = execFileSync("git", ["-C", targetPath, "rev-parse", "--git-common-dir"], {
      encoding: "utf8", timeout: GIT_TIMEOUT, windowsHide: true,
    }).trim();
    if (!out) return null;
    if (!isAbsolute(out)) out = resolve(targetPath, out);
    return out;
  } catch {
    return null;
  }
}

// The normalization contract (spec §4). MUST be deterministic and byte-stable.
// Order: absolute -> forward slashes -> strip trailing slash -> resolve symlinks
//        -> case-fold to lower case.
export function normalizeIdentityKey(rawKey) {
  let key = resolve(rawKey);                    // 1. absolute
  key = key.replaceAll("\\", "/");              // 2. forward slashes
  key = key.replace(/\/+$/, "");                // 3. strip trailing slash(es)
  try { key = realpathSync(key).replaceAll("\\", "/"); } catch { /* not-yet-existing path: keep resolved form */ }
  key = key.replace(/\/+$/, "");                // strip again after realpath
  key = key.toLowerCase();                      // 4. case-fold (case-insensitive FS safety)
  return key;
}

// Identity key for a target path: git common-dir if git, else normalized abs path.
export function identityKeyForPath(targetPath) {
  const common = gitCommonDir(targetPath);
  if (common) return normalizeIdentityKey(common);
  return normalizeIdentityKey(targetPath);
}

// Basename for the slug: main worktree's dir for git, cwd basename otherwise.
// NOTE: spec §4 requires the MAIN worktree's directory name so that a main tree
// and any of its worktrees produce the SAME basename (and therefore the SAME
// slug). The naive `git -C <path> rev-parse --show-toplevel` returns the path's
// OWN root (a worktree's root, not the main's), which would fork slugs. And
// `--git-dir <common> --show-toplevel` is unreliable on Windows (work-tree
// discovery walks up from CWD). The robust, byte-stable derivation is the
// parent of the common-dir: for the standard layout `git rev-parse
// --git-common-dir` resolves to `<main>/.git`, so `dirname(common)` IS the
// main worktree root — identical whether called from the main tree or a
// worktree.
function slugBasename(targetPath) {
  const common = gitCommonDir(targetPath);
  if (common) {
    const mainRoot = dirname(common);
    const name = basename(mainRoot.replace(/\\/g, "/"));
    if (name) return name;
  }
  return basename(targetPath.replace(/\\/g, "/"));
}

function safeBasename(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function deriveSlug(targetPath) {
  const key = identityKeyForPath(targetPath);
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 8);
  return `${safeBasename(slugBasename(targetPath))}-${hash}`;
}

// Atomic write: temp file + rename, same volume. Prevents corruption under
// concurrent writers (last-writer-wins, no merge — matches the snapshot model).
export function atomicWrite(filePath, contents) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.dirf-tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, filePath);
}

export function storeProjectDir(slug) {
  return join(storeHome(), "projects", slug);
}

export function writeRegistry(registry) {
  atomicWrite(registryPath(), JSON.stringify(registry, null, 2) + "\n");
}

function nowIso() { return new Date().toISOString(); }

export function getProject(slug) {
  return readRegistry().projects[slug] || null;
}

export function registerProject(targetPath) {
  const slug = deriveSlug(targetPath);
  const registry = readRegistry();
  const existing = registry.projects[slug];
  const isNew = !existing;
  const record = existing || {
    slug,
    name: basename(targetPath.replace(/\\/g, "/")),
    git_common_dir: identityKeyForPath(targetPath),
    main_path: resolve(targetPath).replaceAll("\\", "/"),
    created_at: nowIso(),
    last_seen: nowIso(),
  };
  record.last_seen = nowIso();
  registry.projects[slug] = record;
  writeRegistry(registry);
  mkdirSync(storeProjectDir(slug), { recursive: true });
  return { slug, isNew };
}

export function resolveProject(targetPath) {
  const slug = deriveSlug(targetPath);
  const registry = readRegistry();
  const existing = registry.projects[slug];
  if (!existing) return null;
  existing.last_seen = nowIso();
  registry.projects[slug] = existing;
  writeRegistry(registry);
  return { slug };
}

function portable(p) { return p.replaceAll("\\", "/"); }

function slugifyName(value) {
  const result = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  if (!result) throw new Error("attempt name must contain alphanumeric characters");
  return result;
}

function timestampIso(now) {
  return now.toISOString().replace(/[-:]/g, "").replace(".", "");
}

export function storeAttemptDir(slug, attemptId) {
  return join(storeProjectDir(slug), "attempts", attemptId);
}

// Create an attempt inside the store. Mirrors project.js createAttempt semantics
// (timestamp id, collision suffix, attempt.json) but writes to the store.
export function createAttemptInStore(slug, name, now = new Date()) {
  const baseId = `${timestampIso(now)}-${slugifyName(name)}`;
  const attemptsRoot = join(storeProjectDir(slug), "attempts");
  mkdirSync(attemptsRoot, { recursive: true });
  let id, folder;
  for (let collision = 1; ; collision += 1) {
    id = collision === 1 ? baseId : `${baseId}-${String(collision).padStart(2, "0")}`;
    folder = storeAttemptDir(slug, id);
    try { mkdirSync(folder); break; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const relativePath = portable(join("attempts", id));
  const attempt = { schema_version: 1, id, name, relativePath, created_at: now.toISOString() };
  atomicWrite(join(folder, "attempt.json"), JSON.stringify(attempt, null, 2) + "\n");
  return { ...attempt, folder };
}

export function listAttempts(slug) {
  const base = join(storeProjectDir(slug), "attempts");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const folder = join(base, entry.name);
    const metadata = join(folder, "attempt.json");
    if (!existsSync(metadata)) return [];
    return [{ ...JSON.parse(readFileSync(metadata, "utf8")), folder }];
  });
}

export function getAttempt(slug, idOrName) {
  const attempts = listAttempts(slug);
  const exact = attempts.find((a) => a.id === idOrName);
  if (exact) return exact;
  const wanted = slugifyName(idOrName);
  const matches = attempts.filter((a) => slugifyName(a.name) === wanted);
  if (!matches.length) throw new Error(`No DIRF attempt named ${JSON.stringify(idOrName)} for project ${slug}`);
  return matches.at(-1);
}

export function readHandoff(slug) {
  const path = join(storeProjectDir(slug), "HANDOFF.md");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function writeHandoff(slug, markdown) {
  atomicWrite(join(storeProjectDir(slug), "HANDOFF.md"), markdown);
}
