import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ledgerAction, verifyUpdatedReview } from "../skills/code-review/scripts/review-ledger.mjs";
import { MAX_LOOP_ROUNDS } from "../src/limits.js";

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
  assert.equal(result.round, 1);
  assert.equal(result.next_review.round, 2);
});

function withFinding(round, extra = {}) {
  return {
    ...review({ target: { ...review().target, ...(round === undefined ? {} : { round }), ...extra } }),
    findings: [finding()],
    axes: { ...review().axes, correctness: { status: "finding", evidence: "P2-001" } },
  };
}

test("findings stop going to a fixer at the round limit", () => {
  assert.equal(MAX_LOOP_ROUNDS, 5);
  assert.equal(ledgerAction(withFinding(4)).action, "fix_and_update_same_pr");
  for (const round of [5, 6]) {
    const result = ledgerAction(withFinding(round));
    assert.equal(result.action, "reconsider_approach");
    assert.equal(result.round, round);
    assert.equal(result.max_rounds, 5);
    assert.deepEqual(result.findings.map(({ id }) => id), ["P2-001"]);
    assert.equal(result.guardrails.human_decision_required, true);
    assert.equal(result.guardrails.merge_is_not_authorized, true);
    assert.equal(result.next_review, undefined);
    assert.throws(() => verifyUpdatedReview(result, review()), /Invalid remediation request/i);
  }
});

test("a clean review at the round limit still reaches readiness", () => {
  const result = ledgerAction(review({ target: { ...review().target, round: 5 } }));
  assert.equal(result.action, "verify_merge_readiness");
});

test("a stated limit replaces the default and a fixer cannot change it", () => {
  assert.equal(ledgerAction(withFinding(2, { max_rounds: 2 })).action, "reconsider_approach");
  assert.equal(ledgerAction(withFinding(5, { max_rounds: 8 })).action, "fix_and_update_same_pr");
  for (const max_rounds of [0, 1.5, "8", null]) {
    assert.throws(() => ledgerAction(withFinding(1, { max_rounds })), /target\.max_rounds/);
  }
  const updated = (extra) => review({ target: { ...review().target, head_sha: SHA_C, round: 2, ...extra } });
  const request = ledgerAction(withFinding(1, { max_rounds: 8 }));
  assert.equal(request.next_review.max_rounds, 8);
  assert.equal(verifyUpdatedReview(request, updated({ max_rounds: 8 })).verified, true);
  assert.throws(() => verifyUpdatedReview(request, updated({ max_rounds: 20 })), /round limit/i);
  assert.throws(() => verifyUpdatedReview(request, updated({})), /round limit/i);
});

test("every ledger action reports the round so a re-review can keep it", () => {
  const incremental = { ...review().target, round: 4, mode: "incremental", previous_head_sha: SHA_C };
  for (const result of [
    ledgerAction(review({ target: incremental })),
    ledgerAction(review({ target: { ...review().target, round: 4 } })),
    ledgerAction(withFinding(4)),
  ]) {
    assert.equal(result.round, 4);
    assert.equal(result.max_rounds, 5);
  }
  assert.equal(ledgerAction(review({ target: incremental })).action, "continue_review");
});

test("a limit of one stops at the first review with no fix", () => {
  const result = ledgerAction(withFinding(1, { max_rounds: 1 }));
  assert.equal(result.action, "reconsider_approach");
  assert.equal(result.next_review, undefined);
});

test("a saved request without round data names the recovery step", () => {
  const { round: _round, ...noRound } = ledgerAction(withFinding(1));
  const { max_rounds: _max, ...noLimit } = ledgerAction(withFinding(1));
  const updated = review({ target: { ...review().target, head_sha: SHA_C, round: 2 } });
  for (const request of [noRound, noLimit]) {
    assert.throws(() => verifyUpdatedReview(request, updated), /dirf review trigger/);
  }
});

test("the review scripts stay inside their skill folder", () => {
  for (const script of ["review-ledger.mjs", "review-report.mjs"]) {
    const source = readFileSync(new URL(`../skills/code-review/scripts/${script}`, import.meta.url), "utf8");
    assert.deepEqual(source.match(/(?:from|import)\s*\(?\s*["']\.\.\/[^"']*/g), null, script);
  }
});

test("agent instructions state the same loop limit as the code", () => {
  const policy = readFileSync(new URL("../policies/workflow-policy.md", import.meta.url), "utf8");
  assert.match(policy, new RegExp(`loop after ${MAX_LOOP_ROUNDS} rounds`));
  assert.match(policy, /reconsider_approach/);
  const playbook = readFileSync(new URL("../playbooks/pr-review/README.md", import.meta.url), "utf8");
  assert.match(playbook, /reconsider_approach/);
});

test("target.round must be a positive integer", () => {
  for (const round of [0, -1, 1.5, "2", null]) {
    assert.throws(() => ledgerAction(withFinding(round)), /target\.round/);
  }
});

test("a fixer cannot reset or skip the review round", () => {
  const request = ledgerAction(withFinding(2));
  const updated = (round) => review({ target: { ...review().target, head_sha: SHA_C, ...(round === undefined ? {} : { round }) } });
  assert.equal(verifyUpdatedReview(request, updated(3)).review_target.round, 3);
  for (const round of [undefined, 1, 2, 4]) {
    assert.throws(() => verifyUpdatedReview(request, updated(round)), /target\.round to 3/);
  }
  const { round: _omitted, ...withoutRound } = request;
  assert.throws(() => verifyUpdatedReview(withoutRound, updated(3)), /Invalid remediation request/i);
});

test("a clean ledger requires live readiness before merge approval", () => {
  const result = ledgerAction(review());
  assert.equal(result.action, "verify_merge_readiness");
  assert.deepEqual(result.findings, []);
  assert.equal(result.guardrails.merge_is_not_authorized, true);
});

test("zero findings cannot bypass incomplete review evidence", () => {
  for (const changes of [
    { completion: { review_complete: false, required_checks: "passed", unresolved_threads: 0 } },
    { completion: { review_complete: true, required_checks: "failed", unresolved_threads: 0 } },
    { completion: { review_complete: true, required_checks: "pending", unresolved_threads: 0 } },
    { completion: { review_complete: true, required_checks: "passed", unresolved_threads: 1 } },
    { confidence: { quality: 70, evidence: 90 } },
    { limitations: ["Live evidence unavailable"] },
    { target: { ...review().target, mode: "incremental", previous_head_sha: SHA_C } },
    { verification: [{ command: "node --test", status: "failed", result: "Failure" }] },
  ]) assert.equal(ledgerAction(review(changes)).action, "continue_review");
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
  assert.deepEqual(verifyUpdatedReview(request, review({ target: { ...review().target, head_sha: SHA_C, round: 2 } })), {
    verified: true,
    verification_scope: "artifact_targets_only",
    live_head_verification_required: true,
    action: "trigger_review_ledger",
    repository: request.target.repository,
    pr_number: 7,
    previous_head_sha: SHA_B,
    head_sha: SHA_C,
    review_target: {
      ...review().target,
      head_sha: SHA_C,
      round: 2,
      mode: "full",
      previous_head_sha: SHA_B,
    },
  });
  assert.throws(() => verifyUpdatedReview(request, review()), /did not advance/i);
  for (const invalid of [
    { ...request, expected_head_sha: SHA_C },
    { ...request, expected_head_sha: "invalid" },
    { ...request, target: undefined },
    { ...request, target: { ...request.target, pr_number: 0 } },
  ]) assert.throws(() => verifyUpdatedReview(invalid, review()), /Invalid remediation request/i);
  assert.throws(
    () => verifyUpdatedReview(request, review({ target: { ...review().target, head_sha: SHA_C, pr_number: 8 } })),
    /pull request number/i,
  );
});
