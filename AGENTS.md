# AGENTS.md — DIRF

DIRF (Do It Right First) is a zero-runtime-dependency Node.js project-settlement kit.

> **Using DIRF against a project** — read
> [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) instead. This file is for agents
> **contributing to the DIRF repo itself.**

## What this is

A zero-dependency Node.js kit that turns a task description into a lean,
token-cheap instruction set (markdown for the AI + an HTML render for humans),
with agents correctly mapped to the host repo's **actual installed skills**.

DIRF coordination state (config, attempts, the canonical handoff) lives in a
**central store** at `~/.dirf/projects/<slug>/`, keyed by
`git rev-parse --git-common-dir` so every worktree of a repo collapses to the
same store entry. State cannot drift between checkouts.

## Two governing principles

1. **Agnostic skill mapping.** Never hardcode skills. Scan the host repo's skill
   folders, index what's installed, resolve references. Referenced-but-absent =
   flagged "recommended, not installed" and is normally non-fatal. An explicitly
   requested human router is the exception: every model dependency it declares
   must resolve so DIRF never runs only part of that router's workflow.
2. **Lean output.** Smallest correct artifact first. A small
   always-loaded router + lazy-loaded detail one level deep. Unread files cost
   zero tokens. No monoliths, no prose padding.

## Quick start (developing DIRF)

```bash
node src/cli.js build demo "build a landing page"
node src/cli.js skills scan     # see installed skills + resolved refs
node src/cli.js validate        # validate registries + workflows
node --test                    # run the suite
```

## Where things live

- `src/state.js` — **the only module that reads/writes canonical state.** Slug
  derivation (the drift-killer), registry, handoff, attempts, migration, conflict
  contract. CLI + MCP are thin shells over this.
- `src/cli.js` — the entry point and command dispatcher.
- `src/project.js` — config validation + target-side scaffolding; `createAttempt`/
  `listAttempts`/`findAttempt` are thin delegates to `state.js`.
- `src/mcp.js` — optional stdio JSON-RPC MCP server over `state.js` (no SDK).
- `src/router.js`, `src/model-advice.js`, `src/skills.js`, `src/renderer.js`,
  `src/validate.js`, `src/paths.js` — routing, model advice, skill discovery,
  rendering, validation, and repository paths.
- `registry/` — agent and skill metadata plus the generated playbook compatibility export.
- `playbooks/*/README.md` — the authoritative playbook source.
- `agents/` — bundled default agent definitions, used only as fallbacks when the
  host has no matching installed agent (`discoverAgents` in `src/skills.js` casts
  roles installed-first).
- `policies/workflow-policy.md` — embedded in every generated instruction set.
- `~/.dirf/projects/<slug>/` — the central store (per-user, not committed):
  `config.json`, `HANDOFF.md`, `attempts/<id>/`.

## Conventions

- **Zero dependencies.** Pure Node.js built-ins (no `node_modules`, no install step).
- One entry point: `src/cli.js`.
- `src/state.js` is the single source of truth in code for canonical state — CLI
  and MCP delegate to it, never duplicate logic ("one core, two shells").
- Markdown is source; HTML is a regenerable render (gitignored).
- Migration of legacy per-target `.dirf/` into the store is **non-destructive**
  (backup at `.dirf.migrating.<ts>/` first); a local `HANDOFF.md` newer than the
  store's is never silently overwritten.
- Validate before you commit: `node src/cli.js validate`.
- Authoring guidance for playbooks and agents (descriptions as routing hints,
  checkable completion criteria, progressive disclosure):
  `docs/writing-great-playbooks.md`.

## Current architecture

- `docs/design/central-state.md`
- `docs/adr/0001-external-dirf-flow-board.md`
- `docs/writing-great-playbooks.md`
