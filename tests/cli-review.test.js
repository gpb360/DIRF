import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
  });
}

function reviewFor(head) {
  const axes = ["spec", "correctness", "concurrency", "security", "data", "frontend", "testing", "standards"];
  return {
    schema_version: 1,
    target: { repository: "owner/repo", base_sha: "a".repeat(40), head_sha: head, mode: "full" },
    walkthrough: [{ area: "workflow", summary: "Checks the updated review workflow", files: ["src/cli.js"] }],
    axes: Object.fromEntries(axes.map((axis) => [axis, { status: "checked", evidence: `${axis} checked` }])),
    confidence: { quality: 90, evidence: 90 },
    findings: [],
    verification: [{ command: "npm test", result: "passed" }],
    limitations: [],
    completion: { review_complete: true, required_checks: "passed", unresolved_threads: 0 },
  };
}

test("dirf review ready checks the review against the checked-out commit", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-review-"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  const reviewPath = join(root, "review.json");
  writeFileSync(reviewPath, JSON.stringify(reviewFor(head)));

  const ready = run(["review", "ready", reviewPath]);
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /Ready: no review issues remain/);

  writeFileSync(reviewPath, JSON.stringify(reviewFor("b".repeat(40))));
  const stale = run(["review", "ready", reviewPath]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /older commit/i);
});
