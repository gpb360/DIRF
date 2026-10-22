#!/usr/bin/env node
// Filing Cabinet inventory — read-only worktree census. Zero dependencies.
// Lists every worktree with branch state, merge status, ahead/behind, dirty
// state, and last commit date, then recommends retain/review/archive/remove
// per the decision contract (CONTRACT.md). Never modifies anything.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return "";
  }
}

function isDirty(repo, worktreePath) {
  return git(repo, ["-C", worktreePath, "status", "--porcelain"]).split(/\r?\n/).filter(Boolean).length > 0;
}

function parseWorktrees(repo) {
  const porcelain = git(repo, ["worktree", "list", "--porcelain"]);
  const worktrees = [];
  let current = null;
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
      worktrees.push(current);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).replace(/^refs\/heads\//, "");
    } else if (line.startsWith("detached")) {
      current.detached = true;
    } else if (line === "") {
      current = null;
    }
  }
  return worktrees;
}

function defaultBranch(repo) {
  return git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) || "main";
}

function branchState(repo, branch, base) {
  // `git branch --merged` prefixes entries ("* " current, "+ " checked out
  // in a linked worktree, "  " plain) — match on the suffix.
  const listing = git(repo, ["branch", "--merged", base, "--list", branch]);
  const merged = listing.endsWith(branch);
  let aheadBehind = "";
  const counts = git(repo, ["rev-list", "--left-right", "--count", `${branch}...origin/${branch}`]);
  const match = /^(\d+)\s+(\d+)$/.exec(counts.trim());
  if (match) aheadBehind = `ahead ${match[1]} / behind ${match[2]}`;
  const lastCommit = git(repo, ["log", "-1", "--format=%ci", branch]);
  return { merged, aheadBehind, lastCommit: lastCommit || null };
}

function recommend({ detached, branch, merged, dirty, lastCommit, aheadBehind }) {
  if (detached && dirty) return { action: "review", reason: "detached HEAD with local changes" };
  if (dirty) return { action: "review", reason: "dirty working tree" };
  if (!merged) {
    const recent = lastCommit && lastCommit >= new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (recent) return { action: "retain", reason: "unmerged with recent commits" };
    return { action: "archive", reason: "clean but unmerged and stale" };
  }
  const stale = lastCommit && lastCommit < new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (stale) return { action: "remove", reason: "merged and stale" };
  return { action: "retain", reason: "merged and recent" };
}

export function inventory(repoRoot) {
  const repo = resolve(repoRoot);
  if (!existsSync(repo) || !existsSync(resolve(repo, ".git"))) {
    throw new Error(`not a git repository: ${repo}`);
  }
  const base = defaultBranch(repo);
  const items = [];
  for (const wt of parseWorktrees(repo)) {
    const branch = wt.branch || wt.head || (wt.detached ? "(detached)" : "(unknown)");
    const pathExists = existsSync(wt.path);
    const dirty = pathExists && isDirty(repo, wt.path);
    if (!pathExists) {
      items.push({
        path: wt.path,
        branch,
        detached: !!wt.detached,
        dirty: false,
        merged: false,
        aheadBehind: "",
        lastCommit: null,
        recommendation: "remove",
        reason: "worktree path no longer exists (prunable)",
      });
      continue;
    }
    const state = branch === "(detached)" || branch === "(unknown)"
      ? { merged: false, aheadBehind: "", lastCommit: null }
      : branchState(repo, branch, base);
    const rec = recommend({ detached: !!wt.detached, branch, merged: state.merged, dirty, lastCommit: state.lastCommit, aheadBehind: state.aheadBehind });
    items.push({
      path: wt.path,
      branch,
      detached: !!wt.detached,
      dirty,
      merged: state.merged,
      aheadBehind: state.aheadBehind,
      lastCommit: state.lastCommit,
      recommendation: rec.action,
      reason: rec.reason,
    });
  }
  return { repo, defaultBranch: base, worktrees: items };
}

export function main(root = process.cwd()) {
  const json = process.argv.includes("--json");
  const result = inventory(root);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Filing Cabinet inventory: ${result.repo}`);
  console.log(`Default branch: ${result.defaultBranch}`);
  for (const item of result.worktrees) {
    console.log(`\n[${item.recommendation}] ${item.branch || "(detached)"} @ ${item.path}`);
    console.log(`  ${item.reason}`);
    if (item.dirty) console.log("  dirty: yes");
    if (!item.detached) console.log(`  merged: ${item.merged ? "yes" : "no"} | ${item.aheadBehind} | last commit: ${item.lastCommit || "n/a"}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
