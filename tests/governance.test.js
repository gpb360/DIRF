import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DECISION,
  DEFAULT_GOVERNED_EXECUTION_POLICY,
  appendEvidenceLedger,
  digestAction,
  digestPolicy,
  digestValue,
  evaluateGovernedAction,
  verifyEvidenceLedger,
} from "../src/governance.js";

const NOW = "2026-08-10T12:00:00.000Z";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

function request(action) {
  return {
    id: "req-1",
    organizationId: "org-1",
    actor: { id: "agent-1", type: "agent", organizationId: "org-1" },
    action,
  };
}

function writeRequest() {
  const value = request({
    kind: "write",
    operation: "edit governed module",
    target: { id: "src/governance.js", repository: "gpb360/DIRF", ref: "feat/rtk-governed-execution", organizationId: "org-1" },
  });
  value.mandate = {
    id: "mandate-1",
    grantedBy: "gary",
    issuedAt: "2026-08-10T10:00:00.000Z",
    expiresAt: "2026-08-11T10:00:00.000Z",
    scope: {
      organizationId: "org-1",
      actionKinds: ["write"],
      targets: ["src/governance.js"],
      repositories: ["gpb360/DIRF@feat/rtk-governed-execution"],
    },
  };
  return value;
}

function approvedExternalSend() {
  const value = request({
    kind: "external_send",
    operation: "send approved governance report",
    target: { id: "recipient@example.invalid", organizationId: "org-1" },
    payloadDigest: HASH_A,
  });
  value.mandate = {
    id: "mandate-send",
    grantedBy: "gary",
    issuedAt: "2026-08-10T10:00:00.000Z",
    expiresAt: "2026-08-11T10:00:00.000Z",
    scope: { organizationId: "org-1", actionKinds: ["external_send"], targets: ["recipient@example.invalid"] },
  };
  value.evidence = [
    { id: "scope-1", type: "scope", organizationId: "org-1", digest: HASH_B },
    { id: "verify-1", type: "verification", organizationId: "org-1", digest: HASH_C },
  ];
  value.authorization = {
    id: "auth-1",
    decision: "approve",
    authority: { id: "gary", type: "human", role: "owner" },
    organizationId: "org-1",
    actionDigest: digestAction(value),
    policyDigest: digestPolicy(DEFAULT_GOVERNED_EXECUTION_POLICY),
    issuedAt: "2026-08-10T11:00:00.000Z",
    expiresAt: "2026-08-10T13:00:00.000Z",
    singleUse: true,
  };
  return value;
}

test("checked-in default policy matches the executable policy", () => {
  const checkedIn = JSON.parse(readFileSync(new URL("../policies/governed-execution-policy.json", import.meta.url), "utf8"));
  assert.deepEqual(checkedIn, DEFAULT_GOVERNED_EXECUTION_POLICY);
});

test("read-only exact targets are allowed without mutation authority", () => {
  const result = evaluateGovernedAction(request({ kind: "inspect", operation: "read status", target: { id: "repository-status" } }), undefined, { now: NOW });
  assert.equal(result.decision, DECISION.ALLOW);
  assert.equal(result.risk, "low");
});

test("state-changing workspace actions fail closed without a mandate", () => {
  const value = writeRequest();
  delete value.mandate;
  const result = evaluateGovernedAction(value, undefined, { now: NOW });
  assert.equal(result.decision, DECISION.DENY);
  assert.ok(result.missingRequirements.includes("missing_mandate"));
});

test("bounded workspace actions are allowed when mandate and exact repository scope match", () => {
  const result = evaluateGovernedAction(writeRequest(), undefined, { now: NOW });
  assert.equal(result.decision, DECISION.ALLOW);
  assert.equal(result.authorizationToConsume, null);
});

test("repository mandates bind the exact owner, repository, and ref", () => {
  const value = writeRequest();
  value.action.target.ref = "main";
  const result = evaluateGovernedAction(value, undefined, { now: NOW });
  assert.equal(result.decision, DECISION.DENY);
  assert.ok(result.missingRequirements.includes("mandate_repository_out_of_scope"));
});

test("action digests bind the trusted adapter identity", () => {
  const first = writeRequest();
  first.source = { adapter: "flowstack", version: "1" };
  const second = structuredClone(first);
  second.source.version = "2";
  assert.notEqual(digestAction(first), digestAction(second));
});

test("action digests bind mandate and evidence snapshots", () => {
  const first = approvedExternalSend();
  const changedMandate = structuredClone(first);
  changedMandate.mandate.expiresAt = "2026-08-12T10:00:00.000Z";
  const changedEvidence = structuredClone(first);
  changedEvidence.evidence[0].digest = HASH_A;
  assert.notEqual(digestAction(first), digestAction(changedMandate));
  assert.notEqual(digestAction(first), digestAction(changedEvidence));
});

test("unknown and cross-tenant actions are denied", () => {
  const value = request({ kind: "mystery", operation: "do something", target: { id: "x", organizationId: "org-2" } });
  const result = evaluateGovernedAction(value, undefined, { now: NOW });
  assert.equal(result.decision, DECISION.DENY);
  assert.ok(result.missingRequirements.includes("unknown_action"));
  assert.ok(result.missingRequirements.includes("target_organization_mismatch"));
});

test("high-risk actions request approval only after mandate and evidence are valid", () => {
  const value = approvedExternalSend();
  delete value.authorization;
  const result = evaluateGovernedAction(value, undefined, { now: NOW });
  assert.equal(result.decision, DECISION.REQUIRE_APPROVAL);
  assert.deepEqual(result.missingRequirements, ["missing_human_approval"]);
});

test("cross-tenant evidence fails closed", () => {
  const value = approvedExternalSend();
  value.evidence[0].organizationId = "org-2";
  value.authorization.actionDigest = digestAction(value);
  const result = evaluateGovernedAction(value, undefined, { now: NOW });
  assert.equal(result.decision, DECISION.DENY);
  assert.ok(result.missingRequirements.includes("evidence_organization_mismatch"));
});

test("exact-content named single-use human approval permits high-risk execution", () => {
  const value = approvedExternalSend();
  const result = evaluateGovernedAction(value, undefined, { now: NOW });
  assert.equal(result.decision, DECISION.ALLOW);
  assert.equal(result.authorizationToConsume, "auth-1");
});

test("changed content, self approval, and consumed approval cannot reuse authority", () => {
  const changed = approvedExternalSend();
  changed.action.payloadDigest = HASH_B;
  assert.equal(evaluateGovernedAction(changed, undefined, { now: NOW }).decision, DECISION.REQUIRE_APPROVAL);

  const selfApproved = approvedExternalSend();
  selfApproved.authorization.authority.id = "agent-1";
  assert.equal(evaluateGovernedAction(selfApproved, undefined, { now: NOW }).decision, DECISION.REQUIRE_APPROVAL);

  const consumed = approvedExternalSend();
  consumed.authorization.consumedAt = "2026-08-10T11:30:00.000Z";
  assert.equal(evaluateGovernedAction(consumed, undefined, { now: NOW }).decision, DECISION.REQUIRE_APPROVAL);
});

test("every compound action segment must independently satisfy policy", () => {
  const value = request({
    segments: [
      { kind: "inspect", operation: "read status", target: { id: "repo" } },
      { kind: "mystery", operation: "hidden mutation", target: { id: "prod" } },
    ],
  });
  const result = evaluateGovernedAction(value, undefined, { now: NOW });
  assert.equal(result.decision, DECISION.DENY);
  assert.equal(result.segmentDecisions[0].effect, DECISION.ALLOW);
  assert.equal(result.segmentDecisions[1].effect, DECISION.DENY);
});

test("deny rules outrank allow rules when both match", () => {
  const policy = structuredClone(DEFAULT_GOVERNED_EXECUTION_POLICY);
  policy.rules.push({
    id: "deny-inspect",
    match: { actionKinds: ["inspect"] },
    risk: "critical",
    effect: "deny",
    requirements: [],
  });
  const result = evaluateGovernedAction(request({ kind: "inspect", operation: "read", target: { id: "repo" } }), policy, { now: NOW });
  assert.equal(result.decision, DECISION.DENY);
  assert.equal(result.risk, "critical");
});

test("malformed policies fail closed without reaching rule matching", () => {
  const result = evaluateGovernedAction(
    request({ kind: "inspect", operation: "read", target: { id: "repo" } }),
    { schemaVersion: 1, version: "broken", defaultEffect: "deny", rules: [{ id: "broken" }] },
    { now: NOW },
  );
  assert.equal(result.decision, DECISION.DENY);
  assert.equal(result.risk, "critical");
  assert.ok(result.missingRequirements.includes("invalid_policy_match"));
});

test("the built-in policy is deeply immutable", () => {
  assert.throws(() => DEFAULT_GOVERNED_EXECUTION_POLICY.rules.push({}), TypeError);
  assert.throws(() => { DEFAULT_GOVERNED_EXECUTION_POLICY.rules[0].effect = "allow"; }, TypeError);
});

test("timestamps must be real UTC ISO instants", () => {
  const invalidDate = writeRequest();
  invalidDate.mandate.issuedAt = "2026-02-31T10:00:00.000Z";
  assert.ok(evaluateGovernedAction(invalidDate, undefined, { now: NOW }).missingRequirements.includes("invalid_mandate_time"));

  const looseEvaluationTime = evaluateGovernedAction(writeRequest(), undefined, { now: "2026-08-10" });
  assert.equal(looseEvaluationTime.decision, DECISION.DENY);
  assert.ok(looseEvaluationTime.missingRequirements.includes("invalid_evaluation_time"));
});

test("secret-bearing requests are denied and cannot enter the ledger", () => {
  const value = request({ kind: "inspect", operation: "read", target: { id: "repo" } });
  value.apiKey = "do-not-store";
  const result = evaluateGovernedAction(value, undefined, { now: NOW });
  assert.equal(result.decision, DECISION.DENY);
  assert.equal(result.actionDigest, null);
  assert.ok(result.missingRequirements.includes("sensitive_value_present"));
  assert.throws(() => appendEvidenceLedger([], { apiKey: "do-not-store" }, { recordedAt: NOW }), /must not contain secrets/);
});

test("canonical hashing preserves prototype-named JSON keys", () => {
  const withPrototypeKey = JSON.parse('{"safe":true,"__proto__":{"polluted":true}}');
  assert.notEqual(digestValue(withPrototypeKey), digestValue({ safe: true }));
});

test("ledger chaining detects mutation and supports safe append", () => {
  let ledger = appendEvidenceLedger([], { type: "decision", requestId: "req-1", decision: "allow" }, { recordedAt: NOW });
  ledger = appendEvidenceLedger(ledger, { type: "execution", requestId: "req-1", status: "passed" }, { recordedAt: "2026-08-10T12:01:00.000Z" });
  assert.deepEqual(verifyEvidenceLedger(ledger), {
    valid: true,
    entries: 2,
    headHash: ledger[1].entryHash,
    errors: [],
  });

  const tampered = structuredClone(ledger);
  tampered[0].event.decision = "deny";
  const verification = verifyEvidenceLedger(tampered);
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((item) => item.includes("entryHash mismatch")));
  assert.throws(() => appendEvidenceLedger(tampered, { type: "execution" }, { recordedAt: NOW }), /invalid ledger/);
});
