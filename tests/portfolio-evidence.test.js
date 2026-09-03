import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAttemptInStore,
  effectiveAttemptStatus,
  getAttempt,
  handoffHasCompletionEvidence,
  portfolioSnapshot,
  recordProgress,
  registerProject,
  startTrackingAttempt,
  syncAttemptFromHandoff,
  syncLifecycleFromProgress,
  updateAttemptLifecycle,
} from "../src/state.js";

const DAY = 86_400_000;

function daysAgo(days, now) { return new Date(now.getTime() - days * DAY); }

function setup(now = new Date()) {
  const home = mkdtempSync(join(tmpdir(), "dirf-evidence-"));
  process.env.DIRF_HOME = home;
  const root = mkdtempSync(join(tmpdir(), "dirf-evidence-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const { slug } = registerProject(root);
  return { home, root, slug, now };
}

function addAttempt(slug, name, date, status = "planned", handoff = null) {
  const attempt = createAttemptInStore(slug, name, date);
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["define", "build", "verify"] } }));
  if (handoff !== null) writeFileSync(join(attempt.folder, "HANDOFF.md"), handoff);
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

const COMPLETE_STATUS_LINE = "# DIRF Handoff\n\n## Status: Complete.\n";
const FILLED_SECTION = "# DIRF Handoff\n\n## Completed\n\n- Fixed the layout.\n";
const TEMPLATE_SECTION = "# DIRF Handoff\n\n## Completed\n\n- _(none yet)_\n";

// Rewrite attempt.json as schema v1 so the attempt is genuinely historical
// (listAttempts derives tracked/status from the file, not the object).
function makeHistorical(attempt) {
  writeFileSync(join(attempt.folder, "attempt.json"), JSON.stringify({
    schema_version: 1,
    id: attempt.id,
    name: attempt.name,
    relativePath: attempt.relativePath,
    created_at: attempt.created_at,
  }) + "\n");
  return attempt;
}

test("handoffHasCompletionEvidence recognizes real markers but not the template placeholder", () => {
  assert.equal(handoffHasCompletionEvidence(COMPLETE_STATUS_LINE), true);
  assert.equal(handoffHasCompletionEvidence(FILLED_SECTION), true);
  assert.equal(handoffHasCompletionEvidence(TEMPLATE_SECTION), false);
  assert.equal(handoffHasCompletionEvidence(null), false);
  assert.equal(handoffHasCompletionEvidence("## Exact next action\n\nShip it.\n"), false);
});

test("effective status upgrades planned attempts with evidence to done", () => {
  const { slug, now } = setup();
  const attempt = addAttempt(slug, "work", daysAgo(3, now), "planned", COMPLETE_STATUS_LINE);
  const { status, status_source: source } = effectiveAttemptStatus(slug, attempt);
  assert.deepEqual([status, source], ["done", "handoff"]);
});

test("effective status leaves lifecycle states authoritative", () => {
  const { slug, now } = setup();
  const inProgress = addAttempt(slug, "open", daysAgo(1, now), "in_progress", COMPLETE_STATUS_LINE);
  assert.deepEqual(effectiveAttemptStatus(slug, inProgress), { status: "in_progress", status_source: "lifecycle" });
  const done = addAttempt(slug, "finished", daysAgo(2, now), "done");
  assert.deepEqual(effectiveAttemptStatus(slug, done), { status: "done", status_source: "lifecycle" });
});

test("portfolio counts evidence-based completions and marks the project completed", () => {
  const { slug, now } = setup();
  addAttempt(slug, "finished-but-planned", daysAgo(3, now), "planned", COMPLETE_STATUS_LINE);
  const project = portfolioSnapshot(now).projects[0];
  assert.equal(project.attempts.done, 1);
  assert.equal(project.attempts.evidence_done, 1);
  assert.equal(project.attempts.planned, 0);
  assert.equal(project.latest.status, "done");
  assert.equal(project.latest.status_source, "handoff");
  assert.equal(project.status, "completed");
});

test("historical attempts with evidence count as done; template placeholders do not", () => {
  const { slug, now } = setup();
  const done = makeHistorical(createAttemptInStore(slug, "legacy-done", daysAgo(20, now)));
  writeFileSync(join(done.folder, "HANDOFF.md"), FILLED_SECTION);
  const empty = makeHistorical(createAttemptInStore(slug, "legacy-empty", daysAgo(20, now)));
  writeFileSync(join(empty.folder, "HANDOFF.md"), TEMPLATE_SECTION);
  const project = portfolioSnapshot(now).projects[0];
  assert.equal(project.attempts.done, 1);
  assert.equal(project.attempts.evidence_done, 1);
  assert.equal(project.attempts.historical, 1);
});

test("open work without live harness evidence stays idle despite completion text", () => {
  const { slug, now } = setup();
  addAttempt(slug, "open", daysAgo(1, now), "in_progress", COMPLETE_STATUS_LINE);
  addAttempt(slug, "done-via-evidence", daysAgo(5, now), "planned", COMPLETE_STATUS_LINE);
  assert.equal(portfolioSnapshot(now).projects[0].status, "idle");
});

test("canonical progress refreshes portfolio activity without rewriting the registry", () => {
  const { home, slug, now } = setup();
  const registryPath = join(home, "projects.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.projects[slug].last_seen = daysAgo(60, now).toISOString();
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
  const historical = makeHistorical(createAttemptInStore(slug, "historical", daysAgo(60, now)));

  recordProgress(slug, {
    message: "fresh canonical checkpoint",
    next: "continue",
    files: [],
    attemptId: historical.id,
  });

  const stored = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.equal(stored.projects[slug].last_seen, daysAgo(60, now).toISOString());
  const project = portfolioSnapshot(now).projects[0];
  assert.equal(project.status, "idle");
  assert.ok(Date.parse(project.last_activity) > Date.parse(stored.projects[slug].last_seen));
});

// ─── Backfill: syncAttemptFromHandoff ───────────────────────────────────────

test("syncAttemptFromHandoff backfills planned attempts with evidence into done", () => {
  const { slug, now } = setup();
  const attempt = addAttempt(slug, "work", daysAgo(3, now), "planned", COMPLETE_STATUS_LINE);
  const result = syncAttemptFromHandoff(slug, attempt.id);
  assert.equal(result.changed, true);
  assert.equal(result.status, "done");
  assert.ok(result.completed_at);
  const stored = getAttempt(slug, attempt.id);
  assert.equal(stored.status, "done");
  assert.equal(stored.completed_at, result.completed_at);
});

test("syncAttemptFromHandoff uses the handoff mtime as completed_at", () => {
  const { slug, now } = setup();
  const attempt = addAttempt(slug, "work", daysAgo(3, now), "planned", COMPLETE_STATUS_LINE);
  const handoffPath = join(attempt.folder, "HANDOFF.md");
  const backdated = new Date(now.getTime() - 2 * DAY);
  utimesSync(handoffPath, backdated, backdated);
  const result = syncAttemptFromHandoff(slug, attempt.id);
  assert.equal(result.completed_at, backdated.toISOString());
});

test("syncAttemptFromHandoff is conservative: no evidence, open work, or done are left alone", () => {
  const { slug, now } = setup();
  const plain = addAttempt(slug, "plain", daysAgo(3, now), "planned");
  assert.equal(syncAttemptFromHandoff(slug, plain.id).changed, false);
  const open = addAttempt(slug, "open", daysAgo(1, now), "in_progress", COMPLETE_STATUS_LINE);
  assert.equal(syncAttemptFromHandoff(slug, open.id).changed, false);
  const done = addAttempt(slug, "done", daysAgo(2, now), "done", COMPLETE_STATUS_LINE);
  assert.equal(syncAttemptFromHandoff(slug, done.id).changed, false);
});

test("syncAttemptFromHandoff upgrades historical attempts with evidence", () => {
  const { slug, now } = setup();
  const attempt = makeHistorical(createAttemptInStore(slug, "legacy", daysAgo(10, now)));
  writeFileSync(join(attempt.folder, "HANDOFF.md"), COMPLETE_STATUS_LINE);
  const result = syncAttemptFromHandoff(slug, attempt.id);
  assert.equal(result.changed, true);
  assert.equal(getAttempt(slug, attempt.id).status, "done");
});

// ─── Automation: syncLifecycleFromProgress ──────────────────────────────────

test("syncLifecycleFromProgress starts a planned attempt", () => {
  const { slug, now } = setup();
  const attempt = addAttempt(slug, "work", daysAgo(1, now), "planned");
  const synced = syncLifecycleFromProgress(slug, attempt.id, null, now);
  assert.equal(synced.status, "in_progress");
  assert.equal(synced.current_phase, "define");
});

test("syncLifecycleFromProgress advances to the reported phase", () => {
  const { slug, now } = setup();
  const attempt = addAttempt(slug, "work", daysAgo(1, now), "in_progress");
  const synced = syncLifecycleFromProgress(slug, attempt.id, "build", now);
  assert.equal(synced.current_phase, "build");
  const final = syncLifecycleFromProgress(slug, attempt.id, "verify", now);
  assert.equal(final.current_phase, "verify");
});

test("syncLifecycleFromProgress ignores unknown phases and untracked attempts", () => {
  const { slug, now } = setup();
  const attempt = addAttempt(slug, "work", daysAgo(5, now), "in_progress");
  assert.equal(syncLifecycleFromProgress(slug, attempt.id, "not-a-phase", now), null);
  const historical = makeHistorical(createAttemptInStore(slug, "legacy", daysAgo(1, now)));
  assert.equal(syncLifecycleFromProgress(slug, historical.id, "define", now), null);
  assert.equal(getAttempt(slug, attempt.id).current_phase, "define");
});
