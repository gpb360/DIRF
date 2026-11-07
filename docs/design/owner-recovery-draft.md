# Durable attempt continuity with less ceremony

Task: 20260919T150624481Z-reconciliation-recovery.
Status: partially implemented; two gaps remain open.

One durable attempt per feature survives hosts, models, and restarts. Its small
index links the specification, definition of done, capability selections,
evidence, and exact next action. Existing authority checks stay intact. Glossary
terms (Child Execution, Independent Attempt Boundary, Linked Worktree, Abandoned
Attempt) are defined in [CONTEXT.md](../../CONTEXT.md).

## Implemented on main

- Crash/resume recovery of acknowledged progress through the canonical writer:
  `203aa94`, `40233cf` (`tests/progress-interruption.test.js`).
- Saved skill bindings resumed before re-discovery: `6046cbc`
  (`tests/skill-bindings.test.js`).
- Stale writes rejected and never reported as saved: `ee1dc01` (#67).
- Merged-PR guidance replaces pre-merge next steps: `59ca393` (#83,
  `tests/merged-review-guidance.test.js`).

## Open gaps

1. **Dependent base tracking.** Record a dependent attempt's parent and explicit
   base commit. When the base changes, notify the dependent attempt and
   revalidate relevant work while keeping completed steps and evidence.
2. **Bounded open-work choice.** When new work starts, show a bounded summary of
   relevant open work and offer resume, a dependent attempt, or independent
   work. Check dependencies at start, resume, and integration only.

Switching tasks never implicitly closes, deletes, resets, or abandons another
task or worktree.

## Acceptance scenario

Checkpoint feature A, terminate mid-step, and resume from another host. Start B
as A-dependent work without disturbing A. Integrate A: B keeps its progress and
receives the base-change information.

## Next action

Reproduce gap 1 with a failing test before adding new machinery.
