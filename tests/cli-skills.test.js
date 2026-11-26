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

test("skills scan stays on the host's home roots and warns on differing copies", () => {
  const { home, root } = skillFixture();
  const write = (folder, content) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "SKILL.md"), content, "utf-8");
  };
  write(join(home, ".agents", "skills", "twin"), "---\nname: twin\ndescription: Use when agents.\n---\nagents body");
  write(join(home, ".claude", "skills", "twin"), "---\nname: twin\ndescription: Use when claude.\n---\nclaude body");
  write(join(home, ".claude", "skills", "claude-only"), "---\nname: claude-only\ndescription: Use when claude.\n---\nbody");
  const env = { DIRF_HOME: home, USERPROFILE: home, HOME: home, DIRF_HARNESS: "codex", CODEX_THREAD_ID: "t", CLAUDECODE: "" };
  const codex = run(["skills", "scan", "--path", root], env, root);
  assert.match(codex, /across project and codex home roots/);
  assert.doesNotMatch(codex, /claude-only|Same-name skills/);

  const all = run(["skills", "scan", "--path", root, "--skills-scope", "all"], env, root);
  assert.match(all, /across project and all home roots/);
  assert.match(all, /Same-name skills with different content \(1\)/);
  assert.match(all, /twin: .*\.agents[\/]skills[\/]twin \| .*\.claude[\/]skills[\/]twin/);
});
