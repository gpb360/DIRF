import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAttemptInStore,
  portfolioSnapshot,
  readRegistry,
  registerProject,
  setProjectStatus,
  startTrackingAttempt,
  updateAttemptLifecycle,
  writeHandoff,
  writeRegistry,
  writeSettings,
} from "../src/state.js";

const DAY = 86_400_000;

function setup(now = new Date()) {
  const home = mkdtempSync(join(tmpdir(), "dirf-portfolio-"));
  process.env.DIRF_HOME = home;
  const root = mkdtempSync(join(tmpdir(), "dirf-portfolio-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const { slug } = registerProject(root);
  return { home, root, slug, now };
}

function daysAgo(days, now) { return new Date(now.getTime() - days * DAY); }

// Create a tracked attempt at a fixed date with a workflow (so lifecycle
// transitions work) and an attempt handoff with a next action.
function addAttempt(slug, name, date, status = "planned") {
  const attempt = createAttemptInStore(slug, name, date);
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["define", "build", "verify"] } }));
  writeFileSync(join(attempt.folder, "HANDOFF.md"), "## Exact next action\n\nRun the focused tests.\n");
  let current = startTrackingAttempt(slug, attempt.id, date);
  if (status === "in_progress") {
    current = updateAttemptLifecycle(slug, attempt.id, "start", {}, new Date(date.getTime() + 1000));
  } else if (status === "done") {
    current = updateAttemptLifecycle(slug, attempt.id, "start", {}, new Date(date.getTime() + 1000));
    current = updateAttemptLifecycle(slug, attempt.id, "advance", {}, new Date(date.getTime() + 2000));
    current = updateAttemptLifecycle(slug, attempt.id, "advance", {}, new Date(date.getTime() + 3000));
    current = updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }, new Date(date.getTime() + 4000));
  }
  return current;
}

// registerProject stamps last_seen=now; rewind it so staleness tests control
// the project's apparent freshness directly.
function backdateLastSeen(slug, date) {
  const registry = readRegistry();
  registry.projects[slug].last_seen = date.toISOString();
  writeRegistry(registry);
}

test("a project with no attempts is empty", () => {
  const { slug, now } = setup();
  const project = portfolioSnapshot(now).projects[0];
  assert.equal(project.slug, slug);
  assert.equal(project.status, "empty");
  assert.equal(project.attempts.total, 0);
  assert.equal(project.latest, null);
});

test("a project with an in-progress attempt is active", () => {
  const { slug, now } = setup();
  addAttempt(slug, "feature", daysAgo(5, now), "in_progress");
  assert.equal(portfolioSnapshot(now).projects[0].status, "active");
});

test("a project with only planned attempts and recent activity is active", () => {
  const { slug, now } = setup();
  addAttempt(slug, "fresh-plan", daysAgo(2, now), "planned");
  assert.equal(portfolioSnapshot(now).projects[0].status, "active");
});

test("a project with only planned attempts and old activity is stale", () => {
  const { slug, now } = setup();
  addAttempt(slug, "old-plan", daysAgo(45, now), "planned");
  backdateLastSeen(slug, daysAgo(45, now));
  assert.equal(portfolioSnapshot(now).projects[0].status, "stale");
});

test("a project whose tracked attempts are all done is completed", () => {
  const { slug, now } = setup();
  addAttempt(slug, "one", daysAgo(10, now), "done");
  addAttempt(slug, "two", daysAgo(8, now), "done");
  const project = portfolioSnapshot(now).projects[0];
  assert.equal(project.status, "completed");
  assert.equal(project.attempts.done, 2);
});

test("a handoff completion signal marks a project completed", () => {
  const { slug, now } = setup();
  addAttempt(slug, "work", daysAgo(3, now), "planned");
  writeHandoff(slug, "# DIRF Handoff\n\n## Status: Complete.\n");
  assert.equal(portfolioSnapshot(now).projects[0].status, "completed");
});

test("open work beats a handoff completion signal", () => {
  const { slug, now } = setup();
  addAttempt(slug, "work", daysAgo(1, now), "in_progress");
  writeHandoff(slug, "# DIRF Handoff\n\n## Status: Complete.\n");
  assert.equal(portfolioSnapshot(now).projects[0].status, "active");
});

test("stale_project_days drives the staleness threshold", () => {
  const { slug, now } = setup();
  writeSettings({ stale_project_days: 3 });
  addAttempt(slug, "plan", daysAgo(7, now), "planned");
  backdateLastSeen(slug, daysAgo(7, now));
  assert.equal(portfolioSnapshot(now).projects[0].status, "stale");
  writeSettings({ stale_project_days: 30 });
  assert.equal(portfolioSnapshot(now).projects[0].status, "active");
});

test("explicit status overrides derived classification until reopened", () => {
  const { slug, now } = setup();
  addAttempt(slug, "work", daysAgo(1, now), "in_progress");
  setProjectStatus(slug, "complete");
  let project = portfolioSnapshot(now).projects[0];
  assert.equal(project.status, "complete");
  assert.equal(project.explicit_status, "complete");
  setProjectStatus(slug, "archived");
  assert.equal(portfolioSnapshot(now).projects[0].status, "archived");
  setProjectStatus(slug, null);
  project = portfolioSnapshot(now).projects[0];
  assert.equal(project.status, "active");
  assert.equal(project.explicit_status, null);
});

test("setProjectStatus rejects unknown statuses and unknown slugs", () => {
  const { slug } = setup();
  assert.throws(() => setProjectStatus(slug, "done"), /complete.*archived/);
  assert.throws(() => setProjectStatus("nope-00000000", "complete"), /Unknown DIRF project/);
});

test("snapshot carries attempt counts, latest attempt and summary", () => {
  const { slug, now } = setup();
  addAttempt(slug, "one", daysAgo(2, now), "done");
  addAttempt(slug, "two", daysAgo(1, now), "in_progress");
  const snapshot = portfolioSnapshot(now);
  const project = snapshot.projects[0];
  assert.deepEqual(
    {
      total: project.attempts.total,
      tracked: project.attempts.tracked,
      done: project.attempts.done,
      in_progress: project.attempts.in_progress,
    },
    { total: 2, tracked: 2, done: 1, in_progress: 1 },
  );
  assert.equal(project.latest.name, "two");
  assert.equal(project.latest.status, "in_progress");
  assert.equal(project.latest.next_action, "Run the focused tests.");
  assert.equal(snapshot.summary.projects, 1);
  assert.equal(snapshot.summary.active, 1);
  assert.equal(snapshot.summary.attempts_done, 1);
  assert.equal(snapshot.summary.attempts_in_progress, 1);
});
