# Design: central DIRF state

> Status: **implemented.** All seven rollout stages have landed. Canonical state
> lives in `~/.dirf/projects/<slug>/`; `config.json`, `HANDOFF.md`, and
> `attempts/` are read and written there, and `project.js` delegates to
> `state.js` rather than touching per-target files. The drift this design set
> out to kill is gone.
>
> Two deviations from the design as written, both worth knowing:
>
> - **The `slug.json` pointer was never built.** `grep slug.json src/` finds
>   nothing. Resolution recomputes the slug from `git rev-parse --git-common-dir`
>   on every call instead of caching it in the checkout. Same guarantee, one
>   fewer file to keep in sync — the design's pointer is arguably YAGNI.
> - **Checkouts can still carry a leftover `.dirf/`.** Post-migration it holds a
>   `schema_version: 1` `config.json` and an empty `attempts/`, neither of which
>   is read — `loadProjectConfig` resolves to the store and rejects any schema
>   other than 2. Note that `.dirf/` is *not* fully dead: `src/skills.js:314`
>   still reads a per-project `.dirf/trusted-sources.json`, so the directory has
>   a live role beyond this design. Removing the stale `config.json` and empty
>   `attempts/` is manual; `dirf state migrate-cleanup` does **not** do it — that
>   command only deletes `.dirf.migrating.<ts>/` backups left by migration.

## Problem

DIRF state (`.dirf/`) is created per-target and gitignored. Worktrees get
independent copies that drift from the main tree. The concrete failure that
motivated this design: a stale-worktree bug in another project, where Codex
read a worktree-local `HANDOFF.md` that never received the user's rewrite.

The user's framing: *"All three — it's one problem."* Canonical state, central
registry, and agent-accessible state are facets of one solution, not three
features.

## Chosen architecture: Option A — central store + CLI core + optional MCP wrapper

### Store topology

- `~/.dirf/projects/<slug>/` holds canonical `config.json`, `HANDOFF.md`,
  `execution-authority.json`, and `attempts/`. The authority record contains
  only the trusted harness capability hash. This extends the existing
  `~/.dirf/` home-dir precedent already
  used by `loadTrustedSources` (`src/skills.js`).
- `~/.dirf/projects.json` — the registry of known projects.
- Target checkouts keep **zero DIRF state** except a ~50-byte
  `.dirf/slug.json` pointer.
- **No `.dirf/` state in worktrees at all.** Drift becomes impossible because
  there is nothing local to drift — every worktree resolves to the same slug
  and reads from the same central store.

### Project identity (the drift-killer)

- Git repos: slug derived from `git rev-parse --git-common-dir` → the main tree
  and all its worktrees resolve to the **same** slug.
- Non-git: slug from the absolute path hash.
- Format: `<basename>-<hash8>` (e.g. `myproject-a1b2c3d4`).

### New module: `src/state.js`

The **only** code that reads or writes canonical state. Both the CLI and any
MCP wrapper are thin shells over it. Core API:

- `registerProject`
- `resolveProject`
- `get`
- `listProjects`
- `readHandoff`
- `writeHandoff`
- `listAttempts`
- `getAttempt`

### Access surfaces

- **CLI:** a new `dirf state` command group — `which`, `list`, `register`,
  `read-handoff`, `write-handoff`, `list-attempts`, `get-attempt`.
- **MCP:** `src/mcp.js` — pure stdio JSON-RPC, **no SDK, zero-dependency**
  (same constraint as the rest of the kit), exposing the same operations as
  tools. This is what makes state *agent-accessible* without coupling DIRF to a
  host.

### Worktree decision: Option X — passive resolver only

DIRF **detects** worktrees and resolves through them, but does not **manage**
them. No `dirf worktree` command, no worktree inventory. True YAGNI —
`src/inspect.js`'s `detectWorktrees` (read-only diagnostics) stays as-is.

### Migration

Lazy, non-destructive, on first resolve. Existing per-target `.dirf/` state is
backed up to `.dirf.migrating.<timestamp>/` and then promoted into the central
store. **Registry wins on conflict; never silent overwrite.**

## Rollout staging

Seven stages, each independently testable. Do not collapse them.

Status as of the last audit of `src/` — verified against the code, not assumed:

1. ✅ `src/state.js` + store layout
2. ✅ Resolution + registry (slug derivation, `resolveProject`, `registerProject`)
3. ✅ Rewire existing commands — done inside `project.js`, not `cli.js`:
   `createAttempt`/`listAttempts`/`findAttempt`/`loadProjectConfig` are thin
   wrappers over `createAttemptInStore`/`listAttemptsInStore`/`getAttemptInStore`
   and `storeProjectDir`. `cli.js` still imports them from `project.js`, so the
   rewire is invisible at the call sites
4. ✅ `dirf state` CLI command group — `which`, `list`, `register`,
   `read-handoff`, `write-handoff`, `list-attempts`, `get-attempt`, plus
   `import-handoff` and `migrate-cleanup` beyond the original design
5. ✅ Migration (lazy on-first-resolve; `migrateLegacyContent` in `project.js`)
6. ✅ `src/mcp.js`
7. ✅ Prose updates — `src/renderer.js:271,521` and `README.md:30,82,120,136`
   all describe the central store

Also built but **not** part of this design: an observations layer
(`appendObservation`/`listObservations`/`promoteObservation`, `OBSERVATIONS.md`
in the store). It postdates this doc and has no design section here.

## Explicit non-goals

- No worktree management (Option X).
- No telemetry.
- No multi-user / sync.
- No attempt versioning.
- No rewrite of the bundled `registry/` meaning.

## Code locations this will change

| File | Current responsibility | What changes |
|------|------------------------|--------------|
| `src/project.js` | Creates per-target `.dirf/` (`setupProject`, `createAttempt`) | Becomes a thin caller of `src/state.js`; canonical state moves out |
| `src/cli.js` | `savePlan`, `buildInstructions` routing | Rewired through `state.js` |
| `src/renderer.js:228,460` | Stale worktree advisory prose | Updated to reflect central resolution |
| `src/inspect.js:158-171` | `detectWorktrees` (read-only) | Stays as-is |
| `README.md:180` | Worktree prose | Updated |

## Relationship to in-flight work

The compaction directive + per-step output contracts (added in a separate
effort, same working tree) are **compatible** with this design and carry
through unchanged:

- The `normalizeCompaction` helper in `src/project.js` is a pure function over
  the config object — it works identically whether config is read from a
  per-target file or resolved centrally via `state.js`.
- The `compaction` and per-step `output` fields on the snapshot are plain data;
  they persist and render the same way under either state model.
- **Interaction to watch at implementation time:** stage 3 (rewire commands)
  will rewrite `loadProjectConfig`, which is where compaction validation lives.
  The compaction validation logic should move with the config-reading
  responsibility into `state.js` (or be invoked from there), not be duplicated.
