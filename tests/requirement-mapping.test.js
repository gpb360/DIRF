import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  registerProject, createAttemptInStore, recordAttemptArtifact, acceptAttemptArtifact,
  recordProgress, readRequirementMapping, getAttempt, storeProjectDir, attemptSummary,
} from "../src/state.js";
import { parseCurrentHandoff } from "../src/handoff-update.js";

const moduleUrl = pathToFileURL(resolve("src/state.js")).href;
const scratch = resolve(".scratch/ne003-mapping");
mkdirSync(scratch, { recursive: true });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(t, { acceptedPlan = true, planText = "# Plan\n\n## Requirements\n\n| ID | Requirement |\n| --- | --- |\n| R1 | Retain current evidence |\n| R2 | Keep acceptance explicit |\n" } = {}) {
  const oldHome = process.env.DIRF_HOME;
  const home = mkdtempSync(join(scratch, "home-"));
  process.env.DIRF_HOME = home;
  t.after(() => { if (oldHome === undefined) delete process.env.DIRF_HOME; else process.env.DIRF_HOME = oldHome; });
  const root = mkdtempSync(join(scratch, "repo-"));
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "mapping");
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["build", "verify", "post"] } }));
  mkdirSync(join(attempt.folder, "artifacts"));
  const addArtifact = (id, content, accepted = true, type = "implementation_evidence", supersedes = []) => {
    const path = `artifacts/${id}.md`;
    writeFileSync(join(attempt.folder, path), content);
    recordAttemptArtifact(slug, attempt.id, { id, type, path, supersedes });
    if (accepted) acceptAttemptArtifact(slug, attempt.id, id);
    return { artifact_id: id, sha256: digest(content) };
  };
  const plan = addArtifact("plan-v1", planText, acceptedPlan, "plan");
  const proof = addArtifact("proof-v1", "Verified first proof\n");
  const update = (overrides = {}) => ({ schema_version: 1, attempt_id: attempt.id, governing_plan: { ...plan },
    expected_revision: getAttempt(slug, attempt.id).requirement_mapping?.revision ?? 0,
    requirements: [{ requirement_id: "R1", decision_ref: { ...plan }, work_state: "complete", proof_refs: [{ ...proof }] }], ...overrides });
  const progress = (requirementUpdate, extra = {}) => recordProgress(slug, { attemptId: attempt.id, phase: "build",
    message: "Recorded requirement update", next: "Verify current proof", requirementUpdate, ...extra });
  return { root, home, slug, attempt, plan, proof, addArtifact, update, progress };
}

function snapshot(f) {
  const project = storeProjectDir(f.slug);
  const paths = [join(project, "HANDOFF.md"), join(project, ".progress-sequence"), join(project, ".pending-progress.json"),
    join(f.attempt.folder, "HANDOFF.md"), join(f.attempt.folder, "attempt.json")];
  const history = join(f.attempt.folder, "requirement-history");
  if (existsSync(history)) paths.push(...readdirSync(history).sort().map(name => join(history, name)));
  return paths.map(path => [path, existsSync(path) ? readFileSync(path, "utf8") : null]);
}

test("an explicit mapping persists through the core and derives verification from accepted bytes", t => {
  const f = fixture(t);
  const result = f.progress(f.update());
  assert.equal(result.recorded, true);
  assert.equal(result.attempt.requirement_mapping.revision, 1);
  const mapping = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(mapping.requirements[0].verification, "verified");
  assert.equal(getAttempt(f.slug, f.attempt.id).current_phase, "build");
  assert.equal("verification" in getAttempt(f.slug, f.attempt.id).requirement_mapping.requirements[0], false);
  const child = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    const { readRequirementMapping } = await import(${JSON.stringify(moduleUrl)});
    console.log(JSON.stringify(readRequirementMapping(${JSON.stringify(f.slug)}, ${JSON.stringify(f.attempt.id)})));
  `], { env: { ...process.env }, encoding: "utf8", timeout: 30000, windowsHide: true }));
  assert.deepEqual(child, mapping);
});

test("plain progress cannot establish mapping or acceptance and legacy reads are mutation-free", t => {
  const f = fixture(t);
  f.progress(undefined, { message: "R1 accepted and verified, all requirements complete" });
  const before = snapshot(f);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id), null);
  assert.equal("requirement_mapping" in getAttempt(f.slug, f.attempt.id), false);
  assert.deepEqual(snapshot(f), before);
});

test("missing or unaccepted proof stays unverified even when work is complete", t => {
  const f = fixture(t);
  const update = f.update(); update.requirements[0].proof_refs = [];
  f.progress(update);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "unverified");
  const candidate = f.addArtifact("candidate-proof", "Recorded only\n", false);
  const second = f.update(); second.requirements[0].proof_refs = [candidate];
  f.progress(second);
  const entry = readRequirementMapping(f.slug, f.attempt.id).requirements[0];
  assert.equal(entry.verification, "unverified");
  assert.match(entry.evidence_warnings.join("\n"), /SHA-bound acceptance/);
});

test("new proof supersedes current references while immutable history and acceptance survive 100 checkpoints", t => {
  const f = fixture(t);
  f.progress(f.update());
  const firstHistory = join(f.attempt.folder, "requirement-history/1.json");
  const firstBytes = readFileSync(firstHistory, "utf8");
  const secondProof = f.addArtifact("proof-v2", "Verified replacement proof\n", true, "implementation_evidence", ["proof-v1"]);
  const second = f.update(); second.requirements[0].proof_refs = [secondProof];
  f.progress(second);
  for (let index = 0; index < 100; index++) f.progress(undefined, { message: `Ordinary checkpoint ${index}` });
  const current = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(current.revision, 2);
  assert.deepEqual(current.requirements[0].proof_refs, [secondProof]);
  assert.equal(current.requirements[0].verification, "verified");
  assert.equal(readFileSync(firstHistory, "utf8"), firstBytes);
  assert.deepEqual(JSON.parse(firstBytes).mapping.requirements[0].proof_refs, [f.proof]);
  assert.equal(getAttempt(f.slug, f.attempt.id).artifacts.find(x => x.id === "proof-v1").accepted_sha256, f.proof.sha256);
});

test("partial updates retain unnamed entries and a new governing plan cannot inherit old requirement states", t => {
  const f = fixture(t);
  f.progress(f.update());
  const second = f.update(); second.requirements = [{ requirement_id: "R2", decision_ref: null, work_state: "blocked", proof_refs: [] }];
  second.governing_plan = { sha256: f.plan.sha256, artifact_id: f.plan.artifact_id };
  f.progress(second);
  assert.deepEqual(readRequirementMapping(f.slug, f.attempt.id).requirements.map(x => x.requirement_id), ["R1", "R2"]);
  const plan2 = f.addArtifact("plan-v2", "# Revised\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R3 | New meaning |\n", true, "plan", ["plan-v1"]);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "unverified");
  const third = f.update({ governing_plan: plan2, requirements: [{ requirement_id: "R3", decision_ref: plan2, work_state: "planned", proof_refs: [] }] });
  f.progress(third);
  assert.deepEqual(readRequirementMapping(f.slug, f.attempt.id).requirements.map(x => x.requirement_id), ["R3"]);
  assert.equal(existsSync(join(f.attempt.folder, "requirement-history/1.json")), true);
});

test("invalid updates leave mapping, handoffs, lifecycle, sequence and history byte-identical", t => {
  const f = fixture(t);
  f.progress(f.update());
  const unaccepted = f.addArtifact("unaccepted-decision", "Not accepted\n", false, "research");
  const changes = [u => u.requirements[0].requirement_id = "R99", u => u.governing_plan.artifact_id = "other-plan",
    u => u.governing_plan.sha256 = "f".repeat(64), u => u.attempt_id = "other-attempt", u => u.expected_revision = 0,
    u => u.requirements[0].work_state = "verified", u => u.requirements[0].proof_refs[0].sha256 = "f".repeat(64),
    u => u.requirements[0].proof_refs[0].artifact_id = "missing", u => u.requirements[0].decision_ref = unaccepted,
    u => u.requirements[0].proof_refs = [f.plan]];
  for (const change of changes) {
    const update = f.update(); change(update);
    const before = snapshot(f);
    assert.throws(() => f.progress(update), /Invalid requirement update|artifact|acceptance|implementation_evidence/);
    assert.deepEqual(snapshot(f), before);
  }
});

test("unaccepted plans and prose-only requirement mentions cannot establish source identity", t => {
  const f = fixture(t, { acceptedPlan: false });
  const before = snapshot(f);
  assert.throws(() => f.progress(f.update()), /governing accepted plan/);
  assert.deepEqual(snapshot(f), before);
  acceptAttemptArtifact(f.slug, f.attempt.id, "plan-v1");
  const prosePlan = f.addArtifact("plan-prose", "# Plan\nR99 is mentioned here.\n", true, "plan", ["plan-v1"]);
  const next = f.update({ governing_plan: prosePlan });
  const beforeProse = snapshot(f);
  assert.throws(() => f.progress(next), /explicit Requirements table/);
  assert.deepEqual(snapshot(f), beforeProse);
});

test("HTML comments cannot declare governing requirement identities", async t => {
  const visible = "## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible requirement |\n";
  const hidden = "## Requirements\n| ID | Requirement |\n| --- | --- |\n| HIDDEN | Commented example |\n";
  const cases = [
    ["commented section", visible + "\n<!--\n" + hidden + "-->\n"],
    ["comment before visible section", "<!--\n" + hidden + "-->\n\n" + visible],
    ["commented row", visible + "<!-- | HIDDEN | Commented row | -->\n"],
    ["unterminated comment", visible + "\n<!--\n" + hidden],
    ["unmatched literal delimiter", "An unmatched ` marker.\n\n" + visible + "\n<!--\n" + hidden + "-->\n"],
    ["literal delimiter inside comment", "<!-- An unmatched ` marker. -->\n\n" + visible],
  ];
  for (const [name, planText] of cases) await t.test(name, t => {
    const f = fixture(t, { planText });
    f.progress(f.update());
    const summary = attemptSummary(f.slug, f.attempt.id);
    assert.deepEqual(summary.requirements.items.map(entry => entry.source.requirement_id), ["R1"]);
    assert.equal(summary.requirements.items[0].verification, "verified");
    const invalid = f.update(); invalid.requirements[0].requirement_id = "HIDDEN";
    const before = snapshot(f);
    assert.throws(() => f.progress(invalid), /must exist in the governing plan/);
    assert.deepEqual(snapshot(f), before);
  });
});

test("literal comment markers in code examples do not hide later requirement declarations", t => {
  const f = fixture(t, { planText: "# Plan\n\n```markdown\n<!--\n```\n\n    <!--\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible requirement |\n" });
  f.progress(f.update());
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "verified");
});

test("inline code and escaped comment markers preserve every visible requirement", async t => {
  const rows = [
    ["one backtick", "Document the `<!--` opener."],
    ["matching delimiter runs", "Document ``the `<!--` marker``."],
    ["escaped opener", "Document the \\<!-- literal opener."],
  ];
  for (const [name, description] of rows) await t.test(name, t => {
    const f = fixture(t, { planText: "## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | " + description + " |\n| R2 | Remain visible |\n" });
    f.progress(f.update());
    const incomplete = attemptSummary(f.slug, f.attempt.id);
    assert.deepEqual(incomplete.requirements.items.map(entry => entry.source.requirement_id), ["R1", "R2"]);
    assert.equal(incomplete.evidence_completeness, "unverified");
    const update = f.update(); update.requirements[0].requirement_id = "R2";
    f.progress(update);
    assert.equal(attemptSummary(f.slug, f.attempt.id).evidence_completeness, "verified");
  });
  for (const prose of ["Use `<!--` as the comment opener.", "Use `<!--\ncontinued` as a literal opener.", "Use ``a `<!--`\ncontinued`` literal opener.", "Use `<!--\n2. continued` as a literal opener."]) await t.test(prose, t => {
    const f = fixture(t, { planText: prose + "\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible declaration |\n" });
    f.progress(f.update());
    assert.equal(attemptSummary(f.slug, f.attempt.id).evidence_completeness, "verified");
  });
});

test("masking cannot manufacture a governing heading or table prefix", async t => {
  const visible = "## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible requirement |\n";
  const hiddenRows = "| --- | --- |\n| HIDDEN | Not a source declaration |\n";
  const cases = [
    ["heading separator", "##<!-- note --> Requirements\n| ID | Requirement |\n" + hiddenRows],
    ["comment continuation", "## Requirements\n\n<!-- hidden\n-->| ID | Requirement |\n" + hiddenRows],
    ["code continuation", "## Requirements\n\nProse `literal\n`| ID | Requirement |\n" + hiddenRows],
  ];
  for (const [name, prefix] of cases) await t.test(name, t => {
    const f = fixture(t, { planText: prefix + "\n" + visible });
    f.progress(f.update());
    assert.deepEqual(attemptSummary(f.slug, f.attempt.id).requirements.items.map(entry => entry.source.requirement_id), ["R1"]);
    const invalid = f.update(); invalid.requirements[0].requirement_id = "HIDDEN";
    const before = snapshot(f);
    assert.throws(() => f.progress(invalid), /must exist in the governing plan/);
    assert.deepEqual(snapshot(f), before);
  });
});

test("changed accepted bytes invalidate reads and writes until explicitly replaced", t => {
  const f = fixture(t);
  f.progress(f.update());
  writeFileSync(join(f.attempt.folder, "artifacts/proof-v1.md"), "Changed after acceptance\n");
  const before = snapshot(f);
  const current = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(current.requirements[0].verification, "unverified");
  assert.match(current.requirements[0].evidence_warnings.join("\n"), /changed after acceptance/);
  assert.throws(() => f.progress(f.update()), /changed after acceptance/);
  assert.deepEqual(snapshot(f), before);
  const replacement = f.addArtifact("replacement", "New accepted proof\n");
  const update = f.update(); update.requirements[0].proof_refs = [replacement];
  f.progress(update);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "verified");
  rmSync(join(f.attempt.folder, "artifacts/replacement.md"));
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "unverified");
});

test("changed plan bytes invalidate every requirement without rewriting stored acceptance", t => {
  const f = fixture(t); f.progress(f.update());
  writeFileSync(join(f.attempt.folder, "artifacts/plan-v1.md"), "# Changed plan\n");
  const before = snapshot(f);
  const mapping = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(mapping.requirements[0].verification, "unverified");
  assert.match(mapping.warnings.join("\n"), /changed after acceptance/);
  assert.throws(() => f.progress(f.update()), /changed after acceptance/);
  assert.deepEqual(snapshot(f), before);
});

test("rejected phase movement writes no mapping revision or counter", t => {
  const f = fixture(t); f.progress(f.update());
  const before = snapshot(f);
  assert.throws(() => f.progress(f.update(), { phase: "post" }), /cannot be backfilled/);
  assert.deepEqual(snapshot(f), before);
});

test("explicit identity and checkpoint ownership remain mandatory for mapping updates", t => {
  const f = fixture(t);
  f.progress(f.update(), { workItem: "ticket:one", reviewRevision: "a".repeat(40) });
  const before = snapshot(f);
  const result = f.progress(f.update(), { workItem: "ticket:two", reviewRevision: "b".repeat(40) });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, "work_item_mismatch");
  assert.deepEqual(snapshot(f), before);
  assert.throws(() => recordProgress(f.slug, { message: "Unscoped mapping", requirementUpdate: f.update() }), /explicitly selected/);
  assert.deepEqual(snapshot(f), before);
});

test("conflicting history is rejected before consuming sequence or saving a journal", t => {
  const f = fixture(t); f.progress(f.update());
  writeFileSync(join(f.attempt.folder, "requirement-history/2.json"), "Conflicting saved revision\n");
  const before = snapshot(f);
  assert.throws(() => f.progress(f.update()), /history revision already exists with different bytes/);
  assert.deepEqual(snapshot(f), before);
});

test("duplicate plan identities and tables inside fenced examples are not requirement declarations", t => {
  const f = fixture(t, { planText: "# Plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | First |\n| R1 | Duplicate |\n" });
  const before = snapshot(f);
  assert.throws(() => f.progress(f.update()), /unique stable requirement IDs/);
  assert.deepEqual(snapshot(f), before);
  const codeOnly = f.addArtifact("code-plan", "# Plan\n````markdown\n```\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Example only |\n````\n", true, "plan", ["plan-v1"]);
  const beforeCode = snapshot(f);
  assert.throws(() => f.progress(f.update({ governing_plan: codeOnly })), /explicit Requirements table/);
  assert.deepEqual(snapshot(f), beforeCode);
});

test("repeated table headers, indented examples and escaped prose cannot invent source IDs", t => {
  const f = fixture(t, { planText: "# Plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | First |\n\n| Requirement | ID |\n| --- | --- |\n| One \\| Two | R2 |\n\n    | ID | Requirement |\n    | --- | --- |\n    | EXAMPLE | Indented example |\n" });
  const update = f.update();
  update.requirements.push({ requirement_id: "R2", decision_ref: f.plan, work_state: "planned", proof_refs: [] });
  f.progress(update);
  assert.deepEqual(readRequirementMapping(f.slug, f.attempt.id).requirements.map(x => x.requirement_id), ["R1", "R2"]);
  for (const invented of ["ID", "Requirement", "Two", "EXAMPLE"]) {
    const invalid = f.update(); invalid.requirements[0].requirement_id = invented;
    const before = snapshot(f);
    assert.throws(() => f.progress(invalid), /must exist in the governing plan/);
    assert.deepEqual(snapshot(f), before);
  }
});

test("new mapping reads reject ambiguous identities instead of choosing a newer attempt", t => {
  const f = fixture(t); f.progress(f.update());
  const other = createAttemptInStore(f.slug, "mapping");
  const before = snapshot(f);
  assert.throws(() => readRequirementMapping(f.slug, "mapping"), /ambiguous/);
  assert.throws(() => readRequirementMapping(f.slug), /required/);
  assert.equal(readRequirementMapping(f.slug, other.id), null);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).revision, 1);
  assert.deepEqual(snapshot(f), before);
});

test("ordinary requirement prose containing ID remains a data cell", t => {
  const f = fixture(t, { planText: "# Plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | ID |\n| R2 | Requirement ID |\n" });
  const update = f.update();
  update.requirements.push({ requirement_id: "R2", decision_ref: null, work_state: "planned", proof_refs: [] });
  f.progress(update);
  assert.deepEqual(readRequirementMapping(f.slug, f.attempt.id).requirements.map(x => x.requirement_id), ["R1", "R2"]);
});

test("competing processes cannot apply two updates against one source revision", async t => {
  const f = fixture(t); f.progress(f.update());
  const proof2 = f.addArtifact("proof-v2", "Candidate two\n");
  const proof3 = f.addArtifact("proof-v3", "Candidate three\n");
  const beforeSequence = Number(readFileSync(join(storeProjectDir(f.slug), ".progress-sequence"), "utf8"));
  const sourceUpdate = f.update();
  const run = proof => new Promise((resolveRun, rejectRun) => {
    const update = structuredClone(sourceUpdate); update.requirements[0].proof_refs = [proof];
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      const { recordProgress } = await import(${JSON.stringify(moduleUrl)});
      try { recordProgress(${JSON.stringify(f.slug)}, { attemptId: ${JSON.stringify(f.attempt.id)}, phase: 'build',
        message: ${JSON.stringify(proof.artifact_id)}, next: 'Read winner', requirementUpdate: ${JSON.stringify(update)} });
        console.log(JSON.stringify({ recorded: true })); }
      catch (error) { console.log(JSON.stringify({ error: error.message })); }
    `], { env: { ...process.env }, timeout: 30000, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", rejectRun);
    child.on("close", status => { try { assert.equal(status, 0, stderr); resolveRun(JSON.parse(stdout)); } catch (error) { rejectRun(error); } });
  });
  const results = await Promise.all([run(proof2), run(proof3)]);
  assert.equal(results.filter(result => result.recorded).length, 1);
  assert.match(results.find(result => result.error).error, /expected_revision/);
  const mapping = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(mapping.revision, 2);
  assert.equal(mapping.requirements[0].verification, "verified");
  assert.deepEqual(readdirSync(join(f.attempt.folder, "requirement-history")).sort(), ["1.json", "2.json"]);
  assert.equal(Number(readFileSync(join(storeProjectDir(f.slug), ".progress-sequence"), "utf8")), beforeSequence + 1);
});

for (const boundary of ["before-journal", "before-history", "after-history", "after-mapping", "after-handoff", "after-canonical", "after-lifecycle"]) {
  test(`fresh-process recovery keeps one mapping revision after exit ${boundary}`, t => {
    const f = fixture(t); f.progress(f.update(), { message: "First checkpoint" });
    const proof2 = f.addArtifact("proof-v2", "Second accepted proof\n");
    const update = f.update(); update.requirements[0].proof_refs = [proof2];
    const target = boundary === "before-journal" ? join(storeProjectDir(f.slug), ".pending-progress.json")
      : boundary.includes("history") ? join(f.attempt.folder, "requirement-history/2.json")
      : ["after-mapping", "after-lifecycle"].includes(boundary) ? join(f.attempt.folder, "attempt.json")
      : boundary === "after-canonical" ? join(storeProjectDir(f.slug), "HANDOFF.md") : join(f.attempt.folder, "HANDOFF.md");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (to === ${JSON.stringify(target)} && ${JSON.stringify(boundary)}.startsWith('before-')) process.exit(73);
        rename(from, to);
        if (to === ${JSON.stringify(target)} && (${JSON.stringify(boundary)} !== 'after-lifecycle' || JSON.parse(fs.readFileSync(to, 'utf8')).current_phase === 'verify')) process.exit(73);
      };
      syncBuiltinESMExports();
      const { recordProgress } = await import(${JSON.stringify(moduleUrl)});
      recordProgress(${JSON.stringify(f.slug)}, { attemptId: ${JSON.stringify(f.attempt.id)}, phase: 'verify',
        message: 'Second checkpoint', next: 'Check recovered result', requirementUpdate: ${JSON.stringify(update)} });
    `], { env: { ...process.env }, encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(child.status, 73, child.stderr);
    const recovered = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      const now = Date.now; Date.now = () => now() + 3600000;
      const { readRequirementMapping, getAttempt } = await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify({ mapping: readRequirementMapping(${JSON.stringify(f.slug)}, ${JSON.stringify(f.attempt.id)}),
        attempt: getAttempt(${JSON.stringify(f.slug)}, ${JSON.stringify(f.attempt.id)}) }));
    `], { env: { ...process.env }, encoding: "utf8", timeout: 30000, windowsHide: true }));
    const expectedRevision = boundary === "before-journal" ? 1 : 2;
    assert.equal(recovered.mapping.revision, expectedRevision);
    assert.deepEqual(recovered.mapping.requirements[0].proof_refs, [expectedRevision === 1 ? f.proof : proof2]);
    assert.equal(recovered.mapping.requirements[0].verification, "verified");
    assert.equal(recovered.attempt.current_phase, expectedRevision === 1 ? "build" : "verify");
    assert.equal(existsSync(join(storeProjectDir(f.slug), ".pending-progress.json")), false);
    assert.deepEqual(readdirSync(join(f.attempt.folder, "requirement-history")).filter(name => /^[1-9]\d*\.json$/.test(name)).sort(),
      expectedRevision === 1 ? ["1.json"] : ["1.json", "2.json"]);
    const attemptHandoff = parseCurrentHandoff(readFileSync(join(f.attempt.folder, "HANDOFF.md"), "utf8"));
    const canonicalHandoff = parseCurrentHandoff(readFileSync(join(storeProjectDir(f.slug), "HANDOFF.md"), "utf8"));
    assert.deepEqual(attemptHandoff.completedSteps, canonicalHandoff.completedSteps);
    assert.equal(new Set(attemptHandoff.completedSteps).size, attemptHandoff.completedSteps.length);
  });
}
