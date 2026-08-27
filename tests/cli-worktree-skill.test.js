import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "cli.js");
const TIMEOUT = 30_000;

function run(command, args, cwd, env = process.env) {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", timeout: TIMEOUT });
}

test("a linked worktree receives self-contained local workflow skills", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-worktree-skill-home-"));
  const primary = mkdtempSync(join(tmpdir(), "dirf-worktree-skill-primary-"));
  const linked = join(dirname(primary), `${primary.split(/[\\/]/).pop()}-linked`);
  const env = { ...process.env, DIRF_HOME: home, HOME: home, USERPROFILE: home };

  run("git", ["init", "-q"], primary);
  run("git", ["remote", "add", "origin", "https://example.invalid/dirf-fixture.git"], primary);
  run(process.execPath, [CLI, "setup", primary], primary, env);
  run("git", ["config", "user.email", "dirf-test@example.invalid"], primary);
  run("git", ["config", "user.name", "DIRF Test"], primary);
  run("git", ["add", "."], primary);
  run("git", ["commit", "-qm", "fixture"], primary);
  run("git", ["worktree", "add", "-q", "-b", "linked-fixture", linked], primary);

  const output = run(process.execPath, [CLI, "build", "portable", "fix a bug", "--path", linked], linked, env);
  const attemptId = output.match(/Attempt saved: (\S+)/)?.[1];
  assert.ok(attemptId, output);

  const slug = readdirSync(join(home, "projects"))[0];
  const attempt = join(home, "projects", slug, "attempts", attemptId);
  const workflowReadme = readFileSync(join(attempt, "README.md"), "utf8");
  const skillFolder = readdirSync(join(attempt, "skills"))[0];
  const skill = readFileSync(join(attempt, "skills", skillFolder, "SKILL.md"), "utf8");

  assert.match(workflowReadme, new RegExp(`skills/${skillFolder}/SKILL\\.md`));
  assert.doesNotMatch(workflowReadme, /Resolve each capability by name in the current host/);
  assert.match(skill, /^---\nname:/);
  assert.match(skill, /description:/);
});
