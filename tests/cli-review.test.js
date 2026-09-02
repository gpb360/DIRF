import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 30_000 });
}

function reviewFor(base, head) {
  const axes = ["spec", "correctness", "concurrency", "security", "data", "frontend", "testing", "standards"];
  return {
    schema_version: 1,
    target: { repository: "origin", pr_number: 1, base_ref: "refs/heads/main", remote_head_ref: "refs/pull/1/head", base_sha: base, head_sha: head, mode: "full" },
    walkthrough: [{ area: "workflow", summary: "Checks the updated review workflow", files: ["change.txt"] }],
    axes: Object.fromEntries(axes.map((axis) => [axis, { status: "checked", evidence: `${axis} checked` }])),
    confidence: { quality: 90, evidence: 90 },
    findings: [],
    verification: [{ command: "npm test", status: "passed", result: "all tests passed" }],
    limitations: [],
    completion: { review_complete: true, required_checks: "passed", unresolved_threads: 0 },
  };
}

test("dirf review ready checks the local range and live pull-request commit", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-review-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  mkdirSync(work);
  git(root, ["init", "--bare", "-q", origin]);
  git(work, ["init", "-q"]);
  git(work, ["config", "user.email", "dirf@example.invalid"]);
  git(work, ["config", "user.name", "DIRF Test"]);
  git(work, ["remote", "add", "origin", origin]);
  writeFileSync(join(work, "change.txt"), "base\n");
  git(work, ["add", "change.txt"]);
  git(work, ["commit", "-q", "-m", "base"]);
  const base = git(work, ["rev-parse", "HEAD"]);
  git(work, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  writeFileSync(join(work, "change.txt"), "head\n");
  git(work, ["commit", "-q", "-am", "head"]);
  const head = git(work, ["rev-parse", "HEAD"]);
  git(work, ["push", "-q", "origin", "HEAD:refs/pull/1/head"]);

  const reviewPath = join(root, "review.json");
  writeFileSync(reviewPath, JSON.stringify(reviewFor(base, head)));
  const ready = run(work, ["review", "ready", reviewPath]);
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /Ready: no review issues remain/);

  git(origin, ["update-ref", "refs/pull/1/head", base]);
  const stale = run(work, ["review", "ready", reviewPath]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /pull request has a newer commit/i);
});
