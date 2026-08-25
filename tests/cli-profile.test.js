import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: TIMEOUT,
    env: { ...process.env, ...env },
  });
}

function writeSkill(home, name, description) {
  const folder = join(home, ".codex", "skills", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nUse this skill.\n`);
}

test("create --profile routes only through the named skills and records missing entries", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-profile-home-"));
  const target = mkdtempSync(join(tmpdir(), "dirf-profile-target-"));
  const env = { DIRF_HOME: home, HOME: home, USERPROFILE: home };
  execFileSync("git", ["init", "-q"], { cwd: target, timeout: TIMEOUT });
  run(["setup", target], env, target);
  writeSkill(home, "tdd", "Test-first development with red and green checks");
  writeSkill(home, "code-review", "Review code against standards and specifications");

  const profilePath = join(target, "focused-profile.json");
  writeFileSync(profilePath, JSON.stringify({ skills: ["tdd", "missing-skill"] }));
  const output = run([
    "create", "profiled", "build a feature", "--path", target, "--profile", profilePath,
  ], env, target);
  const attemptId = output.match(/Attempt saved: (\S+)/)?.[1];
  assert.ok(attemptId, output);

  const slug = readdirSync(join(home, "projects"))[0];
  const workflow = JSON.parse(readFileSync(join(home, "projects", slug, "attempts", attemptId, "workflow.json"), "utf8"));
  assert.deepEqual(workflow.capability_profile, {
    skills: ["tdd", "missing-skill"],
    missing: ["missing-skill"],
  });
  assert.ok(workflow.skill_flow.steps.some((step) => step.skill === "tdd"));
  assert.ok(workflow.skill_flow.steps.every((step) => step.skill === "tdd"));
  assert.ok(workflow.skill_flow.gaps.length > 0);
  assert.ok(workflow.questions.some((question) => question.includes("missing-skill")));
  assert.doesNotMatch(JSON.stringify(workflow), new RegExp(profilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const flow = run(["flow", "build a feature", "--path", target, "--profile", profilePath], env, target);
  assert.match(flow, /Profile skills: tdd, missing-skill/);
  assert.match(flow, /Profile gaps: missing-skill/);
  assert.doesNotMatch(flow, /code-review/);

  const scan = run(["skills", "scan", "--path", target, "--profile", profilePath], env, target);
  assert.match(scan, /tdd/);
  assert.match(scan, /code-review/);

  for (const [command, label, args] of [
    ["build", "Attempt", ["profiled-build", "build a feature"]],
    ["plan", "Plan", ["profiled-plan", "build a feature"]],
    ["learn", "Attempt", ["profile source text"]],
  ]) {
    const commandOutput = run([command, ...args, "--path", target, "--profile", profilePath], env, target);
    const commandAttemptId = commandOutput.match(new RegExp(`${label}(?: saved)?: (\\S+)`))?.[1];
    assert.ok(commandAttemptId, commandOutput);
    const commandWorkflow = JSON.parse(readFileSync(
      join(home, "projects", slug, "attempts", commandAttemptId, "workflow.json"), "utf8",
    ));
    assert.deepEqual(commandWorkflow.capability_profile, workflow.capability_profile);
  }
});

test("create --profile rejects a malformed skills allowlist", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-profile-invalid-home-"));
  const target = mkdtempSync(join(tmpdir(), "dirf-profile-invalid-target-"));
  const env = { ...process.env, DIRF_HOME: home, HOME: home, USERPROFILE: home };
  execFileSync("git", ["init", "-q"], { cwd: target, timeout: TIMEOUT });
  run(["setup", target], env, target);
  const profilePath = join(target, "invalid-profile.json");
  writeFileSync(profilePath, JSON.stringify({ skills: "tdd" }));

  const result = spawnSync(process.execPath, [
    CLI, "create", "profiled", "build a feature", "--path", target, "--profile", profilePath,
  ], { cwd: target, encoding: "utf8", timeout: TIMEOUT, env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Capability profile must be an object with a "skills" array/);

  writeFileSync(profilePath, JSON.stringify({ skills: [resolve(target, "tdd")] }));
  const pathResult = spawnSync(process.execPath, [
    CLI, "create", "profiled", "build a feature", "--path", target, "--profile", profilePath,
  ], { cwd: target, encoding: "utf8", timeout: TIMEOUT, env });
  assert.notEqual(pathResult.status, 0);
  assert.match(pathResult.stderr, /Capability profile skills must be names, not paths/);
});
