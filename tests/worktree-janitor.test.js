import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectProjectWorktrees, registerProject } from "../src/state.js";
import { applyJanitor, formatBinReport, formatJanitorReport, listBin, planJanitor, purgeBin, restoreFromBin, worktreeOwner } from "../src/worktree-janitor.js";

const DAY = 86_400_000;
const IDENTITY = { GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" };

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "core.longpaths=true", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// A project with a remote and a T3-style worktree root: <base>/.t3/worktrees/proj/<name>.
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "dirf-janitor-"));
  process.env.DIRF_HOME = join(base, "dirf-home");
  const remote = join(base, "remote.git");
  mkdirSync(remote);
  git(remote, "init", "-q", "--bare");
  const main = join(base, "proj");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, ".gitignore"), "node_modules/\n.env.local\ndist/\n");
  writeFileSync(join(main, "README.md"), "# test\n");
  writeFileSync(join(main, "package.json"), "{}\n");
  writeFileSync(join(main, ".env.local"), "KEY=shared\n");
  git(main, "add", ".");
  git(main, "commit", "-q", "-m", "init");
  git(main, "remote", "add", "origin", remote);
  git(main, "push", "-q", "-u", "origin", "main");
  const root = join(base, ".t3", "worktrees", "proj");
  mkdirSync(root, { recursive: true });
  const { slug } = registerProject(main);
  return {
    main,
    root,
    store: join(base, "bin-store"),
    add(name, { deps = false, commit = false, push = false } = {}) {
      const path = join(root, name);
      git(main, "worktree", "add", "-q", "-b", name, path);
      if (deps) {
        mkdirSync(join(path, "node_modules", "pkg"), { recursive: true });
        writeFileSync(join(path, "node_modules", "pkg", "index.js"), "x".repeat(1000));
      }
      if (commit) {
        // Named content keeps two worktrees from producing the same commit hash.
        writeFileSync(join(path, "feature.txt"), `${name}\n`);
        git(path, "add", ".");
        git(path, "commit", "-q", "-m", "work");
      }
      if (push) git(path, "push", "-q", "-u", "origin", name);
      return path;
    },
    plan(daysAhead, options = {}) {
      const now = new Date(Date.now() + daysAhead * DAY);
      return planJanitor(inspectProjectWorktrees(slug, now), { now, ...options });
    },
  };
}

const find = (plan, branch) => plan.worktrees.find((item) => item.branch === branch);

test("owner is read from the worktree path", () => {
  const main = "E:/code/proj";
  assert.equal(worktreeOwner("D:/tools/.t3/worktrees/proj/t3-1", main), "t3");
  assert.equal(worktreeOwner("D:/tools/.codex/worktrees/x/proj", main), "codex");
  assert.equal(worktreeOwner("E:/code/proj/.claude/worktrees/x", main), "claude");
  assert.equal(worktreeOwner("D:/tools/.archon/workspaces/o/proj/worktrees/x", main), "archon");
  assert.equal(worktreeOwner("E:/code/proj/.worktrees/x", main), "repo-local");
  assert.equal(worktreeOwner("E:/code/proj-fix", main), "sibling");
  assert.equal(worktreeOwner("D:/elsewhere/x", main), "other");
});

test("a fresh worktree is kept and the main checkout is never a candidate", () => {
  const fx = fixture();
  fx.add("fresh", { deps: true, commit: true, push: true });
  const plan = fx.plan(0);
  assert.equal(find(plan, "fresh").action, "keep");
  assert.equal(find(plan, "fresh").owner, "t3");
  assert.equal(find(fx.plan(30), "main").action, "keep");
});

test("an idle worktree sheds node_modules before it is old enough to remove", () => {
  const fx = fixture();
  const path = fx.add("idle", { deps: true, commit: true, push: true });
  mkdirSync(join(path, "tools", "node_modules"), { recursive: true });
  const item = find(fx.plan(2), "idle");
  assert.equal(item.action, "shed");
  assert.equal(item.shed_paths.length, 1, "node_modules with no package.json beside it cannot be reinstalled, so it stays");
  assert.ok(item.shed_paths[0].endsWith("idle/node_modules"));
  assert.ok(item.bytes >= 1000);
  assert.equal(existsSync(join(path, "node_modules")), true, "planning deletes nothing");
});

test("a clean, pushed worktree idle past the limit is removable", () => {
  const fx = fixture();
  fx.add("merged", { commit: true, push: true });
  const item = find(fx.plan(5), "merged");
  assert.equal(item.action, "remove");
  assert.deepEqual(item.blocked_by, []);
  assert.deepEqual(item.proof.held_by, ["refs/remotes/origin/merged"]);
  assert.equal(item.proof.merged_into, null, "pushed, but not part of the default branch");
});

test("maintenance that rewrites the reflog or touches node_modules does not reset the idle clock", () => {
  const fx = fixture();
  const path = fx.add("maintained", { deps: true, commit: true, push: true });
  const later = new Date(Date.now() + 5 * DAY);
  const reflog = join(git(path, "rev-parse", "--absolute-git-dir"), "logs", "HEAD");
  utimesSync(reflog, later, later);
  utimesSync(join(path, "node_modules"), later, later);
  assert.equal(find(fx.plan(5), "maintained").action, "remove");
});

test("unpushed commits block removal but not shedding", () => {
  const fx = fixture();
  fx.add("local-only", { deps: true, commit: true });
  const item = find(fx.plan(5), "local-only");
  assert.equal(item.action, "shed");
  assert.deepEqual(item.blocked_by, ["unpushed"]);
});

test("a dirty worktree is never removable", () => {
  const fx = fixture();
  const path = fx.add("dirty", { commit: true, push: true });
  writeFileSync(join(path, "scratch.txt"), "uncommitted\n");
  const item = find(fx.plan(5), "dirty");
  assert.equal(item.action, "keep");
  assert.deepEqual(item.blocked_by, ["dirty"]);
});

test("a worktree owned by a live attempt is kept", () => {
  const fx = fixture();
  fx.add("owned", { deps: true, commit: true, push: true });
  const now = new Date(Date.now() + 5 * DAY);
  const entries = inspectProjectWorktrees(registerProject(fx.main).slug, now)
    .map((entry) => entry.branch === "owned" ? { ...entry, attempt_id: "a1", attempt_status: "in_progress" } : entry);
  const item = find(planJanitor(entries, { now }), "owned");
  assert.equal(item.action, "keep");
  assert.deepEqual(item.blocked_by, ["live attempt"]);
});

test("ignored files that exist only in the worktree block removal; copies of the main checkout's do not", () => {
  const fx = fixture();
  const copy = fx.add("env-copy", { commit: true, push: true });
  writeFileSync(join(copy, ".env.local"), "KEY=shared\n");
  const unique = fx.add("env-unique", { commit: true, push: true });
  writeFileSync(join(unique, ".env.local"), "KEY=only-here\n");
  const plan = fx.plan(5);
  assert.equal(find(plan, "env-copy").action, "remove");
  assert.equal(find(plan, "env-unique").action, "keep");
  assert.deepEqual(find(plan, "env-unique").blocked_by, ["local-only ignored files: .env.local"]);
});

test("folders in a worktree root that git does not list are orphans", () => {
  const fx = fixture();
  fx.add("listed", { commit: true, push: true });
  mkdirSync(join(fx.root, "residue", "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(fx.root, "residue", "node_modules", "pkg", "index.js"), "x".repeat(500));
  mkdirSync(join(fx.root, "has-work"));
  writeFileSync(join(fx.root, "has-work", "notes.md"), "keep me\n");
  mkdirSync(join(fx.root, "logs-only"));
  writeFileSync(join(fx.root, "logs-only", "test.log"), "evidence\n");
  // A folder that holds another project's checkout is not this project's orphan.
  mkdirSync(join(fx.root, "container", "other-project", ".git"), { recursive: true });
  const plan = fx.plan(0);
  const byName = Object.fromEntries(plan.orphans.map((item) => [item.path.split("/").pop(), item]));
  assert.deepEqual(Object.keys(byName).sort(), ["has-work", "logs-only", "residue"]);
  assert.equal(byName.residue.action, "remove");
  assert.equal(byName["has-work"].action, "report");
  assert.equal(byName["logs-only"].action, "report");
  assert.equal(byName.residue.owner, "t3");
});

test("sizes can be skipped", () => {
  const fx = fixture();
  fx.add("idle", { deps: true, commit: true, push: true });
  assert.equal(find(fx.plan(2, { sizes: false }), "idle").bytes, null);
});

test("apply moves a removable worktree to the recycle bin and deletes only dependencies and residue", () => {
  const fx = fixture();
  const merged = fx.add("merged", { deps: true, commit: true, push: true });
  writeFileSync(join(merged, ".env.local"), "KEY=shared\n");
  const dirty = fx.add("dirty", { deps: true, commit: true, push: true });
  writeFileSync(join(dirty, "scratch.txt"), "uncommitted\n");
  const local = fx.add("local-only", { deps: true, commit: true });
  mkdirSync(join(fx.root, "residue", "node_modules"), { recursive: true });
  mkdirSync(join(fx.root, "has-work"));
  writeFileSync(join(fx.root, "has-work", "notes.md"), "keep me\n");
  const head = git(merged, "rev-parse", "HEAD");

  const result = applyJanitor(fx.plan(5), { store: fx.store });
  assert.deepEqual(result.errors, []);
  assert.equal(result.binned.length, 1);
  const [receipt] = listBin(fx.store);
  assert.equal(receipt.status, "in_bin");
  assert.equal(receipt.verified, true);
  assert.equal(receipt.head, head);
  assert.deepEqual(receipt.proof.held_by, ["refs/remotes/origin/merged"]);
  assert.deepEqual(receipt.after, { commit_present: true, branch_at_head: true, branch_free: true, moved: true, dependencies_deleted: true });

  assert.equal(existsSync(merged), false);
  assert.equal(existsSync(join(receipt.payload, "feature.txt")), true, "the folder is kept in the bin");
  assert.equal(existsSync(join(receipt.payload, ".env.local")), true, "ignored files travel with it");
  assert.equal(existsSync(join(receipt.payload, "node_modules")), false);
  assert.equal(git(fx.main, "rev-parse", "refs/heads/merged"), head);
  assert.equal(git(receipt.payload, "rev-parse", "HEAD"), head, "git still knows the binned worktree");
  assert.equal(fx.plan(5).worktrees.some((item) => item.path.includes(".dirf-trash")), false, "a binned worktree is not planned again");
  assert.equal(git(fx.main, "status", "--porcelain"), "");

  assert.equal(existsSync(join(local, "node_modules")), false);
  assert.equal(existsSync(join(local, "feature.txt")), true);
  assert.equal(existsSync(join(dirty, "scratch.txt")), true);
  assert.equal(existsSync(join(dirty, "node_modules")), false);
  assert.equal(existsSync(join(fx.root, "residue")), false);
  assert.equal(existsSync(join(fx.root, "has-work", "notes.md")), true);
  assert.deepEqual(fx.plan(5).orphans.map((item) => item.path.split("/").pop()), ["has-work"], "the bin is not an orphan");
  const actions = readFileSync(join(fx.store, "journal.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line).action).sort();
  assert.deepEqual(actions, ["bin", "orphan", "shed", "shed"]);
});

test("apply leaves a worktree untouched when it changed after the plan", () => {
  const fx = fixture();
  const path = fx.add("merged", { commit: true, push: true });
  const plan = fx.plan(5);
  writeFileSync(join(path, "late.txt"), "written after planning\n");
  const result = applyJanitor(plan, { store: fx.store });
  assert.match(result.errors[0].error, /changes appeared after the plan/);
  assert.equal(existsSync(join(path, "late.txt")), true);
  assert.deepEqual(listBin(fx.store), []);
});

test("apply can be limited to one step", () => {
  const fx = fixture();
  fx.add("merged", { commit: true, push: true });
  const local = fx.add("local-only", { deps: true, commit: true });
  mkdirSync(join(fx.root, "residue", "node_modules"), { recursive: true });
  const result = applyJanitor(fx.plan(5), { store: fx.store, only: "remove" });
  assert.deepEqual([result.binned.length, result.shed.length, result.orphans_removed.length, result.errors.length], [1, 0, 0, 0]);
  assert.equal(existsSync(join(local, "node_modules")), true);
  assert.equal(existsSync(join(fx.root, "residue")), true);
  assert.throws(() => applyJanitor(fx.plan(5), { store: fx.store, only: "everything" }), /--only takes one of/);
});

test("restore puts a binned worktree back on its branch with its files", () => {
  const fx = fixture();
  const path = fx.add("merged", { deps: true, commit: true, push: true });
  writeFileSync(join(path, ".env.local"), "KEY=shared\n");
  const [{ id }] = applyJanitor(fx.plan(5), { store: fx.store }).binned;
  assert.match(formatBinReport(listBin(fx.store)), /1 worktree\(s\)[\s\S]*on origin\/merged/);

  const receipt = restoreFromBin(fx.store, id);
  assert.equal(receipt.restored_as, "merged");
  assert.equal(readFileSync(join(path, "feature.txt"), "utf8"), "merged\n");
  assert.equal(existsSync(join(path, ".env.local")), true);
  assert.equal(git(path, "status", "--porcelain"), "");
  assert.equal(git(path, "rev-parse", "--abbrev-ref", "HEAD"), "merged");
  assert.equal(existsSync(receipt.payload), false);
  assert.throws(() => restoreFromBin(fx.store, id), /already restored/);
});

test("restore uses a detached HEAD when the branch has moved on", () => {
  const fx = fixture();
  const path = fx.add("merged", { commit: true, push: true });
  const head = git(path, "rev-parse", "HEAD");
  const [{ id }] = applyJanitor(fx.plan(5), { store: fx.store }).binned;
  git(fx.main, "branch", "-f", "merged", "main");
  assert.equal(restoreFromBin(fx.store, id).restored_as, "detached HEAD");
  assert.equal(git(path, "rev-parse", "HEAD"), head);
  assert.equal(git(path, "status", "--porcelain"), "");
});

test("purge deletes old bin entries only while their commit is held elsewhere", () => {
  const fx = fixture();
  fx.add("kept-on-remote", { commit: true, push: true });
  fx.add("lost", { commit: true, push: true });
  applyJanitor(fx.plan(5), { store: fx.store });
  const payload = (branch) => listBin(fx.store).find((receipt) => receipt.branch === branch).payload;
  git(fx.main, "branch", "-D", "lost");
  git(fx.main, "update-ref", "-d", "refs/remotes/origin/lost");

  assert.deepEqual(purgeBin(fx.store, { apply: true }).purged, [], "nothing is older than the default 14 days");
  const dryRun = purgeBin(fx.store, { keepDays: 0 });
  assert.equal(dryRun.due.length, 1);
  assert.equal(existsSync(payload("kept-on-remote")), true, "a dry run deletes nothing");

  const result = purgeBin(fx.store, { keepDays: 0, apply: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.purged.length, 1);
  assert.equal(existsSync(payload("kept-on-remote")), false);
  assert.match(result.blocked[0].reason, /no longer on any branch or remote/);
  assert.equal(existsSync(join(payload("lost"), "feature.txt")), true);
  assert.deepEqual(listBin(fx.store).map((receipt) => receipt.status).sort(), ["in_bin", "purged"], "receipts outlive the purge");
});

test("the CLI reports a dry run, bins on --apply and restores by id", () => {
  const fx = fixture();
  const path = fx.add("merged", { commit: true, push: true });
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [cli, "worktree", ...args], { cwd: fx.main, encoding: "utf8" });
  const janitor = (...flags) => run("janitor", "--no-sizes", "--shed-days", "0", "--remove-days", "0", ...flags);
  const report = janitor();
  assert.match(report, /dry run/);
  assert.match(report, /remove\s+1/);
  assert.match(report, /on origin\/merged/);
  assert.equal(existsSync(path), true);
  assert.match(janitor("--apply"), /Moved 1 worktree\(s\) to the recycle bin/);
  assert.equal(existsSync(path), false);
  const [{ id }] = JSON.parse(run("bin", "--json"));
  assert.match(run("purge"), /Nothing in the recycle bin is old enough/);
  assert.match(run("restore", id), /Restored/);
  assert.equal(existsSync(join(path, "feature.txt")), true);
});

test("the report names each candidate and the totals", () => {
  const fx = fixture();
  fx.add("merged", { commit: true, push: true });
  fx.add("local-only", { deps: true, commit: true });
  const report = formatJanitorReport(fx.plan(5));
  assert.match(report, /remove\s+1/);
  assert.match(report, /shed\s+1/);
  assert.match(report, /merged/);
  assert.match(report, /unpushed/);
  assert.match(report, /dry run/i);
});

// A branch with one commit of its own that no worktree has checked out.
function looseBranch(fx, name, { push = false } = {}) {
  const path = fx.add(name, { commit: true, push });
  git(fx.main, "worktree", "remove", "--force", path);
  return git(fx.main, "rev-parse", `refs/heads/${name}`);
}

// Lands a branch on the remote's main as a single squashed commit, then deletes the remote branch.
function squashMerge(fx, name) {
  git(fx.main, "merge", "-q", "--squash", name);
  git(fx.main, "commit", "-q", "-m", `squash ${name}`);
  git(fx.main, "push", "-q", "origin", "main");
  git(fx.main, "push", "-q", "origin", "--delete", name);
}

const branchPlan = (plan, name) => plan.branches.find((item) => item.branch === name);

test("a branch is removable only when the default branch holds its work", () => {
  const fx = fixture();
  fx.add("checked-out", { commit: true, push: true });
  git(fx.main, "branch", "merged-branch", "main");
  looseBranch(fx, "only-copy");
  looseBranch(fx, "open", { push: true });
  looseBranch(fx, "squashed", { push: true });
  squashMerge(fx, "squashed");
  looseBranch(fx, "abandoned", { push: true });
  git(fx.main, "push", "-q", "origin", "--delete", "abandoned");

  const objectsBefore = git(fx.main, "count-objects", "-v");
  const plan = fx.plan(5);
  assert.equal(git(fx.main, "count-objects", "-v"), objectsBefore, "planning writes nothing into the repository");
  assert.deepEqual([branchPlan(plan, "merged-branch").action, branchPlan(plan, "merged-branch").proof], ["remove", { merged_into: "refs/remotes/origin/main" }]);
  assert.deepEqual([branchPlan(plan, "squashed").action, branchPlan(plan, "squashed").proof], ["remove", { squash_merged_into: "refs/remotes/origin/main" }]);
  assert.match(branchPlan(plan, "only-copy").reason, /never pushed/);
  assert.equal(branchPlan(plan, "open").reason, "pushed, not merged");
  assert.match(branchPlan(plan, "abandoned").reason, /remote branch is gone/);
  assert.equal(branchPlan(plan, "checked-out").reason, "checked out in a worktree");
  assert.equal(branchPlan(plan, "main").action, "keep");
  assert.deepEqual(plan.totals.branches, { count: 7, removable: 2 });
  assert.equal(branchPlan(fx.plan(0), "merged-branch").reason, "recent");
  assert.match(formatJanitorReport(plan), /squashed: \w{7} squash-merged into origin\/main[\s\S]*BRANCHES kept/);
  assert.deepEqual(fx.plan(5, { branches: false }).branches, []);
});

test("a binned branch keeps its history and upstream, and comes back by id", () => {
  const fx = fixture();
  const head = looseBranch(fx, "squashed", { push: true });
  squashMerge(fx, "squashed");
  const history = git(fx.main, "reflog", "--format=%H", "squashed");

  const result = applyJanitor(fx.plan(5), { store: fx.store, only: "branches" });
  assert.deepEqual(result.errors, []);
  const [{ id }] = result.branches_binned;
  const [receipt] = listBin(fx.store);
  assert.equal(receipt.verified, true);
  assert.throws(() => git(fx.main, "rev-parse", "--verify", "refs/heads/squashed"));
  assert.equal(git(fx.main, "rev-parse", `refs/heads/${receipt.binned_as}`), head);
  assert.equal(fx.plan(5).branches.some((item) => item.branch.startsWith("dirf-trash/")), false, "a binned branch is not planned again");
  assert.match(formatBinReport(listBin(fx.store)), /0 worktree\(s\), 1 branch\(es\)[\s\S]*squash-merged into origin\/main  branch squashed/);

  restoreFromBin(fx.store, id);
  assert.equal(git(fx.main, "rev-parse", "refs/heads/squashed"), head);
  assert.equal(git(fx.main, "reflog", "--format=%H", "squashed").endsWith(history), true, "the branch's own history is intact");
  assert.equal(git(fx.main, "config", "branch.squashed.remote"), "origin");
});

test("purge deletes a binned branch only while the default branch still holds its work", () => {
  const fx = fixture();
  git(fx.main, "branch", "merged-branch", "main");
  git(fx.main, "branch", "moved-in-bin", "main");
  const other = looseBranch(fx, "only-copy");
  applyJanitor(fx.plan(5), { store: fx.store, only: "branches" });
  const receipt = (branch) => listBin(fx.store).find((item) => item.branch === branch);
  git(fx.main, "update-ref", `refs/heads/${receipt("moved-in-bin").binned_as}`, other);
  git(fx.main, "branch", "merged-branch", "main");

  assert.equal(purgeBin(fx.store, { keepDays: 0 }).due.length, 1);
  const result = purgeBin(fx.store, { keepDays: 0, apply: true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.purged.map((item) => item.path), ["branch merged-branch"]);
  assert.match(result.blocked[0].reason, /changed while it was in the bin/);
  assert.throws(() => git(fx.main, "rev-parse", "--verify", `refs/heads/${receipt("merged-branch").binned_as}`));
  assert.equal(git(fx.main, "rev-parse", `refs/heads/${receipt("moved-in-bin").binned_as}`), other);
  assert.throws(() => restoreFromBin(fx.store, receipt("merged-branch").id), /already purged/);
});

test("a binned branch is not restored over a new branch of the same name", () => {
  const fx = fixture();
  git(fx.main, "branch", "merged-branch", "main");
  const [{ id }] = applyJanitor(fx.plan(5), { store: fx.store, only: "branches" }).branches_binned;
  git(fx.main, "branch", "merged-branch", "main");
  assert.throws(() => restoreFromBin(fx.store, id), /exists again/);
  assert.equal(listBin(fx.store)[0].status, "in_bin");
});

// Proof that the recycle bin loses nothing. Each test names one way a cleanup
// could destroy work and shows that it does not.

// Every file outside .git and node_modules with its hash, plus what git reports.
function snapshot(path) {
  const files = {};
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name === ".git" || item.name === "node_modules") continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else files[relative(path, full).replace(/\\/g, "/")] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(path);
  return {
    files, head: git(path, "rev-parse", "HEAD"), branch: git(path, "rev-parse", "--abbrev-ref", "HEAD"),
    status: git(path, "status", "--porcelain", "--ignored"), index: git(path, "ls-files", "-s"), stash: git(path, "stash", "list"),
  };
}

const reflog = (path) => git(path, "reflog", "--format=%H").split("\n");

test("proof: a bin and restore round trip returns every file and all git state unchanged", () => {
  const fx = fixture();
  const path = fx.add("round-trip", { commit: true, push: true });
  mkdirSync(join(path, "src", "nested"), { recursive: true });
  writeFileSync(join(path, "src", "nested", "ünïcødé name.txt"), "non-ASCII file name\n");
  writeFileSync(join(path, "src", "crlf.txt"), "line one\r\nline two\r\n");
  writeFileSync(join(path, "src", "binary.bin"), Buffer.from([0, 255, 1, 254, 13, 10, 0]));
  writeFileSync(join(path, "src", "read-only.txt"), "read-only\n");
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "more work");
  git(path, "push", "-q");
  chmodSync(join(path, "src", "read-only.txt"), 0o444);
  writeFileSync(join(path, ".env.local"), "KEY=shared\n");
  // An ignored build output whose full path is longer than the 260 characters Windows allows by default.
  const deep = join(path, "dist", "a".repeat(100), "b".repeat(100), "c".repeat(100));
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, "bundle.js"), "built\n");
  // Stashed work lives in the shared repository, not in the worktree.
  writeFileSync(join(path, "README.md"), "# stashed edit\n");
  git(path, "stash", "-q");
  const before = snapshot(path);
  const historyBefore = reflog(path);
  assert.ok(Object.keys(before.files).length >= 9);

  const result = applyJanitor(fx.plan(5), { store: fx.store });
  assert.deepEqual(result.errors, []);
  assert.equal(existsSync(path), false);
  restoreFromBin(fx.store, result.binned[0].id);

  assert.deepEqual(snapshot(path), before);
  assert.deepEqual(reflog(path).slice(-historyBefore.length), historyBefore, "the worktree's own history is intact");
  git(path, "stash", "pop", "-q");
  assert.equal(readFileSync(join(path, "README.md"), "utf8"), "# stashed edit\n");
});

test("proof: an untracked file on a path longer than Windows allows blocks removal", () => {
  const fx = fixture();
  const path = fx.add("long-untracked", { commit: true, push: true });
  const deep = join(path, "notes", "a".repeat(100), "b".repeat(100), "c".repeat(100));
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, "idea.md"), "never committed\n");
  const item = fx.plan(5).worktrees.find((entry) => entry.path.endsWith("long-untracked"));
  assert.equal(item.action, "keep");
  assert.deepEqual(item.blocked_by, ["dirty"]);
});

test("proof: commits that only the worktree's history holds survive the bin and garbage collection", () => {
  const fx = fixture();
  const path = fx.add("amended", { commit: true, push: true });
  writeFileSync(join(path, "abandoned.txt"), "work that was reset away\n");
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "abandoned");
  const abandoned = git(path, "rev-parse", "HEAD");
  git(path, "reset", "-q", "--hard", "HEAD~1");

  const [{ id }] = applyJanitor(fx.plan(5), { store: fx.store }).binned;
  git(fx.main, "gc", "-q", "--prune=now");
  git(fx.main, "cat-file", "-e", `${abandoned}^{commit}`);
  restoreFromBin(fx.store, id);
  assert.ok(reflog(path).includes(abandoned));
  assert.match(git(path, "show", `${abandoned}:abandoned.txt`), /reset away/);
});

test("proof: deleting dependencies and residue never follows a link out of the folder", () => {
  const fx = fixture();
  const outside = join(fx.root, "..", "..", "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "precious.txt"), "not part of any worktree\n");
  const link = (dir) => { mkdirSync(dir, { recursive: true }); symlinkSync(outside, join(dir, "linked"), "junction"); };
  link(join(fx.add("shed-me", { deps: true, commit: true }), "node_modules"));
  link(join(fx.add("bin-me", { deps: true, commit: true, push: true }), "node_modules"));
  link(join(fx.root, "residue", "node_modules"));

  const result = applyJanitor(fx.plan(5), { store: fx.store });
  assert.deepEqual(result.errors, []);
  assert.equal(result.binned.length, 1);
  assert.equal(result.shed.length, 1);
  assert.equal(result.orphans_removed.length, 1);
  assert.equal(readFileSync(join(outside, "precious.txt"), "utf8"), "not part of any worktree\n");
});

test("proof: a worktree that a running program uses is left untouched", { skip: process.platform !== "win32" && "only Windows refuses to move a folder that is in use" }, async () => {
  const fx = fixture();
  const path = fx.add("in-use", { deps: true, commit: true, push: true });
  const before = snapshot(path);
  const program = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { cwd: path, stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    const result = applyJanitor(fx.plan(5), { store: fx.store });
    assert.match(result.errors[0].error, /left untouched/);
    assert.deepEqual(result.binned, []);
    assert.deepEqual(listBin(fx.store), []);
    assert.deepEqual(snapshot(path), before);
    assert.equal(existsSync(join(path, "node_modules", "pkg", "index.js")), true, "dependencies stay when the move is refused");
  } finally {
    program.kill();
  }
});

test("proof: binning one worktree does not touch another whose folder is missing", () => {
  const fx = fixture();
  const gone = fx.add("gone", { commit: true });
  const record = git(gone, "rev-parse", "--absolute-git-dir");
  rmSync(gone, { recursive: true, force: true });
  fx.add("merged", { commit: true, push: true });
  assert.equal(applyJanitor(fx.plan(5), { store: fx.store }).binned.length, 1);
  assert.equal(existsSync(join(record, "logs", "HEAD")), true, "git still holds the missing worktree's record and history");
});

test("proof: purge refuses a binned worktree that gained files, and deletes one that did not", () => {
  const fx = fixture();
  const longPath = fx.add("long-path", { commit: true, push: true });
  const deep = join(longPath, "dist", "a".repeat(100), "b".repeat(100), "c".repeat(100));
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, "bundle.js"), "built\n");
  fx.add("touched", { commit: true, push: true });
  applyJanitor(fx.plan(5), { store: fx.store });
  const receipt = (branch) => listBin(fx.store).find((item) => item.branch === branch);
  writeFileSync(join(receipt("touched").payload, "new-notes.md"), "written while in the bin\n");

  const result = purgeBin(fx.store, { keepDays: 0, apply: true });
  assert.deepEqual(result.purged.map((item) => item.id), [receipt("long-path").id]);
  assert.equal(existsSync(receipt("long-path").payload), false);
  assert.equal(result.errors.length, 1);
  assert.equal(readFileSync(join(receipt("touched").payload, "new-notes.md"), "utf8"), "written while in the bin\n");
  assert.equal(receipt("touched").status, "in_bin");
});

test("proof: restore refuses an occupied location, and a stale plan changes nothing", () => {
  const fx = fixture();
  const path = fx.add("merged", { commit: true, push: true });
  const plan = fx.plan(5);
  const [{ id, payload }] = applyJanitor(plan, { store: fx.store }).binned;

  const again = applyJanitor(plan, { store: fx.store });
  assert.equal(again.binned.length, 0);
  assert.match(again.errors[0].error, /left untouched/);
  assert.equal(listBin(fx.store).length, 1);

  git(fx.main, "worktree", "add", "-q", path, "merged");
  assert.throws(() => restoreFromBin(fx.store, id), /original location is occupied/);
  assert.equal(existsSync(join(payload, "feature.txt")), true);
  assert.equal(listBin(fx.store)[0].status, "in_bin");
});

test("proof: many worktrees round trip in one run, twice", () => {
  const fx = fixture();
  const names = Array.from({ length: 6 }, (_, index) => `batch-${index}`);
  const before = Object.fromEntries(names.map((name) => [name, snapshot(fx.add(name, { deps: true, commit: true, push: true }))]));
  for (const round of [1, 2]) {
    const result = applyJanitor(fx.plan(5), { store: fx.store });
    assert.deepEqual(result.errors, [], `round ${round}`);
    assert.equal(result.binned.length, names.length);
    for (const item of result.binned) restoreFromBin(fx.store, item.id);
    for (const name of names) {
      const after = snapshot(join(fx.root, name));
      // Dependencies are deleted by design, so git no longer reports the ignored folder.
      assert.deepEqual({ ...after, status: "" }, { ...before[name], status: "" }, `${name}, round ${round}`);
    }
  }
});
