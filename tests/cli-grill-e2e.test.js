import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

function writeSkill(home, name, description, body, extraFrontmatter = "") {
  const folder = join(home, ".codex", "skills", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    extraFrontmatter,
    "---",
    body,
    "",
  ].filter(Boolean).join("\n"));
}

function writeAgent(home, name) {
  const folder = join(home, ".codex", "agents");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${name}.md`), [
    "---",
    `name: ${name}`,
    `description: Installed ${name} for the end-to-end fixture`,
    "---",
    "Use the generated work contract.",
    "",
  ].join("\n"));
}

test("Grill Me builds, renders, resumes, and stops at its decision and verification gates", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-grill-home-"));
  const target = mkdtempSync(join(tmpdir(), "dirf-grill-target-"));
  const env = { DIRF_HOME: home, HOME: home, USERPROFILE: home };
  execFileSync("git", ["init", "-q"], { cwd: target, timeout: TIMEOUT });
  execFileSync("git", ["remote", "add", "origin", "https://example.invalid/fixture/dirf-grill.git"], { cwd: target, timeout: TIMEOUT });
  run(["setup", target], env, target);

  writeSkill(
    home,
    "grill-me",
    "A human command that starts a decision interview",
    "Run a `/grilling` session.",
    "disable-model-invocation: true",
  );
  writeSkill(home, "grilling", "A relentless interview to sharpen a plan or design", "Ask one decision at a time.");
  writeSkill(home, "ponytail", "Choose the smallest correct implementation", "Use the reuse ladder.");
  for (const name of ["workflow-orchestrator", "agent-organizer", "dx-optimizer"]) writeAgent(home, name);

  const built = JSON.parse(run([
    "build", "grill-e2e", "grill me about this design before implementation",
    "--path", target, "--json",
  ], env, target));
  const attemptFolder = dirname(built.workflow);
  const workflow = JSON.parse(readFileSync(built.workflow, "utf8"));

  assert.equal(workflow.playbook, "improve-plan");
  assert.deepEqual(workflow.skill_flow.steps.map(({ skill }) => skill), ["grill-me", "grilling", "ponytail"]);
  assert.equal(workflow.skill_flow.steps[0].invocation, "user");
  assert.equal(workflow.skill_flow.steps[0].human_checkpoint, true);
  assert.deepEqual(workflow.workflow.gates["confirm shared understanding"], { kind: "decision" });
  assert.deepEqual(workflow.workflow.gates["assign agents and ownership"], { kind: "verify" });
  assert.ok(workflow.agents.every((agent) => agent.status === "installed"));
  assert.doesNotMatch(JSON.stringify(workflow), /\.codex[\\/]skills/);

  for (const relative of [
    "README.md",
    "instructions.html",
    join("agents", "workflow-orchestrator.md"),
    join("skills", "01-grill-me", "README.md"),
    join("skills", "02-grilling", "README.md"),
    join("skills", "03-ponytail", "README.md"),
  ]) assert.equal(existsSync(join(attemptFolder, relative)), true, `missing rendered file ${relative}`);

  const readme = readFileSync(join(attemptFolder, "README.md"), "utf8");
  const agent = readFileSync(join(attemptFolder, "agents", "workflow-orchestrator.md"), "utf8");
  assert.match(readme, /User checkpoint.*grill-me/);
  assert.match(readme, /confirm shared understanding.*decision gate/);
  assert.match(agent, /## Work contract/);
  assert.match(agent, /Ask one unresolved decision at a time/);
  assert.match(agent, /stop before implementation until the decision gate is accepted/);

  const resumed = JSON.parse(run(["resume", built.attempt.id, "--path", target, "--json"], env, target));
  assert.equal(resumed.attempt.id, built.attempt.id);
  assert.equal(resumed.attempt.status, "in_progress");

  const stoppedAtDecision = JSON.parse(run([
    "attempt", "advance", built.attempt.id, "--auto", "--path", target, "--json",
  ], env, target));
  assert.equal(stoppedAtDecision.current_phase, "confirm shared understanding");
  assert.equal(stoppedAtDecision.stopped_at_gate, "confirm shared understanding");

  const accepted = JSON.parse(run([
    "attempt", "gate", built.attempt.id, "confirm shared understanding", "accept",
    "--comment", "fixture accepted", "--path", target, "--json",
  ], env, target));
  assert.equal(accepted.gates.find((gate) => gate.phase === "confirm shared understanding").status, "accepted");

  const stoppedAtVerification = JSON.parse(run([
    "attempt", "advance", built.attempt.id, "--auto", "--path", target, "--json",
  ], env, target));
  assert.equal(stoppedAtVerification.current_phase, "assign agents and ownership");
  assert.equal(stoppedAtVerification.stopped_at_gate, "assign agents and ownership");

  const rerendered = run(["render", built.attempt.id, "--path", target], env, target);
  assert.match(rerendered, /Spec kit rendered:/);
});
