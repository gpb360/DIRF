---
name: pr-review-quadrupedal
kind: workflow
description: "Review the quadrupedal animal pose + compact warning symbols fix (commit f1189114) using the multi-agent consensus DAG"
uses: ["../fullstack-feature"]
details: []
inputs: ["commit f1189114", "branch fix/quadrupedal-pose-and-warning-symbols", "diff vs origin/staging"]
outputs: ["pr-review/f1189114-intake.md", "pr-review/f1189114-agent{1,2,3}-review.md", "pr-review/f1189114-consensus.md"]
capabilities: ["code review", "visual conformance", "regression triage"]
---

# PR Review — Quadrupedal Pose + Compact Warning Symbols

Review commit `f1189114` on branch `fix/quadrupedal-pose-and-warning-symbols`
against the approved design tokens, AGENTS.md color rules, and the existing
cast/props UI patterns.

## Scope (from `git show --stat f1189114`)

5 files changed, 175 insertions, 21 deletions:

- `components/.../CharacterPortraitGenerator.tsx` (+55/-?, warning symbol + pose-aware rendering)
- `components/.../CharacterPortraitGenerator.test.tsx` (+66/-?, new tests)
- `components/.../PropAssetManager/PropAssetManager.tsx` (+14/-?, warning symbol)
- `components/.../PropSlideOutPanel/PropSlideOutPanel.tsx` (+7/-?, error display)
- `services/characterReferenceEnforcement.ts` (+54/-?, quadruped pose detection)

## Phases (follow `pr-review-consensus`)

1. **Intake** — extract the diff and write
   `pr-review/f1189114-intake.md`.
2. **Multi-agent review** — three independent passes:
   - **Agent 1 — Code Quality**: pose detection logic, test coverage,
     naming, regressions against existing portrait flow.
   - **Agent 2 — Functional/UX**: warning-symbol visibility, accessibility
     (color-only signals are a fail), placement inside portrait cards,
     copy that was removed (was it verbose in a way users relied on?).
   - **Agent 3 — Design Conformance**: every new color must come from the
     hex table in AGENTS.md (no `bg-purple-*`, `text-white`, etc.); status
     chip pattern reuse; typography weight.
3. **Consensus** — aggregate into
   `pr-review/f1189114-consensus.md` with a 0–100 confidence score and the
   standard blocking / confidence / nit classification.
4. **Fix loop** — only if blocking issues surface. The commit already
   carries tests; small fixes should land on the same branch.
5. **Re-verify + final approval** — re-run agents 1–3 on the delta and
   record `pr-review/f1189114-final-approval.md`.

## Acceptance gate

- ✅ Aggregate confidence ≥ 90
- ✅ Zero blocking issues
- ✅ Tests pass (`npm run test -- components/.../CharacterPortraitGenerator.test.tsx`)
- ✅ No raw hex outside the AGENTS.md table
- ✅ Warning symbols are not color-only (icon + color, with text fallback)

## Handoff

The DIRF DAG resolves `fullstack-feature` as the upstream playbook, which
already chains `rtk` → `minimal-implementation` → `fullstack-feature`
playbook → this workflow. Run:

```bash
node ../amf-dirf/src/cli.js run ../amf-dirf/workflows/pr-review-quadrupedal
```

(`dirf run` does not accept `--slug`; the path is the only argument.
`--slug` belongs to `dirf state` subcommands.)