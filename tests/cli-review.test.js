import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLI = join(process.cwd(), "src", "cli.js");
const HOME = mkdtempSync(join(tmpdir(), "dirf-review-home-"));

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: 30_000, env: { ...process.env, DIRF_HOME: HOME },
  });
}

function reviewFor(repository, base, head, prNumber = 1) {
  const axes = ["spec", "correctness", "concurrency", "security", "data", "frontend", "testing", "standards"];
  return {
    schema_version: 2,
    target: { repository, pr_number: prNumber, base_sha: base, head_sha: head, mode: "full" },
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
  const tree = git(work, ["rev-parse", "HEAD^{tree}"]);
  const merge = execFileSync("git", ["commit-tree", tree, "-p", base, "-p", head], {
    cwd: work, encoding: "utf8", input: "test merge\n",
  }).trim();
  git(work, ["push", "-q", "origin", `${merge}:refs/pull/1/merge`]);

  const reviewPath = join(root, "review.json");
  writeFileSync(reviewPath, JSON.stringify(reviewFor(pathToFileURL(origin).href, base, head)));
  const unrecorded = run(work, ["review", "ready", reviewPath]);
  assert.notEqual(unrecorded.status, 0);
  assert.match(unrecorded.stderr, /dirf review trigger/);
  const otherPath = join(root, "other.json");
  const repository = pathToFileURL(origin).href;
  const blocked = (body, message) => {
    writeFileSync(otherPath, JSON.stringify(body));
    assert.equal(run(work, ["review", "trigger", otherPath]).status, 0);
    const refused = run(work, ["review", "ready", reviewPath]);
    assert.notEqual(refused.status, 0, message);
    assert.match(refused.stderr, /dirf review trigger/, message);
  };
  blocked({
    ...reviewFor(repository, base, head),
    axes: { ...reviewFor(repository, base, head).axes, correctness: { status: "finding", evidence: "P2-001" } },
    findings: [{
      id: "P2-001", priority: "P2", confidence: 92, axis: "correctness", title: "Keep the count",
      file: "change.txt", line: 1, body: "The count restarts after a review.", evidence: ["A fixture shows it"],
    }],
  }, "latest entry for this commit is not clean");
  blocked(reviewFor(repository, base, "e".repeat(40)), "latest clean entry is for another commit");
  const recorded = run(work, ["review", "trigger", reviewPath]);
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(JSON.parse(recorded.stdout).action, "verify_merge_readiness");
  const ready = run(work, ["review", "ready", reviewPath]);
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /Ready: no review issues remain/);

  const newerHead = execFileSync("git", ["commit-tree", tree, "-p", head], {
    cwd: work, encoding: "utf8", input: "new PR head\n",
  }).trim();
  const newerMerge = execFileSync("git", ["commit-tree", tree, "-p", base, "-p", newerHead], {
    cwd: work, encoding: "utf8", input: "new test merge\n",
  }).trim();
  git(work, ["push", "-q", "origin", `${newerHead}:refs/pull/1/head`, `+${newerMerge}:refs/pull/1/merge`]);
  const stale = run(work, ["review", "ready", reviewPath]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /pull-request commit changed/i);

  writeFileSync(reviewPath, JSON.stringify(reviewFor(pathToFileURL(origin).href, base, head, 2)));
  const wrongPr = run(work, ["review", "ready", reviewPath]);
  assert.notEqual(wrongPr.status, 0);
  assert.match(wrongPr.stderr, /could not read the live pull-request/i);
});

test("the store owns the review countdown for each pull request", () => {
  const work = mkdtempSync(join(tmpdir(), "dirf-rounds-"));
  git(work, ["init", "-q"]);
  const base = "a".repeat(40);
  const trigger = (char, target = {}) => {
    const body = reviewFor("https://github.com/owner/repo.git", base, char.repeat(40), 9);
    body.target = { ...body.target, ...target };
    body.findings = [{
      id: "P2-001", priority: "P2", confidence: 92, axis: "correctness", title: "Keep the count",
      file: "change.txt", line: 1, body: "The count restarts after a review.", evidence: ["A fixture shows it"],
    }];
    body.axes.correctness = { status: "finding", evidence: "P2-001" };
    const path = join(work, ".git", "review.json");
    writeFileSync(path, JSON.stringify(body));
    return run(work, ["review", "trigger", path]);
  };
  const step = (result) => {
    assert.equal(result.status, 0, result.stderr);
    const { action, round, remaining } = JSON.parse(result.stdout);
    return { action, round, remaining };
  };
  const fix = "fix_and_update_same_pr";
  assert.deepEqual(step(trigger("b")), { action: fix, round: 1, remaining: 4 });
  assert.deepEqual(step(trigger("b")), { action: fix, round: 1, remaining: 4 }, "same commit keeps the round");
  assert.deepEqual(step(trigger("B")), { action: fix, round: 1, remaining: 4 }, "SHA case does not matter");
  assert.deepEqual(step(trigger("c", { round: 1 })), { action: fix, round: 2, remaining: 3 }, "file cannot reset");
  const limitChange = trigger("d", { max_rounds: 50 });
  assert.notEqual(limitChange.status, 0);
  assert.match(limitChange.stderr, /round limit/i);
  assert.deepEqual(step(trigger("d")), { action: "reconsider_approach", round: 3, remaining: 2 });
  const noChange = trigger("e");
  assert.notEqual(noChange.status, 0);
  assert.match(noChange.stderr, /approach_change/);
  assert.deepEqual(step(trigger("e", { approach_change: "Count in the store" })), { action: fix, round: 4, remaining: 1 });
  assert.deepEqual(step(trigger("f")), { action: "stop_for_person", round: 5, remaining: 0 });
  assert.deepEqual(step(trigger("0")), { action: "stop_for_person", round: 6, remaining: 0 });

  const noReason = run(work, ["review", "reset-rounds", "9"]);
  assert.notEqual(noReason.status, 0);
  assert.match(noReason.stderr, /--reason/);
  const reset = run(work, ["review", "reset-rounds", "9", "--reason", "Owner chose to continue"]);
  assert.equal(reset.status, 0, reset.stderr);
  assert.deepEqual(step(trigger("1")), { action: fix, round: 1, remaining: 4 });
});

function roundsRepo() {
  const work = mkdtempSync(join(tmpdir(), "dirf-rounds-"));
  git(work, ["init", "-q"]);
  const send = (pr, char, { clean = false, target = {} } = {}) => {
    const body = reviewFor("https://github.com/owner/repo.git", "a".repeat(40), char.repeat(40), pr);
    body.target = { ...body.target, ...target };
    if (!clean) {
      body.findings = [{
        id: "P2-001", priority: "P2", confidence: 92, axis: "correctness", title: "Keep the count",
        file: "change.txt", line: 1, body: "The count restarts after a review.", evidence: ["A fixture shows it"],
      }];
      body.axes.correctness = { status: "finding", evidence: "P2-001" };
    }
    const path = join(work, ".git", "review.json");
    writeFileSync(path, JSON.stringify(body));
    return run(work, ["review", "trigger", path]);
  };
  const out = (result) => {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { work, send, out };
}

test("a re-review of the same commit cannot drop the required new approach", () => {
  const { send, out } = roundsRepo();
  out(send(1, "b"));
  out(send(1, "c"));
  assert.equal(out(send(1, "d")).action, "reconsider_approach");
  assert.equal(out(send(1, "d", { clean: true })).round, 3);
  const refused = send(1, "e");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /approach_change/);
  assert.equal(out(send(1, "e", { target: { approach_change: "Count in the store" } })).round, 4);
  assert.equal(out(send(1, "f", { clean: true })).round, 5, "the rule ends once a new approach is recorded");
});

test("a re-review of an older commit keeps its round and blocks nothing", () => {
  const { send, out } = roundsRepo();
  out(send(1, "b"));
  assert.equal(out(send(1, "c", { clean: true })).round, 2);
  assert.equal(out(send(1, "b")).round, 1);
  const again = out(send(1, "c", { clean: true }));
  assert.equal(again.round, 2);
  assert.equal(again.action, "verify_merge_readiness");
  assert.equal(out(send(1, "d")).round, 3);
});

test("each pull request and repository has its own count", () => {
  const { send, out } = roundsRepo();
  out(send(1, "b"));
  out(send(1, "c"));
  assert.equal(out(send(2, "b")).round, 1);
  const other = send(1, "d", { target: { repository: "https://github.com/owner/other.git" } });
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /different repository/i);
});

test("a reset keeps a stated limit unless a review states another", () => {
  const { work, send, out } = roundsRepo();
  assert.equal(out(send(1, "b", { target: { max_rounds: 8 } })).max_rounds, 8);
  assert.equal(run(work, ["review", "reset-rounds", "1", "--reason", "Owner chose to continue"]).status, 0);
  assert.equal(out(send(1, "c")).max_rounds, 8);
  assert.equal(run(work, ["review", "reset-rounds", "1", "--reason", "Owner changed the limit"]).status, 0);
  assert.equal(out(send(1, "d", { target: { max_rounds: 3 } })).max_rounds, 3);
});

test("a stop stays in force until a person resets the rounds", () => {
  const { work, send, out } = roundsRepo();
  for (const char of ["b", "c"]) out(send(1, char));
  out(send(1, "d"));
  out(send(1, "e", { target: { approach_change: "Count in the store" } }));
  assert.equal(out(send(1, "f")).action, "stop_for_person");
  assert.equal(out(send(1, "0", { clean: true })).action, "verify_merge_readiness");
  const script = join(work, ".git", "probe.mjs");
  const stateUrl = pathToFileURL(join(process.cwd(), "src", "state.js")).href;
  const review = reviewFor("https://github.com/owner/repo.git", "a".repeat(40), "0".repeat(40), 1);
  writeFileSync(script, `import { assertReviewRoundRecorded as a, deriveSlug as d } from ${JSON.stringify(stateUrl)};
a(d(process.cwd()), ${JSON.stringify(review)});`);
  const probe = () => spawnSync(process.execPath, [script], { cwd: work, encoding: "utf8", env: { ...process.env, DIRF_HOME: HOME } });
  const stopped = probe();
  assert.notEqual(stopped.status, 0);
  assert.match(stopped.stderr, /stopped for a person/);
  assert.equal(run(work, ["review", "reset-rounds", "1", "--reason", "Owner accepted the result"]).status, 0);
  assert.equal(out(send(1, "0", { clean: true })).round, 1);
  const cleared = probe();
  assert.equal(cleared.status, 0, cleared.stderr);
});

test("a damaged rounds file names itself and stays closed", () => {
  const { send, out } = roundsRepo();
  out(send(77, "b"));
  const projects = join(HOME, "projects");
  const slug = readdirSync(projects).find((name) => {
    try { return readdirSync(join(projects, name, "reviews")).includes("pr-77.json"); } catch { return false; }
  });
  writeFileSync(join(projects, slug, "reviews", "pr-77.json"), "{");
  const result = send(77, "c");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /damaged.*pr-77\.json/s);
});

test("reset-rounds needs an existing DIRF project", () => {
  const work = mkdtempSync(join(tmpdir(), "dirf-rounds-"));
  git(work, ["init", "-q"]);
  const reset = run(work, ["review", "reset-rounds", "1", "--reason", "Nothing here"]);
  assert.notEqual(reset.status, 0);
  assert.match(reset.stderr, /no DIRF project/);
});

test("dirf review ready rejects historical reports before any live Git lookup", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-review-historical-"));
  const reviewPath = join(root, "review.json");
  const historical = reviewFor("owner/repository", "a".repeat(40), "b".repeat(40));
  historical.schema_version = 1;
  delete historical.target.pr_number;
  historical.verification = [{ command: "npm test", result: "passed" }];
  delete historical.completion;
  writeFileSync(reviewPath, JSON.stringify(historical));

  const result = run(root, ["review", "ready", reviewPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /schema version 2/i);
  assert.doesNotMatch(result.stderr, /live pull-request/i);
});
