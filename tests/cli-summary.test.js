import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  registerProject, createAttemptInStore, recordAttemptArtifact, acceptAttemptArtifact,
  recordProgress, getAttempt, attemptSummary, attemptResponsibility, storeProjectDir,
} from "../src/state.js";

const CLI = resolve("src/cli.js");
const scratch = resolve(".scratch/ne005-cli");
mkdirSync(scratch, { recursive: true });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(t, { mapped = true } = {}) {
  const oldHome = process.env.DIRF_HOME;
  const home = mkdtempSync(join(scratch, "home-"));
  process.env.DIRF_HOME = home;
  t.after(() => { if (oldHome === undefined) delete process.env.DIRF_HOME; else process.env.DIRF_HOME = oldHome; });
  const root = mkdtempSync(join(scratch, "repo-"));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "cli-summary");
  const workflow = { schema_version: 1, workflow: { phases: ["build", "verify"] } };
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify(workflow));
  writeFileSync(join(attempt.folder, "HANDOFF.md"), `# DIRF Handoff\n\n## Attempt ID\n\n${attempt.id}\n\n## Current phase\n\nbuild\n\n## Exact next action\n\nRead current evidence\n`);
  mkdirSync(join(attempt.folder, "artifacts"));
  const addArtifact = (id, text, accepted = true, type = "implementation_evidence") => {
    const path = `artifacts/${id}.md`;
    writeFileSync(join(attempt.folder, path), text);
    recordAttemptArtifact(slug, attempt.id, { id, type, path });
    if (accepted) acceptAttemptArtifact(slug, attempt.id, id);
    return { artifact_id: id, sha256: digest(text) };
  };
  const plan = addArtifact("plan", "# Plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n"
    + Array.from({ length: 7 }, (_, i) => `| R${i + 1} | Meaning ${i + 1} |`).join("\n") + "\n", true, "plan");
  const proof = addArtifact("proof", "Accepted proof\n");
  const update = (changes = {}) => ({ schema_version: 1, attempt_id: attempt.id, governing_plan: plan,
    expected_revision: getAttempt(slug, attempt.id).requirement_mapping?.revision || 0,
    requirements: Array.from({ length: 7 }, (_, i) => ({ requirement_id: `R${i + 1}`, decision_ref: plan,
      work_state: "complete", proof_refs: [proof] })), ...changes });
  if (mapped) recordProgress(slug, { attemptId: attempt.id, phase: "build", message: "Initial mapping", next: "Read current evidence", requirementUpdate: update() });
  const run = (args, cwd = root) => spawnSync(process.execPath, [CLI, ...args], {
    cwd, env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: 30000, windowsHide: true,
  });
  const json = args => {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const file = (value, name = "update.json") => {
    const path = join(root, name); writeFileSync(path, JSON.stringify(value)); return path;
  };
  return { root, home, slug, attempt, workflow, plan, proof, update, addArtifact, run, json, file };
}

test("mapping progress preserves the newer-local-handoff conflict while summary reads stay available", t => {
  const f = fixture(t);
  const update = f.file(f.update());
  mkdirSync(join(f.root, ".dirf"));
  const local = join(f.root, ".dirf/HANDOFF.md");
  writeFileSync(local, "Newer local handoff\n");
  const newer = new Date(statSync(join(storeProjectDir(f.slug), "HANDOFF.md")).mtimeMs + 60000);
  utimesSync(local, newer, newer);
  const before = snapshot(f.home);
  const localBefore = snapshot(join(f.root, ".dirf"));
  assert.equal(f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]).attempt.id, f.attempt.id);
  const plain = f.run(["record-progress", "Must preserve conflict", "--attempt", f.attempt.id]);
  assert.notEqual(plain.status, 0);
  assert.match(plain.stderr, /newer|conflict/i);
  const mapped = f.run(["record-progress", "Must preserve conflict", "--attempt", f.attempt.id, "--requirement-update-file", update]);
  assert.notEqual(mapped.status, 0);
  assert.match(mapped.stderr, /newer|conflict/i);
  assert.deepEqual(snapshot(f.home), before);
  assert.deepEqual(snapshot(join(f.root, ".dirf")), localBefore);
});

test("summary resume preserves the newer-local-handoff conflict before claiming ownership", t => {
  const f = fixture(t);
  mkdirSync(join(f.root, ".dirf"));
  const local = join(f.root, ".dirf/HANDOFF.md");
  writeFileSync(local, "Newer local handoff\n");
  const newer = new Date(statSync(join(storeProjectDir(f.slug), "HANDOFF.md")).mtimeMs + 60000);
  utimesSync(local, newer, newer);
  const before = snapshot(f.home);
  const localBefore = snapshot(join(f.root, ".dirf"));
  const result = f.run(["resume", f.attempt.id, "--summary", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /newer|conflict/i);
  assert.deepEqual(snapshot(f.home), before);
  assert.deepEqual(snapshot(join(f.root, ".dirf")), localBefore);
});

function snapshot(root) {
  const result = [];
  const visit = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else result.push([relative(root, path), digest(readFileSync(path))]);
    }
  };
  visit(root);
  return result;
}

test("state summary JSON equals the shared query and preserves registry, ownership and store bytes", t => {
  const f = fixture(t);
  const before = snapshot(f.home);
  const output = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  assert.deepEqual(output, attemptSummary(f.slug, f.attempt.id));
  assert.equal(output.requirements.items.length, 5);
  assert.equal(output.requirements.total, 7);
  assert.equal(output.evidence_completeness, "verified");
  assert.equal(attemptResponsibility(f.slug, f.root).state, "idle");
  assert.deepEqual(snapshot(f.home), before);
  assert.deepEqual(f.json(["state", "summary", "--slug", f.slug, "--attempt", f.attempt.id, "--json"]), output);
  assert.deepEqual(snapshot(f.home), before);
});

test("state summary cursor options expose both collections without silently truncating rows", t => {
  const f = fixture(t);
  const update = f.update();
  for (const entry of update.requirements) { entry.decision_ref = null; entry.work_state = "blocked"; }
  const file = f.file(update);
  assert.equal(f.run(["record-progress", "Blocked current work", "--attempt", f.attempt.id, "--requirement-update-file", file]).status, 0);
  const first = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  assert.equal(first.unresolved_work.total, 14);
  const before = snapshot(f.home);
  const second = f.json(["state", "summary", "--attempt", f.attempt.id, "--requirements-cursor", first.requirements.next_cursor,
    "--unresolved-work-cursor", first.unresolved_work.next_cursor, "--json"]);
  assert.deepEqual(second.requirements.items.map(x => x.source.requirement_id), ["R6", "R7"]);
  assert.equal(second.unresolved_work.offset, 5);
  const final = f.json(["state", "summary", "--attempt", f.attempt.id, "--unresolved-work-cursor", second.unresolved_work.next_cursor, "--json"]);
  assert.equal(final.unresolved_work.items.length, 4);
  assert.equal(final.unresolved_work.next_cursor, null);
  assert.deepEqual(snapshot(f.home), before);
});

test("resume summary claims its explicit planned attempt and emits the shared compact contract", t => {
  const f = fixture(t, { mapped: false });
  const other = createAttemptInStore(f.slug, "other-planned");
  const output = f.json(["resume", f.attempt.id, "--summary", "--json"]);
  assert.equal(output.attempt.id, f.attempt.id);
  assert.equal(output.attempt.lifecycle_state, "in_progress");
  assert.equal(output.mapping.status, "mapping_missing");
  assert.equal(attemptResponsibility(f.slug, f.root).attempt.id, f.attempt.id);
  assert.equal(getAttempt(f.slug, other.id).status, "planned");
  assert.deepEqual(output, attemptSummary(f.slug, f.attempt.id));
  for (const field of ["project_handoff", "attempt_handoff", "project_brain", "resume_prompt"]) assert.equal(field in output, false);
});

test("compact and legacy resume JSON stay separate and ordinary text points to the compact option", t => {
  const f = fixture(t);
  const compact = f.json(["resume", f.attempt.id, "--summary", "--json"]);
  const legacy = f.json(["resume", f.attempt.id, "--json"]);
  for (const key of ["project_handoff", "attempt_handoff", "project_brain", "pending_gates", "recorded_evidence", "resume_prompt", "auto_started"]) assert.ok(key in legacy, key);
  assert.equal("project_brain" in compact, false);
  const text = f.run(["resume", f.attempt.id]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /--summary --json/);
  assert.ok(text.stdout.indexOf("--summary --json") < text.stdout.indexOf("Load attempt handoff:"));
  assert.ok(text.stdout.trim().split(/\r?\n/).length <= 10);
  const summaryText = f.run(["state", "summary", "--attempt", f.attempt.id]);
  assert.equal(summaryText.status, 0, summaryText.stderr);
  assert.match(summaryText.stdout, /7 total, 2 omitted/);
  assert.match(summaryText.stdout, /--requirements-cursor/);
});

test("ambiguous, missing and unknown summary identities reject before resume can claim or register", t => {
  const f = fixture(t);
  createAttemptInStore(f.slug, "cli-summary");
  const before = snapshot(f.home);
  for (const args of [["state", "summary", "--json"], ["state", "summary", "--attempt", "cli-summary", "--json"],
    ["resume", "cli-summary", "--summary", "--json"], ["resume", "--summary", "--json"],
    ["resume", "unknown-id", "--summary", "--json"]]) {
    const result = f.run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires|ambiguous|No DIRF attempt/);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("stale and malformed cursors reject before the summary resume claim changes anything", t => {
  const f = fixture(t);
  const cursor = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]).requirements.next_cursor;
  recordProgress(f.slug, { attemptId: f.attempt.id, phase: "build", message: "New revision", next: "Read current evidence", requirementUpdate: f.update() });
  const before = snapshot(f.home);
  for (const args of [["state", "summary", "--attempt", f.attempt.id, "--requirements-cursor", cursor, "--json"],
    ["resume", f.attempt.id, "--summary", "--requirements-cursor", cursor, "--json"],
    ["resume", f.attempt.id, "--summary", "--unresolved-work-cursor", "invalid", "--json"],
    ["resume", f.attempt.id, "--requirements-cursor", cursor, "--json"],
    ["resume", f.attempt.id, "--summary", "--full", "--json"]]) {
    assert.notEqual(f.run(args).status, 0);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("a legacy long handoff returns mapping_missing without copying or rewriting historical prose", t => {
  const f = fixture(t, { mapped: false });
  const handoff = join(f.attempt.folder, "HANDOFF.md");
  writeFileSync(handoff, readFileSync(handoff, "utf8") + "\n## Completed\n" + "- Historical R1 accepted and verified\n".repeat(1000));
  const before = snapshot(f.home);
  const output = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  assert.equal(output.mapping.status, "mapping_missing");
  assert.equal(output.evidence_completeness, "unverified");
  assert.ok(JSON.stringify(output).length < 2500);
  assert.doesNotMatch(JSON.stringify(output), /Historical R1/);
  assert.deepEqual(snapshot(f.home), before);
});

test("explicit requirement file updates persist through CLI restart and leave acceptance records intact", t => {
  const f = fixture(t, { mapped: false });
  const originalArtifacts = getAttempt(f.slug, f.attempt.id).artifacts;
  const file = f.file(f.update(), "mapping update.json");
  const result = f.run(["record-progress", "Record explicit requirements", "--attempt", f.attempt.id, "--phase", "build", "--next", "Read current evidence", "--requirement-update-file", file]);
  assert.equal(result.status, 0, result.stderr);
  const output = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  assert.equal(output.mapping.revision, 1);
  assert.equal(output.evidence_completeness, "verified");
  assert.deepEqual(getAttempt(f.slug, f.attempt.id).artifacts, originalArtifacts);
  const proof2 = f.addArtifact("new-proof", "New proof\n");
  const update = f.update(); update.requirements = [{ ...update.requirements[0], proof_refs: [proof2] }];
  const nextFile = f.file(update);
  assert.equal(f.run(["record-progress", "Replace proof", "--attempt", f.attempt.id, "--requirement-update-file", nextFile]).status, 0);
  const next = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  assert.equal(next.mapping.revision, 2);
  assert.deepEqual(next.requirements.items[0].proof_refs, [proof2]);
  const history = JSON.parse(readFileSync(join(f.attempt.folder, "requirement-history/1.json"), "utf8"));
  assert.deepEqual(history.mapping.requirements[0].proof_refs, [f.proof]);
});

test("invalid requirement files leave mapping, handoffs, lifecycle, counters and registry unchanged", t => {
  const f = fixture(t);
  const cases = [null, [], { ...f.update(), expected_revision: 0 }, { ...f.update(), attempt_id: "another-attempt" }];
  const unknown = f.update(); unknown.requirements[0].requirement_id = "R99"; cases.push(unknown);
  const acceptance = f.update(); acceptance.requirements[0].accepted = true; cases.push(acceptance);
  const changedProof = f.update(); changedProof.requirements[0].proof_refs = [{ ...f.proof, sha256: "f".repeat(64) }]; cases.push(changedProof);
  for (const value of cases) {
    const file = f.file(value);
    const before = snapshot(f.home);
    const result = f.run(["record-progress", "Invalid update", "--attempt", f.attempt.id, "--requirement-update-file", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Failed to record progress/);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("update files require explicit identity and readable JSON, including missing option-value checks", t => {
  const f = fixture(t);
  const valid = f.file(f.update());
  const broken = join(f.root, "broken.json"); writeFileSync(broken, "not JSON");
  const before = snapshot(f.home);
  for (const args of [["record-progress", "No identity", "--requirement-update-file", valid],
    ["record-progress", "Broken JSON", "--attempt", f.attempt.id, "--requirement-update-file", broken],
    ["record-progress", "Missing file", "--attempt", f.attempt.id, "--requirement-update-file", "absent.json"],
    ["record-progress", "Missing value", "--attempt", f.attempt.id, "--requirement-update-file"],
    ["state", "summary", "--attempt", f.attempt.id, "--requirements-cursor", "--json"],
    ["state", "summary", "--attempt", f.attempt.id, "--unresolved-work-cursor"]]) {
    assert.notEqual(f.run(args).status, 0);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("plain progress prose cannot create a mapping or acceptance through the CLI", t => {
  const f = fixture(t, { mapped: false });
  assert.equal(f.run(["record-progress", "R1 accepted and verified", "--attempt", f.attempt.id]).status, 0);
  const output = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  assert.equal(output.mapping.status, "mapping_missing");
  assert.equal(output.evidence_completeness, "unverified");
});

test("summary reads refuse pending progress and do not migrate unregistered legacy state", t => {
  const f = fixture(t);
  const explicitUpdate = f.update();
  const journal = join(storeProjectDir(f.slug), ".pending-progress.json");
  writeFileSync(journal, "Pending recovery sentinel\n");
  const before = snapshot(f.home);
  const result = f.run(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /progress write is pending/);
  assert.deepEqual(snapshot(f.home), before);
  const other = mkdtempSync(join(scratch, "legacy-"));
  execFileSync("git", ["init", "--quiet", other]);
  mkdirSync(join(other, ".dirf"));
  writeFileSync(join(other, ".dirf", "HANDOFF.md"), "Legacy sentinel\n");
  writeFileSync(join(other, ".dirf", "config.json"), "{}\n");
  const legacyBefore = snapshot(other);
  const unknown = f.run(["state", "summary", "--attempt", f.attempt.id, "--json"], other);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown DIRF project/);
  assert.deepEqual(snapshot(other), legacyBefore);
  assert.deepEqual(snapshot(f.home), before);
  for (const value of [null, explicitUpdate]) {
    const file = f.file(value);
    const rejected = f.run(["record-progress", "Must not migrate", "--attempt", f.attempt.id, "--requirement-update-file", file], other);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Unknown DIRF project/);
    assert.deepEqual(snapshot(other), legacyBefore);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("help documents compact commands, both cursor options and the explicit update file", t => {
  const f = fixture(t);
  const help = f.run(["--help"]);
  assert.equal(help.status, 0);
  for (const option of ["state summary", "--summary", "--requirements-cursor", "--unresolved-work-cursor", "--requirement-update-file"]) assert.ok(help.stdout.includes(option));
});

test("a valid pre-start cursor cannot fail after resume has claimed and started the attempt", t => {
  const f = fixture(t, { mapped: false });
  for (let i = 0; i < 6; i++) f.addArtifact(`candidate-${i}`, "# Proposed plan\n", false, "plan");
  const first = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  assert.ok(first.unresolved_work.next_cursor);
  const before = snapshot(f.home);
  const result = f.run(["resume", f.attempt.id, "--summary", "--json", "--unresolved-work-cursor", first.unresolved_work.next_cursor]);
  assert.notEqual(result.status, 0);
  assert.deepEqual(snapshot(f.home), before);
  assert.match(result.stderr, /state summary/);
});

test("new options reject undocumented command combinations before any write or claim", t => {
  const f = fixture(t);
  const file = f.file(f.update());
  const before = snapshot(f.home);
  for (const args of [["resume", f.attempt.id, "--requirement-update-file", file],
    ["record-progress", "Not a summary", "--summary"], ["status", "--requirements-cursor", "token"],
    ["state", "active", "--unresolved-work-cursor", "token"]]) {
    assert.notEqual(f.run(args).status, 0);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("active resume pagination works and another worktree can read without taking responsibility", t => {
  const f = fixture(t);
  const first = f.json(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  const page = f.json(["resume", f.attempt.id, "--summary", "--json", "--requirements-cursor", first.requirements.next_cursor]);
  assert.deepEqual(page.requirements.items.map(x => x.source.requirement_id), ["R6", "R7"]);
  const other = resolve(scratch, `worktree-${f.attempt.id}`);
  execFileSync("git", ["-C", f.root, "worktree", "add", "--quiet", "--detach", other]);
  const before = snapshot(f.home);
  const read = f.run(["state", "summary", "--attempt", f.attempt.id, "--json"], other);
  assert.equal(read.status, 0, read.stderr);
  assert.deepEqual(JSON.parse(read.stdout), attemptSummary(f.slug, f.attempt.id));
  const explicitPath = f.json(["state", "summary", "--path", other, "--attempt", f.attempt.id, "--json"]);
  assert.deepEqual(explicitPath, JSON.parse(read.stdout));
  assert.deepEqual(snapshot(f.home), before);
  const claim = f.run(["resume", f.attempt.id, "--summary", "--json"], other);
  assert.notEqual(claim.status, 0);
  assert.match(claim.stderr, /already responsible/);
  assert.deepEqual(snapshot(f.home), before);
});
