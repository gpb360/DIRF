// Worktree janitor: decides which worktrees of one project can lose their
// dependencies or be removed, whichever tool created them. It reads git and the
// file system only; attempt linkage arrives through the entries that
// `inspectProjectWorktrees` (src/state.js) returns.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

const DAY = 86_400_000;
const GIT_TIMEOUT = 600_000;
const COMPARE_LIMIT = 5 * 1024 * 1024;
const DIRTY_FILE_LIMIT = 200;

export const JANITOR_DEFAULTS = Object.freeze({ shedDays: 1, removeDays: 3, keepDays: 14 });

// The recycle bin. A removed worktree is moved into this folder beside its old
// location, so the move stays on one volume and either happens whole or not at all.
// Git still lists a binned worktree; the janitor leaves those out of its plan.
const BIN_DIR = ".dirf-trash";
// A binned branch is renamed under this prefix, which keeps its history and its upstream setting.
const BIN_BRANCH_PREFIX = "dirf-trash/";
const PROTECTED_BRANCHES = new Set(["main", "master"]);
const inBin = (path) => key(path).includes(`/${BIN_DIR.toLowerCase()}/`);

// One line per tool. The first pattern that matches the worktree path wins.
const OWNER_PATTERNS = [
  ["t3", /\/\.t3\/worktrees\//],
  ["codex", /\/\.codex\/|\/documents\/codex\//],
  ["claude", /\/\.claude\/|\/temp\/claude\//],
  ["archon", /\/\.archon\//],
  ["gsd", /\/\.gsd\//],
  ["opencode", /\/opencode\//],
];

// A folder is scanned for orphans only when a path segment names it a worktree root.
const WORKTREE_ROOT = /\/\.?worktrees(\/|$)/;

const DEPENDENCY_DIR = "node_modules";

// Ignored content that a build or an install recreates. Anything else that git
// ignores may exist nowhere else, so it blocks removal.
const REGENERABLE = new Set([
  "node_modules", ".next", ".nuxt", ".svelte-kit", ".output", ".expo", ".turbo", ".cache", ".vite", ".parcel-cache",
  "dist", "build", "out", "coverage", "target", ".gradle", ".venv", "venv", "__pycache__", ".pytest_cache",
  ".mypy_cache", ".ruff_cache", ".eslintcache", ".DS_Store", "Thumbs.db", ".tmp", ".temp", "next-env.d.ts",
]);

// An orphan folder is removable only when nothing but these names is left in it.
const ORPHAN_RESIDUE = new Set(["node_modules", ".next", ".turbo", ".cache", ".vite", ".codex-worktree-name"]);

const portable = (path) => path.replace(/\\/g, "/").replace(/\/+$/, "");
const key = (path) => portable(path).toLowerCase();

function git(target, args, env) {
  return execFileSync("git", ["--no-optional-locks", "-c", "core.longpaths=true", "-C", target, ...args], { env: env ? { ...process.env, ...env } : process.env, encoding: "utf8", timeout: GIT_TIMEOUT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

export function worktreeOwner(path, mainPath) {
  const target = key(path);
  const main = key(mainPath);
  for (const [owner, pattern] of OWNER_PATTERNS) if (pattern.test(`${target}/`)) return owner;
  if (target.startsWith(`${main}/`)) return "repo-local";
  if (dirname(target) === dirname(main)) return "sibling";
  return "other";
}

function isRegenerable(relativePath) {
  return relativePath.split("/").some((segment) => REGENERABLE.has(segment)) || /\.(log|tsbuildinfo)$/.test(relativePath);
}

// The per-worktree git folder. Its HEAD changes on checkout, commit, reset and
// rebase. The index is left out because `git status` rewrites it.
function adminDir(path) {
  try {
    const dotGit = join(path, ".git");
    if (lstatSync(dotGit).isDirectory()) return dotGit;
    const pointer = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m)?.[1].trim();
    if (!pointer) return null;
    return isAbsolute(pointer) ? pointer : join(path, pointer);
  } catch {
    return null;
  }
}

// When HEAD last moved, read from the newest reflog entry. The file's own
// timestamp is no evidence: git maintenance rewrites every worktree's reflog.
function lastReflogTime(admin, log = "HEAD") {
  try {
    const lines = readFileSync(join(admin, "logs", log), "utf8").trimEnd().split("\n");
    return Number(lines.at(-1).match(/> (\d+) [+-]\d{4}(\t|$)/)?.[1] || 0) * 1000;
  } catch {
    return 0;
  }
}

function dirtyFiles(path) {
  try {
    return git(path, ["status", "--porcelain", "-z"]).split("\0").filter(Boolean).map((line) => line.slice(3)).slice(0, DIRTY_FILE_LIMIT);
  } catch {
    return [];
  }
}

function lastActivity(entry) {
  const times = [Date.parse(entry.last_commit_at || "") || 0];
  const touch = (file, birth = false) => {
    try {
      const stat = statSync(file);
      times.push(stat.mtimeMs);
      if (birth) times.push(stat.birthtimeMs);
    } catch { /* a missing file adds no evidence */ }
  };
  touch(entry.path, true);
  const admin = adminDir(entry.path);
  if (admin) {
    touch(join(admin, "HEAD"));
    times.push(lastReflogTime(admin));
  }
  if (entry.dirty) for (const file of dirtyFiles(entry.path)) touch(join(entry.path, file));
  return Math.max(...times);
}

function listIgnored(path) {
  try {
    return git(path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]).split("\0").filter(Boolean).map(portable);
  } catch {
    return [];
  }
}

const succeeds = (action) => { try { action(); return true; } catch { return false; } };

// No modified, staged or untracked file. A failed check counts as not clean.
function isClean(path) {
  try { return !git(path, ["status", "--porcelain"]).trim(); } catch { return false; }
}

// The refs that hold a commit apart from the worktree itself. A branch survives
// removal of its worktree, so its commits count as kept once a remote-tracking
// ref holds them. A detached HEAD needs some ref to hold it.
function refsHolding(target, commit, namespaces) {
  try {
    return git(target, ["for-each-ref", "--count=3", "--contains", commit, "--format=%(refname)", ...namespaces]).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// The remote's default branch when the commit is already part of it.
function mergedInto(target, commit) {
  const candidates = ["refs/remotes/origin/main", "refs/remotes/origin/master"];
  try { candidates.unshift(git(target, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]).trim()); } catch { /* the remote names no default branch */ }
  return candidates.find((ref) => ref && succeeds(() => git(target, ["merge-base", "--is-ancestor", commit, ref]))) || null;
}

// The remote's default branch: the ref that "merged" is measured against.
function defaultRemoteRef(target) {
  let named = null;
  try { named = git(target, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]).trim(); } catch { /* the remote names no default branch */ }
  return [named, "refs/remotes/origin/main", "refs/remotes/origin/master"].find((ref) => ref && revParse(target, ref)) || null;
}

// True when `ref` already holds the whole change of `tip` as one commit, which
// is what a squash merge leaves behind. The check needs a throwaway commit; it
// is written to a temporary object folder so the repository gains nothing.
function squashMergedInto(target, tip, ref) {
  const scratch = mkdtempSync(join(tmpdir(), "dirf-probe-"));
  try {
    const objects = git(target, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]).trim();
    const env = { GIT_OBJECT_DIRECTORY: scratch, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
    const base = git(target, ["merge-base", ref, tip]).trim();
    const probe = git(target, ["-c", "user.name=dirf", "-c", "user.email=dirf@localhost", "commit-tree", `${tip}^{tree}`, "-p", base, "-m", "dirf: squash probe"], env).trim();
    return git(target, ["cherry", ref, probe], env).startsWith("-");
  } catch {
    return false;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Decides which local branches can go to the recycle bin. A branch qualifies
// only when the default branch already holds its work; every other branch is
// kept and the reason is reported.
function planBranches(main, { now, removeDays }) {
  const target = defaultRemoteRef(main);
  const common = git(main, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const inUse = new Set(listedWorktrees(main).map((entry) => entry.branch).filter(Boolean));
  const merged = new Set(target ? git(main, ["for-each-ref", "refs/heads", "--merged", target, "--format=%(refname:short)"]).split("\n").filter(Boolean) : []);
  const rows = git(main, ["for-each-ref", "refs/heads", "--format=%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)"]).split("\n").filter(Boolean);
  const branches = [];
  for (const row of rows) {
    const [branch, head, upstream, track, committed] = row.split("\t");
    if (branch.startsWith(BIN_BRANCH_PREFIX)) continue;
    const item = { branch, head, upstream: upstream || null, action: "keep", reason: "", idle_days: null, proof: null };
    branches.push(item);
    if (inUse.has(branch)) { item.reason = "checked out in a worktree"; continue; }
    if (PROTECTED_BRANCHES.has(branch) || (target && target.endsWith(`/origin/${branch}`))) { item.reason = "protected"; continue; }
    const idle = Math.max(0, now.getTime() - Math.max(Number(committed) * 1000, lastReflogTime(common, join("refs", "heads", branch))));
    item.idle_days = Math.floor(idle / DAY);
    if (idle < removeDays * DAY) { item.reason = "recent"; continue; }
    if (!target) { item.reason = "no default remote branch to compare with"; continue; }
    const gone = track === "[gone]";
    if (merged.has(branch)) Object.assign(item, { action: "remove", proof: { merged_into: target } });
    else if (gone && squashMergedInto(main, head, target)) Object.assign(item, { action: "remove", proof: { squash_merged_into: target } });
    else if (!upstream) item.reason = "never pushed: this is the only copy";
    else if (gone) item.reason = "its remote branch is gone and the default branch does not hold its work";
    else if (track.includes("ahead")) item.reason = "has commits that were not pushed";
    else item.reason = "pushed, not merged";
  }
  return branches;
}

function sameAsMain(worktreePath, mainPath, relativePath) {
  try {
    const mine = join(worktreePath, relativePath);
    const theirs = join(mainPath, relativePath);
    const a = statSync(mine);
    const b = statSync(theirs);
    if (!a.isFile() || !b.isFile() || a.size !== b.size || a.size > COMPARE_LIMIT) return false;
    return readFileSync(mine).equals(readFileSync(theirs));
  } catch {
    return false;
  }
}

// Sums file sizes without following links. Hard-linked package stores make this
// an upper bound on the space a removal returns.
function dirBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      const full = join(dir, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) stack.push(full);
      else try { total += statSync(full).size; } catch { /* vanished while scanning */ }
    }
  }
  return total;
}

function planWorktree(entry, mainPath, { now, shedDays, removeDays, sizes }) {
  const item = {
    path: entry.path, branch: entry.branch || null, owner: entry.is_main ? "main" : worktreeOwner(entry.path, mainPath),
    action: "keep", blocked_by: [], idle_days: null, dirty: Boolean(entry.dirty || entry.conflicted),
    attempt_id: entry.attempt_id || null, shed_paths: [], bytes: sizes ? 0 : null, head: entry.head || null, proof: null,
  };
  if (entry.is_main) return item;
  if (!existsSync(entry.path)) return { ...item, blocked_by: ["missing on disk"] };
  if (entry.attempt_id && !["done", "abandoned"].includes(entry.attempt_status)) return { ...item, blocked_by: ["live attempt"] };

  const idle = Math.max(0, now.getTime() - lastActivity(entry));
  item.idle_days = Math.floor(idle / DAY);
  if (idle < Math.min(shedDays, removeDays) * DAY) return item;

  const ignored = listIgnored(entry.path);
  if (idle >= removeDays * DAY) {
    if (item.dirty) item.blocked_by.push("dirty");
    else {
      const admin = adminDir(entry.path);
      // Git refuses to move a locked worktree or one that holds submodules.
      if (admin && existsSync(join(admin, "locked"))) item.blocked_by.push("locked");
      if (admin && existsSync(join(admin, "modules"))) item.blocked_by.push("has submodules");
      const heldBy = refsHolding(entry.path, "HEAD", entry.branch ? ["refs/remotes"] : ["refs/remotes", "refs/heads"]);
      if (!heldBy.length) item.blocked_by.push("unpushed");
      const unique = ignored.filter((file) => !isRegenerable(file) && !sameAsMain(entry.path, mainPath, file));
      if (unique.length) item.blocked_by.push(`local-only ignored files: ${unique.slice(0, 3).join(", ")}${unique.length > 3 ? ` and ${unique.length - 3} more` : ""}`);
      // The dirty flag on the entry can miss files on paths longer than Windows allows by default, so removal asks git again.
      if (!item.blocked_by.length && !isClean(entry.path)) { item.dirty = true; item.blocked_by.push("dirty"); }
      if (!item.blocked_by.length) item.proof = { held_by: heldBy, merged_into: mergedInto(entry.path, "HEAD"), ignored_kept: ignored.filter((file) => basename(file) !== DEPENDENCY_DIR) };
    }
    if (!item.blocked_by.length) item.action = "remove";
  }
  // Dependencies are deleted, not binned, so only folders that an install can rebuild qualify.
  item.shed_paths = ignored.filter((file) => basename(file) === DEPENDENCY_DIR && existsSync(join(entry.path, dirname(file), "package.json"))).map((file) => portable(join(entry.path, file)));
  if (item.action === "keep" && idle >= shedDays * DAY && item.shed_paths.length) item.action = "shed";
  if (sizes && item.action === "remove") item.bytes = dirBytes(entry.path);
  if (sizes && item.action === "shed") item.bytes = item.shed_paths.reduce((sum, dir) => sum + dirBytes(dir), 0);
  return item;
}

function isOrphanCandidate(path) {
  return WORKTREE_ROOT.test(key(dirname(path))) && !existsSync(join(path, ".git"));
}

function findOrphans(entries, mainPath, sizes) {
  const listed = entries.map((entry) => key(entry.path));
  const roots = new Map();
  for (const entry of entries) {
    const parent = dirname(portable(entry.path));
    if (!entry.is_main && WORKTREE_ROOT.test(key(parent))) roots.set(key(parent), parent);
  }
  const orphans = [];
  for (const root of roots.values()) {
    let items;
    try { items = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      const path = portable(join(root, item.name));
      if (!item.isDirectory() || item.isSymbolicLink() || item.name === BIN_DIR || !isOrphanCandidate(path)) continue;
      if (listed.some((known) => known === key(path) || known.startsWith(`${key(path)}/`))) continue;
      let contents;
      try { contents = readdirSync(path); } catch { continue; }
      // A shared root nests other projects' checkouts one level down; those folders are not orphans.
      if (contents.some((name) => existsSync(join(path, name, ".git")))) continue;
      const residue = contents.every((name) => ORPHAN_RESIDUE.has(name));
      orphans.push({
        path, owner: worktreeOwner(path, mainPath), action: residue ? "remove" : "report",
        reason: residue ? "only install or cache residue remains" : "contains files that no git checkout tracks",
        bytes: sizes ? dirBytes(path) : null,
      });
    }
  }
  return orphans.sort((a, b) => a.path.localeCompare(b.path));
}

export function planJanitor(entries, { now = new Date(), shedDays = JANITOR_DEFAULTS.shedDays, removeDays = JANITOR_DEFAULTS.removeDays, sizes = true, branches: withBranches = true } = {}) {
  for (const [name, value] of [["shed days", shedDays], ["remove days", removeDays]]) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number of days, zero or more`);
  }
  entries = entries.filter((entry) => !inBin(entry.path));
  const main = entries.find((entry) => entry.is_main);
  if (!main) throw new Error("the main project checkout was not found");
  const worktrees = entries.map((entry) => planWorktree(entry, main.path, { now, shedDays, removeDays, sizes }));
  const orphans = findOrphans(entries, main.path, sizes);
  const sum = (items) => sizes ? items.reduce((total, item) => total + item.bytes, 0) : null;
  const pick = (action) => worktrees.filter((item) => item.action === action);
  const removableOrphans = orphans.filter((item) => item.action === "remove");
  const branches = withBranches ? planBranches(main.path, { now, removeDays }) : [];
  return {
    generated_at: now.toISOString(), main: main.path, shed_days: shedDays, remove_days: removeDays,
    totals: {
      remove: { count: pick("remove").length, bytes: sum(pick("remove")) },
      shed: { count: pick("shed").length, bytes: sum(pick("shed")) },
      blocked: { count: worktrees.filter((item) => item.blocked_by.length).length },
      keep: { count: pick("keep").length },
      orphans: { count: orphans.length, removable: removableOrphans.length, bytes: sum(removableOrphans) },
      branches: { count: branches.length, removable: branches.filter((item) => item.action === "remove").length },
    },
    worktrees, orphans, branches,
  };
}

function removeDir(path) {
  rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

function revParse(target, ref) {
  try { return git(target, ["rev-parse", "-q", "--verify", ref]).trim(); } catch { return null; }
}

// What git records about each worktree of the project: its path and the branch it has checked out.
function listedWorktrees(main) {
  return git(main, ["worktree", "list", "--porcelain"]).split("\n\n").map((block) => ({
    path: block.match(/^worktree (.+)$/m)?.[1] || "",
    branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] || null,
  }));
}

const isListed = (main, path) => listedWorktrees(main).some((entry) => key(entry.path) === key(path));
const branchInUse = (main, branch) => listedWorktrees(main).some((entry) => entry.branch === branch);

// A receipt is the lasting record of one binned worktree: what it was, the proof
// that its work lives elsewhere, and what was checked after the move.
function readReceipt(store, id) {
  if (!/^[\w-]+$/.test(id || "")) throw new Error("a recycle bin id is required; list them with: dirf worktree bin");
  try { return JSON.parse(readFileSync(join(store, `${id}.json`), "utf8")); } catch { throw new Error(`no recycle bin entry is named ${id}`); }
}

function writeReceipt(store, receipt) {
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, `${receipt.id}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
}

// One line for every change the janitor makes, including the deletions that have no receipt.
function journal(store, now, entry) {
  mkdirSync(store, { recursive: true });
  appendFileSync(join(store, "journal.jsonl"), `${JSON.stringify({ at: now.toISOString(), ...entry })}\n`);
}

// Moves one worktree into the bin with `git worktree move`, so git keeps every
// record of it: its index, its reflog and the commits only that reflog holds.
function binWorktree(main, item, store, now) {
  const head = revParse(item.path, "HEAD");
  if (!head || head !== item.head) throw new Error("HEAD moved after the plan was made; the worktree was left untouched");
  if (!isClean(item.path)) throw new Error("changes appeared after the plan was made; the worktree was left untouched");

  const base = `${now.toISOString().replace(/[-:]|\.\d+/g, "")}-${basename(item.path).replace(/[^A-Za-z0-9_-]+/g, "-")}`;
  let id = base;
  for (let n = 2; existsSync(join(store, `${id}.json`)); n++) id = `${base}-${n}`;
  const root = join(dirname(item.path), BIN_DIR);
  const payload = portable(join(root, id));
  mkdirSync(root, { recursive: true });
  // Keeps the bin out of `git status` when its parent folder sits inside a checkout.
  if (!existsSync(join(root, ".gitignore"))) writeFileSync(join(root, ".gitignore"), "*\n");

  try { git(main, ["worktree", "move", item.path, payload]); } catch (error) {
    throw new Error(`git could not move the folder, so the worktree was left untouched (${String(error.stderr || error.message).trim()})`);
  }
  // HEAD lets go of the branch so another worktree can check it out. No file changes and no hooks run.
  if (item.branch) git(payload, ["update-ref", "--no-deref", "-m", "dirf: moved to the recycle bin", "HEAD", head]);

  const worktreeKey = `${key(item.path)}/`;
  const dependencies = item.shed_paths.filter((dir) => basename(dir) === DEPENDENCY_DIR && key(dir).startsWith(worktreeKey)).map((dir) => join(payload, portable(dir).slice(worktreeKey.length)));
  const after = {
    commit_present: succeeds(() => git(main, ["cat-file", "-e", `${head}^{commit}`])),
    branch_at_head: item.branch ? revParse(main, `refs/heads/${item.branch}`) === head : null,
    branch_free: item.branch ? !branchInUse(main, item.branch) : null,
    moved: isListed(main, payload) && !existsSync(item.path),
    dependencies_deleted: dependencies.every((dir) => succeeds(() => removeDir(dir))),
  };
  const receipt = {
    id, status: "in_bin", trashed_at: now.toISOString(), main, path: portable(item.path), payload,
    branch: item.branch, head, owner: item.owner, idle_days: item.idle_days,
    proof: { clean: true, ...item.proof }, after, verified: Object.values(after).every((check) => check !== false),
    restore: `dirf worktree restore ${id}`,
  };
  writeReceipt(store, receipt);
  journal(store, now, { action: "bin", id, path: receipt.path });
  return receipt;
}

// Moves one branch into the bin by renaming it, so git keeps its history and its
// upstream setting. Nothing is deleted until the bin is purged.
function binBranch(main, item, store, now) {
  if (revParse(main, `refs/heads/${item.branch}`) !== item.head) throw new Error("the branch moved after the plan was made; it was left untouched");
  if (branchInUse(main, item.branch)) throw new Error("the branch is checked out in a worktree; it was left untouched");
  const base = `${now.toISOString().replace(/[-:]|\.\d+/g, "")}-${item.branch.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
  let id = base;
  for (let n = 2; existsSync(join(store, `${id}.json`)); n++) id = `${base}-${n}`;
  const binnedAs = `${BIN_BRANCH_PREFIX}${id}`;
  git(main, ["branch", "-m", item.branch, binnedAs]);
  const after = {
    commit_present: succeeds(() => git(main, ["cat-file", "-e", `${item.head}^{commit}`])),
    renamed: revParse(main, `refs/heads/${binnedAs}`) === item.head && !revParse(main, `refs/heads/${item.branch}`),
  };
  const receipt = {
    id, kind: "branch", status: "in_bin", trashed_at: now.toISOString(), main, branch: item.branch, binned_as: binnedAs,
    head: item.head, upstream: item.upstream, idle_days: item.idle_days,
    proof: item.proof, after, verified: Object.values(after).every((check) => check !== false),
    restore: `dirf worktree restore ${id}`,
  };
  writeReceipt(store, receipt);
  journal(store, now, { action: "bin-branch", id, branch: item.branch });
  return receipt;
}

// Carries out a plan. A removable worktree is moved into the recycle bin after
// its state is checked again; only dependency folders and cache-only orphans are
// deleted. `store` is the folder that keeps the receipts and the journal.
// `only` limits the run to one step: "remove", "shed", "orphans" or "branches".
export function applyJanitor(plan, { store, now = new Date(), only } = {}) {
  if (!store) throw new Error("a folder for recycle bin receipts is required");
  if (only && !["remove", "shed", "orphans", "branches"].includes(only)) throw new Error("--only takes one of: remove, shed, orphans, branches");
  const wants = (step) => !only || only === step;
  const result = { binned: [], shed: [], orphans_removed: [], branches_binned: [], errors: [] };
  const attempt = (path, action) => {
    try { action(); return true; } catch (error) {
      result.errors.push({ path, error: String(error.stderr || error.message).trim() });
      return false;
    }
  };
  for (const item of plan.worktrees) {
    if (item.action === "remove" && wants("remove")) {
      attempt(item.path, () => {
        const receipt = binWorktree(plan.main, item, store, now);
        result.binned.push({ id: receipt.id, path: receipt.path, payload: receipt.payload });
        if (!receipt.verified) throw new Error(`a check failed after the move (${Object.keys(receipt.after).filter((check) => receipt.after[check] === false).join(", ")}); put it back with: ${receipt.restore}`);
      });
    } else if (item.action === "shed" && wants("shed")) {
      for (const dir of item.shed_paths.filter((dir) => basename(dir) === DEPENDENCY_DIR && key(dir).startsWith(`${key(item.path)}/`) && existsSync(dir))) {
        if (attempt(dir, () => removeDir(dir))) { result.shed.push(dir); journal(store, now, { action: "shed", path: dir }); }
      }
    }
  }
  for (const item of plan.orphans) {
    if (item.action === "remove" && wants("orphans") && isOrphanCandidate(item.path) && attempt(item.path, () => removeDir(item.path))) {
      result.orphans_removed.push(item.path);
      journal(store, now, { action: "orphan", path: item.path });
    }
  }
  for (const item of plan.branches || []) {
    if (item.action !== "remove" || !wants("branches")) continue;
    attempt(`branch ${item.branch}`, () => {
      const receipt = binBranch(plan.main, item, store, now);
      result.branches_binned.push({ id: receipt.id, branch: receipt.branch });
      if (!receipt.verified) throw new Error(`a check failed after the rename; put it back with: ${receipt.restore}`);
    });
  }
  return result;
}

export function listBin(store) {
  let names;
  try { names = readdirSync(store); } catch { return []; }
  return names.filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(store, name), "utf8"))).sort((a, b) => a.trashed_at.localeCompare(b.trashed_at));
}

// Moves a binned worktree back where it was. Git state and files return as they
// were; dependencies were deleted when it was binned, so they need a fresh install.
export function restoreFromBin(store, id, { now = new Date() } = {}) {
  const receipt = readReceipt(store, id);
  const { main, head, branch, path, payload } = receipt;
  if (receipt.status !== "in_bin") throw new Error(`${id} was already ${receipt.status}`);
  if (receipt.kind === "branch") {
    if (revParse(main, `refs/heads/${branch}`)) throw new Error(`a branch named ${branch} exists again; the binned one stays as ${receipt.binned_as}`);
    git(main, ["branch", "-m", receipt.binned_as, branch]);
    Object.assign(receipt, { status: "restored", restored_at: now.toISOString(), restored_as: branch });
    writeReceipt(store, receipt);
    journal(store, now, { action: "restore-branch", id, branch });
    return receipt;
  }
  if (!existsSync(payload)) throw new Error(`the binned folder is missing: ${payload}`);
  if (existsSync(path)) throw new Error(`the original location is occupied: ${path}`);

  git(main, ["worktree", "move", payload, path]);
  // HEAD takes the branch back only while the branch still points at the binned commit and no other worktree holds it.
  const onBranch = Boolean(branch) && revParse(path, "HEAD") === head && revParse(main, `refs/heads/${branch}`) === head && !branchInUse(main, branch)
    && succeeds(() => git(path, ["symbolic-ref", "-m", "dirf: restored from the recycle bin", "HEAD", `refs/heads/${branch}`]));

  Object.assign(receipt, { status: "restored", restored_at: now.toISOString(), restored_as: onBranch ? branch : "detached HEAD" });
  writeReceipt(store, receipt);
  journal(store, now, { action: "restore", id, path });
  return receipt;
}

// Deletes one binned branch, and only while the proof that put it in the bin still holds.
function purgeBranch(receipt) {
  const { main, head, binned_as: binnedAs, proof } = receipt;
  if (revParse(main, `refs/heads/${binnedAs}`) !== head) return "it changed while it was in the bin";
  const holds = proof.merged_into ? succeeds(() => git(main, ["merge-base", "--is-ancestor", head, proof.merged_into])) : squashMergedInto(main, head, proof.squash_merged_into);
  if (!holds) return "the default branch no longer holds its work";
  return null;
}

const receiptLabel = (receipt) => receipt.kind === "branch" ? `branch ${receipt.branch}` : receipt.path;

// Deletes binned worktrees and branches for good once they are older than
// `keepDays`. A worktree goes only while some branch or remote still holds its
// commit; git does the delete and refuses when files changed inside the bin.
// A branch goes only while the default branch still holds its work. Receipts are kept.
export function purgeBin(store, { keepDays = JANITOR_DEFAULTS.keepDays, apply = false, now = new Date() } = {}) {
  if (!Number.isFinite(keepDays) || keepDays < 0) throw new Error("keep days must be a number of days, zero or more");
  const result = { keep_days: keepDays, applied: apply, purged: [], due: [], blocked: [], errors: [] };
  for (const receipt of listBin(store)) {
    if (receipt.status !== "in_bin" || now.getTime() - Date.parse(receipt.trashed_at) < keepDays * DAY) continue;
    const isBranch = receipt.kind === "branch";
    const entry = { id: receipt.id, path: receiptLabel(receipt) };
    const heldBy = isBranch ? [] : refsHolding(receipt.main, receipt.head, ["refs/remotes", "refs/heads"]);
    const blocked = isBranch ? purgeBranch(receipt) : heldBy.length ? null : "its commit is no longer on any branch or remote";
    if (blocked) { result.blocked.push({ ...entry, reason: blocked }); continue; }
    if (!apply) { result.due.push(entry); continue; }
    try {
      if (isBranch) {
        if (!receipt.binned_as.startsWith(BIN_BRANCH_PREFIX)) throw new Error("the receipt does not point at a binned branch");
        git(receipt.main, ["branch", "-D", receipt.binned_as]);
      } else {
        if (basename(dirname(receipt.payload)) !== BIN_DIR || basename(receipt.payload) !== receipt.id) throw new Error("the receipt does not point into a recycle bin");
        git(receipt.main, ["worktree", "remove", receipt.payload]);
      }
      Object.assign(receipt, { status: "purged", purged_at: now.toISOString(), ...(isBranch ? {} : { held_by_at_purge: heldBy }) });
      writeReceipt(store, receipt);
      journal(store, now, { action: isBranch ? "purge-branch" : "purge", ...entry });
      result.purged.push(entry);
    } catch (error) {
      result.errors.push({ path: entry.path, error: String(error.stderr || error.message).trim() });
    }
  }
  return result;
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
}

export function formatJanitorReport(plan) {
  const { totals } = plan;
  const applied = plan.applied;
  const lines = [
    applied ? "DIRF worktree janitor: applied" : "DIRF worktree janitor: dry run, nothing was changed",
    `Project: ${plan.main}`,
    `Rule: shed ${DEPENDENCY_DIR} after ${plan.shed_days} idle day(s); remove after ${plan.remove_days} idle day(s) when clean and pushed`,
    "A removed worktree is moved to the recycle bin and can be restored until it is purged.",
    "",
    `remove   ${totals.remove.count}   ${formatBytes(totals.remove.bytes)}`.trimEnd(),
    `shed     ${totals.shed.count}   ${formatBytes(totals.shed.bytes)}`.trimEnd(),
    `blocked  ${totals.blocked.count}`,
    `keep     ${totals.keep.count}`,
    `orphans  ${totals.orphans.count}   ${totals.orphans.removable} removable ${formatBytes(totals.orphans.bytes)}`.trimEnd(),
    `branches ${totals.branches.count}   ${totals.branches.removable} removable`,
  ];
  const row = (item) => `  ${item.owner.padEnd(10)} ${String(item.idle_days ?? "-").padStart(3)}d  ${formatBytes(item.bytes).padStart(9)}  ${item.path}${item.branch ? ` [${item.branch}]` : ""}`;
  const section = (title, items, render) => { if (items.length) lines.push("", title, ...items.map(render)); };
  section("REMOVE worktree to the recycle bin (branch is kept)", plan.worktrees.filter((item) => item.action === "remove"), (item) => `${row(item)}: ${proofText(item)}`);
  section(`SHED ${DEPENDENCY_DIR} (worktree is kept)`, plan.worktrees.filter((item) => item.action === "shed"), row);
  section("BLOCKED from removal", plan.worktrees.filter((item) => item.blocked_by.length), (item) => `${row(item)}: ${item.blocked_by.join("; ")}`);
  section("ORPHANS (folders in a worktree root that git does not list)", plan.orphans, (item) => `  ${item.action.padEnd(6)} ${item.owner.padEnd(10)} ${formatBytes(item.bytes).padStart(9)}  ${item.path}: ${item.reason}`);
  section("REMOVE branch to the recycle bin (its work is in the default branch)", plan.branches.filter((item) => item.action === "remove"), (item) => `  ${String(item.idle_days).padStart(3)}d  ${item.branch}: ${proofText(item)}`);
  const kept = new Map();
  for (const item of plan.branches) if (item.action === "keep") kept.set(item.reason, (kept.get(item.reason) || 0) + 1);
  section("BRANCHES kept", [...kept].sort((a, b) => b[1] - a[1]), ([reason, count]) => `  ${String(count).padStart(4)}  ${reason}`);
  if (applied) {
    lines.push("", `Moved ${applied.binned.length} worktree(s) to the recycle bin, shed ${applied.shed.length} folder(s), removed ${applied.orphans_removed.length} orphan(s). Moved ${applied.branches_binned.length} branch(es) to the recycle bin.`);
    section("IN THE RECYCLE BIN (put one back with: dirf worktree restore <id>)", [...applied.binned, ...applied.branches_binned], (item) => `  ${item.id}  ${item.path || `branch ${item.branch}`}`);
    section("ERRORS", applied.errors, (item) => `  ${item.path}: ${item.error}`);
  } else if (totals.remove.count || totals.shed.count || totals.orphans.removable || totals.branches.removable) {
    lines.push("", "Run again with --apply to carry out REMOVE, SHED and the removable ORPHANS. Add --only remove|shed|orphans|branches to run one step.");
  }
  return lines.join("\n");
}

const shortRef = (ref) => ref.replace(/^refs\/(remotes|heads)\//, "");

// The evidence that the commit of a worktree lives outside that worktree.
function proofText({ head, proof }) {
  if (proof.squash_merged_into) return `${head.slice(0, 7)} squash-merged into ${shortRef(proof.squash_merged_into)}`;
  return `${head.slice(0, 7)} ${proof.merged_into ? `merged into ${shortRef(proof.merged_into)}` : `on ${shortRef(proof.held_by[0])}`}`;
}

export function formatBinReport(receipts, { now = new Date() } = {}) {
  const inBin = receipts.filter((receipt) => receipt.status === "in_bin");
  const lines = [`DIRF worktree recycle bin: ${inBin.filter((receipt) => receipt.kind !== "branch").length} worktree(s), ${inBin.filter((receipt) => receipt.kind === "branch").length} branch(es)`];
  for (const receipt of inBin) {
    const age = Math.floor((now.getTime() - Date.parse(receipt.trashed_at)) / DAY);
    lines.push(`  ${receipt.id}  ${age}d  ${proofText(receipt)}${receipt.verified ? "" : "  CHECK FAILED"}  ${receipt.kind === "branch" ? `branch ${receipt.branch}` : `${receipt.path}${receipt.branch ? ` [${receipt.branch}]` : ""}`}`);
  }
  if (inBin.length) lines.push("", "Put one back: dirf worktree restore <id>", "Delete old ones for good: dirf worktree purge [--keep-days N] [--apply]");
  return lines.join("\n");
}

export function formatPurgeReport(result) {
  const lines = [result.applied ? "DIRF worktree recycle bin: purge applied" : "DIRF worktree recycle bin: purge dry run, nothing was changed", `Rule: delete binned worktrees and branches older than ${result.keep_days} day(s) while their work is held elsewhere`];
  const section = (title, items, render) => { if (items.length) lines.push("", title, ...items.map(render)); };
  section("PURGED", result.purged, (item) => `  ${item.id}  ${item.path}`);
  section("DUE (run again with --apply to delete)", result.due, (item) => `  ${item.id}  ${item.path}`);
  section("KEPT", result.blocked, (item) => `  ${item.id}  ${item.path}: ${item.reason}`);
  section("ERRORS", result.errors, (item) => `  ${item.path}: ${item.error}`);
  if (!result.purged.length && !result.due.length && !result.blocked.length) lines.push("", "Nothing in the recycle bin is old enough.");
  return lines.join("\n");
}
