import { test } from "node:test";
import assert from "node:assert/strict";
import * as reviewReport from "../skills/code-review/scripts/review-report.mjs";

const head = "a".repeat(40);
const review = (repository) => ({ target: { repository, pr_number: 57 } });

test("canonical GitHub URLs require live checks instead of silently skipping them", () => {
  for (const repository of ["https://github.com/gpb360/DIRF.git", "git@github.com:gpb360/DIRF.git", "gpb360/DIRF"]) {
    const calls = [];
    assert.throws(() => reviewReport.liveGithubState(review(repository), head, (args) => {
      calls.push(args);
      return { total_count: 0, check_runs: [] };
    }), /all live pull-request checks passed/);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes(`repos/gpb360/dirf/commits/${head}/check-runs?per_page=100`));
    assert.ok(calls[0].includes("github.com"));
  }
});

const passedChecks = { total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] };
const threads = (nodes = [], hasNextPage = false) => ({ data: { repository: { pullRequest: {
  reviewThreads: { nodes, pageInfo: { hasNextPage } },
} } } });

test("successful verification checks the requested host and all review conversations", () => {
  const calls = [];
  const result = reviewReport.liveGithubState(review("https://github.example.test/owner/repo.git"), head, (args) => {
    calls.push(args);
    return calls.length === 1 ? passedChecks : threads([{ isResolved: true }]);
  });
  assert.deepEqual(result, { live_checks_passed: true, live_unresolved_threads: 0 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((args) => args[0] === "--hostname" && args[1] === "github.example.test"));
  assert.ok(calls[1].includes("number=57"));
});

test("missing, failed and truncated live evidence all fail closed", () => {
  for (const checks of [{}, { total_count: 2, check_runs: passedChecks.check_runs },
    { total_count: 1, check_runs: [{ status: "in_progress", conclusion: null }] },
    { total_count: 1, check_runs: [{ status: "completed", conclusion: "failure" }] }]) {
    assert.throws(() => reviewReport.liveGithubState(review("https://github.com/owner/repo"), head,
      () => checks), /all live pull-request checks passed/);
  }
  for (const graph of [{}, threads([{ isResolved: false }]), threads([], true)]) {
    assert.throws(() => reviewReport.liveGithubState(review("https://github.com/owner/repo"), head,
      (args) => args.includes("graphql") ? graph : passedChecks), /conversations are resolved/);
  }
  assert.throws(() => reviewReport.liveGithubState(review("https://github.com/owner/repo"), head,
    () => { throw new Error("API unavailable"); }), /API unavailable/);
  for (const repository of ["unknown", "https://github.com/owner/repo/tree/main", "https://github.com/../repo"]) {
    assert.throws(() => reviewReport.liveGithubState(review(repository), head,
      () => assert.fail("invalid target must not call GitHub")), /could not identify/);
  }
});
