// Gate lifecycle tests — playbook-declared phases with verify/decision/soft
// kinds, tri-state gate records, evidence recording (replay-don't-rerun),
// guarded auto-advance, wait types, and reconciliation (pending gates on
// resume). Old gate-free attempts must behave exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attemptGates,
  autoAdvance,
  createAttemptInStore,
  getAttempt,
  pendingGates,
  recordAttemptArtifact,
  acceptAttemptArtifact,
  recordedEvidence,
  registerProject,
  syncLifecycleFromProgress,
  updateAttemptLifecycle,
} from "../src/state.js";
import { reconcile } from "../src/flow.js";
import { validateSnapshot } from "../src/validate.js";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "dirf-gates-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# test\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" } });
  return root;
}

function attemptFixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-gates-home-"));
  process.env.DIRF_HOME = home;
  const root = repo();
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "gated", new Date("2026-08-01T00:00:00.000Z"));
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({
    workflow: {
      phases: ["define", "design", "build", "verify", "ship"],
      gates: {
        "design": { kind: "decision" },
        "build": { kind: "verify" },
        "verify": { kind: "soft" },
      },
    },
  }));
  writeFileSync(join(attempt.folder, "HANDOFF.md"), "## Exact next action\n\nDo the thing.\n");
  return { home, root, slug, attempt };
}

function gateFreeFixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-gates-home-"));
  process.env.DIRF_HOME = home;
  const root = repo();
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "plain", new Date("2026-08-01T00:00:00.000Z"));
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({
    workflow: { phases: ["define", "design", "build", "verify", "ship"] },
  }));
  return { home, root, slug, attempt };
}

function artifactGateFixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-gates-home-"));
  process.env.DIRF_HOME = home;
  const root = repo();
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "artifact-gated", new Date("2026-08-01T00:00:00.000Z"));
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({
    workflow: {
      phases: ["define", "design", "build"],
      gates: { design: { kind: "decision", artifact_type: "plan" } },
    },
  }));
  writeFileSync(join(attempt.folder, "plan.md"), "# Accepted plan\n");
  return { home, root, slug, attempt };
}

function acceptPlan(slug, attempt) {
  recordAttemptArtifact(slug, attempt.id, { id: "plan-v1", type: "plan", path: "plan.md" });
  return acceptAttemptArtifact(slug, attempt.id, "plan-v1");
}

test("verify gates block advance until evidence is recorded", () => {
  const { slug, attempt } = attemptFixture();
  let current = updateAttemptLifecycle(slug, attempt.id, "start");
  assert.equal(current.current_phase, "define");
  current = updateAttemptLifecycle(slug, attempt.id, "advance");
  assert.equal(current.current_phase, "design");
  // leaving "design" (decision gate) first — record the decision
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "scope confirmed" });
  current = updateAttemptLifecycle(slug, attempt.id, "advance");
  assert.equal(current.current_phase, "build");
  // leaving "build" (verify gate) requires an evidence record
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance"), /verify gate/);
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "" } }), /evidence command must not be empty/);
  // gate record alone does NOT satisfy a verify gate — evidence does
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "build", decision: "accept", comment: "not how verify works" });
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance"), /verify gate/);
  current = updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "node --test", output: "tests.log" } });
  assert.equal(current.current_phase, "verify");
  assert.equal(current.evidence.build.command, "node --test");
  assert.equal(current.evidence.build.output, "tests.log");
});

test("decision gates block advance until an accepted record; deny requires a comment", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  assert.equal(getAttempt(slug, attempt.id).current_phase, "design");
  // leaving "design" (decision gate) requires an accepted record
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance"), /decision gate/);
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "deny" }), /denial requires a comment/);
  // denied stays blocking — revise and retry
  let current = updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "deny", comment: "not enough scope detail" });
  assert.equal(current.gates.design.status, "denied");
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance"), /decision gate/);
  current = updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "revised per feedback" });
  assert.equal(current.gates.design.status, "accepted");
  current = updateAttemptLifecycle(slug, attempt.id, "advance");
  assert.equal(current.current_phase, "build");
});

test("manual advance requires the accepted governing artifact declared by a decision gate", () => {
  const { slug, attempt } = artifactGateFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "plan approved" });
  assert.deepEqual(
    attemptGates(slug, attempt.id).map(({ phase, status, artifact_type, artifact_id }) => ({ phase, status, artifact_type, artifact_id })),
    [{ phase: "design", status: "pending", artifact_type: "plan", artifact_id: null }],
  );
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance"), /accepted governing artifact.*plan/);
  recordAttemptArtifact(slug, attempt.id, { id: "plan-v1", type: "plan", path: "plan.md" });
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance"), /accepted governing artifact.*plan/);
  acceptAttemptArtifact(slug, attempt.id, "plan-v1");
  assert.deepEqual(
    attemptGates(slug, attempt.id).map(({ phase, status, artifact_type, artifact_id }) => ({ phase, status, artifact_type, artifact_id })),
    [{ phase: "design", status: "accepted", artifact_type: "plan", artifact_id: "plan-v1" }],
  );
  assert.equal(updateAttemptLifecycle(slug, attempt.id, "advance").current_phase, "build");
});

test("artifact-aware gates fail closed when accepted content is deleted", () => {
  const { slug, attempt } = artifactGateFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "plan approved" });
  acceptPlan(slug, attempt);
  rmSync(join(attempt.folder, "plan.md"));

  assert.deepEqual(
    attemptGates(slug, attempt.id).map(({ status, artifact_id }) => ({ status, artifact_id })),
    [{ status: "pending", artifact_id: null }],
  );
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance"), /accepted governing artifact.*plan/);
});

test("soft gates advance without a record unless --strict", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "ok" });
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "node --test" } });
  assert.equal(getAttempt(slug, attempt.id).current_phase, "verify");
  // soft "verify" phase: --strict promotes it to a hard check
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "advance", { strict: true }), /soft gate/);
  let current = updateAttemptLifecycle(slug, attempt.id, "advance");
  assert.equal(current.current_phase, "ship");
});

test("autoAdvance crosses covered phases and stops at the first unsatisfied gate", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  let out = autoAdvance(slug, attempt.id, { now: new Date("2026-08-01T00:00:01.000Z") });
  assert.deepEqual([out.advanced, out.stopped_at_gate, out.attempt.current_phase], [1, "design", "design"]);
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "ok" });
  out = autoAdvance(slug, attempt.id);
  assert.deepEqual([out.advanced, out.stopped_at_gate, out.attempt.current_phase], [1, "build", "build"]);
  updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "node --test" } });
  out = autoAdvance(slug, attempt.id);
  // soft "verify" gate passes without strict — sails through to the final phase
  assert.deepEqual([out.advanced, out.stopped_at_gate, out.attempt.current_phase], [1, null, "ship"]);
  // from the final phase nothing advances
  out = autoAdvance(slug, attempt.id);
  assert.deepEqual([out.advanced, out.stopped_at_gate], [0, null]);
});

test("autoAdvance stops at an artifact-aware decision gate until its artifact is accepted", () => {
  const { slug, attempt } = artifactGateFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  let out = autoAdvance(slug, attempt.id);
  assert.deepEqual([out.advanced, out.stopped_at_gate, out.attempt.current_phase], [1, "design", "design"]);
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "approved" });
  out = autoAdvance(slug, attempt.id);
  assert.deepEqual([out.advanced, out.stopped_at_gate, out.attempt.current_phase], [0, "design", "design"]);
  acceptPlan(slug, attempt);
  out = autoAdvance(slug, attempt.id);
  assert.deepEqual([out.advanced, out.stopped_at_gate, out.attempt.current_phase], [1, null, "build"]);
});

test("autoAdvance with --evidence records it for the first leaving phase and satisfies a verify gate", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance"); // → design
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "ok" });
  updateAttemptLifecycle(slug, attempt.id, "advance"); // → build (verify gate ahead)
  // at build: evidence satisfies the verify gate, then the soft gate passes
  const out = autoAdvance(slug, attempt.id, { evidence: { command: "node --test", output: "tests.log" } });
  assert.deepEqual([out.advanced, out.stopped_at_gate, out.attempt.current_phase], [2, null, "ship"]);
  assert.equal(recordedEvidence(slug, attempt.id).build.command, "node --test");
  assert.equal(recordedEvidence(slug, attempt.id).build.output, "tests.log");
});

test("autoAdvance with evidence stops at a decision gate and records nothing for it", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start"); // define
  // leaving define records evidence.define (non-gated), then the design
  // decision gate stops the run without a record
  const out = autoAdvance(slug, attempt.id, { evidence: { command: "node --test" } });
  assert.deepEqual([out.advanced, out.stopped_at_gate, out.attempt.current_phase], [1, "design", "design"]);
  const evidence = recordedEvidence(slug, attempt.id);
  assert.equal(evidence.define.command, "node --test");
  assert.equal(evidence.design, undefined);
});

test("autoAdvance rejects an empty evidence command", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  assert.throws(() => autoAdvance(slug, attempt.id, { evidence: { command: "  " } }), /evidence command must not be empty/);
});

test("dirf attempt advance --auto --evidence works end to end via the CLI", () => {
  const { home, root, attempt } = attemptFixture();
  const cli = (...args) => execFileSync(process.execPath, [join(process.cwd(), "src", "cli.js"), ...args], { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, DIRF_HOME: home } });
  cli("attempt", "start", attempt.id, "--path", root);
  cli("attempt", "gate", attempt.id, "design", "accept", "--comment", "ok", "--path", root);
  cli("attempt", "advance", attempt.id, "--path", root); // → design
  cli("attempt", "advance", attempt.id, "--path", root); // → build (verify gate)
  const auto = JSON.parse(cli("attempt", "advance", attempt.id, "--auto", "--evidence", "node --test", "--output", "tests.log", "--path", root, "--json"));
  assert.deepEqual([auto.current_phase, auto.advanced, auto.stopped_at_gate], ["ship", 2, null]);
  assert.equal(auto.evidence.build.command, "node --test");
  assert.equal(auto.evidence.build.output, "tests.log");
});

test("dirf attempt advance --strict enforces soft gates via the CLI", () => {
  const { home, root, attempt } = attemptFixture();
  const cli = (...args) => execFileSync(process.execPath, [join(process.cwd(), "src", "cli.js"), ...args], { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, DIRF_HOME: home } });
  cli("attempt", "start", attempt.id, "--path", root);
  cli("attempt", "gate", attempt.id, "design", "accept", "--comment", "ok", "--path", root);
  cli("attempt", "advance", attempt.id, "--path", root);
  cli("attempt", "advance", attempt.id, "--path", root);
  cli("attempt", "advance", attempt.id, "--evidence", "node --test", "--path", root); // → verify (soft)
  assert.throws(() => cli("attempt", "advance", attempt.id, "--strict", "--path", root), /soft gate/);
});

test("resume --json carries pending_gates and recorded_evidence", () => {
  const { home, root, attempt } = attemptFixture();
  const cli = (...args) => execFileSync(process.execPath, [join(process.cwd(), "src", "cli.js"), ...args], { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, DIRF_HOME: home } });
  cli("attempt", "start", attempt.id, "--path", root);
  const out = JSON.parse(cli("resume", attempt.id, "--path", root, "--json"));
  assert.ok(Array.isArray(out.pending_gates));
  assert.ok(out.pending_gates.some((g) => g.phase === "design" && g.kind === "decision"));
  assert.deepEqual(out.recorded_evidence, {});
});

test("block records wait types; reopen clears them", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  let current = updateAttemptLifecycle(slug, attempt.id, "block", { reason: "awaiting user decision", wait: "input" });
  assert.deepEqual([current.status, current.wait], ["blocked", "input"]);
  current = updateAttemptLifecycle(slug, attempt.id, "reopen");
  assert.equal(current.wait, null);
  current = updateAttemptLifecycle(slug, attempt.id, "block", { reason: "external dependency" });
  assert.equal(current.wait, null); // absent = blocker by default
});

test("pendingGates reflects the tri-state: pending → accepted/satisfied", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  assert.deepEqual(pendingGates(slug, attempt.id).map((g) => g.phase), ["design", "build", "verify"]);
  // evidence on a verify gate marks it satisfied (not pending), no record needed
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "ok" });
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "node --test" } });
  assert.deepEqual(pendingGates(slug, attempt.id).map((g) => g.phase), ["verify"]);
  const gates = attemptGates(slug, attempt.id);
  assert.equal(gates.find((g) => g.phase === "design").status, "accepted");
  assert.equal(gates.find((g) => g.phase === "build").status, "satisfied");
  assert.equal(gates.find((g) => g.phase === "verify").status, "pending");
});

test("evidence is recorded per phase and replayable via recordedEvidence", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "ok" });
  updateAttemptLifecycle(slug, attempt.id, "advance");
  updateAttemptLifecycle(slug, attempt.id, "advance", { evidence: { command: "node --test", output: "tests.log" } });
  const evidence = recordedEvidence(slug, attempt.id);
  assert.deepEqual(Object.keys(evidence), ["build"]);
  assert.equal(evidence.build.command, "node --test");
});

test("gate decisions validate phase, state, and decision value", () => {
  const { slug, attempt } = attemptFixture();
  // planned attempt cannot record a decision
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept" }), /in-progress/);
  updateAttemptLifecycle(slug, attempt.id, "start");
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "nope", decision: "accept" }), /Unknown phase/);
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "maybe" }), /must be "accept" or "deny"/);
});

test("gate-free attempts advance exactly as before", () => {
  const { slug, attempt } = gateFreeFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  let current = attempt;
  for (let i = 0; i < 4; i += 1) current = updateAttemptLifecycle(slug, attempt.id, "advance");
  assert.equal(current.current_phase, "ship");
  assert.equal(current.evidence, undefined);
  assert.equal(current.gates, undefined);
});

test("syncLifecycleFromProgress stops at gates instead of crossing them", () => {
  const { slug, attempt } = attemptFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  const synced = syncLifecycleFromProgress(slug, attempt.id, "ship");
  assert.equal(synced, null);
  assert.equal(getAttempt(slug, attempt.id).current_phase, "design");
});

test("progress sync uses the artifact-aware gate seam", () => {
  const { slug, attempt } = artifactGateFixture();
  updateAttemptLifecycle(slug, attempt.id, "start");
  assert.equal(syncLifecycleFromProgress(slug, attempt.id, "build"), null);
  assert.equal(getAttempt(slug, attempt.id).current_phase, "design");
  updateAttemptLifecycle(slug, attempt.id, "gate", { phase: "design", decision: "accept", comment: "approved" });
  assert.equal(syncLifecycleFromProgress(slug, attempt.id, "build"), null);
  assert.equal(getAttempt(slug, attempt.id).current_phase, "design");
  acceptPlan(slug, attempt);
  assert.equal(syncLifecycleFromProgress(slug, attempt.id, "build").current_phase, "build");
});

test("dirf attempt gate + advance --auto work end to end via the CLI", () => {
  const { home, root, attempt } = attemptFixture();
  const cli = (...args) => execFileSync(process.execPath, [join(process.cwd(), "src", "cli.js"), ...args], { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, DIRF_HOME: home } });
  cli("attempt", "start", attempt.id, "--path", root);
  const gated = JSON.parse(cli("attempt", "gate", attempt.id, "design", "accept", "--comment", "ok", "--path", root, "--json"));
  assert.equal(gated.gates.find((g) => g.phase === "design").status, "accepted");
  const auto = JSON.parse(cli("attempt", "advance", attempt.id, "--auto", "--path", root, "--json"));
  // covered transition (design, now accepted) auto-advances; the unsatisfied
  // build verify gate stops the run
  assert.deepEqual([auto.current_phase, auto.advanced, auto.stopped_at_gate], ["build", 2, "build"]);
  // block with a wait type
  const blocked = JSON.parse(cli("attempt", "block", attempt.id, "--reason", "need input", "--wait", "input", "--path", root, "--json"));
  assert.equal(blocked.wait, "input");
});

test("resume reconciles pending gates and replays recorded evidence", () => {
  const { home, root, attempt } = attemptFixture();
  const cli = (...args) => execFileSync(process.execPath, [join(process.cwd(), "src", "cli.js"), ...args], { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, DIRF_HOME: home } });
  cli("attempt", "start", attempt.id, "--path", root);
  const out = cli("resume", attempt.id, "--path", root);
  assert.match(out, /Pending gates \(reconcile before continuing\)/);
  assert.match(out, /design \(decision\)/);
  assert.match(out, /build \(verify\)/);
});

test("reconcile validates gate declarations against declared phases", () => {
  const base = {
    description: "d", keywords: [], agents: [],
    workflow: { phases: ["a", "b"], output: "o", validation: "v", recovery: "r" },
    skill_flow: { label: "l", steps: [{ stage: "s", reason: "why", capability: "cap" }] },
  };
  const withGates = { ...base, workflow: { ...base.workflow, gates: { b: { kind: "decision" } } } };
  assert.deepEqual(reconcile({ triage: base, gated: withGates }), []);
  const artifactGate = { ...base, workflow: { ...base.workflow, gates: { b: { kind: "decision", artifact_type: "plan" } } } };
  assert.deepEqual(reconcile({ triage: base, gated: artifactGate }), []);
  const unknownPhase = reconcile({ triage: base, gated: { ...withGates, workflow: { ...base.workflow, gates: { nope: { kind: "decision" } } } } });
  assert.ok(unknownPhase.some((e) => /gates references unknown phase nope/.test(e)));
  const badKind = reconcile({ triage: base, gated: { ...withGates, workflow: { ...base.workflow, gates: { b: { kind: "wat" } } } } });
  assert.ok(badKind.some((e) => /kind must be verify, decision, or soft/.test(e)));
  const emptyVerify = reconcile({ triage: base, gated: { ...withGates, workflow: { ...base.workflow, gates: { b: { kind: "verify", verify: "" } } } } });
  assert.ok(emptyVerify.some((e) => /verify must be a non-empty string/.test(e)));
  const unknownArtifact = reconcile({ triage: base, gated: { ...withGates, workflow: { ...base.workflow, gates: { b: { kind: "decision", artifact_type: "wat" } } } } });
  assert.ok(unknownArtifact.some((e) => /artifact_type must be one of/.test(e)));
  const artifactOnVerify = reconcile({ triage: base, gated: { ...withGates, workflow: { ...base.workflow, gates: { b: { kind: "verify", artifact_type: "plan" } } } } });
  assert.ok(artifactOnVerify.some((e) => /artifact_type is only valid for decision gates/.test(e)));
  const notObject = reconcile({ triage: base, gated: { ...withGates, workflow: { ...base.workflow, gates: "x" } } });
  assert.ok(notObject.some((e) => /workflow.gates must be an object/.test(e)));
});

test("validateSnapshot accepts valid gates and rejects malformed ones", () => {
  const base = {
    schema_version: 5,
    name: "x", task: "t", playbook: "p", playbook_description: "pd",
    agents: [], baseline_skills: [], questions: [],
    skill_flow: { label: "l", steps: [] },
    policy: "policies/workflow-policy.md",
    capability_gaps: [],
    attempt: { id: "1", path: "attempts/1" },
    lifecycle: { clarify: "c", prototype: "p", split: "s", implement: "i", review: "r" },
    workflow: { phases: ["a", "b"], output: "o", validation: "v", recovery: "r", gates: { b: { kind: "decision" } } },
  };
  assert.deepEqual(validateSnapshot(base, "demo.json"), []);
  assert.deepEqual(validateSnapshot({ ...base, workflow: { ...base.workflow, gates: { b: { kind: "decision", artifact_type: "plan" } } } }, "demo.json"), []);
  const unknown = validateSnapshot({ ...base, workflow: { ...base.workflow, gates: { nope: { kind: "decision" } } } }, "demo.json");
  assert.ok(unknown.some((e) => /gates references unknown phase nope/.test(e)));
  const badKind = validateSnapshot({ ...base, workflow: { ...base.workflow, gates: { b: { kind: "wat" } } } }, "demo.json");
  assert.ok(badKind.some((e) => /kind must be verify, decision, or soft/.test(e)));
  const unknownArtifact = validateSnapshot({ ...base, workflow: { ...base.workflow, gates: { b: { kind: "decision", artifact_type: "wat" } } } }, "demo.json");
  assert.ok(unknownArtifact.some((e) => /artifact_type must be one of/.test(e)));
  const artifactOnVerify = validateSnapshot({ ...base, workflow: { ...base.workflow, gates: { b: { kind: "verify", artifact_type: "plan" } } } }, "demo.json");
  assert.ok(artifactOnVerify.some((e) => /artifact_type is only valid for decision gates/.test(e)));
});
