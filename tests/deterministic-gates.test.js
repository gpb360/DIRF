// Deterministic gate enforcement: gates open on facts the CLI captured
// (--run exit codes, built-in check results), never on typed claims.
// Completion of a gated attempt requires captured evidence and a canonical
// handoff at least as fresh as the last phase write. Checkpoints
// (record-progress) are adjacency-checked: current phase or immediate next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCurrentHandoff } from "../src/handoff-update.js";
import { attemptAudit, attemptGates, createAttemptInStore, getAttempt, readAttemptHandoff, readHandoff, registerProject, runBuiltinCheck, updateAttemptLifecycle, writeHandoff } from "../src/state.js";

const CLI = join(process.cwd(), "src", "cli.js");

// A review.json in the real review-report schema (skills/code-review), the
// shape `dirf review validate|ready review.json` enforces. Verdict is derived,
// never stored.
function validReviewArtifact() {
  return {
    schema_version: 2,
    target: { repository: "https://github.com/o/r", pr_number: 69, base_sha: "a".repeat(40), head_sha: "b".repeat(40), mode: "full" },
    walkthrough: [{ area: "gates", summary: "Deterministic gate enforcement.", files: ["src/state.js"] }],
    axes: Object.fromEntries(["spec", "correctness", "concurrency", "security", "data", "frontend", "testing", "standards"].map((axis) => [axis, { status: "checked", evidence: "reviewed the changed behavior" }])),
    confidence: { quality: 95, evidence: 95 },
    findings: [],
    verification: [{ command: "node --test", status: "passed", result: "all tests pass" }],
    limitations: [],
    completion: { review_complete: true, required_checks: "passed", unresolved_threads: 0 },
  };
}

function repo() {
  const root = mkdtempSync(join(tmpdir(), "dirf-det-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# test\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  return root;
}

function gatedAttempt(gates) {
  const home = mkdtempSync(join(tmpdir(), "dirf-det-home-"));
  process.env.DIRF_HOME = home;
  const root = repo();
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "deterministic", new Date("2026-09-01T00:00:00.000Z"));
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({
    workflow: { phases: ["build", "approve", "post"], gates },
  }));
  return { home, root, slug, attempt };
}

function cli(home, root, ...args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, DIRF_HOME: home },
  });
}

test("--run records the exit code and output digest; gate opens on exit 0", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  const done = JSON.parse(cli(home, root,
    "attempt", "advance", attempt.id, "--run", "node -e \"console.log('verified')\"", "--path", root, "--json"));
  const record = done.evidence.build;
  assert.equal(record.mode, "run");
  assert.equal(record.exit, 0);
  assert.match(record.output_sha256, /^[0-9a-f]{64}$/);
  assert.match(record.output, /verified/);
  assert.equal(attemptGates(slug, attempt.id).find((g) => g.phase === "build").run_exit, 0);
});

test("--run with a failing command refuses to cross the gate", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  assert.throws(
    () => cli(home, root, "attempt", "advance", attempt.id, "--run", "node -e \"process.exit(3)\"", "--path", root),
    /Recorded run exited 3/,
  );
  assert.equal(getAttempt(slug, attempt.id).current_phase, "build", "phase unchanged after failed run");
  assert.equal(attemptGates(slug, attempt.id).find((g) => g.phase === "build").status, "pending");
});

test("stored run output is bounded; the digest covers the full capture", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  cli(home, root, "attempt", "advance", attempt.id, "--run", "node -e \"console.log('z'.repeat(500000))\"", "--path", root);
  const record = getAttempt(slug, attempt.id).evidence.build;
  assert.ok(record.output.length <= 4000, `stored output bounded (${record.output.length})`);
  assert.equal(record.truncated, true);
  assert.match(record.output_sha256, /^[0-9a-f]{64}$/);
});

test("--auto refuses --run instead of silently ignoring it", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  assert.throws(
    () => cli(home, root, "attempt", "advance", attempt.id, "--auto", "--run", "node -e \"process.exit(1)\"", "--path", root),
    /--run cannot be combined with --auto/,
  );
  assert.equal(getAttempt(slug, attempt.id).current_phase, "build");
});

test("built-in check gates run inside DIRF and cannot be satisfied by --run or typed evidence", () => {
  const { home, root, slug, attempt } = gatedAttempt({
    approve: { kind: "verify", check: "review-json" },
  });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  cli(home, root, "attempt", "advance", attempt.id, "--run", "node -e \"process.exit(0)\"", "--path", root);
  // advance now sits ON "approve" — crossing it requires the built-in check.
  assert.throws(
    () => cli(home, root, "attempt", "advance", attempt.id, "--run", "node -e \"process.exit(0)\"", "--path", root),
    /built-in check "review-json"/i,
  );
  assert.throws(
    () => updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "whatever", exit: 0 } }),
    /built-in check "review-json"/i,
  );
  // A review.json that passes the playbook's own validation (the real
  // review-report schema) satisfies the check automatically.
  writeFileSync(join(attempt.folder, "review.json"), JSON.stringify(validReviewArtifact()));
  const current = JSON.parse(cli(home, root,
    "attempt", "advance", attempt.id, "--path", root, "--json"));
  assert.equal(current.current_phase, "post");
  assert.equal(attemptGates(slug, attempt.id).find((g) => g.phase === "approve").check_ok, true);
});

test("an artifact the review playbook rejects fails the gate with the same reason", () => {
  const { home, root, attempt } = gatedAttempt({
    approve: { kind: "verify", check: "review-json" },
  });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  cli(home, root, "attempt", "advance", attempt.id, "--path", root);
  writeFileSync(join(attempt.folder, "review.json"), JSON.stringify({ ...validReviewArtifact(), findings: [{ id: "f1" }] }));
  assert.throws(
    () => cli(home, root, "attempt", "advance", attempt.id, "--path", root),
    /findings\[0\]\.priority must be P0, P1, P2, or P3/,
  );
});

test("the gate check and `dirf review validate` agree on the same artifact", () => {
  const { home, root, slug, attempt } = gatedAttempt({
    approve: { kind: "verify", check: "review-json" },
  });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  cli(home, root, "attempt", "advance", attempt.id, "--path", root);
  const reviewPath = join(home, "review.json");
  writeFileSync(reviewPath, JSON.stringify(validReviewArtifact()));
  // The playbook's declared validation (`dirf review ready review.json`
  // shares this validator) accepts exactly this artifact.
  assert.match(cli(home, root, "review", "validate", reviewPath), /Valid DIRF review artifact: PASS/);
  writeFileSync(join(attempt.folder, "review.json"), readFileSync(reviewPath, "utf8"));
  assert.equal(runBuiltinCheck(slug, attempt.id, "review-json").ok, true);

  const brokenPath = join(home, "broken-review.json");
  writeFileSync(brokenPath, JSON.stringify({ ...validReviewArtifact(), target: { ...validReviewArtifact().target, head_sha: "nope" } }));
  let playbookError = "";
  try { cli(home, root, "review", "validate", brokenPath); } catch (error) { playbookError = error.message; }
  assert.match(playbookError, /target\.head_sha must be a 40-character Git SHA/);
  writeFileSync(join(attempt.folder, "review.json"), readFileSync(brokenPath, "utf8"));
  const rejected = runBuiltinCheck(slug, attempt.id, "review-json");
  assert.equal(rejected.ok, false);
  assert.match(rejected.output, /target\.head_sha must be a 40-character Git SHA/);
});

test("a stored verdict fails the built-in check — the verdict is derived, not stored", () => {
  const { home, root, attempt } = gatedAttempt({
    approve: { kind: "verify", check: "review-json" },
  });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  cli(home, root, "attempt", "advance", attempt.id, "--path", root);
  writeFileSync(join(attempt.folder, "review.json"), JSON.stringify({ ...validReviewArtifact(), verdict: "PASS" }));
  assert.throws(
    () => cli(home, root, "attempt", "advance", attempt.id, "--path", root),
    /verdict is derived and must not be stored/,
  );
});

test("gated attempts refuse completion when the canonical handoff is missing or stale", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  // advance through "approve" (no gate) with a captured run; now at "post".
  cli(home, root, "attempt", "advance", attempt.id, "--run", "node -e \"process.exit(0)\"", "--path", root);
  cli(home, root, "attempt", "advance", attempt.id, "--path", root);
  assert.throws(
    () => cli(home, root, "attempt", "complete", attempt.id, "--confirm", "--path", root),
    /canonical handoff.*does not exist/i,
  );
  const handoffFile = join(home, "h.md");
  writeFileSync(handoffFile, "# DIRF Handoff\n");
  cli(home, root, "state", "write-handoff", "--path", root, "--file", handoffFile);
  // Post-handoff lifecycle writes make the handoff stale again.
  cli(home, root, "attempt", "block", attempt.id, "--reason", "pause", "--path", root);
  cli(home, root, "attempt", "reopen", attempt.id, "--path", root);
  assert.throws(
    () => cli(home, root, "attempt", "complete", attempt.id, "--confirm", "--path", root),
    /older than the last phase write/,
  );
  cli(home, root, "state", "write-handoff", "--path", root, "--file", handoffFile);
  const done = JSON.parse(cli(home, root, "attempt", "complete", attempt.id, "--confirm", "--path", root, "--json"));
  assert.equal(done.status, "done");
});

test("attempts whose gates carry only typed evidence cannot complete and project unaudited", () => {
  const { slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  updateAttemptLifecycle(slug, attempt.id, "start");
  // Legacy text evidence still crosses mid-flow gates for in-flight attempts...
  updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "node --test", output: "typed claim" } });
  assert.equal(attemptGates(slug, attempt.id).find((g) => g.phase === "build").status, "satisfied");
  // ...but completion demands captured facts, and the attempt is visibly
  // unaudited for as long as the only gate record is a typed claim.
  updateAttemptLifecycle(slug, attempt.id, "advance");
  writeHandoff(slug, "# Handoff\n");
  assert.throws(
    () => updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true }),
    // No command can re-capture a gate crossed only with typed evidence: the
    // error must say the attempt cannot be completed and must be restarted.
    /no captured verification[\s\S]*abandon/,
  );
  assert.deepEqual(attemptAudit(slug, attempt.id), { gated: true, unaudited: true });
});

test("public attempt views derive unaudited from stored facts without a gate error", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "node --test", output: "typed claim" } });
  const listed = JSON.parse(cli(home, root, "list", "--path", root, "--json"));
  const view = listed.find((entry) => entry.id === attempt.id);
  assert.deepEqual({ gated: view.gated, unaudited: view.unaudited }, { gated: true, unaudited: true });
  assert.equal(view.gate_error, undefined);
});

test("gate-free attempts keep their legacy completion behavior", () => {
  const { slug, attempt } = gatedAttempt({});
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  const done = updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true });
  assert.equal(done.status, "done");
});

test("--auto refuses --run before auto-advance mutates anything", () => {
  const { home, root, slug, attempt } = gatedAttempt({});
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  assert.throws(
    () => cli(home, root, "attempt", "advance", attempt.id, "--auto", "--run", "node -e \"process.exit(1)\"", "--path", root),
    /--run cannot be combined with --auto/,
  );
  const after = getAttempt(slug, attempt.id);
  assert.equal(after.current_phase, "build", "auto-advance must not run before the guard");
  assert.equal(after.evidence, undefined);
});

test("a rejected record-progress appends no section and consumes no update number", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  assert.throws(
    () => cli(home, root, "record-progress", "jump", "--attempt", attempt.id, "--phase", "post", "--path", root),
    /immediate successor/,
  );
  assert.equal(readAttemptHandoff(slug, attempt.id), null, "no attempt handoff section after rejection");
  assert.equal(readHandoff(slug), null, "canonical handoff untouched after rejection");
  // The corrected retry numbers its section as if the rejected call never ran.
  cli(home, root, "record-progress", "steady", "--attempt", attempt.id, "--phase", "build", "--path", root);
  const handoff = parseCurrentHandoff(readAttemptHandoff(slug, attempt.id));
  assert.equal(handoff.updateNumber, 1);
  assert.deepEqual(handoff.completedSteps, ["steady"]);
});

test("an unsatisfied gate rejects record-progress before any write", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  assert.throws(
    () => cli(home, root, "record-progress", "hop", "--attempt", attempt.id, "--phase", "approve", "--path", root),
    /gate on "build" is unsatisfied/,
  );
  assert.equal(readAttemptHandoff(slug, attempt.id), null);
});

test("record-progress rejects phases beyond the immediate successor", () => {
  const { home, root, slug, attempt } = gatedAttempt({ build: { kind: "verify" } });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  assert.throws(
    () => cli(home, root, "record-progress", "jump", "--attempt", attempt.id, "--phase", "post", "--path", root),
    /immediate successor/,
  );
  assert.equal(getAttempt(slug, attempt.id).current_phase, "build");
  // The adjacent phase is fine once the gate on "build" is crossed.
  cli(home, root, "attempt", "advance", attempt.id, "--run", "node -e \"process.exit(0)\"", "--path", root);
  cli(home, root, "record-progress", "stepped forward", "--attempt", attempt.id, "--phase", "approve", "--path", root);
  assert.equal(getAttempt(slug, attempt.id).current_phase, "approve");
});
