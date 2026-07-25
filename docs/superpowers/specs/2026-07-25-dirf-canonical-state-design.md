# DIRF Canonical State — Design

- **Status:** Draft (pending user review)
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
   `storytellers` project, a worktree at `C:/tmp/storytellers-m026-closure/`
   read an out-of-date `HANDOFF.md` that never received a rewrite made in the
   main tree. The worktree and main tree drifted apart.

2. **No central registry.** Nothing records "these are DIRF's projects, here's
   where each lives." You cannot ask DIRF "what's happening on storytellers?"
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
- **No `dirf state prune`** in this build. Stale-entry cleanup is named as a
  possible future addition (§10), not built now.

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

## 4. Store topology & project identity

### Location

`~/.dirf/projects/<slug>/`. The `~/.dirf/` directory is already DIRF's home
(`trusted-sources.json` lives there per `src/skills.js`), so this extends an
established precedent. Target checkouts hold **no canonical state** — that is
what makes drift impossible (there is nothing local to drift).

### Slug derivation (the cross-worktree identity key)

The slug must be stable across all worktrees of the same repo. Mechanism:

- **Git repo** → derive from `git rev-parse --git-common-dir`. The common dir
  is the shared `.git` that all worktrees point back to. A main tree and any
  of its worktrees resolve to the same common dir → same slug → same store
  entry. This collapse is what kills the storytellers drift.
- **Non-git folder** → derive from the normalized absolute path hash (the kit
  already supports non-git targets).
- **Format:** readable + disambiguator — `<basename>-<hash8>`, e.g.
  `storytellers-a1b2c3d4`. Basename is the main worktree's directory name for
  git, cwd basename otherwise.

### Project registry: `projects.json`

```json
{
  "schema_version": 1,
  "projects": {
    "storytellers-a1b2c3d4": {
      "slug": "storytellers-a1b2c3d4",
      "name": "storytellers",
      "git_common_dir": "E:/s7s-projects/storytellers/.git",
      "main_path": "E:/s7s-projects/storytellers",
      "created_at": "2026-07-25T12:00:00Z",
      "last_seen": "2026-07-25T14:30:00Z"
    }
  }
}
```

This is the "project registry." Note: to avoid overload with the kit's bundled
metadata, "project registry" refers to this file; the bare word "registry" in
code continues to mean `registry/*.json` bundled metadata.

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
       git     → use common-dir as identity key
       non-git → use normalized absolute path as identity key
2. Derive slug from the key (basename + hash8).
3. Look up slug in projects.json:
       found     → project = record; bump last_seen
       not found → if <target>/.dirf/ has real state → migrateProject (§7)
                   else → return null (suggest `dirf setup`)
4. Return { slug }; all reads/writes go to ~/.dirf/projects/<slug>/
```

Worked example — the storytellers drift case, fixed:

- Run from `C:/tmp/storytellers-m026-closure/` →
  `git-common-dir` = `E:/s7s-projects/storytellers/.git` →
  slug `storytellers-a1b2c3d4` → **same store entry** as the main tree.
  Codex reads/writes the same `HANDOFF.md`. Drift is impossible.

### Slug pointer file (the one deliberate local artifact)

`<target>/.dirf/slug.json` — a small (≈50-byte) hint:

```json
{ "slug": "storytellers-a1b2c3d4" }
```

- **Purpose:** make resolution instant and unambiguous without re-running
  git, and let a non-git checkout remember its slug after a rename.
- **Precedence:** the resolution ladder still runs. If the slug *derived*
  from git/common-dir **matches** the pointer → fast path. If they
  **disagree** → the **registry wins** and the pointer is rewritten. The
  pointer can never *cause* drift; it can only speed up the common case.
- **Worktrees:** the pointer is created at `dirf setup` of the **main tree
  only**. Worktrees inherit identity from `git-common-dir`; they never get a
  pointer and never need one. (This is why a pointer can disagree but never
  wins.)
- **Gitignored:** `.dirf/` stays in the target's `.gitignore`, so the pointer
  is local-only and regenerable.

The pointer is a cache, not a source of truth.

### What moves out of target checkouts

| Today (per-target) | After (canonical) |
|---|---|
| `<target>/.dirf/config.json` | `~/.dirf/projects/<slug>/config.json` |
| `<target>/.dirf/attempts/<id>/` | `~/.dirf/projects/<slug>/attempts/<id>/` |
| `<target>/.dirf/HANDOFF.md` *(ad hoc, drift-prone)* | `~/.dirf/projects/<slug>/HANDOFF.md` |
| — | `<target>/.dirf/slug.json` *(new: resolution hint, gitignored)* |

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
`--slug X` override (so you can query storytellers from inside amf-dirf).

| Verb | → `state.js` | Purpose |
|---|---|---|
| `dirf state which` | `resolveProject(cwd)` | "what project am I in?" — prints slug + store path. The diagnostic for the storytellers case. |
| `dirf state list` | `listProjects()` | all registered projects, from anywhere. |
| `dirf state register [--path]` | `registerProject(path)` | explicit add (also happens implicitly on `setup`). |
| `dirf state read-handoff [--path\|slug]` | `readHandoff(slug)` | print canonical handoff to stdout. |
| `dirf state write-handoff [--path\|slug] [--file\|-]` | `writeHandoff(slug, md)` | write canonical handoff (from `--file` or stdin). |
| `dirf state list-attempts [--path\|slug]` | `listAttempts(slug)` | attempts for a project, from anywhere. |
| `dirf state get-attempt <id> [--path\|slug]` | `getAttempt(slug, id)` | one attempt's detail. |
| `dirf state import-handoff [--path] [--force]` | `importHandoff(...)` | promote a target's local HANDOFF into the store (conflict hatch, §7). |

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

MCP design choices:

- **`project?` is the override.** Default resolves from the server's cwd
  (matching CLI ergonomics). Override lets one MCP instance serve multiple
  projects.
- **`write_handoff` is replace, not append.** The handoff is the *current
  canonical snapshot*. An agent that wants to update it reads → modifies →
  writes. (Append mode is easy to add later if needed; YAGNI now.)

### Agent flow under this design

```
Codex (in worktree C:/tmp/storytellers-m026-closure/):
  $ dirf state which
  storytellers-a1b2c3d4  →  ~/.dirf/projects/storytellers-a1b2c3d4/
  $ dirf state read-handoff
  ... canonical HANDOFF.md ...
  # does work, updates handoff:
  $ dirf state write-handoff --file new-handoff.md

You (anywhere):
  $ dirf state list
  storytellers-a1b2c3d4   last_seen 14:30   storytellers
  $ dirf state read-handoff --slug storytellers-a1b2c3d4
  ... same canonical handoff Codex just wrote ...
```

## 7. Migration of existing per-target `.dirf/`

### Principle

Non-destructive, lazy, explicit on conflict. Existing `<target>/.dirf/`
directories move into the store **on first resolve**, not eagerly. Nothing is
deleted until migration is confirmed. Conflicts never silently overwrite.

### Migration candidate

A target migrates when, on resolve, the registry has no entry for its slug
**but** `<target>/.dirf/` exists and contains real state (`config.json` or
`attempts/`). A target with only a stray `.dirf/slug.json` and nothing else is
*not* migratable — it is a fresh registration.

### `state.migrateProject(targetPath, slug)` steps

1. **Backup copy.** Copy `<target>/.dirf/` →
   `<target>/.dirf.migrating.<timestamp>/` before touching anything. This copy
   is the recoverable safety net. It is removed only after the new store has
   been confirmed working by the user running at least one command against it;
   until then it stays (better a stale dir than lost data).
2. **Register** the project in `projects.json` (slug, name, git-common-dir,
   main_path, timestamps).
3. **Move state** into the store:
   - `<target>/.dirf/config.json` → `~/.dirf/projects/<slug>/config.json`
   - `<target>/.dirf/attempts/` → `~/.dirf/projects/<slug>/attempts/`
   - `<target>/.dirf/HANDOFF.md` → `~/.dirf/projects/<slug>/HANDOFF.md`
   - Other recognized DIRF files found at target level → store.
4. **Write the pointer:** `<target>/.dirf/slug.json`.
5. Leave the backup copy from step 1 in place. (The originals were *moved* in
   step 3, so their paths are vacated; the backup is the pre-move copy.)

### Conflict handling (the contract)

Three conflict shapes, three deterministic answers:

| Situation | Resolution |
|---|---|
| Store entry exists, target has older-looking state, no local pointer | **Registry wins.** Do not migrate; the store is canonical. Log a clear message pointing to `dirf state which`. Leave target `.dirf/` untouched (never delete someone's files on a guess). |
| Store entry exists, target pointer disagrees with derived slug | **Registry wins**, rewrite pointer (§5 precedence rule). |
| Store entry exists for slug, but target has a `HANDOFF.md` whose mtime is newer than the store's | **Never auto-overwrite.** Prompt to run `dirf state import-handoff` (or `--force` for scripted use). This is the generalization of the storytellers drift and must require a human. |

`dirf state import-handoff [--path] [--force]` is the explicit hatch for the
third row: promotes a target's local HANDOFF into the canonical store,
replacing it. Prompts for confirmation by default; `--force` skips it.

### What does NOT migrate

- The `<target>/.gitignore` entry for `.dirf/` — **stays.** The pointer is
  still gitignored; correct.
- Content outside `.dirf/` that `setupProject()` scaffolds today
  (`CONTEXT.md`, `adr/`, specs, tickets) — **stays in the target.** That is
  project *content*, not DIRF *coordination state*. The line: if it is about
  *DIRF runs*, it is central; if it is about *the project itself*, it stays.

### Migration is one-shot per project

Once a project is in the registry, `resolveProject` never tries to migrate it
again. The lazy-migrate path only fires for slugs absent from the registry.

## 8. Worktree resolution (passive)

DIRF detects and resolves through worktrees. It never creates, names, lists,
or removes them, and carries no worktree inventory. The §5 resolution ladder
is the entire mechanism: inside any worktree of project `P`,
`git-common-dir` resolves to `<P-main>/.git`, `slug(P)` matches the main tree,
and all reads/writes hit the same `~/.dirf/projects/<P-slug>/`.

A worktree's filesystem location is irrelevant to identity. One made by raw
`git worktree add`, by Codex, by Claude, or by hand all resolve identically.

**First contact with a worktree:** when a DIRF command runs from a worktree
with no local pointer (the normal case), resolution succeeds via the ladder's
`git-common-dir` fallback. No setup step, no prompt, no error. The worktree is
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

### Rollout staging (each stage independently testable, kit stays working)

1. **`src/state.js` + store layout.** Core module and
   `~/.dirf/projects/<slug>/` structure. Pure functions, unit-testable with a
   temp `HOME`. Existing commands keep reading per-target `.dirf/` as today.
2. **Resolution + registry.** `resolveProject`, `registerProject`,
   `projects.json` read/write, slug derivation (git-common-dir + path-hash
   fallback). Existing `setup` gets rewired to register + write the pointer.
3. **Rewire existing commands.** `build`/`create`/`render`/`list`/`resume`
   resolve a slug, then read/write through `state.js`. User-facing behavior
   unchanged. Central store is live; the drift bug is fixed at this point.
4. **`dirf state` command group.** The CLI verbs from §6.
5. **Migration.** The lazy non-destructive migrate-on-first-resolve from §7.
6. **`src/mcp.js`.** stdio JSON-RPC server over the same `state.js` core.
   Last; purely additive — the CLI already does everything.
7. **Prose updates.** `renderer.js:228/:460`, `README.md:180`.

If MCP (6) is deferred, nothing suffers.

### Testing approach

- **Zero-dependency stays zero-dependency.** Tests use `node:test` (the kit's
  existing pattern — `tests/flow.test.js`). MCP JSON-RPC is tested by
  spawning the server process and speaking the protocol over stdio; no SDK.
- **Slug derivation is the highest-risk logic** (the drift-killer), so it gets
  the most thorough tests: git main tree, git worktree (both must produce the
  same slug), non-git folder, renamed folder with a pointer, conflict cases.
- **Migration tests** seed a temp target with a `.dirf/` and assert: state
  lands in store, backup exists, pointer written, re-resolve is stable,
  conflict rows behave per §7 contract.
- **Equivalence test:** MCP `dirf_read_handoff` and `dirf state read-handoff`
  return byte-identical output (same core, by construction).

## 10. Open questions (non-blocking)

1. **Pointer file format.** Spec'd as `slug.json` (`{ "slug": "..." }`) for
   extensibility. A single-line `.dirf/slug` text file is equally viable.
2. **`config.json` schema bump.** Moving config to the store is a natural
   moment to bump `schema_version` 1 → 2 and add the slug field. Low-risk;
   flagged for the plan.
3. **`dirf state prune`.** A later command to remove entries whose `main_path`
   no longer exists. Not in this build (YAGNI), named so it is not forgotten.

## 11. Success criteria

- From inside *any* worktree of a registered project, `dirf state read-handoff`
  returns the same content as from the main tree. **The storytellers drift is
  structurally impossible.**
- `dirf state list` from any cwd shows all registered projects with
  `last_seen`.
- An existing target's `.dirf/` migrates on first resolve with a backup, never
  losing data; HANDOFF conflicts require explicit `import-handoff`.
- MCP `dirf_read_handoff` and `dirf state read-handoff` return byte-identical
  output.
- Zero dependencies preserved; `node src/cli.js validate` stays green.
