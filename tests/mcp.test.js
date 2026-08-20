import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const onData = (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const line = buf.slice(0, nl);
        child.stdout.off("data", onData);
        try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
      }
    };
    child.stdout.on("data", onData);
    setTimeout(() => reject(new Error("timeout")), 5000);
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
    const resumedNewer = JSON.parse(cli("resume", newer.attempt.id, "--path", dir, "--json"));
    assert.match(resumedOlder.attempt_handoff, /older MCP progress/);
    assert.doesNotMatch(resumedNewer.attempt_handoff, /older MCP progress/);
  } finally { child.kill(); }
});
