import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_TYPES,
  explainGoverningArtifact,
  resolveGoverningArtifact,
  validateArtifactGraph,
  validatePlanDelta,
} from "../src/artifacts.js";

const CREATED = "2026-08-12T18:30:00.000Z";

function artifact(id, overrides = {}) {
  return {
    id,
    type: "plan",
    path: `artifacts/${id}.md`,
    created_at: CREATED,
    supersedes: [],
    ...overrides,
  };
}

function accepted(id, acceptedAt, overrides = {}) {
  return artifact(id, { accepted_at: acceptedAt, ...overrides });
}

function delta(overrides = {}) {
  return {
    plan_artifact_id: "plan-2",
    implemented_as_planned: [],
    additions: [],
    omissions: [],
    unverifiable: [],
    ...overrides,
  };
}

test("artifact vocabulary is stable and artifact-free attempts remain valid", () => {
  assert.deepEqual(ARTIFACT_TYPES, [
    "source",
    "research_questions",
    "research",
    "design",
    "structure",
    "plan",
    "implementation_evidence",
    "plan_delta",
  ]);
  assert.deepEqual(validateArtifactGraph(undefined), { valid: true, errors: [] });
  assert.deepEqual(validateArtifactGraph([]), { valid: true, errors: [] });
  assert.equal(resolveGoverningArtifact(undefined), null);
});

test("valid linear and branching graphs resolve by supersession then acceptance time", () => {
  const graph = [
    accepted("plan-1", "2026-08-12T18:31:00.000Z"),
    accepted("plan-2", "2026-08-12T18:32:00.000Z", { supersedes: ["plan-1"] }),
    accepted("plan-side", "2026-08-12T18:33:00.000Z"),
  ];
  assert.deepEqual(validateArtifactGraph(graph), { valid: true, errors: [] });
  assert.equal(resolveGoverningArtifact(graph, "plan").id, "plan-side");
});

test("transitive supersession crosses an unaccepted intermediate artifact", () => {
  const graph = [
    accepted("plan-1", "2026-08-12T18:31:00.000Z"),
    artifact("plan-2", { supersedes: ["plan-1"] }),
    accepted("plan-3", "2026-08-12T18:33:00.000Z", { supersedes: ["plan-2"] }),
  ];
  assert.equal(resolveGoverningArtifact(graph, ["plan"]).id, "plan-3");
});

test("equal acceptance timestamps use lexical artifact id as a stable tie-breaker", () => {
  const at = "2026-08-12T18:35:00.000Z";
  const graph = [accepted("plan-a", at), accepted("plan-b", at)];
  assert.equal(resolveGoverningArtifact(graph, "plan").id, "plan-b");
});

test("governance trace explains supersession and the final tie-break", () => {
  const at = "2026-08-12T18:35:00.000Z";
  const graph = [
    accepted("plan-old", "2026-08-12T18:31:00.000Z"),
    accepted("plan-a", at, { supersedes: ["plan-old"] }),
    accepted("plan-b", at),
  ];
  const trace = explainGoverningArtifact(graph, "plan");
  assert.equal(trace.governing.id, "plan-b");
  assert.deepEqual(trace.eligible, ["plan-a", "plan-b", "plan-old"]);
  assert.deepEqual(trace.superseded, [{ id: "plan-old", by: ["plan-a"] }]);
  assert.deepEqual(trace.candidates, ["plan-a", "plan-b"]);
  assert.equal(trace.selected_by, "lexical id tie-break");
});

test("unaccepted and wrong-type artifacts are not eligible", () => {
  const graph = [
    artifact("plan-draft"),
    accepted("design-1", "2026-08-12T18:35:00.000Z", { type: "design" }),
  ];
  assert.equal(resolveGoverningArtifact(graph, "plan"), null);
  assert.equal(resolveGoverningArtifact(graph, "design").id, "design-1");
});

test("graph validation accumulates field, portability, and reference errors", () => {
  const graph = [
    artifact("same", { type: "unknown", path: "C:\\outside.md", created_at: "yesterday", supersedes: ["missing", "missing"] }),
    artifact("same", { path: "artifacts/../outside.md", accepted_at: "soon" }),
  ];
  const result = validateArtifactGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /id must be unique/.test(error)));
  assert.ok(result.errors.some((error) => /type must be one of/.test(error)));
  assert.ok(result.errors.some((error) => /path must be attempt-relative/.test(error)));
  assert.ok(result.errors.some((error) => /created_at must be an ISO-8601/.test(error)));
  assert.ok(result.errors.some((error) => /accepted_at must be an ISO-8601/.test(error)));
  assert.ok(result.errors.some((error) => /supersedes must contain unique/.test(error)));
  assert.ok(result.errors.some((error) => /references missing artifact/.test(error)));
  assert.equal(resolveGoverningArtifact(graph), null);
});

test("timestamps must be real instants with non-reversing acceptance chronology", () => {
  const impossible = validateArtifactGraph([artifact("bad-date", { created_at: "2026-02-30T10:00:00Z" })]);
  assert.equal(impossible.valid, false);
  assert.ok(impossible.errors.some((error) => /created_at must be an ISO-8601/.test(error)));

  const backwards = validateArtifactGraph([artifact("backwards", {
    created_at: "2026-08-12T18:35:00.000Z",
    accepted_at: "2026-08-12T18:34:59.999Z",
  })]);
  assert.equal(backwards.valid, false);
  assert.ok(backwards.errors.some((error) => /accepted_at must not be earlier/.test(error)));

  assert.equal(validateArtifactGraph([artifact("leap", { created_at: "2028-02-29T10:00:00+05:30" })]).valid, true);
});

test("accepted content digests are optional for legacy records and strict when present", () => {
  const timestamp = "2026-08-12T18:35:00.000Z";
  assert.equal(validateArtifactGraph([accepted("legacy", timestamp)]).valid, true);
  assert.equal(validateArtifactGraph([accepted("bound", timestamp, { accepted_sha256: "a".repeat(64) })]).valid, true);

  const invalid = validateArtifactGraph([
    artifact("orphan", { accepted_sha256: "a".repeat(64) }),
    accepted("malformed", timestamp, { accepted_sha256: "A".repeat(64) }),
  ]);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => /accepted_sha256 requires accepted_at/.test(error)));
  assert.ok(invalid.errors.some((error) => /accepted_sha256 must be a lowercase SHA-256 digest/.test(error)));
});

test("graph validation rejects non-arrays, malformed records, and cycles", () => {
  assert.equal(validateArtifactGraph({}).valid, false);
  assert.equal(validateArtifactGraph([null]).valid, false);
  const cycle = [artifact("a", { supersedes: ["b"] }), artifact("b", { supersedes: ["a"] })];
  const result = validateArtifactGraph(cycle);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /cycle/.test(error)));
});

test("an explicit empty four-bucket plan delta is valid for the governing plan", () => {
  const artifacts = [
    accepted("plan-1", "2026-08-12T18:31:00.000Z"),
    accepted("plan-2", "2026-08-12T18:32:00.000Z", { supersedes: ["plan-1"] }),
  ];
  assert.deepEqual(validatePlanDelta(delta(), artifacts), { valid: true, errors: [] });
});

test("plan delta validates all classifications and required evidence", () => {
  const artifacts = [accepted("plan-2", "2026-08-12T18:32:00.000Z")];
  const value = delta({
    implemented_as_planned: [{ id: "done-1", summary: "Artifact graph implemented", evidence: ["tests/artifacts.test.js"] }],
    additions: [{ id: "add-1", summary: "Stable tie-breaker", reason: "Required for determinism", evidence: ["tests/artifacts.test.js"] }],
    omissions: [{ id: "omit-1", summary: "CLI integration", reason: "Outside this slice", evidence: ["attempt phase"] }],
    unverifiable: [{ id: "unknown-1", summary: "Host rendering", evidence: ["not exercised"] }],
  });
  assert.deepEqual(validatePlanDelta(value, artifacts), { valid: true, errors: [] });
});

test("plan delta rejects a non-governing plan, duplicate ids, missing evidence, and missing reasons", () => {
  const artifacts = [
    accepted("plan-1", "2026-08-12T18:31:00.000Z"),
    accepted("plan-2", "2026-08-12T18:32:00.000Z", { supersedes: ["plan-1"] }),
  ];
  const value = delta({
    plan_artifact_id: "plan-1",
    implemented_as_planned: [{ id: "same", summary: "Done", evidence: [] }],
    additions: [{ id: "same", summary: "Added", evidence: ["proof"] }],
    omissions: [{ id: "omit", summary: "Missing", evidence: ["proof"] }],
  });
  const result = validatePlanDelta(value, artifacts);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /governing accepted plan/.test(error)));
  assert.ok(result.errors.some((error) => /entry id must be unique/.test(error)));
  assert.ok(result.errors.some((error) => /evidence must contain/.test(error)));
  assert.ok(result.errors.some((error) => /additions\[0\]\.reason is required/.test(error)));
  assert.ok(result.errors.some((error) => /omissions\[0\]\.reason is required/.test(error)));
});

test("plan delta requires its root, plan id, and all four arrays", () => {
  const artifacts = [accepted("plan-2", "2026-08-12T18:32:00.000Z")];
  assert.equal(validatePlanDelta(null, artifacts).valid, false);
  const result = validatePlanDelta({ plan_artifact_id: "", implemented_as_planned: "no" }, artifacts);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /plan_artifact_id is required/.test(error)));
  assert.ok(result.errors.some((error) => /implemented_as_planned must be an array/.test(error)));
  assert.ok(result.errors.some((error) => /additions must be an array/.test(error)));
  assert.ok(result.errors.some((error) => /omissions must be an array/.test(error)));
  assert.ok(result.errors.some((error) => /unverifiable must be an array/.test(error)));
});
