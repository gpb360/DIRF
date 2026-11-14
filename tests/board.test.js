import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindExecutionAuthority,
  createAttemptInStore,
  getAttempt,
  portfolioSnapshot,
  projectWorkSnapshot,
  registerProject,
  startTrackingAttempt,
  updateAttemptLifecycle,
  writeSettings,
} from "../src/state.js";
import {
  applyCleanup,
  boardSnapshot,
  checkStatus,
  cleanupPlan,
  formatBoard,
  handoffPullRequests,
  unfinishedWorkNotice,
} from "../src/board.js";

const DAY = 86_400_000;
const TOKEN = "test-board-capability-token-000001";
const HEAD_12 = "a".repeat(40);
const HEAD_13 = "b".repeat(40);
const OLD_HEAD = "c".repeat(40);
const BASE = "d".repeat(40);
const MERGE_10 = "e".repeat(40);

function setup() {
  process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), "dirf-board-"));
  const root = mkdtempSync(join(tmpdir(), "dirf-board-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const { slug } = registerProject(root);
  bindExecutionAuthority(slug, TOKEN);
  return { root, slug };
}

function addAttempt(slug, name, { handoff, date = new Date(), start = true } = {}) {
  const attempt = createAttemptInStore(slug, name, date);
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["define", "build", "verify"] } }));
  const handoffPath = join(attempt.folder, "HANDOFF.md");
  writeFileSync(handoffPath, handoff || "## Exact next action\n\nRun the focused tests.\n");
  startTrackingAttempt(slug, attempt.id, date);
  if (start) updateAttemptLifecycle(slug, attempt.id, "start", {}, date);
  utimesSync(handoffPath, date, date);
  return getAttempt(slug, attempt.id);
}

function review(prNumber, head, findings = []) {
  const axes = ["spec", "correctness", "concurrency", "security", "data", "frontend", "testing", "standards"];
  return {
    schema_version: 2,
    target: { repository: "https://github.com/example/repo.git", pr_number: prNumber, base_sha: BASE, head_sha: head, mode: "full" },
    walkthrough: [{ area: "board", summary: "Board fixture", files: ["src/board.js"] }],
    axes: Object.fromEntries(axes.map((axis) => [axis, { status: "checked", evidence: `${axis} checked` }])),
    confidence: { quality: 92, evidence: 90 },
    findings,
    verification: [{ command: "npm test", status: "passed", result: "all tests passed" }],
    limitations: [],
    completion: { review_complete: true, required_checks: "passed", unresolved_threads: 0 },
  };
}

function writeReview(root, prNumber, body) {
  const dir = join(root, ".scratch", "dirf-review", `pr-${prNumber}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "review.json"), JSON.stringify(body));
}

const GREEN = [{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" }];

// A fake gh: canned PR lists, per-PR views, and a merge log.
function fakeGh(prs) {
  const calls = [];
  const byNumber = new Map(prs.map((pr) => [pr.number, { ...pr }]));
  const gh = (args) => {
    calls.push(args);
    const [group, verb, ...rest] = args;
    if (group !== "pr") throw new Error(`unexpected gh ${args.join(" ")}`);
    if (verb === "list") {
      const state = rest[rest.indexOf("--state") + 1];
      return JSON.stringify([...byNumber.values()].filter((pr) => state === "all" || pr.state === "OPEN"));
    }
    if (verb === "view") {
      const pr = byNumber.get(Number(rest[0]));
      if (!pr) throw Object.assign(new Error("not found"), { stderr: "no pull requests found" });
      return JSON.stringify(pr);
    }
    if (verb === "merge") {
      const pr = byNumber.get(Number(rest[0]));
      assert.deepEqual(rest.slice(1), ["--squash", "--match-head-commit", pr.headRefOid]);
      Object.assign(pr, { state: "MERGED", mergedAt: "2026-11-14T00:00:00Z", mergeCommit: { oid: "f".repeat(40) } });
      return "";
    }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, calls };
}

function fixture() {
  const { root, slug } = setup();
  const now = new Date();
  const ready = addAttempt(slug, "ready-feature", { handoff: "## Exact next action\n\nMerge PR #12 after review.\n" });
  const shipped = addAttempt(slug, "shipped-feature", { handoff: "## Completed\n\n- Opened https://github.com/example/repo/pull/10\n\n## Exact next action\n\nWait for merge.\n" });
  const done = addAttempt(slug, "done-by-handoff", { handoff: "## Exact next action\n\nDone.\n" });
  const stale = addAttempt(slug, "old-idea", { date: new Date(now.getTime() - 20 * DAY) });
  const planned = addAttempt(slug, "planned-only", { start: false });
  writeReview(root, 12, review(12, HEAD_12));
  writeReview(root, 13, review(13, OLD_HEAD));
  const prs = [
    { number: 12, title: "Ready", state: "OPEN", url: "https://github.com/example/repo/pull/12", headRefName: "feat/ready", headRefOid: HEAD_12, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", statusCheckRollup: GREEN, body: "" },
    { number: 13, title: "Old review", state: "OPEN", url: "https://github.com/example/repo/pull/13", headRefName: "feat/other", headRefOid: HEAD_13, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", statusCheckRollup: GREEN, body: "" },
    { number: 10, title: "Shipped", state: "MERGED", url: "https://github.com/example/repo/pull/10", headRefName: "feat/shipped", mergedAt: "2026-11-13T00:00:00Z", mergeCommit: { oid: MERGE_10 } },
  ];
  return { root, slug, now, ready, shipped, done, stale, planned, ...fakeGh(prs) };
}

test("checkStatus reads check runs and commit statuses", () => {
  assert.equal(checkStatus([]), "none");
  assert.equal(checkStatus(GREEN), "passing");
  assert.equal(checkStatus([...GREEN, { __typename: "CheckRun", status: "IN_PROGRESS" }]), "pending");
  assert.equal(checkStatus([...GREEN, { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }]), "failing");
  assert.equal(checkStatus([{ __typename: "StatusContext", state: "SUCCESS" }]), "passing");
  assert.equal(checkStatus([{ __typename: "StatusContext", state: "ERROR" }]), "failing");
});

test("handoffPullRequests reads PR forms and bare #N only on PR, merge, or review lines", () => {
  const numbers = handoffPullRequests("Opened PR #12 and https://github.com/o/r/pull/34.\nWork item: pr:56.\nIssue #78 is unrelated.\nMerge #82-#84 on pass.");
  assert.deepEqual([...numbers].sort((a, b) => a - b), [12, 34, 56, 82, 84]);
});

test("board lists open attempts with linked PRs, review at head, checks, and mergeability", () => {
  const f = fixture();
  const board = boardSnapshot(f.slug, { checkout: f.root, gh: f.gh, now: f.now, requireOrigin: false });
  assert.equal(board.github.available, true);
  assert.deepEqual(board.attempts.map((a) => a.name).sort(), ["done-by-handoff", "old-idea", "planned-only", "ready-feature", "shipped-feature"]);
  const ready = board.attempts.find((a) => a.id === f.ready.id);
  assert.equal(ready.prs.length, 1);
  const pr = ready.prs[0];
  assert.equal(pr.number, 12);
  assert.equal(pr.review.at_current_head, true);
  assert.equal(pr.review.verdict, "PASS");
  assert.deepEqual(pr.review.confidence, { quality: 92, evidence: 90 });
  assert.equal(pr.checks, "passing");
  assert.equal(pr.mergeable, "MERGEABLE");
  assert.equal(pr.ready_to_merge, true);
  const stale = board.attempts.find((a) => a.id === f.stale.id);
  assert.equal(stale.stale, true);
  assert.ok(stale.idle_days >= 19);
  assert.equal(board.attempts.find((a) => a.id === f.ready.id).stale, false);
  assert.equal(board.attempts.find((a) => a.id === f.shipped.id).prs[0].state, "MERGED");
  assert.equal(board.attempts.find((a) => a.id === f.done.id).next_action_done, true);
  // PR 13 is claimed by nobody and its review names an older head.
  assert.equal(board.unlinked_prs.length, 1);
  assert.equal(board.unlinked_prs[0].review.at_current_head, false);
  assert.equal(board.unlinked_prs[0].ready_to_merge, false);
  assert.match(board.unlinked_prs[0].not_ready.join(","), /not at the current head/);
  const text = formatBoard(board);
  assert.match(text, /READY PR #12 · review PASS q92\/e90 @head · checks passing · mergeable/);
  assert.match(text, /STALE \d+d\s+old-idea/);
});

test("a fix-now finding or failing checks keep a PR out of the merge list", () => {
  const f = fixture();
  const withFinding = review(12, HEAD_12, [{
    id: "F1", priority: "P2", title: "Broken", file: "src/board.js", line: 1, axis: "correctness",
    origin: "introduced", confidence: 90, body: "It breaks.", evidence: ["src/board.js:1"],
  }]);
  withFinding.axes.correctness.status = "finding";
  writeReview(f.root, 12, withFinding);
  const board = boardSnapshot(f.slug, { checkout: f.root, gh: f.gh, now: f.now, requireOrigin: false });
  const pr = board.attempts.find((a) => a.id === f.ready.id).prs[0];
  assert.equal(pr.ready_to_merge, false);
  assert.match(pr.not_ready.join(","), /1 fix-now finding/);
  assert.equal(cleanupPlan(board).some((action) => action.kind === "merge"), false);
});

test("board degrades when gh is unavailable", () => {
  const { slug, root } = setup();
  addAttempt(slug, "offline-work", { handoff: "## Exact next action\n\nPush PR #4.\n" });
  const gh = () => { throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }); };
  const board = boardSnapshot(slug, { checkout: root, gh, requireOrigin: false });
  assert.equal(board.github.available, false);
  assert.equal(board.github.reason, "gh is not installed");
  assert.equal(board.attempts.length, 1);
  assert.equal(board.attempts[0].prs[0].state, null);
  assert.match(formatBoard(board), /GitHub: unavailable \(gh is not installed\)/);
  // Unknown PR state never proposes a close.
  assert.equal(cleanupPlan(board).some((action) => action.kind === "close"), false);
});

test("board skips gh when the checkout has no GitHub origin", () => {
  const { slug, root } = setup();
  addAttempt(slug, "local-only");
  const gh = () => { throw new Error("gh must not run"); };
  const board = boardSnapshot(slug, { checkout: root, gh });
  assert.equal(board.github.available, false);
  assert.match(board.github.reason, /no GitHub origin/);
});

test("cleanup plan merges first, closes shipped and done attempts, and asks about stale ones", () => {
  const f = fixture();
  const actions = cleanupPlan(boardSnapshot(f.slug, { checkout: f.root, gh: f.gh, now: f.now, requireOrigin: false }));
  assert.deepEqual(actions.map((a) => a.kind), ["merge", "close", "close", "close", "stale"]);
  assert.equal(actions[0].pr, 12);
  const byName = Object.fromEntries(actions.filter((a) => a.name).map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName).sort(), ["done-by-handoff", "old-idea", "ready-feature", "shipped-feature"]);
  assert.deepEqual(byName["ready-feature"].requires_merge, [12]);
  assert.deepEqual(byName["shipped-feature"].prs, [10]);
  assert.equal(byName["old-idea"].kind, "stale");
});

test("dry run changes nothing; apply --yes merges with the reviewed head and closes as shipped", async () => {
  const f = fixture();
  const board = boardSnapshot(f.slug, { checkout: f.root, gh: f.gh, now: f.now, requireOrigin: false });
  const actions = cleanupPlan(board);
  assert.equal(f.calls.some((args) => args[1] === "merge"), false);
  assert.equal(getAttempt(f.slug, f.shipped.id).status, "in_progress");

  const results = await applyCleanup(f.slug, actions, { checkout: f.root, gh: f.gh, yes: true, log: () => {}, ask: async () => assert.fail("--yes must not ask") });
  assert.deepEqual(results.map((r) => r.result), ["merged", "closed", "closed", "closed", "kept"]);
  assert.equal(results.find((r) => r.kind === "stale").name, "old-idea");
  assert.equal(f.calls.filter((args) => args[1] === "merge").length, 1);

  const shipped = getAttempt(f.slug, f.shipped.id);
  assert.equal(shipped.status, "closed");
  assert.equal(shipped.outcome, "shipped");
  assert.equal(shipped.closure.verified_by, "gh");
  assert.deepEqual(shipped.closure.prs, [{ number: 10, url: "https://github.com/example/repo/pull/10", merge_commit: MERGE_10, merged_at: "2026-11-13T00:00:00Z" }]);
  // No phase was pretended: no evidence, no gate records, phase unchanged.
  assert.equal(shipped.evidence, undefined);
  assert.equal(shipped.gates, undefined);
  assert.equal(shipped.current_phase, "define");
  assert.equal(getAttempt(f.slug, f.ready.id).closure.prs[0].merge_commit, "f".repeat(40));
  assert.equal(getAttempt(f.slug, f.done.id).closure.verified_by, "manual");
  assert.match(getAttempt(f.slug, f.done.id).closure.note, /next action: Done\./);
  assert.equal(getAttempt(f.slug, f.stale.id).status, "in_progress");
  assert.equal(getAttempt(f.slug, f.planned.id).status, "planned");
});

test("apply asks per item; no means skip, and a close waits for its merge", async () => {
  const f = fixture();
  const actions = cleanupPlan(boardSnapshot(f.slug, { checkout: f.root, gh: f.gh, now: f.now, requireOrigin: false }));
  const asked = [];
  const answer = (question) => {
    asked.push(question);
    if (/PR #12/.test(question)) return "n";
    if (/shipped-feature/.test(question)) return "n";
    if (/done-by-handoff/.test(question)) return "y";
    if (/old-idea/.test(question)) return "a";
    return assert.fail(`unexpected question ${question}`);
  };
  const results = await applyCleanup(f.slug, actions, {
    checkout: f.root, gh: f.gh, log: () => {}, authorityToken: TOKEN, ask: async (question) => answer(question),
  });
  const result = (name) => results.find((r) => r.name === name);
  // The ready-feature close needed PR 12, which was declined, so it never asked.
  assert.equal(asked.some((question) => /ready-feature/.test(question)), false);
  assert.equal(result("ready-feature").result, "skipped");
  assert.match(result("ready-feature").reason, /#12 did not merge/);
  assert.equal(results[0].result, "skipped");
  assert.equal(result("shipped-feature").result, "skipped");
  assert.equal(result("done-by-handoff").result, "closed");
  assert.equal(result("old-idea").result, "abandoned");
  assert.equal(f.calls.some((args) => args[1] === "merge"), false);
  assert.equal(getAttempt(f.slug, f.stale.id).status, "abandoned");
  assert.equal(getAttempt(f.slug, f.done.id).status, "closed");
});

test("abandon from cleanup still needs the orchestrator token", async () => {
  const f = fixture();
  const actions = cleanupPlan(boardSnapshot(f.slug, { checkout: f.root, gh: f.gh, now: f.now, requireOrigin: false }))
    .filter((action) => action.kind === "stale");
  const [result] = await applyCleanup(f.slug, actions, { checkout: f.root, gh: f.gh, log: () => {}, ask: async () => "a" });
  assert.equal(result.result, "failed");
  assert.equal(getAttempt(f.slug, f.stale.id).status, "in_progress");
});

test("a PR pushed after the board snapshot is not merged", async () => {
  const f = fixture();
  const actions = cleanupPlan(boardSnapshot(f.slug, { checkout: f.root, gh: f.gh, now: f.now, requireOrigin: false }));
  const pushed = (args) => args[1] === "view" && args[2] === "12" ? JSON.stringify({ state: "OPEN", headRefOid: "9".repeat(40), mergeable: "MERGEABLE", statusCheckRollup: GREEN }) : f.gh(args);
  const dependent = actions.filter((action) => action.kind === "merge" || action.requires_merge?.length);
  const results = await applyCleanup(f.slug, dependent, { checkout: f.root, gh: pushed, yes: true, log: () => {} });
  assert.deepEqual(results.map((r) => [r.kind, r.result]), [["merge", "skipped"], ["close", "skipped"]]);
  assert.equal(f.calls.some((args) => args[1] === "merge"), false);
});

test("closed attempts count as finished work in project status and the portfolio", () => {
  const { slug } = setup();
  const attempt = addAttempt(slug, "shipped-work");
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "close", { outcome: "shipped" }), /requires evidence/);
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "close", { outcome: "abandoned", note: "x" }), /outcome must be one of/);
  updateAttemptLifecycle(slug, attempt.id, "close", { outcome: "shipped", prs: [7], commits: ["abc1234"] });
  const work = projectWorkSnapshot(slug);
  assert.equal(work.attempts[0].live_state, "shipped");
  assert.equal(work.attempts[0].outcome, "shipped");
  const project = portfolioSnapshot().projects.find((p) => p.slug === slug);
  assert.equal(project.attempts.closed, 1);
  assert.equal(project.status, "completed");
  assert.equal(boardSnapshot(slug, { gh: () => "[]", requireOrigin: false }).attempts.length, 0);
  assert.throws(() => updateAttemptLifecycle(slug, attempt.id, "close", { outcome: "shipped", note: "again" }), /Only planned, in-progress, or blocked/);
  const reopened = updateAttemptLifecycle(slug, attempt.id, "reopen");
  assert.equal(reopened.status, "in_progress");
  assert.equal(reopened.closure, null);
});

test("stale_attempt_days is configurable", () => {
  const f = fixture();
  writeSettings({ stale_attempt_days: 30 });
  const board = boardSnapshot(f.slug, { checkout: f.root, gh: f.gh, now: f.now, requireOrigin: false });
  assert.equal(board.stale_attempt_days, 30);
  assert.equal(board.attempts.some((a) => a.stale), false);
  assert.throws(() => writeSettings({ stale_attempt_days: 0 }), /stale_attempt_days must be a positive integer/);
});

test("unfinished work notice lists the top items and points at board and cleanup", () => {
  const f = fixture();
  const notice = unfinishedWorkNotice(f.slug, { checkout: f.root, gh: f.gh, now: f.now, limit: 3, requireOrigin: false });
  assert.match(notice, /Unfinished work in this project: 5 open attempt\(s\), 1 PR\(s\) passing review but not merged\./);
  assert.match(notice, /PR #12 ready to merge/);
  assert.match(notice, /… 3 more/);
  assert.match(notice, /dirf board · Close finished work: dirf cleanup/);
  const { slug } = setup();
  assert.equal(unfinishedWorkNotice(slug, { gh: () => "[]" }), null);
});
