import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-artifacts-home-"));
  const root = mkdtempSync(join(tmpdir(), "dirf-cli-artifacts-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT });
  const env = { DIRF_HOME: home };
  run(["setup", root], env, root);
  const built = JSON.parse(run(["build", "artifact-cli", "test artifact commands", "--path", root, "--json"], env, root));
  const [project] = JSON.parse(run(["state", "list", "--json"], env, root));
  const attemptFolder = join(home, "projects", project.slug, "attempts", built.attempt.id);
  mkdirSync(join(attemptFolder, "artifacts"));
  writeFileSync(join(attemptFolder, "artifacts", "plan.md"), "# Plan\n");
  const metadataPath = join(root, "plan-artifact.json");
  writeFileSync(metadataPath, JSON.stringify({ id: "plan-v1", type: "plan", path: "artifacts/plan.md" }));
  return { home, root, env, attempt: built.attempt, attemptFolder, metadataPath };
}

test("artifact record, list, and accept round-trip through JSON", () => {
  const { root, env, attempt, metadataPath } = fixture();

  const recorded = JSON.parse(run(["artifact", "record", attempt.id, "--file", metadataPath, "--path", root, "--json"], env, root));
  assert.equal(recorded.artifacts[0].id, "plan-v1");
  assert.equal(recorded.artifacts[0].accepted_at, undefined);
  assert.equal(recorded.governing.plan, null);

  const listed = JSON.parse(run(["artifact", "list", attempt.id, "--path", root, "--json"], env, root));
  assert.deepEqual(listed, recorded);

  const accepted = JSON.parse(run(["artifact", "accept", attempt.id, "plan-v1", "--path", root, "--json"], env, root));
  assert.match(accepted.artifacts[0].accepted_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(accepted.artifacts[0].accepted_sha256, /^[a-f0-9]{64}$/);
  assert.equal(accepted.governing.plan.id, "plan-v1");

  const text = run(["artifact", "list", attempt.id, "--path", root], env, root);
  assert.match(text, /plan-v1\s+plan\s+accepted/);
  assert.match(text, /governing: plan-v1/);
});

test("artifact state is shared across linked worktrees", () => {
  const { root, env, attempt, metadataPath } = fixture();
  writeFileSync(join(root, "README.md"), "# Fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root, timeout: TIMEOUT });
  execFileSync("git", ["commit", "-q", "-m", "fixture"], {
    cwd: root,
    timeout: TIMEOUT,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "DIRF Test",
      GIT_AUTHOR_EMAIL: "dirf@example.test",
      GIT_COMMITTER_NAME: "DIRF Test",
      GIT_COMMITTER_EMAIL: "dirf@example.test",
    },
  });
  const worktree = join(tmpdir(), `dirf-cli-artifacts-wt-${Date.now()}`);
  execFileSync("git", ["worktree", "add", "-q", "-b", `artifact-wt-${Date.now()}`, worktree], {
    cwd: root,
    timeout: TIMEOUT,
  });

  run(["artifact", "record", attempt.id, "--file", metadataPath, "--path", root, "--json"], env, root);
  const listed = JSON.parse(run(["artifact", "list", attempt.id, "--path", worktree, "--json"], env, worktree));
  assert.equal(listed.artifacts[0].id, "plan-v1");

  run(["artifact", "accept", attempt.id, "plan-v1", "--path", worktree, "--json"], env, worktree);
  const fromMain = JSON.parse(run(["artifact", "list", attempt.id, "--path", root, "--json"], env, root));
  assert.equal(fromMain.governing.plan.id, "plan-v1");
});

test("artifact list reports deleted governing content", () => {
  const { root, env, attempt, attemptFolder, metadataPath } = fixture();
  run(["artifact", "record", attempt.id, "--file", metadataPath, "--path", root, "--json"], env, root);
  run(["artifact", "accept", attempt.id, "plan-v1", "--path", root, "--json"], env, root);
  rmSync(join(attemptFolder, "artifacts", "plan.md"));

  const failed = spawnSync(process.execPath, [CLI, "artifact", "list", attempt.id, "--path", root, "--json"], {
    cwd: root, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Artifact content does not exist: artifacts\/plan\.md/);
});

test("artifact add remains an alias for record", () => {
  const { root, env, attempt, metadataPath } = fixture();
  const added = JSON.parse(run(["artifact", "add", attempt.id, "--file", metadataPath, "--path", root, "--json"], env, root));
  assert.equal(added.artifacts[0].id, "plan-v1");
});

test("artifact record failures exit non-zero without persisting metadata", () => {
  const { root, env, attempt } = fixture();
  const metadataPath = join(root, "missing-artifact.json");
  writeFileSync(metadataPath, JSON.stringify({ id: "missing", type: "plan", path: "artifacts/missing.md" }));
  const failed = spawnSync(process.execPath, [CLI, "artifact", "record", attempt.id, "--file", metadataPath, "--path", root, "--json"], {
    cwd: root, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Artifact content does not exist/);
  const listed = JSON.parse(run(["artifact", "list", attempt.id, "--path", root, "--json"], env, root));
  assert.deepEqual(listed.artifacts, []);
});

test("typed plan provenance and plan_delta complete an end-to-end acceptance scenario", () => {
  const { root, env, attempt, attemptFolder, metadataPath } = fixture();
  run(["artifact", "record", attempt.id, "--file", metadataPath, "--path", root, "--json"], env, root);
  run(["artifact", "accept", attempt.id, "plan-v1", "--path", root, "--json"], env, root);

  const deltaPath = join(attemptFolder, "artifacts", "plan-delta.json");
  writeFileSync(deltaPath, JSON.stringify({
    plan_artifact_id: "plan-v1",
    implemented_as_planned: [{ id: "cli", summary: "Artifact CLI shipped", evidence: ["src/cli.js", "tests/cli-artifacts.test.js"] }],
    additions: [{ id: "alias", summary: "Kept add as a compatibility alias", reason: "The pattern map used the earlier command name", evidence: ["src/cli.js"] }],
    omissions: [],
    unverifiable: [],
  }));
  const deltaMetadata = join(root, "plan-delta-artifact.json");
  writeFileSync(deltaMetadata, JSON.stringify({
    id: "plan-delta-v1", type: "plan_delta", path: "artifacts/plan-delta.json", supersedes: [],
  }));

  const recorded = JSON.parse(run(["artifact", "record", attempt.id, "--file", deltaMetadata, "--path", root, "--json"], env, root));
  assert.equal(recorded.governing.plan.id, "plan-v1");
  assert.equal(recorded.governing.plan_delta, null);
  assert.equal(recorded.governance_trace.plan.governing.id, "plan-v1");
  assert.equal(recorded.governance_trace.plan.selected_by, "only eligible leaf");

  const accepted = JSON.parse(run(["artifact", "accept", attempt.id, "plan-delta-v1", "--path", root, "--json"], env, root));
  assert.equal(accepted.governing.plan.id, "plan-v1");
  assert.equal(accepted.governing.plan_delta.id, "plan-delta-v1");
});
