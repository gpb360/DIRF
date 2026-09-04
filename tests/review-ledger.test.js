import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerAction, verifyUpdatedReview } from "../skills/code-review/scripts/review-ledger.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const axes = ["spec", "correctness", "concurrency", "security", "data", "frontend", "testing", "standards"];

function review(overrides = {}) {
  return {
    schema_version: 2,
    target: { repository: "https://github.com/owner/repo.git", pr_number: 7, base_sha: SHA_A, head_sha: SHA_B, mode: "full" },
    walkthrough: [{ area: "workflow", summary: "Checks the review loop", files: ["src/review.js"] }],
    axes: Object.fromEntries(axes.map((axis) => [axis, { status: "checked", evidence: `${axis} checked` }])),
    confidence: { quality: 90, evidence: 90 },
    findings: [],
    verification: [{ command: "node --test", status: "passed", result: "all tests passed" }],
    limitations: [],
    completion: { review_complete: true, required_checks: "passed", unresolved_threads: 0 },
    ...overrides,
  };
}

function finding() {
  return {
    id: "P2-001", priority: "P2", confidence: 92, axis: "correctness",
    title: "Advance the PR after a fix", file: "src/review.js", line: 12,
    body: "The review remains on the old head after a fix. Publish the updated commit and re-review it.",
    evidence: ["A stale review artifact still names the prior head"],
  };
}

test("a finding creates one same-PR code-fix trigger with exact-head guards", () => {
  const result = ledgerAction({
    ...review(),
    findings: [finding()],
    axes: { ...review().axes, correctness: { status: "finding", evidence: "P2-001" } },
  });
  assert.equal(result.action, "fix_and_update_same_pr");
  assert.equal(result.expected_head_sha, SHA_B);
  assert.deepEqual(result.findings.map(({ id }) => id), ["P2-001"]);
  assert.equal(result.guardrails.same_pr_number, true);
  assert.equal(result.guardrails.head_must_advance, true);
  assert.equal(result.guardrails.merge_is_not_authorized, true);
  assert.equal(result.next_review.previous_head_sha, SHA_B);
});

test("a clean ledger asks for merge approval but never authorizes merge", () => {
  const result = ledgerAction(review());
  assert.equal(result.action, "request_merge_approval");
  assert.deepEqual(result.findings, []);
  assert.equal(result.guardrails.merge_is_not_authorized, true);
});

test("historical ledgers cannot trigger a fixer", () => {
  const historical = review({ schema_version: 1, target: { repository: "owner/repo", base_sha: SHA_A, head_sha: SHA_B, mode: "full" } });
  assert.throws(() => ledgerAction(historical), /schema version 2/i);
});

test("updated review must keep PR identity and advance the head", () => {
  const request = ledgerAction({
    ...review(),
    findings: [finding()],
    axes: { ...review().axes, correctness: { status: "finding", evidence: "P2-001" } },
  });
  assert.deepEqual(verifyUpdatedReview(request, review({ target: { ...review().target, head_sha: SHA_C } })), {
    verified: true,
    action: "trigger_review_ledger",
    repository: request.target.repository,
    pr_number: 7,
    previous_head_sha: SHA_B,
    head_sha: SHA_C,
    review_target: {
      ...review().target,
      head_sha: SHA_C,
      mode: "full",
      previous_head_sha: SHA_B,
    },
  });
  assert.throws(() => verifyUpdatedReview(request, review()), /did not advance/i);
  assert.throws(
    () => verifyUpdatedReview(request, review({ target: { ...review().target, head_sha: SHA_C, pr_number: 8 } })),
    /pull request number/i,
  );
});
