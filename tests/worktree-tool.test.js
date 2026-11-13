import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { detectWorktreeTool, findOnPath, worktrunkCommand } from "../src/worktree-tool.js";
import { ROOT } from "../src/paths.js";

const CLI = join(ROOT, "src", "cli.js");

function bin(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), "", { mode: 0o755 });
  return dir;
}

function repo({ config }) {
  const root = mkdtempSync(join(tmpdir(), "dirf-wt-"));
  if (config) {
    mkdirSync(join(root, ".config"));
    writeFileSync(join(root, ".config", "wt.toml"), "");
  }
  return root;
}

const win = (dirs) => ({ platform: "win32", env: { PATH: dirs.join(";"), PATHEXT: ".EXE;.CMD" } });

test("Worktrunk is chosen only when the repo config and the command both exist", () => {
  const tools = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "git-wt.exe");
  const withConfig = repo({ config: true });
  const withoutConfig = repo({ config: false });

  assert.deepEqual(detectWorktreeTool(withConfig, win([tools])), {
    tool: "worktrunk", configured: true, command: "git-wt", reason: ".config/wt.toml present and git-wt on PATH",
  });
  assert.equal(detectWorktreeTool(withoutConfig, win([tools])).tool, "git");
  const missing = detectWorktreeTool(withConfig, win([]));
  assert.equal(missing.tool, "git");
  assert.equal(missing.reason, ".config/wt.toml present but Worktrunk is not installed");
});

test("on Windows the WindowsApps wt alias is Windows Terminal, not Worktrunk", () => {
  const base = mkdtempSync(join(tmpdir(), "dirf-bin-"));
  const terminal = bin(join(base, "Microsoft", "WindowsApps"), "wt.exe");
  assert.equal(worktrunkCommand(win([terminal])), null);
  const worktrunk = bin(join(base, "cargo", "bin"), "wt.exe");
  assert.equal(worktrunkCommand(win([terminal, worktrunk])), null, "the shell would run the Terminal alias first");
  assert.equal(worktrunkCommand(win([worktrunk, terminal])), "wt");
});

test("on POSIX wt is preferred, then git-wt", { skip: process.platform === "win32" }, () => {
  const a = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "git-wt");
  const b = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "wt");
  assert.equal(worktrunkCommand({ platform: "linux", env: { PATH: a } }), "git-wt");
  assert.equal(worktrunkCommand({ platform: "linux", env: { PATH: `${a}:${b}` } }), "wt");
});

test("on POSIX a file without the execute bit is not a command", { skip: process.platform === "win32" }, () => {
  const dir = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "wt");
  chmodSync(join(dir, "wt"), 0o644);
  assert.equal(findOnPath("wt", { platform: "linux", env: { PATH: dir } }), null);
  assert.equal(worktrunkCommand({ platform: "linux", env: { PATH: dir } }), null);
});

test("PATH entries may be quoted and the key may be spelled Path", () => {
  const tools = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "git-wt.exe");
  assert.equal(worktrunkCommand({ platform: "win32", env: { PATH: "", Path: `"${tools}"`, PATHEXT: ".EXE" } }), "git-wt");
});

function gitRepo({ config }) {
  const root = repo({ config });
  execFileSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
  mkdirSync(join(root, "pkg"));
  return root;
}

// Only git, plus the fake tool when given: a real Worktrunk here must not win.
function status(root, { tool, json }) {
  const dirs = [dirname(findOnPath("git"))];
  if (tool) dirs.unshift(bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), process.platform === "win32" ? "git-wt.exe" : "git-wt"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^path$/i.test(key)));
  env.PATH = dirs.join(process.platform === "win32" ? ";" : ":");
  const args = [CLI, "status", ...(json ? ["--json"] : []), "--path", join(root, "pkg")];
  return execFileSync(process.execPath, args, { encoding: "utf8", env, windowsHide: true });
}

test("dirf status finds the Worktrunk config from a subdirectory", () => {
  const out = status(gitRepo({ config: true }), { tool: true, json: true });
  assert.deepEqual(JSON.parse(out).repository.worktree_tool, {
    tool: "worktrunk", configured: true, command: "git-wt", reason: ".config/wt.toml present and git-wt on PATH",
  });
});

test("dirf status text names the worktree command only when the repo has a config", () => {
  const configured = gitRepo({ config: true });
  const line = (out) => out.split(/\r?\n/).find((text) => text.startsWith("New worktrees:"));
  assert.equal(line(status(configured, { tool: true })),
    "New worktrees: Worktrunk (`git-wt switch --create <branch>`); .config/wt.toml present and git-wt on PATH");
  assert.equal(line(status(configured, { tool: false })),
    "New worktrees: git worktree add; .config/wt.toml present but Worktrunk is not installed");
  assert.doesNotMatch(status(gitRepo({ config: false }), { tool: true }), /New worktrees:/);
});
