import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const MCP = join(process.cwd(), "src", "mcp.js");
const CLI_PROJECT = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function startServer(home) {
  const child = spawn(process.execPath, [MCP], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, DIRF_HOME: home },
  });
  return child;
}

function setupProj(home, dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  execFileSync(process.execPath, [CLI_PROJECT, "setup", dir], {
    env: { ...process.env, DIRF_HOME: home },
    encoding: "utf8",
    timeout: TIMEOUT,
  });
}

function send(child, obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function once(child) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      child.stdout.off("data", onData);
      reject(new Error("timeout"));
    }, 5000);
    const onData = (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        clearTimeout(timer);
        const line = buf.slice(0, nl);
        child.stdout.off("data", onData);
        try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
      }
    };
    child.stdout.on("data", onData);
  });
}

test("initialize handshake returns server info + protocol version", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-"));
  const child = startServer(home);
  try {
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    const res = await once(child);
    assert.equal(res.id, 1);
    assert.equal(res.result.serverInfo.name, "dirf");
    assert.equal(res.result.serverInfo.version, packageJson.version);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
  } finally { child.kill(); }
});

test("tools/list returns the expected dirf_* tools", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-"));
  const child = startServer(home);
  try {
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    await once(child);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const res = await once(child);
    const names = res.result.tools.map((t) => t.name).sort();
    assert.ok(names.includes("dirf_read_handoff"));
    assert.ok(names.includes("dirf_write_handoff"));
    assert.ok(names.includes("dirf_record_progress"));
    assert.ok(names.includes("dirf_list_projects"));
    assert.ok(names.includes("dirf_read_assignment"));
  } finally { child.kill(); }
});

test("dirf_write_handoff then dirf_read_handoff round-trip via MCP, byte-identical to CLI", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-eq-"));
  const dir = mkdtempSync(join(tmpdir(), "eqproj-"));
  setupProj(home, dir);

  const child = startServer(home);
  try {
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    await once(child);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });

    // write via MCP, using the path as project
    const md = "# Via MCP\n\nDrift impossible.\n";
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dirf_write_handoff", arguments: { project: dir, content: md } } });
    const writeRes = await once(child);
    assert.equal(writeRes.result.content[0].text.includes('"ok":true'), true);

    // read via MCP
    send(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dirf_read_handoff", arguments: { project: dir } } });
    const readRes = await once(child);
    const parsed = JSON.parse(readRes.result.content[0].text);
    assert.equal(parsed.content, md);

    // equivalence: CLI read-handoff returns the same bytes
    const cliOut = execFileSync(process.execPath, [CLI_PROJECT, "state", "read-handoff"], { cwd: dir, env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: TIMEOUT });
    assert.equal(cliOut, md, "MCP and CLI must return byte-identical handoff (same core)");
  } finally { child.kill(); }
});

test("dirf_record_progress requires and honors an explicit attempt when several exist", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-progress-"));
  const dir = mkdtempSync(join(tmpdir(), "progressproj-"));
  setupProj(home, dir);
  const cli = (...args) => execFileSync(process.execPath, [CLI_PROJECT, ...args], {
    cwd: dir, env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: TIMEOUT,
  });
  const older = JSON.parse(cli("build", "older", "older MCP task", "--path", dir, "--json"));
  const newer = JSON.parse(cli("build", "newer", "newer MCP task", "--path", dir, "--json"));

  const child = startServer(home);
  try {
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    await once(child);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });

    send(child, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dirf_record_progress", arguments: { project: dir, message: "ambiguous", nextAction: "continue" } } });
    const ambiguous = await once(child);
    assert.match(ambiguous.error.message, /multiple attempts.*--attempt/i);

    send(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dirf_record_progress", arguments: { project: dir, attempt: older.attempt.id, message: "older MCP progress", nextAction: "review older" } } });
    const recorded = await once(child);
    assert.equal(JSON.parse(recorded.result.content[0].text).ok, true);

    const resumedOlder = JSON.parse(cli("resume", older.attempt.id, "--path", dir, "--json"));
    cli("attempt", "block", older.attempt.id, "--reason", "switch attempts", "--path", dir);
    const resumedNewer = JSON.parse(cli("resume", newer.attempt.id, "--path", dir, "--json"));
    assert.match(resumedOlder.attempt_handoff, /older MCP progress/);
    assert.doesNotMatch(resumedNewer.attempt_handoff, /older MCP progress/);
  } finally { child.kill(); }
});

test("dirf_read_assignment returns only the exact attempt workflow and handoff", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-assignment-"));
  const dir = mkdtempSync(join(tmpdir(), "assignment-proj-"));
  setupProj(home, dir);
  const cli = (...args) => execFileSync(process.execPath, [CLI_PROJECT, ...args], {
    cwd: dir, env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: TIMEOUT,
  });
  const older = JSON.parse(cli("build", "shared-name", "older isolated assignment", "--path", dir, "--json"));
  const newer = JSON.parse(cli("build", "shared-name", "newer private assignment", "--path", dir, "--json"));
  const expectedWorkflow = JSON.parse(readFileSync(older.workflow, "utf8"));
  const olderFolder = dirname(older.workflow);
  const expectedHandoff = readFileSync(join(olderFolder, "HANDOFF.md"), "utf8");
  const metadataPath = join(olderFolder, "attempt.json");
  const storedMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  writeFileSync(metadataPath, JSON.stringify({
    ...storedMetadata,
    blocker: "internal blocker",
    children: [{ id: "private-child" }],
    current_execution: { authority_hash: "must-not-leak" },
  }, null, 2) + "\n");

  const child = startServer(home);
  try {
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    await once(child);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });

    send(child, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dirf_read_assignment", arguments: { project: dir, attempt: older.attempt.id } } });
    const exact = JSON.parse((await once(child)).result.content[0].text);
    assert.deepEqual(Object.keys(exact).sort(), [
      "created_at", "current_phase", "handoff", "id", "name", "status", "worker", "workflow",
    ]);
    assert.equal(exact.id, older.attempt.id);
    assert.deepEqual(exact.workflow, expectedWorkflow);
    assert.equal(exact.handoff, expectedHandoff);
    assert.doesNotMatch(JSON.stringify(exact), /newer private assignment/);
    assert.doesNotMatch(JSON.stringify(exact), /must-not-leak|private-child|internal blocker/);

    send(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dirf_read_assignment", arguments: { project: dir, attempt: "shared-name" } } });
    const ambiguousName = await once(child);
    assert.match(ambiguousName.error.message, /exact id/);

    send(child, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dirf_read_assignment", arguments: { project: dir, attempt: `../${newer.attempt.id}` } } });
    const traversal = await once(child);
    assert.match(traversal.error.message, /exact id/);

    rmSync(join(olderFolder, "HANDOFF.md"));
    send(child, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "dirf_read_assignment", arguments: { project: dir, attempt: older.attempt.id } } });
    const missingHandoff = await once(child);
    assert.match(missingHandoff.error.message, /has no HANDOFF\.md assignment/);
  } finally { child.kill(); }
});

test("dirf_record_progress distinguishes scoped recording from canonical acceptance and rejects stale or unknown revisions without mutation", async () => {
  const home = mkdtempSync(join(tmpdir(), "mcp-revision-"));
  const dir = mkdtempSync(join(tmpdir(), "revision-proj-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.email", "dirf@example.test"], { cwd: dir, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.name", "DIRF Test"], { cwd: dir, timeout: TIMEOUT });
  writeFileSync(join(dir, "review.txt"), "A\n");
  execFileSync("git", ["add", "review.txt"], { cwd: dir, timeout: TIMEOUT });
  execFileSync("git", ["commit", "-qm", "A"], { cwd: dir, timeout: TIMEOUT });
  const revisionA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", timeout: TIMEOUT }).trim();
  writeFileSync(join(dir, "review.txt"), "B\n");
  execFileSync("git", ["commit", "-qam", "B"], { cwd: dir, timeout: TIMEOUT });
  const revisionB = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", timeout: TIMEOUT }).trim();
  execFileSync(process.execPath, [CLI_PROJECT, "setup", dir], {
    env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: TIMEOUT,
  });
  const cli = (...args) => execFileSync(process.execPath, [CLI_PROJECT, ...args], {
    cwd: dir, env: { ...process.env, DIRF_HOME: home }, encoding: "utf8", timeout: TIMEOUT,
  });
  const older = JSON.parse(cli("build", "older-review", "older review", "--path", dir, "--json"));
  const newer = JSON.parse(cli("build", "newer-review", "newer review", "--path", dir, "--json"));
  const child = startServer(home);
  let requestId = 1;
  const callProgress = async (attempt, message, reviewRevision) => {
    requestId += 1;
    send(child, {
      jsonrpc: "2.0", id: requestId, method: "tools/call",
      params: { name: "dirf_record_progress", arguments: {
        project: dir, attempt, message, nextAction: `Next after ${message}`,
        workItem: "pr:77", reviewRevision,
      } },
    });
    const response = await once(child);
    assert.equal(response.id, requestId);
    return JSON.parse(response.result.content[0].text);
  };

  try {
    send(child, { jsonrpc: "2.0", id: requestId, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    await once(child);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });

    assert.equal((await callProgress(older.attempt.id, "record revision A", revisionA)).accepted, true);
    assert.equal((await callProgress(newer.attempt.id, "record revision B", revisionB)).accepted, true);

    const scopedOnly = await callProgress(older.attempt.id, "continue revision A", revisionA);
    assert.equal(scopedOnly.ok, true);
    assert.equal(scopedOnly.recorded, true);
    assert.equal(scopedOnly.accepted, false);
    assert.equal(scopedOnly.attempt_accepted, true);
    assert.equal(scopedOnly.reason, "stale_review_revision");

    const promoted = await callProgress(older.attempt.id, "move older attempt to revision B", revisionB);
    assert.equal(promoted.accepted, true);
    assert.equal(promoted.attempt_accepted, true);
    const slug = promoted.slug;
    const projectDir = join(home, "projects", slug);
    const canonicalPath = join(projectDir, "HANDOFF.md");
    const attemptHandoffPath = join(dirname(older.workflow), "HANDOFF.md");
    const attemptMetadataPath = join(dirname(older.workflow), "attempt.json");
    const sequencePath = join(projectDir, ".progress-sequence");
    requestId += 1;
    const unrelatedCanonical = readFileSync(canonicalPath, "utf8").replace("pr:77", "pr:88");
    send(child, { jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name: "dirf_write_handoff", arguments: { project: dir, content: unrelatedCanonical } } });
    assert.equal(JSON.parse((await once(child)).result.content[0].text).ok, true);
    const beforeRejected = {
      canonical: readFileSync(canonicalPath, "utf8"),
      attempt: readFileSync(attemptHandoffPath, "utf8"),
      metadata: readFileSync(attemptMetadataPath, "utf8"),
      sequence: readFileSync(sequencePath, "utf8"),
    };

    const stale = await callProgress(older.attempt.id, "try delayed revision A against unrelated canonical work", revisionA);
    assert.deepEqual(
      { ok: stale.ok, recorded: stale.recorded, accepted: stale.accepted, attemptAccepted: stale.attempt_accepted, reason: stale.reason },
      { ok: true, recorded: false, accepted: false, attemptAccepted: false, reason: "stale_review_revision" },
    );
    const unknown = await callProgress(older.attempt.id, "try unknown revision", "f".repeat(40));
    assert.deepEqual(
      { ok: unknown.ok, recorded: unknown.recorded, accepted: unknown.accepted, attemptAccepted: unknown.attempt_accepted, reason: unknown.reason },
      { ok: true, recorded: false, accepted: false, attemptAccepted: false, reason: "unverified_review_revision" },
    );
    assert.deepEqual({
      canonical: readFileSync(canonicalPath, "utf8"),
      attempt: readFileSync(attemptHandoffPath, "utf8"),
      metadata: readFileSync(attemptMetadataPath, "utf8"),
      sequence: readFileSync(sequencePath, "utf8"),
    }, beforeRejected);

    writeFileSync(join(dir, "review.txt"), "C\n");
    execFileSync("git", ["commit", "-qam", "C"], { cwd: dir, timeout: TIMEOUT });
    const revisionC = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", timeout: TIMEOUT }).trim();
    const current = await callProgress(older.attempt.id, "record current revision C", revisionC);
    assert.equal(current.recorded, true);
    assert.equal(current.accepted, true);
    assert.equal(current.attempt_accepted, true);
    assert.match(readFileSync(canonicalPath, "utf8"), /record current revision C/);
    assert.equal(Number(readFileSync(sequencePath, "utf8").trim()), Number(beforeRejected.sequence.trim()) + 1);
  } finally { child.kill(); }
});
