import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ISSUE_POLICY,
  FINDING_CLASSIFICATION,
  FINDING_STATE,
  transitionFinding,
} from "../src/issue-governance.js";

test("DIRF defaults to local-only, tracker-neutral findings", () => {
  assert.deepEqual(DEFAULT_ISSUE_POLICY, {
    schemaVersion: 1,
    version: "dirf-local-findings-v1",
    mode: "local_only",
    externalCreation: "project_policy_required",
  });
  assert.deepEqual(Object.values(FINDING_CLASSIFICATION), [
    "fix_now",
    "duplicate",
    "invalid",
    "product_decision",
    "deferred_candidate",
  ]);
});

test("local finding lifecycle permits evidence-backed resolution and rejects external shortcuts", () => {
  const detected = { id: "f-1", state: FINDING_STATE.DETECTED };
  const validated = transitionFinding(detected, FINDING_STATE.VALIDATED, { command: "focused test" });
  assert.equal(validated.state, FINDING_STATE.VALIDATED);

  const deferred = transitionFinding(validated, FINDING_STATE.DEFERRED_CANDIDATE, { reason: "project decision" });
  const resolved = transitionFinding(deferred, FINDING_STATE.RESOLVED_LOCAL, { result: "fixed in current work" });
  assert.equal(resolved.state, FINDING_STATE.RESOLVED_LOCAL);
  assert.throws(() => transitionFinding(detected, "created", { review: true }), /unknown finding state/);
  assert.throws(() => transitionFinding(validated, FINDING_STATE.RESOLVED_LOCAL), /requires evidence/);
});
