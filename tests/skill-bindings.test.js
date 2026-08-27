import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindingsFromPlan,
  refreshSkillBindings,
} from "../src/skill-bindings.js";

function plan(path, provider = "project") {
  return { skill_flow: { steps: [{ skill: "testing", provider, path }] } };
}

test("refresh checks a saved binding without scanning installed skills", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-binding-root-"));
  const skill = join(root, ".agents", "skills", "testing");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# Testing\n");
  const workflow = plan(skill);
  const saved = bindingsFromPlan(workflow, root);

  const bindings = refreshSkillBindings(workflow, saved, root, {
    discoverSkills() { throw new Error("normal refresh must not scan"); },
  });

  assert.equal(bindings[0].status, "installed");
  assert.equal(bindings[0].relative_entry, ".agents/skills/testing/SKILL.md");
});

test("a project binding follows the same relative path into another worktree", () => {
  const primary = mkdtempSync(join(tmpdir(), "dirf-binding-primary-"));
  const linked = mkdtempSync(join(tmpdir(), "dirf-binding-linked-"));
  const relativeSkill = join(".agents", "skills", "testing");
  for (const root of [primary, linked]) {
    mkdirSync(join(root, relativeSkill), { recursive: true });
    writeFileSync(join(root, relativeSkill, "SKILL.md"), `# ${root}\n`);
  }
  const workflow = plan(join(primary, relativeSkill));
  const saved = bindingsFromPlan(workflow, primary);

  const bindings = refreshSkillBindings(workflow, saved, linked, {
    discoverSkills() { throw new Error("worktree rebinding must not scan"); },
  });

  assert.equal(bindings[0].entry, join(linked, relativeSkill, "SKILL.md").replaceAll("\\", "/"));
});

test("a missing saved binding scans once and records the moved skill", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-binding-moved-"));
  const missing = join(root, "old", "testing");
  const moved = join(root, "new", "testing");
  mkdirSync(moved, { recursive: true });
  writeFileSync(join(moved, "SKILL.md"), "# Moved\n");
  const workflow = plan(missing, "codex");
  const saved = bindingsFromPlan(workflow, root);
  let scans = 0;

  const bindings = refreshSkillBindings(workflow, saved, root, {
    discoverSkills() {
      scans += 1;
      return { testing: { provider: "codex", path: moved } };
    },
  });

  assert.equal(scans, 1);
  assert.equal(bindings[0].entry, join(moved, "SKILL.md").replaceAll("\\", "/"));
});

test("an unavailable skill stays visible as missing", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-binding-missing-"));
  const workflow = plan(join(root, "missing"), "codex");

  const bindings = refreshSkillBindings(workflow, [], root, { discoverSkills: () => ({}) });

  assert.equal(bindings[0].status, "missing");
  assert.equal(bindings[0].entry, null);
});
