import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAttemptInStore, getAttempt, recordProgress, registerProject,
  storeProjectDir, updateAttemptLifecycle, writeHandoff,
} from "../src/state.js";

function fixture(t, phases = ["verify"]) {
  const previousHome = process.env.DIRF_HOME;
  const home = mkdtempSync(join(tmpdir(), "dirf-completion-"));
  process.env.DIRF_HOME = home;
  const root = join(home, "repository");
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "completion");
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({
    workflow: { phases, gates: { [phases[0]]: { kind: "decision" } } },
  }));
  writeFileSync(join(attempt.folder, "HANDOFF.md"), "# DIRF Handoff\n\n## Objective\n\nVerify this task\n");
  const older = new Date(Date.now() - 1000);
  updateAttemptLifecycle(slug, attempt.id, "start", {}, older);
  updateAttemptLifecycle(slug, attempt.id, "gate", {
    phase: phases[0], decision: "accept", comment: "User approved the result",
  }, older);
  const canonicalPath = join(storeProjectDir(slug), "HANDOFF.md");
  writeHandoff(slug, "# DIRF Handoff\n\n## Attempt ID\n\nother-task\n\n## Work item\n\npr:71\n\n## Completed\n\n- Preserve other owner's work\n");
  const stale = new Date(older.getTime() - 1000);
  utimesSync(canonicalPath, stale, stale);
  t.after(() => {
    if (previousHome === undefined) delete process.env.DIRF_HOME;
    else process.env.DIRF_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });
  return { slug, attempt, canonicalPath };
}

test("a current task checkpoint permits completion without changing another owner's shared summary", (t) => {
  const { slug, attempt, canonicalPath } = fixture(t);
  const canonical = readFileSync(canonicalPath, "utf8");
  const progress = recordProgress(slug, {
    attemptId: attempt.id, phase: "verify", message: "Fix verified", next: "Complete",
  });
  assert.equal(progress.recorded, true);
  assert.equal(progress.accepted, false);
  assert.equal(progress.reason, "missing_work_item");
  assert.equal(updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }).status, "done");
  assert.equal(readFileSync(canonicalPath, "utf8"), canonical);
  assert.equal(getAttempt(slug, attempt.id).status, "done");
});

test("a checkpoint that advances to the final phase remains fresh for completion", (t) => {
  const { slug, attempt, canonicalPath } = fixture(t, ["reproduce", "verify"]);
  const canonical = readFileSync(canonicalPath, "utf8");
  const progress = recordProgress(slug, {
    attemptId: attempt.id, phase: "verify", message: "All checks passed", next: "Complete",
  });
  assert.equal(progress.recorded, true);
  assert.equal(progress.lifecycle.current_phase, "verify");
  assert.equal(updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }).status, "done");
  assert.equal(readFileSync(canonicalPath, "utf8"), canonical);
});

test("a stale task checkpoint cannot borrow freshness from a newer shared summary", (t) => {
  const { slug, attempt } = fixture(t);
  recordProgress(slug, { attemptId: attempt.id, phase: "verify", message: "Verified", next: "Complete" });
  const stale = new Date(Date.now() - 60_000);
  utimesSync(join(attempt.folder, "HANDOFF.md"), stale, stale);
  writeHandoff(slug, "# Fresh project summary\n");
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }), /Task handoff is older/);
  assert.equal(getAttempt(slug, attempt.id).status, "in_progress");
});

test("completion rejects a handoff from another task or an earlier phase", (t) => {
  const { slug, attempt } = fixture(t);
  const path = join(attempt.folder, "HANDOFF.md");
  writeFileSync(path, "## Attempt ID\n\nwrong-task\n\n## Current phase\n\nverify\n");
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }), /belongs to wrong-task/);
  writeFileSync(path, `## Attempt ID\n\n${attempt.id}\n\n## Current phase\n\nreproduce\n`);
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }), /phase does not match/);
  assert.equal(getAttempt(slug, attempt.id).status, "in_progress");
});

test("a fresh task checkpoint cannot bypass a denied decision or missing captured verification", (t) => {
  const { slug, attempt } = fixture(t);
  recordProgress(slug, { attemptId: attempt.id, phase: "verify", message: "Tests passed", next: "Complete" });
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "verify", decision: "deny", comment: "Needs review" });
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }), /decision gate/);
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({
    workflow: { phases: ["verify"], gates: { verify: { kind: "verify", verify: "node --test" } } },
  }));
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "complete", {
    confirm: true, evidence: { command: "node --test", output: "claimed pass" },
  }), /no captured verification/);
  assert.equal(getAttempt(slug, attempt.id).status, "in_progress");
});

test("completion stops when a newer related checkpoint requires reconciliation", (t) => {
  const { slug, attempt } = fixture(t);
  recordProgress(slug, { attemptId: attempt.id, phase: "verify", message: "Verified", next: "Complete" });
  writeHandoff(slug, `## Attempt ID\n\n${attempt.id}\n\n## Update number\n\n999\n\n## Exact next action\n\nReview the newer result\n`);
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }), /Newer project work/);
  assert.equal(getAttempt(slug, attempt.id).status, "in_progress");
});
