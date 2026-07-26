# AGENTS.md — amf-dirf

Agent Spec Kit. **AMF** = Agent Marketing Factory · **DIRF** = Do It Right First.

> **Using DIRF against a project** — read
> [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) instead. This file is for agents
> **contributing to the amf-dirf repo itself.**

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
   flagged "recommended, not installed" — never fatal.
2. **Ponytail-lean output.** Smallest correct artifact first. A small
   always-loaded router + lazy-loaded detail one level deep. Unread files cost
   zero tokens. No monoliths, no prose padding.

## Quick start (developing DIRF)

```bash
node src/cli.js build demo "build a landing page"
node src/cli.js skills scan     # see installed skills + resolved refs
node src/cli.js validate        # validate registries + workflows
node --test                    # run the suite (123 tests)
```

## Where things live

- `src/state.js` — **the only module that reads/writes canonical state.** Slug
  derivation (the drift-killer), registry, handoff, attempts, migration, conflict
  contract. CLI + MCP are thin shells over this.
- `src/cli.js` — the entry point and command dispatcher.
- `src/project.js` — config validation + target-side scaffolding; `createAttempt`/
  `listAttempts`/`findAttempt` are thin delegates to `state.js`.
- `src/mcp.js` — optional stdio JSON-RPC MCP server over `state.js` (no SDK).
- `src/router.js`, `src/skills.js`, `src/renderer.js`, `src/validate.js`,
  `src/paths.js` — routing, skill discovery, rendering, validation, repo paths.
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

## Specs + plans

Design and implementation history for the canonical-state work:

- `docs/superpowers/specs/2026-07-25-dirf-canonical-state-design.md`
- `docs/superpowers/plans/2026-07-25-dirf-canonical-state.md`


<claude-mem-context>
# Memory Context

# [amf-dirf] recent context, 2026-07-23 11:23pm EDT

No previous sessions found.
</claude-mem-context>
