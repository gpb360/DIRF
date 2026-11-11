import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { ledgerAction } from "../skills/code-review/scripts/review-ledger.mjs";
import { formatLoopReport, loopPassed, runReviewLadder, runShellCommand } from "../src/review-loop.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const axes = ["spec", "correctness", "concurrency", "security", "data", "frontend", "testing", "standards"];

function review(head, withFinding) {
  return {
    schema_version: 2,
    target: { repository: "https://github.com/owner/repo.git", pr_number: 7, base_sha: SHA_A, head_sha: head, mode: "full" },
    walkthrough: [{ area: "workflow", summary: "Checks the loop", files: ["src/review-loop.js"] }],
    axes: Object.fromEntries(axes.map((axis) => [axis, withFinding && axis === "correctness"
      ? { status: "finding", evidence: "P2-001" }
      : { status: "checked", evidence: `${axis} checked` }])),
    confidence: { quality: 90, evidence: 90 },
    findings: withFinding ? [{
      id: "P2-001", priority: "P2", confidence: 92, axis: "correctness",
      title: "Handle the empty list", file: "src/a.js", line: 3,
      body: "An empty list throws. Return early when the list is empty.",
      evidence: ["Calling it with [] throws a TypeError"],
    }] : [],
    verification: [{ command: "node --test", status: "passed", result: "passed" }],
    limitations: [],
    completion: { review_complete: true, required_checks: "passed", unresolved_threads: 0 },
  };
}

// A fake checkout. `reviews` is the queue of review results (true = finding).
// `checks` is the queue of check exit statuses.
function harness({ reviews = [], checks = [], fixStatus = 0, fixCommits = true, recorded = null, trigger } = {}) {
  let head = SHA_B;
  const calls = [];
  const deps = {
    head: () => head,
    recorded: () => recorded,
    trigger: trigger || ((artifact) => ledgerAction(artifact)),
    run: (command, env) => {
      calls.push({ command, env });
      if (command === "check") return { status: checks.shift() ?? 0, output: "lint: 1 error" };
      if (command === "review") {
        writeFileSync(env.DIRF_REVIEW_OUTPUT, JSON.stringify(review(env.DIRF_REVIEW_HEAD, reviews.shift())));
        return { status: 0, output: "" };
      }
      if (command === "fix") {
        if (fixCommits && fixStatus === 0) head = SHA_C;
        return { status: fixStatus, output: "fixer output" };
      }
      throw new Error(`unexpected command ${command}`);
    },
  };
  const options = { pr: 7, reviewer: "review", fixer: "fix", check: "check", outDir: mkdtempSync(join(tmpdir(), "dirf-loop-")) };
  return { deps, options, calls, commands: () => calls.map(({ command }) => command) };
}

test("a qualified first review stops after one reviewer", () => {
  const h = harness({ reviews: [false] });
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "qualified");
  assert.deepEqual(h.commands(), ["check", "review"]);
  assert.equal(loopPassed(report), true);
  assert.equal(report.guardrails.merge_is_not_authorized, true);
});

test("a failed check starts no reviewer and reports the check output", () => {
  const h = harness({ checks: [1] });
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "check_failed");
  assert.deepEqual(h.commands(), ["check"]);
  assert.match(report.check_output, /lint: 1 error/);
  assert.equal(loopPassed(report), false);
});

test("an already qualified commit runs no command", () => {
  const h = harness({ recorded: { head_sha: SHA_B, action: "verify_merge_readiness" } });
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "already_qualified");
  assert.deepEqual(h.commands(), []);
});

test("two qualified reviews of three stop before any fix and report the third", () => {
  const h = harness({ reviews: [true, false, false] });
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "qualified");
  assert.deepEqual(h.commands(), ["check", "review", "review", "review"]);
  assert.deepEqual(report.reported_findings.map(({ id }) => id), ["P2-001"]);
});

test("the ladder fixes once, checks, and reviews the fix against the earlier reviews", () => {
  const h = harness({ reviews: [true, true, false, false] });
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "qualified_after_fix");
  assert.deepEqual(h.commands(), ["check", "review", "review", "review", "fix", "check", "review"]);
  const fix = h.calls.find(({ command }) => command === "fix");
  assert.equal(fix.env.DIRF_REVIEW_FINDINGS.split(delimiter).length, 3);
  assert.equal(JSON.parse(readFileSync(fix.env.DIRF_REVIEW_REQUEST, "utf8")).action, "fix_and_update_same_pr");
  const last = h.calls.at(-1);
  assert.equal(last.env.DIRF_REVIEW_STEP, "4");
  assert.equal(last.env.DIRF_REVIEW_HEAD, SHA_C);
  assert.equal(last.env.DIRF_REVIEW_PRIOR.split(delimiter).length, 3);
  assert.equal(report.head, SHA_C);
  assert.match(formatLoopReport(report), /Push it before you ask for merge approval/);
});

test("a review of the fix with a finding stops for a new examination, never a second fix", () => {
  const h = harness({ reviews: [true, true, true, true] });
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "needs_new_examination");
  assert.equal(h.commands().filter((command) => command === "fix").length, 1);
  assert.equal(h.commands().filter((command) => command === "review").length, 4);
});

test("a failed check after the fix starts no reviewer of the fix", () => {
  const h = harness({ reviews: [true, true, true], checks: [0, 1] });
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "check_failed");
  assert.deepEqual(h.commands(), ["check", "review", "review", "review", "fix", "check"]);
});

test("a fixer that makes no commit stops the loop", () => {
  const h = harness({ reviews: [true, true, true], fixCommits: false });
  assert.equal(runReviewLadder(h.options, h.deps).outcome, "fixer_made_no_commit");
});

test("stop_for_person from the ledger stops the loop at once", () => {
  const h = harness({ reviews: [true], trigger: (artifact) => ({ action: "stop_for_person", findings: artifact.findings }) });
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "stop_for_person");
  assert.deepEqual(h.commands(), ["check", "review"]);
});

test("a review that names another commit is an error", () => {
  const h = harness({ reviews: [false] });
  const run = h.deps.run;
  h.deps.run = (command, env) => run(command, command === "review" ? { ...env, DIRF_REVIEW_HEAD: SHA_C } : env);
  const report = runReviewLadder(h.options, h.deps);
  assert.equal(report.outcome, "error");
  assert.match(report.error, /not the checkout commit/);
});

test("without a check command the ladder starts at the first review", () => {
  const h = harness({ reviews: [false] });
  const report = runReviewLadder({ ...h.options, check: undefined }, h.deps);
  assert.equal(report.outcome, "qualified");
  assert.deepEqual(h.commands(), ["review"]);
});

test("runShellCommand passes the loop environment and captures output", () => {
  const result = runShellCommand(`node -e "process.stdout.write(process.env.DIRF_REVIEW_STEP); process.exit(3)"`, { DIRF_REVIEW_STEP: "4" }, process.cwd());
  assert.equal(result.status, 3);
  assert.equal(result.output, "4");
});
