import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateRequirementMappingUpdate, validateSummaryCursor, parseSummaryCursor } from "../src/summary-validation.js";

const plan = { artifact_id: "plan-v1", sha256: "a".repeat(64) };
const proof = { artifact_id: "proof-v1", sha256: "b".repeat(64) };
const context = { attempt_id: "attempt-1", governing_plan: plan, requirement_ids: ["R1", "R2"], mapping_revision: 3 };
const update = () => ({ schema_version: 1, attempt_id: "attempt-1", governing_plan: { ...plan }, expected_revision: 3,
  requirements: [{ requirement_id: "R1", decision_ref: null, work_state: "complete", proof_refs: [] }] });
const pageContext = { attempt_id: "attempt-1", mapping_revision: 3, collection: "requirements" };
const cursor = () => ({ schema_version: 1, attempt_id: "attempt-1", mapping_revision: 3, collection: "requirements", offset: 5, limit: 5 });
const token = value => Buffer.from(JSON.stringify(value)).toString("base64url");

test("a partial update carries references without claiming verification or acceptance", () => {
  const value = update();
  value.requirements[0].decision_ref = proof;
  value.requirements[0].proof_refs = [proof];
  const before = JSON.stringify({ value, context });
  const result = validateRequirementMappingUpdate(value, context);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, value);
  assert.equal(JSON.stringify({ value, context }), before);
  assert.equal("verification" in result.value.requirements[0], false);
});

test("complete work with missing proof is valid input, not verified evidence", () => {
  assert.equal(validateRequirementMappingUpdate(update(), context).valid, true);
});

test("unknown requirements and duplicate update entries are rejected", () => {
  const value = update();
  value.requirements[0].requirement_id = "R99";
  assert.match(validateRequirementMappingUpdate(value, context).errors.join("\n"), /governing plan/);
  value.requirements[0].requirement_id = "R1";
  value.requirements.push(structuredClone(value.requirements[0]));
  assert.match(validateRequirementMappingUpdate(value, context).errors.join("\n"), /unique/);
});

test("updates cannot cross attempt, plan digest, plan id or mapping revision boundaries", () => {
  for (const change of [v => v.attempt_id = "attempt-2", v => v.governing_plan.artifact_id = "plan-v2",
    v => v.governing_plan.sha256 = "c".repeat(64), v => v.expected_revision = 2]) {
    const value = update(); change(value);
    assert.equal(validateRequirementMappingUpdate(value, context).valid, false);
  }
});

test("proof and decision references require portable ids and exact digests", () => {
  for (const bad of ["proof.md", {}, null, { ...proof, artifact_id: "../proof" }, { ...proof, sha256: "B".repeat(64) },
    { ...proof, sha256: "short" }, { ...proof, accepted: true }]) {
    const value = update(); value.requirements[0].proof_refs = [bad];
    assert.equal(validateRequirementMappingUpdate(value, context).valid, false);
    value.requirements[0].proof_refs = []; value.requirements[0].decision_ref = bad;
    assert.equal(validateRequirementMappingUpdate(value, context).valid, bad === null);
  }
});

test("duplicate proofs cannot name conflicting bytes of one artifact", () => {
  const value = update(); value.requirements[0].proof_refs = [proof, { ...proof, sha256: "c".repeat(64) }];
  assert.match(validateRequirementMappingUpdate(value, context).errors.join("\n"), /unique artifact ids/);
});

test("externally supplied acceptance, verification and requirement prose are rejected", () => {
  for (const [key, input] of [["accepted", true], ["verification", "verified"], ["summary", "new requirement meaning"]]) {
    const value = update(); value.requirements[0][key] = input;
    assert.match(validateRequirementMappingUpdate(value, context).errors.join("\n"), /not allowed/);
  }
  const value = update(); value.accepted_sha256 = "c".repeat(64);
  assert.equal(validateRequirementMappingUpdate(value, context).valid, false);
});

test("malformed shapes and states fail as validation results", () => {
  for (const bad of [null, [], "text", new Date(), {}, { ...update(), schema_version: 2 }, { ...update(), requirements: [] },
    { ...update(), expected_revision: -1 }, { ...update(), requirements: [null] }]) {
    assert.equal(validateRequirementMappingUpdate(bad, context).valid, false);
  }
  for (const state of ["done", "verified", "accepted", null, 1]) {
    const value = update(); value.requirements[0].work_state = state;
    assert.equal(validateRequirementMappingUpdate(value, context).valid, false);
  }
  for (const state of ["planned", "in_progress", "blocked", "complete"]) {
    const value = update(); value.requirements[0].work_state = state;
    assert.equal(validateRequirementMappingUpdate(value, context).valid, true);
  }
});

test("required update fields and malformed caller context cannot bypass checks", () => {
  for (const key of Object.keys(update())) {
    const value = update(); delete value[key];
    assert.equal(validateRequirementMappingUpdate(value, context).valid, false);
  }
  for (const key of Object.keys(update().requirements[0])) {
    const value = update(); delete value.requirements[0][key];
    assert.equal(validateRequirementMappingUpdate(value, context).valid, false);
  }
  for (const bad of [null, {}, { ...context, requirement_ids: ["R1", "R1"] }, { ...context, governing_plan: {} },
    { ...context, mapping_revision: NaN }, { ...context, requirement_ids: [] }]) {
    assert.equal(validateRequirementMappingUpdate(update(), bad).valid, false);
  }
});

test("sparse arrays cannot skip requirement, proof or source identity validation", () => {
  const missingRequirement = update(); missingRequirement.requirements = new Array(1);
  assert.equal(validateRequirementMappingUpdate(missingRequirement, context).valid, false);
  const missingProof = update(); missingProof.requirements[0].proof_refs = new Array(1);
  assert.equal(validateRequirementMappingUpdate(missingProof, context).valid, false);
  assert.equal(validateRequirementMappingUpdate(update(), { ...context, requirement_ids: new Array(1) }).valid, false);
});

test("a continuation token validates against its selected source", () => {
  const result = parseSummaryCursor(token(cursor()), pageContext);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, cursor());
});

test("cursors reject stale revisions, other attempts and other collections", () => {
  for (const change of [v => v.mapping_revision = 4, v => v.attempt_id = "attempt-2", v => v.collection = "unresolved_work"]) {
    const value = cursor(); change(value);
    assert.equal(parseSummaryCursor(token(value), pageContext).valid, false);
  }
});

test("cursor page boundaries require safe integers and the five-entry page size", () => {
  for (const offset of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "5", null]) {
    assert.equal(validateSummaryCursor({ ...cursor(), offset }, pageContext).valid, false);
  }
  assert.equal(validateSummaryCursor({ ...cursor(), offset: 0 }, pageContext).valid, true);
  assert.equal(validateSummaryCursor({ ...cursor(), limit: 100 }, pageContext).valid, false);
  assert.equal(validateSummaryCursor({ ...cursor(), history: "hidden" }, pageContext).valid, false);
  for (const key of Object.keys(cursor())) {
    const value = cursor(); delete value[key];
    assert.equal(validateSummaryCursor(value, pageContext).valid, false);
  }
});

test("summary-issued cursor digests bind derived rows while earlier cursor shapes remain valid", () => {
  const source = "a".repeat(64);
  const scoped = { ...pageContext, source_sha256: source };
  assert.equal(validateSummaryCursor({ ...cursor(), source_sha256: source }, scoped).valid, true);
  assert.equal(validateSummaryCursor(cursor(), scoped).valid, false);
  assert.equal(validateSummaryCursor({ ...cursor(), source_sha256: "b".repeat(64) }, scoped).valid, false);
  assert.equal(validateSummaryCursor({ ...cursor(), source_sha256: "invalid" }, pageContext).valid, false);
  assert.equal(validateSummaryCursor(cursor(), { ...scoped, source_sha256: null }).valid, false);
  assert.equal(validateSummaryCursor(cursor(), pageContext).valid, true);
});

test("malformed, oversized, noncanonical or non-UTF-8 tokens fail without throwing", () => {
  for (const bad of [null, "", "not json", "a".repeat(2049), "A", token(cursor()) + "=", token([]),
    Buffer.from("not JSON").toString("base64url"), Buffer.from([0xff]).toString("base64url")]) {
    assert.equal(parseSummaryCursor(bad, pageContext).valid, false);
  }
  assert.equal(validateSummaryCursor(cursor(), null).valid, false);
  assert.equal(validateSummaryCursor(cursor(), { ...pageContext, collection: "history" }).valid, false);
});

test("summary contracts typecheck complete fixtures and reject invalid public fields without emitting code", () => {
  execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
    "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext",
    fileURLToPath(new URL("./fixtures/summary-contracts.types.ts", import.meta.url))], { encoding: "utf8", windowsHide: true });
});
