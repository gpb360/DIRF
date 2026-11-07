import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HANDOFF_BUDGET, handoffBudgetWarning } from "../src/state.js";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;
const lines = (n) => "x\n".repeat(n);

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

test("write-handoff warns on stderr when over budget but still writes and exits 0", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-budget-home-"));
  const project = mkdtempSync(join(tmpdir(), "dirf-budget-proj-"));
  execFileSync("git", ["init", "-q"], { cwd: project, timeout: TIMEOUT });
  const env = { ...process.env, DIRF_HOME: home };
  execFileSync(process.execPath, [CLI, "setup", project], { encoding: "utf8", timeout: TIMEOUT, env });
  const write = (md) => {
    const file = join(project, "h.md");
    writeFileSync(file, md);
    return spawnSync(process.execPath, [CLI, "state", "write-handoff", "--file", file], { cwd: project, encoding: "utf8", timeout: TIMEOUT, env });
  };

  const small = write("# DIRF Handoff\n\nDone.\n");
  assert.equal(small.status, 0);
  assert.doesNotMatch(small.stderr, /budget/);

  const big = write(`# DIRF Handoff\n\n${lines(200)}`);
  assert.equal(big.status, 0);
  assert.match(big.stderr, /^Warning: Canonical handoff is 202 lines \/ 416 bytes \(budget 120 lines/);
  const stored = execFileSync(process.execPath, [CLI, "state", "read-handoff"], { cwd: project, encoding: "utf8", timeout: TIMEOUT, env });
  assert.equal(stored, `# DIRF Handoff\n\n${lines(200)}`);
});
