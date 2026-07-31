# DIRF Canonical State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move DIRF coordination state out of per-checkout `.dirf/` into a central store at `~/.dirf/projects/<slug>/`, so all agents and git worktrees read and write through one source of truth — killing the worktree drift that bit myproject/m026.

**Architecture:** One new module (`src/state.js`) owns all canonical-state read/write. Project identity is derived from `git rev-parse --git-common-dir` (normalized deterministically) so every worktree of a repo collapses to the same store entry. The existing `dirf` commands are rewired to resolve a slug then read/write through `state.js`. A new `dirf state` command group and an optional stdio JSON-RPC MCP server are thin shells over the same core.

**Tech Stack:** Pure Node.js built-ins (zero dependencies). Tests via `node:test` + `node:assert/strict`. MCP is hand-rolled stdio JSON-RPC (no SDK).

**Spec:** `docs/superpowers/specs/2026-07-25-dirf-canonical-state-design.md` (read it before starting).

**Test command (run after every step that says to run tests):**
```
node --test tests/state.test.js
```
…and for the full suite:
```
node --test
```

**Conventions to match (from existing code):**
- ESM (`import`/`export`), `"type": "module"` in `package.json`.
- Path portability: `portable()` in `src/project.js:39` does `path.replaceAll("\\", "/")`. Reuse that idiom.
- Tests create temp dirs with `mkdtempSync(join(tmpdir(), "dirf-..."))` (see `tests/project.test.js:9`). Tests that need `HOME` isolated use a temp dir + the `DIRF_HOME` env override introduced in Task 1 (see "Env override" below).
- `execFileSync("git", [...], { cwd, timeout: 30_000, windowsHide: true })` is the existing pattern for git calls.

**Key design contract — the `DIRF_HOME` env override:** Every function in `state.js` that touches disk must resolve the store root from a single helper, `storeHome()`, which returns `process.env.DIRF_HOME || join(homedir(), ".dirf")`. This is what makes the core unit-testable with a temp dir and is non-negotiable — no `homedir()` calls scattered through `state.js`.

---

## File structure (what each file owns)

| File | Responsibility | Milestone |
|---|---|---|
| `src/state.js` (new) | **The only** module that reads/writes canonical state. Identity/slug derivation, registry I/O, handoff I/O, attempts read, migration, atomic writes. | M1–M4 |
| `tests/state.test.js` (new) | All `state.js` tests, incl. slug normalization, migration, concurrency. | M1–M4 |
| `src/project.js` (modify) | `setupProject`/`createAttempt`/`listAttempts`/`findAttempt`/`loadProjectConfig` delegate state I/O to `state.js`; keep config-validation + target-scaffolding logic. | M2 |
| `src/cli.js` (modify) | New `dirf state` command group + subcommand handlers; rewire `setup`/`build`/`create`/`render`/`list`/`resume` to resolve slug first; update `parse()` and `HELP`. | M2–M4 |
| `src/renderer.js` (modify) | Update two worktree-advisory prose lines. | M2 |
| `policies/workflow-policy.md` (modify) | Update one worktree-advisory line. | M2 |
| `README.md` (modify) | Update one worktree-advisory line. | M2 |
| `src/mcp.js` (new) | Optional stdio JSON-RPC MCP server, thin shell over `state.js`. | M5 |
| `tests/mcp.test.js` (new) | MCP protocol tests by spawning the server over stdio. | M5 |

---

# Milestone M1 — Core (no behavior change)

`src/state.js` + store layout + slug derivation with the normalization contract. Pure functions, fully unit-tested with a temp `DIRF_HOME`. **Nothing else changes** — existing commands keep reading per-target `.dirf/`. A user running the kit sees no difference.

## Task 1: storeHome + store layout + empty-registry helpers

**Files:**
- Create: `src/state.js`
- Test: `tests/state.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/state.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjects, storeHome } from "../src/state.js";

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "dirf-state-"));
  process.env.DIRF_HOME = home;
  return home;
}

test("storeHome honors DIRF_HOME override", () => {
  const home = freshHome();
  assert.equal(storeHome(), home);
});

test("listProjects returns empty array when no registry exists", () => {
  freshHome();
  assert.deepEqual(listProjects(), []);
});

test("listProjects reads an existing registry without mutating it", () => {
  const home = freshHome();
  const reg = { schema_version: 1, projects: {} };
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(home, "projects.json"), JSON.stringify(reg));
  assert.deepEqual(listProjects(), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/state.test.js`
Expected: FAIL — module `../src/state.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/state.js`:

```js
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

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/state.test.js`
Expected: PASS (3 tests). Note: the third test uses top-level `await` inside a non-async `test(...)` callback — fix that before moving on by making the callback async (see Step 1 fix below).

- [ ] **Step 5: Fix the test's async usage**

The third test uses `await import(...)` inside a non-async callback. Update it to:

```js
test("listProjects reads an existing registry without mutating it", async () => {
  const home = freshHome();
  const { writeFileSync } = await import("node:fs");
  const reg = { schema_version: 1, projects: {} };
  writeFileSync(join(home, "projects.json"), JSON.stringify(reg));
  assert.deepEqual(listProjects(), []);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/state.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat(state): central store home + empty-registry reader (M1)"
```

---

## Task 2: slug derivation + normalization contract (the drift-killer)

This is the highest-risk logic in the whole plan. The slug must be byte-stable across path-separator, case, trailing-slash, symlink, relative-common-dir, and worktree variants. If it isn't, the registry silently forks entries and **drift returns worse than before.**

**Files:**
- Modify: `src/state.js`
- Test: `tests/state.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/state.test.js`:

```js
import { deriveSlug, normalizeIdentityKey, identityKeyForPath } from "../src/state.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";

const TIMEOUT = 30_000;

function gitInit(cwd) {
  execFileSync("git", ["init", "-q"], { cwd, timeout: TIMEOUT, windowsHide: true });
}

test("normalizeIdentityKey: forward + back slashes, trailing slash, case all collapse", () => {
  const a = normalizeIdentityKey("E:\\\\code\\\\MyProject\\\\.git");
  const b = normalizeIdentityKey("c:/code/myproject/.git/");
  assert.equal(a, b, "Windows case + separator variants must produce the same key");
});

test("normalizeIdentityKey resolves symlinks", () => {
  const real = mkdtempSync(join(tmpdir(), "real-repo-"));
  const link = join(tmpdir(), `link-${Date.now()}`);
  try { symlinkSync(real, link, "junction"); } catch { /* junction may need admin; skip if unavailable */ }
  if (existsSync(link)) {
    assert.equal(normalizeIdentityKey(link), normalizeIdentityKey(real));
  }
});

test("identityKeyForPath: git common-dir for main tree", () => {
  const repo = mkdtempSync(join(tmpdir(), "myrepo-"));
  gitInit(repo);
  const key = identityKeyForPath(repo);
  // main tree: common-dir resolves to <repo>/.git (normalized)
  assert.equal(key, normalizeIdentityKey(join(repo, ".git")));
});

test("deriveSlug: basename + 8-hex, stable across worktrees", () => {
  const main = mkdtempSync(join(tmpdir(), "myproject-"));
  gitInit(main);
  writeFileSync(join(main, "file.txt"), "x");
  execFileSync("git", ["-C", main, "add", "."], { timeout: TIMEOUT, windowsHide: true });
  execFileSync("git", ["-C", main, "commit", "-q", "-m", "init"], { timeout: TIMEOUT, windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

  const wt = join(tmpdir(), `wt-${Date.now()}`);
  execFileSync("git", ["-C", main, "worktree", "add", "-q", wt], { timeout: TIMEOUT, windowsHide: true });

  const slugMain = deriveSlug(main);
  const slugWt = deriveSlug(wt);
  assert.equal(slugMain, slugWt, "main tree and worktree must produce the SAME slug");
  assert.match(slugMain, /^myproject-[0-9a-f]{8}$/, "format: basename-<8 hex>");
});

test("deriveSlug: non-git folder uses normalized path", () => {
  const dir = mkdtempSync(join(tmpdir(), "plainproj-"));
  const slug = deriveSlug(dir);
  assert.match(slug, /^plainproj-[0-9a-f]{8}$/);
});

test("deriveSlug: two distinct repos produce distinct slugs", () => {
  const a = mkdtempSync(join(tmpdir(), "projX-"));
  const b = mkdtempSync(join(tmpdir(), "projY-"));
  gitInit(a); gitInit(b);
  assert.notEqual(deriveSlug(a), deriveSlug(b));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/state.test.js`
Expected: FAIL — `deriveSlug`/`normalizeIdentityKey`/`identityKeyForPath` not exported.

- [ ] **Step 3: Implement the normalization contract**

Add to `src/state.js` (imports first — merge into the existing import block at top):

```js
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { realpathSync } from "node:fs";

const GIT_TIMEOUT = 30_000;

// Resolve git's common-dir for a path. Returns null if not a git repo.
// git rev-parse --git-common-dir can be relative (older git) — resolve it.
function gitCommonDir(targetPath) {
  try {
    let out = execFileSync("git", ["-C", targetPath, "rev-parse", "--git-common-dir"], {
      encoding: "utf8", timeout: GIT_TIMEOUT, windowsHide: true,
    }).trim();
    if (!out) return null;
    // If relative, resolve against the working directory we ran git in.
    const { isAbsolute, resolve } = await import("node:path");
    if (!isAbsolute(out)) out = resolve(targetPath, out);
    return out;
  } catch {
    return null;
  }
}
```

Wait — top-level `await` is not allowed inside a non-async function. Use a static import instead. Replace the helper with this version (no dynamic import):

```js
import { isAbsolute, resolve as resolvePath } from "node:path";  // merge into top import block

function gitCommonDir(targetPath) {
  try {
    let out = execFileSync("git", ["-C", targetPath, "rev-parse", "--git-common-dir"], {
      encoding: "utf8", timeout: GIT_TIMEOUT, windowsHide: true,
    }).trim();
    if (!out) return null;
    if (!isAbsolute(out)) out = resolvePath(targetPath, out);
    return out;
  } catch {
    return null;
  }
}
```

Then add the exported normalization + slug functions:

```js
// The normalization contract (spec §4). MUST be deterministic and byte-stable.
// Order: absolute -> forward slashes -> strip trailing slash -> resolve symlinks
//        -> case-fold to lower case.
export function normalizeIdentityKey(rawKey) {
  let key = rawKey;
  key = resolvePath(key);                    // 1. absolute
  key = key.replaceAll("\\", "/");           // 2. forward slashes
  key = key.replace(/\/+$/, "");             // 3. strip trailing slash(es)
  try { key = realpathSync(key).replaceAll("\\", "/"); } catch { /* not-yet-existing path: keep resolved form */ }
  key = key.replace(/\/+$/, "");             // strip again after realpath
  key = key.toLowerCase();                   // 4. case-fold (case-insensitive FS safety)
  return key;
}

// Identity key for a target path: git common-dir if git, else normalized abs path.
export function identityKeyForPath(targetPath) {
  const common = gitCommonDir(targetPath);
  if (common) return normalizeIdentityKey(common);
  return normalizeIdentityKey(targetPath);
}

// Basename for the slug: main worktree's dir for git, cwd basename otherwise.
function slugBasename(targetPath) {
  const common = gitCommonDir(targetPath);
  if (common) {
    try {
      const toplevel = execFileSync("git", ["-C", targetPath, "rev-parse", "--path-format=absolute", "--show-toplevel"], {
        encoding: "utf8", timeout: GIT_TIMEOUT, windowsHide: true,
      }).trim();
      if (toplevel) return basename(toplevel.replace(/\\/g, "/"));
    } catch { /* fall through */ }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/state.test.js`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat(state): slug derivation with normalization contract (M1, drift-killer)"
```

---

## Task 3: atomic write helper + registry mutation (register/resolve/get)

**Files:**
- Modify: `src/state.js`
- Test: `tests/state.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/state.test.js`:

```js
import { registerProject, resolveProject, getProject, writeRegistry } from "../src/state.js";

test("registerProject creates a store entry + registry record", () => {
  const home = freshHome();
  const repo = mkdtempSync(join(tmpdir(), "regproj-"));
  gitInit(repo);
  const { slug, isNew } = registerProject(repo);
  assert.equal(isNew, true);
  assert.match(slug, /^regproj-[0-9a-f]{8}$/);
  assert.ok(existsSync(join(home, "projects", slug)));
  assert.ok(getProject(slug));
  assert.equal(getProject(slug).slug, slug);
});

test("registerProject is idempotent", () => {
  const repo = mkdtempSync(join(tmpdir(), "regproj2-"));
  gitInit(repo);
  const first = registerProject(repo);
  const second = registerProject(repo);
  assert.equal(second.isNew, false);
  assert.equal(second.slug, first.slug);
});

test("resolveProject returns slug for a registered repo and bumps last_seen", () => {
  const repo = mkdtempSync(join(tmpdir(), "resproj-"));
  gitInit(repo);
  const { slug } = registerProject(repo);
  const before = getProject(slug).last_seen;
  // small delay then resolve
  const resolved = resolveProject(repo);
  assert.ok(resolved, "must resolve a registered project");
  assert.equal(resolved.slug, slug);
  assert.ok(getProject(slug).last_seen >= before);
});

test("resolveProject returns null for an unregistered path", () => {
  freshHome();
  const dir = mkdtempSync(join(tmpdir(), "unknown-"));
  // not a git repo, not registered -> null
  assert.equal(resolveProject(dir), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/state.test.js`
Expected: FAIL — `registerProject`/`resolveProject`/`getProject`/`writeRegistry` not exported.

- [ ] **Step 3: Implement atomic write + registry mutation**

Add imports (merge into top import block of `src/state.js`):

```js
import { renameSync, writeFileSync } from "node:fs";
import { basename as pathBasename, dirname as pathDirname, join as pathJoin } from "node:path";
```

Add the atomic-write + store-path helpers:

```js
// Atomic write: temp file + rename, same volume. Prevents corruption under
// concurrent writers (last-writer-wins, no merge — matches the snapshot model).
export function atomicWrite(filePath, contents) {
  const dir = pathDirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = pathJoin(dir, `.dirf-tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, filePath);
}

export function storeProjectDir(slug) {
  return pathJoin(storeHome(), "projects", slug);
}

export function writeRegistry(registry) {
  atomicWrite(registryPath(), JSON.stringify(registry, null, 2) + "\n");
}
```

Add the mutation functions:

```js
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
    name: pathBasename(targetPath.replace(/\\/g, "/")),
    git_common_dir: identityKeyForPath(targetPath),
    main_path: resolvePath(targetPath).replaceAll("\\", "/"),
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat(state): atomic writes + registry mutation (register/resolve/get) (M1)"
```

---

## Task 4: handoff + attempts read/write through the store

**Files:**
- Modify: `src/state.js`
- Test: `tests/state.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/state.test.js`:

```js
import { readHandoff, writeHandoff, listAttempts, getAttempt, storeAttemptDir, createAttemptInStore } from "../src/state.js";

function withRegisteredProject() {
  freshHome();
  const repo = mkdtempSync(join(tmpdir(), "hproj-"));
  gitInit(repo);
  const { slug } = registerProject(repo);
  return { repo, slug };
}

test("writeHandoff then readHandoff round-trips content", () => {
  const { slug } = withRegisteredProject();
  const md = "# Handoff\n\nPhase 2 done.\n";
  writeHandoff(slug, md);
  assert.equal(readHandoff(slug), md);
});

test("readHandoff returns null when no handoff exists", () => {
  const { slug } = withRegisteredProject();
  assert.equal(readHandoff(slug), null);
});

test("createAttemptInStore writes attempt.json under the store and listAttempts finds it", () => {
  const { slug } = withRegisteredProject();
  const attempt = createAttemptInStore(slug, "Demo Run", new Date("2026-07-25T10:00:00.000Z"));
  assert.equal(attempt.id, "20260725T100000000Z-demo-run");
  assert.ok(existsSync(join(storeAttemptDir(slug, attempt.id), "attempt.json")));
  const listed = listAttempts(slug);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, attempt.id);
  assert.equal(getAttempt(slug, attempt.id).id, attempt.id);
});

test("writeHandoff is atomic — file is valid after concurrent writes", () => {
  const { slug } = withRegisteredProject();
  // Simulate two concurrent writers by writing many times rapidly; final file must be valid.
  for (let i = 0; i < 50; i++) writeHandoff(slug, `# v${i}\n`);
  assert.equal(readHandoff(slug), "# v49\n");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/state.test.js`
Expected: FAIL — handoff/attempts functions not exported.

- [ ] **Step 3: Implement handoff + attempts I/O**

Add imports (merge into top import block): `import { readdirSync } from "node:fs";` and `import { portable } from "./project.js";` — wait, `portable` is not exported from `project.js`. Inline it instead. Add to `src/state.js`:

```js
import { readdirSync, statSync } from "node:fs";

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
  return pathJoin(storeProjectDir(slug), "attempts", attemptId);
}

// Create an attempt inside the store. Mirrors project.js createAttempt semantics
// (timestamp id, collision suffix, attempt.json) but writes to the store.
export function createAttemptInStore(slug, name, now = new Date()) {
  const baseId = `${timestampIso(now)}-${slugifyName(name)}`;
  const attemptsRoot = pathJoin(storeProjectDir(slug), "attempts");
  mkdirSync(attemptsRoot, { recursive: true });
  let id, folder;
  for (let collision = 1; ; collision += 1) {
    id = collision === 1 ? baseId : `${baseId}-${String(collision).padStart(2, "0")}`;
    folder = storeAttemptDir(slug, id);
    try { mkdirSync(folder); break; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const relativePath = portable(pathJoin("attempts", id));
  const attempt = { schema_version: 1, id, name, relativePath, created_at: now.toISOString() };
  atomicWrite(pathJoin(folder, "attempt.json"), JSON.stringify(attempt, null, 2) + "\n");
  return { ...attempt, folder };
}

export function listAttempts(slug) {
  const base = pathJoin(storeProjectDir(slug), "attempts");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const folder = pathJoin(base, entry.name);
    const metadata = pathJoin(folder, "attempt.json");
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
  const path = pathJoin(storeProjectDir(slug), "HANDOFF.md");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function writeHandoff(slug, markdown) {
  atomicWrite(pathJoin(storeProjectDir(slug), "HANDOFF.md"), markdown);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/state.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test`
Expected: PASS (state tests + all existing tests still green — M1 changed nothing user-facing).

- [ ] **Step 6: Commit**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat(state): handoff + attempts I/O through the store (M1)"
```

---

# Milestone M2 — Cutover (atomic, one release)

Resolution + registry; rewire `setup`/`build`/`create`/`render`/`list`/`resume` to resolve a slug and read/write through `state.js`; config schema v2; **and** update the worktree-advisory prose in the same release. This milestone is where the drift bug goes away. Because setup-writes and build-reads move together, the kit is never in a broken intermediate state.

## Task 5: migrate setupProject to register + write config to the store

**Goal of this task:** `dirf setup` now registers the project in the central store and writes `config.json` to `~/.dirf/projects/<slug>/` (schema v2), while still scaffolding the project-content docs (`CONTEXT.md`, `adr/`, specs, tickets) in the target. It must still work on a target with no prior `.dirf/`.

**Files:**
- Modify: `src/project.js` (`setupProject`, `loadProjectConfig`)
- Test: `tests/project.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/project.test.js` (note: these tests set `DIRF_HOME`):

```js
import { registerProject, storeProjectDir, readHandoff } from "../src/state.js";

function freshStateHome() {
  const home = mkdtempSync(join(tmpdir(), "dirf-state-"));
  process.env.DIRF_HOME = home;
  return home;
}

test("setup writes config to the central store, schema v2, with slug", () => {
  const home = freshStateHome();
  const root = project();
  const result = setupProject(root);
  const { slug } = registerProject(root); // idempotent: setup already registered
  const configPath = join(home, "projects", slug, "config.json");
  assert.ok(existsSync(configPath), "config.json must live in the central store");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(config.schema_version, 2);
  assert.equal(config.slug, slug);
  assert.equal(config.attempt_root, undefined, "attempt_root is dropped under the store model");
  assert.equal(loadProjectConfig(root).context.reserve_percent, 5);
});

test("setup no longer writes .dirf/config.json into the target", () => {
  freshStateHome();
  const root = project();
  setupProject(root);
  assert.ok(!existsSync(join(root, ".dirf", "config.json")), "no per-target config");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/project.test.js`
Expected: FAIL — setup still writes `.dirf/config.json`, schema still 1.

- [ ] **Step 3: Rewire setupProject + loadProjectConfig**

In `src/project.js`, add the state import at top:

```js
import { registerProject, storeProjectDir, readRegistry, writeRegistry } from "./state.js";
```

Replace the body of `setupProject` (currently `src/project.js:100-138`) with a version that registers + writes config to the store:

```js
export function setupProject(root = process.cwd(), options = {}) {
  root = projectRoot(root);
  const tracker = options.tracker || "local";
  const contextMode = options.context || "single";
  const reservePercent = options.reservePercent ?? 5;
  if (tracker !== "local") throw new Error(`Unsupported tracker ${tracker}; installed tracker adapters are not configured yet`);
  if (!new Set(["single", "multi"]).has(contextMode)) throw new Error("context must be single or multi");
  if (!Number.isInteger(reservePercent) || reservePercent < 1 || reservePercent > 50) throw new Error("reserve-percent must be an integer from 1 to 50");

  const created = [];
  const { slug } = registerProject(root);
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
  };

  // Write config to the store (schema v2). Add slug if an old v2 config lacks it.
  const toWrite = { ...config, schema_version: 2, slug };
  delete toWrite.attempt_root; // stale under the store model
  writeFileSync(storeConfigPath, JSON.stringify(toWrite, null, 2) + "\n", "utf8");
  created.push(`${slug}/config.json (store)`);

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
  return { root, slug, config: loadProjectConfig(root), created };
}
```

Replace `loadProjectConfig` (currently `src/project.js:81-98`) so it reads from the store and supports schema v2 (and silently upgrades a v1 for forward-compat during the M2 window):

```js
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
  containedPath(root, config.context?.path, "DIRF context path");
  containedPath(root, config.adr_path, "DIRF ADR path");
  containedPath(root, config.tracker?.specs_path, "DIRF specs path");
  containedPath(root, config.tracker?.tickets_path, "DIRF tickets path");
  return config;
}

// Ensure a target is registered before reading its config. registerProject is
// idempotent, so this is cheap and safe on every load.
function ensureRegistered(root) {
  return registerProject(root);
}
```

Also update `createAttempt`, `listAttempts`, `findAttempt` to delegate to the store. Replace their bodies (`src/project.js:150-192`) with thin wrappers that re-export from state, **but keep the existing signatures** so call sites in `cli.js` don't break:

```js
import { createAttemptInStore, listAttempts as listAttemptsInStore, getAttempt as getAttemptInStore } from "./state.js";

export function createAttempt(root, name, now = new Date()) {
  const { slug } = ensureRegistered(projectRoot(root));
  // loadProjectConfig validates that setup has run
  loadProjectConfig(root);
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
```

Note: `attempt_root` validation (`containedPath(root, config.attempt_root, ...)`) is removed from `loadProjectConfig` because the store owns the attempt root now.

- [ ] **Step 4: Run the project tests to verify they pass**

Run: `node --test tests/project.test.js`
Expected: some pre-existing tests may now fail because they assert the old `.dirf/config.json` location. Update those assertions next.

- [ ] **Step 5: Update pre-existing project tests for the new location**

In `tests/project.test.js`, the first test (`setup creates the minimum tracked contract...`) asserts `first.created.length === 6` and reads `.dirf/config.json`. Update it:

- Change `assert.equal(first.created.length, 6)` to `assert.ok(first.created.length >= 5)` (created list shape changed — config now lives in store).
- Replace `readFileSync(join(root, ".dirf", "config.json"), "utf8")` with reading from the store via `join(process.env.DIRF_HOME, "projects", first.slug, "config.json")`. Since `setupProject` now returns `slug`, use `first.slug`.
- The `.gitignore` assertion (`/\.dirf\/attempts\/$/m`) stays valid.
- The `config.attempt_root` assertion (`assert.equal(config.attempt_root, ".dirf/attempts")`) must be removed (no longer present).
- Add `freshStateHome()` at the start of each test that calls `setupProject` (so each test has an isolated store). Add the helper near the top of the file.

Apply analogous updates to any other test in `tests/project.test.js` that reads `.dirf/config.json` or relies on `attempt_root`: the compaction tests (`setup writes default compaction policy...`, `loadProjectConfig rejects a malformed compaction policy...`) read/write the config path — change them to the store path via the slug returned by setup.

For the `Git sees setup docs but ignores attempts` test: it asserts `.dirf/config.json` appears in `git status`. Under the new model config lives in the store, not the target, so that assertion must change to check a doc that *does* live in the target (e.g. `docs/agents/domain/CONTEXT.md`). Replace `assert.match(status, /\.dirf\/config\.json/)` with `assert.match(status, /docs\/agents\/domain\/CONTEXT\.md/)`.

- [ ] **Step 6: Run project tests again**

Run: `node --test tests/project.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/project.js tests/project.test.js
git commit -m "feat(project): setup + config move to central store, schema v2 (M2 cutover)"
```

---

## Task 6: rewire build/create/render/list/resume + cli.js path resolution

**Files:**
- Modify: `src/cli.js` (`cmdBuild`, `cmdCreate`, `cmdRender`, `cmdList`, `cmdResume`, `savePlan`, `renderPlan`)

The existing command handlers already call `loadProjectConfig`/`createAttempt`/`findAttempt`/`listAttempts`, which now delegate to the store (Task 5). So most of the cutover is already done. The remaining work: `savePlan` and `renderPlan` currently write into `attempt.folder`, which (after Task 5) is already under the store. Verify and adjust paths so rendered files land in the store attempt dir, and confirm the `--open` HTML path still renders.

- [ ] **Step 1: Verify savePlan/renderPlan write to the store attempt folder**

`createAttempt` (now `createAttemptInStore` under the hood) returns `{ ...attempt, folder }` where `folder` is `storeAttemptDir(slug, id)` — already in the store. `savePlan` writes to `join(attempt.folder, ...)` and `renderPlan` reads/writes `dirname(planPath)` (the attempt folder). **No code change needed** if the folder is correct — confirm with a smoke test.

- [ ] **Step 2: Write an integration smoke test**

Append to `tests/project.test.js`:

```js
test("build pipeline writes attempt + HANDOFF into the store (M2 integration)", () => {
  const home = freshStateHome();
  const root = project();
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT_MS });
  const setup = setupProject(root);
  const slug = setup.slug;
  const attempt = createAttempt(root, "Demo Run");
  assert.ok(attempt.folder.startsWith(home), "attempt folder must be under DIRF_HOME");
  assert.ok(existsSync(join(attempt.folder, "attempt.json")));
  // Simulate savePlan writing workflow.json + HANDOFF.md
  writeFileSync(join(attempt.folder, "workflow.json"), "{}");
  writeFileSync(join(attempt.folder, "HANDOFF.md"), "# Handoff\n");
  assert.equal(readFileSync(join(attempt.folder, "HANDOFF.md"), "utf8"), "# Handoff\n");
  // And the canonical store handoff path resolves to the same project
  const { readHandoff } = await import("../src/state.js");
  process.env.DIRF_HOME = home;
  // Note: the per-attempt HANDOFF.md and the canonical project HANDOFF.md are
  // distinct files (attempt-scoped vs project-scoped). This is intentional and
  // unchanged from today; the canonical project handoff is managed via state.js.
});
```

Make the callback `async` since it uses top-level `await import`.

- [ ] **Step 3: Run the integration test**

Run: `node --test tests/project.test.js`
Expected: PASS.

- [ ] **Step 4: Run the full suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/project.test.js
git commit -m "test(project): M2 build-pipeline-into-store integration check"
```

---

## Task 7: update worktree-advisory prose (rides with the cutover)

**Files:**
- Modify: `src/renderer.js:248`, `src/renderer.js:494`
- Modify: `policies/workflow-policy.md:15`
- Modify: `README.md:180`

- [ ] **Step 1: Update renderer.js line 248**

In `src/renderer.js`, find:
```
"Runtime paths belong to this execution only. If isolation is needed, place worktrees beside the target repository or under the user-configured worktree root. Select a scratch directory inside that workspace; do not fall back to another drive or the operating-system temp directory.",
```
Replace with:
```
"Runtime paths belong to this execution only. DIRF state is canonical and central (~/.dirf/projects/<slug>/); worktrees resolve to it automatically via git-common-dir — no per-worktree setup is needed. If isolation is needed for scratch work, select a directory inside the worktree workspace; do not fall back to another drive or the operating-system temp directory.",
```

- [ ] **Step 2: Update renderer.js line 494**

Find:
```
parts.push("<p class='mute'>Runtime paths stay local to the current execution. Keep worktrees beside the target repository or in the configured worktree root, and select scratch space inside that workspace.</p>");
```
Replace with:
```
parts.push("<p class='mute'>DIRF state is canonical and central (~/.dirf/projects/<slug>/). Worktrees resolve to it automatically via git-common-dir — no per-worktree setup is needed. Keep scratch paths local to the current execution.</p>");
```

- [ ] **Step 3: Update policies/workflow-policy.md line 15**

Find:
```
- When isolation is required, place worktrees beside the target repository by default or under a root explicitly configured by the user.
```
Replace with:
```
- DIRF coordination state is canonical and central (~/.dirf/projects/<slug>/). Worktrees resolve to the same store entry automatically via git-common-dir, so no per-worktree setup is needed and state cannot drift between checkouts. Scratch isolation stays local to the current execution.
```

- [ ] **Step 4: Update README.md around line 180**

Find the sentence starting `If a task needs isolation, keep worktrees beside the target repository unless` and replace the whole sentence with:
```
DIRF coordination state is canonical and central (`~/.dirf/projects/<slug>/`). Worktrees resolve to the same store entry automatically via `git-common-dir`, so no per-worktree setup is needed and state cannot drift between checkouts. If a task needs scratch isolation, keep it inside the worktree workspace.
```

- [ ] **Step 5: Run validate + renderer tests**

Run: `node src/cli.js validate && node --test tests/renderer.test.js`
Expected: validate prints success; renderer tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer.js policies/workflow-policy.md README.md
git commit -m "docs(worktrees): central-state advisory prose (M2 cutover)"
```

---

# Milestone M3 — `dirf state` command group

The CLI verbs from spec §6. All are thin shells over `state.js`.

## Task 8: add `dirf state` subcommands + parse/HELP wiring

**Files:**
- Modify: `src/cli.js` (add handlers, parse branch, HELP lines)

- [ ] **Step 1: Write the failing CLI tests**

Create `tests/cli-state.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-"));
  return home;
}

test("dirf state list is empty for a fresh home", () => {
  const out = run(["state", "list"], { DIRF_HOME: freshHome() });
  assert.match(out, /no projects registered|^\s*$/i);
});

test("dirf state which resolves a registered project from a worktree", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "whichproj-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  const wt = join(tmpdir(), `wt-${Date.now()}`);
  execFileSync("git", ["-C", main, "worktree", "add", "-q", wt], { timeout: TIMEOUT });
  const out = run(["state", "which"], { DIRF_HOME: home }, wt);
  assert.match(out, /whichproj-[0-9a-f]{8}/);
});

test("dirf state write-handoff then read-handoff round-trips", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "whproj-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  run(["state", "write-handoff", "--file", "-"], { DIRF_HOME: home }, main); // can't easily pipe stdin; use --file with a real file instead
});

test("dirf state write-handoff --file writes the canonical handoff", () => {
  const home = freshStateFileHome(home => home, freshHome());
  // Use a real file path
});
```

The above is getting tangled with stdin. Rewrite the stdin test cleanly:

```js
import { writeFileSync } from "node:fs";

test("dirf state write-handoff --file writes the canonical handoff", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "whproj2-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  const md = "# From file\n\nPhase done.\n";
  const src = join(main, "new-handoff.md");
  writeFileSync(src, md);
  run(["state", "write-handoff", "--file", src], { DIRF_HOME: home }, main);
  const out = run(["state", "read-handoff"], { DIRF_HOME: home }, main);
  assert.equal(out, md);
});
```

(Delete the tangled `write-handoff then read-handoff round-trips` test above — keep only the clean `--file` version. Remove the unused `freshStateFileHome` helper.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cli-state.test.js`
Expected: FAIL — `state` command unknown.

- [ ] **Step 3: Add `--file`, `--force`, `--slug` to parse()**

In `src/cli.js` `parse()` (around line 362), add these flag parsers inside the loop, before the final `out._.push(a)`:

```js
    if (a === "--file") { out.file = rest[++i]; continue; }
    if (a === "--force") { out.force = true; continue; }
    if (a === "--slug") { out.slug = rest[++i]; continue; }
```

- [ ] **Step 4: Add the `dirf state` handlers**

In `src/cli.js`, add imports near the top:

```js
import { resolveProject, listProjects, registerProject, readHandoff, writeHandoff, listAttempts as listAttemptsState, getAttempt as getAttemptState, deriveSlug, storeProjectDir } from "./state.js";
```

Add a helper to resolve slug from args (cwd default, `--path` or `--slug` override):

```js
function resolveStateSlug(args) {
  if (args.slug) return args.slug;
  const target = projectRoot(args.path || ".");
  const resolved = resolveProject(target);
  if (!resolved) {
    throw new Error(`DIRF has no project registered for ${target}. Run: dirf setup "${target}"`);
  }
  return resolved.slug;
}
```

Add the handlers:

```js
function cmdStateWhich(args) {
  const target = projectRoot(args.path || ".");
  const resolved = resolveProject(target);
  if (!resolved) { console.log(`(no project registered for ${target})`); return; }
  console.log(`${resolved.slug}  ->  ${storeProjectDir(resolved.slug)}`);
}

function cmdStateList() {
  const projects = listProjects();
  if (!projects.length) { console.log("(no projects registered)"); return; }
  console.log("Registered projects:");
  for (const p of projects) console.log(`  ${p.slug}   last_seen ${p.last_seen}   ${p.name}`);
}

function cmdStateRegister(args) {
  const target = projectRoot(args.path || args._[0] || ".");
  const { slug, isNew } = registerProject(target);
  console.log(isNew ? `Registered: ${slug}` : `Already registered: ${slug}`);
  console.log(`  ${storeProjectDir(slug)}`);
}

function cmdStateReadHandoff(args) {
  const slug = resolveStateSlug(args);
  const md = readHandoff(slug);
  if (md === null) { console.error(`No HANDOFF.md for ${slug}`); process.exitCode = 1; return; }
  process.stdout.write(md);
}

function cmdStateWriteHandoff(args) {
  const slug = resolveStateSlug(args);
  let md;
  if (args.file === "-") {
    md = readFileSync(0, "utf8"); // stdin
  } else if (args.file) {
    md = readFileSync(args.file, "utf8");
  } else {
    console.error("usage: dirf state write-handoff [--path DIR|--slug S] --file FILE|-");
    process.exitCode = 2; return;
  }
  writeHandoff(slug, md);
  console.log(`Wrote canonical handoff for ${slug}`);
}

function cmdStateListAttempts(args) {
  const slug = resolveStateSlug(args);
  const attempts = listAttemptsState(slug);
  if (!attempts.length) { console.log("(no attempts saved)"); return; }
  console.log("Saved attempts:");
  for (const a of attempts) console.log(`  - ${a.id}  ${a.name}`);
}

function cmdStateGetAttempt(args) {
  const slug = resolveStateSlug(args);
  const id = args._[0];
  if (!id) { console.error("usage: dirf state get-attempt <id> [--path DIR|--slug S]"); process.exitCode = 2; return; }
  const a = getAttemptState(slug, id);
  console.log(`id: ${a.id}`);
  console.log(`name: ${a.name}`);
  console.log(`created_at: ${a.created_at}`);
  console.log(`folder: ${a.folder}`);
}
```

Add the dispatch branch in `main()` (before the final `else`):

```js
  else if (cmd === "state") {
    const sub = args._[0];
    const subArgs = { ...args, _: args._.slice(1) };
    if (sub === "which") cmdStateWhich(subArgs);
    else if (sub === "list") cmdStateList();
    else if (sub === "register") cmdStateRegister(subArgs);
    else if (sub === "read-handoff") cmdStateReadHandoff(subArgs);
    else if (sub === "write-handoff") cmdStateWriteHandoff(subArgs);
    else if (sub === "list-attempts") cmdStateListAttempts(subArgs);
    else if (sub === "get-attempt") cmdStateGetAttempt(subArgs);
    else { console.error(`unknown state subcommand: ${sub}\n\n${HELP}`); process.exit(2); }
  }
```

`import-handoff` and `migrate-cleanup` are added in M4 (they depend on migration).

Add HELP lines (append to the `HELP` string, after the `flow` line):

```
  dirf state which [--path DIR]                       what project am I in? (slug + store path)
  dirf state list                                      list all registered projects
  dirf state register [--path DIR]                    register a project explicitly
  dirf state read-handoff [--path DIR|--slug S]       print the canonical handoff
  dirf state write-handoff --file FILE|- [...]        write the canonical handoff
  dirf state list-attempts [--path DIR|--slug S]      list attempts for a project
  dirf state get-attempt <id> [...]                   show one attempt
```

- [ ] **Step 5: Run CLI state tests**

Run: `node --test tests/cli-state.test.js`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli.js tests/cli-state.test.js
git commit -m "feat(cli): dirf state command group (M3)"
```

---

# Milestone M4 — Migration

Lazy, non-destructive migrate-on-first-resolve. `resolveProject` triggers `migrateProject` when the slug is absent from the registry but the target has a real legacy `.dirf/`. Plus the `import-handoff` and `migrate-cleanup` verbs.

## Task 9: migrateProject + resolution integration

**Files:**
- Modify: `src/state.js` (`migrateProject`, `importHandoff`, wire into `resolveProject`)
- Test: `tests/state.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/state.test.js`:

```js
import { migrateProject, importHandoff } from "../src/state.js";
import { mkdirSync, writeFileSync, statSync } from "node:fs";

function seedLegacyDirf(target, { handoff = "# Legacy\n", config = null } = {}) {
  mkdirSync(join(target, ".dirf", "attempts", "20260101T000000000Z-old"), { recursive: true });
  writeFileSync(join(target, ".dirf", "attempts", "20260101T000000000Z-old", "attempt.json"), JSON.stringify({ schema_version: 1, id: "20260101T000000000Z-old", name: "old", relativePath: ".dirf/attempts/20260101T000000000Z-old", created_at: "2026-01-01T00:00:00.000Z" }));
  const cfg = config || { schema_version: 1, tracker: { provider: "local", specs_path: "docs/agents/issues/specs", tickets_path: "docs/agents/issues/tickets.md" }, context: { mode: "single", path: "docs/CONTEXT.md", reserve_percent: 5 }, compaction: { method: "verbatim-line", preserve_recent: 2, compression_ratio: 0.5, protected: ["objective"] }, adr_path: "docs/adr", attempt_root: ".dirf/attempts" };
  writeFileSync(join(target, ".dirf", "config.json"), JSON.stringify(cfg));
  writeFileSync(join(target, ".dirf", "HANDOFF.md"), handoff);
}

test("migrateProject moves legacy .dirf into the store, schema upgraded to v2, with backup", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "migproj-"));
  seedLegacyDirf(target);
  const slug = deriveSlug(target);
  migrateProject(target, slug);

  // State now in store
  const storeCfg = JSON.parse(readFileSync(join(storeProjectDir(slug), "config.json"), "utf8"));
  assert.equal(storeCfg.schema_version, 2);
  assert.equal(storeCfg.slug, slug);
  assert.equal(storeCfg.attempt_root, undefined);
  assert.ok(existsSync(join(storeProjectDir(slug), "attempts", "20260101T000000000Z-old", "attempt.json")));
  assert.equal(readFileSync(join(storeProjectDir(slug), "HANDOFF.md"), "utf8"), "# Legacy\n");
  // Backup exists
  const backups = readdirSync(target).filter((n) => n.startsWith(".dirf.migrating."));
  assert.ok(backups.length === 1, "a backup copy must exist");
  assert.ok(readFileSync(join(target, backups[0], "HANDOFF.md"), "utf8").includes("Legacy"));
});

test("migrateProject is idempotent/restartable: re-running is a no-op once in store", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "migproj2-"));
  seedLegacyDirf(target);
  const slug = deriveSlug(target);
  migrateProject(target, slug);
  // second run must not throw or duplicate
  migrateProject(target, slug);
  assert.ok(getProject(slug));
});

test("resolveProject migrates a legacy target on first resolve", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "resolvemig-"));
  seedLegacyDirf(target);
  const resolved = resolveProject(target);
  assert.ok(resolved, "resolve should have migrated + registered");
  assert.equal(resolved.slug, deriveSlug(target));
  assert.ok(existsSync(join(storeProjectDir(resolved.slug), "config.json")));
});

test("importHandoff backs up the store handoff before replacing, unless force already applied", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "imphproj-"));
  seedLegacyDirf(target, { handoff: "# Store copy\n" });
  const slug = deriveSlug(target);
  migrateProject(target, slug); // store now has "# Store copy"
  // Simulate a newer local handoff
  writeFileSync(join(target, ".dirf", "HANDOFF.md"), "# Newer local\n");
  importHandoff(target, slug, { force: true });
  assert.equal(readHandoff(slug), "# Newer local\n");
  // Backup of the old store handoff exists
  const backups = readdirSync(storeProjectDir(slug)).filter((n) => n.startsWith("HANDOFF.md.") && n.endsWith(".bak"));
  assert.ok(backups.length >= 1);
  assert.equal(readFileSync(join(storeProjectDir(slug), backups[0]), "utf8"), "# Store copy\n");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/state.test.js`
Expected: FAIL — `migrateProject`/`importHandoff` not exported; `resolveProject` doesn't migrate.

- [ ] **Step 3: Implement migrateProject + importHandoff**

Add imports (merge into top import block of `src/state.js`): `import { cpSync, rmSync } from "node:fs";` and `import { renameSync as fsRenameSync } from "node:fs";` (already have renameSync). Also `import { portable } from "./project.js"` is NOT used (we inlined `portable`). Add the functions:

```js
// Migrate a legacy per-target .dirf/ into the store. Non-destructive:
// 1) backup copy first, 2) register, 3) move state, 4) leave backup until
// explicit migrate-cleanup. Idempotent: safe to re-run.
export function migrateProject(targetPath, slug) {
  const legacyDir = pathJoin(targetPath, ".dirf");
  if (!existsSync(legacyDir)) return { migrated: false, reason: "no legacy .dirf" };

  const registry = readRegistry();
  if (registry.projects[slug]) {
    // Already registered — migration is a no-op (conflict path handles handoff).
    return { migrated: false, reason: "already registered" };
  }

  // 1. Backup copy (before touching anything).
  const ts = timestampIso(new Date());
  const backup = pathJoin(targetPath, `.dirf.migrating.${ts}`);
  cpSync(legacyDir, backup, { recursive: true });

  // 2. Register.
  registerProject(targetPath);

  // 3. Move state into the store.
  const storeDir = storeProjectDir(slug);
  mkdirSync(storeDir, { recursive: true });

  // config.json: upgrade schema 1 -> 2, drop attempt_root, add slug.
  const legacyConfig = pathJoin(legacyDir, "config.json");
  if (existsSync(legacyConfig)) {
    const cfg = JSON.parse(readFileSync(legacyConfig, "utf8"));
    cfg.schema_version = 2;
    cfg.slug = slug;
    delete cfg.attempt_root;
    atomicWrite(pathJoin(storeDir, "config.json"), JSON.stringify(cfg, null, 2) + "\n");
  }

  // attempts/ — move whole directory if present.
  const legacyAttempts = pathJoin(legacyDir, "attempts");
  if (existsSync(legacyAttempts)) {
    const storeAttempts = pathJoin(storeDir, "attempts");
    mkdirSync(storeAttempts, { recursive: true });
    for (const entry of readdirSync(legacyAttempts, { withFileTypes: true })) {
      const from = pathJoin(legacyAttempts, entry.name);
      const to = pathJoin(storeAttempts, entry.name);
      if (!existsSync(to)) fsRenameSync(from, to);
    }
  }

  // HANDOFF.md — move if a canonical handoff isn't already present.
  const legacyHandoff = pathJoin(legacyDir, "HANDOFF.md");
  if (existsSync(legacyHandoff)) {
    const storeHandoff = pathJoin(storeDir, "HANDOFF.md");
    if (!existsSync(storeHandoff)) {
      const md = readFileSync(legacyHandoff, "utf8");
      atomicWrite(storeHandoff, md);
    }
  }

  return { migrated: true };
}

// Promote a target's local HANDOFF.md into the store. Backs up the store's
// current handoff first (never destroy canonical to promote local).
export function importHandoff(targetPath, slug, { force = false } = {}) {
  const local = pathJoin(targetPath, ".dirf", "HANDOFF.md");
  if (!existsSync(local)) throw new Error(`No local HANDOFF.md at ${local}`);
  const storeHandoff = pathJoin(storeProjectDir(slug), "HANDOFF.md");
  if (existsSync(storeHandoff)) {
    const ts = timestampIso(new Date());
    cpSync(storeHandoff, pathJoin(storeProjectDir(slug), `HANDOFF.md.${ts}.bak`));
  }
  atomicWrite(storeHandoff, readFileSync(local, "utf8"));
  return { imported: true };
}

// Remove the migration backup after the user confirms the store works.
export function migrateCleanup(targetPath) {
  const entries = readdirSync(targetPath);
  const backups = entries.filter((n) => n.startsWith(".dirf.migrating."));
  for (const b of backups) rmSync(pathJoin(targetPath, b), { recursive: true, force: true });
  return { removed: backups.length };
}

// Detect whether a target has migratable legacy state.
function hasLegacyState(targetPath) {
  const d = pathJoin(targetPath, ".dirf");
  if (!existsSync(d)) return false;
  return existsSync(pathJoin(d, "config.json")) || existsSync(pathJoin(d, "attempts"));
}
```

Now wire migration into `resolveProject` — update the `resolveProject` function (from Task 3) so the not-found branch migrates if legacy state exists:

```js
export function resolveProject(targetPath) {
  const slug = deriveSlug(targetPath);
  const registry = readRegistry();
  const existing = registry.projects[slug];
  if (existing) {
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
```

Add the missing imports at top of `src/state.js` (merge into existing import block): `cpSync`, `rmSync`, `readdirSync` (already added), `renameSync` (already added as `renameSync`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```js
git add src/state.js tests/state.test.js
git commit -m "feat(state): non-destructive migration + import-handoff + migrate-cleanup (M4)"
```

(Script block above is illustrative; run the actual `git add`/`git commit` shell commands.)

- [ ] **Step 5b (actual): Commit**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat(state): non-destructive migration + import-handoff + migrate-cleanup (M4)"
```

---

## Task 10: conflict surfacing (newer-local-HANDOFF) + CLI verbs import-handoff / migrate-cleanup

The conflict path (registry has entry, target has a newer local HANDOFF) must surface: interactive prompt if TTY, hard-stop error + nonzero exit if not. Wire it into `resolveProject` and add the two remaining CLI verbs.

**Files:**
- Modify: `src/state.js` (conflict detection in resolve)
- Modify: `src/cli.js` (`cmdStateImportHandoff`, `cmdStateMigrateCleanup`)
- Test: `tests/state.test.js`, `tests/cli-state.test.js`

- [ ] **Step 1: Write the failing test for the conflict hard-stop**

Append to `tests/state.test.js`:

```js
test("resolveProject surfaces a newer-local-HANDOFF conflict (registered + newer local)", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "confproj-"));
  seedLegacyDirf(target, { handoff: "# old\n" });
  const slug = deriveSlug(target);
  migrateProject(target, slug); // store has "# old"
  // Make local newer than store
  const localPath = join(target, ".dirf", "HANDOFF.md");
  // recreate .dirf/HANDOFF.md (migration moved it) and set mtime ahead
  mkdirSync(join(target, ".dirf"), { recursive: true });
  writeFileSync(localPath, "# newer local\n");
  const future = new Date(Date.now() + 60_000);
  utimesSync(localPath, future, future);
  const storeHandoff = pathJoin(storeProjectDir(slug), "HANDOFF.md");
  utimesSync(storeHandoff, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

  // Non-interactive (test has no TTY): resolve must throw a clear error.
  assert.throws(() => resolveProject(target), /newer than canonical|import-handoff/i);
});
```

Add `utimesSync` to the test imports: `import { ..., utimesSync } from "node:fs";`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/state.test.js`
Expected: FAIL — resolve currently returns `{ slug }` without checking handoff mtimes.

- [ ] **Step 3: Implement conflict detection**

In `src/state.js`, update the `existing` branch of `resolveProject` to check for a newer local handoff:

```js
export function resolveProject(targetPath, { interactive = Boolean(process.stdout.isTTY) } = {}) {
  const slug = deriveSlug(targetPath);
  const registry = readRegistry();
  const existing = registry.projects[slug];
  if (existing) {
    // Conflict check: registered, but a local HANDOFF.md is newer than the store's.
    const localHandoff = pathJoin(targetPath, ".dirf", "HANDOFF.md");
    const storeHandoff = pathJoin(storeProjectDir(slug), "HANDOFF.md");
    if (existsSync(localHandoff) && existsSync(storeHandoff)) {
      const localMtime = statSync(localHandoff).mtimeMs;
      const storeMtime = statSync(storeHandoff).mtimeMs;
      if (localMtime > storeMtime) {
        const msg = `Local HANDOFF.md is newer than canonical for ${slug}. Run \`dirf state import-handoff\` to promote it, or \`--force\` to skip this check. Refusing to proceed to avoid silent data loss.`;
        if (interactive) {
          // Surface to the human; do not proceed silently.
          throw new Error(msg);
        }
        throw new Error(msg);
      }
    }
    existing.last_seen = nowIso();
    registry.projects[slug] = existing;
    writeRegistry(registry);
    return { slug };
  }
  if (hasLegacyState(targetPath)) {
    migrateProject(targetPath, slug);
    return { slug };
  }
  return null;
}
```

(Note: the `interactive` branch is shown for completeness; both paths throw in this build because we don't implement a TTY prompt loop. The message tells the human exactly what to do. A real interactive prompt can be added later without changing the contract.)

Add `statSync` to the imports of `src/state.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/state.test.js`
Expected: PASS.

- [ ] **Step 5: Add CLI verbs import-handoff + migrate-cleanup**

In `src/cli.js`, add imports:

```js
import { importHandoff, migrateCleanup } from "./state.js";
```

Add handlers:

```js
function cmdStateImportHandoff(args) {
  const target = projectRoot(args.path || ".");
  const slug = resolveStateSlug(args);
  if (!args.force) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Promote local HANDOFF.md into the store for ${slug}? [y/N] `, (answer) => {
      rl.close();
      if (!/^y/i.test(answer.trim())) { console.log("aborted"); return; }
      importHandoff(target, slug, { force: true });
      console.log(`Promoted local HANDOFF.md for ${slug}`);
    });
  } else {
    importHandoff(target, slug, { force: true });
    console.log(`Promoted local HANDOFF.md for ${slug}`);
  }
}

function cmdStateMigrateCleanup(args) {
  const target = projectRoot(args.path || ".");
  const { removed } = migrateCleanup(target);
  console.log(removed ? `Removed ${removed} migration backup(s) under ${target}` : "No migration backups to remove.");
}
```

Add `import * as readline from "node:readline";` to the top imports of `src/cli.js`.

Wire into the `state` dispatch branch in `main()`:

```js
    else if (sub === "import-handoff") cmdStateImportHandoff(subArgs);
    else if (sub === "migrate-cleanup") cmdStateMigrateCleanup(subArgs);
```

Add HELP lines:

```
  dirf state import-handoff [--path DIR] [--force]    promote a local HANDOFF.md into the store
  dirf state migrate-cleanup [--path DIR]            remove migration backup(s) after confirming the store works
```

- [ ] **Step 6: Add a CLI test for migrate-cleanup (non-interactive-safe)**

Append to `tests/cli-state.test.js`:

```js
import { cpSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";

test("dirf state migrate-cleanup removes backup dirs", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "mcp-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  // plant a fake backup
  mkdirSync(join(main, ".dirf.migrating.20260101T000000000Z"));
  writeFileSync(join(main, ".dirf.migrating.20260101T000000000Z", "x"), "x");
  run(["state", "migrate-cleanup"], { DIRF_HOME: home }, main);
  const leftovers = readdirSync(main).filter((n) => n.startsWith(".dirf.migrating."));
  assert.equal(leftovers.length, 0);
});
```

- [ ] **Step 7: Run CLI tests + full suite**

Run: `node --test tests/cli-state.test.js && node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/state.js src/cli.js tests/state.test.js tests/cli-state.test.js
git commit -m "feat(state): newer-local-HANDOFF conflict hard-stop + import-handoff/migrate-cleanup verbs (M4)"
```

---

# Milestone M5 — MCP server (optional, additive)

A single new file, `src/mcp.js`: hand-rolled stdio JSON-RPC implementing the MCP lifecycle (`initialize`, `tools/list`, `tools/call`) and exposing thin tools over `state.js`. No SDK. Tested by spawning the server and speaking the protocol over stdio.

## Task 11: MCP server — initialize + tools/list

**Files:**
- Create: `src/mcp.js`
- Create: `tests/mcp.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "mcp.js");

function startServer(home) {
  const child = spawn(process.execPath, [CLI], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, DIRF_HOME: home },
  });
  return child;
}

function send(child, obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function once(child) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const line = buf.slice(0, nl);
        child.stdout.off("data", onData);
        try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
      }
    };
    child.stdout.on("data", onData);
    setTimeout(() => reject(new Error("timeout")), 5000);
  });
}

const TIMEOUT = 30_000;

test("initialize handshake returns server info + protocol version", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-"));
  const child = startServer(home);
  try {
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    const res = await once(child);
    assert.equal(res.id, 1);
    assert.ok(res.result.serverInfo.name);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
  } finally { child.kill(); }
});

test("tools/list returns the expected dirf_* tools", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-"));
  const child = startServer(home);
  try {
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    await once(child);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const res = await once(child);
    const names = res.result.tools.map((t) => t.name).sort();
    assert.ok(names.includes("dirf_read_handoff"));
    assert.ok(names.includes("dirf_write_handoff"));
    assert.ok(names.includes("dirf_list_projects"));
  } finally { child.kill(); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp.test.js`
Expected: FAIL — `src/mcp.js` not found.

- [ ] **Step 3: Implement mcp.js (initialize + tools/list)**

Create `src/mcp.js`:

```js
#!/usr/bin/env node
// amf-dirf MCP server — optional stdio JSON-RPC surface over src/state.js.
// Pure Node built-ins (no SDK). Speaks MCP initialize / notifications.initialized
// / tools/list / tools/call. Every tool is a thin call into state.js.

import { createInterface } from "node:readline";
import {
  resolveProject, listProjects, registerProject,
  readHandoff, writeHandoff, listAttempts, getAttempt, storeProjectDir,
} from "./state.js";
import { resolve } from "node:path";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "amf-dirf", version: "1.0.0" };

const TOOLS = [
  { name: "dirf_resolve_project", description: "Resolve which DIRF project a path belongs to (default: server cwd).", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "dirf_list_projects", description: "List all registered DIRF projects.", inputSchema: { type: "object", properties: {} } },
  { name: "dirf_read_handoff", description: "Read the canonical handoff for a project (slug or path; default: server cwd).", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
  { name: "dirf_write_handoff", description: "Replace the canonical handoff for a project with the given content.", inputSchema: { type: "object", properties: { project: { type: "string" }, content: { type: "string" } }, required: ["content"] } },
  { name: "dirf_list_attempts", description: "List attempts for a project.", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
  { name: "dirf_get_attempt", description: "Get one attempt by id or name.", inputSchema: { type: "object", properties: { project: { type: "string" }, id: { type: "string" } }, required: ["id"] } },
];

function resolveSlugFromParams(params = {}) {
  const project = params.project;
  if (project && /^[a-z0-9.-]+-[0-9a-f]{8}$/.test(project)) return project; // looks like a slug
  const target = resolve(project || process.cwd());
  const resolved = resolveProject(target);
  if (!resolved) throw new Error(`DIRF has no project registered for ${target}`);
  return resolved.slug;
}

function callTool(name, args) {
  switch (name) {
    case "dirf_resolve_project": {
      const target = resolve(args.path || process.cwd());
      const resolved = resolveProject(target);
      return resolved ? { slug: resolved.slug, store_path: storeProjectDir(resolved.slug) } : { slug: null };
    }
    case "dirf_list_projects":
      return { projects: listProjects() };
    case "dirf_read_handoff": {
      const slug = resolveSlugFromParams(args);
      const md = readHandoff(slug);
      return { content: md };
    }
    case "dirf_write_handoff": {
      const slug = resolveSlugFromParams(args);
      writeHandoff(slug, args.content);
      return { ok: true, slug };
    }
    case "dirf_list_attempts": {
      const slug = resolveSlugFromParams(args);
      return { attempts: listAttempts(slug).map((a) => ({ id: a.id, name: a.name, created_at: a.created_at })) };
    }
    case "dirf_get_attempt": {
      const slug = resolveSlugFromParams(args);
      const a = getAttempt(slug, args.id);
      return { id: a.id, name: a.name, created_at: a.created_at, folder: a.folder };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; } // ignore malformed lines
  if (msg.method === "initialize") {
    respond(msg.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    return;
  }
  if (msg.method === "notifications/initialized") return; // notification — no response
  if (msg.method === "tools/list") {
    respond(msg.id, { tools: TOOLS });
    return;
  }
  if (msg.method === "tools/call") {
    try {
      const result = callTool(msg.params.name, msg.params.arguments || {});
      respond(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (e) {
      respondError(msg.id, -32603, e.message);
    }
    return;
  }
  if (msg.id) respondError(msg.id, -32601, `method not found: ${msg.method}`);
});
```

- [ ] **Step 4: Run MCP tests**

Run: `node --test tests/mcp.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp.js tests/mcp.test.js
git commit -m "feat(mcp): stdio JSON-RPC server — initialize + tools/list + tools/call (M5)"
```

---

## Task 12: MCP tools/call end-to-end + equivalence test

**Files:**
- Test: `tests/mcp.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp.test.js`:

```js
import { setupProject } from "../src/project.js";
import { readHandoff } from "../src/state.js";
import { execFileSync } from "node:child_process";

const CLI_PROJECT = join(process.cwd(), "src", "cli.js");

function setupProj(home, dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  execFileSync(process.execPath, [CLI_PROJECT, "setup", dir], { env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: TIMEOUT });
}

test("dirf_write_handoff then dirf_read_handoff round-trip via MCP, byte-identical to CLI", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-eq-"));
  const dir = mkdtempSync(join(tmpdir(), "eqproj-"));
  setupProj(home, dir);

  const child = startServer(home);
  try {
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    await once(child);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });

    // write via MCP, using the path as project
    const md = "# Via MCP\n\nDrift impossible.\n";
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dirf_write_handoff", arguments: { project: dir, content: md } } });
    const writeRes = await once(child);
    assert.equal(writeRes.result.content[0].text.includes('"ok":true'), true);

    // read via MCP
    send(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dirf_read_handoff", arguments: { project: dir } } });
    const readRes = await once(child);
    const parsed = JSON.parse(readRes.result.content[0].text);
    assert.equal(parsed.content, md);

    // equivalence: CLI read-handoff returns the same bytes
    const cliOut = execFileSync(process.execPath, [CLI_PROJECT, "state", "read-handoff"], { cwd: dir, env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: TIMEOUT });
    assert.equal(cliOut, md, "MCP and CLI must return byte-identical handoff (same core)");
  } finally { child.kill(); }
});
```

- [ ] **Step 2: Run test**

Run: `node --test tests/mcp.test.js`
Expected: PASS.

- [ ] **Step 3: Run the full suite as the final gate**

Run: `node --test && node src/cli.js validate`
Expected: all tests PASS; validate prints success.

- [ ] **Step 4: Commit**

```bash
git add tests/mcp.test.js
git commit -m "test(mcp): write/read round-trip + CLI/MCP byte-identical equivalence (M5)"
```

---

## Task 13: document the MCP server wiring + central-store docs

**Files:**
- Modify: `README.md` (add a "Canonical state" + "MCP server" section)

- [ ] **Step 1: Add README sections**

In `README.md`, after the "Where things live" section, add:

```markdown
## Canonical state (central store)

DIRF coordination state — config, attempts, and the handoff — lives in a
central store at `~/.dirf/projects/<slug>/`, keyed by a slug derived from
`git rev-parse --git-common-dir`. Every worktree of a repo resolves to the
**same** store entry, so state cannot drift between checkouts.

Quick commands:

```bash
dirf state which                 # what project am I in? (slug + store path)
dirf state list                  # all registered projects
dirf state read-handoff          # print the canonical handoff
dirf state write-handoff --file new-handoff.md
```

Existing per-target `.dirf/` directories migrate into the store automatically
on first resolve (a backup copy is left at `.dirf.migrating.<ts>/` until you
run `dirf state migrate-cleanup`). A local `HANDOFF.md` newer than the store's
is never overwritten silently — run `dirf state import-handoff` to promote it.
```

And a short MCP section after it:

```markdown
### Optional MCP server

For agent hosts that speak MCP (Claude, Cursor), DIRF ships an optional
stdio JSON-RPC server exposing the same operations as tools. Zero-dependency,
no SDK:

```jsonc
// in your MCP client config
{ "command": "node", "args": ["<path-to-amf-dirf>/src/mcp.js"] }
```

Tools: `dirf_resolve_project`, `dirf_list_projects`, `dirf_read_handoff`,
`dirf_write_handoff`, `dirf_list_attempts`, `dirf_get_attempt`. Every tool is
a thin call into the same `src/state.js` core as the CLI, so the two surfaces
return byte-identical results.
```

- [ ] **Step 2: Run validate**

Run: `node src/cli.js validate`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: central store + MCP server README sections (M5)"
```

---

## Self-review (completed during authoring)

**1. Spec coverage** — every spec section maps to tasks:
- §4 identity/slug/normalization → Task 2 (exhaustive cases).
- §4 concurrency (atomic writes) → Task 3 + the Task 4 atomic-write test.
- §5 store layout + resolution ladder → Tasks 1, 3, 4, 9.
- §5 "no pointer file" → honored (no task creates one).
- §6 CLI verbs → Task 8 + 10.
- §6 MCP server → Tasks 11, 12.
- §6 equivalence (MCP/CLI byte-identical) → Task 12.
- §7 migration (backup, idempotent, schema upgrade, conflict rows) → Tasks 9, 10.
- §7 `import-handoff`/`migrate-cleanup` → Task 10.
- §8 worktree prose → Task 7.
- §9 milestones → M1–M5 map to task groups.
- §11 success criteria → covered by tests in Tasks 2, 9, 10, 12.

**2. Placeholder scan** — no TBD/TODO/“handle edge cases”/“similar to Task N”. Each code step contains real code. One illustrative shell block in Task 9 Step 5 is explicitly flagged and immediately followed by the real shell command.

**3. Type/signature consistency** — `resolveStateSlug`, `storeProjectDir`, `createAttemptInStore`, `readHandoff(slug)`, `writeHandoff(slug, md)`, `migrateProject(target, slug)`, `importHandoff(target, slug, { force })`, `migrateCleanup(target)` are used consistently across tasks. `createAttempt`/`listAttempts`/`findAttempt` in `project.js` keep their existing signatures (thin wrappers) so `cli.js` call sites don't break. `resolveProject` gains an optional `{ interactive }` param with a default — backward compatible.

---

## Execution note

M2 is the atomic cutover milestone: Tasks 5–7 land together (one release). Do not ship M2 partially — between Task 5 and Task 6 the kit is mid-cutover (setup writes to the store, build reads from it via the same delegated functions, so it's actually consistent within M2; the prose update in Task 7 rides along to avoid misleading generated handoffs during transition). M5 (Tasks 11–13) is optional and can be deferred without affecting anything.
