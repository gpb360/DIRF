import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function runAsync(args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd, env: { ...process.env, ...env }, windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
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

test("dirf resume composes project context and gives the active attempt precedence", () => {
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
  assert.match(resumed, /Project context:/);
  assert.match(resumed, /Published PR 21/);
  assert.match(resumed, /Review exact head before merge/);
  assert.match(resumed, /Attempt handoff \(active scoped context; takes precedence\):/);
  assert.match(resumed, /Canonical project handoff \(project fallback\):/);

  const resumedJson = JSON.parse(run([
    "resume", built.attempt.id, "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  assert.match(resumedJson.project_handoff, /Published PR 21/);
  assert.match(resumedJson.attempt_handoff, /verify canonical resume state/);
  assert.equal(resumedJson.project_brain.context.path, "docs/agents/domain/CONTEXT.md");
  assert.deepEqual(resumedJson.project_brain.resolution_order, [
    "project.config",
    "project.context",
    "active_attempt",
    "project.handoff",
    "project.attempts",
    "global_fallback",
  ]);
  assert.equal(resumedJson.project_brain.active_attempt.id, built.attempt.id);
  assert.match(resumedJson.resume_prompt, /active attempt takes precedence/i);
  assert.notEqual(resumedJson.project_handoff, resumedJson.attempt_handoff);
});

test("dirf state active keeps DIRF available and reuses the attempt claimed by this checkout", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "active-checkout-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });

  const unconfigured = JSON.parse(run(["state", "active", "--path", main, "--hook"], { DIRF_HOME: home }, main));
  assert.match(unconfigured.hookSpecificOutput.additionalContext, /not configured.*dirf setup/i);

  run(["setup", main], { DIRF_HOME: home }, main);

  const first = JSON.parse(run([
    "build", "first", "fix the first behavior", "--path", main, "--json",
  ], { DIRF_HOME: home }, main)).attempt;

  const idle = JSON.parse(run(["state", "active", "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(idle.state, "idle");
  assert.ok(idle.project, "idle still resolves the DIRF project");

  run(["resume", first.id, "--path", main], { DIRF_HOME: home }, main);
  const active = JSON.parse(run(["state", "active", "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(active.state, "active");
  assert.equal(active.attempt.id, first.id);
  assert.equal(active.attempt.responsibility_path.replaceAll("\\", "/").toLowerCase(), main.replaceAll("\\", "/").toLowerCase());
  assert.match(active.attempt.workflow_path, /README\.md$/);
  assert.match(active.attempt.handoff_path, /HANDOFF\.md$/);
  const stored = JSON.parse(run(["state", "get-attempt", first.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(stored.worktree_path, null, "responsibility must not create durable cleanup linkage");

  const hook = JSON.parse(run(["state", "active", "--path", main, "--hook"], { DIRF_HOME: home }, main));
  assert.equal(hook.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(hook.hookSpecificOutput.additionalContext, /DIRF already governs this checkout/);
  assert.match(hook.hookSpecificOutput.additionalContext, new RegExp(first.id));
  assert.doesNotMatch(hook.hookSpecificOutput.additionalContext, /Project attempts|Canonical project handoff/);

  const second = JSON.parse(run([
    "build", "second", "fix the second behavior", "--path", main, "--json",
  ], { DIRF_HOME: home }, main)).attempt;
  const duplicate = spawnSync(process.execPath, [CLI, "resume", second.id, "--path", main], {
    cwd: main, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, DIRF_HOME: home },
  });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, new RegExp(`already governed by ${first.id}`));

  run(["attempt", "block", first.id, "--reason", "waiting", "--path", main], { DIRF_HOME: home }, main);
  const available = JSON.parse(run(["state", "active", "--path", main, "--hook"], { DIRF_HOME: home }, main));
  assert.match(available.hookSpecificOutput.additionalContext, /DIRF is available.*no in-progress attempt is bound/i);

  run(["resume", second.id, "--path", main], { DIRF_HOME: home }, main);
  const third = JSON.parse(run([
    "build", "third", "fix the third behavior", "--path", main, "--json",
  ], { DIRF_HOME: home }, main)).attempt;
  run(["attempt", "start", third.id, "--path", main], { DIRF_HOME: home }, main);
  // Simulate a legacy/concurrent duplicate claim that bypassed the guarded resume path.
  const thirdStatePath = join(home, "projects", active.project, "attempts", third.id, "attempt.json");
  const thirdState = JSON.parse(readFileSync(thirdStatePath, "utf8"));
  writeFileSync(thirdStatePath, JSON.stringify({ ...thirdState, responsibility_path: main }, null, 2) + "\n");
  const conflict = JSON.parse(run(["state", "active", "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(conflict.state, "conflict");
  assert.deepEqual(conflict.attempts.map(({ id }) => id), [second.id, third.id]);
});

test("dirf resume never composes attempts or context from another project", () => {
  const home = freshHome();
  const alphaProject = mkdtempSync(join(tmpdir(), "alpha-project-brain-"));
  const betaProject = mkdtempSync(join(tmpdir(), "beta-project-brain-"));
  for (const root of [alphaProject, betaProject]) {
    execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT });
    run(["setup", root], { DIRF_HOME: home }, root);
  }
  writeFileSync(join(alphaProject, "docs", "agents", "domain", "CONTEXT.md"), "alpha-only-context\n");
  writeFileSync(join(betaProject, "docs", "agents", "domain", "CONTEXT.md"), "beta-private-context\n");
  const storyAttempt = JSON.parse(run([
    "build", "alpha-lane", "alpha-only-task", "--path", alphaProject, "--json",
  ], { DIRF_HOME: home }, alphaProject));
  run(["build", "beta-lane", "beta-private-task", "--path", betaProject, "--json"], { DIRF_HOME: home }, betaProject);

  const resumed = JSON.parse(run([
    "resume", storyAttempt.attempt.id, "--path", alphaProject, "--json",
  ], { DIRF_HOME: home }, alphaProject));
  const brain = JSON.stringify(resumed.project_brain);
  assert.match(brain, /alpha-only-context/);
  assert.match(brain, /alpha-lane/);
  assert.doesNotMatch(brain, /beta-private-context/);
  assert.equal(resumed.project_brain.attempts.length, 1);
});

test("record-progress requires an explicit attempt when several exist and preserves canonical precedence", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "multi-progress-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const older = JSON.parse(run([
    "build", "older", "work on the older attempt", "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  const newer = JSON.parse(run([
    "build", "newer", "work on the newer attempt", "--path", main, "--json",
  ], { DIRF_HOME: home }, main));

  const canonical = [
    "# DIRF Handoff", "", "## Objective", "", "Authoritative project state", "",
    "## Decisions and assumptions", "", "- preserve-canonical-sentinel", "",
    "## Exact next action", "", "Choose the active attempt explicitly", "",
  ].join("\n");
  const canonicalFile = join(main, "canonical-handoff.md");
  writeFileSync(canonicalFile, canonical);
  run(["state", "write-handoff", "--file", canonicalFile, "--path", main], { DIRF_HOME: home }, main);

  assert.throws(
    () => run(["record-progress", "ambiguous progress", "--path", main, "--next", "continue"], { DIRF_HOME: home }, main),
    /multiple attempts.*--attempt/i,
  );

  run([
    "record-progress", "progress belongs to older", "--attempt", older.attempt.id,
    "--path", main, "--next", "review older attempt",
  ], { DIRF_HOME: home }, main);

  const resumedOlder = JSON.parse(run([
    "resume", older.attempt.id, "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  run(["attempt", "block", older.attempt.id, "--reason", "switch attempts", "--path", main], { DIRF_HOME: home }, main);
  const resumedNewer = JSON.parse(run([
    "resume", newer.attempt.id, "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  assert.match(resumedOlder.project_handoff, /preserve-canonical-sentinel/);
  assert.match(resumedOlder.project_handoff, /progress belongs to older/);
  assert.match(resumedOlder.attempt_handoff, /work on the older attempt/);
  assert.match(resumedOlder.attempt_handoff, /progress belongs to older/);
  assert.doesNotMatch(resumedNewer.attempt_handoff, /progress belongs to older/);
});

test("record-progress rejects an attempt name shared by several attempts", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "duplicate-progress-name-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const older = JSON.parse(run([
    "build", "repeated", "first run", "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  run(["build", "repeated", "second run", "--path", main, "--json"], { DIRF_HOME: home }, main);

  assert.throws(
    () => run([
      "record-progress", "must not guess", "--attempt", "repeated",
      "--path", main, "--next", "choose an id",
    ], { DIRF_HOME: home }, main),
    /attempt name.*ambiguous.*full attempt id/i,
  );
  run([
    "record-progress", "explicit id wins", "--attempt", older.attempt.id,
    "--path", main, "--next", "continue",
  ], { DIRF_HOME: home }, main);
});

test("record-progress never seeds a missing canonical handoff from attempt content", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "missing-canonical-progress-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const built = JSON.parse(run([
    "build", "scoped", "attempt-only-secret-sentinel", "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  const [project] = JSON.parse(run(["state", "list", "--json"], { DIRF_HOME: home }, main));
  const projectDir = join(home, "projects", project.slug);
  const canonicalPath = join(projectDir, "HANDOFF.md");
  const attemptPath = join(projectDir, "attempts", built.attempt.id, "HANDOFF.md");
  assert.match(readFileSync(attemptPath, "utf8"), /attempt-only-secret-sentinel/);
  rmSync(canonicalPath, { force: true });

  run([
    "record-progress", "canonical starts independently", "--attempt", built.attempt.id,
    "--path", main, "--next", "continue",
  ], { DIRF_HOME: home }, main);

  const canonical = readFileSync(canonicalPath, "utf8");
  assert.match(canonical, /canonical starts independently/);
  assert.doesNotMatch(canonical, /attempt-only-secret-sentinel/);
});

test("record-progress never steals a stale-looking lock from a live owner", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "live-progress-lock-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const built = JSON.parse(run([
    "build", "locked", "respect lock ownership", "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  const [project] = JSON.parse(run(["state", "list", "--json"], { DIRF_HOME: home }, main));
  const lockPath = join(home, "projects", project.slug, ".record-progress.lock");
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    pid: process.pid,
    token: "live-owner-token",
    created_at: new Date(Date.now() - 60_000).toISOString(),
  }));

  assert.throws(
    () => run([
      "record-progress", "must wait", "--attempt", built.attempt.id,
      "--path", main, "--next", "retry",
    ], { DIRF_HOME: home }, main),
    /progress update is still running/i,
  );
  assert.equal(JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8")).token, "live-owner-token");
  rmSync(lockPath, { recursive: true, force: true });
});

test("record-progress safely reclaims a stale lock after its owner exits", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "dead-progress-lock-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const built = JSON.parse(run([
    "build", "reclaim", "recover dead lock", "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  const [project] = JSON.parse(run(["state", "list", "--json"], { DIRF_HOME: home }, main));
  const lockPath = join(home, "projects", project.slug, ".record-progress.lock");
  const exited = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  assert.ok(Number.isInteger(exited.pid));
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    pid: exited.pid,
    token: "dead-owner-token",
    created_at: new Date(Date.now() - 60_000).toISOString(),
  }));

  run([
    "record-progress", "reclaimed safely", "--attempt", built.attempt.id,
    "--path", main, "--next", "continue",
  ], { DIRF_HOME: home }, main);
  assert.equal(existsSync(lockPath), false);
});

test("concurrent progress updates keep canonical and attempt handoffs synchronized", async () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "concurrent-progress-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const built = JSON.parse(run([
    "build", "concurrent", "serialize progress writes", "--path", main, "--json",
  ], { DIRF_HOME: home }, main));
  const env = { DIRF_HOME: home };
  const [first, second] = await Promise.all([
    runAsync(["record-progress", "first concurrent update", "--attempt", built.attempt.id, "--path", main, "--next", "continue"], env, main),
    runAsync(["record-progress", "second concurrent update", "--attempt", built.attempt.id, "--path", main, "--next", "continue"], env, main),
  ]);
  assert.equal(first.code, 0, first.stderr || first.stdout);
  assert.equal(second.code, 0, second.stderr || second.stdout);

  const resumed = JSON.parse(run([
    "resume", built.attempt.id, "--path", main, "--json",
  ], env, main));
  assert.match(resumed.project_handoff, /first concurrent update/);
  assert.match(resumed.project_handoff, /second concurrent update/);
  assert.match(resumed.attempt_handoff, /first concurrent update/);
  assert.match(resumed.attempt_handoff, /second concurrent update/);
  assert.notEqual(resumed.project_handoff, resumed.attempt_handoff);
});
