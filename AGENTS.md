# AGENTS.md — amf-dirf

Agent Spec Kit. **AMF** = Agent Marketing Factory · **DIRF** = Do It Right First.

## What this is

A zero-dependency Node.js kit that turns a task description into a lean,
token-cheap instruction set (markdown for the AI + an HTML render for humans),
with agents correctly mapped to the host repo's **actual installed skills**.

## Two governing principles

1. **Agnostic skill mapping.** Never hardcode skills. Scan the host repo's skill
   folders, index what's installed, resolve references. Referenced-but-absent =
   flagged "recommended, not installed" — never fatal.
2. **Ponytail-lean output.** Smallest correct artifact first. A small
   always-loaded router + lazy-loaded detail one level deep. Unread files cost
   zero tokens. No monoliths, no prose padding.

## Quick start

```bash
node src/cli.js build demo "build a landing page"
node src/cli.js skills scan     # see installed skills + resolved refs
node src/cli.js validate        # validate registries + workflows
```

## Where things live

- `registry/` — agent and skill metadata plus the generated playbook compatibility export.
- `playbooks/*/README.md` — the authoritative playbook source.
- `agents/` — bundled default agent definitions, used only as fallbacks when the host has no matching installed agent (`discoverAgents` in `src/skills.js` casts roles installed-first).
- `policies/workflow-policy.md` — embedded in every generated instruction set.
- `src/` — `cli.js` (entry), `router.js`, `skills.js`, `renderer.js`, `validate.js`, `paths.js`.
- `.dirf/attempts/` — disposable generated runs in each configured target (ignored).

## Conventions

- **Zero dependencies.** Pure Node.js built-ins (no `node_modules`, no install step).
- One entry point: `src/cli.js`.
- Markdown is source; HTML is a regenerable render (gitignored).
- Validate before you commit: `node src/cli.js validate`.


<claude-mem-context>
# Memory Context

# [amf-dirf] recent context, 2026-07-23 11:23pm EDT

No previous sessions found.
</claude-mem-context>
