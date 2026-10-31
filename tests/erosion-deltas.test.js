import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { computeDeltas, erosionReport, parseNumstat } from "../experiments/erosion-deltas.mjs";

const lines = (count, label = "line") => Array.from({ length: count }, (_, i) => `${label} ${i}\n`).join("");

function fixtureRepo() {
  const repo = mkdtempSync(join(tmpdir(), "dirf-erosion-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: repo });
  git("init", "-q");
  writeFileSync(join(repo, "a.js"), lines(10));
  git("add", ".");
  git("commit", "-q", "-m", "c1: create a.js with 10 lines");
  writeFileSync(join(repo, "a.js"), lines(15));
  git("commit", "-q", "-am", "c2: grow a.js to 15 lines");
  writeFileSync(join(repo, "a.js"), lines(12) + "new\n");
  writeFileSync(join(repo, "b.js"), lines(4, "b"));
  git("add", ".");
  git("commit", "-q", "-m", "c3: shrink a.js, add b.js");
  return repo;
}

test("parses numstat commits and skips binary rows", () => {
  const commits = parseNumstat("@abc\n3\t1\tsrc/a.js\n-\t-\tlogo.png\n\n@def\n0\t2\tsrc/a.js\n");
  assert.deepEqual(commits, [
    { sha: "abc", files: { "src/a.js": { added: 3, removed: 1 } } },
    { sha: "def", files: { "src/a.js": { added: 0, removed: 2 } } },
  ]);
});

test("computes delta and churn from a known baseline", () => {
  const [row] = computeDeltas(
    [{ sha: "x", files: { "a.js": { added: 6, removed: 3 } } }],
    { "a.js": 10 },
  );
  assert.equal(row.total, 13);
  assert.equal(row.delta_loc_pct, 30);
  assert.equal(row.churn_ratio, 0.9);
  assert.equal(row.add_remove_ratio, 2);
});

test("a file growing from zero reports infinite delta and churn", () => {
  const [row] = computeDeltas([{ sha: "x", files: { "b.js": { added: 4, removed: 0 } } }], {});
  assert.equal(row.delta_loc_pct, Infinity);
  assert.equal(row.churn_ratio, Infinity);
  assert.equal(row.add_remove_ratio, Infinity);
});

test("reads a real repository window with its baseline", () => {
  const repo = fixtureRepo();
  try {
    const report = erosionReport({ repo, path: ".", commits: 2 });
    assert.equal(report.commits, 2);
    assert.match(report.base, /\^$/);
    const a = report.files.find((row) => row.file === "a.js");
    // c2: +5 -0, c3: +1 -3 (lines 12-14 removed, "new" added); baseline 10 at c1.
    assert.deepEqual(
      { added: a.added, removed: a.removed, prev: a.prev_total, total: a.total, churn: a.churn_ratio, delta: a.delta_loc_pct },
      { added: 6, removed: 3, prev: 10, total: 13, churn: 0.9, delta: 30 },
    );
    const b = report.files.find((row) => row.file === "b.js");
    assert.equal(b.prev_total, 0);
    assert.equal(b.churn_ratio, Infinity);
    assert.equal(report.files[0].file, "b.js", "highest churn sorts first");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a window reaching the root commit has a zero baseline", () => {
  const repo = fixtureRepo();
  try {
    const report = erosionReport({ repo, path: ".", commits: 10 });
    assert.equal(report.commits, 3);
    assert.equal(report.base, null);
    assert.equal(report.files.find((row) => row.file === "a.js").total, 13);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
