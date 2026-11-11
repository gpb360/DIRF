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
  assert.equal(ledgerAction(withFinding(4)).remaining, 1);
  for (const round of [5, 6]) {
    const result = ledgerAction(withFinding(round));
    assert.equal(result.action, "stop_for_person");
    assert.equal(result.round, round);
    assert.equal(result.max_rounds, 5);
    assert.equal(result.remaining, 0);
    assert.deepEqual(result.findings.map(({ id }) => id), ["P2-001"]);
    assert.equal(result.guardrails.human_decision_required, true);
    assert.equal(result.guardrails.merge_is_not_authorized, true);
    assert.equal(result.next_review, undefined);
    assert.throws(() => verifyUpdatedReview(result, review()), /Invalid remediation request/i);
  }
});

test("findings at round 3 force a new approach and keep the fix request", () => {
  const request = ledgerAction(withFinding(3));
  assert.equal(request.action, "reconsider_approach");
  assert.equal(request.approach_change_required, true);
  assert.equal(request.remaining, 2);
  assert.equal(request.next_review.round, 4);
  assert.equal(request.new_agent.required, true);
  assert.match(request.new_agent.input, /do not continue the session/);
  assert.equal(ledgerAction(withFinding(4)).approach_change_required, undefined);
  assert.equal(ledgerAction(withFinding(4)).new_agent, undefined);
  const updated = (extra) => review({ target: { ...review().target, head_sha: SHA_C, ...extra } });
  assert.throws(() => verifyUpdatedReview(request, updated({})), /approach_change/);
  assert.equal(verifyUpdatedReview(request, updated({ approach_change: "Move the check to the store" })).verified, true);
});

test("the rethink follows a stated limit and needs room to run", () => {
  assert.equal(ledgerAction(withFinding(6, { max_rounds: 8 })).action, "reconsider_approach");
  assert.equal(ledgerAction(withFinding(3, { max_rounds: 8 })).action, "fix_and_update_same_pr");
  assert.equal(ledgerAction(withFinding(1, { max_rounds: 3 })).action, "reconsider_approach");
  assert.equal(ledgerAction(withFinding(1, { max_rounds: 2 })).action, "fix_and_update_same_pr");
  assert.equal(ledgerAction(withFinding(2, { max_rounds: 2 })).action, "stop_for_person");
});

test("failed checks stop at the limit, pending checks and clean increments do not", () => {
  const atLimit = { ...review().target, round: 5 };
  const completion = (required_checks) => ({ review_complete: true, required_checks, unresolved_threads: 0 });
  assert.equal(ledgerAction(review({ target: atLimit, completion: completion("failed") })).action, "stop_for_person");
  assert.equal(ledgerAction(review({ target: atLimit, verification: [{ command: "t", status: "failed", result: "r" }] })).action, "stop_for_person");
  assert.equal(ledgerAction(review({ target: atLimit, completion: completion("pending") })).action, "continue_review");
  const incremental = { ...atLimit, mode: "incremental", previous_head_sha: SHA_C };
  assert.equal(ledgerAction(review({ target: incremental })).action, "continue_review");
  assert.equal(ledgerAction(review({ target: { ...review().target, round: 4 }, completion: completion("failed") })).action, "continue_review");
});

test("a store count overrides the numbers in the review file", () => {
  const result = ledgerAction(withFinding(1, { max_rounds: 50 }), { round: 5, max_rounds: 5 });
  assert.equal(result.action, "stop_for_person");
  assert.equal(result.round, 5);
  assert.equal(result.max_rounds, 5);
});

test("a clean review at the round limit still reaches readiness", () => {
  const result = ledgerAction(review({ target: { ...review().target, round: 5 } }));
  assert.equal(result.action, "verify_merge_readiness");
});

test("a stated limit replaces the default", () => {
  assert.equal(ledgerAction(withFinding(5, { max_rounds: 8 })).action, "fix_and_update_same_pr");
  for (const max_rounds of [0, 1.5, "8", null]) {
    assert.throws(() => ledgerAction(withFinding(1, { max_rounds })), /target\.max_rounds/);
  }
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
  assert.equal(result.action, "stop_for_person");
  assert.equal(result.next_review, undefined);
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
  assert.match(policy, /new agent/);
  assert.match(policy, /stop_for_person/);
  const playbook = readFileSync(new URL("../playbooks/pr-review/README.md", import.meta.url), "utf8");
  assert.match(playbook, /stop_for_person/);
});

test("target.round must be a positive integer", () => {
  for (const round of [0, -1, 1.5, "2", null]) {
    assert.throws(() => ledgerAction(withFinding(round)), /target\.round/);
  }
});

test("target.approach_change must be text", () => {
  for (const approach_change of ["", 3, null]) {
    assert.throws(() => ledgerAction(withFinding(1, { approach_change })), /target\.approach_change/);
  }
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

function preExisting(priority, extra = {}) {
  return {
    ...finding(), id: `${priority}-PRE`, priority, origin: "pre_existing",
    base_evidence: `git show ${SHA_A}:src/review.js has the same defect at line 12`, ...extra,
  };
}

function withFindings(findings) {
  return { ...review(), findings, axes: { ...review().axes, correctness: { status: "finding", evidence: findings.map(({ id }) => id).join(", ") } } };
}

test("a pre-existing P3 finding alone creates no fix request and is listed for follow-up", () => {
  const result = ledgerAction(withFindings([preExisting("P3")]));
  assert.equal(result.action, "verify_merge_readiness");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.follow_up_findings.map(({ id }) => id), ["P3-PRE"]);
  assert.match(result.follow_up_findings[0].base_evidence, /git show/);
  assert.deepEqual(result.priority_counts, { P0: 0, P1: 0, P2: 0, P3: 0 });
});

test("a mix of findings sends only the introduced finding to the fixer", () => {
  const result = ledgerAction(withFindings([finding(), preExisting("P2")]));
  assert.equal(result.action, "fix_and_update_same_pr");
  assert.deepEqual(result.findings.map(({ id }) => id), ["P2-001"]);
  assert.deepEqual(result.follow_up_findings.map(({ id }) => id), ["P2-PRE"]);
});

test("a pre-existing P0 or P1 finding still blocks", () => {
  for (const priority of ["P0", "P1"]) {
    const result = ledgerAction(withFindings([preExisting(priority)]));
    assert.equal(result.action, "fix_and_update_same_pr");
    assert.deepEqual(result.findings.map(({ id }) => id), [`${priority}-PRE`]);
    assert.equal(result.follow_up_findings, undefined);
  }
});

test("pre-existing P3 findings at the round limit do not stop for a person", () => {
  const at = withFindings([preExisting("P3")]);
  at.target = { ...at.target, round: MAX_LOOP_ROUNDS };
  assert.equal(ledgerAction(at).action, "verify_merge_readiness");
});

test("a pre-existing finding without base evidence fails validation", () => {
  assert.throws(() => ledgerAction(withFindings([preExisting("P3", { base_evidence: "" })])), /base_evidence/);
  assert.throws(() => ledgerAction(withFindings([{ ...finding(), origin: "old" }])), /origin must be introduced or pre_existing/);
});
