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

1. Freeze the review target: record repository, base SHA, head SHA, review mode, and the applicable repository instructions. Completion: the artifact identifies one immutable head and the base used for its three-dot diff.
2. Read the whole change before commenting. Include PR intent, changed files, relevant call sites, migrations, tests, and prior review comments. Completion: `walkthrough` names every changed subsystem and its behavior change.
3. Review independently across the axes in [review-axes.md](review-axes.md). Trace data and control flow beyond edited lines when a changed contract has callers or persistence effects. Completion: every applicable axis is marked `checked`, `finding`, or `not_applicable` with evidence.
4. Prove each finding. State the triggering input or state, execution path, wrong outcome, user or system impact, and the smallest source-level correction. Completion: every published finding meets [findings-contract.md](findings-contract.md) and has confidence of at least 80.
5. Verify proportionally. Run the narrowest relevant tests and static checks; add database, browser, concurrency, or security proof when the change crosses those boundaries. Completion: each command and outcome is recorded, including blockers and unrun checks.
6. Write `review.json`, validate it, then render the human review:
   - `node skills/code-review/scripts/review-report.mjs validate review.json`
   - `node skills/code-review/scripts/review-report.mjs render review.json`
   Completion: validation exits zero and the rendered verdict agrees with the findings and confidence gates.
7. Before posting, confirm the PR head still equals `head_sha` and search existing review markers for the same head. Completion: stale-head and duplicate reviews are not posted.

## Decision rules

- `FAIL`: at least one P0 or P1 finding.
- `CONDITIONAL`: at least one P2 or P3 finding, or review quality/evidence confidence is below the PASS threshold.
- `PASS`: no actionable findings, quality confidence is at least 85, and evidence confidence is at least 80.
- A clean review with blocked or insufficient verification is `CONDITIONAL`, never `PASS`.
- Low-confidence concerns are recorded as limitations or follow-up questions, not inline accusations.
- Style preferences, speculative risks without a reachable failure path, and issues outside the changed behavior are not findings.

Use incremental mode only for commits newer than the last reviewed head. Re-run full mode after force-pushes, base changes, cross-cutting contract changes, or when the previous review artifact cannot be trusted.
