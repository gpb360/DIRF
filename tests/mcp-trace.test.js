import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceMcpToolCall } from "../src/mcp-trace.js";
import { PassThrough } from "node:stream";

const FIXTURE = join(process.cwd(), "tests", "fixtures", "mcp-trace-server.js");
const CLI = join(process.cwd(), "src", "cli.js");

function startBoundary(home, mode = "capture") {
  return spawn(process.execPath, [FIXTURE, mode], {
    stdio: ["pipe", "pipe", "inherit", "pipe"],
    env: { ...process.env, DIRF_HOME: home },
  });
}

function send(child, message) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

function nextLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => { stream.off("data", onData); reject(new Error("timeout")); }, 5000);
    const onData = chunk => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      stream.off("data", onData);
      resolve(JSON.parse(buffer.slice(0, newline)));
    };
    stream.on("data", onData);
  });
}

function nextLines(stream, count) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => { stream.off("data", onData); reject(new Error("timeout")); }, 5000);
    const onData = chunk => {
      buffer += chunk.toString();
      const lines = buffer.split("\n").slice(0, -1).filter(Boolean);
      if (lines.length < count) return;
      clearTimeout(timer);
      stream.off("data", onData);
      try {
        resolve(lines.slice(0, count).map(line => JSON.parse(line)));
      } catch (error) {
        reject(error);
      }
    };
    stream.on("data", onData);
  });
}

function setupProject(home) {
  const project = mkdtempSync(join(tmpdir(), "dirf-mcp-boundary-"));
  execFileSync("git", ["init", "-q"], { cwd: project });
  execFileSync(process.execPath, [CLI, "setup", project], {
    cwd: project,
    env: { ...process.env, DIRF_HOME: home },
  });
  return project;
}

async function initialize(child) {
  send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "trace-test", version: "1" },
  } });
  assert.equal((await nextLine(child.stdout)).result.serverInfo.name, "dirf");
}

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

test("records a parent request span and child TOOL span with allowlisted DIRF attributes", () => {
  const spans = [];
  const result = traceMcpToolCall("dirf_record_progress", {
    attempt: "attempt-1",
    workItem: " pr:66 ",
    reviewRevision: "abc123",
    message: "secret prompt-like content",
    content: "private handoff body",
    project: "private path",
  }, () => ({ ok: true, recorded: true }), { traceSink: span => spans.push(span), idFactory: ids() });

  assert.deepEqual(result, { ok: true, recorded: true });
  assert.equal(spans.length, 2);
  const [tool, request] = spans;
  assert.equal(tool.kind, "TOOL");
  assert.equal(request.kind, "CHAIN");
  assert.equal(tool.traceId, request.traceId);
  assert.equal(tool.parentSpanId, request.spanId);
  assert.deepEqual(tool.attributes, {
    "dirf.tool_id": "dirf_record_progress",
    "dirf.execution_outcome": "success",
  });
  assert.doesNotMatch(JSON.stringify(spans), /secret prompt-like content|private handoff body|private path/);
});

test("an unavailable trace sink cannot change the tool result", () => {
  const expected = { ok: true, recorded: false, reason: "stale_review_revision" };
  const result = traceMcpToolCall("dirf_record_progress", {
    attempt: "attempt-2",
    message: "must not leak",
  }, () => expected, { traceSink: () => { throw new Error("backend unavailable"); }, idFactory: ids() });

  assert.equal(result, expected);
});

test("trace failure preserves the original tool error", () => {
  const original = new Error("tool failed");
  assert.throws(() => traceMcpToolCall("dirf_read_handoff", {
    content: "must not leak",
  }, () => { throw original; }, {
    traceSink: () => { throw new Error("backend unavailable"); },
    idFactory: ids(),
  }), error => error === original);
});

test("trace failure preserves falsy values thrown by the tool", () => {
  for (const thrown of [undefined, null, 0, ""]) {
    let caught = Symbol("not thrown");
    try {
      traceMcpToolCall("dirf_read_handoff", {}, () => { throw thrown; }, {
        traceSink: () => {}, idFactory: ids(),
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, thrown);
  }
});

test("no trace sink is a transparent no-op", () => {
  let calls = 0;
  const result = traceMcpToolCall("dirf_list_projects", {}, () => {
    calls += 1;
    return { projects: [] };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { projects: [] });
});

test("real MCP process emits correlated spans for a local project tool call", async () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-mcp-home-"));
  const project = setupProject(home);
  const child = startBoundary(home);
  try {
    await initialize(child);
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
      name: "dirf_read_handoff", arguments: { project, attempt: "PRIVATE-PATH", workItem: "SECRET-SENTINEL", reviewRevision: "PRIVATE-PROMPT" },
    } });
    const response = await nextLine(child.stdout);
    const [tool, request] = await nextLines(child.stdio[3], 2);
    assert.equal(response.id, 2);
    assert.equal(tool.kind, "TOOL");
    assert.equal(request.kind, "CHAIN");
    assert.equal(tool.traceId, request.traceId);
    assert.equal(tool.parentSpanId, request.spanId);
    assert.doesNotMatch(JSON.stringify([tool, request]), /PRIVATE-PATH|SECRET-SENTINEL|PRIVATE-PROMPT/);
    assert.doesNotMatch(JSON.stringify([tool, request]), new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    child.kill();
  }
});

for (const mode of ["fail", "async-fail"]) test(`${mode} sink cannot change a real MCP write result or canonical bytes`, async () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-mcp-home-"));
  const project = setupProject(home);
  const content = "# Boundary proof\n\nExpected canonical bytes.\n";
  const child = startBoundary(home, mode);
  try {
    await initialize(child);
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
      name: "dirf_write_handoff", arguments: { project, content },
    } });
    const response = await nextLine(child.stdout);
    assert.equal(JSON.parse(response.result.content[0].text).ok, true);
    const handoff = execFileSync(process.execPath, [CLI, "state", "read-handoff"], {
      cwd: project, env: { ...process.env, DIRF_HOME: home }, encoding: "utf8",
    });
    assert.equal(handoff, content);
    // A second request proves a rejected promise did not terminate the server.
    send(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: {
      name: "dirf_read_handoff", arguments: { project },
    } });
    const second = await nextLine(child.stdout);
    assert.equal(JSON.parse(second.result.content[0].text).content, content);
  } finally {
    child.kill();
  }
});

test("span reader waits for a newline across split pipe chunks", async () => {
  const stream = new PassThrough();
  const pending = nextLines(stream, 2);
  stream.write('{"kind":"TOOL"}\n{"kind":');
  stream.write('"CHAIN"}');
  stream.write('\n');
  assert.deepEqual(await pending, [{ kind: "TOOL" }, { kind: "CHAIN" }]);
  stream.destroy();
});

test("span reader rejects malformed complete JSON through its promise", async () => {
  const stream = new PassThrough();
  const pending = nextLines(stream, 1);
  stream.write('invalid\n');
  await assert.rejects(pending, SyntaxError);
  stream.destroy();
});
