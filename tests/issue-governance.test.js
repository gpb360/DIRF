import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ISSUE_POLICY, FINDING_CLASSIFICATION, FINDING_STATE, issueFindingDigest, transitionFinding, validateIssueAuthorization } from "../src/issue-governance.js";

function finding(overrides = {}) {
  return {
    id: "review-42-p2-1", state: FINDING_STATE.DEFERRED_CANDIDATE, sourcePr: 42,
    classification: FINDING_CLASSIFICATION.DEFERRED_CANDIDATE,
    priority: "P2", title: "Preserve callback identity", acceptanceCriteria: ["Retry maps to one callback"],
    canonicalParent: null, hasCanonicalParent: false, blocksCurrentPr: false, fixableInActivePr: false,
    speculativeFuture: false, unresolvedP0Count: 0, unresolvedP1Count: 0, prAcceptancePercent: 92,
    deferReason: "Independent follow-up; current path remains correct",
    dedupe: { open_issues: true, open_pull_requests: true, merged_pull_requests: true, matchingIssue: null },
    ...overrides,
  };
}

function authorization(value, overrides = {}) {
  return {
    id: "issue-auth-1", authority: { type: "human", id: "owner-1" },
    findingDigest: issueFindingDigest(value), singleUse: true, consumedAt: null,
    expiresAt: "2026-08-11T00:00:00.000Z", ...overrides,
  };
}

test("local finding lifecycle permits evidence-backed paths and rejects shortcuts", () => {
  const detected = { id: "f-1", state: FINDING_STATE.DETECTED };
  const validated = transitionFinding(detected, FINDING_STATE.VALIDATED, { command: "focused test" });
  assert.equal(validated.state, FINDING_STATE.VALIDATED);
  assert.throws(() => transitionFinding(detected, FINDING_STATE.CREATED, { review: true }), /invalid finding transition/);
  assert.throws(() => transitionFinding(validated, FINDING_STATE.FIXED_LOCAL), /requires evidence/);
});

test("issue authorization allows only an exact deduplicated deferred PR finding", () => {
  const value = finding();
  const result = validateIssueAuthorization(value, authorization(value), DEFAULT_ISSUE_POLICY, new Date("2026-08-10T12:00:00.000Z"));
  assert.deepEqual(result, { allowed: true, authorizationId: "issue-auth-1", findingDigest: issueFindingDigest(value) });
});

test("issue authorization fails closed for blockers, duplicates, low acceptance, and stale authority", () => {
  const cases = [
    [finding({ blocksCurrentPr: true }), "blocks_current_pr"],
    [finding({ prAcceptancePercent: 89 }), "acceptance_below_threshold"],
    [finding({ dedupe: { open_issues: true, open_pull_requests: true, merged_pull_requests: true, matchingIssue: 9 } }), "duplicate_issue"],
    [finding({ priority: "P1" }), "ineligible_priority"],
    [finding({ classification: FINDING_CLASSIFICATION.FIX_NOW }), "not_deferred_classification"],
    [finding({ fixableInActivePr: true }), "fixable_in_active_pr"],
    [finding({ speculativeFuture: true }), "speculative_future"],
    [finding({ hasCanonicalParent: true, canonicalParent: 40 }), "canonical_parent_exists"],
    [finding({ unresolvedP1Count: 1 }), "higher_priority_unresolved"],
  ];
  for (const [value, code] of cases) assert.equal(validateIssueAuthorization(value, authorization(value)).code, code);
  const value = finding();
  assert.equal(validateIssueAuthorization(value, authorization(value, { findingDigest: "sha256:bad" })).code, "digest_mismatch");
  assert.equal(validateIssueAuthorization(value, authorization(value), DEFAULT_ISSUE_POLICY, new Date("2026-08-12T00:00:00.000Z")).code, "authorization_expired");
  assert.equal(validateIssueAuthorization(value, authorization(value), { mode: "pr_deferral_only" }).code, "invalid_issue_policy");
  assert.equal(validateIssueAuthorization(value, authorization(value), { ...DEFAULT_ISSUE_POLICY, minimumPrAcceptancePercent: 80 }).code, "invalid_issue_policy");
  assert.equal(validateIssueAuthorization(value, authorization(value), { ...DEFAULT_ISSUE_POLICY, requiredDedupeChecks: ["open_issues"] }).code, "invalid_issue_policy");
});
