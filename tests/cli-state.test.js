import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function freshHome() {
  return mkdtempSync(join(tmpdir(), "dirf-cli-"));
}

test("dirf state list is empty for a fresh home", () => {
  const out = run(["state", "list"], { DIRF_HOME: freshHome() });
  assert.match(out, /no projects registered|^\s*$/i);
});

test("state and build JSON output is machine-readable", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "jsonproj-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const projects = JSON.parse(run(["state", "list", "--json"], { DIRF_HOME: home }, main));
  assert.equal(projects.length, 1);
  const built = JSON.parse(run(["build", "json-contract", "test JSON output", "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(built.attempt.status, "planned");
  const attempts = JSON.parse(run(["state", "list-attempts", "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(attempts[0].id, built.attempt.id);
});

test("dirf state which resolves a registered project from a worktree", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "whichproj-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  const wt = join(tmpdir(), `wt-${Date.now()}`);
  execFileSync("git", ["-C", main, "worktree", "add", "-q", wt], { timeout: TIMEOUT });
  const out = run(["state", "which"], { DIRF_HOME: home }, wt);
  assert.match(out, /whichproj-[a-z0-9]+-[0-9a-f]{8}/);
});

test("dirf state which reports the current branch", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "branchwhich-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  execFileSync("git", ["-C", main, "checkout", "-q", "-b", "feature/x"], { timeout: TIMEOUT });
  const out = run(["state", "which"], { DIRF_HOME: home }, main);
  assert.match(out, /branch: feature\/x/);
});

test("dirf state which reports detached HEAD", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "detachwhich-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  writeFileSync(join(main, "f.txt"), "x");
  execFileSync("git", ["-C", main, "add", "."], { timeout: TIMEOUT });
  execFileSync("git", ["-C", main, "commit", "-qm", "init"], { timeout: TIMEOUT, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  execFileSync("git", ["-C", main, "checkout", "-q", "--detach"], { timeout: TIMEOUT });
  const out = run(["state", "which"], { DIRF_HOME: home }, main);
  assert.match(out, /branch: \(detached HEAD\)/);
});

test("dirf state write-handoff --file writes the canonical handoff", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "whproj2-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  const md = "# From file\n\nPhase done.\n";
  const src = join(main, "new-handoff.md");
  writeFileSync(src, md);
  run(["state", "write-handoff", "--file", src], { DIRF_HOME: home }, main);
  const out = run(["state", "read-handoff"], { DIRF_HOME: home }, main);
  assert.equal(out, md);
});

test("dirf state migrate-cleanup removes backup dirs", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "mcp-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  // plant a fake backup dir
  mkdirSync(join(main, ".dirf.migrating.20260101T000000000Z"));
  writeFileSync(join(main, ".dirf.migrating.20260101T000000000Z", "x"), "x");
  run(["state", "migrate-cleanup"], { DIRF_HOME: home }, main);
  const leftovers = readdirSync(main).filter((n) => n.startsWith(".dirf.migrating."));
  assert.equal(leftovers.length, 0);
});

test("dirf state import-handoff --force promotes a local HANDOFF into the store", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "imph-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  // Plant a local .dirf/HANDOFF.md that should be promoted.
  mkdirSync(join(main, ".dirf"), { recursive: true });
  const localMd = "# Promoted from local\n\nNewer content.\n";
  writeFileSync(join(main, ".dirf", "HANDOFF.md"), localMd);
  // Promote via the CLI with --force (skips the prompt).
  run(["state", "import-handoff", "--force"], { DIRF_HOME: home }, main);
  // The canonical store handoff now equals the promoted local content.
  const readBack = run(["state", "read-handoff"], { DIRF_HOME: home }, main);
  assert.equal(readBack, localMd);
});

test("dirf resume surfaces canonical progress before the attempt handoff", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "resume-progress-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const built = JSON.parse(run([
    "build", "resume-progress", "verify canonical resume state", "--path", main, "--json",
  ], { DIRF_HOME: home }, main));

  run([
    "record-progress", "Published PR 21", "--path", main,
    "--phase", "verify", "--next", "Review exact head before merge",
  ], { DIRF_HOME: home }, main);

  const resumed = run(["resume", built.attempt.id, "--path", main], { DIRF_HOME: home }, main);
  assert.match(resumed, /Canonical project handoff \(takes precedence\):/);
  assert.match(resumed, /Published PR 21/);
  assert.match(resumed, /Review exact head before merge/);
  assert.match(resumed, /Attempt handoff \(scoped context\):/);

  const resumedJson = JSON.parse(run([
    "resume", built.attempt.id, "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  assert.equal(resumedJson.project_handoff, resumedJson.attempt_handoff);
});
