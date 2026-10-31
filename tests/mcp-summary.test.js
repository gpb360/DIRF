import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  registerProject, createAttemptInStore, recordAttemptArtifact, acceptAttemptArtifact,
  recordProgress, getAttempt, attemptResponsibility, storeProjectDir,
} from "../src/state.js";

const CLI = resolve("src/cli.js");
const SERVER = resolve("src/mcp.js");
const scratch = resolve(".scratch/ne006-mcp");
mkdirSync(scratch, { recursive: true });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

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

function fixture(t, { mapped = true } = {}) {
  const previousHome = process.env.DIRF_HOME;
  const home = mkdtempSync(join(scratch, "home-"));
  process.env.DIRF_HOME = home;
  t.after(() => { if (previousHome === undefined) delete process.env.DIRF_HOME; else process.env.DIRF_HOME = previousHome; });
  const root = mkdtempSync(join(scratch, "repo-"));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "mcp-summary");
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["build", "verify"] } }));
  writeFileSync(join(attempt.folder, "HANDOFF.md"), `# DIRF Handoff\n\n## Attempt ID\n\n${attempt.id}\n\n## Current phase\n\nbuild\n\n## Exact next action\n\nRead current evidence\n`);
  mkdirSync(join(attempt.folder, "artifacts"));
  const addArtifact = (id, text, type = "implementation_evidence") => {
    const path = `artifacts/${id}.md`;
    writeFileSync(join(attempt.folder, path), text);
    recordAttemptArtifact(slug, attempt.id, { id, type, path });
    acceptAttemptArtifact(slug, attempt.id, id);
    return { artifact_id: id, sha256: digest(text) };
  };
  const plan = addArtifact("plan", "# Requirements\n| ID | Requirement |\n| --- | --- |\n"
    + Array.from({ length: 7 }, (_, i) => `| R${i + 1} | Meaning ${i + 1} |`).join("\n") + "\n", "plan");
  const proof = addArtifact("proof", "Accepted proof\n");
  const update = (changes = {}) => ({ schema_version: 1, attempt_id: attempt.id, governing_plan: plan,
    expected_revision: getAttempt(slug, attempt.id).requirement_mapping?.revision || 0,
    requirements: Array.from({ length: 7 }, (_, i) => ({ requirement_id: `R${i + 1}`, decision_ref: plan,
      work_state: "complete", proof_refs: [proof] })), ...changes });
  if (mapped) recordProgress(slug, { attemptId: attempt.id, phase: "build", message: "Initial mapping", next: "Read current evidence", requirementUpdate: update() });
  const runCli = (args, cwd = root) => spawnSync(process.execPath, [CLI, ...args], {
    cwd, env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: 30000, windowsHide: true,
  });
  const cli = args => {
    const result = runCli(args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const exchange = (messages, { modern = true, cwd = root } = {}) => {
    const initialization = { jsonrpc: "2.0", id: 0, method: "initialize", params: {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" },
    } };
    const requests = messages.map((message, i) => ({ jsonrpc: "2.0", id: i + 1, ...message,
      params: { ...(modern ? { _meta: meta } : {}), ...message.params } }));
    const result = spawnSync(process.execPath, [SERVER], { cwd, env: { ...process.env, DIRF_HOME: home },
      input: [...(modern ? [] : [initialization]), ...requests].map(x => JSON.stringify(x)).join("\n") + "\n",
      encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const replies = result.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    return modern ? replies : replies.slice(1);
  };
  const call = (name, args, options) => exchange([{ method: "tools/call", params: { name, arguments: args } }], options)[0];
  const summary = (args = {}, options) => call("dirf_read_summary", { attempt: attempt.id, ...args }, options);
  return { root, home, slug, attempt, plan, proof, update, addArtifact, runCli, cli, exchange, call, summary };
}

test("MCP summary matches compact CLI meaning in both protocols without mutating state", t => {
  const f = fixture(t);
  const before = snapshot(f.home);
  const expected = f.cli(["state", "summary", "--attempt", f.attempt.id, "--json"]);
  for (const modern of [true, false]) {
    const response = f.summary({}, { modern });
    assert.equal(response.error, undefined);
    const output = JSON.parse(response.result.content[0].text);
    assert.deepEqual(output, expected);
    assert.equal(output.requirements.items.length, 5);
    assert.equal(output.requirements.total, 7);
    assert.equal(output.evidence_completeness, "verified");
    assert.deepEqual(output.requirements.items[0].proof_refs, [f.proof]);
    for (const key of ["project_brain", "project_handoff", "attempt_handoff"]) assert.equal(key in output, false);
    if (modern) assert.deepEqual(response.result.structuredContent, output);
    assert.deepEqual(snapshot(f.home), before);
  }
  assert.equal(attemptResponsibility(f.slug, f.root).state, "idle");
});

test("MCP explicit requirement updates survive restart and preserve legacy progress fields", t => {
  const f = fixture(t, { mapped: false });
  const artifacts = getAttempt(f.slug, f.attempt.id).artifacts;
  const response = f.call("dirf_record_progress", { attempt: f.attempt.id, message: "Record explicit mapping",
    currentPhase: "build", nextAction: "Read current evidence", requirementUpdate: f.update() });
  assert.equal(response.result.isError, false);
  const progress = response.result.structuredContent;
  for (const key of ["ok", "slug", "recorded", "accepted", "reason", "attempt_accepted", "attempt_reason", "message"]) {
    assert.ok(key in progress, key);
  }
  assert.equal(progress.recorded, true);
  assert.equal(progress.accepted, true);
  const summary = f.summary().result.structuredContent;
  assert.equal(summary.mapping.revision, 1);
  assert.equal(summary.evidence_completeness, "verified");
  assert.deepEqual(summary, f.cli(["state", "summary", "--attempt", f.attempt.id, "--json"]));
  assert.deepEqual(getAttempt(f.slug, f.attempt.id).artifacts, artifacts);
});

test("tool discovery describes summary cursors and the explicit mapping input", t => {
  const f = fixture(t);
  const tools = f.exchange([{ method: "tools/list" }])[0].result.tools;
  const summary = tools.find(tool => tool.name === "dirf_read_summary");
  assert.deepEqual(summary.inputSchema.required, ["attempt"]);
  for (const name of ["project", "attempt", "requirementsCursor", "unresolvedWorkCursor"]) {
    assert.equal(summary.inputSchema.properties[name].type, "string");
  }
  const update = tools.find(tool => tool.name === "dirf_record_progress").inputSchema.properties.requirementUpdate;
  assert.equal(update.type, "object");
  assert.deepEqual(update.required, ["schema_version", "attempt_id", "governing_plan", "expected_revision", "requirements"]);
  assert.ok(update.properties.requirements.items.required.includes("proof_refs"));
  for (const name of ["dirf_read_assignment", "dirf_read_handoff", "dirf_get_attempt", "dirf_write_handoff"]) {
    assert.ok(tools.some(tool => tool.name === name));
  }
});

test("MCP and CLI page every requirement and unresolved item using the same cursors", t => {
  const f = fixture(t);
  const update = f.update();
  for (const entry of update.requirements) { entry.decision_ref = null; entry.work_state = "blocked"; }
  assert.equal(f.call("dirf_record_progress", { attempt: f.attempt.id, message: "Blocked work",
    nextAction: "Review decisions", requirementUpdate: update }).result.isError, false);
  const first = f.summary({ project: f.slug }).result.structuredContent;
  assert.equal(first.unresolved_work.total, 14);
  const before = snapshot(f.home);
  const second = f.summary({ project: f.root, requirementsCursor: first.requirements.next_cursor,
    unresolvedWorkCursor: first.unresolved_work.next_cursor }).result.structuredContent;
  assert.deepEqual(second.requirements.items.map(item => item.source.requirement_id), ["R6", "R7"]);
  assert.equal(second.unresolved_work.offset, 5);
  assert.deepEqual(second, f.cli(["state", "summary", "--attempt", f.attempt.id,
    "--requirements-cursor", first.requirements.next_cursor, "--unresolved-work-cursor", first.unresolved_work.next_cursor, "--json"]));
  const final = f.summary({ unresolvedWorkCursor: second.unresolved_work.next_cursor }).result.structuredContent;
  assert.equal(final.unresolved_work.items.length, 4);
  assert.equal(final.unresolved_work.next_cursor, null);
  assert.deepEqual(snapshot(f.home), before);
});

test("missing and ambiguous identities or invalid cursors reject without claiming work", t => {
  const f = fixture(t);
  const cursor = f.summary().result.structuredContent.requirements.next_cursor;
  recordProgress(f.slug, { attemptId: f.attempt.id, phase: "build", message: "New mapping revision", next: "Read", requirementUpdate: f.update() });
  createAttemptInStore(f.slug, "mcp-summary");
  const before = snapshot(f.home);
  const calls = [
    {}, { attempt: "" }, { attempt: "mcp-summary" }, { attempt: "missing" },
    { attempt: f.attempt.id, requirementsCursor: cursor },
    { attempt: f.attempt.id, unresolvedWorkCursor: "invalid" },
    { attempt: f.attempt.id, requirementsCursor: 12 },
  ];
  for (const args of calls) {
    for (const modern of [true, false]) {
      const response = f.call("dirf_read_summary", args, { modern });
      if (modern) assert.equal(response.result.isError, true);
      else assert.equal(response.error.code, -32603);
      assert.deepEqual(snapshot(f.home), before);
    }
  }
  assert.equal(attemptResponsibility(f.slug, f.root).state, "idle");
});

test("invalid explicit MCP updates reject like CLI without changing stored bytes", t => {
  const f = fixture(t);
  const cases = [null, [], {}, { ...f.update(), expected_revision: 0 }, { ...f.update(), attempt_id: "other" }];
  const unknown = f.update(); unknown.requirements[0].requirement_id = "R99"; cases.push(unknown);
  const spoof = f.update(); spoof.requirements[0].accepted = true; cases.push(spoof);
  const proof = f.update(); proof.requirements[0].proof_refs[0] = { ...f.proof, sha256: "f".repeat(64) }; cases.push(proof);
  const plan = f.update(); plan.governing_plan = { ...f.plan, sha256: "f".repeat(64) }; cases.push(plan);
  const state = f.update(); state.requirements[0].work_state = "verified"; cases.push(state);
  for (const requirementUpdate of cases) {
    const file = join(f.root, "update.json"); writeFileSync(file, JSON.stringify(requirementUpdate));
    const before = snapshot(f.home);
    const response = f.call("dirf_record_progress", { attempt: f.attempt.id, message: "Invalid update",
      nextAction: "Read", requirementUpdate });
    assert.equal(response.result.isError, true, JSON.stringify(requirementUpdate));
    assert.deepEqual(snapshot(f.home), before);
    const cli = f.runCli(["record-progress", "Invalid update", "--attempt", f.attempt.id, "--requirement-update-file", file]);
    assert.notEqual(cli.status, 0);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("mapping input requires explicit attempt while ordinary progress retains its contract", t => {
  const f = fixture(t, { mapped: false });
  const before = snapshot(f.home);
  for (const attempt of [undefined, "", "   "]) {
    const response = f.call("dirf_record_progress", { attempt, message: "Must not infer attempt",
      nextAction: "Read", requirementUpdate: f.update() });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /requires an explicit attempt/);
    assert.deepEqual(snapshot(f.home), before);
  }
  const response = f.call("dirf_record_progress", { message: "R1 is accepted and verified", nextAction: "Read" }, { modern: false });
  assert.equal(JSON.parse(response.result.content[0].text).recorded, true);
  assert.equal(f.summary().result.structuredContent.mapping.status, "mapping_missing");
});

test("replacement proof through MCP retains the previous revision and warns when bytes change", t => {
  const f = fixture(t);
  const nextProof = f.addArtifact("new-proof", "New accepted proof\n");
  const update = f.update();
  update.requirements = [{ ...update.requirements[0], proof_refs: [nextProof] }];
  const response = f.call("dirf_record_progress", { attempt: f.attempt.id, message: "Replace proof", nextAction: "Read", requirementUpdate: update });
  assert.equal(response.result.isError, false);
  const next = f.summary().result.structuredContent;
  assert.equal(next.mapping.revision, 2);
  assert.deepEqual(next.requirements.items[0].proof_refs, [nextProof]);
  const history = JSON.parse(readFileSync(join(f.attempt.folder, "requirement-history/1.json"), "utf8"));
  assert.deepEqual(history.mapping.requirements[0].proof_refs, [f.proof]);
  writeFileSync(join(f.attempt.folder, "artifacts/new-proof.md"), "Changed after acceptance\n");
  const before = snapshot(f.home);
  const changed = f.summary().result.structuredContent;
  assert.equal(changed.requirements.items[0].verification, "unverified");
  assert.equal(changed.evidence_completeness, "unverified");
  assert.ok(changed.warnings.some(warning => warning.code === "artifact_changed"));
  assert.deepEqual(changed, f.cli(["state", "summary", "--attempt", f.attempt.id, "--json"]));
  assert.deepEqual(snapshot(f.home), before);
});

test("legacy handoff history stays lazy and unchanged in compact MCP output", t => {
  const f = fixture(t, { mapped: false });
  const handoff = join(f.attempt.folder, "HANDOFF.md");
  writeFileSync(handoff, readFileSync(handoff, "utf8") + "\n## Completed\n" + "- Historical R1 accepted and verified\n".repeat(1000));
  const before = snapshot(f.home);
  const output = f.summary().result.structuredContent;
  assert.equal(output.mapping.status, "mapping_missing");
  assert.equal(output.evidence_completeness, "unverified");
  assert.ok(JSON.stringify(output).length < 2500);
  assert.doesNotMatch(JSON.stringify(output), /Historical R1/);
  assert.deepEqual(output, f.cli(["state", "summary", "--attempt", f.attempt.id, "--json"]));
  assert.deepEqual(snapshot(f.home), before);
});

test("MCP compact reads never recover pending progress or migrate legacy state", t => {
  const f = fixture(t);
  const explicitUpdate = f.update();
  writeFileSync(join(storeProjectDir(f.slug), ".pending-progress.json"), "Pending recovery sentinel\n");
  const before = snapshot(f.home);
  const response = f.summary();
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /progress write is pending/);
  assert.deepEqual(snapshot(f.home), before);
  const other = mkdtempSync(join(scratch, "legacy-"));
  execFileSync("git", ["init", "--quiet", other]);
  mkdirSync(join(other, ".dirf"));
  writeFileSync(join(other, ".dirf/HANDOFF.md"), "Legacy sentinel\n");
  writeFileSync(join(other, ".dirf/config.json"), "{}\n");
  const legacyBefore = snapshot(other);
  for (const project of [undefined, other]) {
    const read = f.summary({ project }, { cwd: other });
    assert.equal(read.result.isError, true);
    assert.match(read.result.content[0].text, /Unknown DIRF project/);
    const write = f.call("dirf_record_progress", { project, attempt: f.attempt.id, message: "Must not migrate",
      nextAction: "Read", requirementUpdate: explicitUpdate }, { cwd: other });
    assert.equal(write.result.isError, true);
    assert.match(write.result.content[0].text, /Unknown DIRF project/);
    assert.deepEqual(snapshot(other), legacyBefore);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("mapping progress preserves the registered-path newer-local-handoff conflict check", t => {
  const f = fixture(t);
  const update = f.update();
  mkdirSync(join(f.root, ".dirf"));
  const local = join(f.root, ".dirf/HANDOFF.md");
  writeFileSync(local, "Newer local handoff\n");
  const newer = new Date(statSync(join(storeProjectDir(f.slug), "HANDOFF.md")).mtimeMs + 60000);
  utimesSync(local, newer, newer);
  const before = snapshot(f.home);
  const read = f.summary({ project: f.root });
  assert.equal(read.result.isError, false);
  assert.deepEqual(read.result.structuredContent, f.cli(["state", "summary", "--attempt", f.attempt.id, "--json"]));
  assert.deepEqual(snapshot(f.home), before);
  const plain = f.call("dirf_record_progress", { project: f.root, attempt: f.attempt.id, message: "Blocked by local handoff", nextAction: "Read" });
  assert.equal(plain.result.isError, true);
  assert.match(plain.result.content[0].text, /newer|conflict/i);
  const mapped = f.call("dirf_record_progress", { project: f.root, attempt: f.attempt.id, message: "Must preserve conflict",
    nextAction: "Read", requirementUpdate: update });
  assert.equal(mapped.result.isError, true);
  assert.deepEqual(snapshot(f.home), before);
});

test("an unknown slug-shaped project is not reinterpreted as a relative directory", t => {
  const f = fixture(t);
  mkdirSync(join(f.root, "unknown-abcd1234"));
  const before = snapshot(f.home);
  const response = f.summary({ project: "unknown-abcd1234" });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /Unknown DIRF project unknown-abcd1234/);
  assert.deepEqual(snapshot(f.home), before);
});
