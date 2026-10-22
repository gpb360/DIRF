import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  registerProject, createAttemptInStore, recordAttemptArtifact, acceptAttemptArtifact,
  recordProgress, getAttempt, storeProjectDir, attemptSummary, attemptResponsibility,
  claimAttemptCheckout, updateAttemptLifecycle, attemptContextState,
} from "../src/state.js";

const scratch = resolve(".scratch/ne004-summary");
mkdirSync(scratch, { recursive: true });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = value => JSON.parse(Buffer.from(value, "base64url"));

function fixture(t, { count = 7, mapped = count, git = false } = {}) {
  const oldHome = process.env.DIRF_HOME;
  const home = mkdtempSync(join(scratch, "home-"));
  process.env.DIRF_HOME = home;
  t.after(() => { if (oldHome === undefined) delete process.env.DIRF_HOME; else process.env.DIRF_HOME = oldHome; });
  const root = mkdtempSync(join(scratch, "repo-"));
  if (git) {
    execFileSync("git", ["init", "--quiet", root]);
    execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
  }
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "summary");
  const workflow = { workflow: { phases: ["build", "approve", "finish"], gates: {} } };
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify(workflow));
  mkdirSync(join(attempt.folder, "artifacts"));
  const addArtifact = (id, content, accepted = true, type = "implementation_evidence", supersedes = []) => {
    const path = `artifacts/${id}.md`;
    writeFileSync(join(attempt.folder, path), content);
    recordAttemptArtifact(slug, attempt.id, { id, type, path, supersedes });
    if (accepted) acceptAttemptArtifact(slug, attempt.id, id);
    return { artifact_id: id, sha256: digest(content) };
  };
  const plan = addArtifact("plan-v1", "# Plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n"
    + Array.from({ length: count }, (_, i) => `| R${i + 1} | Requirement prose ${i + 1} |`).join("\n") + "\n", true, "plan");
  const proof = addArtifact("proof-v1", "First proof\n");
  const update = (changes = {}) => ({ schema_version: 1, attempt_id: attempt.id, governing_plan: plan,
    expected_revision: getAttempt(slug, attempt.id).requirement_mapping?.revision || 0,
    requirements: Array.from({ length: mapped }, (_, i) => ({ requirement_id: `R${i + 1}`, decision_ref: plan,
      work_state: "complete", proof_refs: [proof] })), ...changes });
  const progress = (requirementUpdate, extra = {}) => recordProgress(slug, { attemptId: attempt.id, phase: "build",
    message: "Current result", next: "Review current work", requirementUpdate, ...extra });
  return { slug, root, home, attempt, workflow, plan, proof, addArtifact, update, progress };
}

function snapshot(root) {
  const files = [];
  const visit = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push([relative(root, path), digest(readFileSync(path))]);
    }
  };
  visit(root);
  return files;
}

test("summary pages every requirement with validated evidence and preserves all store bytes", t => {
  const f = fixture(t); f.progress(f.update());
  const before = snapshot(f.home);
  const first = attemptSummary(f.slug, f.attempt.id);
  assert.deepEqual(first.attempt, { id: f.attempt.id, lifecycle_state: "in_progress", current_phase: "build" });
  assert.deepEqual(first.governing_plan, f.plan);
  assert.equal(first.mapping.revision, 1);
  assert.equal(first.evidence_completeness, "verified");
  assert.equal(first.requirements.items.length, 5);
  assert.equal(first.requirements.total, 7);
  assert.equal(first.requirements.omitted, 2);
  const second = attemptSummary(f.slug, f.attempt.id, { requirementsCursor: first.requirements.next_cursor });
  assert.equal(second.requirements.offset, 5);
  assert.equal(second.requirements.omitted, 5);
  assert.equal(second.requirements.next_cursor, null);
  assert.deepEqual([...first.requirements.items, ...second.requirements.items].map(x => x.source.requirement_id),
    Array.from({ length: 7 }, (_, i) => `R${i + 1}`));
  for (const row of first.requirements.items) {
    assert.equal(row.verification, "verified");
    assert.deepEqual(row.proof_refs, [f.proof]);
    assert.equal("requirement_prose" in row, false);
  }
  for (const key of ["project_brain", "project_handoff", "attempt_handoff", "completedSteps", "updated_at"]) assert.equal(key in first, false);
  assert.equal(first.next_action, "Review current work");
  assert.deepEqual(snapshot(f.home), before);
});

test("100 unrelated checkpoints do not grow or change the compact current payload or its cursor", t => {
  const f = fixture(t); f.progress(f.update());
  const first = attemptSummary(f.slug, f.attempt.id);
  for (let i = 0; i < 100; i++) f.progress(undefined, { message: `Unrelated historical checkpoint ${i} ${"history ".repeat(20)}` });
  const before = snapshot(f.home);
  const second = attemptSummary(f.slug, f.attempt.id);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second).length, JSON.stringify(first).length);
  assert.equal(attemptSummary(f.slug, f.attempt.id, { requirementsCursor: first.requirements.next_cursor }).requirements.items.length, 2);
  assert.deepEqual(snapshot(f.home), before);
});

test("unmapped plan requirements remain reachable, planned, and unverified", t => {
  const f = fixture(t, { count: 7, mapped: 1 }); f.progress(f.update());
  const first = attemptSummary(f.slug, f.attempt.id);
  assert.equal(first.requirements.total, 7);
  assert.equal(first.requirements.items[0].verification, "verified");
  assert.equal(first.requirements.items[1].work_state, "planned");
  assert.equal(first.requirements.items[1].verification, "unverified");
  assert.equal(first.unresolved_work.total, 6);
  const last = attemptSummary(f.slug, f.attempt.id, { unresolvedWorkCursor: first.unresolved_work.next_cursor });
  assert.equal(last.unresolved_work.items[0].requirement_id, "R7");
  assert.equal(last.evidence_completeness, "unverified");
});

test("legacy long handoffs return mapping_missing without inferring decisions or changing bytes", t => {
  const f = fixture(t);
  f.progress(undefined);
  const path = join(f.attempt.folder, "HANDOFF.md");
  writeFileSync(path, readFileSync(path, "utf8") + "\n## Old accepted decisions\n" + "R1 accepted and verified\n".repeat(10000));
  const before = snapshot(f.home);
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.equal(summary.mapping.status, "mapping_missing");
  assert.equal(summary.requirements.total, 0);
  assert.equal(summary.evidence_completeness, "unverified");
  assert.ok(summary.warnings.some(w => w.code === "mapping_missing"));
  assert.equal(summary.history_ref.path, "HANDOFF.md");
  assert.ok(JSON.stringify(summary).length < 2500);
  assert.deepEqual(snapshot(f.home), before);
});

test("cursor rejects changed revisions, other attempts, other collections and invalid page boundaries", t => {
  const f = fixture(t); f.progress(f.update());
  const cursor = attemptSummary(f.slug, f.attempt.id).requirements.next_cursor;
  const token = decode(cursor);
  for (const changes of [{ attempt_id: "other-attempt" }, { collection: "unresolved_work" }, { offset: 6 }, { offset: 10 }, { limit: 10 }, { source_sha256: undefined }]) {
    assert.throws(() => attemptSummary(f.slug, f.attempt.id, { requirementsCursor: encode({ ...token, ...changes }) }), /cursor/);
  }
  f.progress(f.update());
  const before = snapshot(f.home);
  assert.throws(() => attemptSummary(f.slug, f.attempt.id, { requirementsCursor: cursor }), /stale/);
  assert.deepEqual(snapshot(f.home), before);
});

test("changed proof off the requested page invalidates evidence and the continuation source", t => {
  const f = fixture(t); f.progress(f.update());
  const lastProof = f.addArtifact("last-proof", "Last proof\n");
  const update = f.update(); update.requirements = [{ ...update.requirements[6], proof_refs: [lastProof] }];
  f.progress(update);
  const first = attemptSummary(f.slug, f.attempt.id);
  writeFileSync(join(f.attempt.folder, "artifacts/last-proof.md"), "Changed\n");
  const before = snapshot(f.home);
  const changed = attemptSummary(f.slug, f.attempt.id);
  assert.equal(changed.evidence_completeness, "unverified");
  assert.ok(changed.requirements.items.every(x => x.verification === "verified"));
  assert.ok(changed.warnings.some(x => x.code === "evidence_unavailable"));
  assert.throws(() => attemptSummary(f.slug, f.attempt.id, { requirementsCursor: first.requirements.next_cursor }), /source_sha256 is stale/);
  const last = attemptSummary(f.slug, f.attempt.id, { requirementsCursor: changed.requirements.next_cursor });
  assert.equal(last.requirements.items[1].verification, "unverified");
  assert.ok(last.warnings.some(x => x.code === "artifact_changed" && x.requirement_id === "R7"));
  assert.deepEqual(snapshot(f.home), before);
});

test("missing or unaccepted proof and changed accepted plans never produce verification", t => {
  const f = fixture(t); f.progress(f.update());
  const proof = f.addArtifact("candidate", "Unaccepted\n", false);
  const update = f.update(); update.requirements[0].proof_refs = [proof]; update.requirements[1].proof_refs = [];
  f.progress(update);
  const first = attemptSummary(f.slug, f.attempt.id);
  assert.equal(first.requirements.items[0].verification, "unverified");
  assert.equal(first.requirements.items[1].verification, "unverified");
  assert.equal(first.evidence_completeness, "unverified");
  rmSync(join(f.attempt.folder, "artifacts/proof-v1.md"));
  assert.ok(attemptSummary(f.slug, f.attempt.id).requirements.items.every(x => x.verification === "unverified"));
  writeFileSync(join(f.attempt.folder, "artifacts/plan-v1.md"), "Changed plan\n");
  const before = snapshot(f.home);
  const changed = attemptSummary(f.slug, f.attempt.id);
  assert.equal(changed.governing_plan, null);
  assert.ok(changed.warnings.some(w => w.code === "artifact_changed"));
  assert.deepEqual(snapshot(f.home), before);
});

test("lifecycle phase wins over legacy prose and unresolved decision gates stay visible", t => {
  const f = fixture(t); f.progress(f.update());
  f.workflow.workflow.gates.approve = { kind: "decision" };
  writeFileSync(join(f.attempt.folder, "workflow.json"), JSON.stringify(f.workflow));
  const path = join(f.attempt.folder, "HANDOFF.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("## Current phase\n\nbuild", "## Current phase\n\nfinish"));
  const before = snapshot(f.home);
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.equal(summary.attempt.current_phase, "build");
  assert.equal(summary.evidence_completeness, "verified");
  assert.ok(summary.warnings.some(w => w.code === "phase_mismatch"));
  assert.ok(summary.unresolved_work.items.some(w => w.kind === "decision" && w.phase === "approve"));
  assert.deepEqual(snapshot(f.home), before);
});

test("related-checkpoint warning remains independent from evidence completeness and suppresses stale next action", t => {
  const f = fixture(t, { git: true });
  const revision = execFileSync("git", ["-C", f.root, "rev-parse", "HEAD"]).toString().trim();
  assert.equal(f.progress(f.update(), { workItem: "ticket:shared", reviewRevision: revision }).recorded, true);
  const other = createAttemptInStore(f.slug, "related");
  writeFileSync(join(other.folder, "workflow.json"), JSON.stringify(f.workflow));
  writeFileSync(join(other.folder, "HANDOFF.md"), `# DIRF Handoff\n\n## Attempt ID\n\n${other.id}\n\n## Work item\n\nticket:shared\n`);
  assert.equal(recordProgress(f.slug, { attemptId: other.id, phase: "build", workItem: "ticket:shared", reviewRevision: revision, message: "Related result", next: "Read related work" }).recorded, true);
  const before = snapshot(f.home);
  const legacy = attemptContextState(f.slug, f.attempt.id, { bounded: true });
  assert.equal(legacy.needs_refresh, true);
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.ok(summary.warnings.some(w => w.code === "related_checkpoint"));
  assert.equal(summary.evidence_completeness, "verified");
  assert.equal(summary.next_action, null);
  assert.deepEqual(snapshot(f.home), before);
});

test("blocked attempts page without claims across two worktrees and invalidate changed unresolved cursors", t => {
  const f = fixture(t, { git: true }); f.progress(f.update());
  claimAttemptCheckout(f.slug, f.attempt.id, f.root);
  const secondTree = join(scratch, `worktree-${f.attempt.id}`);
  execFileSync("git", ["-C", f.root, "worktree", "add", "--quiet", "--detach", resolve(secondTree)]);
  for (let i = 0; i < 7; i++) {
    const other = createAttemptInStore(f.slug, `blocked-${i}`);
    writeFileSync(join(other.folder, "workflow.json"), JSON.stringify(f.workflow));
    updateAttemptLifecycle(f.slug, other.id, "start");
    updateAttemptLifecycle(f.slug, other.id, "block", { reason: `Blocker ${i}` });
  }
  const owners = [attemptResponsibility(f.slug, f.root), attemptResponsibility(f.slug, resolve(secondTree))];
  const before = snapshot(f.home);
  const first = attemptSummary(f.slug, f.attempt.id);
  assert.equal(first.unresolved_work.total, 7);
  assert.equal(first.unresolved_work.items.length, 5);
  const second = attemptSummary(f.slug, f.attempt.id, { unresolvedWorkCursor: first.unresolved_work.next_cursor });
  assert.equal(second.unresolved_work.items.length, 2);
  assert.equal(new Set([...first.unresolved_work.items, ...second.unresolved_work.items].map(x => x.attempt_id)).size, 7);
  assert.deepEqual([attemptResponsibility(f.slug, f.root), attemptResponsibility(f.slug, resolve(secondTree))], owners);
  assert.deepEqual(snapshot(f.home), before);
  const blocked = getAttempt(f.slug, first.unresolved_work.items[0].attempt_id);
  updateAttemptLifecycle(f.slug, blocked.id, "reopen");
  assert.throws(() => attemptSummary(f.slug, f.attempt.id, { unresolvedWorkCursor: first.unresolved_work.next_cursor }), /source_sha256 is stale/);
});

test("read-only summaries reject pending recovery and ownership conflicts remain untouched", t => {
  const f = fixture(t); f.progress(f.update());
  const metadata = join(f.attempt.folder, "attempt.json");
  const current = JSON.parse(readFileSync(metadata, "utf8"));
  current.responsibility_path = f.root;
  writeFileSync(metadata, JSON.stringify(current));
  const other = createAttemptInStore(f.slug, "conflicting");
  const copy = { ...current, id: other.id, name: other.name, relativePath: other.relativePath };
  delete copy.requirement_mapping; delete copy.artifacts;
  writeFileSync(join(other.folder, "attempt.json"), JSON.stringify(copy));
  const owners = attemptResponsibility(f.slug, f.root);
  assert.equal(owners.state, "conflict");
  assert.equal(owners.attempts.length, 2);
  const before = snapshot(f.home);
  attemptSummary(f.slug, f.attempt.id);
  assert.deepEqual(attemptResponsibility(f.slug, f.root), owners);
  assert.deepEqual(snapshot(f.home), before);
  const journal = join(storeProjectDir(f.slug), ".pending-progress.json");
  writeFileSync(journal, JSON.stringify({ schema_version: 1, update: { message: "Never replay this in a summary" } }));
  const pending = snapshot(f.home);
  assert.throws(() => attemptSummary(f.slug, f.attempt.id), /progress write is pending/);
  assert.deepEqual(snapshot(f.home), pending);
});

test("summary identity is explicit and ambiguous names never select the newest attempt", t => {
  const f = fixture(t); f.progress(f.update());
  const other = createAttemptInStore(f.slug, "summary");
  assert.throws(() => attemptSummary(f.slug), /explicit attempt identity/);
  assert.throws(() => attemptSummary(f.slug, "summary"), /ambiguous/);
  assert.equal(attemptSummary(f.slug, other.id).mapping.status, "mapping_missing");
});

test("a newly accepted governing plan exposes its own requirements without inheriting the older mapping", t => {
  const f = fixture(t, { mapped: 1 }); f.progress(f.update());
  const first = attemptSummary(f.slug, f.attempt.id);
  const revised = f.addArtifact("plan-v2", "# New plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n"
    + Array.from({ length: 8 }, (_, i) => `| NEW${i + 1} | New meaning |`).join("\n") + "\n", true, "plan", ["plan-v1"]);
  const before = snapshot(f.home);
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.deepEqual(summary.governing_plan, revised);
  assert.equal(summary.requirements.total, 8);
  assert.ok(summary.requirements.items.every(x => x.source.plan.artifact_id === "plan-v2" && x.work_state === "planned" && x.verification === "unverified"));
  assert.equal(summary.unresolved_work.total, 8);
  assert.throws(() => attemptSummary(f.slug, f.attempt.id, { unresolvedWorkCursor: first.unresolved_work.next_cursor }), /stale/);
  const next = attemptSummary(f.slug, f.attempt.id, { requirementsCursor: summary.requirements.next_cursor });
  assert.deepEqual(next.requirements.items.map(x => x.source.requirement_id), ["NEW6", "NEW7", "NEW8"]);
  assert.deepEqual(snapshot(f.home), before);
});

test("recorded unaccepted plans are visible as unresolved decisions without granting acceptance", t => {
  const f = fixture(t); f.progress(undefined);
  const candidate = f.addArtifact("plan-candidate", "# Unaccepted proposal\n", false, "plan");
  const before = snapshot(f.home);
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.deepEqual(summary.governing_plan, f.plan);
  assert.ok(summary.unresolved_work.items.some(x => x.summary.includes(candidate.artifact_id) && x.summary.includes("unaccepted") && x.detail_ref.path === "artifacts/plan-candidate.md"));
  assert.deepEqual(snapshot(f.home), before);
});

test("invalid lifecycle phases never fall back to legacy prose or advance state", t => {
  const f = fixture(t); f.progress(f.update());
  const path = join(f.attempt.folder, "attempt.json");
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  metadata.current_phase = "undeclared";
  writeFileSync(path, JSON.stringify(metadata));
  const before = snapshot(f.home);
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.equal(summary.attempt.current_phase, null);
  assert.ok(summary.warnings.some(w => w.code === "phase_mismatch"));
  assert.deepEqual(snapshot(f.home), before);
  metadata.status = "invented";
  writeFileSync(path, JSON.stringify(metadata));
  assert.throws(() => attemptSummary(f.slug, f.attempt.id), /Invalid stored attempt lifecycle state/);
});

test("invalid plan bytes degrade verification while preserving blocked work and its references", t => {
  const f = fixture(t); const update = f.update(); update.requirements[0].work_state = "blocked";
  f.progress(update);
  rmSync(join(f.attempt.folder, "artifacts/plan-v1.md"));
  const before = snapshot(f.home);
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.equal(summary.requirements.items[0].work_state, "blocked");
  assert.equal(summary.requirements.items[0].verification, "unverified");
  assert.deepEqual(summary.requirements.items[0].decision_ref, f.plan);
  assert.ok(summary.unresolved_work.items.some(x => x.kind === "blocker" && x.requirement_id === "R1"));
  assert.deepEqual(snapshot(f.home), before);
});

test("accepted replacement plans resolve superseded unaccepted proposals without hiding independent candidates", t => {
  const f = fixture(t); f.progress(undefined);
  f.addArtifact("proposal-old", "# Old proposal\n", false, "plan");
  f.addArtifact("proposal-middle", "# Middle proposal\n", false, "plan", ["proposal-old"]);
  f.addArtifact("independent", "# Separate proposal\n", false, "plan");
  f.addArtifact("replacement", "# Accepted replacement\n", true, "plan", ["plan-v1", "proposal-middle"]);
  const before = snapshot(f.home);
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.deepEqual(summary.unresolved_work.items.map(x => x.detail_ref.path), ["artifacts/independent.md"]);
  assert.deepEqual(snapshot(f.home), before);
});
