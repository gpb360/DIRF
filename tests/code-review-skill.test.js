import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ROOT } from "../src/paths.js";
import { loadUnit, resolveGraph } from "../src/folders.js";
import {
  ReviewValidationError,
  assertReviewReady,
  deriveGrade,
  deriveVerdict,
  priorityCounts,
  renderReview,
  validateReview,
} from "../skills/code-review/scripts/review-report.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function artifact(overrides = {}) {
  return {
    schema_version: 2,
    target: { repository: "https://example.test/owner/repo.git", pr_number: 42, base_sha: SHA_A, head_sha: SHA_B, mode: "full" },
    walkthrough: [{ area: "persistence", summary: "Changes the write boundary", files: ["src/store.js"] }],
    axes: Object.fromEntries([
      "spec",
      "correctness",
      "concurrency",
      "security",
      "data",
      "frontend",
      "testing",
      "standards",
    ].map((axis) => [axis, { status: "checked", evidence: `${axis} was inspected` }])),
    confidence: { quality: 90, evidence: 90 },
    findings: [],
    verification: [{ command: "node --test", status: "passed", result: "12 tests passed" }],
    limitations: [],
    completion: { review_complete: true, required_checks: "passed", unresolved_threads: 0 },
    ...overrides,
  };
}

function gitContext(overrides = {}) {
  return {
    current_head: SHA_B,
    remote_pr_head: SHA_B,
    repository: "https://example.test/owner/repo.git",
    base_exists: true,
    base_is_ancestor: true,
    base_matches_merge_base: true,
    previous_head_exists: true,
    previous_head_is_ancestor: true,
    live_checks_passed: true,
    ...overrides,
  };
}

function finding(overrides = {}) {
  return {
    id: "P1-001",
    priority: "P1",
    confidence: 94,
    axis: "correctness",
    title: "Retry duplicates a committed write",
    file: "src/store.js",
    line: 73,
    body: "When the response is lost after commit, the retry uses a new key and duplicates the write. Preserve the original key.",
    evidence: ["A focused test reproduces the lost-response ordering"],
    ...overrides,
  };
}

function withFinding(review, item) {
  return {
    ...review,
    findings: [item],
    axes: {
      ...review.axes,
      [item.axis]: { status: "finding", evidence: item.id },
    },
  };
}

test("bundled code-review skill resolves its progressive disclosure files", () => {
  const folder = join(ROOT, "skills", "code-review");
  const unit = loadUnit(folder);
  assert.deepEqual(unit.meta.details, ["workflow.md", "findings-contract.md", "review-axes.md"]);
  assert.doesNotThrow(() => resolveGraph(folder, { allowedRoots: [join(ROOT, "skills")] }));
});

test("PR-review playbook binds the graded code-review contract", () => {
  const folder = join(ROOT, "playbooks", "pr-review");
  const unit = loadUnit(folder);
  assert.equal(unit.meta.description, unit.meta.config.description);
  assert.deepEqual(unit.meta.uses, ["../../skills/code-review"]);
  const graph = resolveGraph(folder, { allowedRoots: [join(ROOT, "playbooks"), join(ROOT, "skills")] });
  assert.ok(graph.some((entry) => entry.meta.name === "code-review"));
});

test("clean, well-evidenced review passes", () => {
  const review = artifact();
  assert.equal(validateReview(review), review);
  assert.equal(deriveVerdict(review), "PASS");
  assert.equal(assertReviewReady(review, gitContext()).ready, true);
});

test("readiness fails when issues remain or the checkout differs from the reviewed commit", () => {
  assert.throws(
    () => assertReviewReady(withFinding(artifact(), finding({ id: "P2-001", priority: "P2" })), gitContext()),
    /1 review issue remains/i,
  );
  assert.throws(
    () => assertReviewReady(artifact(), gitContext({ current_head: "c".repeat(40) })),
    /checkout commit differs/i,
  );
  assert.throws(
    () => assertReviewReady(artifact({ completion: { review_complete: true, required_checks: "pending", unresolved_threads: 0 } }), gitContext()),
    /checks have not all passed/i,
  );
});

test("readiness rejects the wrong repository, invalid base, stale live PR, and failed verification", () => {
  assert.throws(() => assertReviewReady(artifact(), gitContext({ live_checks_passed: undefined })), /Live pull-request checks/);
  assert.throws(() => assertReviewReady(artifact(), gitContext({ live_checks_passed: undefined, pr_state: "merged" })), /Live pull-request checks/);
  assert.doesNotThrow(() => assertReviewReady(artifact(), gitContext({ live_checks_passed: undefined,
    pr_state: "merged", merge_commit: "c".repeat(40), merge_commit_is_ancestor: true })));
  assert.throws(() => assertReviewReady(artifact(), gitContext({ repository: "https://example.test/other/repo.git" })), /different repository/i);
  assert.throws(() => assertReviewReady(artifact(), gitContext({ base_exists: false })), /review base/i);
  assert.throws(() => assertReviewReady(artifact(), gitContext({ base_matches_merge_base: false })), /review base/i);
  assert.throws(() => assertReviewReady(artifact(), gitContext({ remote_pr_head: "c".repeat(40) })), /commit changed/i);
  assert.throws(
    () => assertReviewReady(artifact({ verification: [{ command: "npm test", status: "failed", result: "12 tests failed" }] }), gitContext()),
    /checks have not all passed/i,
  );
  const incremental = artifact({
    target: { ...artifact().target, mode: "incremental", previous_head_sha: "c".repeat(40) },
  });
  assert.throws(
    () => assertReviewReady(incremental, gitContext()),
    /requires a full review/i,
  );
});

test("P0 and P1 findings fail while lower priorities are conditional", () => {
  assert.equal(deriveVerdict(withFinding(artifact(), finding())), "FAIL");
  assert.equal(deriveVerdict(withFinding(artifact(), finding({ id: "P2-001", priority: "P2" }))), "CONDITIONAL");
  assert.equal(deriveVerdict(withFinding(artifact(), finding({ id: "P3-001", priority: "P3" }))), "CONDITIONAL");
});

test("grades every review and exposes all four priority counts", () => {
  assert.equal(deriveGrade(artifact()), "A");
  assert.equal(deriveGrade(artifact({ confidence: { quality: 85, evidence: 80 } })), "B");
  assert.equal(deriveGrade(withFinding(artifact(), finding({ id: "P3-001", priority: "P3" }))), "C");
  assert.equal(deriveGrade(withFinding(artifact(), finding({ id: "P2-001", priority: "P2" }))), "D");
  assert.equal(deriveGrade(withFinding(artifact(), finding())), "F");
  assert.equal(deriveGrade(artifact({ verification: [{ command: "npm test", status: "failed", result: "failed" }] })), "C");
  assert.deepEqual(priorityCounts(withFinding(artifact(), finding({ id: "P2-001", priority: "P2" }))), {
    P0: 0, P1: 0, P2: 1, P3: 0,
  });
});

test("insufficient clean-review evidence cannot pass", () => {
  assert.equal(deriveVerdict(artifact({ confidence: { quality: 90, evidence: 79 } })), "CONDITIONAL");
  assert.equal(deriveVerdict(artifact({ confidence: { quality: 84, evidence: 90 } })), "CONDITIONAL");
  assert.equal(deriveVerdict(artifact({ limitations: ["Database verification was unavailable"] })), "CONDITIONAL");
});

test("completion and structured verification status are required", () => {
  assert.throws(
    () => validateReview(artifact({ completion: undefined })),
    /completion must be an object/i,
  );
  assert.throws(
    () => validateReview(artifact({ verification: [{ command: "npm test", result: "passed" }] })),
    /verification\[0\].*status/i,
  );
});

test("historical schema version 1 reviews remain readable but cannot authorize merge", () => {
  const legacy = artifact({
    schema_version: 1,
    target: { repository: "owner/repo", base_sha: SHA_A, head_sha: SHA_B, mode: "full" },
    verification: [{ command: "npm test", result: "passed" }],
    completion: undefined,
  });
  assert.doesNotThrow(() => validateReview(legacy));
  const rendered = renderReview(legacy);
  assert.match(rendered, /\*\*Gate:\*\* NOT APPLICABLE — historical report/);
  assert.match(rendered, /\*\*Grade:\*\* NOT APPLICABLE/);
  assert.match(rendered, /\*\*Definition of done:\*\* NOT APPLICABLE/);
  assert.doesNotMatch(rendered, /\*\*Definition of done:\*\* MET/);
  assert.throws(() => assertReviewReady(legacy, gitContext()), /schema version 2/i);
});

test("schema version 2 requires the documented canonical repository URL", () => {
  assert.doesNotThrow(() => validateReview(artifact({
    target: { ...artifact().target, repository: "https://github.com/owner/repository.git" },
  })));
  assert.throws(
    () => validateReview(artifact({ target: { ...artifact().target, repository: "owner/repository" } })),
    /canonical repository URL/i,
  );
});

test("validator rejects low-confidence and absolute-path comments", () => {
  const item = finding({ confidence: 79, file: "C:\\repo\\src\\store.js" });
  const review = withFinding(artifact(), item);
  assert.throws(
    () => validateReview(review),
    (error) => error instanceof ReviewValidationError
      && error.errors.some((message) => message.includes("confidence"))
      && error.errors.some((message) => message.includes("repository-relative")),
  );
});

test("renderer emits ordered, confidence-scored findings and an exact-head marker", () => {
  const review = artifact();
  const findings = [
    finding({ id: "P2-002", priority: "P2", confidence: 88, title: "Second finding", line: 90 }),
    finding(),
  ];
  review.findings = findings;
  review.axes.correctness = { status: "finding", evidence: findings.map(({ id }) => id).join(", ") };
  const rendered = renderReview(review);
  assert.match(rendered, /\*\*Gate:\*\* FAIL/);
  assert.match(rendered, /\*\*Grade:\*\* F/);
  assert.match(rendered, /\*\*Priority count:\*\* P0 0 · P1 1 · P2 1 · P3 0/);
  assert.match(rendered, /\*\*Definition of done:\*\* NOT MET/);
  assert.ok(rendered.indexOf("[P1]") < rendered.indexOf("[P2]"));
  assert.match(rendered, /94% confidence/);
  assert.match(rendered, new RegExp(`<!-- dirf-review:v2;head=${SHA_B};mode=full -->`));
});

test("clean render clearly marks the zero-finding definition of done", () => {
  const rendered = renderReview(artifact());
  assert.match(rendered, /\*\*Grade:\*\* A/);
  assert.match(rendered, /P0 0 · P1 0 · P2 0 · P3 0/);
  assert.match(rendered, /\*\*Definition of done:\*\* MET/);
});
