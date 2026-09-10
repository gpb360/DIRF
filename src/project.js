import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { registerProject, storeProjectDir, createAttemptInStore, listAttempts as listAttemptsInStore, getAttempt as getAttemptInStore, migrateLegacyContent } from "./state.js";

function ensureRegistered(root) {
  return registerProject(root);
}
const ATTEMPT_IGNORE = ".dirf/attempts/";

const DEFAULT_COMPACTION = Object.freeze({
  method: "verbatim-line",
  preserve_recent: 2,
  compression_ratio: 0.5,
  protected: ["objective", "definition-of-done", "policy"],
});

function normalizeCompaction(raw) {
  // Optional compaction policy (verbatim-line selection, not rewriting).
  // Absent section -> full defaults. Present section -> per-field defaults,
  // with each field validated independently like reserve_percent.
  const compaction = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const method = compaction.method ?? DEFAULT_COMPACTION.method;
  if (method !== "verbatim-line") {
    throw new Error(`DIRF compaction.method must be "verbatim-line" (only supported method); got ${JSON.stringify(method)}`);
  }
  const preserveRecent = compaction.preserve_recent ?? DEFAULT_COMPACTION.preserve_recent;
  if (!Number.isInteger(preserveRecent) || preserveRecent < 0) {
    throw new Error("DIRF compaction.preserve_recent must be a non-negative integer");
  }
  const compressionRatio = compaction.compression_ratio ?? DEFAULT_COMPACTION.compression_ratio;
  if (typeof compressionRatio !== "number" || compressionRatio < 0.1 || compressionRatio > 0.9) {
    throw new Error("DIRF compaction.compression_ratio must be a number from 0.1 to 0.9");
  }
  const protectedSections = compaction.protected ?? DEFAULT_COMPACTION.protected;
  if (!Array.isArray(protectedSections) || protectedSections.some((s) => typeof s !== "string" || !s)) {
    throw new Error("DIRF compaction.protected must be an array of non-empty strings");
  }
  return { method, preserve_recent: preserveRecent, compression_ratio: compressionRatio, protected: [...protectedSections] };
}

function portable(path) {
  return path.replaceAll("\\", "/");
}

function writeMissing(root, relativePath, content, created) {
  const path = join(root, relativePath);
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  created.push(portable(relativePath));
}

// Marker-guarded bootstrap block injected into a host repo's agent-facing
// files so a fresh agent can find DIRF state without grepping the repository.
// The block is append-only: existing content is never rewritten, and the
// marker makes re-injection a no-op. Content is deliberately portable — the
// generic store path resolves on every machine, so nothing machine-specific
// (usernames, absolute paths) leaks into committed files.
export const BOOTSTRAP_MARKER = "<!-- dirf:bootstrap -->";

export function bootstrapBlock(slug) {
  return [
    BOOTSTRAP_MARKER,
    "## DIRF — coordination bootstrap",
    "",
    "- Start every session with `dirf state active` and follow what it reports: reuse an active attempt, build new work only when idle, stop and ask on conflict.",
    `- Canonical state lives outside this repo at \`~/.dirf/projects/${slug}/\` — resolve the exact path with \`dirf state which\`. Never read or write \`.dirf/\` directly — it is legacy/inert.`,
    "- Resume with `dirf resume <name-or-id>`; read the project handoff with `dirf show me the handoff`.",
    "",
  ].join("\n");
}

function ensureBootstrapBlock(root, relativePath, block, created, updated) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, block, "utf8");
    created.push(portable(relativePath));
    return;
  }
  // Skip anything that is not a regular file (a directory named AGENTS.md,
  // a dangling special path) rather than crashing setup — pre-existing host
  // oddities are not DIRF's to repair.
  if (!statSync(path).isFile()) return;
  const content = readFileSync(path, "utf8");
  // Append-only heuristic: the marker makes re-injection a no-op. A file that
  // already carries the marker (even hand-copied, even with the block edited
  // away) opts out of future injection rather than risk touching user text.
  if (content.includes(BOOTSTRAP_MARKER)) return;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content.length && !content.endsWith("\n") ? eol + eol : content.length ? eol : "";
  writeFileSync(path, `${content}${separator}${block.replaceAll("\n", eol)}`, "utf8");
  updated.push(portable(relativePath));
}

export function projectRoot(path = process.cwd()) {
  return resolve(path || process.cwd());
}

function containedPath(root, value, label) {
  if (typeof value !== "string" || !value || isAbsolute(value)) throw new Error(`${label} must be target-relative`);
  const path = resolve(root, value);
  const escapes = (from, to) => {
    const rel = relative(from, to);
    return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  };
  if (escapes(root, path)) throw new Error(`${label} must stay inside the target repository`);
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (escapes(realpathSync(root), realpathSync(ancestor))) throw new Error(`${label} must not traverse a link outside the target repository`);
  return path;
}

function existingDirectory(root, candidates) {
  return candidates.find((candidate) => {
    try { return statSync(join(root, candidate)).isDirectory(); } catch { return false; }
  });
}

function existingFile(root, candidates) {
  return candidates.find((candidate) => {
    try { return statSync(join(root, candidate)).isFile(); } catch { return false; }
  });
}

export function loadProjectConfig(root = process.cwd()) {
  root = projectRoot(root);
  const { slug } = ensureRegistered(root);
  const path = join(storeProjectDir(slug), "config.json");
  if (!existsSync(path)) throw new Error(`DIRF is not configured here. Run: dirf setup "${root}"`);
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (config.schema_version !== 2) throw new Error(`Unsupported DIRF config schema ${config.schema_version}`);
  const reservePercent = config.context?.reserve_percent ?? 5;
  if (!Number.isInteger(reservePercent) || reservePercent < 1 || reservePercent > 50) {
    throw new Error("DIRF context reserve_percent must be an integer from 1 to 50");
  }
  config.context.reserve_percent = reservePercent;
  config.compaction = normalizeCompaction(config.compaction);
  containedPath(projectRoot(root), config.context?.path, "DIRF context path");
  containedPath(projectRoot(root), config.adr_path, "DIRF ADR path");
  containedPath(projectRoot(root), config.tracker?.specs_path, "DIRF specs path");
  containedPath(projectRoot(root), config.tracker?.tickets_path, "DIRF tickets path");
  return config;
}

export function setupProject(root = process.cwd(), options = {}) {
  root = projectRoot(root);
  const tracker = options.tracker || "local";
  const contextMode = options.context || "single";
  const reservePercent = options.reservePercent ?? 5;
  if (tracker !== "local") throw new Error(`Unsupported tracker ${tracker}; installed tracker adapters are not configured yet`);
  if (!new Set(["single", "multi"]).has(contextMode)) throw new Error("context must be single or multi");
  if (!Number.isInteger(reservePercent) || reservePercent < 1 || reservePercent > 50) throw new Error("reserve-percent must be an integer from 1 to 50");

  const created = [];
  const updated = [];
  const { slug } = ensureRegistered(root);
  const storeConfigPath = join(storeProjectDir(slug), "config.json");
  const existingConfig = existsSync(storeConfigPath) ? loadProjectConfig(root) : null;
  const contextPath = existingConfig?.context.path || existingFile(root, ["CONTEXT.md", "docs/CONTEXT.md", "docs/context.md"]) || "docs/agents/domain/CONTEXT.md";
  const adrPath = existingConfig?.adr_path || existingDirectory(root, ["docs/adr", "adr", "docs/architecture/decisions", "docs/decisions"]) || "docs/agents/domain/adr";
  const config = existingConfig || {
    schema_version: 2,
    slug,
    tracker: {
      provider: tracker,
      specs_path: "docs/agents/issues/specs",
      tickets_path: "docs/agents/issues/tickets.md",
    },
    context: { mode: contextMode, path: contextPath, reserve_percent: reservePercent },
    compaction: { ...DEFAULT_COMPACTION },
    adr_path: adrPath,
  };

  // Write config to the store (schema v2). Add slug if an old config lacks it.
  const toWrite = { ...config, schema_version: 2, slug };
  delete toWrite.attempt_root; // stale under the store model
  const serialized = JSON.stringify(toWrite, null, 2) + "\n";
  if (!existsSync(storeConfigPath) || readFileSync(storeConfigPath, "utf8") !== serialized) {
    writeFileSync(storeConfigPath, serialized, "utf8");
    created.push(`${slug}/config.json (store)`);
  }

  // Migrate any legacy per-target .dirf/ content (HANDOFF.md + attempts/) into
  // the store. setup used to leave these stranded under .dirf/ because the
  // "already registered" guard in migrateProject made its migration path
  // unreachable after registration. migrateLegacyContent moves config ONLY when
  // the store lacks one — and we just wrote the store config above — so the
  // legacy schema-v1 config is never overwritten; only HANDOFF and attempts
  // move. The backup safety net (.dirf.migrating.<ts>/) still runs.
  migrateLegacyContent(root, slug);

  const gitignore = join(root, ".gitignore");
  const ignored = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (!ignored.split(/\r?\n/).includes(ATTEMPT_IGNORE)) {
    writeFileSync(gitignore, `${ignored}${ignored && !ignored.endsWith("\n") ? "\n" : ""}${ATTEMPT_IGNORE}\n`, "utf8");
    created.push(".gitignore");
  }
  writeMissing(root, contextPath, "# Project Context\n\nRecord stable domain language and constraints here.\n", created);
  writeMissing(root, join(adrPath, "README.md"), "# Architecture Decisions\n\nRecord hard-to-reverse decisions as numbered Markdown files.\n", created);
  writeMissing(root, join(config.tracker.specs_path, "README.md"), "# Specifications\n\nDurable destination documents for multi-session work.\n", created);
  writeMissing(root, config.tracker.tickets_path, "# Tickets\n\nDependency-ordered implementation slices.\n", created);

  // Agent-facing discovery: a marker-guarded pointer so a fresh agent (or a
  // different model/CLI) finds the store and the one command that matters
  // without grepping the repo for state.
  const bootstrap = bootstrapBlock(slug);
  ensureBootstrapBlock(root, contextPath, bootstrap, created, updated);
  ensureBootstrapBlock(root, "AGENTS.md", bootstrap, created, updated);
  return { root, slug, config: loadProjectConfig(root), created, updated };
}

export function createAttempt(root, name, now = new Date()) {
  root = projectRoot(root);
  loadProjectConfig(root); // validates that setup has run
  const { slug } = ensureRegistered(root);
  return createAttemptInStore(slug, name, now);
}

export function listAttempts(root = process.cwd()) {
  const { slug } = ensureRegistered(projectRoot(root));
  return listAttemptsInStore(slug);
}

export function findAttempt(root, nameOrId) {
  const { slug } = ensureRegistered(projectRoot(root));
  return getAttemptInStore(slug, nameOrId);
}

export function repositoryIdentity(targetRoot) {
  // Portable identity of the target repository for the kickoff prompt: folder
  // name plus the git remote if one exists. Credentials embedded in the remote
  // URL are stripped. Only remotes with a genuinely remote shape are kept — a
  // non-file:// URL scheme or an scp-like user@host:path — because anything
  // else (absolute, relative like "sibling/repo.git", drive letter, file://)
  // is a local path and the snapshot must never persist local paths.
  if (!targetRoot) return null;
  const identity = { name: basename(targetRoot) };
  try {
    const remote = execFileSync("git", ["-C", targetRoot, "remote", "get-url", "origin"], { encoding: "utf-8", windowsHide: true }).trim();
    const isRemoteUrl = /^(?!file:)[a-z][\w+.-]*:\/\//i.test(remote) || /^[\w.-]+@[\w.-]+:/.test(remote);
    if (isRemoteUrl) identity.remote = remote.replace(/^(\w+:\/\/)[^@/]+@/, "$1");
  } catch { /* not a git repo or no remote — the name still anchors the prompt */ }
  return identity;
}
