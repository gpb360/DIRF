# Findings contract

Create `review.json` with this shape:

```json
{
  "schema_version": 2,
  "target": {
    "repository": "owner/repository",
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

## Finding requirements

Every published finding must contain:

- a unique identifier and P0-P3 priority;
- confidence from 80 through 100;
- one applicable review axis;
- a concise imperative title;
- repository-relative file and tight start line;
- a body that connects trigger, path, wrong outcome, impact, and correction;
- at least one concrete evidence item.

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
have passed, and zero unresolved review conversations. Final merge readiness
requires a full review. Historical schema-v1 reports remain valid for reading
and rendering, but cannot authorize a merge.
