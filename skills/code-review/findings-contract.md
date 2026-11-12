# Findings contract

Create `review.json` with this shape:

```json
{
  "schema_version": 2,
  "target": {
    "repository": "https://github.com/owner/repository.git",
    "pr_number": 123,
    "base_sha": "40-character SHA",
    "head_sha": "40-character SHA",
    "mode": "full"
  },
  "walkthrough": [
    { "area": "persistence", "summary": "Adds an idempotent commit boundary", "files": ["src/store.js"] }
  ],
  "axes": {
    "spec": { "status": "checked", "evidence": "Matched issue acceptance criteria" },
    "correctness": { "status": "finding", "evidence": "P1-001" },
    "concurrency": { "status": "not_applicable", "evidence": "No shared mutable state changed" },
    "security": { "status": "checked", "evidence": "Authorization is enforced before the write" },
    "data": { "status": "checked", "evidence": "Migration and rollback path inspected" },
    "frontend": { "status": "not_applicable", "evidence": "No user interface changed" },
    "testing": { "status": "checked", "evidence": "Focused regression test reproduces the boundary" },
    "standards": { "status": "checked", "evidence": "Repository instructions applied" }
  },
  "confidence": { "quality": 92, "evidence": 88 },
  "findings": [
    {
      "id": "P1-001",
      "priority": "P1",
      "confidence": 94,
      "axis": "correctness",
      "title": "Retry discards the committed response",
      "file": "src/store.js",
      "line": 73,
      "body": "When the first write commits but its response is lost, the retry creates a second operation. The user sees duplicate output. Reuse the original idempotency key across transport retries.",
      "evidence": ["tests/store.test.js reproduces a lost response followed by retry"]
    }
  ],
  "verification": [
    { "command": "node --test tests/store.test.js", "status": "passed", "result": "12 tests passed" }
  ],
  "limitations": [],
  "completion": {
    "review_complete": true,
    "required_checks": "passed",
    "unresolved_threads": 0
  }
}
```

DIRF counts review rounds in its store, so `dirf review trigger` ignores
`target.round`. `target.max_rounds` is optional and replaces the default limit of
five rounds on the first review. The last round has no fix, so `max_rounds: N`
allows N-1 fixes. The first review after `reconsider_approach` must include
`target.approach_change`. See step 5 of `workflow.md`.

## Finding requirements

Every published finding must contain:

- a unique identifier and P0-P3 priority;
- confidence from 80 through 100;
- one applicable review axis;
- a concise imperative title;
- repository-relative file and tight start line;
- a body that connects trigger, path, wrong outcome, impact, and correction;
- at least one concrete evidence item.

Optional origin fields:

- `origin`: `introduced` (the default) or `pre_existing`.
- `base_evidence`: required when `origin` is `pre_existing`. State how you proved
  that the defect exists at `target.base_sha`, for example `git show BASE:path`
  or `git blame`.

A pre-existing P2 or P3 finding does not go to the fixer, does not count against
the round limit, and does not block `dirf review ready`. The ledger returns it in
`follow_up_findings`, and the rendered report lists it for follow-up. A
pre-existing P0 or P1 finding blocks like an introduced finding. Do not mark a
finding pre-existing to leave the loop. If you cannot prove the defect at the
base, do not set `origin`.

Priority meanings:

- P0: immediate catastrophic impact or broadly exploitable compromise; block all release activity.
- P1: high-impact correctness, security, data-loss, or availability defect; block merge.
- P2: real defect with bounded impact or an important missing failure-path guarantee; fix before release unless explicitly accepted.
- P3: low-impact but concrete defect; fix and verify before the PR-review loop is complete.

Confidence measures whether the specific finding is true, not how severe it would be. Do not inflate severity to compensate for weak evidence.

`quality` measures review completeness across the changed surface. `evidence` measures how much of the verdict is backed by executed or directly inspected proof. Both are independent of individual finding confidence.

The renderer derives the verdict; do not place a hand-authored verdict in the artifact.

The renderer also derives an A-F readiness grade and explicit P0-P3 counts for
the detailed report. Normal user updates should use ordinary language.

Before asking to merge, run `dirf review ready review.json`. Readiness requires
the live GitHub PR commit, the repository and review base to match the checkout, zero
findings, a completed review, every recorded verification and required check to
have passed, and zero unresolved review conversations. On an open PR, readiness
also requires a clean round ledger entry for the exact commit. Final merge readiness
requires a full review. Historical schema-v1 reports remain valid for reading
and rendering, but cannot authorize a merge.
