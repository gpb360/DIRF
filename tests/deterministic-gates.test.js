// Deterministic gate enforcement: gates open on facts the CLI captured
// (--run exit codes, built-in check results), never on typed claims.
// Completion of a gated attempt requires captured evidence and a canonical
// handoff at least as fresh as the last phase write. Checkpoints
// (record-progress) are adjacency-checked: current phase or immediate next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attemptAudit, attemptGates, createAttemptInStore, getAttempt, registerProject, updateAttemptLifecycle, writeHandoff } from "../src/state.js";

const CLI = join(process.cwd(), "src", "cli.js");

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
  // A valid review.json satisfies the check automatically.
  writeFileSync(join(attempt.folder, "review.json"), JSON.stringify({
    pr_url: "https://github.com/o/r/pull/1",
    base: "a".repeat(40),
    head_reviewed: "b".repeat(40),
    verdict: "PASS",
    evidence: ["ran checks"],
    findings: [{ id: 1, disposition: "resolved_local" }],
  }));
  const current = JSON.parse(cli(home, root,
    "attempt", "advance", attempt.id, "--path", root, "--json"));
  assert.equal(current.current_phase, "post");
  assert.equal(attemptGates(slug, attempt.id).find((g) => g.phase === "approve").check_ok, true);
});

test("an invalid review.json fails the built-in check with the reason", () => {
  const { home, root, attempt } = gatedAttempt({
    approve: { kind: "verify", check: "review-json" },
  });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  cli(home, root, "attempt", "advance", attempt.id, "--path", root);
  writeFileSync(join(attempt.folder, "review.json"), JSON.stringify({
    pr_url: "https://github.com/o/r/pull/1", verdict: "PASS", evidence: ["x"], findings: [],
    base: "a".repeat(40), head_reviewed: "not-a-sha",
  }));
  assert.throws(
    () => cli(home, root, "attempt", "advance", attempt.id, "--path", root),
    /head_reviewed must be a full 40-hex/,
  );
});

test("PASS verdicts with open findings fail the built-in check", () => {
  const { home, root, attempt } = gatedAttempt({
    approve: { kind: "verify", check: "review-json" },
  });
  cli(home, root, "attempt", "start", attempt.id, "--path", root);
  cli(home, root, "attempt", "advance", attempt.id, "--path", root);
  writeFileSync(join(attempt.folder, "review.json"), JSON.stringify({
    pr_url: "https://github.com/o/r/pull/1", base: "a".repeat(40), head_reviewed: "b".repeat(40),
    verdict: "PASS", evidence: ["x"],
    findings: [{ id: 1, disposition: "fix_now" }],
  }));
  assert.throws(
    () => cli(home, root, "attempt", "advance", attempt.id, "--path", root),
    /PASS verdict with open findings/,
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
    /no captured verification/,
  );
  assert.deepEqual(attemptAudit(slug, attempt.id), { gated: true, unaudited: true });
});

test("gate-free attempts keep their legacy completion behavior", () => {
  const { slug, attempt } = gatedAttempt({});
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  const done = updateAttemptLifecycle(slug, attempt.id, "complete", { confirm: true });
  assert.equal(done.status, "done");
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

test("decision gate records capture the agent that recorded them", () => {
  const { home, root, slug, attempt } = gatedAttempt({ approve: { kind: "decision" } });
  const env = {
    ...process.env, DIRF_HOME: home,
    DIRF_HARNESS: "zcode", DIRF_SESSION_ID: "sess_test", DIRF_MODEL: "test-model",
  };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: "utf8", timeout: 30000, env,
  });
  run("attempt", "start", attempt.id, "--path", root);
  run("attempt", "advance", attempt.id, "--run", "node -e \"process.exit(0)\"", "--path", root);
  run("attempt", "gate", attempt.id, "approve", "accept", "--comment", "ok", "--worker", "lead developer", "--path", root);
  const gate = attemptGates(slug, attempt.id).find((g) => g.phase === "approve");
  assert.equal(gate.status, "accepted");
  assert.equal(gate.by, "lead developer");
  assert.equal(gate.recorded_by, "zcode/sess_test on test-model");
});

test("recorded_by is derived from the detected environment (project + global dot-folders)", () => {
  const { home, root, slug, attempt } = gatedAttempt({ approve: { kind: "decision" } });
  // Fixture home with no harness folders and a project that has one.
  const emptyHome = mkdtempSync(join(tmpdir(), "dirf-no-harness-"));
  mkdirSync(join(emptyHome, "empty-home"), { recursive: true });
  const isolatedHome = join(emptyHome, "empty-home");
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, ".agents"), { recursive: true }); // shared convention — never a harness
  const env = {
    ...process.env, DIRF_HOME: home,
    HOME: isolatedHome, USERPROFILE: isolatedHome,
  };
  delete env.DIRF_HARNESS; delete env.DIRF_SESSION_ID; delete env.CODEX_THREAD_ID;
  delete env.CODEX_HOME; // persistent configuration, not a session marker
  delete env.DIRF_MODEL; delete env.ANTHROPIC_MODEL;
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CURSOR_AGENT; delete env.CURSOR_TRACE_ID;
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: "utf8", timeout: 30000, env,
  });
  run("attempt", "start", attempt.id, "--path", root);
  run("attempt", "gate", attempt.id, "approve", "accept", "--comment", "ok", "--path", root);
  const gate = attemptGates(slug, attempt.id).find((g) => g.phase === "approve");
  assert.equal(gate.recorded_by, "claude", `detected from the project dot-folder, got ${gate.recorded_by}`);
});

test("recorded_by is null only when nothing is installed and nothing is exported", () => {
  const { home, root, slug, attempt } = gatedAttempt({ approve: { kind: "decision" } });
  const emptyHome = mkdtempSync(join(tmpdir(), "dirf-no-harness-"));
  const isolatedHome = join(emptyHome, "home");
  mkdirSync(isolatedHome, { recursive: true });
  const env = {
    ...process.env, DIRF_HOME: home,
    HOME: isolatedHome, USERPROFILE: isolatedHome,
  };
  delete env.DIRF_HARNESS; delete env.DIRF_SESSION_ID; delete env.CODEX_THREAD_ID;
  delete env.CODEX_HOME; // persistent configuration, not a session marker
  delete env.DIRF_MODEL; delete env.ANTHROPIC_MODEL;
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CURSOR_AGENT; delete env.CURSOR_TRACE_ID;
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: "utf8", timeout: 30000, env,
  });
  run("attempt", "start", attempt.id, "--path", root);
  run("attempt", "gate", attempt.id, "approve", "accept", "--comment", "ok", "--path", root);
  assert.equal(attemptGates(slug, attempt.id).find((g) => g.phase === "approve").recorded_by, null);
});

test("CODEX_HOME is persistent configuration, not a session marker", () => {
  const { home, root, slug, attempt } = gatedAttempt({ approve: { kind: "decision" } });
  const emptyHome = mkdtempSync(join(tmpdir(), "dirf-no-harness-"));
  const isolatedHome = join(emptyHome, "home");
  mkdirSync(isolatedHome, { recursive: true });
  // A human exporting CODEX_HOME in a shell profile must not be recorded as
  // the codex harness: presence of a config marker is not the executor.
  const env = {
    ...process.env, DIRF_HOME: home,
    HOME: isolatedHome, USERPROFILE: isolatedHome,
    CODEX_HOME: join(emptyHome, "codex-config"),
  };
  delete env.DIRF_HARNESS; delete env.DIRF_SESSION_ID; delete env.CODEX_THREAD_ID;
  // CODEX_HOME stays set on purpose — the point under test.
  delete env.DIRF_MODEL; delete env.ANTHROPIC_MODEL;
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CURSOR_AGENT; delete env.CURSOR_TRACE_ID;
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: "utf8", timeout: 30000, env,
  });
  run("attempt", "start", attempt.id, "--path", root);
  run("attempt", "gate", attempt.id, "approve", "accept", "--comment", "ok", "--path", root);
  const gate = attemptGates(slug, attempt.id).find((g) => g.phase === "approve");
  assert.notEqual(gate.recorded_by, "codex", `CODEX_HOME alone must not attribute the decision to codex, got ${gate.recorded_by}`);
  assert.equal(gate.recorded_by, null);
});
