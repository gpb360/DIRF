// Skill discovery tests via node:test. Run: npm run test:skills
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../src/paths.js";
import * as skills from "../src/skills.js";

function makeRoot() {
  // Fresh temp project root with a skills/ folder.
  const root = mkdtempSync(join(tmpdir(), "dirf-test-"));
  mkdirSync(join(root, "skills"), { recursive: true });
  return root;
}

function write(folder, name, content) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), content, "utf-8");
}

test("discover finds local SKILL.md skills", () => {
  const root = makeRoot();
  write(join(root, "skills", "demo-skill"), "SKILL.md",
    "---\nname: demo-skill\ndescription: a demo\n---\nbody");
  const idx = skills.discover(root);
  assert.ok("demo-skill" in idx);
  assert.equal(idx["demo-skill"].description, "a demo");
});

test("discover reads skill.json when no SKILL.md (ui-ux-pro-max case)", () => {
  const root = makeRoot();
  write(join(root, "skills", "ui-ux-pro-max"), "skill.json",
    '{"name": "ui-ux-pro-max", "description": "design intelligence"}');
  const idx = skills.discover(root);
  assert.ok("ui-ux-pro-max" in idx);
});

test("discover reads README.md as last resort", () => {
  const root = makeRoot();
  write(join(root, "skills", "readme-only"), "README.md",
    "---\nname: readme-only\ndescription: readme skill\n---\nbody");
  const idx = skills.discover(root);
  assert.ok("readme-only" in idx);
});

test("discover handles null projectRoot (defaults to kit ROOT)", () => {
  // Should not throw; finds global skills on the real host.
  const idx = skills.discover(null);
  assert.ok(typeof idx === "object");
});

test("resolve marks installed vs recommended without persisting runtime paths", () => {
  const discovered = { ponytail: { name: "ponytail", path: "/x", file: "SKILL.md", description: "", provider: "agents" } };
  const resolved = skills.resolveAgentSkills("frontend-developer", ["ponytail", "impeccable"], [], discovered);
  const byName = Object.fromEntries(resolved.map((s) => [s.name, s]));
  assert.equal(byName.ponytail.status, "installed");
  assert.equal(byName.ponytail.path, undefined);
  assert.equal(byName.ponytail.provider, "agents");
  assert.equal(byName.impeccable.status, "recommended");
  assert.equal(byName.impeccable.path, undefined);
});

test("resolve dedupes baseline and agent-specific", () => {
  const discovered = {};
  const resolved = skills.resolveAgentSkills("ui-designer", ["ponytail", "impeccable"], ["ponytail", "ui-ux-pro-max"], discovered);
  const names = resolved.map((s) => s.name);
  assert.equal(names.filter((n) => n === "ponytail").length, 1);
  assert.deepEqual(new Set(names), new Set(["ponytail", "impeccable", "ui-ux-pro-max"]));
});

test("resolve never fails on missing skill", () => {
  const resolved = skills.resolveAgentSkills("x", ["totally-unknown-skill"], [], {});
  assert.equal(resolved[0].status, "recommended");
  assert.equal(resolved[0].name, "totally-unknown-skill");
});

test("trusted sources come from host configuration", () => {
  const root = makeRoot();
  write(join(root, ".dirf"), "trusted-sources.json", JSON.stringify({
    sources: [{ name: "user-approved", url: "https://example.test/skill", capabilities: ["quality"] }],
  }));
  const sources = skills.loadTrustedSources(root);
  const source = sources.find(({ name }) => name === "user-approved");
  assert.equal(source.url, "https://example.test/skill");
  assert.equal(source.provider, "project");
  assert.equal(source.configured_in, undefined);
});

test("provider hint follows the nearest skill namespace, not an enclosing worktree", () => {
  assert.equal(skills.providerForPath("C:/Users/example/.codex/worktrees/123/repo/.agents/skills/review"), "agents");
});

test("discover never indexes the kit's own bundled skills", () => {
  const bundledRoot = join(ROOT, "skills").replace(/\\/g, "/");
  const idx = skills.discover();
  const leaked = Object.values(idx).filter((item) => String(item.path).replace(/\\/g, "/").startsWith(bundledRoot + "/"));
  assert.deepEqual(leaked, []);
  assert.equal(idx["minimal-implementation"], undefined);
});

test("bundledSkills exposes kit units with declared capabilities", () => {
  const bundled = skills.bundledSkills();
  assert.ok(bundled["minimal-implementation"], "bundled fallback should be readable");
  assert.deepEqual(bundled["minimal-implementation"].capabilities, ["minimalism"]);
  assert.equal(bundled["minimal-implementation"].provider, "dirf");
});

test("discover indexes invocation class from disable-model-invocation", () => {
  const root = makeRoot();
  write(join(root, "skills", "user-skill"), "SKILL.md",
    "---\nname: user-skill\ndescription: A one-line summary for a person.\ndisable-model-invocation: true\n---\nRun a session.");
  write(join(root, "skills", "model-skill"), "SKILL.md",
    "---\nname: model-skill\ndescription: Use when the user mentions X or Y.\n---\nbody");
  write(join(root, "skills", "yes-skill"), "SKILL.md",
    "---\nname: yes-skill\ndescription: d\nuser-invocable: false\ndisable-model-invocation: yes\n---\nbody");
  const idx = skills.discover(root);
  assert.equal(idx["user-skill"].invocation, "user");
  assert.equal(idx["model-skill"].invocation, "model");
  // tolerant boolean: "yes" counts as true
  assert.equal(idx["yes-skill"].invocation, "user");
});

test("discover indexes progressive-disclosure files and body size", () => {
  const root = makeRoot();
  write(join(root, "skills", "docs-skill"), "SKILL.md",
    "---\nname: docs-skill\ndescription: d\n---\nbody");
  write(join(root, "skills", "docs-skill"), "tests.md", "good tests\nbad tests");
  write(join(root, "skills", "docs-skill"), "mocking.md", "mocking guidance");
  mkdirSync(join(root, "skills", "docs-skill", "scripts"), { recursive: true });
  writeFileSync(join(root, "skills", "docs-skill", "scripts", "run.sh"), "#!/bin/sh\n", "utf-8");
  const idx = skills.discover(root);
  assert.deepEqual(idx["docs-skill"].disclosures, ["mocking.md", "scripts/", "tests.md"]);
  assert.ok(idx["docs-skill"].body_lines > 0);
});

test("discover hides README.md fallback itself from disclosures", () => {
  const root = makeRoot();
  write(join(root, "skills", "readme-skill"), "README.md",
    "---\nname: readme-skill\ndescription: readme skill\n---\nbody");
  write(join(root, "skills", "readme-skill"), "notes.md", "extra");
  const idx = skills.discover(root);
  assert.deepEqual(idx["readme-skill"].disclosures, ["notes.md"]);
  assert.equal(idx["readme-skill"].invocation, "model");
});

test("discover indexes backticked /skill references from bodies", () => {
  const root = makeRoot();
  write(join(root, "skills", "grill-me"), "SKILL.md",
    "---\nname: grill-me\ndescription: d\ndisable-model-invocation: true\n---\nRun a `/grilling` session, and mention `/domain-modeling` and `/grilling` again.\nCheck /tmp not a ref. https://x.test/a not a ref.");
  write(join(root, "skills", "grilling"), "SKILL.md", "---\nname: grilling\ndescription: d\n---\nbody");
  const idx = skills.discover(root);
  // de-duplicated, sorted, backticked slash-commands only
  assert.deepEqual(idx["grill-me"].references, ["domain-modeling", "grilling"]);
  // no references in its own body → field absent entirely
  assert.equal(idx["grilling"].references, undefined);
});

test("lintSkillMetadata surfaces spec-level quality warnings, never false on clean skills", () => {
  const clean = { name: "tdd", path: "/s/tdd", description: "Use when the user wants to build features test-first or mentions red-green-refactor", body_lines: 38 };
  assert.deepEqual(skills.lintSkillMetadata(clean), []);
  assert.ok(skills.lintSkillMetadata({ name: "x", path: "/s/x", description: "" }).some((w) => /missing description/.test(w)));
  assert.ok(skills.lintSkillMetadata({ name: "a", path: "/s/b", description: "d" }).some((w) => /does not match parent directory/.test(w)));
  assert.ok(skills.lintSkillMetadata({ name: "x", path: "/s/x", description: "I create things" }).some((w) => /first-person/.test(w)));
  assert.ok(skills.lintSkillMetadata({ name: "x", path: "/s/x", description: `d${"x".repeat(1025)}` }).some((w) => /spec cap 1024/.test(w)));
  assert.ok(skills.lintSkillMetadata({ name: "x", path: "/s/x", description: "d", body_lines: 501 }).some((w) => /keep under 500/.test(w)));
  assert.ok(skills.lintSkillMetadata({ name: "x", path: "/s/x", description: "d <xml>tag</xml>" }).some((w) => /XML tags/.test(w)));
});

test("discoverAgents indexes project agent files but never the kit's bundled agents/", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-agents-"));
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  writeFileSync(join(root, ".claude", "agents", "my-dev.md"), "---\nname: my-dev\ndescription: builds things\n---\nbody\n", "utf-8");
  const idx = skills.discoverAgents(root);
  assert.equal(idx["my-dev"].description, "builds things");
  assert.equal(idx["my-dev"].provider, "claude");
  // kit root: bundled agents/ must not appear as installed
  const bundledRoot = join(ROOT, "agents").replace(/\\/g, "/");
  const kitIdx = skills.discoverAgents();
  assert.equal(Object.values(kitIdx).some((a) => String(a.path).startsWith(bundledRoot + "/")), false);
});
