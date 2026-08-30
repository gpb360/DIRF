import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

test("Grill Me builds, renders, resumes, and respects its decision and soft gates", () => {
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
  assert.deepEqual(workflow.skill_flow.steps.map(({ skill }) => skill), ["model-advice", "grill-me", "grilling", "ponytail"]);
  assert.equal(workflow.skill_flow.steps[1].invocation, "user");
  assert.equal(workflow.skill_flow.steps[1].human_checkpoint, true);
  assert.deepEqual(workflow.workflow.gates["confirm shared understanding"], { kind: "decision" });
  assert.deepEqual(workflow.workflow.gates["assign agents and ownership"], { kind: "soft" });
  assert.ok(workflow.workflow.phases.slice(0, -1).every((phase) => workflow.workflow.gates[phase]), "every non-final phase must declare a gate");
  assert.deepEqual(Object.keys(workflow.workflow.agent_contracts).sort(), ["agent-organizer", "dx-optimizer", "workflow-orchestrator"]);
  assert.ok(workflow.agents.every((agent) => agent.status === "installed"));
  assert.doesNotMatch(JSON.stringify(workflow), /\.codex[\\/]skills/);
  assert.equal(workflow.model_advice.status, "unavailable");
  assert.equal(workflow.model_advice.advisory_only, true);
  assert.equal(workflow.model_advice.invoked_models, false);
  assert.equal(workflow.model_advice.live_monitoring, false);
  assert.equal(workflow.model_advice.pricing_lookup, false);

  for (const relative of [
    "README.md",
    "instructions.html",
    join("agents", "workflow-orchestrator.md"),
    join("agents", "agent-organizer.md"),
    join("agents", "dx-optimizer.md"),
    join("skills", "01-model-advice", "README.md"),
    join("skills", "02-grill-me", "README.md"),
    join("skills", "03-grilling", "README.md"),
    join("skills", "04-ponytail", "README.md"),
  ]) assert.equal(existsSync(join(attemptFolder, relative)), true, `missing rendered file ${relative}`);

  const readme = readFileSync(join(attemptFolder, "README.md"), "utf8");
  const agent = readFileSync(join(attemptFolder, "agents", "workflow-orchestrator.md"), "utf8");
  const organizer = readFileSync(join(attemptFolder, "agents", "agent-organizer.md"), "utf8");
  const optimizer = readFileSync(join(attemptFolder, "agents", "dx-optimizer.md"), "utf8");
  const html = readFileSync(join(attemptFolder, "instructions.html"), "utf8");
  assert.match(readme, /User checkpoint.*grill-me/);
  assert.match(readme, /confirm shared understanding.*decision gate/);
  assert.match(agent, /## Work contract/);
  assert.match(agent, /Selected interview engine: `grilling`/);
  assert.match(agent, /recording decisions and contradictions/);
  assert.match(agent, /## Done when/);
  assert.match(organizer, /Owned phases: review preflight model advice, partition the confirmed work, assign agents and ownership/);
  assert.match(organizer, /bounded, non-overlapping agent assignments/);
  assert.match(optimizer, /Owned phases: define verification gates/);
  assert.match(optimizer, /concrete verification commands/);
  assert.equal((html.match(/<h3>Done when<\/h3>/g) || []).length, 3);
  assert.match(html, /decision gate/);
  assert.match(html, /soft check/);
  assert.match(html, /Gate rules: advancing past a verify phase requires recorded evidence/);
  assert.match(readme, /Model advice \(diagnostic preflight\)[\s\S]*did not provide a model catalog/);
  assert.match(html, /Model advice \(diagnostic preflight\)[\s\S]*did not provide a model catalog/);

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

  const continuedToFinalPhase = JSON.parse(run([
    "attempt", "advance", built.attempt.id, "--auto", "--path", target, "--json",
  ], env, target));
  assert.equal(continuedToFinalPhase.current_phase, "define verification gates");
  assert.equal(continuedToFinalPhase.stopped_at_gate, null);
  assert.equal(continuedToFinalPhase.gates.find((gate) => gate.phase === "assign agents and ownership").status, "passed");
  assert.ok(!continuedToFinalPhase.pending_gates.includes("assign agents and ownership"));

  const rerendered = run(["render", built.attempt.id, "--path", target], env, target);
  assert.match(rerendered, /Spec kit rendered:/);
});

test("Grill With Docs binds its interview engine and documentation dependency", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-grill-docs-home-"));
  const target = mkdtempSync(join(tmpdir(), "dirf-grill-docs-target-"));
  const env = { DIRF_HOME: home, HOME: home, USERPROFILE: home };
  execFileSync("git", ["init", "-q"], { cwd: target, timeout: TIMEOUT });
  execFileSync("git", ["remote", "add", "origin", "https://example.invalid/fixture/dirf-grill-docs.git"], { cwd: target, timeout: TIMEOUT });
  run(["setup", target], env, target);

  writeSkill(
    home,
    "grill-with-docs",
    "A human command that starts a stateful decision interview",
    "Run `/grilling`, then use `/domain-modeling` for accepted documentation decisions.",
    "disable-model-invocation: true",
  );
  writeSkill(home, "grilling", "A relentless interview to sharpen a plan or design", "Ask one decision at a time.");
  writeSkill(home, "domain-modeling", "Maintain a domain glossary and justified ADRs", "Record accepted domain decisions.");
  writeSkill(home, "ponytail", "Choose the smallest correct implementation", "Use the reuse ladder.");
  for (const name of ["workflow-orchestrator", "documentation-engineer", "agent-organizer", "dx-optimizer"]) writeAgent(home, name);
  const modelCatalog = join(target, "models.json");
  writeFileSync(modelCatalog, JSON.stringify({ models: [
    { name: "small-planner", cost_tier: "low", capabilities: ["plan interview", "minimalism"] },
    { name: "frontier", cost_tier: "high", capabilities: ["*"] },
  ] }));

  const built = JSON.parse(run([
    "build", "grill-docs-e2e", "grill with docs before implementation",
    "--path", target, "--models", modelCatalog, "--json",
  ], env, target));
  const workflow = JSON.parse(readFileSync(built.workflow, "utf8"));

  assert.equal(workflow.playbook, "improve-plan");
  assert.deepEqual(workflow.skill_flow.steps.map(({ skill }) => skill), [
    "model-advice", "grill-with-docs", "grilling", "domain-modeling", "ponytail",
  ]);
  assert.equal(workflow.skill_flow.steps[1].human_checkpoint, true);
  assert.match(workflow.skill_flow.steps[3].selection_reason, /dependency referenced by explicit human router grill-with-docs/);
  assert.deepEqual(workflow.skill_flow.gaps, []);
  assert.ok(workflow.workflow.phases.indexOf("record accepted domain language and durable decisions") >
    workflow.workflow.phases.indexOf("confirm shared understanding"));
  assert.ok(workflow.agents.some((agent) => agent.name === "documentation-engineer" && agent.status === "installed"));
  assert.deepEqual(workflow.workflow.agent_contracts["documentation-engineer"].phases, [
    "record accepted domain language and durable decisions",
  ]);
  assert.equal(workflow.model_advice.status, "recommended");
  assert.match(workflow.model_advice.catalog_sha256, /^[a-f0-9]{64}$/);
  assert.ok(workflow.model_advice.recommendations.some((item) =>
    item.model === "small-planner" && item.capabilities.includes("plan interview")));
  assert.ok(workflow.model_advice.recommendations.some((item) =>
    item.model === "frontier" && item.capabilities.includes("domain modeling")));
  assert.doesNotMatch(JSON.stringify(workflow.model_advice), /models\.json/);
  const rendered = readFileSync(join(dirname(built.workflow), "README.md"), "utf8");
  assert.match(rendered, /small-planner \(low\)/);
  assert.match(rendered, /did not invoke a model, monitor a session, query live pricing, or authorize spend/);
});

test("a mixed Grill Me request continues into the requested PR review", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-grill-review-home-"));
  const target = mkdtempSync(join(tmpdir(), "dirf-grill-review-target-"));
  const env = { DIRF_HOME: home, HOME: home, USERPROFILE: home };
  execFileSync("git", ["init", "-q"], { cwd: target, timeout: TIMEOUT });
  execFileSync("git", ["remote", "add", "origin", "https://example.invalid/fixture/dirf-grill-review.git"], { cwd: target, timeout: TIMEOUT });
  run(["setup", target], env, target);

  writeSkill(home, "grill-me", "A human command that starts a decision interview", "Run a `/grilling` session.", "disable-model-invocation: true");
  writeSkill(home, "grilling", "A relentless interview to sharpen a plan or design", "Ask one decision at a time.");
  writeSkill(home, "ponytail", "Choose the smallest correct implementation", "Use the reuse ladder.");
  writeSkill(home, "code-review", "Review code against its contract", "Review the frozen diff.");
  writeSkill(home, "security-review", "Review applicable trust boundaries", "Check security risks.");
  writeSkill(home, "testing", "Run focused verification", "Prove or disprove findings.");
  for (const name of [
    "workflow-orchestrator", "agent-organizer", "dx-optimizer", "test-engineer",
    "security-auditor", "performance-benchmarker",
  ]) writeAgent(home, name);

  const built = JSON.parse(run([
    "build", "grill-review-e2e", "Review PR 47 and grill me about the risks first",
    "--path", target, "--json",
  ], env, target));
  const attemptFolder = dirname(built.workflow);
  const workflow = JSON.parse(readFileSync(built.workflow, "utf8"));
  assert.equal(workflow.playbook, "improve-plan");
  assert.equal(workflow.continuation.playbook, "pr-review");
  assert.ok(workflow.workflow.phases.indexOf("freeze exact base and head") >
    workflow.workflow.phases.indexOf("confirm shared understanding"));
  assert.ok(workflow.skill_flow.steps.some((step) => step.skill === "code-review"));
  assert.match(readFileSync(join(attemptFolder, "README.md"), "utf8"), /Continued task[\s\S]*pr-review/);
  assert.match(readFileSync(join(attemptFolder, "instructions.html"), "utf8"), /Continued task[\s\S]*pr-review/);

  run(["resume", built.attempt.id, "--path", target, "--json"], env, target);
  const stopped = JSON.parse(run(["attempt", "advance", built.attempt.id, "--auto", "--path", target, "--json"], env, target));
  assert.equal(stopped.stopped_at_gate, "confirm shared understanding");
  run([
    "attempt", "gate", built.attempt.id, "confirm shared understanding", "accept",
    "--comment", "review scope confirmed", "--path", target, "--json",
  ], env, target);
  const continued = JSON.parse(run(["attempt", "advance", built.attempt.id, "--auto", "--path", target, "--json"], env, target));
  assert.equal(continued.current_phase, "recheck head and deduplicate before posting");
  assert.equal(continued.gates.find((gate) => gate.phase === "define verification gates").status, "passed");
});

test("negated and action-first interview requests stay coherent end to end", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-grill-order-home-"));
  const target = mkdtempSync(join(tmpdir(), "dirf-grill-order-target-"));
  const env = { DIRF_HOME: home, HOME: home, USERPROFILE: home };
  execFileSync("git", ["init", "-q"], { cwd: target, timeout: TIMEOUT });
  execFileSync("git", ["remote", "add", "origin", "https://example.invalid/fixture/dirf-grill-order.git"], { cwd: target, timeout: TIMEOUT });
  run(["setup", target], env, target);

  writeSkill(home, "grill-me", "A human command that starts a decision interview", "Run a `/grilling` session.", "disable-model-invocation: true");
  writeSkill(home, "grill-with-docs", "A human command that starts a decision interview with documentation", "Run `/grilling`, then use `/domain-modeling`.", "disable-model-invocation: true");
  writeSkill(home, "grilling", "A relentless interview to sharpen a plan or design", "Ask one decision at a time.");
  writeSkill(home, "domain-modeling", "Domain modeling for accepted language", "Record accepted domain terms.");
  writeSkill(home, "plan-interview", "Resolve plan decisions without Grill Me", "Ask one decision at a time.");
  writeSkill(home, "ponytail", "Choose the smallest correct implementation", "Use the reuse ladder.");
  writeSkill(home, "code-review", "Review code against its contract", "Review the frozen diff.");
  writeSkill(home, "security-review", "Review applicable trust boundaries", "Check security risks.");
  writeSkill(home, "testing", "Run focused verification", "Prove or disprove findings.");
  for (const name of [
    "workflow-orchestrator", "agent-organizer", "dx-optimizer", "test-engineer",
    "security-auditor", "performance-benchmarker",
  ]) writeAgent(home, name);

  const negated = JSON.parse(run([
    "build", "negated-grill", "Do not grill me; improve the plan another way",
    "--path", target, "--json",
  ], env, target));
  const negatedWorkflow = JSON.parse(readFileSync(negated.workflow, "utf8"));
  assert.ok(negatedWorkflow.skill_flow.steps.some((step) => step.skill === "plan-interview"));
  assert.ok(negatedWorkflow.skill_flow.steps.every((step) => !["grill-me", "grilling"].includes(step.skill)));

  for (const [name, task] of [
    ["negated-interview", "Do not interview me; improve the plan another way"],
    ["negated-question", "Do not question me; improve the plan another way"],
  ]) {
    const built = JSON.parse(run(["build", name, task, "--path", target, "--json"], env, target));
    const workflow = JSON.parse(readFileSync(built.workflow, "utf8"));
    assert.ok(workflow.skill_flow.steps.every((step) =>
      !["grill-me", "grill-with-docs", "grilling", "plan-interview"].includes(step.skill)), task);
    assert.ok(workflow.skill_flow.steps.every((step) => step.capability !== "plan interview"), task);
    assert.equal(workflow.questions.length, 0, task);
    assert.ok(workflow.workflow.phases.includes("draft the smallest evidence-based plan"), task);
    assert.doesNotMatch(JSON.stringify(workflow.workflow), /ask and record|confirm shared understanding/i, task);
    const readme = readFileSync(join(dirname(built.workflow), "README.md"), "utf8");
    assert.doesNotMatch(readme, /ask and record one decision|confirm shared understanding/i, task);
  }

  const withDocs = JSON.parse(run([
    "build", "replace-grill", "Do not grill me; grill with docs instead",
    "--path", target, "--json",
  ], env, target));
  const withDocsWorkflow = JSON.parse(readFileSync(withDocs.workflow, "utf8"));
  assert.ok(withDocsWorkflow.skill_flow.steps.some((step) => step.skill === "grill-with-docs"));
  assert.ok(withDocsWorkflow.skill_flow.steps.some((step) => step.skill === "grilling"));
  assert.ok(withDocsWorkflow.skill_flow.steps.every((step) => step.skill !== "grill-me"));

  const withoutDocs = JSON.parse(run([
    "build", "replace-docs-grill", "Do not grill with docs; grill me without documentation",
    "--path", target, "--json",
  ], env, target));
  const withoutDocsWorkflow = JSON.parse(readFileSync(withoutDocs.workflow, "utf8"));
  assert.ok(withoutDocsWorkflow.skill_flow.steps.some((step) => step.skill === "grill-me"));
  assert.ok(withoutDocsWorkflow.skill_flow.steps.some((step) => step.skill === "grilling"));
  assert.ok(withoutDocsWorkflow.skill_flow.steps.every((step) =>
    !["grill-with-docs", "domain-modeling"].includes(step.skill)));

  const actionFirst = JSON.parse(run([
    "build", "review-then-grill", "Review PR 47 and grill me",
    "--path", target, "--json",
  ], env, target));
  const actionWorkflow = JSON.parse(readFileSync(actionFirst.workflow, "utf8"));
  assert.equal(actionWorkflow.playbook, "pr-review");
  assert.equal(actionWorkflow.continuation.playbook, "improve-plan");
  assert.equal(actionWorkflow.continuation.transition, "after-primary");
  assert.equal(actionWorkflow.model_advice.status, "unavailable");
  assert.ok(actionWorkflow.model_advice.uncovered_capabilities.includes("plan interview"));
  const readme = readFileSync(join(dirname(actionFirst.workflow), "README.md"), "utf8");
  assert.match(readme, /After the primary workflow is complete/);
  assert.doesNotMatch(readme, /After the interview decision is accepted/);
});

test("a broken explicit human router fails validation before an attempt is created", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-grill-broken-home-"));
  const target = mkdtempSync(join(tmpdir(), "dirf-grill-broken-target-"));
  const env = { ...process.env, DIRF_HOME: home, HOME: home, USERPROFILE: home };
  execFileSync("git", ["init", "-q"], { cwd: target, timeout: TIMEOUT });
  execFileSync("git", ["remote", "add", "origin", "https://example.invalid/fixture/dirf-grill-broken.git"], { cwd: target, timeout: TIMEOUT });
  run(["setup", target], env, target);
  writeSkill(
    home,
    "grill-me",
    "A human command that starts a decision interview",
    "Run a `/missing-engine` session.",
    "disable-model-invocation: true",
  );

  const result = spawnSync(process.execPath, [
    CLI, "build", "broken-grill", "Review PR 47 and grill me about the risks first", "--path", target,
  ], { cwd: target, encoding: "utf8", timeout: TIMEOUT, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Task Routing validation failed/);
  assert.match(result.stderr, /grill-me is human-invoked but none of its installed model-invoked references covers plan interview/);
  const slug = readdirSync(join(home, "projects"))[0];
  const attempts = join(home, "projects", slug, "attempts");
  assert.equal(existsSync(attempts) ? readdirSync(attempts).length : 0, 0);
});
