# Sub-task claims: what DIRF's ownership contract would need inside one checkout

Task: 20261026T192859992Z-learn-source (source: microsoft/Agensh README).
Status: draft design note; no code changes; decision gate accepted 2026-10-26.

## Why this note exists

Agensh (microsoft/Agensh) coordinates 128–1,024 agents with *optimistic
claiming*: agents discover unclaimed sub-tasks, claim them, verify each other's
results, and merge progress asynchronously, with no central orchestrator. DIRF
coordinates agents the opposite way: one owner per checkout, a canonical
handoff, and deterministic evidence gates. Both solve "who is doing what, and
how do we trust the result". DIRF already runs attempts in parallel on one
project slug, one checkout and branch each. This note records what its contract
would need if two agents ever legitimately work in the same checkout or branch,
splitting one attempt's scope — not a plan to adopt
Agensh's infrastructure (Gitea/Mattermost/DeLM would violate the zero-runtime
dependency and lean-output principles).

## Current contract (observed, `src/state.js`)

- All worktrees of a repo collapse to one store entry via
  `git rev-parse --git-common-dir` (slug derivation).
- `claimAttemptCheckoutLocked` refuses a second in-progress attempt whose
  `responsibility_path` or `responsibility_branch` matches the same checkout or
  branch: `checkout is already governed by <id>`.
- `state active` reports idle / active / conflict from the same responsibility
  records; stale writes to a handoff owned elsewhere are rejected, not merged.
- Gates open on captured evidence (`--run` digests, typed artifacts with
  accepted content hashes); the `govern` ledger is hash-linked.

The unit of exclusivity is the **checkout**, and the trust anchor is
**captured evidence**. Attempts on the same slug already run in parallel when
each holds its own worktree and branch; claims are all-or-nothing only within a
checkout: one attempt owns the whole checkout and branch.

## What Agensh does differently (source claims, unverified)

- Sub-tasks are discovered and claimed individually, not per-checkout; workers
  proceed asynchronously and "merge progress" through shared infrastructure.
- Verification is peer-based: other workers check results before merge.
- Reported effect (project's own preprint, arXiv:2609.26781 — not verified
  here): pass rates rise with team size on long-horizon program-rebuild tasks.

## Minimum viable claim record (proposal)

If DIRF ever allows N attempts to share one checkout or branch, the smallest
addition that preserves gate integrity is a claim record on the attempt:

```json
{
  "claim_id": "sha256-prefix",
  "attempt_id": "...",
  "scope": "files-glob | phase-list | explicit-text",
  "claimed_at": "ISO-8601",
  "lease_expires_at": "ISO-8601",
  "state": "claimed | released | merged | expired"
}
```

Store-level rule changes implied by this schema:

1. `claimAttemptCheckoutLocked`'s conflict check gains a scope intersection
   test: two attempts conflict only when their scopes overlap, instead of the
   current path/branch match. Non-overlapping claims proceed.
2. Claim acquisition must be collision-free — the existing per-slug
   `withProgressLock` provides that if the check and write stay in one locked
   section (they do today for responsibility claims).
3. Lease expiry turns a crashed claimer's scope back to discoverable, without
   any live-process assumption: a missing live process does not mean the work
   is finished, so expired scope stays visible as unfinished work.
4. Gate evidence provenance must name the claiming attempt: a `--run` digest
   captured by attempt A cannot silently satisfy a gate inside B's scope.
   Evidence is already recorded per attempt (`recordedEvidence` reads the
   attempt record), so the requirement is to keep it there and bind each
   gate to the claim's scope, not to add a new store. This is the one place
   naive parallelism would weaken today's guarantees, so it is a hard
   requirement, not an option.

## Open questions (deliberately unresolved)

- Scope language: file globs are machine-checkable but brittle across
  refactors; phase-lists are stable but coarse. No recommendation yet.
- Merge verification: DIRF gates are deterministic; Agensh's are peer-based.
  Whether peer review records can be typed artifacts (and thus gate inputs)
  without dragging in a messaging substrate.
- Whether same-checkout parallelism is ever wanted, or whether the
  worktree-per-attempt model — already DIRF's slug-level parallelism — plus
  `state active` conflict reporting is the right answer at DIRF's actual
  scale. Deferring is defensible.

## Disposition of material Agensh ideas

| Idea | Disposition |
| --- | --- |
| Claim-based sub-task discovery | adapt — schema above, deferred until a real need appears |
| Peer verification before merge | defer — conflicts with deterministic-evidence gates |
| Gitea/Mattermost/DeLM infrastructure | reject — zero-dependency and lean-output principles |
| Emergent roles at scale | reject for DIRF — roles stay explicit in agent definitions |

## Verification check for this note

The "Current contract" section was checked by hand against `src/state.js` at
`29fea1e`. Nothing tests this note, so re-check it against the code before
relying on it. `node src/cli.js validate && node --test` passing only shows the
note broke nothing.
