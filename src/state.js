// src/state.js — the ONLY module that reads/writes DIRF canonical state.
// Central store layout (under storeHome()):
//   projects.json            project registry
//   projects/<slug>/
//     config.json            canonical config
//     execution-authority.json  hashed harness capability
//     HANDOFF.md             canonical handoff
//     attempts/<id>/         per-run state (layout unchanged)
//
// Every disk-touching function resolves the store root from storeHome().
// storeHome() = process.env.DIRF_HOME || ~/.dirf  — enables isolated tests.

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveGoverningArtifact, validateArtifactGraph, validatePlanDelta } from "./artifacts.js";
import { parseCurrentHandoff, updateProgressSection } from "./handoff-update.js";

const GIT_TIMEOUT = 30_000;
const LIVE_OBSERVATION_TTL_MS = 5 * 60_000;
const EXECUTION_STATUSES = new Set(["active", "idle", "unknown"]);
const CHILD_EXECUTION_STATUSES = new Set(["active", "idle", "blocked", "completed", "unknown"]);
const MAX_CHILD_EXECUTIONS = 64;

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
      stdio: ["ignore", "pipe", "ignore"],
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

function storeSegment(value, label) {
  if (typeof value !== "string" || !value || value === "." || value === ".." || /[\0/\\]/.test(value)) {
    throw new Error(`Invalid ${label}: expected one safe path segment`);
  }
  return value;
}

export function storeProjectDir(slug) {
  return join(storeHome(), "projects", storeSegment(slug, "project slug"));
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

export function resolveProject(targetPath, { touch = true } = {}) {
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
    if (touch) {
      existing.last_seen = nowIso();
      registry.projects[slug] = existing;
      writeRegistry(registry);
    }
    return { slug };
  }
  // Not registered. If legacy per-target .dirf/ exists, migrate it.
  if (hasLegacyState(targetPath)) {
    migrateProject(targetPath, slug);
    return { slug };
  }
  return null;
}

const PROJECT_SLUG_RE = /^[a-z0-9.-]+-[0-9a-f]{8}$/;

// Resolve a registered project reference through one core path for every
// shell. Explicit CLI --slug values must be registered slugs; MCP-style
// references accept either a registered slug or a filesystem path.
export function resolveProjectReference(reference, { defaultPath = process.cwd(), explicitSlug = false, touch = true } = {}) {
  const value = reference === undefined || reference === null ? "" : String(reference);
  if (value) {
    const registered = getProject(value);
    if (registered) return registered.slug;
    if (explicitSlug || PROJECT_SLUG_RE.test(value)) throw new Error(`Unknown DIRF project ${value}`);
  }
  const target = resolve(value || defaultPath);
  const project = resolveProject(target, { touch });
  if (!project) throw new Error(`DIRF has no project registered for ${target}. Run: dirf setup "${target}"`);
  return project.slug;
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
  return join(storeProjectDir(slug), "attempts", storeSegment(attemptId, "attempt id"));
}

const SKILL_BINDINGS_FILE = "skill-bindings.json";

export function readAttemptSkillBindings(slug, attemptId) {
  const attempt = getAttempt(slug, attemptId);
  const path = join(attempt.folder, SKILL_BINDINGS_FILE);
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(value.bindings) ? value.bindings : [];
}

export function writeAttemptSkillBindings(slug, attemptId, bindings) {
  const attempt = getAttempt(slug, attemptId);
  const path = join(attempt.folder, SKILL_BINDINGS_FILE);
  atomicWrite(path, JSON.stringify({ schema_version: 1, bindings }, null, 2) + "\n");
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
  const timestamp = now.toISOString();
  const attempt = {
    schema_version: 2,
    id,
    name,
    relativePath,
    created_at: timestamp,
    status: "planned",
    current_phase: null,
    worker: null,
    blocker: null,
    updated_at: timestamp,
    worktree_path: null,
  };
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
    const attempt = JSON.parse(readFileSync(metadata, "utf8"));
    if (attempt.artifacts !== undefined) assertArtifactGraph(attempt.artifacts);
    return [{ ...attempt, tracked: attempt.schema_version >= 2 && Boolean(attempt.status), status: attempt.status || "historical", folder }];
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

function attemptMetadataPath(slug, id) {
  return join(storeAttemptDir(slug, id), "attempt.json");
}

function writeAttempt(slug, attempt) {
  const stored = { ...attempt };
  delete stored.folder;
  delete stored.tracked;
  atomicWrite(attemptMetadataPath(slug, stored.id), JSON.stringify(stored, null, 2) + "\n");
  return getAttempt(slug, stored.id);
}

function assertArtifactGraph(artifacts) {
  const result = validateArtifactGraph(artifacts);
  if (!result.valid) throw new Error(`Invalid artifact graph: ${result.errors.join("; ")}`);
}

function artifactContentPath(attempt, artifact) {
  const candidate = join(attempt.folder, ...artifact.path.split("/"));
  if (!existsSync(candidate)) throw new Error(`Artifact content does not exist: ${artifact.path}`);

  const attemptRoot = realpathSync(attempt.folder);
  const contentPath = realpathSync(candidate);
  const fromAttempt = relative(attemptRoot, contentPath);
  if (fromAttempt === "" || fromAttempt === ".." || fromAttempt.startsWith(`..${sep}`) || isAbsolute(fromAttempt)) {
    throw new Error(`Artifact content escapes the attempt folder: ${artifact.path}`);
  }
  if (!statSync(contentPath).isFile()) throw new Error(`Artifact content must be a regular file: ${artifact.path}`);
  return contentPath;
}

function artifactContentSha256(contentPath) {
  return createHash("sha256").update(readFileSync(contentPath)).digest("hex");
}

function assertArtifactContent(attempt, artifact, artifacts) {
  const contentPath = artifactContentPath(attempt, artifact);
  if (artifact.accepted_sha256) {
    const actual = artifactContentSha256(contentPath);
    if (actual !== artifact.accepted_sha256) {
      throw new Error(`Artifact content changed after acceptance: ${artifact.path}`);
    }
  }
  if (artifact.type !== "plan_delta") return;

  let value;
  try { value = JSON.parse(readFileSync(contentPath, "utf8")); }
  catch { throw new Error(`plan_delta artifact must contain valid JSON: ${artifact.path}`); }
  const result = validatePlanDelta(value, artifacts);
  if (!result.valid) throw new Error(`Invalid plan_delta artifact: ${result.errors.join("; ")}`);
  const plan = resolveGoverningArtifact(artifacts, "plan");
  if (plan) assertArtifactContent(attempt, plan, artifacts);
}

export function governingAttemptArtifact(attempt, requiredTypes) {
  const artifacts = attempt.artifacts || [];
  assertArtifactGraph(artifacts);
  const governing = resolveGoverningArtifact(artifacts, requiredTypes);
  if (!governing) return null;
  assertArtifactContent(attempt, governing, artifacts);
  return governing;
}

export function listAttemptArtifacts(slug, idOrName) {
  const attempt = getAttempt(slug, idOrName);
  const artifacts = attempt.artifacts || [];
  assertArtifactGraph(artifacts);
  return artifacts;
}

function recordAttemptArtifactLocked(slug, idOrName, artifact, now = new Date()) {
  const attempt = getAttempt(slug, idOrName);
  if (artifact?.accepted_at !== undefined || artifact?.accepted_sha256 !== undefined) {
    throw new Error("Record the artifact first and accept it separately");
  }
  const candidate = {
    id: artifact?.id,
    type: artifact?.type,
    path: artifact?.path,
    supersedes: artifact?.supersedes === undefined ? [] : artifact.supersedes,
    created_at: artifact?.created_at || now.toISOString(),
  };
  const artifacts = [...(attempt.artifacts || []), candidate];
  assertArtifactGraph(artifacts);
  assertArtifactContent(attempt, candidate, artifacts);
  return writeAttempt(slug, { ...attempt, artifacts, updated_at: now.toISOString() });
}

export function recordAttemptArtifact(slug, idOrName, artifact, now = new Date()) {
  return withProgressLock(slug, () => recordAttemptArtifactLocked(slug, idOrName, artifact, now));
}

function acceptAttemptArtifactLocked(slug, idOrName, artifactId, now = new Date()) {
  const attempt = getAttempt(slug, idOrName);
  const current = attempt.artifacts || [];
  assertArtifactGraph(current);
  const index = current.findIndex((artifact) => artifact.id === artifactId);
  if (index < 0) throw new Error(`No artifact ${JSON.stringify(artifactId)} in attempt ${attempt.id}`);
  if (current[index].accepted_at) {
    assertArtifactContent(attempt, current[index], current);
    return attempt;
  }

  assertArtifactContent(attempt, current[index], current);
  const acceptedSha256 = artifactContentSha256(artifactContentPath(attempt, current[index]));

  const artifacts = current.map((artifact, artifactIndex) => artifactIndex === index
    ? { ...artifact, accepted_at: now.toISOString(), accepted_sha256: acceptedSha256 }
    : artifact);
  assertArtifactGraph(artifacts);
  for (const artifact of artifacts) {
    if (artifact.id === artifactId || artifact.type === "plan_delta") {
      assertArtifactContent(attempt, artifact, artifacts);
    }
  }
  return writeAttempt(slug, { ...attempt, artifacts, updated_at: now.toISOString() });
}

export function acceptAttemptArtifact(slug, idOrName, artifactId, now = new Date()) {
  return withProgressLock(slug, () => acceptAttemptArtifactLocked(slug, idOrName, artifactId, now));
}

// Single workflow.json read for an already-loaded attempt. Projections pass
// the attempt they already hold so per-attempt work stays O(1) reads, not O(N)
// (every getAttempt lists the whole attempts tree).
export function attemptWorkflow(slug, attempt) {
  const workflowPath = join(attempt.folder, "workflow.json");
  if (!existsSync(workflowPath)) return { phases: [], gates: {} };
  const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
  return {
    phases: Array.isArray(workflow.workflow?.phases) ? workflow.workflow.phases.filter((phase) => typeof phase === "string" && phase) : [],
    gates: workflow.workflow?.gates && typeof workflow.workflow.gates === "object" && !Array.isArray(workflow.workflow.gates) ? workflow.workflow.gates : {},
  };
}

export function attemptPhases(slug, idOrName) {
  return attemptWorkflow(slug, getAttempt(slug, idOrName)).phases;
}

// ─── Gates and evidence ─────────────────────────────────────────────────────
// Playbooks declare per-phase gates (config.workflow.gates), flattened into the
// persisted workflow.json at selection time (same precedent as
// conditional_contract). Gate kinds:
//   verify   — the phase must be advanced past WITH a recorded evidence record;
//              it may also require an accepted implementation_evidence artifact
//   decision — the phase must be advanced past WITH an accepted gate record
//              (user-owned decision — see the Decision Ownership policy)
//   soft     — tracked only; advance allowed without a record unless --strict
// Records live on attempt.json: `gates[phase]` = {status: accepted|denied,
// comment, by, at} (deny requires a comment — revise-and-retry feedback) and
// `evidence[phase]` = {command, output, at}. Pending = absent (tri-state
// pending-as-absence — never "unknown"). Old attempts (no gates in their
// workflow.json) stay gate-free and behave exactly as before.

export function workflowGates(slug, idOrName) {
  return attemptWorkflow(slug, getAttempt(slug, idOrName)).gates;
}

// Why a phase may not be advanced past yet, or null when it can.
function gateRequirement(gates, records, evidence, attempt, phase, strict = false) {
  const gate = gates[phase];
  if (!gate) return null;
  const kind = gate.kind || "verify";
  if (kind === "decision") {
    if (records[phase]?.status !== "accepted") {
      return { kind, reason: `Phase "${phase}" is a decision gate — record the decision first (dirf attempt gate ... accept|deny --comment "...")` };
    }
    const governing = gate.artifact_type ? governingAttemptArtifact(attempt, gate.artifact_type) : null;
    if (gate.artifact_type && !governing) {
      return { kind, reason: `Phase "${phase}" requires an accepted governing artifact of type "${gate.artifact_type}"` };
    }
    if (gate.artifact_type === "implementation_evidence" && !governing.accepted_sha256) {
      return { kind, reason: `Phase "${phase}" requires a SHA-bound accepted implementation_evidence artifact` };
    }
    const declared = String(gate.verify || "").trim();
    if (declared && !evidence[phase]) {
      return { kind, reason: `Phase "${phase}" also requires verification evidence — pass --evidence ${JSON.stringify(declared)} when advancing or completing it` };
    }
    if (declared && evidence[phase].command !== declared) {
      return { kind, reason: `Phase "${phase}" evidence command must match its declared verify command: ${JSON.stringify(declared)}` };
    }
    return null;
  }
  if (evidence[phase]) {
    const declared = String(gate.verify || "").trim();
    if (declared && evidence[phase].command !== declared) {
      return { kind, reason: `Phase "${phase}" evidence command must match its declared verify command: ${JSON.stringify(declared)}` };
    }
    const governing = gate.artifact_type ? governingAttemptArtifact(attempt, gate.artifact_type) : null;
    if (gate.artifact_type && !governing) {
      return { kind, reason: `Phase "${phase}" requires an accepted governing artifact of type "${gate.artifact_type}"` };
    }
    if (gate.artifact_type === "implementation_evidence" && !governing.accepted_sha256) {
      return { kind, reason: `Phase "${phase}" requires a SHA-bound accepted implementation_evidence artifact` };
    }
    return null;
  }
  if (kind === "soft" && !strict) return null;
  return { kind, reason: `Phase "${phase}" is a ${kind} gate — pass --evidence "<command>" when advancing or completing it` };
}

// All gate declarations for an attempt with their current record status,
// resolved from an already-loaded attempt (one workflow read — projections
// must not re-lookup per gate).
// decision gates: pending (no record) / accepted / denied.
// verify gates: pending (no evidence) / satisfied (evidence recorded).
// soft gates: pending until reached / passed once crossed / satisfied when
// evidence was recorded. Accept/deny records are decisions only; a legacy
// accept record on a verify or soft gate never substitutes for evidence, while
// a legacy denial remains visible and is never rewritten as passed.
export function attemptGateState(slug, attempt) {
  const { phases, gates } = attemptWorkflow(slug, attempt);
  const records = attempt.gates || {};
  const evidence = attempt.evidence || {};
  const currentIndex = phases.indexOf(attempt.current_phase);
  return {
    phases,
    gates: phases.filter((phase) => gates[phase]).map((phase) => {
      const phaseIndex = phases.indexOf(phase);
      const record = records[phase] || null;
      const kind = gates[phase].kind || "verify";
      const declaredVerify = String(gates[phase].verify || "").trim();
      const evidenceMatches = Boolean(evidence[phase]) &&
        (!declaredVerify || evidence[phase].command === declaredVerify);
      const satisfied = kind !== "decision" && evidenceMatches;
      const crossedSoftGate = kind === "soft" && (
        attempt.status === "done" || (currentIndex >= 0 && phaseIndex < currentIndex)
      );
      const artifactType = gates[phase].artifact_type || null;
      const governingArtifact = artifactType ? governingAttemptArtifact(attempt, artifactType) : null;
      // Existence alone is not enough for implementation_evidence: a historical
      // accepted artifact without a digest cannot satisfy the binding contract,
      // so the gate must project as pending exactly when enforcement would block.
      const artifactPending = artifactType && record?.status !== "denied" &&
        (!governingArtifact || (artifactType === "implementation_evidence" && !governingArtifact.accepted_sha256));
      const decisionEvidencePending = kind === "decision" && record?.status === "accepted" && declaredVerify && !evidenceMatches;
      let status = "pending";
      if (kind === "decision" && record) status = record.status;
      if (record?.status === "denied") status = "denied";
      else if (satisfied) status = "satisfied";
      else if (crossedSoftGate) status = "passed";
      if (artifactPending || decisionEvidencePending) status = "pending";
      return {
        phase,
        kind,
        verify: gates[phase].verify || null,
        ...(artifactType ? { artifact_type: artifactType, artifact_id: governingArtifact?.id || null } : {}),
        status,
        comment: record?.comment || null,
        by: record?.by || null,
        at: record?.at || null,
      };
    }),
  };
}

export function attemptGates(slug, idOrName) {
  return attemptGateState(slug, getAttempt(slug, idOrName)).gates;
}

export function gateIsPending(gate) {
  return !["accepted", "satisfied", "passed"].includes(gate?.status);
}

// Gates that still block or await the current/future phase. Crossed soft gates
// are history unless a legacy denial must remain visible.
export function pendingGates(slug, idOrName) {
  return attemptGateState(slug, getAttempt(slug, idOrName)).gates
    .filter(gateIsPending);
}

// Recorded verification evidence per phase (replay-don't-rerun).
export function recordedEvidence(slug, idOrName) {
  return getAttempt(slug, idOrName).evidence || {};
}

export function readAttemptHandoff(slug, idOrName) {
  const attempt = getAttempt(slug, idOrName);
  return readAttemptHandoffFile(slug, attempt.id);
}

// Direct file read (no getAttempt lookup) — used by hot loops like
// portfolioSnapshot where the attempt objects are already in hand.
function readAttemptHandoffFile(slug, attemptId) {
  const path = join(storeAttemptDir(slug, attemptId), "HANDOFF.md");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// Completion evidence an attempt HANDOFF.md can carry. Two deliberately
// conservative signals: an explicit handoff status line, or a
// filled-in "## Completed" section (the workflow template writes that section
// with "(none yet)" as a placeholder, so an empty section is NOT evidence).
export function handoffHasCompletionEvidence(markdown) {
  if (!markdown) return false;
  if (/^##\s*Status:\s*Complete\.?\s*$/m.test(markdown)) return true;
  return /^##\s+Completed\b/m.test(markdown) && !/\(\s*none yet\s*\)/i.test(markdown);
}

// The status the store should REPORT for an attempt. Lifecycle states (done,
// in_progress, blocked) always win — they are authoritative. planned/historical
// attempts are upgraded to done when their handoff carries completion evidence
// (status_source distinguishes "handoff" from "lifecycle" so the view never
// lies about where a status came from). Reading is cheap (one tiny file per
// attempt) and the store itself is never mutated by this.
export function effectiveAttemptStatus(slug, attempt) {
  if (["done", "in_progress", "blocked", "abandoned"].includes(attempt.status)) {
    return { status: attempt.status, status_source: "lifecycle" };
  }
  // An unreadable gate (for example an accepted artifact edited or deleted
  // after acceptance) must never upgrade the attempt to done — degrade to the
  // lifecycle status instead of crashing read-only projections.
  let gatesCleared = true;
  try {
    gatesCleared = !attemptGateState(slug, attempt).gates.some(gateIsPending);
  } catch {
    gatesCleared = false;
  }
  if (handoffHasCompletionEvidence(readAttemptHandoffFile(slug, attempt.id)) && gatesCleared) {
    return { status: "done", status_source: "handoff" };
  }
  return { status: attempt.status, status_source: "lifecycle" };
}

function handoffNextAction(handoff) {
  if (!handoff) return null;
  const match = handoff.match(/^## Exact next action\s*\r?\n+([\s\S]*?)(?=^## |\s*$)/m);
  const value = match?.[1]?.trim();
  return value && !/^_\(.*\)_$/.test(value) ? value : null;
}

export function attemptNextAction(slug, idOrName) {
  return handoffNextAction(readAttemptHandoff(slug, idOrName));
}

function handoffUpdatedAt(markdown, path, parsed = parseCurrentHandoff(markdown)) {
  const recorded = Date.parse(parsed.lastUpdated || "");
  if (Number.isFinite(recorded)) return recorded;
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

function handoffWorkReferences(markdown) {
  const references = new Set();
  const current = parseCurrentHandoff(markdown);
  if (current.workItem) references.add(current.workItem.trim().toLowerCase());
  const legacyCurrentText = [current.objective, current.nextAction, current.currentPhase].filter(Boolean).join("\n");
  for (const match of legacyCurrentText.matchAll(/\bPR\s*#?\s*(\d+)\b/gi)) {
    references.add(`pr:${match[1]}`);
  }
  for (const match of legacyCurrentText.matchAll(/\/pull\/(\d+)\b/gi)) {
    references.add(`pr:${match[1]}`);
  }
  for (const match of legacyCurrentText.matchAll(/\b[\w.-]+\/[\w.-]+#(\d+)\b/gi)) references.add(`pr:${match[1]}`);
  if (/\b(?:pr|pull request|review|merge)\b/i.test(legacyCurrentText)) {
    for (const match of legacyCurrentText.matchAll(/(?:^|\s)#(\d+)\b/g)) references.add(`pr:${match[1]}`);
  }
  return references;
}

function revisionRelation(target, currentRevision, candidateRevision) {
  if (!/^[0-9a-f]{40}$/i.test(currentRevision || "") || !/^[0-9a-f]{40}$/i.test(candidateRevision || "")) return "unknown";
  if (currentRevision.toLowerCase() === candidateRevision.toLowerCase()) return "same";
  const commitExists = (revision) => {
    try {
      execFileSync("git", ["-C", target, "cat-file", "-e", `${revision}^{commit}`], {
        timeout: GIT_TIMEOUT, windowsHide: true, stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  };
  if (!commitExists(currentRevision) || !commitExists(candidateRevision)) return "unknown";
  const isAncestor = (older, newer) => {
    try {
      execFileSync("git", ["-C", target, "merge-base", "--is-ancestor", older, newer], {
        timeout: GIT_TIMEOUT, windowsHide: true, stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  };
  if (isAncestor(currentRevision, candidateRevision)) return "candidate_newer";
  if (isAncestor(candidateRevision, currentRevision)) return "current_newer";
  return "conflict";
}

function buildRevisionGraph(target, revisions) {
  if (revisions.length < 2) return new Map();
  try {
    const output = execFileSync("git", ["-C", target, "rev-list", "--parents", ...revisions], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    });
    return new Map(output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [commit, ...parents] = line.trim().split(/\s+/).map((value) => value.toLowerCase());
      return [commit, parents];
    }));
  } catch {
    return null;
  }
}

function existingCommitRevisions(target, revisions) {
  if (!revisions.length) return new Set();
  try {
    const output = execFileSync("git", ["-C", target, "cat-file", "--batch-check=%(objectname) %(objecttype)"], {
      encoding: "utf8",
      input: `${revisions.join("\n")}\n`,
      timeout: GIT_TIMEOUT,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return new Set(output.trim().split(/\r?\n/).filter(Boolean).flatMap((line) => {
      const [object, type] = line.trim().split(/\s+/);
      return type === "commit" ? [object.toLowerCase()] : [];
    }));
  } catch {
    return new Set();
  }
}

function graphContainsAncestor(graph, ancestor, descendant) {
  if (!graph) return false;
  const wanted = ancestor.toLowerCase();
  const pending = [descendant.toLowerCase()];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === wanted) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(graph.get(current) || []));
  }
  return false;
}

// An attempt can become stale when another attempt records newer work for the
// same pull request. Keep the old handoff for audit history, but do not present
// its old next step as safe current guidance.
export function attemptContextState(slug, idOrName, options = {}) {
  const attempt = getAttempt(slug, idOrName);
  if (options.bounded) {
    const handoffPath = join(storeAttemptDir(slug, attempt.id), "HANDOFF.md");
    const handoff = readAttemptHandoffFile(slug, attempt.id) || "";
    const parsed = parseCurrentHandoff(handoff);
    const entry = {
      id: attempt.id,
      handoffPath,
      nextAction: handoffNextAction(handoff),
      references: handoffWorkReferences(handoff),
      updatedAt: handoffUpdatedAt(handoff, handoffPath, parsed),
      updateNumber: parsed.updateNumber,
      reviewRevision: parsed.reviewRevision,
    };
    const canonicalPath = join(storeProjectDir(slug), "HANDOFF.md");
    const canonical = readHandoff(slug) || "";
    const canonicalParsed = parseCurrentHandoff(canonical);
    const entries = [entry];
    if (canonicalParsed.attemptId && canonicalParsed.attemptId !== attempt.id) {
      entries.push({
        id: canonicalParsed.attemptId,
        handoffPath: join(storeAttemptDir(slug, canonicalParsed.attemptId), "HANDOFF.md"),
        nextAction: handoffNextAction(canonical),
        references: handoffWorkReferences(canonical),
        updatedAt: handoffUpdatedAt(canonical, canonicalPath, canonicalParsed),
        updateNumber: canonicalParsed.updateNumber,
        reviewRevision: canonicalParsed.reviewRevision,
      });
    }
    return contextForAttempt(entry, entries, getProject(slug)?.main_path || process.cwd());
  }
  const { entries, repositoryPath } = attemptContextEntries(slug);
  const entry = entries.find((candidate) => candidate.id === attempt.id);
  return contextForAttempt(entry, entries, repositoryPath);
}

function checkpointIsNewer(current, candidate) {
  if (candidate.updateNumber && current.updateNumber) return candidate.updateNumber > current.updateNumber;
  if (candidate.updateNumber) return true;
  if (current.updateNumber) return false;
  return candidate.updatedAt > current.updatedAt;
}

function contextForAttempt(entry, entries, repositoryPath, relationFor = revisionRelation) {
  const newerRelated = entries
    .filter((candidate) => candidate.id !== entry.id
      && [...entry.references].some((reference) => candidate.references.has(reference)))
    .map((candidate) => {
      const relation = relationFor(repositoryPath, entry.reviewRevision, candidate.reviewRevision);
      return {
        ...candidate,
        relation,
        supersedes: relation === "candidate_newer"
          || relation === "conflict"
          || (relation === "unknown" && entry.reviewRevision && candidate.reviewRevision && entry.reviewRevision !== candidate.reviewRevision)
          || (["same", "unknown"].includes(relation) && checkpointIsNewer(entry, candidate)),
      };
    })
    .filter((candidate) => candidate.supersedes)
    .sort((left, right) => {
      const priority = (value) => value === "candidate_newer" ? 2 : value === "conflict" ? 1 : 0;
      return priority(right.relation) - priority(left.relation)
        || (right.updateNumber || 0) - (left.updateNumber || 0)
        || right.updatedAt - left.updatedAt;
    })[0] || null;

  const needsRefresh = Boolean(newerRelated);
  const conflict = newerRelated?.relation === "conflict";
  const unverifiedRevisions = newerRelated?.relation === "unknown"
    && entry.reviewRevision
    && newerRelated.reviewRevision
    && entry.reviewRevision !== newerRelated.reviewRevision;
  const requiresReconciliation = Boolean(conflict || unverifiedRevisions);
  return {
    needs_refresh: needsRefresh,
    next_action: needsRefresh ? null : entry.nextAction,
    related_task_relation: newerRelated?.relation || null,
    related_task_requires_reconciliation: requiresReconciliation,
    related_attempt_id: newerRelated?.id || null,
    related_handoff_path: newerRelated?.handoffPath || null,
    newer_attempt_id: requiresReconciliation ? null : newerRelated?.id || null,
    newer_handoff_path: requiresReconciliation ? null : newerRelated?.handoffPath || null,
    attention: needsRefresh
      ? conflict
        ? "Two tasks point to different PR commits. Check the current PR commit, update the task that matches it, and stop or update the other task before continuing."
        : unverifiedRevisions
          ? "DIRF cannot tell which task matches the current PR version. Check or fetch the current PR commit, update the matching task, and stop or update the other task before continuing."
        : "Newer project work may have changed this task. Check the other review before continuing."
      : null,
  };
}

// Parse each handoff once so list views do not repeatedly re-read every task.
// Work identity is checked before any Git ancestry command is run.
function attemptContextEntries(slug) {
  const project = getProject(slug);
  const attempts = listAttempts(slug);
  const entries = attempts.map((attempt) => {
    const handoffPath = join(storeAttemptDir(slug, attempt.id), "HANDOFF.md");
    const handoff = readAttemptHandoffFile(slug, attempt.id) || "";
    const parsed = parseCurrentHandoff(handoff);
    return {
      id: attempt.id,
      handoffPath,
      nextAction: handoffNextAction(handoff),
      references: handoffWorkReferences(handoff),
      updatedAt: handoffUpdatedAt(handoff, handoffPath, parsed),
      updateNumber: parsed.updateNumber,
      reviewRevision: parsed.reviewRevision,
    };
  });
  const repositoryPath = attempts.find((attempt) => attempt.responsibility_path)?.responsibility_path
    || project?.main_path
    || process.cwd();
  return { entries, repositoryPath };
}

export function attemptContextStates(slug) {
  const { entries, repositoryPath } = attemptContextEntries(slug);
  const referenceCounts = new Map();
  for (const entry of entries) {
    for (const reference of entry.references) referenceCounts.set(reference, (referenceCounts.get(reference) || 0) + 1);
  }
  const revisions = [...new Set(entries
    .filter((entry) => [...entry.references].some((reference) => referenceCounts.get(reference) > 1))
    .map((entry) => entry.reviewRevision?.toLowerCase())
    .filter((revision) => /^[0-9a-f]{40}$/.test(revision || "")))];
  const existingRevisions = existingCommitRevisions(repositoryPath, revisions);
  const graph = buildRevisionGraph(repositoryPath, revisions.filter((revision) => existingRevisions.has(revision)));
  const relations = new Map();
  const relationFor = (_target, current, candidate) => {
    const key = `${current || ""}:${candidate || ""}`;
    if (!relations.has(key)) {
      let relation = "unknown";
      if (existingRevisions.has(current?.toLowerCase()) && existingRevisions.has(candidate?.toLowerCase())) {
        if (current.toLowerCase() === candidate.toLowerCase()) relation = "same";
        else if (graphContainsAncestor(graph, current, candidate)) relation = "candidate_newer";
        else if (graphContainsAncestor(graph, candidate, current)) relation = "current_newer";
        else if (graph) relation = "conflict";
      }
      relations.set(key, relation);
    }
    return relations.get(key);
  };
  return new Map(entries.map((entry) => [entry.id, contextForAttempt(entry, entries, repositoryPath, relationFor)]));
}

// Canonical project guidance is a fallback. If an attempt contains newer or
// conflicting guidance for the same work item, withhold the fallback instead
// of exposing an obsolete next step.
export function projectHandoffContextState(slug) {
  const handoff = readHandoff(slug);
  if (handoff === null) return {
    handoff: null,
    needs_refresh: false,
    related_task_relation: null,
    related_task_requires_reconciliation: false,
    related_attempt_id: null,
    related_handoff_path: null,
    newer_attempt_id: null,
    newer_handoff_path: null,
    attention: null,
  };
  const path = join(storeProjectDir(slug), "HANDOFF.md");
  const parsed = parseCurrentHandoff(handoff);
  const { entries, repositoryPath } = attemptContextEntries(slug);
  const entry = {
    id: "project-handoff",
    handoffPath: path,
    nextAction: handoffNextAction(handoff),
    references: handoffWorkReferences(handoff),
    updatedAt: handoffUpdatedAt(handoff, path, parsed),
    updateNumber: parsed.updateNumber,
    reviewRevision: parsed.reviewRevision,
  };
  const context = contextForAttempt(entry, entries, repositoryPath);
  return { ...context, handoff: context.needs_refresh ? null : handoff };
}
export function attemptResponsibility(slug, worktreePath) {
  const key = normalizeIdentityKey(worktreePath);
  const attempts = listAttempts(slug).filter((attempt) =>
    attempt.status === "in_progress" &&
    attempt.responsibility_path &&
    normalizeIdentityKey(attempt.responsibility_path) === key);
  if (!attempts.length) return { state: "idle", attempts: [] };
  if (attempts.length === 1) return { state: "active", attempt: attempts[0], attempts };
  return { state: "conflict", attempts };
}

function startTrackingAttemptLocked(slug, idOrName, now = new Date()) {
  const attempt = getAttempt(slug, idOrName);
  if (attempt.tracked) return attempt;
  return writeAttempt(slug, {
    ...attempt,
    schema_version: 2,
    status: "planned",
    current_phase: null,
    worker: null,
    blocker: null,
    updated_at: now.toISOString(),
    worktree_path: null,
  });
}

export function startTrackingAttempt(slug, idOrName, now = new Date()) {
  return withProgressLock(slug, () => startTrackingAttemptLocked(slug, idOrName, now));
}

function updateAttemptLifecycleLocked(slug, idOrName, action, options = {}, now = new Date()) {
  let attempt = getAttempt(slug, idOrName);
  if (!attempt.tracked) throw new Error(`Attempt ${attempt.id} is historical. Start tracking it first.`);
  const phases = attemptPhases(slug, attempt.id);
  const timestamp = now.toISOString();

  if (action === "start") {
    if (attempt.status !== "planned") throw new Error("Only a planned attempt can start");
    if (!phases.length) throw new Error("Attempt workflow has no phases");
    attempt = { ...attempt, status: "in_progress", current_phase: phases[0], blocker: null };
  } else if (action === "assign") {
    const worker = String(options.worker || "").trim();
    if (!worker) throw new Error("worker is required");
    attempt = { ...attempt, worker };
  } else if (action === "advance") {
    if (attempt.status !== "in_progress") throw new Error("Only an in-progress attempt can advance");
    const index = phases.indexOf(attempt.current_phase);
    if (index < 0 || index >= phases.length - 1) throw new Error("Attempt is already at its final phase");
    const leaving = phases[index];
    const evidence = { ...(attempt.evidence || {}) };
    if (options.evidence) {
      const command = String(options.evidence.command || "").trim();
      if (!command) throw new Error("evidence command must not be empty");
      evidence[leaving] = { command, output: options.evidence.output ? String(options.evidence.output) : null, at: timestamp };
    }
    const requirement = gateRequirement(workflowGates(slug, attempt.id), attempt.gates || {}, evidence, attempt, leaving, options.strict === true);
    if (requirement) throw new Error(requirement.reason);
    // Only introduce the evidence key when it has content — gate-free attempts
    // stay byte-identical to how they were written before.
    attempt = { ...attempt, current_phase: phases[index + 1], ...(Object.keys(evidence).length ? { evidence } : {}) };
  } else if (action === "block") {
    const blocker = String(options.reason || "").trim();
    if (!blocker) throw new Error("blocker reason is required");
    if (!new Set(["planned", "in_progress"]).has(attempt.status)) throw new Error("Only planned or in-progress attempts can be blocked");
    const wait = options.wait === "input" || options.wait === "blocker" ? options.wait : null;
    attempt = { ...attempt, status: "blocked", blocker, ...(wait ? { wait } : {}) };
  } else if (action === "gate") {
    if (attempt.status !== "in_progress") throw new Error("Only an in-progress attempt can record a gate decision");
    const phase = String(options.phase || "").trim();
    if (!phase) throw new Error("gate phase is required");
    if (!phases.includes(phase)) throw new Error(`Unknown phase ${JSON.stringify(phase)} — no such workflow phase`);
    const gate = workflowGates(slug, attempt.id)[phase];
    if (gate?.kind !== "decision") {
      throw new Error(`Phase ${JSON.stringify(phase)} is not a decision gate — record verification with dirf attempt advance --evidence instead`);
    }
    const decision = options.decision;
    if (decision !== "accept" && decision !== "deny") throw new Error('gate decision must be "accept" or "deny"');
    const comment = String(options.comment || "").trim();
    if (decision === "deny" && !comment) throw new Error("denial requires a comment (revise-and-retry feedback)");
    const gates = {
      ...(attempt.gates || {}),
      [phase]: { status: decision === "accept" ? "accepted" : "denied", comment: comment || null, by: attempt.worker || options.worker || null, at: timestamp },
    };
    attempt = { ...attempt, gates };
  } else if (action === "reopen") {
    if (!new Set(["blocked", "done", "abandoned"]).has(attempt.status)) throw new Error("Only blocked, done, or abandoned attempts can reopen");
    attempt = {
      ...attempt,
      status: "in_progress",
      current_phase: attempt.current_phase || phases[0] || null,
      blocker: null,
      wait: null,
      completed_at: null,
      abandoned_at: null,
      abandonment_reason: null,
    };
  } else if (action === "abandon") {
    projectExecutionAuthority(slug, executionAuthorityHash(options.authorityToken));
    const reason = String(options.reason || "").trim();
    if (!reason) throw new Error("abandonment reason is required");
    if (!new Set(["planned", "in_progress", "blocked"]).has(attempt.status)) {
      throw new Error("Only planned, in-progress, or blocked attempts can be abandoned");
    }
    attempt = {
      ...attempt,
      status: "abandoned",
      blocker: null,
      wait: null,
      current_execution: null,
      abandoned_at: timestamp,
      abandonment_reason: reason,
    };
  } else if (action === "complete") {
    if (attempt.status !== "in_progress") throw new Error("Only an in-progress attempt can complete");
    if (!phases.length || attempt.current_phase !== phases.at(-1)) throw new Error("Attempt must reach its final phase before completion");
    if (options.confirm !== true) throw new Error("Confirm the final done-when checks before completion");
    const finalPhase = phases.at(-1);
    const evidence = { ...(attempt.evidence || {}) };
    if (options.evidence) {
      const command = String(options.evidence.command || "").trim();
      if (!command) throw new Error("evidence command must not be empty");
      evidence[finalPhase] = { command, output: options.evidence.output ? String(options.evidence.output) : null, at: timestamp };
    }
    const requirement = gateRequirement(
      workflowGates(slug, attempt.id),
      attempt.gates || {},
      evidence,
      attempt,
      finalPhase,
      options.strict === true,
    );
    if (requirement) throw new Error(requirement.reason);
    const governingPlan = governingAttemptArtifact(attempt, "plan");
    if (governingPlan && !governingAttemptArtifact(attempt, "plan_delta")) {
      throw new Error(`Attempt with governing plan "${governingPlan.id}" requires an accepted governing plan_delta before completion`);
    }
    attempt = {
      ...attempt,
      status: "done",
      blocker: null,
      current_execution: null,
      completed_at: timestamp,
      ...(Object.keys(evidence).length ? { evidence } : {}),
    };
  } else {
    throw new Error(`Unknown attempt lifecycle action ${JSON.stringify(action)}`);
  }

  if (options.worker && action === "start") attempt.worker = String(options.worker).trim() || null;
  return writeAttempt(slug, { ...attempt, updated_at: timestamp });
}

export function updateAttemptLifecycle(slug, idOrName, action, options = {}, now = new Date()) {
  return withProgressLock(slug, () => updateAttemptLifecycleLocked(slug, idOrName, action, options, now));
}

// Guarded auto-advance: covered transitions auto-start the next
// session; the user-owned handoffs always wait). Advances through non-gated
// phases and stops AT any unsatisfied gate, reporting it. Never crosses a
// gate — the loop runs the same single-fire enforcement as `advance`.
// `evidence` (from `advance --auto --evidence`) is recorded for the FIRST
// leaving phase, so a verify gate is satisfiable in the same pass; a decision
// gate still stops and nothing is recorded for it.
function autoAdvanceLocked(slug, idOrName, { strict = false, evidence, now = new Date() } = {}) {
  let attempt = getAttempt(slug, idOrName);
  if (!attempt.tracked) throw new Error(`Attempt ${attempt.id} is historical. Start tracking it first.`);
  const phases = attemptPhases(slug, attempt.id);
  const gates = workflowGates(slug, attempt.id);
  let advanced = 0;
  let stoppedAt = null;
  for (;;) {
    if (attempt.status !== "in_progress") break;
    const index = phases.indexOf(attempt.current_phase);
    if (index < 0 || index >= phases.length - 1) break;
    const leaving = phases[index];
    const stepEvidence = advanced === 0 && evidence ? evidence : undefined;
    // The gate check must see the to-be-recorded evidence (M1), otherwise a
    // verify gate blocks the very step that would satisfy it.
    const view = stepEvidence ? { ...(attempt.evidence || {}), [leaving]: stepEvidence } : attempt.evidence || {};
    if (gateRequirement(gates, attempt.gates || {}, view, attempt, leaving, strict)) { stoppedAt = leaving; break; }
    attempt = updateAttemptLifecycleLocked(slug, attempt.id, "advance", stepEvidence ? { evidence: stepEvidence } : {}, now);
    advanced += 1;
  }
  return { attempt, advanced, stopped_at_gate: stoppedAt };
}

export function autoAdvance(slug, idOrName, options = {}) {
  return withProgressLock(slug, () => autoAdvanceLocked(slug, idOrName, options));
}

function linkAttemptWorktreeLocked(slug, idOrName, worktreePath, now = new Date()) {
  const attempt = getAttempt(slug, idOrName);
  if (!attempt.tracked) throw new Error(`Attempt ${attempt.id} is historical. Start tracking it first.`);
  const resolvedPath = resolve(String(worktreePath || ""));
  const match = inspectProjectWorktrees(slug, now).find((entry) => normalizeIdentityKey(entry.path) === normalizeIdentityKey(resolvedPath));
  if (!match) throw new Error("worktree must belong to the attempt's registered project");
  return writeAttempt(slug, { ...attempt, worktree_path: portable(resolvedPath), updated_at: now.toISOString() });
}

export function linkAttemptWorktree(slug, idOrName, worktreePath, now = new Date()) {
  return withProgressLock(slug, () => linkAttemptWorktreeLocked(slug, idOrName, worktreePath, now));
}

function claimAttemptCheckoutLocked(slug, idOrName, worktreePath, now = new Date()) {
  const attempt = getAttempt(slug, idOrName);
  if (!attempt.tracked) return attempt;
  const resolvedPath = resolve(String(worktreePath || ""));
  const branch = git(resolvedPath, ["branch", "--show-current"], { allowFailure: true }) || null;
  const key = normalizeIdentityKey(resolvedPath);
  const match = inspectProjectWorktrees(slug, now).some((entry) => normalizeIdentityKey(entry.path) === key);
  if (!match) throw new Error("checkout must belong to the attempt's registered project");
  const owner = listAttempts(slug).find((candidate) =>
    candidate.id !== attempt.id &&
    candidate.status === "in_progress" &&
    candidate.responsibility_path &&
    (normalizeIdentityKey(candidate.responsibility_path) === key || (branch && candidate.responsibility_branch === branch)));
  if (owner) throw new Error(`checkout is already governed by ${owner.id}`);
  if (!attempt.responsibility_path) {
    return writeAttempt(slug, { ...attempt, responsibility_path: portable(resolvedPath), responsibility_branch: branch, updated_at: now.toISOString() });
  }
  if (normalizeIdentityKey(attempt.responsibility_path) !== key) {
    throw new Error(`attempt ${attempt.id} is already responsible for ${attempt.responsibility_path}`);
  }
  return attempt;
}

export function claimAttemptCheckout(slug, idOrName, worktreePath, now = new Date()) {
  return withProgressLock(slug, () => claimAttemptCheckoutLocked(slug, idOrName, worktreePath, now));
}

function executionIsFresh(execution, now) {
  if (!execution) return false;
  const observedAt = Date.parse(execution.observed_at || 0) || 0;
  return now.getTime() - observedAt <= LIVE_OBSERVATION_TTL_MS;
}

function executionIsActive(execution) {
  return execution?.status === "active" || (execution?.children || []).some((child) => child.status === "active");
}

function requiredBoundedText(value, label, maxLength) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  return text;
}

function optionalBoundedText(value, label, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  return requiredBoundedText(value, label, maxLength);
}

function executionAuthorityHash(token) {
  const value = requiredBoundedText(token, "execution authority token", 4_096);
  if (value.length < 32) throw new Error("execution authority token must be at least 32 characters");
  return createHash("sha256").update(value).digest("hex");
}

function projectExecutionAuthority(slug, authorityHash) {
  const path = join(storeProjectDir(slug), "execution-authority.json");
  if (!existsSync(path)) {
    throw new Error(`execution authority is not initialized for project ${slug}; the trusted harness must bind DIRF_ORCHESTRATOR_TOKEN during setup before agents run`);
  }
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (record.authority_hash !== authorityHash) {
    throw new Error(`execution authority rejected for project ${slug}; the trusted harness adapter must retain the original project capability`);
  }
}

export function bindExecutionAuthority(slug, token) {
  return withProgressLock(slug, () => {
    if (!getProject(slug)) throw new Error(`Unknown DIRF project ${slug}`);
    const authorityHash = executionAuthorityHash(token);
    const path = join(storeProjectDir(slug), "execution-authority.json");
    if (existsSync(path)) {
      const record = JSON.parse(readFileSync(path, "utf8"));
      if (record.authority_hash !== authorityHash) {
        throw new Error(`execution authority is already initialized for project ${slug}`);
      }
      return { changed: false, path };
    }
    atomicWrite(path, JSON.stringify({ schema_version: 1, authority_hash: authorityHash }, null, 2) + "\n");
    return { changed: true, path };
  });
}

function normalizeChildExecutions(children, harness) {
  if (!Array.isArray(children)) throw new Error("execution children must be an array");
  if (children.length > MAX_CHILD_EXECUTIONS) throw new Error(`execution children cannot exceed ${MAX_CHILD_EXECUTIONS}`);
  const seen = new Set();
  return children.map((child, index) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) throw new Error(`execution child ${index + 1} must be an object`);
    const childHarness = optionalBoundedText(child.harness, `execution child ${index + 1} harness`, 100) || harness;
    const sessionId = requiredBoundedText(child.sessionId || child.session_id, `execution child ${index + 1} session id`, 200);
    const key = `${childHarness}\0${sessionId}`;
    if (seen.has(key)) throw new Error(`duplicate execution child ${childHarness}:${sessionId}`);
    seen.add(key);
    const status = requiredBoundedText(child.status, `execution child ${index + 1} status`, 20);
    if (!CHILD_EXECUTION_STATUSES.has(status)) {
      throw new Error(`Invalid child execution status ${JSON.stringify(status)} — use active, idle, blocked, completed, or unknown`);
    }
    const assignment = requiredBoundedText(child.assignment, `execution child ${index + 1} assignment`, 500);
    const blocker = optionalBoundedText(child.blocker, `execution child ${index + 1} blocker`, 2_000);
    if (status === "blocked" && !blocker) throw new Error(`execution child ${index + 1} blocker is required when status is blocked`);
    return {
      harness: childHarness,
      session_id: sessionId,
      assignment,
      status,
      blocker,
      result: optionalBoundedText(child.result, `execution child ${index + 1} result`, 4_000),
      handoff: optionalBoundedText(child.handoff, `execution child ${index + 1} handoff`, 4_000),
      blocks_parent: child.blocksParent === true || child.blocks_parent === true,
    };
  });
}

function observeAttemptLocked(slug, idOrName, options, now) {
  const attempt = getAttempt(slug, idOrName);
  if (!attempt.tracked) throw new Error(`Attempt ${attempt.id} is historical. Start tracking it first.`);
  if (attempt.status === "done" || attempt.status === "abandoned") throw new Error(`Attempt ${attempt.id} is ${attempt.status} and cannot be observed`);
  const harness = requiredBoundedText(options.harness, "execution harness", 100);
  const sessionId = requiredBoundedText(options.sessionId, "execution session id", 200);
  const status = requiredBoundedText(options.status, "execution status", 20);
  const authorityHash = executionAuthorityHash(options.authorityToken);
  projectExecutionAuthority(slug, authorityHash);
  if (!EXECUTION_STATUSES.has(status)) {
    throw new Error(`Invalid execution status ${JSON.stringify(status)} — use active, idle, or unknown`);
  }
  const observedAt = options.observedAt ? new Date(options.observedAt) : now;
  if (!Number.isFinite(observedAt.getTime())) throw new Error("execution observed time must be a valid date");
  if (observedAt.getTime() > now.getTime()) throw new Error("execution observed time cannot be in the future");

  let worktreePath = null;
  let branch = null;
  if (options.worktreePath) {
    const resolvedPath = resolve(String(options.worktreePath));
    const project = getProject(slug);
    if (identityKeyForPath(resolvedPath) !== project.git_common_dir) {
      throw new Error("execution worktree must belong to the attempt's registered project");
    }
    worktreePath = portable(resolvedPath);
    branch = git(resolvedPath, ["branch", "--show-current"], { allowFailure: true }) || null;
  }

  const previous = attempt.current_execution || null;
  const sameOwner = previous?.harness === harness && previous?.session_id === sessionId;
  if (sameOwner && !worktreePath) {
    worktreePath = previous.worktree_path || null;
    branch = previous.branch || null;
  }
  if (previous?.authority_hash && previous.authority_hash !== authorityHash) {
    throw new Error(`execution authority rejected for attempt ${attempt.id}; the trusted harness adapter must retain the original project capability`);
  }
  if (previous && !previous.authority_hash) {
    throw new Error(`attempt ${attempt.id} has an observation without an authority capability; explicitly abandon and reopen it before recording new execution`);
  }
  const previousIsActive = executionIsFresh(previous, now) && executionIsActive(previous);
  if (previous && !sameOwner && previousIsActive) {
    throw new Error(`attempt ${attempt.id} has active orchestrator ${previous.harness}:${previous.session_id}; continue from ${join(attempt.folder, "HANDOFF.md")} because a fresh owner cannot be transferred`);
  }
  if (previous && !sameOwner && !String(options.transferReason || "").trim()) {
    throw new Error(`attempt ${attempt.id} has recorded orchestrator ${previous.harness}:${previous.session_id}; continue from ${join(attempt.folder, "HANDOFF.md")} or pass an explicit transfer reason`);
  }
  if (sameOwner && Date.parse(previous.observed_at || 0) > observedAt.getTime()) {
    throw new Error("execution observation is older than the current orchestrator snapshot");
  }
  if (worktreePath) {
    const worktreeKey = normalizeIdentityKey(worktreePath);
    const otherOwner = listAttempts(slug).find((candidate) => {
      if (candidate.id === attempt.id || ["done", "abandoned", "historical"].includes(candidate.status)) return false;
      const owner = candidate.current_execution;
      const ownerPath = owner?.worktree_path || candidate.responsibility_path || candidate.worktree_path;
      const sameWorktree = ownerPath && normalizeIdentityKey(ownerPath) === worktreeKey;
      const sameBranch = branch && owner?.branch && owner.branch === branch;
      return sameWorktree || sameBranch;
    });
    if (otherOwner) {
      const owner = otherOwner.current_execution;
      const ownerLabel = owner ? `${owner.harness}:${owner.session_id}` : "the recorded Attempt responsibility";
      throw new Error(`worktree or branch is owned by ${otherOwner.id} (${ownerLabel}); continue from ${join(otherOwner.folder, "HANDOFF.md")} or explicitly abandon that attempt first`);
    }
  }

  const children = options.children === undefined
    ? (sameOwner ? previous.children || [] : [])
    : normalizeChildExecutions(options.children, harness);
  const transferReason = !sameOwner ? optionalBoundedText(options.transferReason, "execution transfer reason", 2_000) : null;

  return writeAttempt(slug, {
    ...attempt,
    current_execution: {
      harness,
      session_id: sessionId,
      status,
      observed_at: observedAt.toISOString(),
      worktree_path: worktreePath,
      branch,
      children,
      authority_hash: authorityHash,
      ...(sameOwner && previous?.previous_owner ? { previous_owner: previous.previous_owner } : {}),
      ...(previous && !sameOwner ? {
        previous_owner: {
          harness: previous.harness,
          session_id: previous.session_id,
          transferred_at: observedAt.toISOString(),
          reason: transferReason,
        },
      } : {}),
    },
  });
}

// A trusted harness adapter submits one orchestrator-owned snapshot. Children
// report to that orchestrator; they never get an independent DIRF writer. The
// project lock makes worktree and branch ownership checks atomic.
export function observeAttempt(slug, idOrName, options = {}, now = new Date()) {
  return withProgressLock(slug, () => observeAttemptLocked(slug, idOrName, options, now));
}

// Backfill: promote handoff completion evidence into the lifecycle. Only
// planned/historical attempts are upgraded (in_progress/blocked stay put —
// open work is authoritative). completed_at comes from the handoff file mtime,
// i.e. when the work was actually written. Never touches the handoff itself.
function syncAttemptFromHandoffLocked(slug, idOrName) {
  const attempt = getAttempt(slug, idOrName);
  if (attempt.status === "done") return { ...attempt, changed: false, reason: "already done" };
  if (["in_progress", "blocked", "abandoned"].includes(attempt.status)) {
    const reason = attempt.status === "abandoned"
      ? "status is abandoned — explicit lifecycle state wins"
      : `status is ${attempt.status} — open work wins`;
    return { ...attempt, changed: false, reason };
  }
  const handoffPath = join(storeAttemptDir(slug, attempt.id), "HANDOFF.md");
  const handoff = readAttemptHandoffFile(slug, attempt.id);
  if (!handoffHasCompletionEvidence(handoff)) {
    return { ...attempt, changed: false, reason: "no completion evidence in HANDOFF.md" };
  }
  const pending = attemptGateState(slug, attempt).gates.filter(gateIsPending);
  if (pending.length) {
    return {
      ...attempt,
      changed: false,
      reason: `workflow gates remain pending: ${pending.map(({ phase }) => phase).join(", ")}`,
    };
  }
  const completedAt = statSync(handoffPath).mtime.toISOString();
  const phases = attemptPhases(slug, attempt.id);
  return {
    ...writeAttempt(slug, {
      ...attempt,
      schema_version: 2,
      status: "done",
      current_phase: attempt.current_phase || phases.at(-1) || null,
      blocker: null,
      completed_at: completedAt,
      updated_at: completedAt,
    }),
    changed: true,
    reason: "backfilled from handoff evidence",
  };
}

export function syncAttemptFromHandoff(slug, idOrName) {
  return withProgressLock(slug, () => syncAttemptFromHandoffLocked(slug, idOrName));
}

// Automation: keep the lifecycle honest as work progresses. Called by
// `dirf record-progress`. planned → start (needs workflow phases); in_progress
// → advance until current_phase matches the reported phase (unknown phases are
// left alone — conservative). Returns the updated attempt, or null when
// nothing changed.
function syncLifecycleFromProgressLocked(slug, idOrName, phase, now = new Date()) {
  const attempt = getAttempt(slug, idOrName);
  if (!attempt?.tracked) return null;
  const phases = attemptPhases(slug, attempt.id);
  if (attempt.status === "planned") {
    if (!phases.length) return null;
    return updateAttemptLifecycleLocked(slug, attempt.id, "start", {}, now);
  }
  if (attempt.status === "in_progress" && phase && phases.includes(phase)) {
    let current = attempt;
    let steps = 0;
    const gates = workflowGates(slug, attempt.id);
    while (current.current_phase !== phase && steps < phases.length) {
      // Stop at unsatisfied gates — the lifecycle must never cross one.
      if (gateRequirement(gates, current.gates || {}, current.evidence || {}, current, current.current_phase, false)) break;
      current = updateAttemptLifecycleLocked(slug, attempt.id, "advance", {}, now);
      steps += 1;
    }
    return current.current_phase === phase ? current : null;
  }
  return null;
}

export function syncLifecycleFromProgress(slug, idOrName, phase, now = new Date()) {
  return withProgressLock(slug, () => syncLifecycleFromProgressLocked(slug, idOrName, phase, now));
}

const DEFAULT_SETTINGS = Object.freeze({ schema_version: 1, dirf_cli_path: null, stale_worktree_days: 14, archive_reminder_days: 30, stale_project_days: 30 });

export function readSettings() {
  const path = join(storeHome(), "settings.json");
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(path, "utf8")) };
  if (settings.schema_version !== 1) throw new Error(`Unsupported DIRF settings schema ${settings.schema_version}`);
  return settings;
}

export function writeSettings(patch) {
  const settings = { ...readSettings(), ...patch, schema_version: 1 };
  for (const key of ["stale_worktree_days", "archive_reminder_days", "stale_project_days"]) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) throw new Error(`${key} must be a positive integer`);
  }
  if (settings.dirf_cli_path !== null && (typeof settings.dirf_cli_path !== "string" || !settings.dirf_cli_path.trim())) {
    throw new Error("dirf_cli_path must be null or a non-empty string");
  }
  atomicWrite(join(storeHome(), "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  return settings;
}

function readWorktreeArchive(slug) {
  const path = join(storeProjectDir(slug), "worktrees.json");
  if (!existsSync(path)) return { schema_version: 1, archived: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeWorktreeArchive(slug, state) {
  atomicWrite(join(storeProjectDir(slug), "worktrees.json"), JSON.stringify(state, null, 2) + "\n");
}

function git(target, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", ["-C", target, ...args], { encoding: "utf8", timeout: GIT_TIMEOUT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(error.stderr?.trim() || error.message);
  }
}

function parseWorktreeList(output) {
  const entries = [];
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice(9) };
    } else if (current && line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (current && line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (current && line === "bare") current.bare = true;
    else if (current && line === "detached") current.detached = true;
  }
  if (current) entries.push(current);
  return entries.filter((entry) => !entry.bare);
}

export function inspectProjectWorktrees(slug, now = new Date()) {
  const project = getProject(slug);
  if (!project) throw new Error(`Unknown DIRF project ${slug}`);
  const settings = readSettings();
  const attempts = listAttempts(slug);
  const archives = readWorktreeArchive(slug).archived || [];
  const mainKey = normalizeIdentityKey(project.main_path);
  return parseWorktreeList(git(project.main_path, ["worktree", "list", "--porcelain"])).map((entry) => {
    const path = resolve(entry.path);
    const key = normalizeIdentityKey(path);
    const attempt = attempts.find((item) => item.worktree_path && normalizeIdentityKey(item.worktree_path) === key) || null;
    const porcelain = git(path, ["status", "--porcelain"], { allowFailure: true });
    const dirty = Boolean(porcelain);
    const conflicted = porcelain.split(/\r?\n/).some((line) => /^(DD|AU|UD|UA|DU|AA|UU)/.test(line));
    const lastCommitRaw = git(path, ["log", "-1", "--format=%cI"], { allowFailure: true });
    const lastCommitAt = lastCommitRaw || null;
    const activity = Math.max(Date.parse(attempt?.updated_at || attempt?.created_at || 0) || 0, Date.parse(lastCommitAt || 0) || 0);
    const stale = !attempt?.status || !["done", "abandoned"].includes(attempt.status) ? now.getTime() - activity >= settings.stale_worktree_days * 86_400_000 : false;
    const archived = archives.find((item) => normalizeIdentityKey(item.path) === key) || null;
    const archiveDue = archived ? now.getTime() >= Date.parse(archived.next_prompt_at) : false;
    let cleanup_state = "active";
    if (dirty || conflicted) cleanup_state = "needs_attention";
    else if (archived && archiveDue) cleanup_state = "archive_due";
    else if (archived) cleanup_state = "archived";
    else if (!attempt) cleanup_state = "unlinked";
    else if (attempt.status === "done") cleanup_state = "completed";
    else if (attempt.status === "abandoned") cleanup_state = "abandoned";
    else if (stale) cleanup_state = "stale";
    return {
      path: portable(path), branch: entry.branch || null, head: entry.head || null,
      is_main: key === mainKey, dirty, conflicted, last_commit_at: lastCommitAt,
      attempt_id: attempt?.id || null, attempt_status: attempt?.status || null,
      stale, archived, archive_due: archiveDue, cleanup_state,
    };
  });
}

export function archiveWorktree(slug, worktreePath, now = new Date()) {
  const item = inspectProjectWorktrees(slug, now).find((entry) => normalizeIdentityKey(entry.path) === normalizeIdentityKey(worktreePath));
  if (!item) throw new Error("worktree was not found");
  if (item.is_main) throw new Error("the main project checkout cannot be archived");
  if (item.dirty || item.conflicted) throw new Error("dirty or conflicted worktrees cannot be archived");
  const settings = readSettings();
  const archivedAt = now.toISOString();
  const record = { path: item.path, attempt_id: item.attempt_id, branch: item.branch, head: item.head, archived_at: archivedAt, next_prompt_at: new Date(now.getTime() + settings.archive_reminder_days * 86_400_000).toISOString() };
  const state = readWorktreeArchive(slug);
  state.archived = [...(state.archived || []).filter((entry) => normalizeIdentityKey(entry.path) !== normalizeIdentityKey(item.path)), record];
  writeWorktreeArchive(slug, state);
  return record;
}

export function remindArchivedWorktree(slug, worktreePath, now = new Date()) {
  const state = readWorktreeArchive(slug);
  const record = state.archived?.find((entry) => normalizeIdentityKey(entry.path) === normalizeIdentityKey(worktreePath));
  if (!record) throw new Error("worktree is not archived");
  record.next_prompt_at = new Date(now.getTime() + readSettings().archive_reminder_days * 86_400_000).toISOString();
  writeWorktreeArchive(slug, state);
  return record;
}

export function removeArchivedWorktree(slug, worktreePath, { approved = false } = {}, now = new Date()) {
  if (!approved) throw new Error("explicit approval is required to remove a worktree");
  const item = inspectProjectWorktrees(slug, now).find((entry) => normalizeIdentityKey(entry.path) === normalizeIdentityKey(worktreePath));
  if (!item?.archived) throw new Error("worktree is not archived");
  if (!item.archive_due) throw new Error("worktree archive reminder is not due");
  if (item.is_main || item.dirty || item.conflicted) throw new Error("worktree is not safe to remove");
  if (item.head !== item.archived.head) throw new Error("worktree HEAD changed after archive");
  const project = getProject(slug);
  git(project.main_path, ["worktree", "remove", item.path]);
  git(project.main_path, ["worktree", "prune"]);
  const state = readWorktreeArchive(slug);
  state.archived = (state.archived || []).filter((entry) => normalizeIdentityKey(entry.path) !== normalizeIdentityKey(item.path));
  writeWorktreeArchive(slug, state);
  return { removed: item.path, branch_preserved: item.branch };
}

export function readHandoff(slug) {
  const path = join(storeProjectDir(slug), "HANDOFF.md");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function writeHandoff(slug, markdown) {
  atomicWrite(join(storeProjectDir(slug), "HANDOFF.md"), markdown);
}

function progressAttempt(slug, idOrName) {
  const attempts = listAttempts(slug);
  if (idOrName) {
    const exact = attempts.find((attempt) => attempt.id === idOrName);
    if (exact) return exact;
    const wanted = slugifyName(idOrName);
    const matches = attempts.filter((attempt) => slugifyName(attempt.name) === wanted);
    if (!matches.length) throw new Error(`No DIRF attempt named ${JSON.stringify(idOrName)} for project ${slug}`);
    if (matches.length > 1) {
      throw new Error(`Attempt name ${JSON.stringify(idOrName)} is ambiguous for project ${slug}; pass a full attempt id.`);
    }
    return matches[0];
  }
  if (attempts.length > 1) {
    throw new Error("Multiple attempts exist; pass --attempt <id|name> so progress is not attached to the wrong attempt.");
  }
  return attempts[0] || null;
}

const PROGRESS_LOCK_WAIT_MS = 5_000;
const PROGRESS_LOCK_STALE_MS = 30_000;
const LOCK_WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function readProgressLockOwner(lockPath) {
  try {
    const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
    return typeof owner.token === "string" && Number.isInteger(owner.pid) && owner.pid > 0 ? owner : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function progressLockAge(lockPath, owner) {
  const createdAt = owner ? Date.parse(owner.created_at) : NaN;
  return Date.now() - (Number.isFinite(createdAt) ? createdAt : statSync(lockPath).mtimeMs);
}

function claimProgressLockReclamation(claimPath, claimantToken) {
  const claim = JSON.stringify({
    pid: process.pid,
    token: claimantToken,
    created_at: new Date().toISOString(),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(claimPath, claim, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      if (error.code !== "EEXIST") throw error;
      try {
        const existing = JSON.parse(readFileSync(claimPath, "utf8"));
        const parsedCreatedAt = Date.parse(existing.created_at);
        const createdAt = Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : statSync(claimPath).mtimeMs;
        const ownerAlive = Number.isInteger(existing.pid) && existing.pid > 0 && processIsAlive(existing.pid);
        if (Date.now() - createdAt <= PROGRESS_LOCK_STALE_MS || ownerAlive) return false;
      } catch (claimError) {
        if (claimError.code === "ENOENT") continue;
        if (!(claimError instanceof SyntaxError)) throw claimError;
        if (Date.now() - statSync(claimPath).mtimeMs <= PROGRESS_LOCK_STALE_MS) return false;
      }
      rmSync(claimPath, { force: true });
    }
  }
  return false;
}

function reclaimDeadProgressLock(lockPath, expectedOwner, claimantToken) {
  const expectedAge = progressLockAge(lockPath, expectedOwner);
  if (expectedAge <= PROGRESS_LOCK_STALE_MS) return false;
  if (expectedOwner && processIsAlive(expectedOwner.pid)) return false;

  const claimPath = join(lockPath, ".reclaim");
  if (!claimProgressLockReclamation(claimPath, claimantToken)) return false;

  try {
    const currentOwner = readProgressLockOwner(lockPath);
    const sameOwner = expectedOwner
      ? currentOwner?.token === expectedOwner.token
      : currentOwner === null;
    const currentAge = currentOwner ? progressLockAge(lockPath, currentOwner) : expectedAge;
    if (!sameOwner || currentAge <= PROGRESS_LOCK_STALE_MS) return false;
    if (currentOwner && processIsAlive(currentOwner.pid)) return false;

    const quarantine = `${lockPath}.stale-${claimantToken}`;
    renameSync(lockPath, quarantine);
    rmSync(quarantine, { recursive: true, force: true });
    return true;
  } finally {
    rmSync(claimPath, { force: true });
  }
}

function withProgressLock(slug, action) {
  const lockPath = join(storeProjectDir(slug), ".record-progress.lock");
  const token = randomUUID();
  const candidatePath = `${lockPath}.candidate-${process.pid}-${token}`;
  mkdirSync(candidatePath);
  writeFileSync(join(candidatePath, "owner.json"), JSON.stringify({
    pid: process.pid,
    token,
    created_at: new Date().toISOString(),
  }), "utf8");
  const deadline = Date.now() + PROGRESS_LOCK_WAIT_MS;
  while (true) {
    try {
      renameSync(candidatePath, lockPath);
      break;
    } catch (error) {
      if (!existsSync(lockPath)) throw error;
      try {
        const owner = readProgressLockOwner(lockPath);
        if (reclaimDeadProgressLock(lockPath, owner, token)) continue;
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
        continue;
      }
      if (Date.now() >= deadline) {
        rmSync(candidatePath, { recursive: true, force: true });
        throw new Error("Another progress update is still running; retry this checkpoint.");
      }
      Atomics.wait(LOCK_WAIT_ARRAY, 0, 0, 25);
    }
  }
  try {
    return action();
  } finally {
    const owner = readProgressLockOwner(lockPath);
    if (owner?.token === token) rmSync(lockPath, { recursive: true, force: true });
    rmSync(candidatePath, { recursive: true, force: true });
  }
}

function nextProgressUpdateNumber(slug) {
  const path = join(storeProjectDir(slug), ".progress-sequence");
  let current = 0;
  try {
    const stored = readFileSync(path, "utf8").trim();
    if (/^\d+$/.test(stored)) {
      current = Number(stored);
      if (!Number.isSafeInteger(current) || current < 0) current = 0;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const handoffs = [readHandoff(slug), ...listAttempts(slug).map((attempt) => readAttemptHandoffFile(slug, attempt.id))];
  for (const handoff of handoffs) {
    const recorded = parseCurrentHandoff(handoff || "").updateNumber;
    if (Number.isSafeInteger(recorded) && recorded > current) current = recorded;
  }
  const next = current + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error("DIRF cannot safely save this update because the project update counter is too large.");
  }
  atomicWrite(path, `${next}\n`);
  return next;
}

function canonicalAcceptsProgress(slug, canonicalBase, { workItem, reviewRevision }) {
  const current = parseCurrentHandoff(canonicalBase);
  const currentHasIdentity = Boolean(current.workItem?.trim());
  if (currentHasIdentity && (!workItem || !/^[0-9a-f]{40}$/i.test(reviewRevision || ""))) return false;
  if (!workItem || !/^[0-9a-f]{40}$/i.test(reviewRevision || "")) return true;
  if (current.workItem?.trim().toLowerCase() !== workItem.trim().toLowerCase()) return true;
  if (!/^[0-9a-f]{40}$/i.test(current.reviewRevision || "")) return true;
  const project = getProject(slug);
  const relation = revisionRelation(project?.main_path || process.cwd(), current.reviewRevision, reviewRevision);
  return relation !== "current_newer" && relation !== "conflict";
}

// Record one progress checkpoint through the canonical core so CLI and MCP
// cannot drift. Canonical and attempt handoffs are updated from their own
// bases; the attempt write happens first and the authoritative canonical write
// happens last. Concurrent attempts therefore keep scoped history while the
// project handoff remains a last-writer-wins snapshot.
export function recordProgress(slug, { message, timestamp, phase, next, files, attemptId, workItem, reviewRevision }) {
  if (!getProject(slug)) throw new Error(`Unknown DIRF project ${slug}`);
  return withProgressLock(slug, () => {
    const attempt = progressAttempt(slug, attemptId);
    const attemptHandoff = attempt ? readAttemptHandoffFile(slug, attempt.id) : null;
    const fallback = "# DIRF Handoff\n\n## Objective\n\n(Work in progress)\n";
    const canonicalBase = readHandoff(slug) || fallback;
    const recordedAttemptContext = parseCurrentHandoff(attemptHandoff || "");
    const update = {
      message,
      timestamp: timestamp || new Date().toISOString(),
      updateNumber: nextProgressUpdateNumber(slug),
      phase: phase || null,
      next,
      files: files || [],
      workItem: workItem || recordedAttemptContext.workItem || null,
      reviewRevision: reviewRevision || recordedAttemptContext.reviewRevision || null,
      attemptId: attempt?.id || null,
    };
    const updatedHandoff = canonicalAcceptsProgress(slug, canonicalBase, update)
      ? updateProgressSection(canonicalBase, update)
      : canonicalBase;
    const updatedAttemptHandoff = attempt
      ? updateProgressSection(attemptHandoff || canonicalBase, update)
      : null;

    if (attempt) atomicWrite(join(storeAttemptDir(slug, attempt.id), "HANDOFF.md"), updatedAttemptHandoff);
    writeHandoff(slug, updatedHandoff);
    const lifecycle = attempt ? syncLifecycleFromProgressLocked(slug, attempt.id, phase || null) : null;
    return { handoff: updatedHandoff, attempt_handoff: updatedAttemptHandoff, attempt, lifecycle };
  });
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
export function latestAttempt(slug) {
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
  } else if (target) {
    target = getAttempt(slug, target).id;
  } else if (!target) {
    const cur = latestAttempt(slug);
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
  const trimmed = String(text || "").trim().replace(/\s*\r?\n+\s*/g, " ");
  if (!trimmed) throw new Error("observation text must not be empty");
  let target = attemptId;
  if (project) {
    target = null;
  } else if (target) {
    target = getAttempt(slug, target).id;
  } else if (!target) {
    const cur = latestAttempt(slug);
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
  const cur = attemptId ? { id: attemptId } : latestAttempt(slug);
  if (!cur) throw new Error("No attempt to promote from — run `dirf build` first, or pass --attempt <id>.");
  const source = listObservations(slug, { attemptId: cur.id });
  const entry = source.find((e) => e.n === entryN);
  if (!entry) throw new Error(`No observation #${entryN} in attempt ${cur.id}. Run \`dirf notice list\` to see entries.`);
  appendObservation(slug, entry.text, { project: true });
  return { promoted: entryN, from: cur.id, text: entry.text };
}

// ─── Portfolio (cross-project view) ─────────────────────────────────────────
// A derived, read-only snapshot of every registered project: identity, an
// active/stale/completed/archived/empty classification, attempt counts and the
// latest attempt. Powers `dirf portfolio`, `dirf export obsidian|graphify` and
// (later) the flow-board app. The only project-level write is the explicit
// status override (setProjectStatus) — everything else stays derived so the
// view can never drift from the store.

// Explicit project-level statuses stored on the registry record. `null` clears
// the override and returns the project to derived classification.
export function setProjectStatus(slug, status) {
  if (status !== null && status !== "complete" && status !== "archived") {
    throw new Error(`Invalid project status ${JSON.stringify(status)} — use "complete" or "archived"`);
  }
  const registry = readRegistry();
  const record = registry.projects[slug];
  if (!record) throw new Error(`Unknown DIRF project ${slug}`);
  if (status === null) delete record.status;
  else record.status = status;
  writeRegistry(registry);
  return getProject(slug);
}

// The completion signal a project handoff can carry when it was closed by hand
// through handoff evidence rather than through the attempt lifecycle.
const HANDOFF_COMPLETE_RE = /^##\s*Status:\s*Complete\.?\s*$/m;

// Classification ladder (first match wins):
//   explicit override -> empty -> active (fresh harness evidence)
//   -> completed -> idle (open but recently observed/updated) -> stale.
export function portfolioSnapshot(now = new Date()) {
  const settings = readSettings();
  const staleDays = Number.isInteger(settings.stale_project_days) && settings.stale_project_days > 0
    ? settings.stale_project_days
    : DEFAULT_SETTINGS.stale_project_days;
  const staleMs = staleDays * 86_400_000;
  const nowMs = now.getTime();

  const projects = listProjects().map((project) => {
    const workRegistry = projectWorkSnapshot(project.slug, now);
    const attempts = workRegistry.attempts;
    const counts = { planned: 0, in_progress: 0, blocked: 0, abandoned: 0, done: 0, historical: 0 };
    let evidenceDone = 0;
    let lastActivity = Date.parse(project.last_seen || 0) || 0;
    for (const attempt of attempts) {
      const status = attempt.lifecycle_status;
      const source = attempt.status_source;
      if (status === "done" && source === "handoff") evidenceDone += 1;
      const key = ["planned", "in_progress", "blocked", "abandoned", "done", "historical"].includes(status) ? status : "historical";
      counts[key] += 1;
      const ts = Date.parse(attempt.updated_at || attempt.created_at || 0) || 0;
      if (ts > lastActivity) lastActivity = ts;
      const observedAt = Date.parse(attempt.execution?.observed_at || 0) || 0;
      if (observedAt > lastActivity) lastActivity = observedAt;
    }
    const tracked = attempts.filter((attempt) => attempt.tracked);
    const latest = attempts.reduce((candidate, attempt) => !candidate || attempt.id > candidate.id ? attempt : candidate, null);
    const handoffPath = join(storeProjectDir(project.slug), "HANDOFF.md");
    const handoff = readHandoff(project.slug);
    if (handoff !== null) lastActivity = Math.max(lastActivity, statSync(handoffPath).mtimeMs);
    const handoffComplete = handoff !== null && HANDOFF_COMPLETE_RE.test(handoff);
    const hasOpenWork = counts.in_progress > 0 || counts.blocked > 0;
    const allTrackedDone = tracked.length > 0 && tracked.every((attempt) => attempt.lifecycle_status === "done");
    const hasLiveWork = (workRegistry.summary.active || 0) > 0;

    let status;
    if (project.status === "complete" || project.status === "archived") status = project.status;
    else if (attempts.length === 0) status = "empty";
    else if (hasLiveWork) status = "active";
    else if (!hasOpenWork && (allTrackedDone || handoffComplete)) status = "completed";
    else if (nowMs - lastActivity < staleMs) status = "idle";
    else status = "stale";

    return {
      slug: project.slug,
      name: project.name,
      main_path: project.main_path,
      created_at: project.created_at,
      last_seen: project.last_seen,
      status,
      explicit_status: project.status || null,
      last_activity: lastActivity ? new Date(lastActivity).toISOString() : null,
      days_since_activity: lastActivity ? Math.max(0, Math.floor((nowMs - lastActivity) / 86_400_000)) : null,
      handoff: handoff !== null,
      attempts: { total: attempts.length, tracked: tracked.length, evidence_done: evidenceDone, ...counts },
      work_registry: workRegistry,
      latest: latest ? {
        id: latest.id,
        name: latest.name,
        status: latest.lifecycle_status,
        status_source: latest.status_source,
        current_phase: latest.current_phase || null,
        updated_at: latest.updated_at || latest.created_at,
        ...attemptContextState(project.slug, latest.id),
      } : null,
    };
  });

  const summary = { projects: projects.length };
  for (const project of projects) {
    summary[project.status] = (summary[project.status] || 0) + 1;
    for (const [key, value] of Object.entries(project.attempts)) {
      if (key === "total" || key === "tracked") continue;
      summary[`attempts_${key}`] = (summary[`attempts_${key}`] || 0) + value;
    }
  }

  return {
    generated_at: new Date(nowMs).toISOString(),
    stale_project_days: staleDays,
    summary,
    projects,
  };
}

// Point-in-time, project-scoped view for humans and board adapters. Lifecycle
// remains authoritative for completion; a host observation only answers who
// owns the work and whether that execution is live now.
export function projectWorkSnapshot(slug, now = new Date()) {
  const project = getProject(slug);
  if (!project) throw new Error(`Unknown DIRF project ${slug}`);
  const staleMs = readSettings().stale_worktree_days * 86_400_000;
  const stateOrder = ["active", "blocked", "resumable", "stale", "abandoned", "planned", "completed", "historical", "unknown"];
  const storedAttempts = listAttempts(slug);
  const attempts = storedAttempts.map((attempt) => {
    const effective = effectiveAttemptStatus(slug, attempt);
    const nextAction = handoffNextAction(readAttemptHandoffFile(slug, attempt.id));
    const execution = attempt.current_execution || null;
    const observedAt = Date.parse(execution?.observed_at || 0) || 0;
    const updatedAt = Date.parse(attempt.updated_at || attempt.created_at || 0) || 0;
    const observationIsFresh = executionIsFresh(execution, now);
    const observationIsActive = observationIsFresh && executionIsActive(execution);
    const observationIsExpired = Boolean(execution) && !observationIsFresh;
    const hasBlockingChild = observationIsFresh &&
      (execution.children || []).some((child) => child.status === "blocked" && child.blocks_parent === true);
    const isStale = now.getTime() - Math.max(updatedAt, observedAt) >= staleMs;

    let liveState = "unknown";
    if (effective.status === "done") liveState = "completed";
    else if (effective.status === "abandoned") liveState = "abandoned";
    else if (observationIsActive) liveState = "active";
    else if (attempt.status === "blocked" || hasBlockingChild) liveState = "blocked";
    else if (observationIsExpired || isStale) liveState = "stale";
    else if (attempt.status === "planned") liveState = "planned";
    else if (attempt.status === "historical") liveState = "historical";
    else if (nextAction) liveState = "resumable";

    const executionView = execution ? {
      harness: execution.harness,
      session_id: execution.session_id,
      status: execution.status,
      observed_at: execution.observed_at,
      branch: execution.branch || null,
      fresh: observationIsFresh,
      children: execution.children || [],
      ...(execution.previous_owner ? { previous_owner: execution.previous_owner } : {}),
    } : null;
    const worktreePath = execution?.worktree_path || attempt.responsibility_path || attempt.worktree_path || null;
    const handoffPath = join(attempt.folder, "HANDOFF.md");
    return {
      id: attempt.id,
      name: attempt.name,
      tracked: attempt.tracked,
      created_at: attempt.created_at,
      lifecycle_status: effective.status,
      status_source: effective.status_source,
      live_state: liveState,
      current_phase: attempt.current_phase || null,
      worker: attempt.worker || null,
      blocker: attempt.blocker || null,
      abandonment_reason: attempt.abandonment_reason || null,
      updated_at: attempt.updated_at || attempt.created_at,
      execution: executionView,
      worktree_path: worktreePath,
      handoff_path: existsSync(handoffPath) ? handoffPath : null,
      next_action: nextAction,
    };
  }).sort((left, right) => {
    const state = stateOrder.indexOf(left.live_state) - stateOrder.indexOf(right.live_state);
    return state || right.updated_at.localeCompare(left.updated_at);
  });

  const summary = { total: attempts.length };
  for (const attempt of attempts) summary[attempt.live_state] = (summary[attempt.live_state] || 0) + 1;
  const projectHandoffPath = join(storeProjectDir(slug), "HANDOFF.md");
  const projectHandoff = readHandoff(slug);
  const scoped = attempts.find((attempt) => ["active", "blocked", "resumable", "stale"].includes(attempt.live_state) && attempt.handoff_path) || null;
  const projectUpdatedAt = projectHandoff !== null ? statSync(projectHandoffPath).mtime : null;
  const scopedUpdatedAt = scoped?.handoff_path ? statSync(scoped.handoff_path).mtime : null;
  const useProjectHandoff = projectHandoff !== null && (!scopedUpdatedAt || projectUpdatedAt >= scopedUpdatedAt);
  const continuation = useProjectHandoff ? {
    source: "project",
    attempt_id: null,
    handoff_path: projectHandoffPath,
    next_action: handoffNextAction(projectHandoff),
    updated_at: projectUpdatedAt.toISOString(),
  } : scoped ? {
    source: "attempt",
    attempt_id: scoped.id,
    handoff_path: scoped.handoff_path,
    next_action: scoped.next_action,
    updated_at: scopedUpdatedAt.toISOString(),
  } : null;
  return {
    generated_at: now.toISOString(),
    project: {
      slug: project.slug,
      name: project.name,
      main_path: project.main_path,
      handoff_path: projectHandoff !== null ? projectHandoffPath : null,
    },
    summary,
    continuation,
    attempts,
  };
}
