import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFlow } from "../src/flow.js";
import { bindingsFromPlan } from "../src/skill-bindings.js";
import { buildInstructions } from "../src/renderer.js";

const selection = { playbook: "demo", agents: [], skill_flow: { label: "demo", steps: [] } };
const index = {
  "clear-updates": { name: "clear-updates", description: "Concise user updates", invocation: "model", provider: "project" },
};

test("a named installed model skill is selected and bound to its executable instructions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dirf-explicit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "skills", "clear-updates");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), "# Clear updates\nLead with the result.\n");
  const flow = buildFlow(selection, { task: "Fix the bug using clear-updates", bundledIndex: {} },
    { "clear-updates": { ...index["clear-updates"], path } });
  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["clear-updates"]);
  assert.deepEqual(flow.gaps, []);
  const plan = { schema_version: 5, name: "demo", task: "Fix the bug using clear-updates", playbook: "demo", agents: [],
    workflow: { phases: ["fix"], output: "A fix" }, skill_flow: flow };
  const bindings = bindingsFromPlan(plan, root);
  assert.equal(bindings[0].entry, join(path, "SKILL.md").replaceAll("\\", "/"));
  const out = join(root, "instructions");
  buildInstructions(plan, out, bindings);
  assert.match(readFileSync(join(out, "skills", "01-clear-updates", "README.md"), "utf8"), /SKILL\.md/);
  assert.match(readFileSync(join(out, "README.md"), "utf8"), /Load and apply the selected skills in this order/);
});

test("installed communication skills stay optional unless named", () => {
  const flow = buildFlow(selection, { task: "Fix a bug and report the result", bundledIndex: {} }, index);
  assert.deepEqual(flow.steps, []);
});

test("an ordinary task word is not an explicit skill invocation", () => {
  const flow = buildFlow(selection, { task: "Fix a bug and add test coverage", bundledIndex: {} }, {
    test: { description: "Run tests", invocation: "model" },
  });
  assert.deepEqual(flow.steps, []);
});

test("explicit invocation supports command syntax and ordered skill lists", () => {
  const skills = { ...index, "brief-results": { ...index["clear-updates"], name: "brief-results" } };
  for (const task of ["/clear-updates", "$clear-updates", "Use clear-updates and brief-results"]) {
    const flow = buildFlow(selection, { task, bundledIndex: {} }, skills);
    assert.equal(flow.steps[0].skill, "clear-updates", task);
    if (task.includes("brief-results")) assert.equal(flow.steps[1].skill, "brief-results");
  }
});

test("a longer skill name does not invoke an unrelated skill with the same suffix", () => {
  const flow = buildFlow(selection, { task: "Use clear-updates", bundledIndex: {} }, {
    ...index, updates: { ...index["clear-updates"], name: "updates" },
  });
  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["clear-updates"]);
});

test("negated model skills stay excluded while a later affirmative request is retained", () => {
  const skills = { ...index, "brief-results": { ...index["clear-updates"], name: "brief-results" } };
  for (const task of [
    "Fix a bug without clear-updates or brief-results",
    "Fix a bug but do not use clear-updates and brief-results",
    "Fix a bug, never apply clear-updates or brief-results",
  ]) {
    assert.deepEqual(buildFlow(selection, { task, bundledIndex: {} }, skills).steps, [], task);
  }
  const flow = buildFlow(selection, {
    task: "Skip clear-updates and brief-results, then use brief-results", bundledIndex: {},
  }, skills);
  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["brief-results"]);
});

test("a negated skill is not selected automatically for a playbook capability", () => {
  const selected = { ...selection, skill_flow: { label: "demo", steps: [{ stage: "report", capability: "reporting", reason: "Report" }] } };
  const skills = { "clear-updates": { ...index["clear-updates"], capabilities: ["reporting"] } };
  const flow = buildFlow(selected, { task: "Report without clear-updates", bundledIndex: {} }, skills);
  assert.deepEqual(flow.steps, []);
  assert.equal(flow.gaps.length, 1);
});

test("a negated bundled fallback cannot re-enter through capability matching", () => {
  const selected = { ...selection, skill_flow: { label: "demo", steps: [{ stage: "report", capability: "reporting", reason: "Report" }] } };
  const flow = buildFlow(selected, { task: "Report without clear-updates", bundledIndex: {
    "clear-updates": { ...index["clear-updates"], capabilities: ["reporting"] },
  } }, {});
  assert.deepEqual(flow.steps, []);
  assert.equal(flow.gaps.length, 1);
});

test("a mixed negated list does not invoke a manual prose checkpoint", () => {
  const flow = buildFlow(selection, { task: "Fix without clear-updates and manual-repair", bundledIndex: {
    "manual-repair": { invocation: "user", capabilities: ["plain-language repair"] },
  } }, index);
  assert.deepEqual(flow.steps, []);
});

test("a profile cannot silently drop an explicitly requested model skill", () => {
  const flow = buildFlow(selection, { task: "Use clear-updates", allowedSkills: [], bundledIndex: {} }, index);
  assert.deepEqual(flow.steps, []);
  assert.equal(flow.gaps[0].blocking, true);
  assert.match(flow.gaps[0].question, /clear-updates.*excluded/);
});

test("an incomplete requested skill blocks even without a matching playbook capability", () => {
  const flow = buildFlow(selection, { task: "Use clear-updates", bundledIndex: {} }, {
    "clear-updates": { ...index["clear-updates"], readiness: "incomplete", missing_files: ["rules.md"] },
  });
  assert.deepEqual(flow.steps, []);
  assert.equal(flow.gaps[0].blocking, true);
  assert.match(flow.gaps[0].question, /rules\.md/);
});

test("human-only skills do not enter the model-skill supplemental path", () => {
  const flow = buildFlow(selection, { task: "Use clear-updates", bundledIndex: {} }, {
    "clear-updates": { ...index["clear-updates"], invocation: "user" },
  });
  assert.deepEqual(flow.steps, []);
});

test("an explicitly named skill already selected by capability is not duplicated", () => {
  const selected = { ...selection, skill_flow: { label: "demo", steps: [{ stage: "report", capability: "reporting", reason: "Report" }] } };
  const flow = buildFlow(selected, { task: "Use clear-updates", bundledIndex: {} }, {
    "clear-updates": { ...index["clear-updates"], capabilities: ["reporting"] },
  });
  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["clear-updates"]);
  assert.equal(flow.steps[0].stage, "report");
});
