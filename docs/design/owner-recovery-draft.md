# Durable attempt continuity with less ceremony

Task: 20260919T150624481Z-reconciliation-recovery.
Status: revised requirements from the owner; implementation pending.

This replaces the earlier recovery proposal. A separate approval service is not
required for continuity work. Existing authority checks remain intact while we
identify the smallest changes needed for user-directed continuation.

## Required behavior

- Reuse one durable attempt per feature across hosts, models, and restarts. Its
  small index links the specification, definition of done, capability selections,
  checklist, evidence, and exact next action.
- Persist acknowledged progress in an ordered recoverable log through the existing
  canonical writer. Completed steps require evidence. A crash cannot silently
  erase acknowledged work; unsaved work must be inspected, never invented.
- Resume recorded skill/library/model selections first. Compare current project
  and global inventory with deterministic precedence and tie-breaking. Report
  changed or missing capabilities; never silently substitute a different workflow.
- Give replacement children the relevant original contract and durable checkpoint.
  Persist child results through the parent, without creating an attempt per child.
- When starting new work, show a bounded summary of relevant open work and offer
  resume, a dependent attempt, or independent work. Multiple attempts are allowed.
  Check dependencies at start, resume, and integration rather than continuously
  reviewing every open task.
- Reuse existing valid checkouts. A distinct checkout uses a distinct branch and
  explicit base commit; record its parent attempt when dependent. Switching tasks
  never implicitly closes, deletes, resets, or abandons another task or worktree.
- Record reviewed-to-merged commit relationships separately. Notify affected
  dependent attempts when their base changes and revalidate relevant work while
  preserving completed steps and historical evidence. Branch isolation does not
  eliminate merge conflicts.
- Keep blocked work visible. No live process does not mean no unfinished work.
  Reject stale writes clearly and never report rejected progress as saved.

## Smallest implementation sequence

1. Map existing workflow/index, skill bindings, progress log, lock/recovery,
   child reports, and worktree links to these requirements; reproduce gaps first.
2. Repair crash/resume persistence and capability binding in the existing core.
3. Repair bounded open-work choices, dependent base tracking, and checkout reuse.
4. Repair merged-PR guidance without weakening stale-worker protection. Address
   lifecycle authority only where it prevents required user-directed continuation.
5. Verify interruption, duplicate reports, changed inventories, cross-host resume,
   concurrent attempts, base changes, and CLI/MCP consistency; run check:release.

## Acceptance scenario

Checkpoint feature A and a child result, terminate mid-step, then resume from
another host/model. Recover the same attempt, specification, capability bindings,
verified steps, and unfinished next step. Start B as independent or A-dependent
work without disturbing A. Integrate A: B retains its progress and receives the
relevant base-change information. No silent completion or needless worktree occurs.

## Runtime

DIRF already has zero runtime package dependencies. Bun is an optional measured
compatibility/performance experiment, not a prerequisite for continuity. Official
Bun 1.4 notes confirm a Rust rewrite and performance improvements, but acknowledge
incomplete Node compatibility: https://bun.sh/blog/bun-v1.4.
Verify DIRF Windows CLI, filesystem locking, child processes, MCP and tests before
proposing a migration. No runtime migration is approved or implemented here.

## Next action

Audit existing persistence and capability-binding paths against the acceptance
scenario and reproduce the smallest continuity gap before adding new machinery.
