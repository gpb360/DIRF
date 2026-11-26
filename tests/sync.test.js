import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchMatchesAttemptName } from "../src/board.js";
import { cliFreshness } from "../src/sync.js";

const CLI = join(process.cwd(), "src", "cli.js");

// A fake gh: `pr list` and `pr view` read FAKE_GH_STATE.
const FAKE_GH = `
import { readFileSync } from "node:fs";
const prs = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, "utf8"));
const [group, verb, ...rest] = process.argv.slice(2);
if (group !== "pr") { console.error("unexpected"); process.exit(1); }
if (verb === "list") {
  const state = rest[rest.indexOf("--state") + 1];
  console.log(JSON.stringify(prs.filter((pr) => state === "all" || pr.state === "OPEN")));
} else if (verb === "view") {
  const pr = prs.find((item) => item.number === Number(rest[0]));
  if (!pr) { console.error("no pull requests found"); process.exit(1); }
  console.log(JSON.stringify(pr));
}
`;

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "dirf-sync-home-"));
  const dir = mkdtempSync(join(tmpdir(), "dirf-sync-repo-"));
  const tools = mkdtempSync(join(tmpdir(), "dirf-sync-gh-"));
  const ghScript = join(tools, "gh.mjs");
  writeFileSync(ghScript, FAKE_GH);
  const ghState = join(tools, "prs.json");
  writeFileSync(ghState, "[]");
  const env = { DIRF_HOME: home, DIRF_GH: ghScript, FAKE_GH_STATE: ghState, DIRF_ORCHESTRATOR_TOKEN: "" };
  const run = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: "utf8", timeout: 30_000, env: { ...process.env, ...env, ...extra },
  });
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  for (const args of [["init", "-q"], ["config", "user.name", "DIRF Test"], ["config", "user.email", "dirf@example.invalid"], ["commit", "--allow-empty", "-q", "-m", "init"], ["remote", "add", "origin", "https://github.com/example/repo.git"]]) git(...args);
  assert.equal(run(["setup", dir]).status, 0);
  const setPrs = (prs) => writeFileSync(ghState, JSON.stringify(prs));
  return { dir, run, setPrs };
}

const later = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const merged = (number, branch, mergedAt = later(1)) => ({
  number, title: `PR ${number}`, state: "MERGED", url: `https://github.com/example/repo/pull/${number}`,
  headRefName: branch, createdAt: mergedAt, mergedAt, closedAt: mergedAt, mergeCommit: { oid: "a".repeat(40) },
});

function plannedAttempt(f, name) {
  const result = f.run(["build", name, "add a small cli flag", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).attempt.id;
}

test("a branch matches its attempt's name under a prefix, and build-<name> builds the same branch", () => {
  assert.equal(branchMatchesAttemptName("builder/index-wines", "index-wines"), true);
  assert.equal(branchMatchesAttemptName("builder/index-wines", "build-index-wines"), true);
  assert.equal(branchMatchesAttemptName("index-wines", "index-wines"), true);
  assert.equal(branchMatchesAttemptName("builder/index-wines-2", "index-wines"), false);
  assert.equal(branchMatchesAttemptName("", "index-wines"), false);
});

test("dirf sync closes a planned attempt whose branch-name PR merged, and reports merged PRs no attempt records", () => {
  const f = fixture();
  const id = plannedAttempt(f, "wine-filters");
  f.setPrs([merged(21, "builder/wine-filters"), merged(22, "feat/unrecorded-work"), { number: 23, title: "Open work", state: "OPEN", headRefName: "feat/open-work", body: "" }]);

  const dry = JSON.parse(f.run(["sync", "--json"]).stdout);
  assert.equal(dry.applied, false);
  assert.deepEqual(dry.close.map((action) => [action.attempt, action.prs]), [[id, [21]]]);
  assert.deepEqual(dry.untracked_merged_prs.map((pr) => pr.number), [22]);
  assert.deepEqual(dry.unlinked_open_prs.map((pr) => pr.number), [23]);
  const human = f.run(["sync"]);
  assert.match(human.stdout, /Shipped attempts to close: 1\n  wine-filters · PR #21/);
  assert.match(human.stdout, /Nothing changed/);
  assert.equal(JSON.parse(f.run(["state", "get-attempt", id, "--json"]).stdout).status, "planned");

  const applied = f.run(["sync", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /wine-filters: closed \(shipped\)/);
  const attempt = JSON.parse(f.run(["state", "get-attempt", id, "--json"]).stdout);
  assert.equal(attempt.status, "closed");
  assert.deepEqual(attempt.closure.prs.map((pr) => pr.number), [21]);
  assert.equal(attempt.closure.verified_by, "gh");

  // A closed attempt is not proposed again.
  assert.equal(JSON.parse(f.run(["sync", "--json"]).stdout).close.length, 0);
});

test("dirf sync never links a PR that finished before the attempt existed", () => {
  const f = fixture();
  plannedAttempt(f, "wine-filters");
  f.setPrs([merged(21, "builder/wine-filters", new Date(Date.now() - 3_600_000).toISOString())]);
  const dry = JSON.parse(f.run(["sync", "--json"]).stdout);
  assert.equal(dry.close.length, 0);
  assert.deepEqual(dry.untracked_merged_prs.map((pr) => pr.number), [21]);
});

test("a started attempt whose next action names more work is listed for a person, and --apply leaves it open", () => {
  const f = fixture();
  const id = plannedAttempt(f, "wine-filters");
  const started = f.run(["attempt", "start", id]);
  assert.equal(started.status, 0, started.stderr);
  const progress = f.run(["record-progress", "Opened the PR", "--attempt", id, "--next", "Apply the hosted migration after the owner approves"]);
  assert.equal(progress.status, 0, progress.stderr);
  f.setPrs([merged(21, "builder/wine-filters")]);
  const dry = JSON.parse(f.run(["sync", "--json"]).stdout);
  assert.equal(dry.close.length, 0);
  assert.deepEqual(dry.review.map((action) => action.attempt), [id]);
  assert.match(f.run(["sync"]).stdout, /next action names more work \(a person decides\): 1/);
  assert.equal(f.run(["sync", "--apply"]).status, 0);
  assert.notEqual(JSON.parse(f.run(["state", "get-attempt", id, "--json"]).stdout).status, "closed");
});

test("a merged PR named in the project handoff is recorded work, not untracked", () => {
  const f = fixture();
  f.setPrs([merged(30, "feat/known"), merged(31, "feat/unknown")]);
  const handoff = join(f.dir, "handoff.md");
  writeFileSync(handoff, "# DIRF Handoff\n\n## Completed\n\n- PR 30 merged.\n\n## Exact next action\n\nContinue.\n");
  assert.equal(f.run(["state", "write-handoff", "--file", handoff]).status, 0);
  assert.deepEqual(JSON.parse(f.run(["sync", "--json"]).stdout).untracked_merged_prs.map((pr) => pr.number), [31]);
});

test("dirf state active names GitHub drift in one line, and DIRF_SYNC_CHECK=0 turns it off", () => {
  const f = fixture();
  plannedAttempt(f, "wine-filters");
  f.setPrs([merged(21, "builder/wine-filters")]);
  const active = f.run(["state", "active"]);
  assert.equal(active.status, 0, active.stderr);
  assert.match(active.stdout, /Sync: 1 attempt\(s\) shipped on GitHub but still open\. Run dirf sync/);
  const hook = JSON.parse(f.run(["state", "active", "--hook"]).stdout);
  assert.match(hook.hookSpecificOutput.additionalContext, /Sync: 1 attempt\(s\) shipped/);
  assert.doesNotMatch(f.run(["state", "active"], { DIRF_SYNC_CHECK: "0" }).stdout, /Sync:/);
});

test("dirf sync and state active work without gh", () => {
  const f = fixture();
  plannedAttempt(f, "wine-filters");
  const missing = { DIRF_GH: join(f.dir, "missing-gh-binary") };
  const sync = f.run(["sync"], missing);
  assert.equal(sync.status, 0, sync.stderr);
  assert.match(sync.stdout, /GitHub: unavailable \(gh is not installed\)/);
  const active = f.run(["state", "active"], missing);
  assert.equal(active.status, 0, active.stderr);
  assert.doesNotMatch(active.stdout, /Sync:/);
});

test("cliFreshness reports a CLI checkout behind its local origin/main", () => {
  const repo = mkdtempSync(join(tmpdir(), "dirf-sync-cli-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  for (const args of [["init", "-q", "-b", "feat/old"], ["config", "user.name", "DIRF Test"], ["config", "user.email", "dirf@example.invalid"], ["commit", "--allow-empty", "-q", "-m", "one"]]) git(...args);
  const old = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-q", "-m", "two");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("reset", "-q", "--hard", old);
  assert.deepEqual(cliFreshness(repo), { repo, branch: "feat/old", behind: 1, ahead: 0, stale: true });
  assert.equal(cliFreshness(mkdtempSync(join(tmpdir(), "dirf-sync-nogit-"))), null);
});
