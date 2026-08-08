import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", ".githooks");
const GIT_EXEC_PATH = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
const SH = process.platform === "win32"
  ? join(dirname(dirname(dirname(GIT_EXEC_PATH))), "bin", "sh.exe")
  : "sh";

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" });
}

// Runs a command that is expected to fail sometimes, so the gate's refusal is
// observable rather than thrown.
function tryGit(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// A repo with the hooks installed and a `feat` branch that has diverged from
// the default branch, so merging it produces a real merge commit.
function gated({ conflicting = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dirf-review-gate-"));
  git(root, "init", "-q", "-b", "main");
  mkdirSync(join(root, ".githooks"));
  for (const hook of ["review-gate.sh", "pre-merge-commit", "pre-commit"]) {
    copyFileSync(join(HOOKS, hook), join(root, ".githooks", hook));
  }
  git(root, "config", "core.hooksPath", ".githooks");
  // Without this a fast-forward creates no merge commit and no hook runs.
  git(root, "config", "merge.ff", "false");

  writeFileSync(join(root, "a.txt"), "base\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");

  git(root, "checkout", "-qb", "feat");
  writeFileSync(join(root, conflicting ? "a.txt" : "b.txt"), "feat\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "feat work");

  git(root, "checkout", "-q", "main");
  writeFileSync(join(root, conflicting ? "a.txt" : "c.txt"), "main\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "main moves");

  return root;
}

function record(root, ref, body) {
  git(root, "notes", "--ref=reviews", "add", "-f", "-m", body, ref);
}

const subject = (root) => git(root, "log", "-1", "--format=%s").trim();
const isMerge = (root) => git(root, "log", "-1", "--format=%p").trim().split(/\s+/).length > 1;

test("a merge with no recorded review is refused", () => {
  const root = gated();
  const { code, out } = tryGit(root, "merge", "feat", "-m", "merge");
  assert.notEqual(code, 0);
  assert.match(out, /no review recorded/);
  assert.equal(subject(root), "main moves", "HEAD must not advance");
});

test("a review below the bar is refused and names the score", () => {
  const root = gated();
  record(root, "feat", "score: 6/10\nS1: unchecked null");
  const { code, out } = tryGit(root, "merge", "feat", "-m", "merge");
  assert.notEqual(code, 0);
  assert.match(out, /scored 6, below the 9 bar/);
  assert.equal(subject(root), "main moves");
});

test("a note without a score line is refused rather than assumed good", () => {
  const root = gated();
  record(root, "feat", "looks fine to me");
  const { code, out } = tryGit(root, "merge", "feat", "-m", "merge");
  assert.notEqual(code, 0);
  assert.match(out, /no 'score:' line/);
});

test("a score at the bar merges, tolerating spacing and an x/10 suffix", () => {
  const root = gated();
  record(root, "feat", "  Score : 9/10\ninherited staging ratchet excluded");
  const { code } = tryGit(root, "merge", "feat", "-m", "merge");
  assert.equal(code, 0);
  assert.ok(isMerge(root), "expected a merge commit");
});

test("the threshold is configurable", () => {
  const root = gated();
  git(root, "config", "dirf.reviewThreshold", "6");
  record(root, "feat", "score: 6");
  assert.equal(tryGit(root, "merge", "feat", "-m", "merge").code, 0);
});

test("only the first score line counts, so later prose cannot lift a low score", () => {
  const root = gated();
  record(root, "feat", "score: 4\nthe author argues this is really a score: 10");
  const { code, out } = tryGit(root, "merge", "feat", "-m", "merge");
  assert.notEqual(code, 0);
  assert.match(out, /scored 4/);
});

// The path the gate exists for: a conflicted merge never runs
// pre-merge-commit, and is completed by `git commit` instead.
test("a conflicted merge is gated by pre-commit when the merge is completed", () => {
  const root = gated({ conflicting: true });
  tryGit(root, "merge", "feat", "-m", "merge"); // conflicts, leaves MERGE_HEAD
  writeFileSync(join(root, "a.txt"), "resolved\n");
  git(root, "add", "a.txt");

  const blocked = tryGit(root, "commit", "-m", "merge");
  assert.notEqual(blocked.code, 0, "unreviewed conflicted merge must not commit");
  assert.match(blocked.out, /no review recorded/);

  record(root, "feat", "score: 9");
  assert.equal(tryGit(root, "commit", "-m", "merge").code, 0);
  assert.ok(isMerge(root));
});

test("a refused merge cannot be completed by running git commit", () => {
  const root = gated();
  tryGit(root, "merge", "feat", "-m", "merge"); // refused, merge left staged
  const { code, out } = tryGit(root, "commit", "-m", "merge");
  assert.notEqual(code, 0);
  assert.match(out, /no review recorded/);
  assert.equal(subject(root), "main moves");
});

test("every head of an octopus merge is gated independently", () => {
  const root = gated();
  git(root, "checkout", "-qb", "second", "main");
  writeFileSync(join(root, "d.txt"), "second\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "second work");
  git(root, "checkout", "-q", "main");

  record(root, "feat", "score: 9");
  const partial = tryGit(root, "merge", "feat", "second", "-m", "merge");
  assert.notEqual(partial.code, 0, "one unreviewed head must sink the merge");
  assert.match(partial.out, /second work/);
  tryGit(root, "merge", "--abort");

  record(root, "second", "score: 9");
  assert.equal(tryGit(root, "merge", "feat", "second", "-m", "merge").code, 0);
});

// Invoked through `sh` rather than executed directly: Windows cannot exec a
// shell script as a program, and a spawn failure yields status null, which
// would satisfy a "did not exit 0" assertion without the gate ever running.
function checker(root, ...args) {
  const r = spawnSync(SH, [".githooks/review-gate.sh", ...args], { cwd: root, env: ENV, encoding: "utf8" });
  assert.equal(typeof r.status, "number", "checker must actually run");
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Regression: the checker used to fall through its argument loop to `exit 0`,
// so a caller that could not name the incoming head passed silently.
test("the checker refuses when called with no commits", () => {
  const { code, out } = checker(gated());
  assert.notEqual(code, 0, "no arguments is a broken gate, not an approval");
  assert.match(out, /no commits to check/);
});

// A guard on "$#" alone would pass here: one empty string is $#=1, skips the
// loop body, and falls through to exit 0. Any caller that quoted its expansion
// would inherit a silent approval.
test("the checker refuses an argument list of empty strings", () => {
  const { code, out } = checker(gated(), "", "");
  assert.notEqual(code, 0, "nothing was examined, so nothing was approved");
  assert.match(out, /no commits to check/);
});

// Regression: an unresolvable head used to be skipped via `|| continue`,
// which treated a missing object as reviewed.
test("the checker refuses a head it cannot resolve", () => {
  const { code, out } = checker(gated(), "deadbeefdeadbeef");
  assert.notEqual(code, 0);
  assert.match(out, /cannot resolve/);
});

test("an empty MERGE_HEAD refuses instead of committing silently", () => {
  const root = gated({ conflicting: true });
  tryGit(root, "merge", "feat", "-m", "merge");
  writeFileSync(join(root, "a.txt"), "resolved\n");
  git(root, "add", "a.txt");
  truncateSync(join(root, ".git", "MERGE_HEAD"), 0);

  const { code, out } = tryGit(root, "commit", "-m", "merge");
  assert.notEqual(code, 0, "a gate that cannot see the head must refuse");
  // Asserting the reason, not just the exit code: any unrelated git-level
  // failure would keep this green while the gate was dead.
  assert.match(out, /no commits to check/);
});

test("pre-commit rule 1 (generated memory blocks) still fires alongside the gate", () => {
  const root = gated();
  writeFileSync(join(root, "AGENTS.md"), "<claude-mem-context>\nsession junk\n");
  git(root, "add", "AGENTS.md");
  const { code, out } = tryGit(root, "commit", "-m", "add agents");
  assert.notEqual(code, 0);
  assert.match(out, /claude-mem-context/);
});

test("pre-commit rule 2 (machine-specific paths) still fires alongside the gate", () => {
  const root = gated();
  // Assembled at runtime: writing the marker as a literal would make this
  // file trip the very rule it is testing.
  const marker = ["s7s", "projects"].join("-");
  writeFileSync(join(root, "notes.md"), `see E:/${marker}/amf-dirf/src\n`);
  git(root, "add", "notes.md");
  const { code, out } = tryGit(root, "commit", "-m", "add notes");
  assert.notEqual(code, 0);
  assert.ok(out.includes(marker), "rule 2 must name the offending path");
});
