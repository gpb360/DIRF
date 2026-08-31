import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveWorktree,
  createAttemptInStore,
  getAttempt,
  inspectProjectWorktrees,
  registerProject,
  startTrackingAttempt,
  updateAttemptLifecycle,
  writeSettings,
} from "../src/state.js";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "dirf-flow-board-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# test\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" } });
  return root;
}

function attemptFixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-flow-board-home-"));
  process.env.DIRF_HOME = home;
  const root = repo();
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "contract", new Date("2026-08-01T00:00:00.000Z"));
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["define", "build", "verify"] } }));
  writeFileSync(join(attempt.folder, "HANDOFF.md"), "## Exact next action\n\nRun the focused tests.\n");
  return { home, root, slug, attempt };
}

test("new attempts are tracked in Planned state and lifecycle transitions follow workflow phases", () => {
  const { slug, attempt } = attemptFixture();
  let current = getAttempt(slug, attempt.id);
  assert.equal(current.status, "planned");
  current = updateAttemptLifecycle(slug, attempt.id, "start", { worker: "Codex" });
  assert.deepEqual([current.status, current.current_phase, current.worker], ["in_progress", "define", "Codex"]);
  current = updateAttemptLifecycle(slug, attempt.id, "advance");
  assert.equal(current.current_phase, "build");
  current = updateAttemptLifecycle(slug, attempt.id, "block", { reason: "Waiting for review" });
  assert.deepEqual([current.status, current.blocker], ["blocked", "Waiting for review"]);
  current = updateAttemptLifecycle(slug, attempt.id, "reopen");
  assert.deepEqual([current.status, current.current_phase], ["in_progress", "build"]);
  current = updateAttemptLifecycle(slug, attempt.id, "advance");
  assert.equal(current.current_phase, "verify");
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "complete"), /Confirm/);
  current = updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true });
  assert.equal(current.status, "done");
});

test("historical attempts require explicit Start Tracking", () => {
  const { slug, attempt } = attemptFixture();
  const metadata = getAttempt(slug, attempt.id);
  metadata.schema_version = 1;
  delete metadata.status;
  writeFileSync(join(attempt.folder, "attempt.json"), JSON.stringify(metadata));
  assert.equal(getAttempt(slug, attempt.id).tracked, false);
  const tracked = startTrackingAttempt(slug, attempt.id);
  assert.deepEqual([tracked.tracked, tracked.status], [true, "planned"]);
});

test("settings validate cleanup intervals", () => {
  process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), "dirf-settings-"));
  assert.throws(() => writeSettings({ stale_worktree_days: 0 }), /positive integer/);
  assert.equal(writeSettings({ stale_worktree_days: 14, archive_reminder_days: 30 }).archive_reminder_days, 30);
});

test("worktree inspection identifies registered clean checkout", () => {
  const { slug, root } = attemptFixture();
  const entries = inspectProjectWorktrees(slug);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].is_main, true);
  assert.equal(entries[0].dirty, false);
  assert.equal(existsSync(root), true);
});

test("clean non-main worktree can be archived without deleting its branch", () => {
  const { slug, root } = attemptFixture();
  const worktree = join(tmpdir(), `dirf-board-wt-${Date.now()}`);
  execFileSync("git", ["worktree", "add", "-q", "-b", "board-test", worktree], { cwd: root });
  const archivedAt = new Date("2026-08-01T00:00:00.000Z");
  const record = archiveWorktree(slug, worktree, archivedAt);
  assert.equal(record.branch, "board-test");
  assert.equal(inspectProjectWorktrees(slug, archivedAt).find((entry) => entry.branch === "board-test").cleanup_state, "archived");
  execFileSync("git", ["worktree", "remove", "-f", worktree], { cwd: root });
  execFileSync("git", ["branch", "-D", "board-test"], { cwd: root, stdio: "ignore" });
});
