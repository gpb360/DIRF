import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;
const LANDED = "2026-09-10T12:00:00Z";

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  }).trim();
}

// A reviewed branch commit, then a main-line merge commit dated LANDED that
// integrates it. origin/HEAD is set locally so no network remote is needed.
function fixture({ integrate = true, originHead = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), "dirf-merged-home-"));
  const main = mkdtempSync(join(tmpdir(), "dirf-merged-repo-"));
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["config", "user.email", "dirf@example.test"]);
  git(main, ["config", "user.name", "DIRF Test"]);
  writeFileSync(join(main, "base.txt"), "base\n");
  git(main, ["add", "."]);
  git(main, ["commit", "-qm", "base"], { GIT_COMMITTER_DATE: "2026-09-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-09-01T00:00:00Z" });
  const base = git(main, ["rev-parse", "HEAD"]);
  git(main, ["checkout", "-qb", "feature"]);
  writeFileSync(join(main, "feature.txt"), "feature\n");
  git(main, ["add", "."]);
  git(main, ["commit", "-qm", "feature"], { GIT_COMMITTER_DATE: "2026-09-02T00:00:00Z", GIT_AUTHOR_DATE: "2026-09-02T00:00:00Z" });
  const reviewed = git(main, ["rev-parse", "HEAD"]);
  // Like a real PR: main moves on, the branch merges main, then the PR lands.
  // The reviewed commit reaches the main line only through a second parent.
  git(main, ["checkout", "-q", "main"]);
  writeFileSync(join(main, "other.txt"), "other\n");
  git(main, ["add", "."]);
  git(main, ["commit", "-qm", "other"], { GIT_COMMITTER_DATE: "2026-09-03T00:00:00Z", GIT_AUTHOR_DATE: "2026-09-03T00:00:00Z" });
  git(main, ["checkout", "-q", "feature"]);
  git(main, ["merge", "-q", "--no-ff", "--no-edit", "main"], { GIT_COMMITTER_DATE: "2026-09-04T00:00:00Z", GIT_AUTHOR_DATE: "2026-09-04T00:00:00Z" });
  git(main, ["checkout", "-q", "main"]);
  git(main, ["merge", "-q", "--no-ff", "--no-edit", "feature"], { GIT_COMMITTER_DATE: LANDED, GIT_AUTHOR_DATE: LANDED });
  const merged = git(main, ["rev-parse", "HEAD"]);
  git(main, ["update-ref", "refs/remotes/origin/main", integrate ? merged : base]);
  if (originHead) git(main, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  run(["setup", main], { DIRF_HOME: home }, main);
  const attempt = JSON.parse(run(["build", "merge-me", "ship the feature", "--path", main, "--json"], { DIRF_HOME: home }, main)).attempt;
  run(["resume", attempt.id, "--path", main], { DIRF_HOME: home }, main);
  run([
    "record-progress", "Review clear", "--attempt", attempt.id, "--path", main,
    "--next", "Owner: decide whether to merge PR 7", "--work-item", "pr:7",
    "--review-revision", reviewed, "--timestamp", "2026-09-05T00:00:00.000Z",
  ], { DIRF_HOME: home }, main);
  return { home, main, attempt, reviewed };
}

const active = ({ home, main }, format = "--json") => run(["state", "active", "--path", main, format], { DIRF_HOME: home }, main);

test("a next step recorded before the reviewed commit landed is replaced by merged guidance", () => {
  const f = fixture();
  const state = JSON.parse(active(f));
  assert.equal(state.attempt.next_action, null, "the pre-merge step must not be presented as current");
  assert.equal(state.attempt.needs_refresh, false, "merged guidance is not a related-task warning");
  assert.deepEqual(state.attempt.review_integrated, { ref: "origin/main", revision: f.reviewed, landed_at: "2026-09-10T12:00:00.000Z" });
  assert.match(state.attempt.attention, new RegExp(`${f.reviewed.slice(0, 7)} is already in origin/main`));
  assert.doesNotMatch(JSON.stringify(state), /decide whether to merge PR 7/);

  const text = run(["state", "active", "--path", f.main], { DIRF_HOME: f.home }, f.main);
  assert.match(text, /Attention: Reviewed commit .* is already in origin\/main/);
  assert.match(text, /Next: Confirm the merged work is complete, then record completion or a new next step\./);
  assert.doesNotMatch(text, /continue the current stage|decide whether to merge/);

  const hook = JSON.parse(active(f, "--hook")).hookSpecificOutput.additionalContext;
  assert.match(hook, /already in origin\/main/);
  assert.doesNotMatch(hook, /decide whether to merge PR 7/);

  const resumed = run(["resume", f.attempt.id, "--path", f.main], { DIRF_HOME: f.home }, f.main);
  assert.match(resumed, /already in origin\/main/, "resume stays available and shows the same guidance");
  assert.doesNotMatch(resumed, /decide whether to merge PR 7/);
});

test("a checkpoint recorded after the commit landed shows its own next step again", () => {
  const f = fixture();
  run([
    "record-progress", "Merged and confirmed", "--attempt", f.attempt.id, "--path", f.main,
    "--next", "Start the follow-up cleanup", "--work-item", "pr:7",
    "--review-revision", f.reviewed, "--timestamp", "2026-09-11T00:00:00.000Z",
  ], { DIRF_HOME: f.home }, f.main);
  const state = JSON.parse(active(f));
  assert.equal(state.attempt.next_action, "Start the follow-up cleanup");
  assert.equal(state.attempt.review_integrated, null);
  assert.equal(state.attempt.attention, null);
});

test("unmerged reviews and repositories without origin/HEAD keep the recorded next step", () => {
  for (const options of [{ integrate: false }, { originHead: false }]) {
    const state = JSON.parse(active(fixture(options)));
    assert.equal(state.attempt.next_action, "Owner: decide whether to merge PR 7", JSON.stringify(options));
    assert.equal(state.attempt.review_integrated, null, JSON.stringify(options));
    assert.equal(state.attempt.attention, null, JSON.stringify(options));
  }
});
