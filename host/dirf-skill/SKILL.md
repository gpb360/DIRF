---
name: dirf
description: Bootstrap DIRF-governed work. Run at session start in any repo, or when the user says "DIRF next" — resolve checkout ownership with `dirf state active`, read the canonical handoff, resume or build attempts. Never read or write .dirf/ directly.
---

# DIRF bootstrap

DIRF (Do It Right First) keeps canonical coordination state in a central store at `~/.dirf/projects/<slug>/`. The repo's git common dir is the key, so every worktree shares one store. A `.dirf/` folder inside the repo is legacy/inert — never read or write it.

If `dirf` is not on PATH, use `node <path-to-dirf>/src/cli.js` with the same arguments.

## Session start (every repo, every session)

1. Run `dirf state active`. **Active**: reuse the reported attempt — load its workflow and handoff paths only when their details are not already in context. **Idle**: route new work with `dirf build <name> "<task>"`. **Conflict**: stop and ask which attempt owns the checkout. Never pick the latest.

Normal startup ends with `state active`. Follow its exact next action. Load only that attempt's workflow and checkout-scoped handoff when needed. Use `state which`, project handoffs and attempt listings only for explicit diagnosis or recovery. Use `resume` only to claim a named planned attempt, not to rediscover active work.

## While working

- `dirf attempt advance <id> --evidence "what you ran"` — one phase at a time; `--auto` stops at gates.
- Decision gates: `dirf attempt gate <id> <phase> accept|deny --comment "..."` — stop and ask the user; never bypass.
- `dirf record-progress "<msg>" --attempt <id> --phase P --next "exact next action"`.
- Before ending the session: `dirf save the handoff --file h.md` with result, evidence, decisions, blockers, and exactly one next action.
