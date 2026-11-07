import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HANDOFF_BUDGET, handoffBudgetWarning } from "../src/state.js";

const CLI = join(process.cwd(), "src", "cli.js");
const MCP = join(process.cwd(), "src", "mcp.js");
const TIMEOUT = 30_000;
const lines = (n) => "x\n".repeat(n);
const SMALL = "# DIRF Handoff\n\nDone.\n";
const BIG = `# DIRF Handoff\n\n${lines(200)}`;

// A registered throwaway project under a throwaway store, removed after the test.
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "dirf-budget-home-"));
  const project = mkdtempSync(join(tmpdir(), "dirf-budget-proj-"));
  t.after(() => { for (const dir of [home, project]) rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });
  execFileSync("git", ["init", "-q"], { cwd: project, timeout: TIMEOUT });
  const env = { ...process.env, DIRF_HOME: home };
  execFileSync(process.execPath, [CLI, "setup", project], { encoding: "utf8", timeout: TIMEOUT, env });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: project, encoding: "utf8", timeout: TIMEOUT, env });
  const writeFile = (md) => { const file = join(project, "h.md"); writeFileSync(file, md); return file; };
  return { project, env, cli, writeFile };
}

test("handoff budget is inclusive at both limits", () => {
  assert.equal(handoffBudgetWarning(""), null);
  assert.equal(handoffBudgetWarning(undefined), null);
  assert.equal(handoffBudgetWarning(lines(HANDOFF_BUDGET.lines)), null);
  assert.match(handoffBudgetWarning(lines(HANDOFF_BUDGET.lines + 1)), /121 lines/);
  assert.equal(handoffBudgetWarning("a".repeat(HANDOFF_BUDGET.bytes)), null);
  assert.match(handoffBudgetWarning("a".repeat(HANDOFF_BUDGET.bytes + 1)), /8193 bytes/);
});

test("a final line without a newline still counts", () => {
  assert.match(handoffBudgetWarning(`${lines(HANDOFF_BUDGET.lines)}last`), /121 lines/);
});

test("bytes are measured in UTF-8, not characters", () => {
  // "é" is 2 bytes: half the byte budget in characters already fills it.
  assert.equal(handoffBudgetWarning("é".repeat(HANDOFF_BUDGET.bytes / 2)), null);
  assert.match(handoffBudgetWarning("é".repeat(HANDOFF_BUDGET.bytes / 2 + 1)), /8194 bytes/);
});

test("write-handoff warns on stderr when over budget but still writes and exits 0", (t) => {
  const { cli, writeFile } = fixture(t);
  const small = cli("state", "write-handoff", "--file", writeFile(SMALL));
  assert.equal(small.status, 0);
  assert.equal(small.stderr, "");

  const big = cli("state", "write-handoff", "--file", writeFile(BIG));
  assert.equal(big.status, 0);
  assert.match(big.stderr, /^Warning: Canonical handoff is 202 lines \/ 416 bytes \(budget 120 lines/);
  assert.match(big.stderr, /dirf state write-handoff --file FILE/);
  assert.equal(cli("state", "read-handoff").stdout, BIG);
});

test("record-progress warns from the canonical handoff it actually wrote", (t) => {
  const { cli, writeFile } = fixture(t);
  assert.equal(cli("state", "write-handoff", "--file", writeFile(SMALL)).status, 0);
  const within = cli("record-progress", "Checkpoint one", "--next", "Continue");
  assert.equal(within.status, 0, within.stderr);
  assert.doesNotMatch(within.stderr, /Warning/);

  assert.equal(cli("state", "write-handoff", "--file", writeFile(BIG)).status, 0);
  const over = cli("record-progress", "Checkpoint two", "--next", "Continue");
  assert.equal(over.status, 0, over.stderr);
  assert.match(over.stderr, /^Warning: Canonical handoff is \d+ lines/m);
});

test("import-handoff warns when the promoted handoff is over budget", (t) => {
  const { project, cli } = fixture(t);
  mkdirSync(join(project, ".dirf"), { recursive: true });
  writeFileSync(join(project, ".dirf", "HANDOFF.md"), BIG);
  const imported = cli("state", "import-handoff", "--force");
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stderr, /^Warning: Canonical handoff is 202 lines/);
});

// Sends tool calls over stdio JSON-RPC and resolves with each parsed tool
// result once the server has exited, so cleanup never races an open handle.
function mcpCall(env, calls) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP], { stdio: ["pipe", "pipe", "ignore"], env });
    const results = [];
    let failure = null;
    let buf = "";
    const timer = setTimeout(() => { failure = new Error("MCP timeout"); child.kill(); }, TIMEOUT);
    const stop = (error = null) => { failure ??= error; child.kill(); };
    child.on("exit", () => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (results.length === calls.length) resolve(results);
      else reject(new Error(`MCP exited after ${results.length} of ${calls.length} results`));
    });
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const message = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (message.id === 0) continue; // initialize handshake
        if (!message.result || message.result.isError) {
          return stop(new Error(JSON.stringify(message.error ?? message.result.content)));
        }
        results.push(JSON.parse(message.result.content[0].text));
        if (results.length === calls.length) return stop();
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
    calls.forEach(([name, args], i) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name, arguments: args } })}\n`));
  });
}

test("MCP write and progress tools return the budget warning field", async (t) => {
  const { project, env } = fixture(t);
  const [small, big, progress] = await mcpCall(env, [
    ["dirf_write_handoff", { project, content: SMALL }],
    ["dirf_write_handoff", { project, content: BIG }],
    ["dirf_record_progress", { project, message: "Checkpoint", nextAction: "Continue" }],
  ]);
  assert.equal(small.warning, null);
  assert.match(big.warning, /^Canonical handoff is 202 lines/);
  assert.equal(progress.accepted, true);
  assert.match(progress.warning, /^Canonical handoff is \d+ lines/);
});
