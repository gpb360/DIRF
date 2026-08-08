# Changelog

All notable changes to DIRF are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) —
currently pre-1.0 (`0.x`), so anything may change between releases.

## Unreleased

## [0.26.0] — 2026-08-08

### Added
- **Workflow gates.** Playbooks declare `config.workflow.gates` (`verify` /
  `decision` / `soft`). `dirf attempt advance` enforces them — verify gates
  need recorded evidence, decision gates need an accepted record (deny
  requires a comment), `--strict` promotes soft gates; `advance --auto`
  crosses covered phases and stops at gates; `block --wait input|blocker`;
  `resume` reconciles pending gates and replays recorded evidence.
- **Skill-ecosystem awareness.** Discovery indexes invocation class
  (`disable-model-invocation`), progressive-disclosure files, backticked
  `/skill` references, and body size. `skills scan` gained an invocation
  summary, a reference graph (referenced-but-absent resolved), spec-level
  quality warnings, and a token budget with the ~32–36 routing ceiling.
  **User-invoked skills are excluded from autonomous routing** (their
  descriptions are human-facing by design; fallback when every candidate is
  user-invoked).
- **Policy clauses** embedded in every instruction set: Verification
  Contract, Decision Ownership, Handoff-Before-Switch.
- **`docs/writing-great-playbooks.md`** — authoring guidance for playbooks
  and agents.
- **Research reports** in `docs/research/`; the `research` playbook now
  requires typed-source tracing and decision restatement.
- **Bundled-skill lint in `dirf validate`** — dogfoods the authoring
  guidance on the kit itself.

### Changed
- **`dirf state which` reports the current branch** (or `(detached HEAD)`) —
  closes the 0.25.0 known limitation.
- **README onboarding is now written for first-time users**: what DIRF is, how
  it helps, what it is not, installation, host-agnostic routing, and the small
  additive footprint it places in an existing project.

### Fixed
- **Canonical store paths now reject traversal segments**, CLI and MCP slug
  lookups require registered projects, and explicit observation targets must
  resolve to a real attempt.
- **Observation entries are single-line records**, preventing embedded newlines
  from forging additional numbered entries.
- **Release version drift** between `package.json`, `package-lock.json`, and the
  MCP handshake is removed; the MCP server now reads the package version.
- Review-gate tests locate Git for Windows' bundled shell instead of assuming
  `sh` is globally available.
- The smoke runner keeps the repository root as its working directory while
  limiting test discovery to `tests/`, so CLI paths resolve consistently.
- Non-Git project probes no longer leak Git's fatal diagnostics before DIRF's
  own clean setup guidance.
- `advance --auto --evidence` silently dropped the evidence flag (now
  recorded for the first leaving phase).
- Attempt projections were O(N²) reads per list (now one workflow read per
  attempt).
- `body_lines`/`body_chars` measured the full file including frontmatter
  (now body-only); a co-located `README.md` was listed as a disclosure next
  to `SKILL.md` (now excluded).

## [0.25.0] — 2026-07-27

First tagged release. DIRF is a zero-runtime-dependency Node kit that turns a
task description into a lean, token-cheap instruction set for AI coding
agents, with agents/skills mapped to the host repo's actual installed set.

This release ships the **canonical-state** architecture — DIRF coordination
state (config, attempts, the handoff) now lives in a central store keyed by
`git rev-parse --git-common-dir`, so every worktree of a repo resolves to one
store entry and state can no longer drift between checkouts.

### Added — Canonical state (central store)
- **Central store** at `~/.dirf/projects/<slug>/` holding config, attempts, and
  the canonical project handoff. Slug derived from `git rev-parse
  --git-common-dir`, deterministically normalized (case-folded, forward-slash,
  symlink-resolved) so path/separator/case variants of the same repo collapse
  to one entry. Atomic writes (temp + rename) for crash-safety under concurrent
  agents. (`src/state.js`)
- **`dirf state` command group**: `which`, `list`, `register`, `read-handoff`,
  `write-handoff`, `list-attempts`, `get-attempt`, `import-handoff`,
  `migrate-cleanup`. (`src/cli.js`)
- **`dirf notice` — non-derailing side observations.** A channel for anything
  noticed mid-attempt that is NOT the current task (a side bug, a doc
  staleness, a "fix later"). Append-only per-attempt `OBSERVATIONS.md`,
  promotable to project-level so an entry survives across sessions. Prevents
  the "narrated drift" pattern where side observations pollute the status
  handoff. (`src/state.js`, `src/cli.js`, `policies/workflow-policy.md`)
- **Optional MCP server** (`src/mcp.js`) — hand-rolled stdio JSON-RPC, no SDK.
  Exposes `dirf_resolve_project`, `dirf_list_projects`, `dirf_read_handoff`,
  `dirf_write_handoff`, `dirf_list_attempts`, `dirf_get_attempt` as tools over
  the same `state.js` core as the CLI. Verified byte-identical output.
- **Plain-language command aliases**: `dirf where am i`, `show me the handoff`,
  `start work on "<task>"`, `save the handoff --file F`, etc. Sugar over the
  canonical commands; both forms always work.
- **Agent guide** (`docs/AGENT_GUIDE.md`) — agent-facing usage: always go
  through `dirf state`, never read `.dirf/` directly; the orient → build →
  execute → write-handoff session lifecycle; worktree resolution; conflict
  handling; anti-patterns.
- **Compaction policy** (verbatim-line selection) and **per-step output
  contracts** on skill_flow steps, both rendered into generated workflows.
- **`dirf status`** and **`dirf plan`** lifecycle commands (from merged remote
  work).
- **TypeScript Stage 0 scaffolding**: `typescript` devDep, `tsconfig.json`
  (strict, nodenext, allowJs during staged migration, noEmit — Node 22 strips
  types at runtime), `npm run typecheck`. No code converted yet; foundation
  for the staged JS→TS conversion.

### Changed
- **Config moved from per-target `.dirf/config.json` to the central store**;
  schema bumped to v2 (drops `attempt_root`, adds `slug`). `dirf setup`
  migrates a legacy `.dirf/` into the store (config upgrade + attempts + handoff
  move) in one step.
- **Engines requirement bumped: Node ≥18.17 → ≥22** (for native TypeScript
  type stripping during the staged conversion).
- **Worktree-advisory prose** in `renderer.js`, `workflow-policy.md`, and
  `README.md` updated to reflect the central-store model.
- `.gitignore` hardened: `.dirf/`, `.dirf.migrating.*/`, `.zcode/` now ignored
  at repo root (previously only `.dirf/attempts/`).

### Fixed
- **Worktree drift**: the motivating bug. A git worktree read a stale
  per-checkout `HANDOFF.md` because `.dirf/` was untracked and per-checkout.
  Resolved structurally — identity via `git-common-dir` collapses all
  worktrees of a repo to one store entry, so there is no local state to drift.
- **Cross-volume migration (EXDEV)**: `renameSync` across drives (e.g. project
  on `E:`, store on `C:`) threw `EXDEV`. Fixed via `moveAcrossVolumes`
  (copy-then-delete) for attempt-directory migration.
- **`dirf flow` / `dirf create` routing divergence**: `cmdFlow` passed `null`
  to `assembleTaskRouting` while `create`/`build` passed `projectRoot(args.path)`,
  so the same task routed differently. `cmdFlow` now resolves cwd the same way
  every other command does.
- **`dirf setup` now migrates legacy content** (was registering + writing config
  but leaving HANDOFF/attempts stranded, because the "already registered" guard
  in `migrateProject` made migration unreachable after setup registered).

### Known limitations (pre-1.0)
- **TypeScript conversion is mid-flight** (Stage 0 only). Source is still `.js`;
  types are scaffolded but not yet applied. The `buildPlan` signature (the
  class of bug that motivated the conversion) is still untyped. See
  `docs/superpowers/specs/2026-07-27-typescript-conversion-design.md`.
- **`dirf flow`/`create` regression test is a contract guard, not a
  reproduction**: the routing divergence only manifests on a genuinely
  fact-heavy repo (real branch + many changes + planning state) and could not
  be reproduced in a synthetic fixture. The test locks in the "flow no-path
  agrees with flow --path" contract; the fix is provably correct by code
  inspection.
- **`dirf state which` does not report the git branch** — load-bearing for
  resuming work across sessions. Logged as a project observation.
- **MCP tools don't expose `dirf notice`** in this release (CLI only).
- **No `dirf state` delete/prune** — stale project entries (e.g. a deleted
  repo's) linger in the registry until manually edited.

### Merged remote work
This release incorporates four commits that landed on `origin/main` during
development: `#8` ui-ux acceptance matrix, `#9` focused workflow output,
`#10` `dirf status` command, `#11` `dirf plan` lifecycle. Reconciled with the
canonical-state work (combined `buildPlan` signatures, unioned parse flags,
merged playbook `skill_flow` as their stages + per-step output contracts).
