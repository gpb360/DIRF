import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGoverningArtifact } from "../src/artifacts.js";
import {
  acceptAttemptArtifact,
  createAttemptInStore,
  getAttempt,
  governingAttemptArtifact,
  listAttempts,
  listAttemptArtifacts,
  recordAttemptArtifact,
  registerProject,
} from "../src/state.js";

const CREATED = new Date("2026-08-12T18:30:00.000Z");
const ACCEPTED = new Date("2026-08-12T18:35:00.000Z");

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-artifact-state-home-"));
  process.env.DIRF_HOME = home;
  const root = mkdtempSync(join(tmpdir(), "dirf-artifact-project-"));
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "artifact state", CREATED);
  mkdirSync(join(attempt.folder, "artifacts"));
  return { home, root, slug, attempt };
}

function writeArtifact(attempt, filename, content = "# Plan\n") {
  const path = join(attempt.folder, "artifacts", filename);
  writeFileSync(path, content);
  return `artifacts/${filename}`;
}

function plan(attempt, id = "plan-1", overrides = {}) {
  return {
    id,
    type: "plan",
    path: writeArtifact(attempt, `${id}.md`),
    supersedes: [],
    ...overrides,
  };
}

test("artifact-free attempts list empty without changing their byte shape", () => {
  const { slug, attempt } = fixture();
  const metadataPath = join(attempt.folder, "attempt.json");
  const before = readFileSync(metadataPath, "utf8");
  assert.deepEqual(listAttemptArtifacts(slug, attempt.id), []);
  assert.equal(readFileSync(metadataPath, "utf8"), before);
  assert.equal(before.includes('"artifacts"'), false);
});

test("recordAttemptArtifact adds portable metadata through attempt.json", () => {
  const { slug, attempt, root } = fixture();
  const updated = recordAttemptArtifact(slug, attempt.id, plan(attempt), CREATED);
  assert.equal(updated.artifacts.length, 1);
  assert.deepEqual(updated.artifacts[0], {
    id: "plan-1",
    type: "plan",
    path: "artifacts/plan-1.md",
    supersedes: [],
    created_at: CREATED.toISOString(),
  });
  const persisted = readFileSync(join(attempt.folder, "attempt.json"), "utf8");
  assert.equal(persisted.includes(root), false);
  assert.deepEqual(listAttemptArtifacts(slug, attempt.id), updated.artifacts);
});

test("record persists only the portable artifact metadata contract", () => {
  const { slug, attempt } = fixture();
  const updated = recordAttemptArtifact(slug, attempt.id, plan(attempt, "plan-portable", {
    host_path: "C:\\Users\\garyp\\private-plan.md",
    provider_id: "runtime-provider-123",
  }), CREATED);
  assert.deepEqual(Object.keys(updated.artifacts[0]).sort(), ["created_at", "id", "path", "supersedes", "type"]);
  const persisted = readFileSync(join(attempt.folder, "attempt.json"), "utf8");
  assert.doesNotMatch(persisted, /host_path|provider_id|C:\\\\Users/);
});

test("malformed artifact state fails closed only at artifact-aware boundaries", () => {
  const { slug, attempt } = fixture();
  const legacy = createAttemptInStore(slug, "unrelated legacy", new Date("2026-08-12T18:31:00.000Z"));
  const metadataPath = join(attempt.folder, "attempt.json");
  const stored = JSON.parse(readFileSync(metadataPath, "utf8"));
  stored.artifacts = [
    { id: "loop-a", type: "plan", path: "../escape.md", created_at: CREATED.toISOString(), supersedes: ["loop-b"] },
    { id: "loop-b", type: "wat", path: "artifacts/other.md", created_at: "not-a-date", supersedes: ["loop-a"] },
    { id: "duplicate", type: "plan", path: "artifacts/duplicate-1.md", created_at: CREATED.toISOString(), supersedes: [] },
    { id: "duplicate", type: "plan", path: "artifacts/duplicate-2.md", created_at: CREATED.toISOString(), supersedes: [] },
  ];
  writeFileSync(metadataPath, JSON.stringify(stored, null, 2));

  assert.deepEqual(listAttempts(slug).map(({ id }) => id), [legacy.id, attempt.id].sort());
  assert.equal(getAttempt(slug, legacy.id).id, legacy.id);
  assert.equal(getAttempt(slug, attempt.id).id, attempt.id);
  assert.throws(() => listAttemptArtifacts(slug, attempt.id), (error) => {
    assert.match(error.message, /Invalid artifact graph/);
    assert.match(error.message, /attempt-relative/);
    assert.match(error.message, /id must be unique/);
    assert.match(error.message, /type must be one of/);
    assert.match(error.message, /supersedes cycle/);
    return true;
  });
});

test("record keeps acceptance explicit and rejects duplicate, escaping, and missing content", () => {
  const { slug, attempt } = fixture();
  assert.throws(
    () => recordAttemptArtifact(slug, attempt.id, plan(attempt, "preaccepted", { accepted_at: ACCEPTED.toISOString() }), CREATED),
    /accept.*separately/i,
  );

  recordAttemptArtifact(slug, attempt.id, plan(attempt), CREATED);
  assert.throws(() => recordAttemptArtifact(slug, attempt.id, plan(attempt), CREATED), /id must be unique/);
  assert.throws(
    () => recordAttemptArtifact(slug, attempt.id, { id: "escape", type: "plan", path: "../outside.md", supersedes: [] }, CREATED),
    /attempt-relative/,
  );
  assert.throws(
    () => recordAttemptArtifact(slug, attempt.id, { id: "missing", type: "plan", path: "artifacts/missing.md", supersedes: [] }, CREATED),
    /content does not exist/,
  );
});

test("artifact content must resolve to a regular file inside the attempt", (t) => {
  const { slug, attempt } = fixture();
  mkdirSync(join(attempt.folder, "artifacts", "directory"));
  assert.throws(
    () => recordAttemptArtifact(slug, attempt.id, { id: "directory", type: "plan", path: "artifacts/directory", supersedes: [] }, CREATED),
    /regular file/,
  );

  const outside = mkdtempSync(join(tmpdir(), "dirf-artifact-outside-"));
  writeFileSync(join(outside, "outside.md"), "# Outside\n");
  const link = join(attempt.folder, "artifacts", "outside-link");
  try {
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.diagnostic("symlink creation is unavailable in this environment");
      return;
    }
    throw error;
  }
  assert.throws(
    () => recordAttemptArtifact(slug, attempt.id, { id: "outside", type: "plan", path: "artifacts/outside-link/outside.md", supersedes: [] }, CREATED),
    /escapes the attempt folder/,
  );
});

test("acceptAttemptArtifact timestamps an existing artifact and is idempotent", () => {
  const { slug, attempt } = fixture();
  recordAttemptArtifact(slug, attempt.id, plan(attempt), CREATED);
  const accepted = acceptAttemptArtifact(slug, attempt.id, "plan-1", ACCEPTED);
  assert.equal(accepted.artifacts[0].accepted_at, ACCEPTED.toISOString());
  assert.equal(resolveGoverningArtifact(accepted.artifacts, "plan").id, "plan-1");

  const repeated = acceptAttemptArtifact(slug, attempt.id, "plan-1", new Date("2026-08-12T19:00:00.000Z"));
  assert.equal(repeated.artifacts[0].accepted_at, ACCEPTED.toISOString());
  assert.throws(() => acceptAttemptArtifact(slug, attempt.id, "missing", ACCEPTED), /No artifact/);
});

test("governing artifacts stop governing when their content disappears", () => {
  const { slug, attempt } = fixture();
  recordAttemptArtifact(slug, attempt.id, plan(attempt), CREATED);
  acceptAttemptArtifact(slug, attempt.id, "plan-1", ACCEPTED);
  rmSync(join(attempt.folder, "artifacts", "plan-1.md"));
  assert.equal(governingAttemptArtifact(getAttempt(slug, attempt.id), "plan"), null);
});

test("record validates a plan_delta file against the governing accepted plan", () => {
  const { slug, attempt } = fixture();
  recordAttemptArtifact(slug, attempt.id, plan(attempt, "plan-1"), CREATED);
  acceptAttemptArtifact(slug, attempt.id, "plan-1", new Date("2026-08-12T18:31:00.000Z"));
  recordAttemptArtifact(slug, attempt.id, plan(attempt, "plan-2", { supersedes: ["plan-1"] }), CREATED);
  acceptAttemptArtifact(slug, attempt.id, "plan-2", ACCEPTED);

  const invalidPath = writeArtifact(attempt, "invalid-delta.json", JSON.stringify({
    plan_artifact_id: "plan-1",
    implemented_as_planned: [], additions: [], omissions: [], unverifiable: [],
  }));
  assert.throws(
    () => recordAttemptArtifact(slug, attempt.id, { id: "delta-bad", type: "plan_delta", path: invalidPath, supersedes: [] }, CREATED),
    /governing accepted plan/,
  );

  const validPath = writeArtifact(attempt, "valid-delta.json", JSON.stringify({
    plan_artifact_id: "plan-2",
    implemented_as_planned: [{ id: "done", summary: "Pure artifact module", evidence: ["tests/artifacts.test.js"] }],
    additions: [], omissions: [], unverifiable: [],
  }));
  const updated = recordAttemptArtifact(slug, attempt.id, { id: "delta-1", type: "plan_delta", path: validPath, supersedes: [] }, CREATED);
  assert.equal(updated.artifacts.at(-1).type, "plan_delta");
});

test("superseding a plan leaves its delta historical and permits a replacement delta", () => {
  const { slug, attempt } = fixture();
  recordAttemptArtifact(slug, attempt.id, plan(attempt, "plan-1"), CREATED);
  acceptAttemptArtifact(slug, attempt.id, "plan-1", new Date("2026-08-12T18:31:00.000Z"));
  const deltaPath = writeArtifact(attempt, "delta.json", JSON.stringify({
    plan_artifact_id: "plan-1",
    implemented_as_planned: [], additions: [], omissions: [], unverifiable: [],
  }));
  recordAttemptArtifact(slug, attempt.id, { id: "delta-1", type: "plan_delta", path: deltaPath, supersedes: [] }, CREATED);
  acceptAttemptArtifact(slug, attempt.id, "delta-1", new Date("2026-08-12T18:32:00.000Z"));
  recordAttemptArtifact(slug, attempt.id, plan(attempt, "plan-2", { supersedes: ["plan-1"] }), CREATED);

  const withNewPlan = acceptAttemptArtifact(slug, attempt.id, "plan-2", ACCEPTED);
  assert.equal(governingAttemptArtifact(withNewPlan, "plan").id, "plan-2");
  assert.equal(governingAttemptArtifact(withNewPlan, "plan_delta"), null);

  const replacementPath = writeArtifact(attempt, "delta-2.json", JSON.stringify({
    plan_artifact_id: "plan-2",
    implemented_as_planned: [], additions: [], omissions: [], unverifiable: [],
  }));
  recordAttemptArtifact(slug, attempt.id, { id: "delta-2", type: "plan_delta", path: replacementPath, supersedes: ["delta-1"] }, CREATED);
  const replaced = acceptAttemptArtifact(slug, attempt.id, "delta-2", new Date("2026-08-12T18:36:00.000Z"));
  assert.equal(governingAttemptArtifact(replaced, "plan_delta").id, "delta-2");
});

test("a plan_delta requires the governing plan content to remain present", () => {
  const { slug, attempt } = fixture();
  recordAttemptArtifact(slug, attempt.id, plan(attempt), CREATED);
  acceptAttemptArtifact(slug, attempt.id, "plan-1", ACCEPTED);
  rmSync(join(attempt.folder, "artifacts", "plan-1.md"));
  const deltaPath = writeArtifact(attempt, "missing-plan-delta.json", JSON.stringify({
    plan_artifact_id: "plan-1",
    implemented_as_planned: [], additions: [], omissions: [], unverifiable: [],
  }));
  assert.throws(
    () => recordAttemptArtifact(slug, attempt.id, { id: "delta-missing-plan", type: "plan_delta", path: deltaPath, supersedes: [] }, CREATED),
    /Artifact content does not exist: artifacts\/plan-1\.md/,
  );
});

test("record rejects malformed plan_delta JSON without changing persisted artifacts", () => {
  const { slug, attempt } = fixture();
  recordAttemptArtifact(slug, attempt.id, plan(attempt), CREATED);
  acceptAttemptArtifact(slug, attempt.id, "plan-1", ACCEPTED);
  const malformedPath = writeArtifact(attempt, "malformed.json", "not json");
  const before = listAttemptArtifacts(slug, attempt.id);
  assert.throws(
    () => recordAttemptArtifact(slug, attempt.id, { id: "delta-bad", type: "plan_delta", path: malformedPath, supersedes: [] }, CREATED),
    /valid JSON/,
  );
  assert.deepEqual(listAttemptArtifacts(slug, attempt.id), before);
});
