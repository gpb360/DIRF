import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "mcp.js");

function startServer(home) {
  const child = spawn(process.execPath, [CLI], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, DIRF_HOME: home },
  });
  return child;
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
    assert.ok(res.result.serverInfo.name);
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
    assert.ok(names.includes("dirf_list_projects"));
  } finally { child.kill(); }
});
