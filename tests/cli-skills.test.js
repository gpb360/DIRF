// CLI-level tests for the `skills scan` dashboard sections (invocation
// classes, reference graph, quality warnings, token budget). Home roots are
// isolated via USERPROFILE/HOME so the scan sees only the fixture skills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function skillFixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-skills-cli-"));
  const root = mkdtempSync(join(tmpdir(), "dirf-skills-proj-"));
  const write = (folder, name, content) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), content, "utf-8");
  };
  // grill-me is a kit registry ref AND the ecosystem's canonical user-invoked
  // skill; grill-with-docs is a model-invoked registry ref.
  write(join(root, "skills", "grill-me"), "SKILL.md",
    "---\nname: grill-me\ndescription: A human-facing summary.\ndisable-model-invocation: true\n---\nRun a `/grill-with-docs` session.");
  write(join(root, "skills", "grill-with-docs"), "SKILL.md",
    "---\nname: grill-with-docs\ndescription: Use when the user wants to sharpen a plan against the domain docs.\n---\nbody");
  write(join(root, "skills", "missing-ref"), "SKILL.md",
    "---\nname: missing-ref\ndescription: Use when the user mentions X.\n---\nReach `/absent-skill` when stuck.");
  return { home, root };
}

test("skills scan reports invocation classes, reference graph, and token budget", () => {
  const { home, root } = skillFixture();
  const out = run(["skills", "scan", "--path", root], { DIRF_HOME: home, USERPROFILE: home, HOME: home }, root);
  assert.match(out, /grill-me[\s\S]*?\[user-invoked — human-only\]/);
  assert.match(out, /grill-with-docs[\s\S]*?\[model-invoked\]/);
  assert.match(out, /Invocation: 2 model-invoked \(agent-routable\), 1 user-invoked \(human-only\), 0 incomplete \(not routable\)\./);
  assert.match(out, /grill-me → grill-with-docs \(installed\)/);
  assert.match(out, /missing-ref → absent-skill \(referenced, not installed\)/);
  assert.match(out, /Token budget: \d+ tokens always loaded \(metadata tier\)/);
});
