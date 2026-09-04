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
  execFileSync("git", ["config", "user.email", "dirf@example.invalid"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.name", "DIRF Test"], { cwd: main, timeout: TIMEOUT });
  writeFileSync(join(main, "review.txt"), "A\n");
  execFileSync("git", ["add", "review.txt"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["commit", "-qm", "A"], { cwd: main, timeout: TIMEOUT });
  const revisionA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();
  writeFileSync(join(main, "review.txt"), "B\n");
  execFileSync("git", ["commit", "-qam", "B"], { cwd: main, timeout: TIMEOUT });
  const revisionB = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();

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
  assert.match(hook.hookSpecificOutput.additionalContext, /DIRF already has work in this checkout/);
  assert.match(hook.hookSpecificOutput.additionalContext, new RegExp(first.id));
  assert.doesNotMatch(hook.hookSpecificOutput.additionalContext, /Project attempts|Canonical project handoff/);

  const second = JSON.parse(run([
    "build", "second", "fix the second behavior", "--path", main, "--json",
  ], { DIRF_HOME: home }, main)).attempt;

  run([
    "record-progress", "The first PR review looked clear", "--attempt", first.id,
    "--path", main, "--next", "Ask to merge PR 21",
    "--work-item", "pr:21", "--review-revision", revisionA,
    "--timestamp", "2026-09-02T01:00:00.000Z",
  ], { DIRF_HOME: home }, main);
  run([
    "record-progress", "A newer review found two issues", "--attempt", second.id,
    "--path", main, "--next", "Ask to merge PR 21",
    "--work-item", "pr:21", "--review-revision", revisionB,
    "--timestamp", "2026-09-02T01:05:00.000Z",
  ], { DIRF_HOME: home }, main);

  const stale = JSON.parse(run(["state", "active", "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(stale.attempt.id, first.id);
  assert.equal(stale.attempt.needs_refresh, true);
  assert.equal(stale.attempt.next_action, null, "DIRF must not repeat an old merge instruction");
  assert.match(stale.attempt.attention, /newer project work/i);
  assert.equal(stale.attempt.newer_attempt_id, second.id);
  assert.match(stale.attempt.newer_handoff_path, new RegExp(second.id));
  assert.doesNotMatch(JSON.stringify(stale), /Ask to merge PR 21/, "public state JSON must not leak the stale merge instruction");

  const staleDetail = JSON.parse(run(["state", "get-attempt", first.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(staleDetail.next_action, null, "all state views must suppress the stale next step");
  assert.doesNotMatch(JSON.stringify(staleDetail), /Ask to merge PR 21/, "attempt detail must not leak the stale merge instruction");

  run([
    "record-progress", "The old review recorded a later unrelated checkpoint", "--attempt", first.id,
    "--path", main, "--next", "Ask to merge PR 21",
    "--work-item", "pr:21", "--review-revision", revisionA,
    "--timestamp", "2026-09-02T01:10:00.000Z",
  ], { DIRF_HOME: home }, main);
  const stillStale = JSON.parse(run(["state", "active", "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(stillStale.attempt.next_action, null, "an older reviewed commit cannot become current by writing a later checkpoint");

  const staleResume = spawnSync(process.execPath, [CLI, "resume", first.id, "--path", main], {
    cwd: main, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, DIRF_HOME: home },
  });
  assert.notEqual(staleResume.status, 0);
  assert.match(staleResume.stderr, new RegExp(`older information.*${second.id}`, "i"));

  const duplicate = spawnSync(process.execPath, [CLI, "resume", second.id, "--path", main], {
    cwd: main, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, DIRF_HOME: home },
  });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, new RegExp(`already governed by ${first.id}`, "i"));

  run(["attempt", "block", first.id, "--reason", "waiting", "--path", main], { DIRF_HOME: home }, main);
  run([
    "record-progress", "Reconciled the old task to the reviewed commit", "--attempt", first.id,
    "--path", main, "--next", "No separate action",
    "--work-item", "pr:21", "--review-revision", revisionB,
    "--timestamp", "2026-09-02T01:11:00.000Z",
  ], { DIRF_HOME: home }, main);
  run([
    "record-progress", "Confirmed the second task owns the current review", "--attempt", second.id,
    "--path", main, "--next", "Continue PR 21 review",
    "--work-item", "pr:21", "--review-revision", revisionB,
    "--timestamp", "2026-09-02T01:12:00.000Z",
  ], { DIRF_HOME: home }, main);
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

test("serialized update order wins when same-revision timestamps disagree", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "same-revision-order-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const first = JSON.parse(run([
    "build", "first-review", "review PR 21", "--path", main, "--json",
  ], { DIRF_HOME: home }, main)).attempt;
  run(["resume", first.id, "--path", main], { DIRF_HOME: home }, main);
  const second = JSON.parse(run([
    "build", "second-review", "review PR 21 again", "--path", main, "--json",
  ], { DIRF_HOME: home }, main)).attempt;

  run([
    "record-progress", "The first review looked clear", "--attempt", first.id,
    "--path", main, "--next", "Ask to merge PR 21",
    "--work-item", "pr:21", "--review-revision", "a".repeat(40),
    "--timestamp", "2026-09-02T02:00:00.000Z",
  ], { DIRF_HOME: home }, main);
  run([
    "record-progress", "A second review found a problem", "--attempt", second.id,
    "--path", main, "--next", "Stop and fix PR 21",
    "--work-item", "pr:21", "--review-revision", "a".repeat(40),
    "--timestamp", "2026-09-02T01:00:00.000Z",
  ], { DIRF_HOME: home }, main);

  const state = JSON.parse(run(["state", "active", "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(state.attempt.needs_refresh, true);
  assert.equal(state.attempt.next_action, null);
  assert.equal(state.attempt.newer_attempt_id, second.id);
  assert.doesNotMatch(JSON.stringify(state), /Ask to merge PR 21/);
});

test("a missing update counter rebuilds from persisted handoffs", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "rebuild-update-order-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const correction = JSON.parse(run(["build", "correction", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  const stale = JSON.parse(run(["build", "stale", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  const revision = "a".repeat(40);
  run([
    "record-progress", "Initial correction", "--attempt", correction.id, "--path", main,
    "--next", "Stop and fix PR 21", "--work-item", "pr:21", "--review-revision", revision,
  ], { DIRF_HOME: home }, main);
  run([
    "record-progress", "Stale review checkpoint", "--attempt", stale.id, "--path", main,
    "--next", "Ask to merge PR 21", "--work-item", "pr:21", "--review-revision", revision,
  ], { DIRF_HOME: home }, main);
  const [project] = JSON.parse(run(["state", "list", "--json"], { DIRF_HOME: home }, main));
  rmSync(join(home, "projects", project.slug, ".progress-sequence"), { force: true });
  run([
    "record-progress", "Correction after counter recovery", "--attempt", correction.id, "--path", main,
    "--next", "Stop and fix PR 21", "--work-item", "pr:21", "--review-revision", revision,
  ], { DIRF_HOME: home }, main);

  const staleDetail = JSON.parse(run(["state", "get-attempt", stale.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(staleDetail.needs_refresh, true);
  assert.equal(staleDetail.next_action, null);
  assert.doesNotMatch(JSON.stringify(staleDetail), /Ask to merge PR 21/);

  run([
    "record-progress", "Another stale checkpoint", "--attempt", stale.id, "--path", main,
    "--next", "Ask to merge PR 21", "--work-item", "pr:21", "--review-revision", revision,
  ], { DIRF_HOME: home }, main);
  writeFileSync(join(home, "projects", project.slug, ".progress-sequence"), "0junk\n");
  run([
    "record-progress", "Correction after corrupt counter recovery", "--attempt", correction.id, "--path", main,
    "--next", "Stop and fix PR 21", "--work-item", "pr:21", "--review-revision", revision,
  ], { DIRF_HOME: home }, main);
  const corruptRecovery = JSON.parse(run(["state", "get-attempt", stale.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(corruptRecovery.needs_refresh, true);
  assert.equal(corruptRecovery.next_action, null);
  assert.doesNotMatch(JSON.stringify(corruptRecovery), /Ask to merge PR 21/);

  run([
    "record-progress", "Stale checkpoint after corrupt recovery", "--attempt", stale.id, "--path", main,
    "--next", "Ask to merge PR 21", "--work-item", "pr:21", "--review-revision", revision,
  ], { DIRF_HOME: home }, main);
  writeFileSync(join(home, "projects", project.slug, ".progress-sequence"), "1\n");
  run([
    "record-progress", "Correction after stale valid counter", "--attempt", correction.id, "--path", main,
    "--next", "Stop and fix PR 21", "--work-item", "pr:21", "--review-revision", revision,
  ], { DIRF_HOME: home }, main);
  const staleValidRecovery = JSON.parse(run(["state", "get-attempt", stale.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(staleValidRecovery.needs_refresh, true);
  assert.equal(staleValidRecovery.next_action, null);
  assert.doesNotMatch(JSON.stringify(staleValidRecovery), /Ask to merge PR 21/);

  writeFileSync(join(home, "projects", project.slug, ".progress-sequence"), `${Number.MAX_SAFE_INTEGER}\n`);
  const overflow = spawnSync(process.execPath, [CLI,
    "record-progress", "Counter overflow must fail", "--attempt", correction.id, "--path", main,
    "--next", "Stop and fix PR 21", "--work-item", "pr:21", "--review-revision", revision,
  ], { cwd: main, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, DIRF_HOME: home } });
  assert.notEqual(overflow.status, 0);
  assert.match(overflow.stderr, /update counter is too large/i);
});

test("an older reviewed commit cannot replace or leak through canonical guidance", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "canonical-review-order-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.email", "dirf@example.invalid"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.name", "DIRF Test"], { cwd: main, timeout: TIMEOUT });
  writeFileSync(join(main, "review.txt"), "A\n");
  execFileSync("git", ["add", "review.txt"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["commit", "-qm", "A"], { cwd: main, timeout: TIMEOUT });
  const revisionA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();
  writeFileSync(join(main, "review.txt"), "B\n");
  execFileSync("git", ["commit", "-qam", "B"], { cwd: main, timeout: TIMEOUT });
  const revisionB = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();

  run(["setup", main], { DIRF_HOME: home }, main);
  const oldReview = JSON.parse(run(["build", "old-review", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  const currentReview = JSON.parse(run(["build", "current-review", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  run([
    "record-progress", "Reviewed commit A", "--attempt", oldReview.id, "--path", main,
    "--next", "Ask to merge PR 21", "--work-item", "pr:21", "--review-revision", revisionA,
  ], { DIRF_HOME: home }, main);
  run([
    "record-progress", "Reviewed commit B and found a problem", "--attempt", currentReview.id, "--path", main,
    "--next", "Fix PR 21", "--work-item", "pr:21", "--review-revision", revisionB,
  ], { DIRF_HOME: home }, main);
  run([
    "record-progress", "Old task wrote another checkpoint", "--attempt", oldReview.id, "--path", main,
    "--next", "Ask to merge PR 21",
  ], { DIRF_HOME: home }, main);

  const canonical = run(["state", "read-handoff", "--path", main], { DIRF_HOME: home }, main);
  assert.match(canonical, /Fix PR 21/);
  assert.doesNotMatch(canonical, /Ask to merge PR 21/);
  const resumed = JSON.parse(run(["resume", currentReview.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(resumed.attempt.needs_refresh, false);
  assert.match(resumed.project_handoff, /Fix PR 21/);
  assert.doesNotMatch(JSON.stringify(resumed), /Ask to merge PR 21/);
});

test("divergent reviewed commits are called conflicting instead of newer", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "conflicting-reviews-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.email", "dirf@example.invalid"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.name", "DIRF Test"], { cwd: main, timeout: TIMEOUT });
  writeFileSync(join(main, "review.txt"), "base\n");
  execFileSync("git", ["add", "review.txt"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: main, timeout: TIMEOUT });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();
  writeFileSync(join(main, "review.txt"), "A\n");
  execFileSync("git", ["commit", "-qam", "A"], { cwd: main, timeout: TIMEOUT });
  const revisionA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();
  execFileSync("git", ["checkout", "-q", "-b", "sibling", base], { cwd: main, timeout: TIMEOUT });
  writeFileSync(join(main, "review.txt"), "B\n");
  execFileSync("git", ["commit", "-qam", "B"], { cwd: main, timeout: TIMEOUT });
  const revisionB = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();

  run(["setup", main], { DIRF_HOME: home }, main);
  const reviewA = JSON.parse(run(["build", "review-a", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  const reviewB = JSON.parse(run(["build", "review-b", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  run([
    "record-progress", "Reviewed sibling A", "--attempt", reviewA.id, "--path", main,
    "--next", "Continue PR 21 from A", "--work-item", "pr:21", "--review-revision", revisionA,
  ], { DIRF_HOME: home }, main);
  run([
    "record-progress", "Reviewed sibling B", "--attempt", reviewB.id, "--path", main,
    "--next", "Continue PR 21 from B", "--work-item", "pr:21", "--review-revision", revisionB,
  ], { DIRF_HOME: home }, main);

  for (const [current, other] of [[reviewA, reviewB], [reviewB, reviewA]]) {
    const result = spawnSync(process.execPath, [CLI, "resume", current.id, "--path", main], {
      cwd: main, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, DIRF_HOME: home },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`task ${other.id}.*different PR commits`, "i"));
    assert.doesNotMatch(result.stderr, /newer task|older information/i);
  }
  const detail = JSON.parse(run(["state", "get-attempt", reviewA.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(detail.related_task_relation, "conflict");
  assert.equal(detail.related_attempt_id, reviewB.id);
  assert.equal(detail.newer_attempt_id, null);
});

test("unavailable reviewed commits are called unverified instead of conflicting", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "unverified-reviews-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home }, main);
  const reviewA = JSON.parse(run(["build", "review-a", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  run(["resume", reviewA.id, "--path", main], { DIRF_HOME: home }, main);
  const reviewB = JSON.parse(run(["build", "review-b", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  run([
    "record-progress", "Recorded unavailable A", "--attempt", reviewA.id, "--path", main,
    "--next", "Continue PR 21 from A", "--work-item", "pr:21", "--review-revision", "a".repeat(40),
  ], { DIRF_HOME: home }, main);
  run([
    "record-progress", "Recorded unavailable B", "--attempt", reviewB.id, "--path", main,
    "--next", "Continue PR 21 from B", "--work-item", "pr:21", "--review-revision", "b".repeat(40),
  ], { DIRF_HOME: home }, main);

  const detail = JSON.parse(run(["state", "get-attempt", reviewA.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(detail.related_task_relation, "unknown");
  assert.equal(detail.related_task_requires_reconciliation, true);
  const result = spawnSync(process.execPath, [CLI, "resume", reviewA.id, "--path", main], {
    cwd: main, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, DIRF_HOME: home },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot tell whether this task.*matches the current PR version/i);
  assert.doesNotMatch(result.stderr, /conflicts with|newer task|older information/i);
  const hook = JSON.parse(run(["state", "active", "--path", main, "--hook"], { DIRF_HOME: home }, main));
  assert.match(hook.hookSpecificOutput.additionalContext, /cannot tell which task matches the current PR version/i);
  assert.doesNotMatch(hook.hookSpecificOutput.additionalContext, /conflicting reviewed commit/i);
});

test("an unavailable revision in one PR does not poison another PR list projection", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "isolated-review-graphs-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.email", "dirf@example.invalid"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.name", "DIRF Test"], { cwd: main, timeout: TIMEOUT });
  writeFileSync(join(main, "review.txt"), "A\n");
  execFileSync("git", ["add", "review.txt"], { cwd: main, timeout: TIMEOUT });
  execFileSync("git", ["commit", "-qm", "A"], { cwd: main, timeout: TIMEOUT });
  const revisionA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();
  writeFileSync(join(main, "review.txt"), "B\n");
  execFileSync("git", ["commit", "-qam", "B"], { cwd: main, timeout: TIMEOUT });
  const revisionB = execFileSync("git", ["rev-parse", "HEAD"], { cwd: main, encoding: "utf8", timeout: TIMEOUT }).trim();
  run(["setup", main], { DIRF_HOME: home }, main);
  const validOld = JSON.parse(run(["build", "valid-old", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  const validNew = JSON.parse(run(["build", "valid-new", "review PR 21", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  const missingA = JSON.parse(run(["build", "missing-a", "review PR 22", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  const missingB = JSON.parse(run(["build", "missing-b", "review PR 22", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  for (const [attempt, workItem, revision, next] of [
    [validOld, "pr:21", revisionA, "Review PR 21 again"],
    [validNew, "pr:21", revisionB, "Continue current PR 21 review"],
    [missingA, "pr:22", "a".repeat(40), "Reconcile PR 22 A"],
    [missingB, "pr:22", "b".repeat(40), "Reconcile PR 22 B"],
  ]) {
    run([
      "record-progress", next, "--attempt", attempt.id, "--path", main,
      "--next", next, "--work-item", workItem, "--review-revision", revision,
    ], { DIRF_HOME: home }, main);
  }

  const listed = JSON.parse(run(["state", "list-attempts", "--path", main, "--json"], { DIRF_HOME: home }, main));
  const oldList = listed.find(({ id }) => id === validOld.id);
  const newList = listed.find(({ id }) => id === validNew.id);
  assert.equal(oldList.related_task_relation, "candidate_newer");
  assert.equal(oldList.needs_refresh, true);
  assert.equal(newList.needs_refresh, false);
  const newDetail = JSON.parse(run(["state", "get-attempt", validNew.id, "--path", main, "--json"], { DIRF_HOME: home }, main));
  assert.equal(newDetail.needs_refresh, newList.needs_refresh);
  assert.equal(newDetail.related_task_relation, newList.related_task_relation);
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
