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

## Contract

1. Freeze the review target: record the canonical repository URL, GitHub PR number, base SHA, head SHA, review mode, and the applicable repository instructions. Completion: the artifact identifies one immutable head and the current base used for its three-dot diff.
2. Read the whole change before commenting. Include PR intent, changed files, relevant call sites, migrations, tests, and prior review comments. Completion: `walkthrough` names every changed subsystem and its behavior change.
3. Review independently across the axes in [review-axes.md](review-axes.md). Trace data and control flow beyond edited lines when a changed contract has callers or persistence effects. Completion: every applicable axis is marked `checked`, `finding`, or `not_applicable` with evidence.
4. Prove each finding. State the triggering input or state, execution path, wrong outcome, user or system impact, and the smallest source-level correction. Completion: every published finding meets [findings-contract.md](findings-contract.md) and has confidence of at least 80.
5. Verify proportionally. Run the narrowest relevant tests and static checks; add database, browser, concurrency, or security proof when the change crosses those boundaries. Completion: each command has a structured passed, pending, or failed status plus its outcome, including blockers and unrun checks.
6. Write `review.json`, validate it, then render the human review:
   - `dirf review validate review.json`
   - `dirf review render review.json`
   Completion: validation exits zero and the rendered verdict agrees with the findings and confidence gates.
7. Before posting, confirm the PR head still equals `head_sha` and search existing review markers for the same head. After a merge-commit merge, `ready` requires GitHub CLI confirmation of the exact merged head, base, and merge commit plus Git proof that the commit is present on the live base branch. Completion: stale-head and duplicate reviews are not posted, and a merged PR is verified without relying on its removed temporary merge ref.
8. When any P0, P1, P2, or P3 finding exists, fix it, verify the affected behavior, and perform a fresh review of the updated PR. Record whether the review is complete, required checks passed, and review conversations remain. Completion: `dirf review ready review.json` exits successfully.

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
- Low-confidence concerns are recorded as limitations or follow-up questions, not inline accusations.
- Style preferences, speculative risks without a reachable failure path, and issues outside the changed behavior are not findings.
- A dismissed false positive is not a finding. A retained finding cannot be waived to manufacture PASS; it must be fixed and the new head re-reviewed.

Use incremental mode only for commits newer than the last reviewed head. Re-run full mode after force-pushes, base changes, cross-cutting contract changes, when the previous review artifact cannot be trusted, and always before asking for merge approval.
