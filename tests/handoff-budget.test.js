import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HANDOFF_BUDGET_BYTES, handoffBudgetWarning, readHandoff, recordProgress, registerProject, storeProjectDir, writeHandoff } from "../src/state.js";
import { CANONICAL_LIST_LIMIT, compactProgressLists, historyEntries, mergeProgressHistory, parseCurrentHandoff } from "../src/handoff-update.js";

const CLI = join(process.cwd(), "src", "cli.js");
const MCP = join(process.cwd(), "src", "mcp.js");
const TIMEOUT = 30_000;
const SMALL = "# DIRF Handoff\n\nDone.\n";
const BIG = `# DIRF Handoff\n\n${"x".repeat(9000)}\n`;
const BIG_BYTES = Buffer.byteLength(BIG);
const removeAfter = (t, ...dirs) => t.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });

// A registered throwaway project under a throwaway store, removed after the test.
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "dirf-budget-home-"));
  const project = mkdtempSync(join(tmpdir(), "dirf-budget-proj-"));
  removeAfter(t, home, project);
  execFileSync("git", ["init", "-q"], { cwd: project, timeout: TIMEOUT });
  const env = { ...process.env, DIRF_HOME: home };
  execFileSync(process.execPath, [CLI, "setup", project], { encoding: "utf8", timeout: TIMEOUT, env });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: project, encoding: "utf8", timeout: TIMEOUT, env });
  const writeFile = (md) => { const file = join(project, "h.md"); writeFileSync(file, md); return file; };
  return { project, env, cli, writeFile };
}

test("handoff budget is inclusive and measured in UTF-8 bytes", () => {
  assert.equal(handoffBudgetWarning(""), null);
  assert.equal(handoffBudgetWarning(undefined), null);
  assert.equal(handoffBudgetWarning("a".repeat(HANDOFF_BUDGET_BYTES)), null);
  assert.match(handoffBudgetWarning("a".repeat(HANDOFF_BUDGET_BYTES + 1)), /^Canonical handoff is 8193 bytes \(budget 8192\)/);
  // "é" is 2 bytes: half the budget in characters already fills it.
  assert.equal(handoffBudgetWarning("é".repeat(HANDOFF_BUDGET_BYTES / 2)), null);
  assert.match(handoffBudgetWarning("é".repeat(HANDOFF_BUDGET_BYTES / 2 + 1)), /8194 bytes/);
});

test("compaction keeps the newest entries and returns the rest for history", () => {
  const items = Array.from({ length: CANONICAL_LIST_LIMIT + 2 }, (_, i) => `- step ${i}`);
  const handoff = `# DIRF Handoff\n\n## Completed\n\n${items.join("\n")}\n\n## Exact next action\n\nGo\n`;
  const { markdown, archived } = compactProgressLists(handoff, "/store/HANDOFF-history.md");
  assert.deepEqual(archived, { Completed: ["- step 0", "- step 1"] });
  assert.deepEqual(parseCurrentHandoff(markdown).completedSteps, items.slice(2).map((item) => item.slice(2)));
  assert.equal(parseCurrentHandoff(markdown).nextAction, "Go");
  assert.match(markdown, /## History\n\nOlder entries are kept in full, oldest first: \/store\/HANDOFF-history\.md/);

  const within = `# DIRF Handoff\n\n## Completed\n\n${items.slice(2).join("\n")}\n`;
  assert.deepEqual(compactProgressLists(within, "/x"), { markdown: within, archived: {} });
});

test("history merge appends in order and is idempotent", () => {
  const first = mergeProgressHistory(null, { Completed: ["- a", "- b"], "Changed files": ["- src/x.js"] });
  const again = mergeProgressHistory(first, { Completed: ["- b", "- c"] });
  assert.deepEqual(historyEntries(again, "Completed"), ["a", "b", "c"]);
  assert.deepEqual(historyEntries(again, "Changed files"), ["src/x.js"]);
  assert.equal(mergeProgressHistory(again, { Completed: ["- c"] }), again);
});

test("record-progress trims the canonical lists without losing an entry", (t) => {
  const previousHome = process.env.DIRF_HOME;
  process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), "dirf-compact-home-"));
  const root = mkdtempSync(join(tmpdir(), "dirf-compact-repo-"));
  removeAfter(t, process.env.DIRF_HOME, root);
  t.after(() => { if (previousHome === undefined) delete process.env.DIRF_HOME; else process.env.DIRF_HOME = previousHome; });
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT });
  const { slug } = registerProject(root);
  writeHandoff(slug, "# DIRF Handoff\n\n## Completed\n\n- _(none yet)_\n");

  const total = CANONICAL_LIST_LIMIT + 3;
  const historyPath = join(storeProjectDir(slug), "HANDOFF-history.md");
  for (let i = 0; i < total; i += 1) {
    recordProgress(slug, { message: `checkpoint ${i}`, next: "continue", files: [`src/file-${i}.js`] });
    if (i === CANONICAL_LIST_LIMIT - 1) {
      assert.equal(existsSync(historyPath), false, "no history while the lists fit");
      assert.doesNotMatch(readHandoff(slug), /## History/);
    }
  }

  const canonical = parseCurrentHandoff(readHandoff(slug));
  const history = readFileSync(historyPath, "utf8");
  const all = Array.from({ length: total }, (_, i) => `checkpoint ${i}`);
  assert.equal(canonical.completedSteps.length, CANONICAL_LIST_LIMIT);
  assert.equal(canonical.changedFiles.length, CANONICAL_LIST_LIMIT);
  assert.deepEqual([...historyEntries(history, "Completed"), ...canonical.completedSteps], all);
  assert.deepEqual(historyEntries(history, "Changed files"), ["src/file-0.js", "src/file-1.js", "src/file-2.js"]);
  assert.match(readHandoff(slug), new RegExp(`## History\\n\\nOlder entries are kept in full, oldest first: .*HANDOFF-history\\.md`));
});

test("write-handoff warns on stderr when over budget but still writes and exits 0", (t) => {
  const { cli, writeFile } = fixture(t);
  const small = cli("state", "write-handoff", "--file", writeFile(SMALL));
  assert.equal(small.status, 0);
  assert.equal(small.stderr, "");

  const big = cli("state", "write-handoff", "--file", writeFile(BIG));
  assert.equal(big.status, 0);
  assert.match(big.stderr, new RegExp(`^Warning: Canonical handoff is ${BIG_BYTES} bytes \\(budget 8192\\)`));
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
  assert.match(over.stderr, /^Warning: Canonical handoff is \d+ bytes/m);
});

test("import-handoff warns when the promoted handoff is over budget", (t) => {
  const { project, cli } = fixture(t);
  mkdirSync(join(project, ".dirf"), { recursive: true });
  writeFileSync(join(project, ".dirf", "HANDOFF.md"), BIG);
  const imported = cli("state", "import-handoff", "--force");
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stderr, /^Warning: Canonical handoff is \d+ bytes/);
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
  assert.match(big.warning, new RegExp(`^Canonical handoff is ${BIG_BYTES} bytes`));
  assert.equal(progress.accepted, true);
  assert.match(progress.warning, /^Canonical handoff is \d+ bytes/);
});
