# DIRF Canonical State — Design

- **Status:** Draft v2 (revised after deep review; pending user review)
- **Date:** 2026-07-25
- **Scope:** `amf-dirf` (DIRF = Do It Right First)
- **One-line goal:** Make DIRF coordination state canonical and centrally owned, so all agents and git worktrees read and write through one source of truth — no drifting per-checkout copies.

## 1. Problem

DIRF today stores coordination state per-target inside the host checkout at
`<target>/.dirf/` (see `src/project.js`): `config.json`, `attempts/<id>/`, and
ad-hoc `HANDOFF.md` files. Three structural problems follow:

1. **State is untracked and per-checkout.** `.dirf/` is gitignored. Each git
   worktree gets its *own independent* `.dirf/` directory. When an agent
   (Codex, Claude, …) spins up a worktree and reads `.dirf/HANDOFF.md`, it
   reads the worktree's local copy — which may be stale, partial, or never
   written. **This is the actual failure that motivated this design:** on the
   `myproject` project, a worktree at `C:/tmp/myproject-wt-closure/`
   read an out-of-date `HANDOFF.md` that never received a rewrite made in the
   main tree. The worktree and main tree drifted apart.

2. **No central registry.** Nothing records "these are DIRF's projects, here's
   where each lives." You cannot ask DIRF "what's happening on myproject?"
   from outside that checkout. The word "registry" in the code today refers
   only to the kit's *bundled* playbook/agent/skill metadata
   (`registry/agents.json`, `registry/skills.json`, `registry/playbooks.json`),
   never to configured targets.

3. **Agents duplicate state instead of talking to DIRF.** Because state lives
   in a local `.dirf/`, agents read and write their own copies and diverge.
   There is no path for an agent to ask DIRF directly.

The user frames these as one problem: *DIRF state should live in one
canonical, centrally-owned place that all agents and worktrees read and write
through.*

## 2. Non-goals

To keep the build lean and avoid creep:

- **No worktree management.** DIRF will *resolve through* worktrees but will
  never create, name, list, or remove them, and will track no worktree
  inventory. Raw `git worktree add` (by a human or any agent) is supported
  directly by resolution — DIRF does not care how a worktree came to exist.
- **No telemetry / no network.** The store is local files only. `last_seen`
  is a local timestamp used solely for `dirf state list` freshness display.
- **No multi-user / cross-machine sync.** `~/.dirf/` is per-user-per-machine.
- **No content versioning of attempts.** Attempts move as-is into the store.
- **No `dirf state prune` or `re-associate`** in this build. Cleanup of stale
  entries and re-association of a renamed main tree (see §4 limitation) are
  named as possible future additions (§10), not built now.
- **No local DIRF state in target checkouts.** Resolution is pure: via git
  for git targets, via normalized path for non-git targets. There is no
  pointer file and no per-checkout cache. (See §4 for why.)

## 3. Approach (selected)

Central store + thin access layer (CLI core, optional MCP wrapper), with
passive worktree resolution.

```
~/.dirf/                         ← DIRF's home (already used for trusted-sources.json)
  projects.json                  ← project registry
  projects/<slug>/
    config.json                  ← canonical config (moved from <target>/.dirf/)
    HANDOFF.md                   ← canonical handoff
    attempts/<id>/               ← per-run state (layout unchanged)
```

- **Single source of truth in code:** a new `src/state.js` owns *all* reads
  and writes of canonical state. Every other module calls into it.
- **Two thin shells over the same core:** the `dirf state` CLI verbs, and an
  optional stdio JSON-RPC MCP server. They can never drift from each other
  because neither contains logic — both are thin calls into `state.js`.
- **Passive worktree resolution:** identity is derived from
  `git rev-parse --git-common-dir`, so all worktrees of a repo resolve to the
  *same* store entry. No worktree-local state, no drift. See §6.

### Why not the alternatives

- **Central store + CLI only** (no MCP): would force every agent onto shell
  commands with manual serialization. MCP is additive and agent-native, so it
  is included as an optional surface.
- **Main-tree canonical + worktree proxy** (no central store): most git-native
  but leaves state trapped inside a checkout, so cross-project queries and the
  registry facet stay weak. Rejected.
- **Local pointer/cache file** (rejected in v2 review): a `<target>/.dirf/slug.json`
  pointer was proposed to preserve project continuity across renames. Under
  the chosen identity rule (§4 — git is ground truth, git wins on conflict),
  the pointer has no remaining job and would add a precedence-rule category
  with no offsetting value. Dropped. Pure resolution only.

## 4. Store topology & project identity

### Location

`~/.dirf/projects/<slug>/`. The `~/.dirf/` directory is already DIRF's home
(`trusted-sources.json` lives there per `src/skills.js`), so this extends an
established precedent. Target checkouts hold **no DIRF state at all** — that
is what makes drift impossible (there is nothing local to drift).

### Identity key & slug derivation

The slug is recomputed on *every* resolve, so the hashing input must be
byte-stable across runs. If it isn't, the slug changes run-to-run, the
registry forks new entries, and **drift returns silently — worse than before.**
This is the single highest-risk piece of the design, so the normalization
contract is explicit:

1. **Determine the identity key:**
   - **Git target:** `git rev-parse --git-common-dir`. This is the shared
     `.git` that all worktrees point back to. A main tree and any of its
     worktrees resolve to the same common dir → same key → same slug → same
     store entry. This collapse is what kills the myproject drift.
   - **Non-git target:** the normalized absolute path of the project
     directory.
2. **Normalize the key deterministically, in this exact order:**
   1. Resolve to absolute (older git can return a relative common-dir).
   2. Normalize path separators to `/`.
   3. Strip trailing slash.
   4. Resolve symlinks.
   5. **Case-fold to lower case.** Required on case-insensitive filesystems
      (Windows, macOS default): the FS treats `C:/MyProject` and
      `c:/myproject` as identical, so the slug must too. Lower-casing
      everywhere is the simplest correct rule and is harmless on
      case-sensitive FSes (paths there are already a single case in
      practice for a given repo).
3. **Hash:** `sha1(normalizedKey)` → first 8 hex chars.
4. **Format slug:** `<basename>-<hash8>`, e.g. `myproject-a1b2c3d4`.
   Basename is the main worktree's directory name for git (from
   `git rev-parse --show-toplevel`), cwd basename otherwise.

The myproject case: run from
`C:/tmp/myproject-wt-closure/` → common-dir normalizes to
`c:/code/myproject/.git` → slug `myproject-a1b2c3d4` → **same
entry** as the main tree. Codex reads/writes the same store files.

### Known limitation: a moved/renamed main tree orphans the store entry

Because the slug is path-derived, renaming the main tree directory changes
the common-dir → new slug → the old store entry is orphaned (data intact,
just no longer reachable by resolution). This is the deliberate trade-off of
"git wins" identity: it avoids the dangerous failure mode (a *copied*
checkout silently attaching to the original's project and cross-contaminating
it), at the cost of rename continuity. Recovery is a future `re-associate`
command (§10), not built now. Named explicitly so it is not a surprise.

### Project registry: `projects.json`

```json
{
  "schema_version": 1,
  "projects": {
    "myproject-a1b2c3d4": {
      "slug": "myproject-a1b2c3d4",
      "name": "myproject",
      "git_common_dir": "c:/code/myproject/.git",
      "main_path": "c:/code/myproject",
      "created_at": "2026-07-25T12:00:00Z",
      "last_seen": "2026-07-25T14:30:00Z"
    }
  }
}
```

This is the "project registry." To avoid overload with the kit's bundled
metadata, "project registry" refers to this file; the bare word "registry" in
code continues to mean `registry/*.json` bundled metadata.

### Concurrency

Store files are written atomically: write to a temp file, then `fs.rename`
onto the final path on the same volume. Two agents (Codex, Claude) writing the
same handoff concurrently cannot corrupt the file; last-writer-wins, no merge
(in scope, per the "current snapshot" model).

## 5. Resolution flow

### `state.js` core API

```
state.registerProject(targetPath)   → { slug, isNew }
state.resolveProject(targetPath)    → { slug } | null
state.get(slug)                     → project record | null
state.listProjects()                → [ records ]
state.readHandoff(slug)             → string | null
state.writeHandoff(slug, markdown)
state.listAttempts(slug)            → [ attempt summaries ]
state.getAttempt(slug, id)          → attempt record
state.migrateProject(targetPath, slug)
state.importHandoff(targetPath, slug, { force })   ← §7 conflict hatch
```

### Resolution ladder (`resolveProject`)

```
1. Is targetPath inside a git repo?
     git rev-parse --git-common-dir
       git     → use normalized common-dir as identity key
       non-git → use normalized absolute path as identity key
2. Derive slug from the key (basename + hash8), per §4 normalization.
3. Look up slug in projects.json:
       found     → project = record; bump last_seen
       not found → if <target>/.dirf/ has real state → migrateProject (§7)
                   else → return null (suggest `dirf setup`)
4. Return { slug }; all reads/writes go to ~/.dirf/projects/<slug>/
```

No pointer file is read or written. Resolution is stateless and recomputed
each time. (For a git target this is one `git rev-parse` call, ~10ms; the
fast-path-cache argument for a pointer does not justify a local artifact.)

### What moves out of target checkouts

| Today (per-target) | After (canonical) |
|---|---|
| `<target>/.dirf/config.json` | `~/.dirf/projects/<slug>/config.json` |
| `<target>/.dirf/attempts/<id>/` | `~/.dirf/projects/<slug>/attempts/<id>/` |
| `<target>/.dirf/HANDOFF.md` *(ad hoc, drift-prone)* | `~/.dirf/projects/<slug>/HANDOFF.md` |

No file is added to the target. The `<target>/.dirf/` directory is vacated by
migration (§7) and may be removed; the `.gitignore` entry for `.dirf/` is
harmless to leave.

## 6. Access surfaces

### Principle: one core, two shells

```
   dirf CLI ────▶ ┌──────────────────────────────┐
   (humans +      │       src/state.js            │──▶ ~/.dirf/projects/<slug>/
   shell agents)  │  (the ONLY state read/write)  │
   MCP server ──▶ │                              │
   (Claude, …)    └──────────────────────────────┘
                   same functions, same paths, no duplicated logic
```

A CLI verb and its matching MCP tool are the same call into `state.js`. If a
behavior exists, it lives in `state.js` — never in a surface.

### CLI: `dirf state <subcommand>`

New `state` command group. Resolution defaults to cwd; `--path DIR` or
`--slug X` override (so you can query myproject from inside amf-dirf).

| Verb | → `state.js` | Purpose |
|---|---|---|
| `dirf state which` | `resolveProject(cwd)` | "what project am I in?" — prints slug + store path. The diagnostic for the myproject case. |
| `dirf state list` | `listProjects()` | all registered projects, from anywhere. |
| `dirf state register [--path]` | `registerProject(path)` | explicit add (also happens implicitly on `setup`). |
| `dirf state read-handoff [--path\|slug]` | `readHandoff(slug)` | print canonical handoff to stdout. |
| `dirf state write-handoff [--path\|slug] [--file\|-]` | `writeHandoff(slug, md)` | write canonical handoff (from `--file` or stdin). |
| `dirf state list-attempts [--path\|slug]` | `listAttempts(slug)` | attempts for a project, from anywhere. |
| `dirf state get-attempt <id> [--path\|slug]` | `getAttempt(slug, id)` | one attempt's detail. |
| `dirf state import-handoff [--path] [--force]` | `importHandoff(...)` | promote a target's local HANDOFF into the store (conflict hatch, §7). |
| `dirf state migrate-cleanup [--path]` | (migration finish) | remove the `.dirf.migrating.<ts>/` backup after the user confirms the migrated store works (§7). |

Existing `build`/`create`/`render`/`list`/`resume` get rewired to resolve a
slug first, then read/write through `state.js`. User-facing behavior is
unchanged.

### MCP server: `src/mcp.js`

One new file. Pure stdio JSON-RPC over the wire — **no SDK, no
`node_modules`**, consistent with the kit's zero-dependency rule. It speaks
the standard MCP `initialize` / `tools/list` / `tools/call` lifecycle by hand.

| Tool | Params | → `state.js` |
|---|---|---|
| `dirf_resolve_project` | `path?` (default: server cwd) | `resolveProject` |
| `dirf_list_projects` | — | `listProjects` |
| `dirf_read_handoff` | `project?` (slug or path) | `readHandoff` |
| `dirf_write_handoff` | `project?`, `content` | `writeHandoff` |
| `dirf_list_attempts` | `project?` | `listAttempts` |
| `dirf_get_attempt` | `project?`, `id` | `getAttempt` |

MCP does **not** expose `import-handoff` or `migrate-cleanup`: those are
migration-time hatches for humans, not agent operations.

MCP design choices:

- **`project?` is the override.** Default resolves from the server's cwd
  (matching CLI ergonomics). Override lets one MCP instance serve multiple
  projects.
- **`write_handoff` is replace, not append.** The handoff is the *current
  canonical snapshot*. An agent that wants to update it reads → modifies →
  writes. (Append mode is easy to add later if needed; YAGNI now.)

### Agent flow under this design

```
Codex (in worktree C:/tmp/myproject-wt-closure/):
  $ dirf state which
  myproject-a1b2c3d4  →  ~/.dirf/projects/myproject-a1b2c3d4/
  $ dirf state read-handoff
  ... canonical HANDOFF.md ...
  # does work, updates handoff:
  $ dirf state write-handoff --file new-handoff.md

You (anywhere):
  $ dirf state list
  myproject-a1b2c3d4   last_seen 14:30   myproject
  $ dirf state read-handoff --slug myproject-a1b2c3d4
  ... same canonical handoff Codex just wrote ...
```

## 7. Migration of existing per-target `.dirf/`

### Principle

Non-destructive, lazy, explicit on conflict. Existing `<target>/.dirf/`
directories move into the store **on first resolve**, not eagerly. Nothing is
deleted until the user explicitly confirms via `migrate-cleanup`. Conflicts
never silently overwrite.

### Migration candidate

A target migrates when, on resolve, the registry has no entry for its slug
**but** `<target>/.dirf/` exists and contains real state (`config.json` or
`attempts/`). A target with no `.dirf/` is a fresh registration.

### `state.migrateProject(targetPath, slug)` steps (idempotent / restartable)

1. **Backup copy first — before touching anything.** Copy `<target>/.dirf/`
   → `<target>/.dirf.migrating.<timestamp>/`. This is the recoverable safety
   net. Because it precedes every move, an interrupted migration is always
   recoverable: re-running picks up where it left off using the backup.
2. **Register** the project in `projects.json` (slug, name, normalized
   git-common-dir, main_path, timestamps). Idempotent: if already present
   (e.g., a concurrent worktree registered it first), skip.
3. **Move state** into the store (each move is independent, so a partial
   failure leaves a consistent prefix):
   - `<target>/.dirf/config.json` → store, upgraded to `schema_version` 2
     (drops the now-stale `attempt_root`, adds `slug`).
   - `<target>/.dirf/attempts/` → `~/.dirf/projects/<slug>/attempts/`.
   - `<target>/.dirf/HANDOFF.md` → `~/.dirf/projects/<slug>/HANDOFF.md`.
4. Done. The backup copy from step 1 stays until the user runs
   `dirf state migrate-cleanup` (below). It is **not** auto-deleted by a
   heuristic — auto-deleting on a guess clashes with "never lose data."

### Conflict handling (the contract)

When `resolveProject` finds the slug **already in the registry** while the
target still has a local `.dirf/` (e.g., a worktree registered the project
first, or these are leftover files), migration does **not** run. One code path
with a sub-condition:

| Condition | Resolution |
|---|---|
| Registry has entry; local `.dirf/` exists; local `HANDOFF.md` mtime **older than or equal to** store's (or absent) | **Registry wins.** Do not migrate. Log clearly: *"project myproject-a1b2c3d4 already registered; local .dirf/ is orphaned. Review and remove it, or run `dirf state migrate-cleanup`."* Never delete the local files on a guess. |
| Registry has entry; local `.dirf/` exists; local `HANDOFF.md` mtime **newer than** the store's | **Never auto-overwrite.** Surface it (see below); the user must run `dirf state import-handoff` to promote the local copy. This is the generalization of the myproject drift and must require a human. |

**Surfacing the newer-HANDOFF conflict:**

- **Interactive (TTY present):** prompt — offer to run `import-handoff`, or
  defer.
- **Non-interactive (no TTY — the common case inside an agent flow):**
  **hard-stop with a clear instructive error and nonzero exit.** Never silent
  skip, never silent overwrite. Example exit message:
  *"Local HANDOFF.md is newer than canonical for myproject-a1b2c3d4. Run
  \`dirf state import-handoff\` to promote it, or \`--force\` to skip this
  check. Refusing to proceed to avoid silent data loss."*

### `dirf state import-handoff [--path] [--force]`

Promotes a target's local `HANDOFF.md` into the canonical store, replacing
it. **Before replacing, backs up the store's current handoff** to
`HANDOFF.md.<timestamp>.bak` in the store — so promoting a local copy can
never destroy the canonical one. Prompts for confirmation by default;
`--force` skips it.

### `dirf state migrate-cleanup [--path]`

Removes the `<target>/.dirf.migrating.<timestamp>/` backup after the user has
confirmed the migrated store works. Explicit only — never automatic.

### What does NOT migrate

- The `<target>/.gitignore` entry for `.dirf/` — stays (harmless).
- Content outside `.dirf/` that `setupProject()` scaffolds today
  (`CONTEXT.md`, `adr/`, specs, tickets) — **stays in the target.** That is
  project *content*, not DIRF *coordination state*. The line: if it is about
  *DIRF runs*, it is central; if it is about *the project itself*, it stays.

### Migration is one-shot per project

Once a project is in the registry, `resolveProject` never tries to migrate it
again. The lazy-migrate path only fires for slugs absent from the registry;
already-registered slugs hit the conflict path above instead.

## 8. Worktree resolution (passive)

DIRF detects and resolves through worktrees. It never creates, names, lists,
or removes them, and carries no worktree inventory. The §5 resolution ladder
is the entire mechanism: inside any worktree of project `P`,
`git-common-dir` resolves to `<P-main>/.git`, `slug(P)` matches the main tree,
and all reads/writes hit the same `~/.dirf/projects/<P-slug>/`.

A worktree's filesystem location is irrelevant to identity. One made by raw
`git worktree add`, by Codex, by Claude, or by hand all resolve identically.

**First contact with a worktree:** when a DIRF command runs from a worktree,
resolution succeeds via the ladder's `git-common-dir` step with no setup step,
no prompt, no error — there is no local state to bootstrap. The worktree is
immediately first-class. This is the property that makes "Codex spun up a
worktree and DIRF just worked" true.

### Codebase changes for worktrees

1. `src/renderer.js:228` and `:460` — advisory lines like *"keep worktrees
   beside the target repository"* become misleading under a central store.
   Update to: *"DIRF state is central; worktrees resolve automatically via
   `git-common-dir` — no per-worktree setup needed."*
2. `README.md:180` — same prose, same update.
3. `src/inspect.js:158-171` (`detectWorktrees`) — **stays as-is.** Read-only
   inspection finding; no conflict with this design.
4. No `dirf worktree` command is added. The namespace is left unreserved.

## 9. Rollout & testing

### Rollout — milestones (not independently-shippable stages)

The original 7-stage framing had a broken intermediate: rewiring `setup` to
write to the store *before* rewiring `build`/`list` to read from it leaves the
kit half-cut-over. Reframed as milestones, where the cutover is atomic.

- **M1 — Core (no behavior change).** `src/state.js` + store layout +
  slug derivation with the §4 normalization contract. Pure functions,
  unit-tested with a temp `HOME`. Existing commands keep reading per-target
  `.dirf/` as today. Kit unchanged from the user's view.
- **M2 — Cutover (atomic, one release).** Resolution + registry; rewire
  `setup` to register + write to the store; rewire
  `build`/`create`/`render`/`list`/`resume` to resolve a slug and read/write
  through `state.js`; define `config.json` `schema_version` 2 (new setups);
  **and** update the worktree advisory prose (`renderer.js:228/:460`,
  `README.md:180`) in the same release — without the prose update, generated
  instruction sets would still tell agents to "keep worktrees beside the
  target," actively causing the confusion being fixed. **This milestone is
  where the drift bug goes away.**
- **M3 — `dirf state` command group.** The CLI verbs from §6 (`which`,
  `list`, `register`, `read-handoff`, `write-handoff`, `list-attempts`,
  `get-attempt`, `import-handoff`, `migrate-cleanup`).
- **M4 — Migration.** The lazy non-destructive migrate-on-first-resolve from
  §7, including schema 1 → 2 upgrade of existing on-disk configs.
- **M5 — `src/mcp.js`.** stdio JSON-RPC server over the same `state.js` core.
  Last; purely additive — the CLI already does everything. Deferring it
  hurts nothing.

### Testing approach

- **Zero-dependency stays zero-dependency.** Tests use `node:test` (the kit's
  existing pattern — `tests/flow.test.js`). MCP JSON-RPC is tested by
  spawning the server process and speaking the protocol over stdio; no SDK.
- **Slug derivation (M1, highest risk — the drift-killer).** Exhaustive
  cases, all asserting the *same slug*: git main tree; git worktree (both
  must match); path-separator variants (`/` vs `\`); case variants
  (`E:/` vs `e:/`, `MyProject` vs `myproject`); trailing slash; relative
  common-dir; symlinked repo path. Plus a negative case: two different repos
  produce different slugs.
- **Migration (M4).** Seed a temp target with a `.dirf/` and assert: state
  lands in store; backup exists; re-resolve is stable; schema upgraded;
  conflict rows behave per §7 contract (newer-local-HANDOFF non-interactive =
  error + nonzero exit; interactive = prompt); `import-handoff` backs up the
  store's handoff before replacing.
- **Equivalence test (M5).** MCP `dirf_read_handoff` and
  `dirf state read-handoff` return byte-identical output (same core, by
  construction).
- **Concurrency (M2).** Two concurrent `writeHandoff` calls leave a valid
  file (atomic rename), no corruption.

## 10. Open questions (non-blocking)

1. **`config.json` schema bump.** Spec'd as `schema_version` 1 → 2 in M2/M4:
   drop the now-stale `attempt_root` (state is under the store, not a target
   path) and add `slug`. Low-risk.
2. **`dirf state prune` and `re-associate`.** Future commands: prune removes
  registry entries whose `main_path` no longer exists; `re-associate` lets a
  renamed main tree point back at its orphaned store entry. Neither in this
  build (YAGNI), both named so the rename limitation (§4) has a planned
  remedy.

## 11. Success criteria

- From inside *any* worktree of a registered project, `dirf state read-handoff`
  returns the same content as from the main tree. **The myproject drift is
  structurally impossible.**
- Slug derivation is stable across path-separator, case, trailing-slash, and
  symlink variants for the same repo (the normalization contract holds).
- `dirf state list` from any cwd shows all registered projects with
  `last_seen`.
- An existing target's `.dirf/` migrates on first resolve with a backup, never
  losing data; a newer local HANDOFF surfaces a hard-stop error
  non-interactively and requires explicit `import-handoff` to promote.
- MCP `dirf_read_handoff` and `dirf state read-handoff` return byte-identical
  output.
- Zero dependencies preserved; `node src/cli.js validate` stays green.
