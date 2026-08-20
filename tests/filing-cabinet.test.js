// Filing Cabinet inventory tests. Run: node --test tests/filing-cabinet.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventory } from "../skills/filing-cabinet/scripts/filing-cabinet.mjs";

const TIMEOUT = 30_000;
function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: TIMEOUT });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "filing-cabinet-"));
  const wts = mkdtempSync(join(tmpdir(), "filing-cabinet-wts-"));
  git(root, ["init", "-q", "-b", "main"]);
  writeFileSync(join(root, "base.txt"), "base\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  return { root, wts };
}

function addWorktree(fx, name) {
  const { root, wts } = fx;
  git(root, ["switch", "-q", "-c", name]);
  writeFileSync(join(root, `${name}.txt`), `${name}\n`);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", `${name} work`]);
  git(root, ["switch", "-q", "main"]);
  git(root, ["worktree", "add", "-q", join(wts, name), name]);
}

test("inventory lists worktrees with branch state and recommendations", () => {
  const fx = fixture();
  addWorktree(fx, "feature-wt");

  const result = inventory(fx.root);
  assert.equal(result.defaultBranch, "main");
  const feature = result.worktrees.find((wt) => wt.branch === "feature-wt");
  assert.ok(feature, "feature worktree is inventoried");
  assert.equal(feature.dirty, false);
  assert.equal(feature.merged, false);
  assert.ok(["retain", "review"].includes(feature.recommendation));
});

test("a dirty worktree is never recommended for removal", () => {
  const fx = fixture();
  addWorktree(fx, "dirty-wt");
  const wtPath = join(fx.wts, "dirty-wt");
  writeFileSync(join(wtPath, "scratch.txt"), "uncommitted\n");

  const result = inventory(fx.root);
  const dirty = result.worktrees.find((wt) => wt.branch === "dirty-wt");
  assert.ok(dirty);
  assert.equal(dirty.dirty, true);
  assert.notEqual(dirty.recommendation, "remove");
  assert.equal(dirty.recommendation, "review");
});

test("inventory is read-only", () => {
  const fx = fixture();
  addWorktree(fx, "ro-wt");
  const before = git(fx.root, ["worktree", "list", "--porcelain"]);
  inventory(fx.root);
  const after = git(fx.root, ["worktree", "list", "--porcelain"]);
  assert.equal(after, before);
});

test("a branch merged into the default branch is detected as merged", () => {
  const fx = fixture();
  addWorktree(fx, "merged-wt");
  git(fx.root, ["merge", "-q", "--no-ff", "-m", "merge feature", "merged-wt"]);

  const result = inventory(fx.root);
  const merged = result.worktrees.find((wt) => wt.branch === "merged-wt");
  assert.ok(merged);
  assert.equal(merged.merged, true);
});
