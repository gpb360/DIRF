import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "cli.js");
const TIMEOUT = 30_000;

function run(command, args, cwd, env = process.env) {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", timeout: TIMEOUT });
}

test("a linked worktree points to its installed skill without copying it", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-worktree-skill-home-"));
  const primary = mkdtempSync(join(tmpdir(), "dirf-worktree-skill-primary-"));
  const linked = join(dirname(primary), `${primary.split(/[\\/]/).pop()}-linked`);
  const env = { ...process.env, DIRF_HOME: home, HOME: home, USERPROFILE: home };

  run("git", ["init", "-q"], primary);
  run("git", ["remote", "add", "origin", "https://example.invalid/dirf-fixture.git"], primary);
  run(process.execPath, [CLI, "setup", primary], primary, env);
  const fixtureSkill = join(primary, ".agents", "skills", "testing");
  const fixtureSkillFile = join(fixtureSkill, "SKILL.md");
  const fixtureSkillContents = [
    "---", "name: testing", "description: test bug fixes", "---", "",
    "# Testing", "", "Read [the guide](references/guide.md) before testing.", "",
  ].join("\n");
  mkdirSync(join(fixtureSkill, "references"), { recursive: true });
  writeFileSync(fixtureSkillFile, fixtureSkillContents);
  writeFileSync(join(fixtureSkill, "references", "guide.md"), "PORTABLE-GUIDE-CONTENT\n");
  writeFileSync(join(primary, "fixture-profile.json"), JSON.stringify({ skills: ["testing"] }));
  run("git", ["config", "user.email", "dirf-test@example.invalid"], primary);
  run("git", ["config", "user.name", "DIRF Test"], primary);
  run("git", ["add", "."], primary);
  run("git", ["commit", "-qm", "fixture"], primary);
  run("git", ["worktree", "add", "-q", "-b", "linked-fixture", linked], primary);

  const output = run(process.execPath, [CLI, "build", "portable", "fix a bug", "--path", linked, "--profile", join(linked, "fixture-profile.json")], linked, env);
  const attemptId = output.match(/Attempt saved: (\S+)/)?.[1];
  assert.ok(attemptId, output);

  const slug = readdirSync(join(home, "projects"))[0];
  const attempt = join(home, "projects", slug, "attempts", attemptId);
  const workflowReadme = readFileSync(join(attempt, "README.md"), "utf8");
  const workflow = JSON.parse(readFileSync(join(attempt, "workflow.json"), "utf8"));
  const bindings = JSON.parse(readFileSync(join(attempt, "skill-bindings.json"), "utf8")).bindings;
  const skillFolders = readdirSync(join(attempt, "skills"));
  assert.equal(skillFolders.length, workflow.skill_flow.steps.length);
  for (const skillFolder of skillFolders) {
    assert.match(workflowReadme, new RegExp(`skills/${skillFolder}/README\\.md`));
    assert.equal(existsSync(join(attempt, "skills", skillFolder, "SKILL.md")), false);
  }
  const fixtureFolder = skillFolders.find((folder) => folder.endsWith("-testing"));
  assert.ok(fixtureFolder, skillFolders.join(", "));
  const skill = readFileSync(join(attempt, "skills", fixtureFolder, "README.md"), "utf8");
  const fixtureBinding = bindings.find((item) => item.skill === "testing");
  assert.doesNotMatch(workflowReadme, /Resolve each capability by name in the current host/);
  assert.equal(fixtureBinding.status, "installed");
  assert.equal(fixtureBinding.entry, join(linked, ".agents", "skills", "testing", "SKILL.md").replaceAll("\\", "/"));
  assert.equal(fixtureBinding.relative_entry, ".agents/skills/testing/SKILL.md");
  assert.ok(fixtureBinding.fingerprint);
  assert.match(skill, /Open the installed skill at/);
  assert.match(skill, new RegExp(fixtureBinding.entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(existsSync(join(attempt, "skills", fixtureFolder, "references", "guide.md")), false);
  assert.equal("instructions" in workflow.skill_flow.steps.find((step) => step.skill === "testing"), false);
  assert.equal("files" in workflow.skill_flow.steps.find((step) => step.skill === "testing"), false);

  const linkedSkillFile = join(linked, ".agents", "skills", "testing", "SKILL.md");
  unlinkSync(linkedSkillFile);
  assert.throws(
    () => run(process.execPath, [CLI, "resume", attemptId, "--path", linked, "--json"], linked, env),
    /Cannot resume: required skill not installed: testing/,
  );
  assert.equal(JSON.parse(readFileSync(join(attempt, "attempt.json"), "utf8")).status, "planned");
  const missingBindings = JSON.parse(readFileSync(join(attempt, "skill-bindings.json"), "utf8")).bindings;
  assert.equal(missingBindings.find((item) => item.skill === "testing").status, "missing");
  const missingReadme = readFileSync(join(attempt, "README.md"), "utf8");
  const testingLine = missingReadme.split("\n").find((line) => line.includes("`testing`"));
  assert.match(testingLine, /⚠️/);
  assert.doesNotMatch(testingLine, /✅/);

  writeFileSync(linkedSkillFile, fixtureSkillContents);
  const resumed = JSON.parse(run(process.execPath, [CLI, "resume", attemptId, "--path", linked, "--json"], linked, env));
  assert.equal(resumed.attempt.status, "in_progress");
  const beforeRejectedResume = readFileSync(join(attempt, "skill-bindings.json"), "utf8");
  assert.throws(
    () => run(process.execPath, [CLI, "resume", attemptId, "--path", primary, "--json"], primary, env),
    /already responsible for/,
  );
  assert.equal(readFileSync(join(attempt, "skill-bindings.json"), "utf8"), beforeRejectedResume);
});
