import assert from "node:assert/strict";
import test from "node:test";
import {
  THRESHOLDS,
  adviseGate,
  buildGateRequest,
} from "../experiments/jev-shadow-gate-advisor.mjs";

function response(choice, confidence, noul) {
  return {
    answers: { action: { choice, confidence }, deletes_files: { noul } },
  };
}

test("builds a constrained JEV-shaped request", () => {
  const request = buildGateRequest({ command: "rm -rf build", directory: "repo" });
  assert.equal(request.model, "jev-latest");
  assert.deepEqual(Object.keys(request.questions), ["action", "deletes_files"]);
  assert.equal(request.questions.action.type, "choice");
  assert.deepEqual(Object.keys(request.questions.action.criteria).sort(), [
    "irreversible",
    "read_only",
    "reversible",
  ]);
  assert.equal(request.questions.deletes_files.type, "noul");
  assert.doesNotThrow(() => JSON.stringify(request));
});

test("high-confidence safe label with no deletion is advised acceptable", () => {
  assert.deepEqual(adviseGate(response("read_only", 0.95, 0.01)), {
    tier: "accept",
    reason: "safe label at or above the automation floor with no deletion signal",
  });
});

test("ambiguous destructive command asks the user instead of trusting the label", () => {
  // Mirror of the article's shadow test: `rm -rf` labeled irreversible at 0.56
  // with confidence 0.33 — too unsure to act on, so it must confirm.
  assert.equal(adviseGate(response("irreversible", 0.33, 0.56)).tier, "confirm");
});

test("confident irreversible commands are advised denied", () => {
  assert.equal(adviseGate(response("irreversible", 0.8, 0.9)).tier, "deny");
  assert.equal(adviseGate(response("irreversible", 0.8, 0.1)).tier, "deny");
});

test("labels below the review floor are never actionable", () => {
  assert.equal(
    adviseGate(response("read_only", THRESHOLDS.reviewFloor - 0.01, 0)).tier,
    "confirm",
  );
});

test("a deletion signal blocks automation of a reversible label", () => {
  assert.equal(adviseGate(response("reversible", 0.95, 0.7)).tier, "confirm");
});
