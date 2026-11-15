import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const GREEN = [{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" }];

// A fake gh executable: reads PRs from FAKE_GH_STATE, logs every call, and
// records merges in place so a later `pr view` sees the merged PR.
const FAKE_GH = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const statePath = process.env.FAKE_GH_STATE;
const args = process.argv.slice(2);
appendFileSync(statePath + ".log", JSON.stringify(args) + "\\n");
const prs = JSON.parse(readFileSync(statePath, "utf8"));
const [group, verb, ...rest] = args;
if (group === "api") {
  console.log(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } }));
  process.exit(0);
}
if (group !== "pr") { console.error("unexpected"); process.exit(1); }
if (verb === "list") {
  const state = rest[rest.indexOf("--state") + 1];
  console.log(JSON.stringify(prs.filter((pr) => state === "all" || pr.state === "OPEN")));
} else if (verb === "view") {
  const pr = prs.find((item) => item.number === Number(rest[0]));
  if (!pr) { console.error("no pull requests found"); process.exit(1); }
  console.log(JSON.stringify(pr));
} else if (verb === "merge") {
  const pr = prs.find((item) => item.number === Number(rest[0]));
  Object.assign(pr, { state: "MERGED", mergedAt: new Date().toISOString(), mergeCommit: { oid: "f".repeat(40) } });
  writeFileSync(statePath, JSON.stringify(prs));
}
`;

function review(prNumber, head, base) {
  const axes = ["spec", "correctness", "concurrency", "security", "data", "frontend", "testing", "standards"];
  return {
    schema_version: 2,
    target: { repository: "https://github.com/example/repo.git", pr_number: prNumber, base_sha: base, head_sha: head, mode: "full" },
    walkthrough: [{ area: "board", summary: "Board fixture", files: ["src/board.js"] }],
    axes: Object.fromEntries(axes.map((axis) => [axis, { status: "checked", evidence: `${axis} checked` }])),
    confidence: { quality: 95, evidence: 91 },
    findings: [],
    verification: [{ command: "npm test", status: "passed", result: "all tests passed" }],
    limitations: [],
    completion: { review_complete: true, required_checks: "passed", unresolved_threads: 0 },
  };
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-board-home-"));
  const dir = mkdtempSync(join(tmpdir(), "dirf-cli-board-repo-"));
  const tools = mkdtempSync(join(tmpdir(), "dirf-cli-board-gh-"));
  const ghScript = join(tools, "gh.mjs");
  writeFileSync(ghScript, FAKE_GH);
  const ghState = join(tools, "prs.json");
  const env = { DIRF_HOME: home, DIRF_GH: ghScript, FAKE_GH_STATE: ghState, DIRF_ORCHESTRATOR_TOKEN: "" };
  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: "utf8", timeout: 30_000, input, env: { ...process.env, ...env },
  });
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  for (const args of [["init", "-q"], ["config", "user.name", "DIRF Test"], ["config", "user.email", "dirf@example.invalid"], ["commit", "--allow-empty", "-q", "-m", "init"], ["remote", "add", "origin", "https://github.com/example/repo.git"]]) {
    git(...args);
  }
  // Real commits, so the board can verify the review base is the PR merge base.
  const base = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-q", "-m", "head");
  const head = git("rev-parse", "HEAD");
  const createdAt = new Date(Date.now() + 60_000).toISOString();
  writeFileSync(ghState, JSON.stringify([
    { number: 12, title: "Ready", state: "OPEN", url: "https://github.com/example/repo/pull/12", headRefName: "feat/ready", headRefOid: head, baseRefOid: base, createdAt, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", statusCheckRollup: GREEN, body: "" },
  ]));
  assert.equal(run(["setup", dir]).status, 0);
  const built = run(["build", "ready-feature", "add a small cli flag", "--json"]);
  assert.equal(built.status, 0, built.stderr);
  const attemptId = JSON.parse(built.stdout).attempt.id;
  const progress = run(["record-progress", "Opened PR #12", "--attempt", attemptId, "--next", "Merge PR #12 after review"]);
  assert.equal(progress.status, 0, progress.stderr);
  const reviewDir = join(dir, ".scratch", "dirf-review", "pr-12");
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(join(reviewDir, "review.json"), JSON.stringify(review(12, head, base)));
  const trigger = run(["review", "trigger", join(reviewDir, "review.json")]);
  assert.equal(trigger.status, 0, trigger.stderr);
  const calls = () => existsSync(`${ghState}.log`)
    ? readFileSync(`${ghState}.log`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { dir, home, run, attemptId, calls, env, head };
}

test("dirf board --json shows the attempt, its PR, and review confidence at the current head", () => {
  const f = fixture();
  const result = f.run(["board", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const board = JSON.parse(result.stdout);
  assert.equal(board.github.available, true);
  const attempt = board.attempts.find((item) => item.id === f.attemptId);
  assert.ok(attempt, "attempt is on the board");
  assert.equal(attempt.next_action, "Merge PR #12 after review");
  const pr = attempt.prs.find((item) => item.number === 12);
  assert.equal(pr.review.at_current_head, true);
  assert.deepEqual(pr.review.confidence, { quality: 95, evidence: 91 });
  assert.equal(pr.checks, "passing");
  assert.equal(pr.ready_to_merge, true);

  const human = f.run(["board"]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /DIRF board — .* 1 open attempt\(s\) · 0 stale \(>7d\) · 1 PR\(s\) ready to merge/);
  assert.match(human.stdout, /READY PR #12 · review PASS q95\/e91 @head · checks passing · mergeable/);
});

test("dirf board works without gh", () => {
  const f = fixture();
  const result = spawnSync(process.execPath, [CLI, "board"], {
    cwd: f.dir, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, ...f.env, DIRF_GH: join(f.dir, "missing-gh-binary") },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GitHub: unavailable \(gh is not installed\)/);
  assert.match(result.stdout, /ready-feature/);
});

test("dirf cleanup is a dry run by default and merges nothing", () => {
  const f = fixture();
  const result = f.run(["cleanup"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Cleanup \(dry run\) — 2 proposed action\(s\)/);
  assert.match(result.stdout, /\[merge\] Squash-merge PR #12/);
  assert.match(result.stdout, /\[close\] Close ready-feature as shipped/);
  assert.match(result.stdout, /Nothing changed/);
  assert.equal(f.calls().some((args) => args[1] === "merge"), false);
  const json = JSON.parse(f.run(["cleanup", "--json"]).stdout);
  assert.equal(json.applied, false);
  assert.deepEqual(json.actions.map((action) => action.kind), ["merge", "close"]);
});

test("dirf cleanup --apply asks per item and declining leaves everything open", () => {
  const f = fixture();
  const result = f.run(["cleanup", "--apply"], "n\n");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Merge PR #12\? \[y\/N\]/);
  assert.equal(f.calls().some((args) => args[1] === "merge"), false);
  const attempt = JSON.parse(f.run(["state", "get-attempt", f.attemptId, "--json"]).stdout);
  assert.notEqual(attempt.status, "closed");
});

test("dirf cleanup --apply merges with the reviewed head and closes the attempt as shipped", () => {
  const f = fixture();
  const result = f.run(["cleanup", "--apply"], "y\ny\n");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR #12: merged \(fffffff\)/);
  assert.match(result.stdout, /ready-feature: closed \(shipped\)/);
  const merge = f.calls().find((args) => args[1] === "merge");
  assert.deepEqual(merge, ["pr", "merge", "12", "--squash", "--match-head-commit", f.head]);
  const attempt = JSON.parse(f.run(["state", "get-attempt", f.attemptId, "--json"]).stdout);
  assert.equal(attempt.status, "closed");
  assert.equal(attempt.outcome, "shipped");
  assert.equal(attempt.closure.prs[0].merge_commit, "f".repeat(40));
  const status = f.run(["project", "status"]);
  assert.doesNotMatch(status.stdout, /ready-feature/);
  assert.match(f.run(["board"]).stdout, /0 open attempt\(s\)/);
});

test("dirf attempt close records shipped work with manual evidence", () => {
  const f = fixture();
  assert.notEqual(f.run(["attempt", "close", f.attemptId]).status, 0);
  const result = f.run(["attempt", "close", f.attemptId, "--prs", "#12", "--commits", "abc1234", "--evidence", "merged by hand"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Updated .*: closed/);
  const attempt = JSON.parse(f.run(["state", "get-attempt", f.attemptId, "--json"]).stdout);
  assert.deepEqual(attempt.closure.prs.map((pr) => pr.number), [12]);
  assert.deepEqual(attempt.closure.commits, ["abc1234"]);
  assert.equal(attempt.closure.verified_by, "manual");
});

test("dirf build surfaces unfinished work on stderr without blocking", () => {
  const f = fixture();
  const result = f.run(["build", "another-idea", "add another flag", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  JSON.parse(result.stdout);
  assert.match(result.stderr, /Unfinished work in this project: 1 open attempt\(s\), 1 PR\(s\) passing review but not merged\./);
  assert.match(result.stderr, /PR #12 ready to merge/);
  assert.match(result.stderr, /See all: dirf board · Close finished work: dirf cleanup/);
  const plan = f.run(["plan", "planned-idea", "plan a feature"]);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stderr, /Unfinished work in this project: 2 open attempt\(s\)/);
});

test("dirf settings sets stale_attempt_days", () => {
  const f = fixture();
  const result = f.run(["settings", "set", "--stale-attempt-days", "3"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).stale_attempt_days, 3);
  assert.match(f.run(["board"]).stdout, /stale \(>3d\)/);
});
