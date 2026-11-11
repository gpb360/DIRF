---
name: code-review
kind: skill
description: "Review pull requests and diffs for provable bugs, regressions, security risks, and missing tests with exact-head evidence and confidence-scored comments"
uses: []
details: ["workflow.md", "findings-contract.md", "review-axes.md"]
inputs: ["pull request, branch, commit range, or diff", "repository instructions and requested behavior"]
outputs: ["confidence-scored findings", "PASS, CONDITIONAL, or FAIL gate", "machine-checkable review artifact"]
capabilities: ["code review"]
---

# Code review

Produce a review another maintainer can act on without reconstructing your reasoning.

For an explicitly read-only audit, record the repository revision and requested
scope, inspect behavior, prove findings, and deliver a report with limitations
and suggested corrections. Do not implement repairs. A system audit does not
need a PR number, a PR-shaped review artifact, or merge readiness. Unresolved
findings do not prevent completion of that report. The contract below applies
to PR work; its repair loop runs only when implementation is within scope.

## Contract

1. Freeze the review target. Record the canonical repository URL, GitHub PR number, base SHA, head SHA, review mode, and the applicable repository instructions. Completion: the artifact identifies one immutable head and the current base used for its three-dot diff.
2. Read the whole change before commenting. Include PR intent, changed files, relevant call sites, migrations, tests, and prior review comments. Completion: `walkthrough` names every changed subsystem and its behavior change.
3. Review independently across the axes in [review-axes.md](review-axes.md). Trace data and control flow beyond edited lines when a changed contract has callers or persistence effects. Completion: the artifact marks every applicable axis `checked`, `finding`, or `not_applicable` with evidence.
4. Prove each finding. State the triggering input or state, execution path, wrong outcome, user or system impact, and the smallest source-level correction. Completion: every published finding meets [findings-contract.md](findings-contract.md) and has confidence of at least 80.
5. Verify proportionally. Run the narrowest relevant tests and static checks. When the change crosses a database, browser, concurrency, or security boundary, add proof for that boundary. Completion: each command has a structured passed, pending, or failed status plus its outcome, including blockers and unrun checks.
6. Write `review.json`. Validate it. Render the human review:
   - `dirf review validate review.json`
   - `dirf review render review.json`
   Completion: validation exits zero and the rendered verdict agrees with the findings and confidence gates.
7. Before posting, confirm the PR head still equals `head_sha`. Search existing review markers for the same head. After a merge-commit merge, `ready` requires two proofs. GitHub CLI must confirm the exact merged head, base, and merge commit. Git must show the commit on the live base branch. Completion: you post no stale-head or duplicate review. You verify a merged PR without its removed temporary merge ref.
8. When a P0, P1, P2, or P3 finding exists, follow the Review Ladder in the workflow policy: at most four reviews and one fix. Change the approach when `dirf review trigger` returns `reconsider_approach`. Stop the fixes when it returns `stop_for_person` (see step 5 of `workflow.md`). Verify the affected behavior. Do a fresh review of the updated PR. Record whether the review is complete, required checks passed, and review conversations remain. Completion: `dirf review ready review.json` exits successfully.

## Decision rules

- `FAIL`: at least one P0 or P1 finding.
- `CONDITIONAL`: at least one P2 or P3 finding, or review quality/evidence confidence is below the PASS threshold.
- `PASS`: no actionable findings, quality confidence is at least 85, and evidence confidence is at least 80.
- `Grade A`: PASS with quality and evidence confidence both at least 90.
- `Grade B`: PASS at the minimum confidence thresholds.
- `Grade C`: P3 findings, limitations, or insufficient confidence; not done.
- `Grade D`: at least one P2 finding; not done.
- `Grade F`: at least one P0 or P1 finding; not done.
- A clean review with blocked or insufficient verification is `CONDITIONAL`, never `PASS`.
- Record low-confidence concerns as limitations or follow-up questions, not inline accusations.
- Style preferences, speculative risks without a reachable failure path, and issues outside the changed behavior are not findings.
- A dismissed false positive is not a finding. Do not waive a retained finding to manufacture PASS. Fix it and review the new head again.

Use incremental mode only for commits newer than the last reviewed head. Re-run full mode after a force-push, a base change, or a cross-cutting contract change. Also re-run it when you cannot trust the previous review artifact. Always re-run it before you ask for merge approval.
