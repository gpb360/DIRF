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
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

// Move a directory tree from `from` to `to`, working across volumes.
// renameSync cannot cross device boundaries on Windows (EXDEV) and on POSIX
// when source/dest are on different filesystems, so migration must copy then
// delete. Order matters for safety: copy fully first, then remove the source —
// if the copy fails partway, the source is intact and the destination is just
// partial (and the caller's !existsSync(to) guard or migrate-cleanup handles it).
// For single-file same-directory atomic writes, use atomicWrite (renameSync).
export function moveAcrossVolumes(from, to) {
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
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
  if (existing) {
    // Conflict check: registered, but a local HANDOFF.md is newer than the store's.
    // Never silently overwrite — surface it with an instructive error (spec §7 contract).
    const localHandoff = join(targetPath, ".dirf", "HANDOFF.md");
    const storeHandoff = join(storeProjectDir(slug), "HANDOFF.md");
    if (existsSync(localHandoff) && existsSync(storeHandoff)) {
      const localMtime = statSync(localHandoff).mtimeMs;
      const storeMtime = statSync(storeHandoff).mtimeMs;
      if (localMtime > storeMtime) {
        throw new Error(
          `Local HANDOFF.md is newer than canonical for ${slug}. ` +
          `Run \`dirf state import-handoff\` to promote it (or \`dirf state import-handoff --force\` to skip this prompt). ` +
          `Refusing to proceed to avoid silent data loss.`
        );
      }
    }
    existing.last_seen = nowIso();
    registry.projects[slug] = existing;
    writeRegistry(registry);
    return { slug };
  }
  // Not registered. If legacy per-target .dirf/ exists, migrate it.
  if (hasLegacyState(targetPath)) {
    migrateProject(targetPath, slug);
    return { slug };
  }
  return null;
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

// Detect whether a target has migratable legacy state.
function hasLegacyState(targetPath) {
  const d = join(targetPath, ".dirf");
  if (!existsSync(d)) return false;
  return existsSync(join(d, "config.json")) || existsSync(join(d, "attempts"));
}

// Move the legacy per-target .dirf/ content (config, attempts, HANDOFF) into the
// store. This is the shared "content" half of migration. It is NOT guarded by
// the "already registered" check — that is the caller's responsibility
// (migrateProject for resolveProject's path; setupProject registers then calls
// this directly). Every item is moved only when the store does not already have
// it (idempotent + non-destructive): importantly, the config move is guarded by
// !existsSync(storeConfig) so setup's freshly-written schema-v2 config is never
// overwritten by the legacy v1 config. Always backs up .dirf/ -> .dirf.migrating.<ts>/
// first as a safety net.
export function migrateLegacyContent(targetPath, slug) {
  const legacyDir = join(targetPath, ".dirf");
  if (!existsSync(legacyDir)) return { migrated: false, reason: "no legacy .dirf" };

  // 1. Backup copy (before touching anything) — safety net for both call paths.
  const ts = timestampIso(new Date());
  const backup = join(targetPath, `.dirf.migrating.${ts}`);
  cpSync(legacyDir, backup, { recursive: true });

  // 2. Move state into the store.
  const storeDir = storeProjectDir(slug);
  mkdirSync(storeDir, { recursive: true });

  // config.json: upgrade schema 1 -> 2, drop attempt_root, add slug. Only move
  // if the store does NOT already have a config — setup writes schema-v2 config
  // before calling us, so in the setup path this branch is skipped (setup's
  // config wins). In the resolveProject path the store config does not exist
  // yet, so the legacy config is upgraded into place.
  const legacyConfig = join(legacyDir, "config.json");
  if (existsSync(legacyConfig)) {
    const storeConfig = join(storeDir, "config.json");
    if (!existsSync(storeConfig)) {
      const cfg = JSON.parse(readFileSync(legacyConfig, "utf8"));
      cfg.schema_version = 2;
      cfg.slug = slug;
      delete cfg.attempt_root;
      atomicWrite(storeConfig, JSON.stringify(cfg, null, 2) + "\n");
    }
  }

  // attempts/ — move whole directory contents if present, skipping any that already exist.
  const legacyAttempts = join(legacyDir, "attempts");
  if (existsSync(legacyAttempts)) {
    const storeAttempts = join(storeDir, "attempts");
    mkdirSync(storeAttempts, { recursive: true });
    for (const entry of readdirSync(legacyAttempts, { withFileTypes: true })) {
      const from = join(legacyAttempts, entry.name);
      const to = join(storeAttempts, entry.name);
      if (!existsSync(to)) moveAcrossVolumes(from, to);
    }
  }

  // HANDOFF.md — move if a canonical handoff isn't already present.
  const legacyHandoff = join(legacyDir, "HANDOFF.md");
  if (existsSync(legacyHandoff)) {
    const storeHandoff = join(storeDir, "HANDOFF.md");
    if (!existsSync(storeHandoff)) {
      const md = readFileSync(legacyHandoff, "utf8");
      atomicWrite(storeHandoff, md);
    }
  }

  return { migrated: true };
}

// Migrate a legacy per-target .dirf/ into the store. Non-destructive: backup
// copy first, register, then move state. Leaves the backup until an explicit
// migrate-cleanup. Idempotent: safe to re-run (a no-op once registered).
export function migrateProject(targetPath, slug) {
  const legacyDir = join(targetPath, ".dirf");
  if (!existsSync(legacyDir)) return { migrated: false, reason: "no legacy .dirf" };

  const registry = readRegistry();
  if (registry.projects[slug]) {
    // Already registered — migration is a no-op (conflict path handles handoff in Task 10).
    return { migrated: false, reason: "already registered" };
  }

  registerProject(targetPath);
  migrateLegacyContent(targetPath, slug);
  return { migrated: true };
}

// Promote a target's local HANDOFF.md into the store. Backs up the store's
// current handoff first (never destroy canonical to promote local).
export function importHandoff(targetPath, slug, { force = false } = {}) {
  const local = join(targetPath, ".dirf", "HANDOFF.md");
  if (!existsSync(local)) throw new Error(`No local HANDOFF.md at ${local}`);
  const storeHandoff = join(storeProjectDir(slug), "HANDOFF.md");
  if (existsSync(storeHandoff)) {
    const ts = timestampIso(new Date());
    cpSync(storeHandoff, join(storeProjectDir(slug), `HANDOFF.md.${ts}.bak`));
  }
  atomicWrite(storeHandoff, readFileSync(local, "utf8"));
  return { imported: true };
}

// Remove the migration backup after the user confirms the store works.
export function migrateCleanup(targetPath) {
  const entries = readdirSync(targetPath);
  const backups = entries.filter((n) => n.startsWith(".dirf.migrating."));
  for (const b of backups) rmSync(join(targetPath, b), { recursive: true, force: true });
  return { removed: backups.length };
}

// ─── Side observations (`dirf notice`) ─────────────────────────────────────
// A non-derailing channel for anything NOT the current task: a side bug, a doc
// staleness, a "fix later." Append-only markdown, one entry per line, numbered
// and timestamped. Default target: the current (most-recent) attempt's
// OBSERVATIONS.md. Promotable to the project-level OBSERVATIONS.md so an entry
// survives across sessions. Never flows into workflow.json or HANDOFF.md.

// The most recent attempt for a project (newest-last in listAttempts), or null.
export function currentAttempt(slug) {
  const attempts = listAttempts(slug);
  return attempts.length ? attempts.at(-1) : null;
}

function observationsFile(slug, attemptId) {
  // attemptId null/undefined => project-level file.
  return attemptId
    ? join(storeAttemptDir(slug, attemptId), "OBSERVATIONS.md")
    : join(storeProjectDir(slug), "OBSERVATIONS.md");
}

// Parse OBSERVATIONS.md back into [{n, ts, text}]. Lines that don't match the
// format are skipped (defensive — the file is agent-touched).
function parseObservations(content) {
  const entries = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\.\s+(\S+)\s+—\s+(.*)$/);
    if (m) entries.push({ n: Number(m[1]), ts: m[2], text: m[3] });
  }
  return entries;
}

export function listObservations(slug, { attemptId, project = false } = {}) {
  // Default target: the current attempt (symmetric with appendObservation).
  // project:true short-circuits to the project-level file.
  let target = attemptId;
  if (project) {
    target = null;
  } else if (!target) {
    const cur = currentAttempt(slug);
    target = cur ? cur.id : null;
  }
  const file = observationsFile(slug, target);
  if (!existsSync(file)) return [];
  return parseObservations(readFileSync(file, "utf8"));
}

// Append an observation. Default target: the current attempt (throws clearly if
// none exists). Options: { attemptId, project } — attemptId wins over default,
// project wins over both (writes the project-level file).
export function appendObservation(slug, text, { attemptId, project = false } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("observation text must not be empty");
  let target = attemptId;
  if (project) {
    target = null;
  } else if (!target) {
    const cur = currentAttempt(slug);
    if (!cur) throw new Error("No attempt to attach the observation to — run `dirf build` first, or pass --attempt <id>.");
    target = cur.id;
  }
  const file = observationsFile(slug, target);
  mkdirSync(dirname(file), { recursive: true });
  const existing = listObservations(slug, { attemptId: target, project });
  const n = existing.length ? Math.max(...existing.map((e) => e.n)) + 1 : 1;
  const ts = new Date().toISOString();
  appendFileSync(file, `${n}. ${ts} — ${trimmed}\n`, "utf8");
  return { n, ts, text: trimmed, file };
}

// Promote entry N from an attempt to the project-level file. Non-destructive:
// the source attempt keeps its log; the promoted entry is copied (re-numbered)
// into the project file.
export function promoteObservation(slug, entryN, { attemptId } = {}) {
  const cur = attemptId ? { id: attemptId } : currentAttempt(slug);
  if (!cur) throw new Error("No attempt to promote from — run `dirf build` first, or pass --attempt <id>.");
  const source = listObservations(slug, { attemptId: cur.id });
  const entry = source.find((e) => e.n === entryN);
  if (!entry) throw new Error(`No observation #${entryN} in attempt ${cur.id}. Run \`dirf notice list\` to see entries.`);
  appendObservation(slug, entry.text, { project: true });
  return { promoted: entryN, from: cur.id, text: entry.text };
}
