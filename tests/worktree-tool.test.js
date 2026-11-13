import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { detectWorktreeTool, findOnPath, worktrunkCommand } from "../src/worktree-tool.js";
import { ROOT } from "../src/paths.js";

const CLI = join(ROOT, "src", "cli.js");

function bin(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), "");
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

test("PATH entries may be quoted and the key may be spelled Path", () => {
  const tools = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "git-wt.exe");
  assert.equal(worktrunkCommand({ platform: "win32", env: { PATH: "", Path: `"${tools}"`, PATHEXT: ".EXE" } }), "git-wt");
});

test("dirf status finds the Worktrunk config from a subdirectory", () => {
  const root = repo({ config: true });
  execFileSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
  mkdirSync(join(root, "pkg"));
  const tools = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), process.platform === "win32" ? "git-wt.exe" : "git-wt");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^path$/i.test(key)));
  // Only the fake tool and git: a real Worktrunk on this machine must not win.
  env.PATH = [tools, dirname(findOnPath("git"))].join(process.platform === "win32" ? ";" : ":");
  const out = execFileSync(process.execPath, [CLI, "status", "--json", "--path", join(root, "pkg")], {
    encoding: "utf8", env, windowsHide: true,
  });
  assert.deepEqual(JSON.parse(out).repository.worktree_tool, {
    tool: "worktrunk", configured: true, command: "git-wt", reason: ".config/wt.toml present and git-wt on PATH",
  });
});
