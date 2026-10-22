---
name: dirf
description: Bootstrap DIRF-governed work. Run at session start in any repo, or when the user says "DIRF next" — resolve checkout ownership with `dirf state active`, read the canonical handoff, resume or build attempts. Never read or write .dirf/ directly.
---

# DIRF bootstrap

DIRF (Do It Right First) keeps canonical coordination state in a central store at `~/.dirf/projects/<slug>/`, keyed by the repo's git common dir, so every worktree shares one store. A `.dirf/` folder inside the repo is legacy/inert — never read or write it.

If `dirf` is not on PATH, use `node <path-to-dirf>/src/cli.js` with the same arguments.

## Session start (every repo, every session)

1. Run `dirf state active`. **Active**: reuse the reported attempt — load its workflow and handoff paths only when their details are not already in context. **Idle**: route new work with `dirf build <name> "<task>"`. **Conflict**: stop and ask which attempt owns the checkout; never pick the latest.
2. `dirf state which` — slug, store path, branch (diagnosis only).
3. `dirf show me the handoff` — the canonical project handoff.
4. `dirf resume <name-or-id>` — print that attempt's workflow + handoff and continue from its exact next action.

## While working

- `dirf attempt advance <id> --evidence "what you ran"` — one phase at a time; `--auto` stops at gates.
- Decision gates: `dirf attempt gate <id> <phase> accept|deny --comment "..."` — stop and ask the user; never bypass.
- `dirf record-progress "<msg>" --attempt <id> --phase P --next "exact next action"`.
- Before ending the session: `dirf save the handoff --file h.md` with result, evidence, decisions, blockers, and exactly one next action.
