import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const CLI = resolve("src", "cli.js");
const TIMEOUT = 30_000;

function run(args, cwd, home) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: TIMEOUT,
    env: { ...process.env, DIRF_HOME: home },
  });
}

function filesUnder(root) {
  const result = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else result.push(child);
    }
  }
  visit(root);
  return result;
}

test("dirf learn creates canonical learning artifacts without changing the host repository", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-cli-project-"));
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-home-"));
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT });
  writeFileSync(join(root, "sentinel.txt"), "unchanged\n");
  run(["setup", root], root, home);
  const before = execFileSync("git", ["status", "--short", "--untracked-files=all"], { cwd: root, encoding: "utf8" });

  const output = run([
    "learn",
    "A useful article says to keep adapters bounded and verify every integration.",
    "--path", root,
    "--name", "bounded-adapters",
    "--json",
  ], root, home);
  const result = JSON.parse(output);
  assert.equal(result.source.kind, "paste");
  assert.equal(result.repository_modified, false);
  assert.match(result.next, /^dirf resume /);

  const after = execFileSync("git", ["status", "--short", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  assert.equal(after, before);
  assert.equal(readFileSync(join(root, "sentinel.txt"), "utf8"), "unchanged\n");

  const artifacts = filesUnder(join(home, "projects")).filter((path) => path.includes(result.attempt));
  assert.ok(artifacts.some((path) => path.endsWith("learning-source.md")));
  assert.ok(artifacts.some((path) => path.endsWith("learning-source.json")));
  assert.ok(artifacts.some((path) => path.endsWith("learning-request.md")));
  const workflowPath = artifacts.find((path) => path.endsWith("workflow.json"));
  const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
  assert.match(workflow.task, /artifacts\/learning-request\.md/);
  assert.equal(workflow.playbook, "methodology-learning");
  assert.deepEqual(workflow.workflow.gates["choose the smallest justified adaptation"], {
    kind: "decision",
    artifact_type: "research",
  });
  const attempt = JSON.parse(readFileSync(artifacts.find((path) => path.endsWith("attempt.json")), "utf8"));
  assert.equal(attempt.artifacts.find((artifact) => artifact.id === "learning-source").type, "source");
  assert.ok(artifacts.every((path) => statSync(path).isFile()));
});

test("dirf learn requires an accepted recommendation and human decision before implementation", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-cli-project-"));
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-home-"));
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT });
  run(["setup", root], root, home);
  const created = JSON.parse(run([
    "learn", "A source proposes one reversible workflow experiment.",
    "--path", root, "--name", "approval-boundary", "--json",
  ], root, home));

  run(["resume", created.attempt, "--path", root, "--json"], root, home);
  let advanced = JSON.parse(run(["attempt", "advance", created.attempt, "--auto", "--path", root, "--json"], root, home));
  assert.equal(advanced.stopped_at_gate, "choose the smallest justified adaptation");

  run([
    "attempt", "gate", created.attempt, "choose the smallest justified adaptation",
    "accept", "--comment", "approved experiment", "--path", root, "--json",
  ], root, home);
  advanced = JSON.parse(run(["attempt", "advance", created.attempt, "--auto", "--path", root, "--json"], root, home));
  assert.equal(advanced.stopped_at_gate, "choose the smallest justified adaptation");

  const attemptJson = filesUnder(join(home, "projects")).find((path) => path.includes(created.attempt) && path.endsWith("attempt.json"));
  const attemptRoot = dirname(attemptJson);
  const recommendationPath = join(attemptRoot, "artifacts", "recommendation.md");
  const metadataPath = join(attemptRoot, "artifacts", "recommendation.json");
  writeFileSync(recommendationPath, "# Recommendation\n\nRun one reversible experiment.\n");
  writeFileSync(metadataPath, JSON.stringify({
    id: "learning-recommendation-v1",
    type: "research",
    path: "artifacts/recommendation.md",
    supersedes: [],
  }));
  run(["artifact", "record", created.attempt, "--file", metadataPath, "--path", root, "--json"], root, home);
  run(["artifact", "accept", created.attempt, "learning-recommendation-v1", "--path", root, "--json"], root, home);

  advanced = JSON.parse(run(["attempt", "advance", created.attempt, "--path", root, "--json"], root, home));
  assert.equal(advanced.current_phase, "implement one approved experiment or record no change");
});

test("package exposes only the canonical dirf CLI", () => {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  assert.equal(pkg.bin.dirf, "./src/cli.js");
  assert.equal(pkg.bin.derv, undefined);
});

test("dirf learn accepts piped stdin as the learning source", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-cli-piped-"));
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-piped-home-"));
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT });
  run(["setup", root], root, home);
  const piped = spawnSync(process.execPath, [CLI, "learn", "--path", root, "--json"], {
    cwd: root, encoding: "utf8", timeout: TIMEOUT,
    env: { ...process.env, DIRF_HOME: home },
    input: "Piped learning source: keep adapters bounded and verify every integration.\n",
  });
  assert.equal(piped.status, 0, piped.stderr);
  const result = JSON.parse(piped.stdout);
  assert.equal(result.source.kind, "paste");
  assert.equal(result.repository_modified, false);
});
